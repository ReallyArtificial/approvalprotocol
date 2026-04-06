// src/server/index.ts
import { serve } from "@hono/node-server";

// src/server/store.ts
import Database from "better-sqlite3";
var ApprovalStore = class {
  db;
  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }
  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        action_name TEXT NOT NULL,
        action_params TEXT NOT NULL,
        action_description TEXT,
        context TEXT NOT NULL,
        risk TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        decision TEXT,
        modified_params TEXT,
        decision_reason TEXT,
        decided_by TEXT,
        callback_url TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,

        -- Execution lifecycle (v0.1.1)
        execution_mode TEXT NOT NULL DEFAULT 'live',
        execution_status TEXT,
        execution_result TEXT,
        execution_error TEXT,
        confirmed_by TEXT,
        confirmed_at TEXT,

        -- Undo metadata
        undo_type TEXT,
        undo_description TEXT,
        undo_instructions TEXT,

        -- Rollback
        rollback_reason TEXT,
        rolled_back_by TEXT,
        rolled_back_at TEXT
      );

      CREATE TABLE IF NOT EXISTS policies (
        action_name TEXT PRIMARY KEY,
        requires TEXT NOT NULL,
        condition TEXT,
        execution_mode TEXT DEFAULT 'live'
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        trust_level TEXT NOT NULL DEFAULT 'new',
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
    `);
  }
  // ── Policies ───────────────────────────────────────────────
  setPolicy(actionName, policy) {
    this.db.prepare(
      `INSERT OR REPLACE INTO policies (action_name, requires, condition, execution_mode)
         VALUES (?, ?, ?, ?)`
    ).run(actionName, policy.requires, policy.when ?? null, policy.execution ?? "live");
  }
  getPolicy(actionName) {
    const row = this.db.prepare("SELECT requires, condition, execution_mode FROM policies WHERE action_name = ?").get(actionName);
    if (!row) return null;
    const policy = {
      requires: row.requires,
      when: row.condition ?? void 0
    };
    if (row.execution_mode && row.execution_mode !== "live") {
      policy.execution = row.execution_mode;
    }
    return policy;
  }
  getAllPolicies() {
    const rows = this.db.prepare("SELECT action_name, requires, condition, execution_mode FROM policies").all();
    const result = {};
    for (const row of rows) {
      const policy = {
        requires: row.requires,
        when: row.condition ?? void 0
      };
      if (row.execution_mode && row.execution_mode !== "live") {
        policy.execution = row.execution_mode;
      }
      result[row.action_name] = policy;
    }
    return result;
  }
  // ── Sessions ───────────────────────────────────────────────
  createSession(id, agent, trustLevel = "new") {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO sessions (id, agent, trust_level, created_at)
         VALUES (?, ?, ?, ?)`
    ).run(id, agent, trustLevel, now);
  }
  getSession(id) {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  }
  // ── Requests ───────────────────────────────────────────────
  createRequest(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO approval_requests
         (id, action_name, action_params, action_description, context, risk, status, execution_mode, callback_url, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.id,
      params.action.name,
      JSON.stringify(params.action.params),
      params.action.description ?? null,
      JSON.stringify(params.context),
      params.risk ? JSON.stringify(params.risk) : null,
      params.status,
      params.execution_mode,
      params.callback_url ?? null,
      params.expires_at ?? null,
      now
    );
  }
  getRequest(id) {
    const row = this.db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id);
    if (!row) return null;
    return this.rowToStatus(row);
  }
  recordDecision(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const statusMap = {
      approve: "approved",
      deny: "denied",
      edit: "edited"
    };
    const status = statusMap[params.decision] ?? "approved";
    this.db.prepare(
      `UPDATE approval_requests
         SET status = ?, decision = ?, modified_params = ?,
             decision_reason = ?, decided_by = ?, decided_at = ?
         WHERE id = ?`
    ).run(
      status,
      params.decision,
      params.modified_params ? JSON.stringify(params.modified_params) : null,
      params.reason ?? null,
      params.decided_by,
      now,
      params.request_id
    );
  }
  // ── Execution Lifecycle ────────────────────────────────────
  confirmExecution(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const executionStatus = params.success ? "confirmed" : "failed";
    this.db.prepare(
      `UPDATE approval_requests
         SET execution_status = ?, execution_result = ?, execution_error = ?,
             undo_type = ?, undo_description = ?, undo_instructions = ?,
             confirmed_by = ?, confirmed_at = ?
         WHERE id = ?`
    ).run(
      executionStatus,
      params.result ? JSON.stringify(params.result) : null,
      params.error ?? null,
      params.undo?.type ?? null,
      params.undo?.description ?? null,
      params.undo?.instructions ? JSON.stringify(params.undo.instructions) : null,
      params.confirmed_by,
      now,
      params.request_id
    );
  }
  recordRollback(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `UPDATE approval_requests
         SET execution_status = 'rolled_back', rollback_reason = ?,
             rolled_back_by = ?, rolled_back_at = ?
         WHERE id = ?`
    ).run(
      params.reason ?? null,
      params.initiated_by,
      now,
      params.request_id
    );
  }
  getUndoInfo(requestId) {
    const row = this.db.prepare("SELECT undo_type, undo_description, undo_instructions FROM approval_requests WHERE id = ?").get(requestId);
    if (!row || !row.undo_type) return null;
    return {
      type: row.undo_type,
      description: row.undo_description ?? void 0,
      instructions: row.undo_instructions ? JSON.parse(row.undo_instructions) : void 0
    };
  }
  getExecutionMode(requestId) {
    const row = this.db.prepare("SELECT execution_mode FROM approval_requests WHERE id = ?").get(requestId);
    return row?.execution_mode ?? "live";
  }
  getCallbackUrl(requestId) {
    const row = this.db.prepare("SELECT callback_url FROM approval_requests WHERE id = ?").get(requestId);
    return row?.callback_url ?? null;
  }
  // ── Audit ──────────────────────────────────────────────────
  getAuditLog(limit = 50, offset = 0) {
    const total = this.db.prepare("SELECT COUNT(*) as count FROM approval_requests").get().count;
    const rows = this.db.prepare(
      `SELECT id, action_name, status, execution_status, decided_by, created_at, decided_at
         FROM approval_requests
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
    ).all(limit, offset);
    return {
      items: rows.map((row) => ({
        request_id: row.id,
        action_name: row.action_name,
        status: row.status,
        execution_status: row.execution_status ?? void 0,
        decided_by: row.decided_by ?? void 0,
        created_at: row.created_at,
        decided_at: row.decided_at ?? void 0
      })),
      total
    };
  }
  // ── Helpers ────────────────────────────────────────────────
  rowToStatus(row) {
    const result = {
      request_id: row.id,
      status: row.status,
      action: {
        name: row.action_name,
        description: row.action_description ?? void 0,
        params: JSON.parse(row.action_params)
      },
      created_at: row.created_at,
      decided_at: row.decided_at ?? void 0
    };
    if (row.decision) {
      result.decision = {
        decision: row.decision,
        reason: row.decision_reason ?? void 0,
        decided_by: row.decided_by ?? "unknown",
        modified_params: row.modified_params ? JSON.parse(row.modified_params) : void 0
      };
    }
    if (row.execution_status || row.execution_mode) {
      const mode = row.execution_mode ?? "live";
      const execStatus = row.execution_status ?? "pending_execution";
      const execution = {
        status: execStatus,
        mode
      };
      if (row.execution_result) {
        execution.result = JSON.parse(row.execution_result);
      }
      if (row.execution_error) {
        execution.error = row.execution_error;
      }
      if (row.confirmed_by) {
        execution.confirmed_by = row.confirmed_by;
      }
      if (row.confirmed_at) {
        execution.confirmed_at = row.confirmed_at;
      }
      if (row.rolled_back_by) {
        execution.rolled_back_by = row.rolled_back_by;
      }
      if (row.rolled_back_at) {
        execution.rolled_back_at = row.rolled_back_at;
      }
      if (row.undo_type) {
        execution.undo = {
          type: row.undo_type,
          description: row.undo_description ?? void 0,
          instructions: row.undo_instructions ? JSON.parse(row.undo_instructions) : void 0
        };
      }
      result.execution = execution;
    }
    return result;
  }
  close() {
    this.db.close();
  }
};

// src/server/router.ts
import { Hono } from "hono";

// src/schemas.ts
import { z } from "zod";
var BlastRadiusSchema = z.enum([
  "self",
  "single_user",
  "team",
  "org",
  "external",
  "public"
]);
var EstimatedImpactSchema = z.enum([
  "financial",
  "data",
  "communication",
  "system"
]);
var ApRiskMetadataSchema = z.object({
  reversible: z.boolean(),
  blast_radius: BlastRadiusSchema,
  confidence: z.number().min(0).max(1).optional(),
  estimated_impact: EstimatedImpactSchema.optional()
});
var ApActionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  params: z.record(z.unknown())
});
var ApContextSchema = z.object({
  agent: z.string().min(1),
  session: z.string().optional(),
  reason: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
var PolicyRequiresSchema = z.enum(["always", "never", "conditional"]);
var ExecutionModeSchema = z.enum(["live", "sandbox", "dry_run"]);
var ApPolicySchema = z.object({
  requires: PolicyRequiresSchema,
  when: z.string().optional(),
  execution: ExecutionModeSchema.optional()
});
var UndoTypeSchema = z.enum(["api_call", "function", "manual", "none"]);
var ApUndoMetadataSchema = z.object({
  type: UndoTypeSchema,
  description: z.string().optional(),
  instructions: z.record(z.unknown()).optional()
});
var ApNegotiateRequestSchema = z.object({
  agent: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1)
});
var ApRequestParamsSchema = z.object({
  action: ApActionSchema,
  context: ApContextSchema,
  risk: ApRiskMetadataSchema.optional(),
  timeout: z.number().positive().optional(),
  callback_url: z.string().url().optional()
});
var DecisionSchema = z.enum(["approve", "deny", "edit"]);
var ApDecideParamsSchema = z.object({
  request_id: z.string().min(1),
  decision: DecisionSchema,
  modified_params: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
  decided_by: z.string().min(1)
});
var ApConfirmParamsSchema = z.object({
  request_id: z.string().min(1),
  success: z.boolean(),
  result: z.record(z.unknown()).optional(),
  undo: ApUndoMetadataSchema.optional(),
  error: z.string().optional(),
  confirmed_by: z.string().min(1)
});
var ApRollbackParamsSchema = z.object({
  request_id: z.string().min(1),
  reason: z.string().optional(),
  initiated_by: z.string().min(1)
});

// src/server/router.ts
function generateId(prefix) {
  const rand = Math.random().toString(36).substring(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}
function evaluateCondition(expression, params, risk) {
  try {
    const fn = new Function("params", "risk", `return !!(${expression})`);
    return fn(params, risk ?? {});
  } catch {
    return true;
  }
}
function createRouter(store, channel) {
  const app = new Hono();
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
    const policies = {};
    for (const cap of capabilities) {
      const policy = store.getPolicy(cap);
      policies[cap] = policy ?? { requires: "always" };
    }
    store.createSession(sessionId, agent, "standard");
    return c.json({
      session_id: sessionId,
      policies,
      trust_level: "standard"
    });
  });
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
    const policy = store.getPolicy(action.name);
    const effectivePolicy = policy ?? { requires: "always" };
    let status;
    if (effectivePolicy.requires === "never") {
      status = "auto_approved";
    } else if (effectivePolicy.requires === "always") {
      status = "pending";
    } else {
      const needsApproval = evaluateCondition(
        effectivePolicy.when ?? "true",
        action.params,
        risk
      );
      status = needsApproval ? "pending" : "auto_approved";
    }
    const executionMode = effectivePolicy.execution ?? "live";
    const expiresAt = status === "pending" ? new Date(Date.now() + (timeout ?? 300) * 1e3).toISOString() : void 0;
    store.createRequest({
      id: requestId,
      action,
      context,
      risk,
      status,
      execution_mode: executionMode,
      callback_url,
      expires_at: expiresAt
    });
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
      expires_at: expiresAt
    });
  });
  app.post("/ap/decide", async (c) => {
    const body = await c.req.json();
    const parsed = ApDecideParamsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: parsed.error.message } },
        400
      );
    }
    const { request_id, decision, modified_params, reason, decided_by } = parsed.data;
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
            message: `Request already resolved with status: ${existing.status}`
          }
        },
        400
      );
    }
    store.recordDecision({
      request_id,
      decision,
      modified_params,
      reason,
      decided_by
    });
    const statusMap = {
      approve: "approved",
      deny: "denied",
      edit: "edited"
    };
    const callbackUrl = store.getCallbackUrl(request_id);
    if (callbackUrl) {
      const updated = store.getRequest(request_id);
      fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      }).catch((err) => {
        console.error(`Callback delivery failed: ${err}`);
      });
    }
    return c.json({
      request_id,
      status: statusMap[decision] ?? "approved",
      decided_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
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
    const existing = store.getRequest(request_id);
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Request not found" } },
        404
      );
    }
    const executableStatuses = ["approved", "edited", "auto_approved"];
    if (!executableStatuses.includes(existing.status)) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: `Cannot confirm execution for request with status: ${existing.status}. Must be approved or edited.`
          }
        },
        400
      );
    }
    if (existing.execution?.status === "confirmed" || existing.execution?.status === "failed") {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: `Execution already confirmed with status: ${existing.execution.status}`
          }
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
      confirmed_by
    });
    const executionStatus = success ? "confirmed" : "failed";
    const callbackUrl = store.getCallbackUrl(request_id);
    if (callbackUrl) {
      const updated = store.getRequest(request_id);
      fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      }).catch((err) => {
        console.error(`Callback delivery failed: ${err}`);
      });
    }
    return c.json({
      request_id,
      execution_status: executionStatus,
      confirmed_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
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
    const existing = store.getRequest(request_id);
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Request not found" } },
        404
      );
    }
    if (existing.execution?.status !== "confirmed") {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: `Cannot rollback request with execution status: ${existing.execution?.status ?? "none"}. Must be confirmed.`
          }
        },
        400
      );
    }
    store.recordRollback({
      request_id,
      reason,
      initiated_by
    });
    const undo = store.getUndoInfo(request_id);
    const callbackUrl = store.getCallbackUrl(request_id);
    if (callbackUrl) {
      const updated = store.getRequest(request_id);
      fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      }).catch((err) => {
        console.error(`Callback delivery failed: ${err}`);
      });
    }
    return c.json({
      request_id,
      execution_status: "rolled_back",
      undo: undo ?? void 0,
      rolled_back_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
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
  app.get("/ap/audit", async (c) => {
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const result = store.getAuditLog(limit, offset);
    return c.json(result);
  });
  app.get("/health", (c) => c.json({ status: "ok", protocol: "approval-protocol", version: "0.1.1" }));
  return app;
}

// src/server/channels/cli.ts
import * as readline from "readline";
var CliChannel = class {
  name = "cli";
  decideUrl;
  constructor(serverUrl = "http://localhost:4000") {
    this.decideUrl = `${serverUrl}/ap/decide`;
  }
  async notify(request) {
    const { action, request_id } = request;
    const risk = request.decision ? void 0 : request;
    console.log("\n\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
    console.log("\u2502        APPROVAL REQUEST PENDING          \u2502");
    console.log("\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524");
    console.log(`\u2502  Request ID: ${request_id}`);
    console.log(`\u2502  Action:     ${action.name}`);
    if (action.description) {
      console.log(`\u2502  Desc:       ${action.description}`);
    }
    console.log(`\u2502  Params:     ${JSON.stringify(action.params)}`);
    console.log("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    const answer = await new Promise((resolve) => {
      rl.question("  [approve/deny] > ", (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    });
    const decision = answer === "deny" ? "deny" : "approve";
    try {
      await fetch(this.decideUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id,
          decision,
          decided_by: "cli_user",
          reason: `CLI ${decision}`
        })
      });
    } catch {
      console.error("  Failed to submit decision via HTTP, recording locally.");
    }
  }
};

// src/server/channels/webhook.ts
var WebhookChannel = class {
  name = "webhook";
  url;
  headers;
  constructor(config) {
    this.url = config.url;
    this.headers = config.headers ?? {};
  }
  async notify(request) {
    await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers
      },
      body: JSON.stringify({
        type: "approval_request",
        request_id: request.request_id,
        action: request.action,
        status: request.status,
        created_at: request.created_at
      })
    });
  }
};

// src/server/index.ts
var ApprovalServer = class {
  store;
  channel;
  port;
  server = null;
  app;
  constructor(config) {
    this.port = config.port ?? 4e3;
    this.channel = config.channel;
    this.store = new ApprovalStore(config.dbPath);
    if (config.policies) {
      for (const [action, policy] of Object.entries(config.policies)) {
        this.store.setPolicy(action, policy);
      }
    }
    this.app = createRouter(this.store, this.channel);
  }
  async start() {
    return new Promise((resolve) => {
      this.server = serve(
        { fetch: this.app.fetch, port: this.port },
        () => {
          console.log(`Approval Protocol server running on http://localhost:${this.port}`);
          resolve();
        }
      );
    });
  }
  async stop() {
    if (this.server) {
      await new Promise((resolve, reject) => {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.server = null;
    }
    this.store.close();
  }
  setPolicy(actionName, policy) {
    this.store.setPolicy(actionName, policy);
  }
  /** Direct access to store for testing */
  getStore() {
    return this.store;
  }
};
export {
  ApprovalServer,
  ApprovalStore,
  CliChannel,
  WebhookChannel,
  createRouter
};
//# sourceMappingURL=index.js.map