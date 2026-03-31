import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSandboxPath, resolveSandboxInputPath } from "./sandbox-paths.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-paths-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((entry) => fs.rm(entry, { recursive: true, force: true })),
  );
});

describe("resolveSandboxInputPath", () => {
  it("resolves relative paths against cwd", () => {
    expect(resolveSandboxInputPath("src/index.ts", "/tmp/workspace")).toBe(
      path.join("/tmp/workspace", "src", "index.ts"),
    );
  });
});

describe("assertSandboxPath", () => {
  it("allows regular paths under sandbox root", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "dir"), { recursive: true });
    await fs.writeFile(path.join(root, "dir", "file.txt"), "ok", "utf8");

    const resolved = await assertSandboxPath({
      filePath: "dir/file.txt",
      cwd: root,
      root,
    });

    expect(resolved.resolved).toBe(path.join(root, "dir", "file.txt"));
    expect(resolved.relative).toBe(path.join("dir", "file.txt"));
  });

  it("rejects path traversal outside root", async () => {
    const root = await createTempRoot();
    await expect(
      assertSandboxPath({
        filePath: "../escape.txt",
        cwd: root,
        root,
      }),
    ).rejects.toThrow(/Path escapes sandbox root/);
  });

  it("allows symlink traversal when target remains inside root", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "real", "dir"), { recursive: true });
    await fs.writeFile(path.join(root, "real", "dir", "file.txt"), "ok", "utf8");
    await fs.symlink(path.join(root, "real"), path.join(root, "linked"));

    const resolved = await assertSandboxPath({
      filePath: path.join("linked", "dir", "file.txt"),
      cwd: root,
      root,
    });

    expect(resolved.relative).toBe(path.join("linked", "dir", "file.txt"));
  });

  it("rejects symlink traversal when target escapes root", async () => {
    const base = await createTempRoot();
    const root = path.join(base, "root");
    const outside = path.join(base, "outside");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    await fs.symlink(outside, path.join(root, "linked"));

    await expect(
      assertSandboxPath({
        filePath: path.join("linked", "secret.txt"),
        cwd: root,
        root,
      }),
    ).rejects.toThrow(/Symlink escapes sandbox root/);
  });

  it("allows final symlink for unlink-style operations when explicitly enabled", async () => {
    const base = await createTempRoot();
    const root = path.join(base, "root");
    const outside = path.join(base, "outside");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "final-link.txt"));

    await expect(
      assertSandboxPath({
        filePath: "final-link.txt",
        cwd: root,
        root,
      }),
    ).rejects.toThrow(/Symlink escapes sandbox root/);

    const resolved = await assertSandboxPath({
      filePath: "final-link.txt",
      cwd: root,
      root,
      allowFinalSymlink: true,
    });

    expect(resolved.relative).toBe("final-link.txt");
  });
});
