import { Hono } from "hono";
import type { ApprovalStore } from "./store.js";
import type { ApChannel, ApPolicy, ApRiskMetadata, FinalStatus, ExecutionMode } from "../types.js";
import {
  ApNegotiateRequestSchema,
  ApRequestParamsSchema,
  ApDecideParamsSchema,
  ApConfirmParamsSchema,
  ApRollbackParamsSchema,
} from "../schemas.js";

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

function evaluateCondition(
  expression: string,
  params: Record<string, unknown>,
  risk?: ApRiskMetadata
): boolean {
  try {
    const fn = new Function("params", "risk", `return !!(${expression})`);
    return fn(params, risk ?? {});
  } catch {
    // If condition evaluation fails, require approval (fail-safe)
    return true;
  }
}

export function createRouter(store: ApprovalStore, channel: ApChannel): Hono {
  const app = new Hono();

  // ── ap/negotiate ─────────────────────────────────────────

  app.post("/ap/negotiate", async (c) => {
    const body = await c.req.json();
    const parsed = ApNegotiateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: parsed.error.message } },
        400
      );
    }

    const { agent, capabilities } = parsed.data;
    const sessionId = generateId("sess");

    // Build policies for each capability
    const policies: Record<string, ApPolicy> = {};
    for (const cap of capabilities) {
      const policy = store.getPolicy(cap);
      policies[cap] = policy ?? { requires: "always" }; // default: require approval
    }

    store.createSession(sessionId, agent, "standard");

    return c.json({
      session_id: sessionId,
      policies,
      trust_level: "standard",
    });
  });

  // ── ap/request ───────────────────────────────────────────

  app.post("/ap/request", async (c) => {
    const body = await c.req.json();
    const parsed = ApRequestParamsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: parsed.error.message } },
        400
      );
    }

    const { action, context, risk, timeout, callback_url } = parsed.data;
    const requestId = generateId("req");

    // Evaluate policy
    const policy = store.getPolicy(action.name);
    const effectivePolicy = policy ?? { requires: "always" as const };

    let status: "pending" | "auto_approved" | "auto_denied";

    if (effectivePolicy.requires === "never") {
      status = "auto_approved";
    } else if (effectivePolicy.requires === "always") {
      status = "pending";
    } else {
      // conditional
      const needsApproval = evaluateCondition(
        effectivePolicy.when ?? "true",
        action.params,
        risk
      );
      status = needsApproval ? "pending" : "auto_approved";
    }

    // Resolve execution mode from policy (default: "live")
    const executionMode: ExecutionMode = effectivePolicy.execution ?? "live";

    const expiresAt =
      status === "pending"
        ? new Date(Date.now() + (timeout ?? 300) * 1000).toISOString()
        : undefined;

    store.createRequest({
      id: requestId,
      action,
      context,
      risk,
      status,
      execution_mode: executionMode,
      callback_url,
      expires_at: expiresAt,
    });

    // If pending, notify the channel
    if (status === "pending") {
      const requestData = store.getRequest(requestId);
      if (requestData) {
        channel.notify(requestData).catch((err) => {
          console.error(`Channel notification failed: ${err}`);
        });
      }
    }

    return c.json({
      request_id: requestId,
      status,
      execution_mode: executionMode,
      expires_at: expiresAt,
    });
  });

  // ── ap/decide ────────────────────────────────────────────

  app.post("/ap/decide", async (c) => {
    const body = await c.req.json();
    const parsed = ApDecideParamsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: parsed.error.message } },
        400
      );
    }

    const { request_id, decision, modified_params, reason, decided_by } =
      parsed.data;

    // Check request exists
    const existing = store.getRequest(request_id);
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Request not found" } },
        404
      );
    }

    if (existing.status !== "pending") {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: `Request already resolved with status: ${existing.status}`,
          },
        },
        400
      );
    }

    store.recordDecision({
      request_id,
      decision,
      modified_params,
      reason,
      decided_by,
    });

    const statusMap: Record<string, FinalStatus> = {
      approve: "approved",
      deny: "denied",
      edit: "edited",
    };

    // If there's a callback URL, notify it
    const callbackUrl = store.getCallbackUrl(request_id);
    if (callbackUrl) {
      const updated = store.getRequest(request_id);
      fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      }).catch((err) => {
        console.error(`Callback delivery failed: ${err}`);
      });
    }

    return c.json({
      request_id,
      status: statusMap[decision] ?? "approved",
      decided_at: new Date().toISOString(),
    });
  });

  // ── ap/confirm ───────────────────────────────────────────

  app.post("/ap/confirm", async (c) => {
    const body = await c.req.json();
    const parsed = ApConfirmParamsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: parsed.error.message } },
        400
      );
    }

    const { request_id, success, result, undo, error, confirmed_by } = parsed.data;

    // Check request exists
    const existing = store.getRequest(request_id);
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Request not found" } },
        404
      );
    }

    // Must be approved/edited/auto_approved to confirm execution
    const executableStatuses = ["approved", "edited", "auto_approved"];
    if (!executableStatuses.includes(existing.status)) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: `Cannot confirm execution for request with status: ${existing.status}. Must be approved or edited.`,
          },
        },
        400
      );
    }

    // Cannot re-confirm
    if (existing.execution?.status === "confirmed" || existing.execution?.status === "failed") {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: `Execution already confirmed with status: ${existing.execution.status}`,
          },
        },
        400
      );
    }

    store.confirmExecution({
      request_id,
      success,
      result,
      undo,
      error,
      confirmed_by,
    });

    const executionStatus = success ? "confirmed" : "failed";

    // Callback notification for execution confirmation
    const callbackUrl = store.getCallbackUrl(request_id);
    if (callbackUrl) {
      const updated = store.getRequest(request_id);
      fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      }).catch((err) => {
        console.error(`Callback delivery failed: ${err}`);
      });
    }

    return c.json({
      request_id,
      execution_status: executionStatus,
      confirmed_at: new Date().toISOString(),
    });
  });

  // ── ap/rollback ──────────────────────────────────────────

  app.post("/ap/rollback", async (c) => {
    const body = await c.req.json();
    const parsed = ApRollbackParamsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: parsed.error.message } },
        400
      );
    }

    const { request_id, reason, initiated_by } = parsed.data;

    // Check request exists
    const existing = store.getRequest(request_id);
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Request not found" } },
        404
      );
    }

    // Must be confirmed to roll back
    if (existing.execution?.status !== "confirmed") {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: `Cannot rollback request with execution status: ${existing.execution?.status ?? "none"}. Must be confirmed.`,
          },
        },
        400
      );
    }

    store.recordRollback({
      request_id,
      reason,
      initiated_by,
    });

    // Get undo instructions to return
    const undo = store.getUndoInfo(request_id);

    // Callback notification for rollback
    const callbackUrl = store.getCallbackUrl(request_id);
    if (callbackUrl) {
      const updated = store.getRequest(request_id);
      fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      }).catch((err) => {
        console.error(`Callback delivery failed: ${err}`);
      });
    }

    return c.json({
      request_id,
      execution_status: "rolled_back",
      undo: undo ?? undefined,
      rolled_back_at: new Date().toISOString(),
    });
  });

  // ── ap/status ────────────────────────────────────────────

  app.get("/ap/status/:id", async (c) => {
    const id = c.req.param("id");
    const request = store.getRequest(id);

    if (!request) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Request not found" } },
        404
      );
    }

    return c.json(request);
  });

  // ── ap/audit ─────────────────────────────────────────────

  app.get("/ap/audit", async (c) => {
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const result = store.getAuditLog(limit, offset);
    return c.json(result);
  });

  // ── Health check ─────────────────────────────────────────

  app.get("/health", (c) => c.json({ status: "ok", protocol: "approval-protocol", version: "0.1.1" }));

  return app;
}
