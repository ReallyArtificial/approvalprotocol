// ── Risk Metadata ──────────────────────────────────────────────

export type BlastRadius =
  | "self"
  | "single_user"
  | "team"
  | "org"
  | "external"
  | "public";

export type EstimatedImpact =
  | "financial"
  | "data"
  | "communication"
  | "system";

export interface ApRiskMetadata {
  reversible: boolean;
  blast_radius: BlastRadius;
  confidence?: number;
  estimated_impact?: EstimatedImpact;
}

// ── Action ─────────────────────────────────────────────────────

export interface ApAction {
  name: string;
  description?: string;
  params: Record<string, unknown>;
}

// ── Context ────────────────────────────────────────────────────

export interface ApContext {
  agent: string;
  session?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// ── Policy ─────────────────────────────────────────────────────

export type PolicyRequires = "always" | "never" | "conditional";

export type ExecutionMode = "live" | "sandbox" | "dry_run";

export interface ApPolicy {
  requires: PolicyRequires;
  when?: string;
  execution?: ExecutionMode;
}

// ── Trust Level ────────────────────────────────────────────────

export type TrustLevel = "new" | "standard" | "trusted" | "unrestricted";

// ── Undo Metadata ──────────────────────────────────────────────

export type UndoType = "api_call" | "function" | "manual" | "none";

export interface ApUndoMetadata {
  type: UndoType;
  description?: string;
  instructions?: Record<string, unknown>;
}

// ── Execution Status ───────────────────────────────────────────

export type ExecutionStatus =
  | "pending_execution"
  | "confirmed"
  | "failed"
  | "rolled_back"
  | "rollback_failed";

export interface ApExecutionInfo {
  status: ExecutionStatus;
  mode: ExecutionMode;
  result?: Record<string, unknown>;
  undo?: ApUndoMetadata;
  error?: string;
  confirmed_by?: string;
  confirmed_at?: string;
  rolled_back_by?: string;
  rolled_back_at?: string;
}

// ── ap/negotiate ───────────────────────────────────────────────

export interface ApNegotiateRequest {
  agent: string;
  capabilities: string[];
}

export interface ApNegotiateResponse {
  session_id: string;
  policies: Record<string, ApPolicy>;
  trust_level: TrustLevel;
}

// ── ap/request ─────────────────────────────────────────────────

export interface ApRequestParams {
  action: ApAction;
  context: ApContext;
  risk?: ApRiskMetadata;
  timeout?: number;
  callback_url?: string;
}

export type RequestStatus = "pending" | "auto_approved" | "auto_denied";

export interface ApRequestResult {
  request_id: string;
  status: RequestStatus;
  execution_mode: ExecutionMode;
  expires_at?: string;
}

// ── ap/decide ──────────────────────────────────────────────────

export type Decision = "approve" | "deny" | "edit";

export interface ApDecideParams {
  request_id: string;
  decision: Decision;
  modified_params?: Record<string, unknown>;
  reason?: string;
  decided_by: string;
}

export interface ApDecideResult {
  request_id: string;
  status: string;
  decided_at: string;
}

// ── ap/confirm ─────────────────────────────────────────────────

export interface ApConfirmParams {
  request_id: string;
  success: boolean;
  result?: Record<string, unknown>;
  undo?: ApUndoMetadata;
  error?: string;
  confirmed_by: string;
}

export interface ApConfirmResult {
  request_id: string;
  execution_status: ExecutionStatus;
  confirmed_at: string;
}

// ── ap/rollback ────────────────────────────────────────────────

export interface ApRollbackParams {
  request_id: string;
  reason?: string;
  initiated_by: string;
}

export interface ApRollbackResult {
  request_id: string;
  execution_status: ExecutionStatus;
  undo?: ApUndoMetadata;
  rolled_back_at: string;
}

// ── ap/status ──────────────────────────────────────────────────

export type FinalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "edited"
  | "expired";

export interface ApStatusResult {
  request_id: string;
  status: FinalStatus;
  action: ApAction;
  decision?: Omit<ApDecideParams, "request_id">;
  execution?: ApExecutionInfo;
  created_at: string;
  decided_at?: string;
}

// ── ap/audit ───────────────────────────────────────────────────

export interface ApAuditItem {
  request_id: string;
  action_name: string;
  status: FinalStatus;
  execution_status?: ExecutionStatus;
  decided_by?: string;
  created_at: string;
  decided_at?: string;
}

export interface ApAuditResult {
  items: ApAuditItem[];
  total: number;
}

// ── Error ──────────────────────────────────────────────────────

export type ApErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "POLICY_VIOLATION"
  | "EXPIRED"
  | "INTERNAL_ERROR";

export interface ApError {
  error: {
    code: ApErrorCode;
    message: string;
  };
}

// ── Server Config ──────────────────────────────────────────────

export interface ApServerConfig {
  port?: number;
  dbPath?: string;
  channel: ApChannel;
  policies?: Record<string, ApPolicy>;
}

// ── Channel Interface ──────────────────────────────────────────

export interface ApChannel {
  name: string;
  notify(request: ApStatusResult): Promise<void>;
}
