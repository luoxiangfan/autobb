import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveRunWorkspaceDir } from "./workspace-run.js";

describe("resolveRunWorkspaceDir sanitization (OC-19 hardening)", () => {
  it("strips control/format chars from explicit workspaceDir", () => {
    const result = resolveRunWorkspaceDir({
      workspaceDir: "/tmp/work\nspace\u2028x",
      sessionKey: "agent:main:subagent:test",
    });

    expect(result.usedFallback).toBe(false);
    expect(result.workspaceDir).toBe(path.resolve("/tmp/workspacex"));
  });

  it("strips control/format chars from fallback workspaceDir", () => {
    const cfg = {
      agents: {
        defaults: { workspace: "/tmp/default\nworkspace\u2029x" },
      },
    } satisfies OpenClawConfig;

    const result = resolveRunWorkspaceDir({
      workspaceDir: undefined,
      sessionKey: "agent:main:subagent:test",
      config: cfg,
    });

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("missing");
    expect(result.workspaceDir).toBe(path.resolve("/tmp/defaultworkspacex"));
  });
});
