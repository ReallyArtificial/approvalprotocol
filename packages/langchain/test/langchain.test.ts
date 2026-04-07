import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import {
  approvalTool,
  ApprovalDeniedError,
  ApprovalDryRunResult,
} from "../src/tools.js";
import type { ApprovalClient } from "@approval-protocol/core";

// ── Helpers ────────────────────────────────────────────────────

function makeMockClient(overrides: Partial<ApprovalClient> = {}) {
  return {
    negotiate: vi.fn(),
    request: vi.fn(),
    decide: vi.fn(),
    confirm: vi.fn(),
    rollback: vi.fn(),
    status: vi.fn(),
    waitForDecision: vi.fn(),
    ...overrides,
  } as unknown as ApprovalClient;
}

function makeTestTool(fn?: (input: { query: string }) => Promise<string>) {
  return new DynamicStructuredTool({
    name: "search",
    description: "Search the knowledge base",
    schema: z.object({ query: z.string() }),
    func: fn ?? (async (input: { query: string }) => `Results for: ${input.query}`),
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("approvalTool", () => {
  let client: ApprovalClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  it("preserves the original tool name, description, and schema", () => {
    const original = makeTestTool();
    const wrapped = approvalTool(original, { client, agent: "test-agent" });

    expect(wrapped.name).toBe("search");
    expect(wrapped.description).toBe("Search the knowledge base");
    expect(wrapped.schema).toBe(original.schema);
  });

  it("executes the tool when auto-approved", async () => {
    const toolFn = vi.fn(async (input: { query: string }) => `Found: ${input.query}`);
    const original = makeTestTool(toolFn);

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-1",
      status: "auto_approved",
      execution_mode: "live",
    });
    (client.confirm as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const wrapped = approvalTool(original, { client, agent: "test-agent" });
    const result = await wrapped.invoke({ query: "hello" });

    expect(result).toBe("Found: hello");
    expect(toolFn).toHaveBeenCalledOnce();

    // Verify AP lifecycle calls
    expect(client.request).toHaveBeenCalledWith({
      action: { name: "search", params: { query: "hello" } },
      context: { agent: "test-agent" },
      risk: undefined,
      timeout: 300,
    });
    expect(client.confirm).toHaveBeenCalledWith({
      request_id: "req-1",
      success: true,
      result: { value: "Found: hello" },
      undo: undefined,
      confirmed_by: "test-agent",
    });
  });

  it("waits for human decision when status is pending", async () => {
    const original = makeTestTool();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-2",
      status: "pending",
      execution_mode: "live",
    });
    (client.waitForDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-2",
      status: "approved",
    });
    (client.confirm as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const wrapped = approvalTool(original, { client, agent: "test-agent" });
    const result = await wrapped.invoke({ query: "test" });

    expect(result).toBe("Results for: test");
    expect(client.waitForDecision).toHaveBeenCalledWith("req-2", {
      timeout: 300_000,
      pollInterval: 1000,
    });
  });

  it("throws ApprovalDeniedError when auto-denied", async () => {
    const original = makeTestTool();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-3",
      status: "auto_denied",
      execution_mode: "live",
    });

    const wrapped = approvalTool(original, { client, agent: "test-agent" });

    await expect(wrapped.invoke({ query: "blocked" })).rejects.toThrow(
      ApprovalDeniedError,
    );
    expect(client.confirm).not.toHaveBeenCalled();
  });

  it("throws ApprovalDeniedError when human denies", async () => {
    const original = makeTestTool();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-4",
      status: "pending",
      execution_mode: "live",
    });
    (client.waitForDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-4",
      status: "denied",
      decision: { reason: "Too risky" },
    });

    const wrapped = approvalTool(original, { client, agent: "test-agent" });

    await expect(wrapped.invoke({ query: "risky" })).rejects.toThrow(
      'Action "search" was denied: Too risky',
    );
  });

  it("throws on expired request", async () => {
    const original = makeTestTool();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-5",
      status: "pending",
      execution_mode: "live",
    });
    (client.waitForDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-5",
      status: "expired",
    });

    const wrapped = approvalTool(original, { client, agent: "test-agent" });

    await expect(wrapped.invoke({ query: "slow" })).rejects.toThrow(
      "expired before a decision was made",
    );
  });

  it("handles dry_run mode without executing the tool", async () => {
    const toolFn = vi.fn(async () => "should not run");
    const original = makeTestTool(toolFn);

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-6",
      status: "auto_approved",
      execution_mode: "dry_run",
    });
    (client.confirm as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const wrapped = approvalTool(original, { client, agent: "test-agent" });

    await expect(wrapped.invoke({ query: "dry" })).rejects.toThrow(
      ApprovalDryRunResult,
    );

    expect(toolFn).not.toHaveBeenCalled();
    expect(client.confirm).toHaveBeenCalledWith({
      request_id: "req-6",
      success: true,
      result: { dry_run: true, tool: "search", params: { query: "dry" } },
      confirmed_by: "test-agent",
    });
  });

  it("confirms failure when the original tool throws", async () => {
    const original = makeTestTool(async () => {
      throw new Error("Tool broke");
    });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-7",
      status: "auto_approved",
      execution_mode: "live",
    });
    (client.confirm as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const wrapped = approvalTool(original, { client, agent: "test-agent" });

    await expect(wrapped.invoke({ query: "fail" })).rejects.toThrow(
      "Tool broke",
    );

    expect(client.confirm).toHaveBeenCalledWith({
      request_id: "req-7",
      success: false,
      error: "Tool broke",
      confirmed_by: "test-agent",
    });
  });

  it("passes risk and undo metadata through to AP", async () => {
    const original = makeTestTool();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-8",
      status: "auto_approved",
      execution_mode: "live",
    });
    (client.confirm as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const wrapped = approvalTool(original, {
      client,
      agent: "my-agent",
      risk: { reversible: false, blast_radius: "external" },
      undo: { type: "manual", description: "Contact support" },
    });

    await wrapped.invoke({ query: "important" });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        risk: { reversible: false, blast_radius: "external" },
      }),
    );
    expect(client.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        undo: { type: "manual", description: "Contact support" },
      }),
    );
  });

  it("uses custom timeout and pollInterval", async () => {
    const original = makeTestTool();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-9",
      status: "pending",
      execution_mode: "live",
    });
    (client.waitForDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-9",
      status: "approved",
    });
    (client.confirm as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const wrapped = approvalTool(original, {
      client,
      agent: "test-agent",
      timeout: 60,
      pollInterval: 500,
    });

    await wrapped.invoke({ query: "custom" });

    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60 }),
    );
    expect(client.waitForDecision).toHaveBeenCalledWith("req-9", {
      timeout: 60_000,
      pollInterval: 500,
    });
  });

  it("does not mask the original error if confirm fails", async () => {
    const original = makeTestTool(async () => {
      throw new Error("Original error");
    });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: "req-10",
      status: "auto_approved",
      execution_mode: "live",
    });
    (client.confirm as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Confirm failed"),
    );

    const wrapped = approvalTool(original, { client, agent: "test-agent" });

    await expect(wrapped.invoke({ query: "double-fail" })).rejects.toThrow(
      "Original error",
    );
  });
});
