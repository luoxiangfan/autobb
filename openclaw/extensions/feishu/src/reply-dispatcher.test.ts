import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveFeishuAccountMock = vi.hoisted(() => vi.fn());
const getFeishuRuntimeMock = vi.hoisted(() => vi.fn());
const sendMessageFeishuMock = vi.hoisted(() => vi.fn());
const sendMarkdownCardFeishuMock = vi.hoisted(() => vi.fn());
const createFeishuClientMock = vi.hoisted(() => vi.fn());
const resolveReceiveIdTypeMock = vi.hoisted(() => vi.fn());
const createReplyDispatcherWithTypingMock = vi.hoisted(() => vi.fn());
const streamingInstances = vi.hoisted(() => [] as any[]);

vi.mock("./accounts.js", () => ({ resolveFeishuAccount: resolveFeishuAccountMock }));
vi.mock("./runtime.js", () => ({ getFeishuRuntime: getFeishuRuntimeMock }));
vi.mock("./send.js", () => ({
  sendMessageFeishu: sendMessageFeishuMock,
  sendMarkdownCardFeishu: sendMarkdownCardFeishuMock,
}));
vi.mock("./client.js", () => ({ createFeishuClient: createFeishuClientMock }));
vi.mock("./targets.js", () => ({ resolveReceiveIdType: resolveReceiveIdTypeMock }));
vi.mock("./streaming-card.js", () => ({
  FeishuStreamingSession: class {
    active = false;
    start = vi.fn(async () => {
      this.active = true;
    });
    update = vi.fn(async () => {});
    close = vi.fn(async () => {
      this.active = false;
    });
    isActive = vi.fn(() => this.active);

    constructor() {
      streamingInstances.push(this);
    }
  },
}));

import { createFeishuReplyDispatcher } from "./reply-dispatcher.js";

describe("createFeishuReplyDispatcher streaming behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamingInstances.length = 0;

    resolveFeishuAccountMock.mockReturnValue({
      accountId: "main",
      appId: "app_id",
      appSecret: "app_secret",
      domain: "feishu",
      config: {
        renderMode: "auto",
        streaming: true,
      },
    });

    resolveReceiveIdTypeMock.mockReturnValue("chat_id");
    createFeishuClientMock.mockReturnValue({});

    createReplyDispatcherWithTypingMock.mockImplementation((opts) => ({
      dispatcher: {},
      replyOptions: {},
      markDispatchIdle: vi.fn(),
      _opts: opts,
    }));

    getFeishuRuntimeMock.mockReturnValue({
      channel: {
        text: {
          resolveTextChunkLimit: vi.fn(() => 4000),
          resolveChunkMode: vi.fn(() => "line"),
          resolveMarkdownTableMode: vi.fn(() => "preserve"),
          convertMarkdownTables: vi.fn((text) => text),
          chunkTextWithMode: vi.fn((text) => [text]),
        },
        reply: {
          createReplyDispatcherWithTyping: createReplyDispatcherWithTypingMock,
          resolveHumanDelayConfig: vi.fn(() => undefined),
        },
      },
    });
  });

  it("keeps auto mode plain text on non-streaming send path", async () => {
    createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: {} as never,
      chatId: "oc_chat",
    });

    const options = createReplyDispatcherWithTypingMock.mock.calls[0]?.[0];
    await options.deliver({ text: "plain text" }, { kind: "final" });

    expect(streamingInstances).toHaveLength(0);
    expect(sendMessageFeishuMock).toHaveBeenCalledTimes(1);
    expect(sendMarkdownCardFeishuMock).not.toHaveBeenCalled();
  });

  it("uses streaming session for auto mode markdown payloads", async () => {
    createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: { log: vi.fn(), error: vi.fn() } as never,
      chatId: "oc_chat",
    });

    const options = createReplyDispatcherWithTypingMock.mock.calls[0]?.[0];
    await options.deliver({ text: "```ts\nconst x = 1\n```" }, { kind: "final" });

    expect(streamingInstances).toHaveLength(1);
    expect(streamingInstances[0].start).toHaveBeenCalledTimes(1);
    expect(streamingInstances[0].close).toHaveBeenCalledTimes(1);
    expect(sendMessageFeishuMock).not.toHaveBeenCalled();
    expect(sendMarkdownCardFeishuMock).not.toHaveBeenCalled();
  });

  it("updates a single streaming card from agent progress events", async () => {
    const onFirstReplyDispatched = vi.fn();
    const { replyOptions } = createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: { log: vi.fn(), error: vi.fn() } as never,
      chatId: "oc_chat",
      onFirstReplyDispatched,
    });

    await replyOptions.onAgentEvent?.({ stream: "lifecycle", data: { phase: "start" } });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: { phase: "start", name: "create_offer", toolCallId: "tool-1" },
    });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: { phase: "result", name: "create_offer", toolCallId: "tool-1", isError: false },
    });

    expect(streamingInstances).toHaveLength(1);
    expect(streamingInstances[0].start).toHaveBeenCalledTimes(1);
    expect(streamingInstances[0].update).toHaveBeenCalled();
    const lastUpdateText = streamingInstances[0].update.mock.calls.at(-1)?.[0];
    expect(String(lastUpdateText)).toContain("[OK] create_offer");
    expect(onFirstReplyDispatched).toHaveBeenCalledTimes(1);
  });

  it("renders readable exec step label with detail metadata", async () => {
    const { replyOptions } = createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: { log: vi.fn(), error: vi.fn() } as never,
      chatId: "oc_chat",
    });

    await replyOptions.onAgentEvent?.({ stream: "lifecycle", data: { phase: "start" } });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: { phase: "start", name: "exec", toolCallId: "tool-1" },
    });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "tool-1",
        isError: false,
        meta: "POST /api/offers/3639/generate-creatives-queue bucket=A",
      },
    });

    const lastUpdateText = streamingInstances[0].update.mock.calls.at(-1)?.[0];
    expect(String(lastUpdateText)).toContain("[OK] 执行操作");
    expect(String(lastUpdateText)).toContain("生成第 1 个创意（A桶）");
  });

  it("aggregates low-value exec command steps as heartbeat progress", async () => {
    const { replyOptions } = createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: { log: vi.fn(), error: vi.fn() } as never,
      chatId: "oc_chat",
    });

    await replyOptions.onAgentEvent?.({ stream: "lifecycle", data: { phase: "start" } });
    expect(streamingInstances).toHaveLength(1);

    const updateCountBefore = streamingInstances[0].update.mock.calls.length;
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: { phase: "start", name: "exec", toolCallId: "tool-sleep", meta: "sleep 30" },
    });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "tool-sleep",
        isError: false,
        meta: "sleep 30",
      },
    });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: {
        phase: "start",
        name: "exec",
        toolCallId: "tool-poll",
        meta: "poll interval=8s",
      },
    });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "tool-poll",
        isError: false,
        meta: "poll interval=8s",
      },
    });

    const updateCountAfter = streamingInstances[0].update.mock.calls.length;
    expect(updateCountAfter).toBeGreaterThan(updateCountBefore);

    const lastUpdateText = streamingInstances[0].update.mock.calls.at(-1)?.[0];
    expect(String(lastUpdateText)).toContain("执行操作");
    expect(String(lastUpdateText)).toContain("后台轮询中");
    expect(String(lastUpdateText)).not.toContain("sleep 30");
    expect(String(lastUpdateText)).not.toContain("poll interval=8s");
  });

  it("normalizes process poll progress as user-friendly heartbeat text", async () => {
    const { replyOptions } = createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: { log: vi.fn(), error: vi.fn() } as never,
      chatId: "oc_chat",
    });

    await replyOptions.onAgentEvent?.({ stream: "lifecycle", data: { phase: "start" } });
    expect(streamingInstances).toHaveLength(1);

    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: {
        phase: "start",
        name: "process",
        toolCallId: "tool-poll-1",
        meta: "poll · calm-bison",
      },
    });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: {
        phase: "result",
        name: "process",
        toolCallId: "tool-poll-1",
        isError: false,
        meta: "poll · calm-bison",
      },
    });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: {
        phase: "start",
        name: "process",
        toolCallId: "tool-poll-2",
        meta: "action:poll sessionId:marine-otter",
      },
    });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: {
        phase: "result",
        name: "process",
        toolCallId: "tool-poll-2",
        isError: false,
        meta: "action:poll sessionId:marine-otter",
      },
    });

    const lastUpdateText = streamingInstances[0].update.mock.calls.at(-1)?.[0];
    expect(String(lastUpdateText)).toContain("后台任务");
    expect(String(lastUpdateText)).toContain("后台任务状态同步中");
    expect(String(lastUpdateText)).not.toContain("calm-bison");
    expect(String(lastUpdateText)).not.toContain("marine-otter");
    expect(String(lastUpdateText)).not.toContain("action:poll");
  });

  it("stops progress-card updates after partial reply stream starts", async () => {
    const { replyOptions } = createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: { log: vi.fn(), error: vi.fn() } as never,
      chatId: "oc_chat",
    });

    await replyOptions.onAgentEvent?.({ stream: "lifecycle", data: { phase: "start" } });
    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: { phase: "start", name: "create_offer", toolCallId: "tool-1" },
    });
    expect(streamingInstances).toHaveLength(1);

    const updateCountBeforePartial = streamingInstances[0].update.mock.calls.length;
    replyOptions.onPartialReply?.({ text: "正在生成最终结果..." });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const updateCountAfterPartial = streamingInstances[0].update.mock.calls.length;
    expect(updateCountAfterPartial).toBeGreaterThanOrEqual(updateCountBeforePartial);
    const partialUpdateText = streamingInstances[0].update.mock.calls.at(-1)?.[0];
    expect(String(partialUpdateText)).toContain("正在生成最终结果...");

    await replyOptions.onAgentEvent?.({
      stream: "tool",
      data: { phase: "result", name: "create_offer", toolCallId: "tool-1", isError: false },
    });
    expect(streamingInstances[0].update.mock.calls.length).toBe(updateCountAfterPartial);

    const lastUpdateText = streamingInstances[0].update.mock.calls.at(-1)?.[0];
    expect(String(lastUpdateText)).toContain("正在生成最终结果...");
  });

  it("resumes progress updates when partial stream stalls", async () => {
    vi.useFakeTimers();
    try {
      const { replyOptions } = createFeishuReplyDispatcher({
        cfg: {} as never,
        agentId: "agent",
        runtime: { log: vi.fn(), error: vi.fn() } as never,
        chatId: "oc_chat",
      });

      await replyOptions.onAgentEvent?.({ stream: "lifecycle", data: { phase: "start" } });
      await replyOptions.onAgentEvent?.({
        stream: "tool",
        data: { phase: "start", name: "create_offer", toolCallId: "tool-1" },
      });

      replyOptions.onPartialReply?.({ text: "Both Bucket B tasks are at 35%." });
      await vi.runAllTicks();
      const updateCountAfterPartial = streamingInstances[0].update.mock.calls.length;

      await vi.advanceTimersByTimeAsync(6500);
      await vi.runAllTicks();

      expect(streamingInstances[0].update.mock.calls.length).toBeGreaterThan(updateCountAfterPartial);
      const lastUpdateText = streamingInstances[0].update.mock.calls.at(-1)?.[0];
      expect(String(lastUpdateText)).toContain("正在处理请求");
    } finally {
      vi.useRealTimers();
    }
  });
});
