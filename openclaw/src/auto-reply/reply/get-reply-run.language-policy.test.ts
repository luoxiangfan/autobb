import { describe, expect, it } from "vitest";
import { buildChannelLanguageSystemPrompt } from "./get-reply-run.js";

function createTemplateContext(overrides: Record<string, unknown>) {
  return {
    Body: "test",
    ...overrides,
  } as any;
}

describe("buildChannelLanguageSystemPrompt", () => {
  it("injects Chinese-only policy for Feishu channel", () => {
    const prompt = buildChannelLanguageSystemPrompt(
      createTemplateContext({
        Provider: "feishu",
      }),
    );
    expect(prompt).toContain("飞书（Feishu/Lark）");
    expect(prompt).toContain("所有对用户可见文本必须使用简体中文");
  });

  it("injects Chinese-only policy for Lark originating channel", () => {
    const prompt = buildChannelLanguageSystemPrompt(
      createTemplateContext({
        OriginatingChannel: "lark",
        Provider: "slack",
      }),
    );
    expect(prompt).toContain("所有对用户可见文本必须使用简体中文");
  });

  it("does not inject channel language policy for non-Feishu channels", () => {
    const prompt = buildChannelLanguageSystemPrompt(
      createTemplateContext({
        Provider: "telegram",
        Surface: "telegram",
      }),
    );
    expect(prompt).toBe("");
  });
});
