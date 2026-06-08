import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer } from "./mcp.js";
import { SqliteTaskStore } from "./store.js";
import type { Task } from "./types.js";

describe("MCP tools", () => {
  let dir: string;
  let client: Client;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tasks-mcp-"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer(new SqliteTaskStore(dir)).connect(serverTransport);
    client = new Client({ name: "test", version: "1.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function call(name: string, args: Record<string, unknown>) {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    return { isError: !!res.isError, text: res.content[0]?.text ?? "" };
  }

  function idFromGet(text: string): Task {
    return JSON.parse(text) as Task;
  }

  it("logs, lists, and fetches a task through the same store", async () => {
    const added = await call("add_task", { title: "fix login", assignee: "w1", project: "demo" });
    expect(added.isError).toBe(false);
    const id = added.text.match(/task-[a-f0-9]+/)![0];

    const list = await call("list_tasks", { state: "todo", project: "demo" });
    expect(list.text).toContain(id);

    const got = await call("get_task", { id });
    expect(idFromGet(got.text).title).toBe("fix login");
  });

  it("enforces the note-required send-back rule (same as CLI)", async () => {
    const added = await call("add_task", { title: "x", project: "demo" });
    const id = added.text.match(/task-[a-f0-9]+/)![0];
    await call("update_task", { id, state: "review", note: "ready" });

    const rejected = await call("update_task", { id, state: "todo" });
    expect(rejected.isError).toBe(true);
    expect(rejected.text).toMatch(/note is required/);
  });

  it("refuses to claim a done task", async () => {
    const added = await call("add_task", { title: "x", project: "demo" });
    const id = added.text.match(/task-[a-f0-9]+/)![0];
    await call("update_task", { id, state: "doing", note: "go" });
    await call("update_task", { id, state: "done", note: "shipped" });

    const claimed = await call("claim_task", { id, assignee: "w1" });
    expect(claimed.isError).toBe(true);
    expect(claimed.text).toMatch(/reopen/);
  });

  it("can edit title and description (parity with CLI)", async () => {
    const added = await call("add_task", { title: "typ0", project: "demo" });
    const id = added.text.match(/task-[a-f0-9]+/)![0];
    await call("update_task", { id, title: "typo fixed", description: "now described" });
    const got = idFromGet((await call("get_task", { id })).text);
    expect(got.title).toBe("typo fixed");
    expect(got.description).toBe("now described");
  });

  it("escalates and resolves the needs-human flag", async () => {
    const added = await call("add_task", { title: "x", project: "demo" });
    const id = added.text.match(/task-[a-f0-9]+/)![0];

    const esc = await call("escalate_task", { id, note: "need a human to approve" });
    expect(esc.isError).toBe(false);
    const inbox = await call("list_tasks", { needsHuman: true, project: "demo" });
    expect(inbox.text).toContain(id);

    await call("resolve_task", { id, note: "approved" });
    const after = await call("list_tasks", { needsHuman: true, project: "demo" });
    expect(after.text).toMatch(/No tasks match/);
  });

  it("returns a clean error (not a throw) for an invalid id", async () => {
    const res = await call("get_task", { id: "../escape" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Invalid task id/);
  });

  it("requires a note to add a task directly in blocked", async () => {
    const res = await call("add_task", { title: "stuck", project: "demo", state: "blocked" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/note is required/);
  });
});
