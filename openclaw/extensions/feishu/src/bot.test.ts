import type { ClawdbotConfig, PluginRuntime, RuntimeEnv } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeishuMessageEvent } from "./bot.js";
import { handleFeishuMessage } from "./bot.js";
import { setFeishuRuntime } from "./runtime.js";

const { mockCreateFeishuReplyDispatcher, mockSendMessageFeishu, mockGetMessageFeishu } = vi.hoisted(
  () => ({
    mockCreateFeishuReplyDispatcher: vi.fn(() => ({
      dispatcher: vi.fn(),
      replyOptions: {},
      markDispatchIdle: vi.fn(),
    })),
    mockSendMessageFeishu: vi.fn().mockResolvedValue({ messageId: "pairing-msg", chatId: "oc-dm" }),
    mockGetMessageFeishu: vi.fn().mockResolvedValue(null),
  }),
);

vi.mock("./reply-dispatcher.js", () => ({
  createFeishuReplyDispatcher: mockCreateFeishuReplyDispatcher,
}));

vi.mock("./send.js", () => ({
  sendMessageFeishu: mockSendMessageFeishu,
  getMessageFeishu: mockGetMessageFeishu,
}));

describe("handleFeishuMessage command authorization", () => {
  const mockFinalizeInboundContext = vi.fn((ctx: unknown) => ctx);
  const mockDispatchReplyFromConfig = vi
    .fn()
    .mockResolvedValue({ queuedFinal: false, counts: { final: 1 } });
  const mockResolveCommandAuthorizedFromAuthorizers = vi.fn(() => false);
  const mockShouldComputeCommandAuthorized = vi.fn(() => true);
  const mockReadAllowFromStore = vi.fn().mockResolvedValue([]);
  const mockUpsertPairingRequest = vi.fn().mockResolvedValue({ code: "ABCDEFGH", created: false });
  const mockBuildPairingReply = vi.fn(() => "Pairing response");

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENCLAW_FEISHU_SLOW_REPLY_NOTICE_SECONDS;
    setFeishuRuntime({
      system: {
        enqueueSystemEvent: vi.fn(),
      },
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(() => ({
            agentId: "main",
            accountId: "default",
            sessionKey: "agent:main:feishu:dm:ou-attacker",
            matchedBy: "default",
          })),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({ template: "channel+name+time" })),
          formatAgentEnvelope: vi.fn((params: { body: string }) => params.body),
          finalizeInboundContext: mockFinalizeInboundContext,
          dispatchReplyFromConfig: mockDispatchReplyFromConfig,
        },
        commands: {
          shouldComputeCommandAuthorized: mockShouldComputeCommandAuthorized,
          resolveCommandAuthorizedFromAuthorizers: mockResolveCommandAuthorizedFromAuthorizers,
        },
        pairing: {
          readAllowFromStore: mockReadAllowFromStore,
          upsertPairingRequest: mockUpsertPairingRequest,
          buildPairingReply: mockBuildPairingReply,
        },
      },
    } as unknown as PluginRuntime);
  });

  it("uses authorizer resolution instead of hardcoded CommandAuthorized=true", async () => {
    const cfg: ClawdbotConfig = {
      commands: { useAccessGroups: true },
      channels: {
        feishu: {
          dmPolicy: "open",
          allowFrom: ["ou-admin"],
        },
      },
    } as ClawdbotConfig;

    const event: FeishuMessageEvent = {
      sender: {
        sender_id: {
          open_id: "ou-attacker",
        },
      },
      message: {
        message_id: "msg-auth-bypass-regression",
        chat_id: "oc-dm",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "/status" }),
      },
    };

    await handleFeishuMessage({
      cfg,
      event,
      runtime: { log: vi.fn(), error: vi.fn() } as RuntimeEnv,
    });

    expect(mockResolveCommandAuthorizedFromAuthorizers).toHaveBeenCalledWith({
      useAccessGroups: true,
      authorizers: [{ configured: true, allowed: false }],
    });
    expect(mockFinalizeInboundContext).toHaveBeenCalledTimes(1);
    expect(mockFinalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        CommandAuthorized: false,
        SenderId: "ou-attacker",
        Surface: "feishu",
      }),
    );
  });

  it("reads pairing allow store for non-command DMs when dmPolicy is pairing", async () => {
    mockShouldComputeCommandAuthorized.mockReturnValue(false);
    mockReadAllowFromStore.mockResolvedValue(["ou-attacker"]);

    const cfg: ClawdbotConfig = {
      commands: { useAccessGroups: true },
      channels: {
        feishu: {
          dmPolicy: "pairing",
          allowFrom: [],
        },
      },
    } as ClawdbotConfig;

    const event: FeishuMessageEvent = {
      sender: {
        sender_id: {
          open_id: "ou-attacker",
        },
      },
      message: {
        message_id: "msg-read-store-non-command",
        chat_id: "oc-dm",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello there" }),
      },
    };

    await handleFeishuMessage({
      cfg,
      event,
      runtime: { log: vi.fn(), error: vi.fn() } as RuntimeEnv,
    });

    expect(mockReadAllowFromStore).toHaveBeenCalledWith("feishu");
    expect(mockResolveCommandAuthorizedFromAuthorizers).not.toHaveBeenCalled();
    expect(mockFinalizeInboundContext).toHaveBeenCalledTimes(1);
    expect(mockDispatchReplyFromConfig).toHaveBeenCalledTimes(1);
  });

  it("creates pairing request and drops unauthorized DMs in pairing mode", async () => {
    mockShouldComputeCommandAuthorized.mockReturnValue(false);
    mockReadAllowFromStore.mockResolvedValue([]);
    mockUpsertPairingRequest.mockResolvedValue({ code: "ABCDEFGH", created: true });

    const cfg: ClawdbotConfig = {
      channels: {
        feishu: {
          dmPolicy: "pairing",
          allowFrom: [],
        },
      },
    } as ClawdbotConfig;

    const event: FeishuMessageEvent = {
      sender: {
        sender_id: {
          open_id: "ou-unapproved",
        },
      },
      message: {
        message_id: "msg-pairing-flow",
        chat_id: "oc-dm",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    };

    await handleFeishuMessage({
      cfg,
      event,
      runtime: { log: vi.fn(), error: vi.fn() } as RuntimeEnv,
    });

    expect(mockUpsertPairingRequest).toHaveBeenCalledWith({
      channel: "feishu",
      id: "ou-unapproved",
      meta: { name: undefined },
    });
    expect(mockBuildPairingReply).toHaveBeenCalledWith({
      channel: "feishu",
      idLine: "Your Feishu user id: ou-unapproved",
      code: "ABCDEFGH",
    });
    expect(mockSendMessageFeishu).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user:ou-unapproved",
        accountId: "default",
      }),
    );
    expect(mockFinalizeInboundContext).not.toHaveBeenCalled();
    expect(mockDispatchReplyFromConfig).not.toHaveBeenCalled();
  });

  it("computes group command authorization from group allowFrom", async () => {
    mockShouldComputeCommandAuthorized.mockReturnValue(true);
    mockResolveCommandAuthorizedFromAuthorizers.mockReturnValue(false);

    const cfg: ClawdbotConfig = {
      commands: { useAccessGroups: true },
      channels: {
        feishu: {
          groups: {
            "oc-group": {
              requireMention: false,
            },
          },
        },
      },
    } as ClawdbotConfig;

    const event: FeishuMessageEvent = {
      sender: {
        sender_id: {
          open_id: "ou-attacker",
        },
      },
      message: {
        message_id: "msg-group-command-auth",
        chat_id: "oc-group",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "/status" }),
      },
    };

    await handleFeishuMessage({
      cfg,
      event,
      runtime: { log: vi.fn(), error: vi.fn() } as RuntimeEnv,
    });

    expect(mockResolveCommandAuthorizedFromAuthorizers).toHaveBeenCalledWith({
      useAccessGroups: true,
      authorizers: [{ configured: false, allowed: false }],
    });
    expect(mockFinalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        ChatType: "group",
        CommandAuthorized: false,
        SenderId: "ou-attacker",
      }),
    );
  });

  it("sends delayed in-progress notice when dispatch takes too long", async () => {
    vi.useFakeTimers();
    process.env.OPENCLAW_FEISHU_SLOW_REPLY_NOTICE_SECONDS = "1";

    let resolveDispatch!: (value: { queuedFinal: boolean; counts: { final: number } }) => void;
    mockDispatchReplyFromConfig.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDispatch = resolve;
        }),
    );

    const cfg: ClawdbotConfig = {
      channels: {
        feishu: {
          dmPolicy: "open",
        },
      },
    } as ClawdbotConfig;

    const event: FeishuMessageEvent = {
      sender: {
        sender_id: {
          open_id: "ou-slow-notice",
        },
      },
      message: {
        message_id: "msg-slow-notice",
        chat_id: "oc-dm",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "run long task" }),
      },
    };

    const pending = handleFeishuMessage({
      cfg,
      event,
      runtime: { log: vi.fn(), error: vi.fn() } as RuntimeEnv,
    });

    // Runtime clamps slow-notice delay to >= 5s.
    await vi.advanceTimersByTimeAsync(5200);

    expect(mockSendMessageFeishu).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "oc-dm",
        replyToMessageId: "msg-slow-notice",
      }),
    );

    resolveDispatch({ queuedFinal: false, counts: { final: 1 } });
    await pending;
    vi.useRealTimers();
  });

  it("cancels delayed in-progress notice once first reply starts", async () => {
    vi.useFakeTimers();
    process.env.OPENCLAW_FEISHU_SLOW_REPLY_NOTICE_SECONDS = "1";

    let resolveDispatch!: (value: { queuedFinal: boolean; counts: { final: number } }) => void;
    mockDispatchReplyFromConfig.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDispatch = resolve;
        }),
    );

    let onFirstReplyDispatched: (() => void) | undefined;
    mockCreateFeishuReplyDispatcher.mockImplementationOnce((params: { onFirstReplyDispatched?: () => void }) => {
      onFirstReplyDispatched = params.onFirstReplyDispatched;
      return {
        dispatcher: vi.fn(),
        replyOptions: {},
        markDispatchIdle: vi.fn(),
      };
    });

    const cfg: ClawdbotConfig = {
      channels: {
        feishu: {
          dmPolicy: "open",
        },
      },
    } as ClawdbotConfig;

    const event: FeishuMessageEvent = {
      sender: {
        sender_id: {
          open_id: "ou-slow-cancel",
        },
      },
      message: {
        message_id: "msg-slow-cancel",
        chat_id: "oc-dm",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "run long task quickly starts output" }),
      },
    };

    const pending = handleFeishuMessage({
      cfg,
      event,
      runtime: { log: vi.fn(), error: vi.fn() } as RuntimeEnv,
    });

    onFirstReplyDispatched?.();
    await vi.advanceTimersByTimeAsync(1200);

    expect(mockSendMessageFeishu).not.toHaveBeenCalledWith(
      expect.objectContaining({
        replyToMessageId: "msg-slow-cancel",
      }),
    );

    resolveDispatch({ queuedFinal: false, counts: { final: 1 } });
    await pending;
    vi.useRealTimers();
  });
});
