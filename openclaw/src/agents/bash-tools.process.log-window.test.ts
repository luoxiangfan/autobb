import { afterEach, describe, expect, it } from "vitest";
import { addSession, appendOutput, resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createProcessSessionFixture } from "./bash-process-registry.test-helpers.js";
import { createProcessTool } from "./bash-tools.process.js";

afterEach(() => {
  resetProcessRegistryForTests();
});

describe("process tool log window", () => {
  it("defaults to tailing last 200 lines and includes paging note", async () => {
    const session = createProcessSessionFixture({
      id: "sess-log-tail-default",
      command: "sleep 60",
      backgrounded: true,
    });
    addSession(session);
    for (let i = 0; i < 250; i += 1) {
      appendOutput(session, "stdout", `line-${i}\n`);
    }

    const processTool = createProcessTool();
    const res = await processTool.execute("toolcall", {
      action: "log",
      sessionId: session.id,
    });

    expect(res.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("[showing last 200 of 250 lines; pass offset/limit to page]"),
    });
    const text = String(res.content[0].text);
    expect(text).toContain("line-249");
    expect(text).toContain("line-50");
    expect(text).not.toContain("line-0");
  });

  it("uses explicit offset/limit without default-tail note", async () => {
    const session = createProcessSessionFixture({
      id: "sess-log-explicit-window",
      command: "sleep 60",
      backgrounded: true,
    });
    addSession(session);
    for (let i = 0; i < 30; i += 1) {
      appendOutput(session, "stdout", `line-${i}\n`);
    }

    const processTool = createProcessTool();
    const res = await processTool.execute("toolcall", {
      action: "log",
      sessionId: session.id,
      offset: 0,
      limit: 10,
    });

    const text = String(res.content[0].text);
    expect(text).toContain("line-0");
    expect(text).toContain("line-9");
    expect(text).not.toContain("line-10");
    expect(text).not.toContain("[showing last 200");
  });
});
