import { describe, expect, it } from "vitest";
import {
  calculateBackoffMs,
  getCommandPollSuggestion,
  pruneStaleCommandPolls,
  recordCommandPoll,
  resetCommandPollCount,
  type CommandPollState,
} from "./command-poll-backoff.js";

describe("command-poll-backoff", () => {
  describe("calculateBackoffMs", () => {
    it("returns 5s for first poll", () => {
      expect(calculateBackoffMs(0)).toBe(5000);
    });

    it("returns 10s for second poll", () => {
      expect(calculateBackoffMs(1)).toBe(10000);
    });

    it("returns 30s for third poll", () => {
      expect(calculateBackoffMs(2)).toBe(30000);
    });

    it("returns 60s for fourth and subsequent polls (capped)", () => {
      expect(calculateBackoffMs(3)).toBe(60000);
      expect(calculateBackoffMs(4)).toBe(60000);
      expect(calculateBackoffMs(10)).toBe(60000);
      expect(calculateBackoffMs(100)).toBe(60000);
    });
  });

  describe("recordCommandPoll", () => {
    it("returns 5s on first no-output poll", () => {
      const state: CommandPollState = {};
      const retryMs = recordCommandPoll(state, "cmd-123", false);
      expect(retryMs).toBe(5000);
      expect(state.commandPollCounts?.get("cmd-123")?.count).toBe(0);
    });

    it("increments count and increases backoff on consecutive no-output polls", () => {
      const state: CommandPollState = {};

      expect(recordCommandPoll(state, "cmd-123", false)).toBe(5000);
      expect(recordCommandPoll(state, "cmd-123", false)).toBe(10000);
      expect(recordCommandPoll(state, "cmd-123", false)).toBe(30000);
      expect(recordCommandPoll(state, "cmd-123", false)).toBe(60000);
      expect(recordCommandPoll(state, "cmd-123", false)).toBe(60000);

      expect(state.commandPollCounts?.get("cmd-123")?.count).toBe(4);
    });

    it("resets count when poll returns new output", () => {
      const state: CommandPollState = {};
      recordCommandPoll(state, "cmd-123", false);
      recordCommandPoll(state, "cmd-123", false);
      recordCommandPoll(state, "cmd-123", false);
      expect(state.commandPollCounts?.get("cmd-123")?.count).toBe(2);

      const retryMs = recordCommandPoll(state, "cmd-123", true);
      expect(retryMs).toBe(5000);
      expect(state.commandPollCounts?.get("cmd-123")?.count).toBe(0);
    });

    it("tracks different commands independently", () => {
      const state: CommandPollState = {};
      recordCommandPoll(state, "cmd-1", false);
      recordCommandPoll(state, "cmd-1", false);
      recordCommandPoll(state, "cmd-2", false);
      expect(state.commandPollCounts?.get("cmd-1")?.count).toBe(1);
      expect(state.commandPollCounts?.get("cmd-2")?.count).toBe(0);
    });
  });

  describe("getCommandPollSuggestion", () => {
    it("returns undefined for untracked command", () => {
      const state: CommandPollState = {};
      expect(getCommandPollSuggestion(state, "unknown")).toBeUndefined();
    });

    it("returns current backoff for tracked command", () => {
      const state: CommandPollState = {};
      recordCommandPoll(state, "cmd-123", false);
      recordCommandPoll(state, "cmd-123", false);
      expect(getCommandPollSuggestion(state, "cmd-123")).toBe(10000);
    });
  });

  describe("resetCommandPollCount", () => {
    it("removes command from tracking", () => {
      const state: CommandPollState = {};
      recordCommandPoll(state, "cmd-123", false);
      expect(state.commandPollCounts?.has("cmd-123")).toBe(true);
      resetCommandPollCount(state, "cmd-123");
      expect(state.commandPollCounts?.has("cmd-123")).toBe(false);
    });

    it("is safe to call on untracked command", () => {
      const state: CommandPollState = {};
      expect(() => resetCommandPollCount(state, "unknown")).not.toThrow();
    });
  });

  describe("pruneStaleCommandPolls", () => {
    it("removes polls older than maxAge", () => {
      const state: CommandPollState = {
        commandPollCounts: new Map([
          ["cmd-old", { count: 5, lastPollAt: Date.now() - 7200000 }],
          ["cmd-new", { count: 3, lastPollAt: Date.now() - 1000 }],
        ]),
      };
      pruneStaleCommandPolls(state, 3600000);
      expect(state.commandPollCounts?.has("cmd-old")).toBe(false);
      expect(state.commandPollCounts?.has("cmd-new")).toBe(true);
    });

    it("handles empty state gracefully", () => {
      const state: CommandPollState = {};
      expect(() => pruneStaleCommandPolls(state)).not.toThrow();
    });
  });
});
