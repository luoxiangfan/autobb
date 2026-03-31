import { describe, expect, it } from "vitest";
import { resolveAgentTimeoutMs } from "./timeout.js";

describe("resolveAgentTimeoutMs", () => {
  it("defaults to 20 minutes when no config or overrides are provided", () => {
    expect(resolveAgentTimeoutMs({})).toBe(1_200_000);
  });

  it("uses a timer-safe sentinel for no-timeout overrides", () => {
    expect(resolveAgentTimeoutMs({ overrideSeconds: 0 })).toBe(2_147_000_000);
    expect(resolveAgentTimeoutMs({ overrideMs: 0 })).toBe(2_147_000_000);
  });

  it("clamps very large timeout overrides to timer-safe values", () => {
    expect(resolveAgentTimeoutMs({ overrideSeconds: 9_999_999 })).toBe(2_147_000_000);
    expect(resolveAgentTimeoutMs({ overrideMs: 9_999_999_999 })).toBe(2_147_000_000);
  });
});
