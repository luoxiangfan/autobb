import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSession,
  appendOutput,
  markExited,
  resetProcessRegistryForTests,
} from "./bash-process-registry.js";
import { createProcessSessionFixture } from "./bash-process-registry.test-helpers.js";
import { createProcessTool } from "./bash-tools.process.js";

afterEach(() => {
  resetProcessRegistryForTests();
});

describe("process tool poll backoff", () => {
  it("includes retryInMs and increases backoff for consecutive empty polls", async () => {
    const session = createProcessSessionFixture({
      id: "sess-backoff",
      command: "sleep 60",
      backgrounded: true,
    });
    addSession(session);
    const processTool = createProcessTool();

    const first = await processTool.execute("toolcall", {
      action: "poll",
      sessionId: session.id,
    });
    const second = await processTool.execute("toolcall", {
      action: "poll",
      sessionId: session.id,
    });

    expect(first.details).toMatchObject({ status: "running", retryInMs: 5000 });
    expect(second.details).toMatchObject({ status: "running", retryInMs: 10000 });
  });

  it("resets retry backoff when new output appears", async () => {
    const session = createProcessSessionFixture({
      id: "sess-reset",
      command: "sleep 60",
      backgrounded: true,
    });
    addSession(session);
    const processTool = createProcessTool();

    await processTool.execute("toolcall", {
      action: "poll",
      sessionId: session.id,
    });

    appendOutput(session, "stdout", "hello\n");
    const withOutput = await processTool.execute("toolcall", {
      action: "poll",
      sessionId: session.id,
    });
    const afterReset = await processTool.execute("toolcall", {
      action: "poll",
      sessionId: session.id,
    });

    expect(withOutput.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("hello"),
    });
    expect(withOutput.details).toMatchObject({ status: "running", retryInMs: 5000 });
    expect(afterReset.details).toMatchObject({ status: "running", retryInMs: 10000 });
  });

  it("waits for completion when timeout is provided", async () => {
    vi.useFakeTimers();
    try {
      const session = createProcessSessionFixture({
        id: "sess-timeout-number",
        command: "sleep 60",
        backgrounded: true,
      });
      addSession(session);
      const processTool = createProcessTool();

      setTimeout(() => {
        appendOutput(session, "stdout", "done\n");
        markExited(session, 0, null, "completed");
      }, 10);

      const pollPromise = processTool.execute("toolcall", {
        action: "poll",
        sessionId: session.id,
        timeout: 2000,
      });
      let resolved = false;
      void pollPromise.finally(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(200);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      const poll = await pollPromise;
      expect(poll.details).toMatchObject({ status: "completed" });
      expect(poll.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("done"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts string timeout values", async () => {
    vi.useFakeTimers();
    try {
      const session = createProcessSessionFixture({
        id: "sess-timeout-string",
        command: "sleep 60",
        backgrounded: true,
      });
      addSession(session);
      const processTool = createProcessTool();

      setTimeout(() => {
        appendOutput(session, "stdout", "done\n");
        markExited(session, 0, null, "completed");
      }, 10);

      const pollPromise = processTool.execute("toolcall", {
        action: "poll",
        sessionId: session.id,
        timeout: "2000" as unknown as number,
      });
      await vi.advanceTimersByTimeAsync(350);
      const poll = await pollPromise;
      expect(poll.details).toMatchObject({ status: "completed" });
      expect(poll.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("done"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears retry hint after completion", async () => {
    const session = createProcessSessionFixture({
      id: "sess-complete-clear",
      command: "sleep 60",
      backgrounded: true,
    });
    addSession(session);
    const processTool = createProcessTool();

    const poll1 = await processTool.execute("toolcall", {
      action: "poll",
      sessionId: session.id,
    });
    const poll2 = await processTool.execute("toolcall", {
      action: "poll",
      sessionId: session.id,
    });
    expect(poll1.details).toMatchObject({ status: "running", retryInMs: 5000 });
    expect(poll2.details).toMatchObject({ status: "running", retryInMs: 10000 });

    markExited(session, 0, null, "completed");
    const completed = await processTool.execute("toolcall", {
      action: "poll",
      sessionId: session.id,
    });
    const finished = await processTool.execute("toolcall", {
      action: "poll",
      sessionId: session.id,
    });

    expect(completed.details).toMatchObject({ status: "completed" });
    expect(finished.details).toMatchObject({ status: "completed" });
    expect((completed.details as { retryInMs?: number }).retryInMs).toBeUndefined();
    expect((finished.details as { retryInMs?: number }).retryInMs).toBeUndefined();
  });
});
