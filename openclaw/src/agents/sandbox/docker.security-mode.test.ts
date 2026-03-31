import { describe, expect, it } from "vitest";
import { buildSandboxCreateArgs } from "./docker.js";
import type { SandboxDockerConfig } from "./types.js";

function withSandboxSecurityMode<T>(
  value: string | undefined,
  fn: () => T,
): T {
  const prev = process.env.OPENCLAW_SANDBOX_SECURITY_MODE;
  if (value === undefined) {
    delete process.env.OPENCLAW_SANDBOX_SECURITY_MODE;
  } else {
    process.env.OPENCLAW_SANDBOX_SECURITY_MODE = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env.OPENCLAW_SANDBOX_SECURITY_MODE;
    } else {
      process.env.OPENCLAW_SANDBOX_SECURITY_MODE = prev;
    }
  }
}

function configWithBlockedBind(): SandboxDockerConfig {
  return {
    image: "openclaw-sandbox:bookworm-slim",
    containerPrefix: "openclaw-sbx-",
    workdir: "/workspace",
    readOnlyRoot: false,
    tmpfs: [],
    network: "none",
    capDrop: [],
    binds: ["/var/run/docker.sock:/var/run/docker.sock"],
  };
}

describe("buildSandboxCreateArgs sandbox security mode", () => {
  it("warn mode (default) keeps backward compatibility", () => {
    withSandboxSecurityMode(undefined, () => {
      expect(() =>
        buildSandboxCreateArgs({
          name: "openclaw-sbx-warn",
          cfg: configWithBlockedBind(),
          scopeKey: "main",
          createdAtMs: 1700000000000,
        }),
      ).not.toThrow();
    });
  });

  it("enforce mode blocks dangerous bind mounts", () => {
    withSandboxSecurityMode("enforce", () => {
      expect(() =>
        buildSandboxCreateArgs({
          name: "openclaw-sbx-enforce",
          cfg: configWithBlockedBind(),
          scopeKey: "main",
          createdAtMs: 1700000000000,
        }),
      ).toThrow(/blocked path/);
    });
  });
});
