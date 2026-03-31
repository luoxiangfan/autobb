import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type ReplyPayload,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import type { MentionTarget } from "./mention.js";
import { resolveFeishuAccount } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { buildMentionedCardContent } from "./mention.js";
import { getFeishuRuntime } from "./runtime.js";
import { sendMarkdownCardFeishu, sendMessageFeishu } from "./send.js";
import { FeishuStreamingSession } from "./streaming-card.js";
import { resolveReceiveIdType } from "./targets.js";
import { addTypingIndicator, removeTypingIndicator, type TypingIndicatorState } from "./typing.js";

/** Detect if text contains markdown elements that benefit from card rendering */
function shouldUseCard(text: string): boolean {
  return /```[\s\S]*?```/.test(text) || /\|.+\|[\r\n]+\|[-:| ]+\|/.test(text);
}

type AgentEventEnvelope = {
  stream?: string;
  data?: Record<string, unknown>;
};

type ProgressToolStatus = "running" | "completed" | "failed";

type ProgressToolState = {
  toolCallId: string;
  name: string;
  detail?: string;
  status: ProgressToolStatus;
  updatedAt: number;
};

const FEISHU_PROGRESS_RENDER_THROTTLE_MS = 1200;
const FEISHU_PROGRESS_MAX_LINES = 6;
const FEISHU_PARTIAL_PROGRESS_SUPPRESS_MS = 5000;
const FEISHU_PARTIAL_PROGRESS_HEARTBEAT_MS = 6000;
const LOW_VALUE_COMMAND_HEARTBEAT_ID = "__command_heartbeat__";
const LOW_VALUE_COMMAND_HEARTBEAT_DETAIL = "后台轮询中";
const LOW_VALUE_PROCESS_POLL_HEARTBEAT_DETAIL = "后台任务状态同步中";
const CREATIVE_BUCKET_ORDER: Record<string, number> = {
  A: 1,
  B: 2,
  D: 3,
};
const PROGRESS_TOOL_LABELS: Record<string, string> = {
  exec: "执行操作",
  bash: "执行操作",
  process: "后台任务",
  read: "读取文件",
  write: "写入文件",
  edit: "编辑文件",
  apply_patch: "应用补丁",
  message: "发送消息",
  sessions_send: "会话消息发送",
  session_status: "会话状态检查",
  web_search: "网页搜索",
  web_fetch: "网页抓取",
  card_progress_sync: "状态同步（卡片）",
  chat_record_sync: "状态同步（聊天记录）",
  transcript_sync: "状态同步（聊天记录）",
};

function normalizeProgressToolName(value: unknown): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "tool";
  }

  const mapped = PROGRESS_TOOL_LABELS[normalized.toLowerCase()];
  return (mapped || normalized).slice(0, 80);
}

function isCommandToolName(value: unknown): boolean {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "exec" || normalized === "bash";
}

function isProcessToolName(value: unknown): boolean {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "process";
}

function extractCreativeBucket(value: string): "A" | "B" | "D" | undefined {
  const match = value.match(/["']?bucket["']?\s*[:=]\s*["']?([ABD])["']?/i);
  const bucket = (match?.[1] || "").toUpperCase();
  if (bucket === "A" || bucket === "B" || bucket === "D") {
    return bucket;
  }
  return undefined;
}

function resolveBusinessStepFromCommand(detail: string): string | undefined {
  if (/\/api\/offers\/extract\b/i.test(detail)) {
    return "创建新Offer";
  }
  if (/\/api\/offers\/\d+\/rebuild\b/i.test(detail)) {
    return "重建Offer";
  }
  if (/\/api\/offers\/\d+\/generate-creatives-queue\b/i.test(detail)) {
    const bucket = extractCreativeBucket(detail);
    if (bucket) {
      const order = CREATIVE_BUCKET_ORDER[bucket];
      return `生成第 ${order} 个创意（${bucket}桶）`;
    }
    return "生成广告创意";
  }
  if (/\/api\/campaigns\/publish\b/i.test(detail)) {
    const accountMatch = detail.match(
      /googleAdsAccountId["']?\s*[:=]\s*["']?(\d{6,})["']?/i,
    );
    if (accountMatch?.[1]) {
      return `发布广告（账号 ${accountMatch[1]}）`;
    }
    return "发布广告";
  }
  if (/\/api\/click-farm\/tasks\b/i.test(detail)) {
    const countMatch = detail.match(/daily_click_count["']?\s*[:=]\s*(\d+)/i);
    if (countMatch?.[1]) {
      return `创建补点击任务（每天 ${countMatch[1]} 次）`;
    }
    return "创建补点击任务";
  }
  return undefined;
}

function extractProcessAction(detail: string): string | undefined {
  const normalized = detail.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const actionMatch = normalized.match(/(?:^|[\s,{])action\s*[:=]\s*["']?([a-z-]+)/i);
  if (actionMatch?.[1]) {
    return actionMatch[1];
  }

  const prefixMatch = normalized.match(/^([a-z-]+)(?:\s*[·\s]|$)/);
  if (prefixMatch?.[1]) {
    return prefixMatch[1];
  }

  return undefined;
}

function resolveBusinessStepFromProcess(detail: string): string | undefined {
  const action = extractProcessAction(detail);
  switch (action) {
    case "poll":
      return LOW_VALUE_PROCESS_POLL_HEARTBEAT_DETAIL;
    case "log":
      return "读取后台任务日志";
    case "list":
      return "检查后台任务会话";
    case "write":
    case "submit":
    case "paste":
    case "send-keys":
      return "向后台任务发送输入";
    case "kill":
      return "终止后台任务";
    default:
      return undefined;
  }
}

function normalizeProgressToolDetail(
  toolNameValue: unknown,
  value: unknown,
): string | undefined {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }

  if (isCommandToolName(toolNameValue)) {
    const businessStep = resolveBusinessStepFromCommand(normalized);
    if (businessStep) {
      return businessStep.slice(0, 120);
    }
    return undefined;
  }

  if (isProcessToolName(toolNameValue)) {
    const businessStep = resolveBusinessStepFromProcess(normalized);
    if (businessStep) {
      return businessStep.slice(0, 120);
    }
    return undefined;
  }

  return normalized.slice(0, 120);
}

function formatProgressToolLine(tool: ProgressToolState): string {
  const marker =
    tool.status === "completed" ? "[OK]"
      : tool.status === "failed" ? "[ERR]"
        : "[RUN]";
  const detail = tool.detail && tool.detail !== tool.name ? tool.detail : undefined;
  return detail ? `${marker} ${tool.name} · ${detail}` : `${marker} ${tool.name}`;
}

export type CreateFeishuReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
  mentionTargets?: MentionTarget[];
  accountId?: string;
  onFirstReplyDispatched?: () => void;
};

export function createFeishuReplyDispatcher(params: CreateFeishuReplyDispatcherParams) {
  const core = getFeishuRuntime();
  const { cfg, agentId, chatId, replyToMessageId, mentionTargets, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  const prefixContext = createReplyPrefixContext({ cfg, agentId });

  let typingState: TypingIndicatorState | null = null;
  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (!replyToMessageId) {
        return;
      }
      typingState = await addTypingIndicator({ cfg, messageId: replyToMessageId, accountId });
    },
    stop: async () => {
      if (!typingState) {
        return;
      }
      await removeTypingIndicator({ cfg, state: typingState, accountId });
      typingState = null;
    },
    onStartError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "start",
        error: err,
      }),
    onStopError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "stop",
        error: err,
      }),
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, "feishu", accountId, {
    fallbackLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "feishu");
  const tableMode = core.channel.text.resolveMarkdownTableMode({ cfg, channel: "feishu" });
  const renderMode = account.config?.renderMode ?? "auto";
  const streamingEnabled = account.config?.streaming !== false && renderMode !== "raw";

  let streaming: FeishuStreamingSession | null = null;
  let streamText = "";
  let lastPartial = "";
  let partialUpdateQueue: Promise<void> = Promise.resolve();
  let streamingStartPromise: Promise<void> | null = null;
  let firstReplyDispatched = false;
  let progressStartedAt = 0;
  let progressLastRenderAt = 0;
  let progressLastRenderedText = "";
  let progressSyntheticId = 0;
  let progressEventCount = 0;
  let partialStreamStarted = false;
  let partialLastUpdatedAt = 0;
  let progressHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let finalReplyDelivered = false;
  const progressToolsById = new Map<string, ProgressToolState>();

  const markFirstReplyDispatched = () => {
    if (firstReplyDispatched) {
      return;
    }
    firstReplyDispatched = true;
    params.onFirstReplyDispatched?.();
  };

  const renderProgressText = (): string => {
    const now = Date.now();
    const elapsedSeconds = progressStartedAt > 0 ? Math.max(0, Math.floor((now - progressStartedAt) / 1000)) : 0;
    const toolStates = Array.from(progressToolsById.values());
    const running = toolStates.filter((tool) => tool.status === "running").length;
    const completed = toolStates.filter((tool) => tool.status === "completed").length;
    const failed = toolStates.filter((tool) => tool.status === "failed").length;
    const recent = toolStates
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, FEISHU_PROGRESS_MAX_LINES);

    const lines: string[] = [
      "⏳ 正在处理请求",
      elapsedSeconds > 0
        ? `已用时 ${elapsedSeconds}s · 进度事件 ${progressEventCount}`
        : "已接收请求，正在启动执行",
      `运行中 ${running} · 已完成 ${completed} · 失败 ${failed}`,
    ];

    if (recent.length > 0) {
      lines.push("", "步骤状态：");
      for (const tool of recent) {
        lines.push(formatProgressToolLine(tool));
      }
    }

    lines.push("", "处理中，完成后会自动发送最终结果。");
    return lines.join("\n");
  };

  const renderNoFinalFallbackText = (): string => {
    const now = Date.now();
    const elapsedSeconds = progressStartedAt > 0 ? Math.max(0, Math.floor((now - progressStartedAt) / 1000)) : 0;
    const toolStates = Array.from(progressToolsById.values());
    const running = toolStates.filter((tool) => tool.status === "running").length;
    const completed = toolStates.filter((tool) => tool.status === "completed").length;
    const failed = toolStates.filter((tool) => tool.status === "failed").length;

    if (running > 0) {
      return `⏳ 任务仍在后台执行（已用时 ${elapsedSeconds}s，运行中 ${running}，已完成 ${completed}，失败 ${failed}）。请继续等待，我会自动回传最终结果。`;
    }
    if (failed > 0) {
      return `⚠️ 本轮执行已结束，但存在失败步骤（已用时 ${elapsedSeconds}s，已完成 ${completed}，失败 ${failed}）。可发送“继续”查看详情。`;
    }
    return `✅ 本轮执行已结束（已用时 ${elapsedSeconds}s，已完成 ${completed}）。如暂未看到完整总结，可发送“继续”获取结果。`;
  };

  const shouldSuppressProgressRender = (now: number): boolean => {
    if (!partialStreamStarted) return false;
    if (partialLastUpdatedAt <= 0) return false;
    return now - partialLastUpdatedAt < FEISHU_PARTIAL_PROGRESS_SUPPRESS_MS;
  };

  const pushProgressUpdate = async (force = false): Promise<void> => {
    if (!streamingEnabled) {
      return;
    }

    const now = Date.now();
    if (shouldSuppressProgressRender(now)) {
      return;
    }
    if (!force && now - progressLastRenderAt < FEISHU_PROGRESS_RENDER_THROTTLE_MS) {
      return;
    }

    startStreaming();
    if (streamingStartPromise) {
      await streamingStartPromise;
    }
    if (!streaming?.isActive()) {
      return;
    }
    if (shouldSuppressProgressRender(Date.now())) {
      return;
    }

    const progressText = renderProgressText();
    if (progressText === progressLastRenderedText) {
      return;
    }

    streamText = progressText;
    progressLastRenderedText = progressText;
    await streaming.update(streamText);
    progressLastRenderAt = now;
    markFirstReplyDispatched();
  };

  const startStreaming = () => {
    if (!streamingEnabled || streamingStartPromise || streaming) {
      return;
    }
    streamingStartPromise = (async () => {
      const creds =
        account.appId && account.appSecret
          ? { appId: account.appId, appSecret: account.appSecret, domain: account.domain }
          : null;
      if (!creds) {
        return;
      }

      streaming = new FeishuStreamingSession(createFeishuClient(account), creds, (message) =>
        params.runtime.log?.(`feishu[${account.accountId}] ${message}`),
      );
      try {
        await streaming.start(chatId, resolveReceiveIdType(chatId));
      } catch (error) {
        params.runtime.error?.(`feishu: streaming start failed: ${String(error)}`);
        streaming = null;
      }
    })();
  };

  const closeStreaming = async () => {
    if (streamingStartPromise) {
      await streamingStartPromise;
    }
    await partialUpdateQueue;
    if (streaming?.isActive()) {
      let text = streamText;
      if (mentionTargets?.length) {
        text = buildMentionedCardContent(mentionTargets, text);
      }
      await streaming.close(text);
    }
    streaming = null;
    streamingStartPromise = null;
    streamText = "";
    lastPartial = "";
    progressLastRenderedText = "";
    partialStreamStarted = false;
    partialLastUpdatedAt = 0;
    if (progressHeartbeatTimer) {
      clearInterval(progressHeartbeatTimer);
      progressHeartbeatTimer = null;
    }
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: () => {
        if (streamingEnabled && renderMode === "card") {
          startStreaming();
        }
        void typingCallbacks.onReplyStart?.();
      },
      deliver: async (payload: ReplyPayload, info) => {
        const text = payload.text ?? "";
        if (!text.trim()) {
          return;
        }

        const useCard = renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));

        if ((info?.kind === "block" || info?.kind === "final") && streamingEnabled && useCard) {
          startStreaming();
          if (streamingStartPromise) {
            await streamingStartPromise;
          }
        }

        if (streaming?.isActive()) {
          if (info?.kind === "final") {
            finalReplyDelivered = true;
            streamText = text;
            await closeStreaming();
            markFirstReplyDispatched();
          }
          return;
        }

        let first = true;
        if (useCard) {
          for (const chunk of core.channel.text.chunkTextWithMode(
            text,
            textChunkLimit,
            chunkMode,
          )) {
            await sendMarkdownCardFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: first ? mentionTargets : undefined,
              accountId,
            });
            if (first) {
              markFirstReplyDispatched();
            }
            first = false;
          }
        } else {
          const converted = core.channel.text.convertMarkdownTables(text, tableMode);
          for (const chunk of core.channel.text.chunkTextWithMode(
            converted,
            textChunkLimit,
            chunkMode,
          )) {
            await sendMessageFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: first ? mentionTargets : undefined,
              accountId,
            });
            if (first) {
              markFirstReplyDispatched();
            }
            first = false;
          }
        }
        if (info?.kind === "final") {
          finalReplyDelivered = true;
        }
      },
      onError: async (error, info) => {
        params.runtime.error?.(
          `feishu[${account.accountId}] ${info.kind} reply failed: ${String(error)}`,
        );
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onIdle: async () => {
        if (streaming?.isActive() && !finalReplyDelivered && progressEventCount > 0) {
          streamText = renderNoFinalFallbackText();
        }
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onCleanup: () => {
        typingCallbacks.onCleanup?.();
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
      onAgentEvent: streamingEnabled
        ? async (evt: AgentEventEnvelope) => {
            const stream = String(evt?.stream || "").trim().toLowerCase();
            const data = (evt?.data && typeof evt.data === "object" ? evt.data : {}) as Record<
              string,
              unknown
            >;

            if (stream === "lifecycle") {
              const phase = String(data.phase || "").trim().toLowerCase();
              if (phase === "start" && progressStartedAt <= 0) {
                progressStartedAt = Date.now();
                await pushProgressUpdate(true);
              }
              if (phase === "error" || phase === "end") {
                await pushProgressUpdate(true);
              }
              return;
            }

            if (stream !== "tool") {
              return;
            }

            const phase = String(data.phase || "").trim().toLowerCase();
            const rawToolName = String(data.name || "").trim();
            const rawToolCallId = String(data.toolCallId || data.tool_call_id || "").trim();
            const toolCallId = rawToolCallId || `synthetic_${++progressSyntheticId}`;
            const now = Date.now();

            if (progressStartedAt <= 0) {
              progressStartedAt = now;
            }

            const toolDetail = normalizeProgressToolDetail(rawToolName, data.meta);
            const isLowValueCommandEvent = isCommandToolName(rawToolName) && !toolDetail;
            const isLowValueProcessPollEvent =
              isProcessToolName(rawToolName) &&
              toolDetail === LOW_VALUE_PROCESS_POLL_HEARTBEAT_DETAIL;
            const progressToolCallId = isLowValueCommandEvent || isLowValueProcessPollEvent
              ? LOW_VALUE_COMMAND_HEARTBEAT_ID
              : toolCallId;
            const previous = progressToolsById.get(progressToolCallId);
            const toolName = normalizeProgressToolName(rawToolName);
            const status: ProgressToolStatus =
              phase === "result"
                ? (Boolean(data.isError) ? "failed" : "completed")
                : "running";

            progressToolsById.set(progressToolCallId, {
              toolCallId: progressToolCallId,
              name: toolName || previous?.name || "tool",
              detail:
                toolDetail
                || (isLowValueCommandEvent ? LOW_VALUE_COMMAND_HEARTBEAT_DETAIL : undefined)
                || (isLowValueProcessPollEvent ? LOW_VALUE_PROCESS_POLL_HEARTBEAT_DETAIL : undefined)
                || previous?.detail,
              status,
              updatedAt: now,
            });
            progressEventCount += 1;

            await pushProgressUpdate(phase === "start" || phase === "result");
          }
        : undefined,
      onPartialReply: streamingEnabled
        ? (payload: ReplyPayload) => {
            if (!payload.text || payload.text === lastPartial) {
              return;
            }
            partialStreamStarted = true;
            partialLastUpdatedAt = Date.now();
            if (!progressHeartbeatTimer) {
              progressHeartbeatTimer = setInterval(() => {
                if (!streamingEnabled || finalReplyDelivered) {
                  return;
                }
                void pushProgressUpdate(true);
              }, FEISHU_PARTIAL_PROGRESS_HEARTBEAT_MS);
              progressHeartbeatTimer.unref?.();
            }
            lastPartial = payload.text;
            streamText = payload.text;
            partialUpdateQueue = partialUpdateQueue.then(async () => {
              if (streamingStartPromise) {
                await streamingStartPromise;
              }
              if (streaming?.isActive()) {
                await streaming.update(streamText);
                markFirstReplyDispatched();
              }
            });
          }
        : undefined,
    },
    markDispatchIdle,
  };
}
