import Database from "better-sqlite3";
import type {
  ApAction,
  ApContext,
  ApRiskMetadata,
  ApPolicy,
  ApStatusResult,
  ApAuditItem,
  ApUndoMetadata,
  ApExecutionInfo,
  FinalStatus,
  ExecutionStatus,
  ExecutionMode,
  TrustLevel,
} from "../types.js";

export class ApprovalStore {
  private db: Database.Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init() {
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

  setPolicy(actionName: string, policy: ApPolicy) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO policies (action_name, requires, condition, execution_mode)
         VALUES (?, ?, ?, ?)`
      )
      .run(actionName, policy.requires, policy.when ?? null, policy.execution ?? "live");
  }

  getPolicy(actionName: string): ApPolicy | null {
    const row = this.db
      .prepare("SELECT requires, condition, execution_mode FROM policies WHERE action_name = ?")
      .get(actionName) as { requires: string; condition: string | null; execution_mode: string | null } | undefined;
    if (!row) return null;
    const policy: ApPolicy = {
      requires: row.requires as ApPolicy["requires"],
      when: row.condition ?? undefined,
    };
    if (row.execution_mode && row.execution_mode !== "live") {
      policy.execution = row.execution_mode as ExecutionMode;
    }
    return policy;
  }

  getAllPolicies(): Record<string, ApPolicy> {
    const rows = this.db
      .prepare("SELECT action_name, requires, condition, execution_mode FROM policies")
      .all() as { action_name: string; requires: string; condition: string | null; execution_mode: string | null }[];
    const result: Record<string, ApPolicy> = {};
    for (const row of rows) {
      const policy: ApPolicy = {
        requires: row.requires as ApPolicy["requires"],
        when: row.condition ?? undefined,
      };
      if (row.execution_mode && row.execution_mode !== "live") {
        policy.execution = row.execution_mode as ExecutionMode;
      }
      result[row.action_name] = policy;
    }
    return result;
  }

  // ── Sessions ───────────────────────────────────────────────

  createSession(id: string, agent: string, trustLevel: TrustLevel = "new") {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id, agent, trust_level, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, agent, trustLevel, now);
  }

  getSession(id: string) {
    return this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as
      | { id: string; agent: string; trust_level: string; created_at: string; expires_at: string | null }
      | undefined;
  }

  // ── Requests ───────────────────────────────────────────────

  createRequest(params: {
    id: string;
    action: ApAction;
    context: ApContext;
    risk?: ApRiskMetadata;
    status: string;
    execution_mode: ExecutionMode;
    callback_url?: string;
    expires_at?: string;
  }) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO approval_requests
         (id, action_name, action_params, action_description, context, risk, status, execution_mode, callback_url, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
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

  getRequest(id: string): ApStatusResult | null {
    const row = this.db
      .prepare("SELECT * FROM approval_requests WHERE id = ?")
      .get(id) as Record<string, string | null> | undefined;
    if (!row) return null;
    return this.rowToStatus(row);
  }

  recordDecision(params: {
    request_id: string;
    decision: string;
    modified_params?: Record<string, unknown>;
    reason?: string;
    decided_by: string;
  }) {
    const now = new Date().toISOString();
    const statusMap: Record<string, FinalStatus> = {
      approve: "approved",
      deny: "denied",
      edit: "edited",
    };
    const status = statusMap[params.decision] ?? "approved";

    this.db
      .prepare(
        `UPDATE approval_requests
         SET status = ?, decision = ?, modified_params = ?,
             decision_reason = ?, decided_by = ?, decided_at = ?
         WHERE id = ?`
      )
      .run(
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

  confirmExecution(params: {
    request_id: string;
    success: boolean;
    result?: Record<string, unknown>;
    undo?: ApUndoMetadata;
    error?: string;
    confirmed_by: string;
  }) {
    const now = new Date().toISOString();
    const executionStatus: ExecutionStatus = params.success ? "confirmed" : "failed";

    this.db
      .prepare(
        `UPDATE approval_requests
         SET execution_status = ?, execution_result = ?, execution_error = ?,
             undo_type = ?, undo_description = ?, undo_instructions = ?,
             confirmed_by = ?, confirmed_at = ?
         WHERE id = ?`
      )
      .run(
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

  recordRollback(params: {
    request_id: string;
    reason?: string;
    initiated_by: string;
  }) {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE approval_requests
         SET execution_status = 'rolled_back', rollback_reason = ?,
             rolled_back_by = ?, rolled_back_at = ?
         WHERE id = ?`
      )
      .run(
        params.reason ?? null,
        params.initiated_by,
        now,
        params.request_id
      );
  }

  getUndoInfo(requestId: string): ApUndoMetadata | null {
    const row = this.db
      .prepare("SELECT undo_type, undo_description, undo_instructions FROM approval_requests WHERE id = ?")
      .get(requestId) as { undo_type: string | null; undo_description: string | null; undo_instructions: string | null } | undefined;

    if (!row || !row.undo_type) return null;

    return {
      type: row.undo_type as ApUndoMetadata["type"],
      description: row.undo_description ?? undefined,
      instructions: row.undo_instructions ? JSON.parse(row.undo_instructions) : undefined,
    };
  }

  getExecutionMode(requestId: string): ExecutionMode {
    const row = this.db
      .prepare("SELECT execution_mode FROM approval_requests WHERE id = ?")
      .get(requestId) as { execution_mode: string | null } | undefined;
    return (row?.execution_mode as ExecutionMode) ?? "live";
  }

  getCallbackUrl(requestId: string): string | null {
    const row = this.db
      .prepare("SELECT callback_url FROM approval_requests WHERE id = ?")
      .get(requestId) as { callback_url: string | null } | undefined;
    return row?.callback_url ?? null;
  }

  // ── Audit ──────────────────────────────────────────────────

  getAuditLog(limit: number = 50, offset: number = 0): { items: ApAuditItem[]; total: number } {
    const total = (
      this.db.prepare("SELECT COUNT(*) as count FROM approval_requests").get() as { count: number }
    ).count;

    const rows = this.db
      .prepare(
        `SELECT id, action_name, status, execution_status, decided_by, created_at, decided_at
         FROM approval_requests
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as {
      id: string;
      action_name: string;
      status: string;
      execution_status: string | null;
      decided_by: string | null;
      created_at: string;
      decided_at: string | null;
    }[];

    return {
      items: rows.map((row) => ({
        request_id: row.id,
        action_name: row.action_name,
        status: row.status as FinalStatus,
        execution_status: (row.execution_status as ExecutionStatus) ?? undefined,
        decided_by: row.decided_by ?? undefined,
        created_at: row.created_at,
        decided_at: row.decided_at ?? undefined,
      })),
      total,
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private rowToStatus(row: Record<string, string | null>): ApStatusResult {
    const result: ApStatusResult = {
      request_id: row.id!,
      status: row.status as FinalStatus,
      action: {
        name: row.action_name!,
        description: row.action_description ?? undefined,
        params: JSON.parse(row.action_params!),
      },
      created_at: row.created_at!,
      decided_at: row.decided_at ?? undefined,
    };

    if (row.decision) {
      result.decision = {
        decision: row.decision as "approve" | "deny" | "edit",
        reason: row.decision_reason ?? undefined,
        decided_by: row.decided_by ?? "unknown",
        modified_params: row.modified_params
          ? JSON.parse(row.modified_params)
          : undefined,
      };
    }

    // Build execution info if any execution data exists
    if (row.execution_status || row.execution_mode) {
      const mode = (row.execution_mode as ExecutionMode) ?? "live";
      const execStatus = (row.execution_status as ExecutionStatus) ?? "pending_execution";

      const execution: ApExecutionInfo = {
        status: execStatus,
        mode,
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

      // Attach undo info if present
      if (row.undo_type) {
        execution.undo = {
          type: row.undo_type as ApUndoMetadata["type"],
          description: row.undo_description ?? undefined,
          instructions: row.undo_instructions ? JSON.parse(row.undo_instructions) : undefined,
        };
      }

      result.execution = execution;
    }

    return result;
  }

  close() {
    this.db.close();
  }
}
