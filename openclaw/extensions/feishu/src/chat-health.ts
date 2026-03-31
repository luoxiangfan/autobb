import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";

export type FeishuChatHealthDecision = "allowed" | "blocked" | "error";

export type FeishuChatHealthReportInput = {
  cfg: ClawdbotConfig;
  accountId: string;
  accountConfig?: Record<string, unknown>;
  runtime?: RuntimeEnv;
  messageId?: string;
  chatId?: string;
  chatType?: string;
  messageType?: string;
  senderPrimaryId?: string;
  senderOpenId?: string;
  senderUnionId?: string;
  senderUserId?: string;
  senderCandidates?: string[];
  decision: FeishuChatHealthDecision;
  reasonCode: string;
  reasonMessage?: string;
  messageText?: string;
  metadata?: Record<string, unknown>;
  tenantKey?: string;
};

const DEFAULT_INGEST_TIMEOUT_MS = 2500;
const warnedMissingUrl = new Set<string>();
const warnedMissingToken = new Set<string>();

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function resolveTimeoutMs(): number {
  return Math.max(
    500,
    Math.min(10_000, parsePositiveInt(process.env.OPENCLAW_FEISHU_CHAT_HEALTH_TIMEOUT_MS, DEFAULT_INGEST_TIMEOUT_MS)),
  );
}

function deriveIngestUrlFromConfirmUrl(confirmUrl: string): string | undefined {
  try {
    const url = new URL(confirmUrl);
    url.pathname = "/api/openclaw/feishu/chat-health/ingest";
    url.search = "";
    return url.toString();
  } catch {
    if (confirmUrl.startsWith("/")) {
      return confirmUrl.replace(
        /\/api\/openclaw\/commands\/confirm\/?$/i,
        "/api/openclaw/feishu/chat-health/ingest",
      );
    }
    return undefined;
  }
}

function resolveIngestUrl(input: FeishuChatHealthReportInput): string | undefined {
  const explicitUrl = readString(process.env.OPENCLAW_FEISHU_CHAT_HEALTH_INGEST_URL);
  if (explicitUrl) {
    return explicitUrl;
  }

  const accountConfig = input.accountConfig || {};
  const confirmUrl =
    readString((accountConfig as { cardConfirmUrl?: unknown }).cardConfirmUrl) ||
    readString(process.env.OPENCLAW_CARD_CONFIRM_URL);
  if (confirmUrl) {
    const derived = deriveIngestUrlFromConfirmUrl(confirmUrl);
    if (derived) {
      return derived;
    }
  }

  const baseUrl =
    readString(process.env.OPENCLAW_INTERNAL_BASE_URL) ||
    readString(process.env.INTERNAL_APP_URL) ||
    readString(process.env.OPENCLAW_PUBLIC_BASE_URL) ||
    readString(process.env.NEXT_PUBLIC_APP_URL);
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, "")}/api/openclaw/feishu/chat-health/ingest`;
  }

  const port = readString(process.env.PORT) || "3000";
  return `http://127.0.0.1:${port}/api/openclaw/feishu/chat-health/ingest`;
}

function resolveIngestAuthToken(input: FeishuChatHealthReportInput): string | undefined {
  const gatewayAuth = input.cfg.gateway?.auth;
  const accountConfig = input.accountConfig || {};

  return (
    readString((accountConfig as { cardConfirmAuthToken?: unknown }).cardConfirmAuthToken) ||
    readString(process.env.OPENCLAW_CARD_CONFIRM_TOKEN) ||
    readString(process.env.OPENCLAW_GATEWAY_TOKEN) ||
    readString(process.env.OPENCLAW_TOKEN) ||
    readString(gatewayAuth?.token) ||
    readString(gatewayAuth?.password)
  );
}

function isTestEnv(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

function logWarn(input: FeishuChatHealthReportInput, message: string) {
  if (input.runtime?.log) {
    input.runtime.log(message);
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(message);
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
  const text = readString(value);
  if (!text) return undefined;
  return text.slice(0, maxLength);
}

function normalizeSenderCandidates(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((entry) => readString(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ).slice(0, 20);
}

export async function reportFeishuChatHealth(input: FeishuChatHealthReportInput): Promise<void> {
  if (isTestEnv()) {
    return;
  }

  const ingestUrl = resolveIngestUrl(input);
  const warningKey = input.accountId || "unknown";
  if (!ingestUrl) {
    if (!warnedMissingUrl.has(warningKey)) {
      warnedMissingUrl.add(warningKey);
      logWarn(
        input,
        `[feishu:${warningKey}] chat-health ingest url unresolved, skip reporting`,
      );
    }
    return;
  }

  const authToken = resolveIngestAuthToken(input);
  if (!authToken) {
    if (!warnedMissingToken.has(warningKey)) {
      warnedMissingToken.add(warningKey);
      logWarn(
        input,
        `[feishu:${warningKey}] chat-health ingest auth token unresolved, skip reporting`,
      );
    }
    return;
  }

  const timeoutMs = resolveTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
        "x-openclaw-channel": "feishu",
        "x-openclaw-sender": input.senderOpenId || input.senderPrimaryId || "",
        "x-openclaw-account-id": input.accountId,
      },
      body: JSON.stringify({
        accountId: normalizeText(input.accountId, 120) || "unknown",
        messageId: normalizeText(input.messageId, 160),
        chatId: normalizeText(input.chatId, 160),
        chatType: normalizeText(input.chatType, 32),
        messageType: normalizeText(input.messageType, 32),
        senderPrimaryId: normalizeText(input.senderPrimaryId, 255),
        senderOpenId: normalizeText(input.senderOpenId, 255),
        senderUnionId: normalizeText(input.senderUnionId, 255),
        senderUserId: normalizeText(input.senderUserId, 255),
        senderCandidates: normalizeSenderCandidates(input.senderCandidates),
        decision: input.decision,
        reasonCode: normalizeText(input.reasonCode, 120),
        reasonMessage: normalizeText(input.reasonMessage, 500),
        messageText: normalizeText(input.messageText, 20_000),
        tenantKey: normalizeText(input.tenantKey, 255),
        metadata: input.metadata || undefined,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const bodyPreview = body.length > 180 ? `${body.slice(0, 180)}...` : body;
      logWarn(
        input,
        `[feishu:${warningKey}] chat-health ingest failed (${response.status}): ${bodyPreview || "empty"}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(input, `[feishu:${warningKey}] chat-health ingest error: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
