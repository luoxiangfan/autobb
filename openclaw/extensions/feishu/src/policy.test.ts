import { describe, expect, it } from "vitest";
import {
  isFeishuGroupAllowed,
  resolveFeishuAllowlistMatch,
  resolveFeishuGroupConfig,
} from "./policy.js";

describe("resolveFeishuAllowlistMatch", () => {
  it("matches wildcard", () => {
    expect(
      resolveFeishuAllowlistMatch({
        allowFrom: ["*"],
        senderId: "ou_sender",
      }),
    ).toEqual({ allowed: true, matchKey: "*", matchSource: "wildcard" });
  });

  it("matches sender id case-insensitively", () => {
    expect(
      resolveFeishuAllowlistMatch({
        allowFrom: ["OU_SENDER"],
        senderId: "ou_sender",
      }),
    ).toEqual({ allowed: true, matchKey: "ou_sender", matchSource: "id" });
  });

  it("matches sender name when id not listed", () => {
    expect(
      resolveFeishuAllowlistMatch({
        allowFrom: ["alice"],
        senderId: "ou_sender",
        senderName: "Alice",
      }),
    ).toEqual({ allowed: true, matchKey: "alice", matchSource: "name" });
  });

  it("returns disallowed when no match", () => {
    expect(
      resolveFeishuAllowlistMatch({
        allowFrom: ["bob"],
        senderId: "ou_sender",
        senderName: "alice",
      }),
    ).toEqual({ allowed: false });
  });
});

describe("isFeishuGroupAllowed", () => {
  it("returns false for disabled group policy", () => {
    expect(
      isFeishuGroupAllowed({
        groupPolicy: "disabled",
        allowFrom: ["*"],
        senderId: "ou_sender",
      }),
    ).toBe(false);
  });

  it("returns true for open group policy", () => {
    expect(
      isFeishuGroupAllowed({
        groupPolicy: "open",
        allowFrom: [],
        senderId: "ou_sender",
      }),
    ).toBe(true);
  });
});

describe("resolveFeishuGroupConfig", () => {
  it("matches group id case-insensitively", () => {
    const cfg = {
      groups: {
        OC_CHAT_A: { requireMention: false },
      },
    } as any;

    expect(resolveFeishuGroupConfig({ cfg, groupId: "oc_chat_a" })).toEqual({
      requireMention: false,
    });
  });
});
