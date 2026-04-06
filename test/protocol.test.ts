import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ApprovalServer } from "../src/server/index.js";
import { ApprovalClient } from "../src/client/index.js";
import type { ApChannel, ApStatusResult } from "../src/types.js";

// Silent channel that records notifications
class TestChannel implements ApChannel {
  name = "test";
  notifications: ApStatusResult[] = [];

  async notify(request: ApStatusResult): Promise<void> {
    this.notifications.push(request);
  }
}

const PORT = 4555;
const BASE_URL = `http://localhost:${PORT}`;

let server: ApprovalServer;
let client: ApprovalClient;
let channel: TestChannel;

beforeAll(async () => {
  channel = new TestChannel();
  server = new ApprovalServer({
    port: PORT,
    channel,
    policies: {
      send_email: { requires: "always" },
      search_kb: { requires: "never" },
      issue_refund: { requires: "conditional", when: "params.amount > 100" },
      delete_records: { requires: "always", execution: "sandbox" },
      preview_report: { requires: "never", execution: "dry_run" },
    },
  });
  await server.start();
  client = new ApprovalClient(BASE_URL);
});

afterAll(async () => {
  await server.stop();
});

// ── ap/negotiate ────────────────���──────────────────────────

describe("ap/negotiate", () => {
  it("returns session and policies for declared capabilities", async () => {
    const result = await client.negotiate("test-agent", [
      "send_email",
      "search_kb",
      "issue_refund",
    ]);

    expect(result.session_id).toBeDefined();
    expect(result.session_id).toMatch(/^sess_/);
    expect(result.trust_level).toBe("standard");
    expect(result.policies.send_email).toEqual({ requires: "always" });
    expect(result.policies.search_kb).toEqual({ requires: "never" });
    expect(result.policies.issue_refund).toEqual({
      requires: "conditional",
      when: "params.amount > 100",
    });
  });

  it("returns execution mode in policy when not live", async () => {
    const result = await client.negotiate("test-agent", [
      "delete_records",
      "preview_report",
    ]);

    expect(result.policies.delete_records).toEqual({
      requires: "always",
      execution: "sandbox",
    });
    expect(result.policies.preview_report).toEqual({
      requires: "never",
      execution: "dry_run",
    });
  });

  it("returns default 'always' policy for unknown actions", async () => {
    const result = await client.negotiate("test-agent", ["unknown_action"]);
    expect(result.policies.unknown_action).toEqual({ requires: "always" });
  });

  it("rejects invalid negotiate request", async () => {
    await expect(client.negotiate("", ["send_email"])).rejects.toThrow();
  });
});

// ── ap/request ─────���───────────────────────────────────────

describe("ap/request", () => {
  it("auto-approves actions with 'never' policy", async () => {
    const result = await client.request({
      action: { name: "search_kb", params: { query: "test" } },
      context: { agent: "test-agent" },
    });

    expect(result.status).toBe("auto_approved");
    expect(result.request_id).toMatch(/^req_/);
    expect(result.execution_mode).toBe("live");
    expect(result.expires_at).toBeUndefined();
  });

  it("creates pending request for 'always' policy", async () => {
    const result = await client.request({
      action: {
        name: "send_email",
        params: { to: "test@example.com", body: "Hello" },
      },
      context: { agent: "test-agent", reason: "Testing" },
      risk: { reversible: false, blast_radius: "external" },
    });

    expect(result.status).toBe("pending");
    expect(result.request_id).toMatch(/^req_/);
    expect(result.execution_mode).toBe("live");
    expect(result.expires_at).toBeDefined();
  });

  it("returns execution_mode from policy", async () => {
    const result = await client.request({
      action: { name: "delete_records", params: { ids: [1, 2, 3] } },
      context: { agent: "test-agent" },
    });

    expect(result.status).toBe("pending");
    expect(result.execution_mode).toBe("sandbox");
  });

  it("returns dry_run execution_mode", async () => {
    const result = await client.request({
      action: { name: "preview_report", params: { type: "quarterly" } },
      context: { agent: "test-agent" },
    });

    expect(result.status).toBe("auto_approved");
    expect(result.execution_mode).toBe("dry_run");
  });

  it("notifies channel for pending requests", async () => {
    const countBefore = channel.notifications.length;

    await client.request({
      action: { name: "send_email", params: { to: "notify@example.com" } },
      context: { agent: "test-agent" },
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(channel.notifications.length).toBeGreaterThan(countBefore);
    const latest = channel.notifications[channel.notifications.length - 1];
    expect(latest.action.name).toBe("send_email");
  });

  it("does not notify channel for auto-approved requests", async () => {
    const countBefore = channel.notifications.length;

    await client.request({
      action: { name: "search_kb", params: { query: "test" } },
      context: { agent: "test-agent" },
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(channel.notifications.length).toBe(countBefore);
  });

  it("evaluates conditional policy — auto-approves when condition is false", async () => {
    const result = await client.request({
      action: { name: "issue_refund", params: { amount: 50 } },
      context: { agent: "test-agent" },
    });
    expect(result.status).toBe("auto_approved");
  });

  it("evaluates conditional policy — requires approval when condition is true", async () => {
    const result = await client.request({
      action: { name: "issue_refund", params: { amount: 500 } },
      context: { agent: "test-agent" },
    });
    expect(result.status).toBe("pending");
  });
});

// ── ap/decide ────────────────────────────────────────��─────

describe("ap/decide", () => {
  it("approves a pending request", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "approve@example.com" } },
      context: { agent: "test-agent" },
    });

    const decideResult = await client.decide({
      request_id,
      decision: "approve",
      decided_by: "tester",
      reason: "Looks good",
    });

    expect(decideResult.status).toBe("approved");
    expect(decideResult.decided_at).toBeDefined();
  });

  it("denies a pending request", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "deny@example.com" } },
      context: { agent: "test-agent" },
    });

    const decideResult = await client.decide({
      request_id,
      decision: "deny",
      decided_by: "tester",
      reason: "Not appropriate",
    });

    expect(decideResult.status).toBe("denied");
  });

  it("edits a pending request with modified params", async () => {
    const { request_id } = await client.request({
      action: {
        name: "send_email",
        params: { to: "edit@example.com", body: "original" },
      },
      context: { agent: "test-agent" },
    });

    const decideResult = await client.decide({
      request_id,
      decision: "edit",
      modified_params: { to: "edit@example.com", body: "modified body" },
      decided_by: "tester",
      reason: "Fixed the body text",
    });

    expect(decideResult.status).toBe("edited");
  });

  it("rejects decision on non-existent request", async () => {
    await expect(
      client.decide({
        request_id: "req_nonexistent",
        decision: "approve",
        decided_by: "tester",
      })
    ).rejects.toThrow("Request not found");
  });

  it("rejects decision on already-decided request", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "double@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({
      request_id,
      decision: "approve",
      decided_by: "tester",
    });

    await expect(
      client.decide({
        request_id,
        decision: "deny",
        decided_by: "tester",
      })
    ).rejects.toThrow("already resolved");
  });
});

// ── ap/confirm ────────────────────────────��────────────────

describe("ap/confirm", () => {
  it("confirms successful execution with result and undo", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "confirm@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({
      request_id,
      decision: "approve",
      decided_by: "tester",
    });

    const confirmResult = await client.confirm({
      request_id,
      success: true,
      result: { message_id: "msg_123", delivered: true },
      undo: {
        type: "api_call",
        description: "Recall the email",
        instructions: { method: "POST", url: "https://api.example.com/recall/msg_123" },
      },
      confirmed_by: "test-agent",
    });

    expect(confirmResult.execution_status).toBe("confirmed");
    expect(confirmResult.confirmed_at).toBeDefined();
  });

  it("confirms failed execution with error", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "fail@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({
      request_id,
      decision: "approve",
      decided_by: "tester",
    });

    const confirmResult = await client.confirm({
      request_id,
      success: false,
      error: "SMTP connection refused",
      confirmed_by: "test-agent",
    });

    expect(confirmResult.execution_status).toBe("failed");
  });

  it("stores undo metadata and returns it in status", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "undo-check@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({ request_id, decision: "approve", decided_by: "tester" });

    await client.confirm({
      request_id,
      success: true,
      result: { id: "xyz" },
      undo: {
        type: "function",
        description: "Call deleteMessage(xyz)",
        instructions: { function: "deleteMessage", args: ["xyz"] },
      },
      confirmed_by: "test-agent",
    });

    const status = await client.status(request_id);
    expect(status.execution).toBeDefined();
    expect(status.execution!.status).toBe("confirmed");
    expect(status.execution!.undo).toBeDefined();
    expect(status.execution!.undo!.type).toBe("function");
    expect(status.execution!.undo!.instructions).toEqual({ function: "deleteMessage", args: ["xyz"] });
  });

  it("confirms auto-approved requests", async () => {
    const { request_id } = await client.request({
      action: { name: "search_kb", params: { query: "confirm auto" } },
      context: { agent: "test-agent" },
    });

    const confirmResult = await client.confirm({
      request_id,
      success: true,
      result: { results: ["doc1", "doc2"] },
      confirmed_by: "test-agent",
    });

    expect(confirmResult.execution_status).toBe("confirmed");
  });

  it("rejects confirm on non-existent request", async () => {
    await expect(
      client.confirm({
        request_id: "req_nonexistent",
        success: true,
        confirmed_by: "test-agent",
      })
    ).rejects.toThrow("Request not found");
  });

  it("rejects confirm on pending request", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "premature@example.com" } },
      context: { agent: "test-agent" },
    });

    await expect(
      client.confirm({
        request_id,
        success: true,
        confirmed_by: "test-agent",
      })
    ).rejects.toThrow("Cannot confirm execution");
  });

  it("rejects double confirmation", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "double-confirm@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({ request_id, decision: "approve", decided_by: "tester" });

    await client.confirm({
      request_id,
      success: true,
      confirmed_by: "test-agent",
    });

    await expect(
      client.confirm({
        request_id,
        success: true,
        confirmed_by: "test-agent",
      })
    ).rejects.toThrow("already confirmed");
  });
});

// ── ap/rollback ──��─────────────────────────────────────────

describe("ap/rollback", () => {
  it("rolls back a confirmed action and returns undo info", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "rollback@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({ request_id, decision: "approve", decided_by: "tester" });

    await client.confirm({
      request_id,
      success: true,
      result: { message_id: "msg_rollback" },
      undo: {
        type: "api_call",
        description: "Recall email msg_rollback",
        instructions: { endpoint: "/recall/msg_rollback" },
      },
      confirmed_by: "test-agent",
    });

    const rollbackResult = await client.rollback({
      request_id,
      reason: "Customer changed their mind",
      initiated_by: "admin",
    });

    expect(rollbackResult.execution_status).toBe("rolled_back");
    expect(rollbackResult.rolled_back_at).toBeDefined();
    expect(rollbackResult.undo).toBeDefined();
    expect(rollbackResult.undo!.type).toBe("api_call");
    expect(rollbackResult.undo!.instructions).toEqual({ endpoint: "/recall/msg_rollback" });
  });

  it("shows rolled_back in status after rollback", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "rollback-status@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({ request_id, decision: "approve", decided_by: "tester" });
    await client.confirm({ request_id, success: true, confirmed_by: "test-agent" });
    await client.rollback({ request_id, initiated_by: "admin" });

    const status = await client.status(request_id);
    expect(status.execution).toBeDefined();
    expect(status.execution!.status).toBe("rolled_back");
    expect(status.execution!.rolled_back_by).toBe("admin");
    expect(status.execution!.rolled_back_at).toBeDefined();
  });

  it("rejects rollback on non-confirmed request", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "no-rollback@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({ request_id, decision: "approve", decided_by: "tester" });

    // Not confirmed yet
    await expect(
      client.rollback({ request_id, initiated_by: "admin" })
    ).rejects.toThrow("Cannot rollback");
  });

  it("rejects rollback on failed execution", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "failed-rollback@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({ request_id, decision: "approve", decided_by: "tester" });
    await client.confirm({ request_id, success: false, error: "SMTP error", confirmed_by: "test-agent" });

    await expect(
      client.rollback({ request_id, initiated_by: "admin" })
    ).rejects.toThrow("Cannot rollback");
  });
});

// ── ap/status ──────────���──────────────────────────────────���

describe("ap/status", () => {
  it("returns pending status before decision", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "status-pending@example.com" } },
      context: { agent: "test-agent" },
    });

    const status = await client.status(request_id);

    expect(status.request_id).toBe(request_id);
    expect(status.status).toBe("pending");
    expect(status.action.name).toBe("send_email");
    expect(status.created_at).toBeDefined();
    expect(status.decision).toBeUndefined();
  });

  it("returns execution info with mode after approval", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "exec-info@example.com" } },
      context: { agent: "test-agent" },
    });

    await client.decide({ request_id, decision: "approve", decided_by: "tester" });

    const status = await client.status(request_id);
    expect(status.execution).toBeDefined();
    expect(status.execution!.mode).toBe("live");
    expect(status.execution!.status).toBe("pending_execution");
  });

  it("returns 404 for non-existent request", async () => {
    await expect(client.status("req_nonexistent")).rejects.toThrow(
      "Request not found"
    );
  });
});

// ── Full lifecycle flow ───────���────────────────────────────

describe("full lifecycle flow", () => {
  it("negotiate → request → approve → confirm → status shows full lifecycle", async () => {
    const session = await client.negotiate("lifecycle-agent", ["send_email"]);
    expect(session.policies.send_email.requires).toBe("always");

    const { request_id, status, execution_mode } = await client.request({
      action: {
        name: "send_email",
        params: { to: "lifecycle@example.com", body: "Full lifecycle test" },
      },
      context: { agent: "lifecycle-agent", session: session.session_id },
      risk: { reversible: false, blast_radius: "external" },
    });
    expect(status).toBe("pending");
    expect(execution_mode).toBe("live");

    await client.decide({
      request_id,
      decision: "approve",
      decided_by: "reviewer",
      reason: "Approved",
    });

    await client.confirm({
      request_id,
      success: true,
      result: { message_id: "msg_lifecycle" },
      undo: { type: "manual", description: "Contact recipient to disregard" },
      confirmed_by: "lifecycle-agent",
    });

    const final = await client.status(request_id);
    expect(final.status).toBe("approved");
    expect(final.decision!.decided_by).toBe("reviewer");
    expect(final.execution).toBeDefined();
    expect(final.execution!.status).toBe("confirmed");
    expect(final.execution!.mode).toBe("live");
    expect(final.execution!.result).toEqual({ message_id: "msg_lifecycle" });
    expect(final.execution!.undo!.type).toBe("manual");
    expect(final.execution!.confirmed_by).toBe("lifecycle-agent");
  });

  it("request → approve → confirm → rollback → status shows rolled_back", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "rollback-flow@example.com" } },
      context: { agent: "lifecycle-agent" },
    });

    await client.decide({ request_id, decision: "approve", decided_by: "reviewer" });

    await client.confirm({
      request_id,
      success: true,
      undo: {
        type: "api_call",
        description: "Recall via API",
        instructions: { url: "/api/recall" },
      },
      confirmed_by: "lifecycle-agent",
    });

    const rollback = await client.rollback({
      request_id,
      reason: "Sent to wrong person",
      initiated_by: "reviewer",
    });

    expect(rollback.execution_status).toBe("rolled_back");
    expect(rollback.undo!.type).toBe("api_call");

    const final = await client.status(request_id);
    expect(final.execution!.status).toBe("rolled_back");
    expect(final.execution!.rolled_back_by).toBe("reviewer");
  });

  it("request → deny → cannot confirm", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "denied-flow@example.com" } },
      context: { agent: "lifecycle-agent" },
    });

    await client.decide({ request_id, decision: "deny", decided_by: "reviewer" });

    await expect(
      client.confirm({ request_id, success: true, confirmed_by: "lifecycle-agent" })
    ).rejects.toThrow("Cannot confirm execution");
  });
});

// ── Execution modes ─────────────��──────────────────────────

describe("execution modes", () => {
  it("sandbox mode is returned for sandbox-policy actions", async () => {
    const { request_id, execution_mode } = await client.request({
      action: { name: "delete_records", params: { ids: [1, 2] } },
      context: { agent: "test-agent" },
    });

    expect(execution_mode).toBe("sandbox");

    // Approve and confirm in sandbox
    await client.decide({ request_id, decision: "approve", decided_by: "tester" });
    await client.confirm({
      request_id,
      success: true,
      result: { deleted: 2, sandbox: true },
      confirmed_by: "test-agent",
    });

    const status = await client.status(request_id);
    expect(status.execution!.mode).toBe("sandbox");
    expect(status.execution!.result).toEqual({ deleted: 2, sandbox: true });
  });

  it("dry_run mode is returned for dry_run-policy actions", async () => {
    const { execution_mode } = await client.request({
      action: { name: "preview_report", params: { type: "annual" } },
      context: { agent: "test-agent" },
    });

    expect(execution_mode).toBe("dry_run");
  });

  it("default live mode for policies without execution", async () => {
    const { execution_mode } = await client.request({
      action: { name: "send_email", params: { to: "mode@example.com" } },
      context: { agent: "test-agent" },
    });

    expect(execution_mode).toBe("live");
  });
});

// ── Audit ──────────────────────────────────────��───────────

describe("ap/audit", () => {
  it("returns audit log with execution status", async () => {
    const res = await fetch(`${BASE_URL}/ap/audit`);
    const audit = (await res.json()) as { items: { execution_status?: string }[]; total: number };

    expect(audit.total).toBeGreaterThan(0);
    // At least some items should have execution status from our confirm tests
    const confirmed = audit.items.filter((i) => i.execution_status === "confirmed");
    expect(confirmed.length).toBeGreaterThan(0);
  });
});

// ── waitForDecision ─────���──────────────────────────────────

describe("waitForDecision", () => {
  it("resolves when decision arrives", async () => {
    const { request_id } = await client.request({
      action: { name: "send_email", params: { to: "wait@example.com" } },
      context: { agent: "test-agent" },
    });

    setTimeout(async () => {
      await client.decide({
        request_id,
        decision: "approve",
        decided_by: "async-tester",
      });
    }, 200);

    const result = await client.waitForDecision(request_id, {
      timeout: 5000,
      pollInterval: 100,
    });

    expect(result.status).toBe("approved");
  });
});
