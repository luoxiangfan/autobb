import { describe, expect, it } from "vitest";
import { shouldExtendEmbeddedRunTimeout } from "./attempt.js";

describe("shouldExtendEmbeddedRunTimeout", () => {
  it("extends timeout while still streaming and within extension limit", () => {
    expect(
      shouldExtendEmbeddedRunTimeout({
        isStreaming: true,
        extensionCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldExtendEmbeddedRunTimeout({
        isStreaming: true,
        extensionCount: 1,
      }),
    ).toBe(true);
  });

  it("does not extend timeout once extension limit is exhausted", () => {
    expect(
      shouldExtendEmbeddedRunTimeout({
        isStreaming: true,
        extensionCount: 2,
      }),
    ).toBe(false);
  });

  it("does not extend timeout when run is no longer streaming", () => {
    expect(
      shouldExtendEmbeddedRunTimeout({
        isStreaming: false,
        extensionCount: 0,
      }),
    ).toBe(false);
  });
});
