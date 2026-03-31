import { describe, expect, it } from "vitest";
import type { TemplateContext } from "../templating.js";
import { buildInboundMetaSystemPrompt, buildInboundUserContextPrefix } from "./inbound-meta.js";

function extractPayload(prompt: string): Record<string, unknown> {
  const match = prompt.match(/```json\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("Failed to extract inbound-meta JSON payload");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function extractConversationInfo(text: string): Record<string, unknown> {
  const match = text.match(/Conversation info \(untrusted metadata\):\n```json\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("Failed to extract conversation info JSON payload");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("buildInboundMetaSystemPrompt", () => {
  it("includes trusted routing identity metadata", () => {
    const prompt = buildInboundMetaSystemPrompt({
      OriginatingChannel: "feishu",
      Provider: "feishu",
      Surface: "feishu",
      AccountId: "user-1",
      SenderId: "ou_sender",
      TenantKey: "tenant-demo",
      ChatType: "direct",
    } as TemplateContext);

    const payload = extractPayload(prompt);
    expect(payload.channel).toBe("feishu");
    expect(payload.account_id).toBe("user-1");
    expect(payload.sender_id).toBe("ou_sender");
    expect(payload.tenant_key).toBe("tenant-demo");
  });

  it("omits tenant_key when not provided", () => {
    const prompt = buildInboundMetaSystemPrompt({
      OriginatingChannel: "feishu",
      Provider: "feishu",
      Surface: "feishu",
      AccountId: "user-1",
      SenderId: "ou_sender",
      ChatType: "direct",
    } as TemplateContext);

    const payload = extractPayload(prompt);
    expect(payload).not.toHaveProperty("tenant_key");
  });

  it("includes message and reply identifiers for trusted routing", () => {
    const prompt = buildInboundMetaSystemPrompt({
      MessageSid: "msg_short",
      MessageSidFull: "msg_full_provider",
      ReplyToId: "msg_parent",
      OriginatingTo: "oc_chat1",
      OriginatingChannel: "feishu",
      Provider: "feishu",
      Surface: "feishu",
      ChatType: "group",
    } as TemplateContext);

    const payload = extractPayload(prompt);
    expect(payload.message_id).toBe("msg_short");
    expect(payload.message_id_full).toBe("msg_full_provider");
    expect(payload.reply_to_id).toBe("msg_parent");
    expect(payload.chat_id).toBe("oc_chat1");
  });

  it("omits message_id_full when equal to message_id", () => {
    const prompt = buildInboundMetaSystemPrompt({
      MessageSid: "msg_same",
      MessageSidFull: "msg_same",
      OriginatingChannel: "feishu",
      Provider: "feishu",
      Surface: "feishu",
      ChatType: "direct",
    } as TemplateContext);

    const payload = extractPayload(prompt);
    expect(payload.message_id).toBe("msg_same");
    expect(payload.message_id_full).toBeUndefined();
  });
});

describe("buildInboundUserContextPrefix", () => {
  it("includes message_id and sender hints in conversation metadata", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      MessageSid: " msg_1 ",
      SenderE164: " +15551234567 ",
    } as TemplateContext);

    const conversationInfo = extractConversationInfo(text);
    expect(conversationInfo.message_id).toBe("msg_1");
    expect(conversationInfo.sender).toBe("+15551234567");
  });
});
