type BlastRadius = "self" | "single_user" | "team" | "org" | "external" | "public";
type EstimatedImpact = "financial" | "data" | "communication" | "system";
interface ApRiskMetadata {
    reversible: boolean;
    blast_radius: BlastRadius;
    confidence?: number;
    estimated_impact?: EstimatedImpact;
}
interface ApAction {
    name: string;
    description?: string;
    params: Record<string, unknown>;
}
interface ApContext {
    agent: string;
    session?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
}
type PolicyRequires = "always" | "never" | "conditional";
type ExecutionMode = "live" | "sandbox" | "dry_run";
interface ApPolicy {
    requires: PolicyRequires;
    when?: string;
    execution?: ExecutionMode;
}
type TrustLevel = "new" | "standard" | "trusted" | "unrestricted";
type UndoType = "api_call" | "function" | "manual" | "none";
interface ApUndoMetadata {
    type: UndoType;
    description?: string;
    instructions?: Record<string, unknown>;
}
type ExecutionStatus = "pending_execution" | "confirmed" | "failed" | "rolled_back" | "rollback_failed";
interface ApExecutionInfo {
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
interface ApNegotiateRequest {
    agent: string;
    capabilities: string[];
}
interface ApNegotiateResponse {
    session_id: string;
    policies: Record<string, ApPolicy>;
    trust_level: TrustLevel;
}
interface ApRequestParams {
    action: ApAction;
    context: ApContext;
    risk?: ApRiskMetadata;
    timeout?: number;
    callback_url?: string;
}
type RequestStatus = "pending" | "auto_approved" | "auto_denied";
interface ApRequestResult {
    request_id: string;
    status: RequestStatus;
    execution_mode: ExecutionMode;
    expires_at?: string;
}
type Decision = "approve" | "deny" | "edit";
interface ApDecideParams {
    request_id: string;
    decision: Decision;
    modified_params?: Record<string, unknown>;
    reason?: string;
    decided_by: string;
}
interface ApDecideResult {
    request_id: string;
    status: string;
    decided_at: string;
}
interface ApConfirmParams {
    request_id: string;
    success: boolean;
    result?: Record<string, unknown>;
    undo?: ApUndoMetadata;
    error?: string;
    confirmed_by: string;
}
interface ApConfirmResult {
    request_id: string;
    execution_status: ExecutionStatus;
    confirmed_at: string;
}
interface ApRollbackParams {
    request_id: string;
    reason?: string;
    initiated_by: string;
}
interface ApRollbackResult {
    request_id: string;
    execution_status: ExecutionStatus;
    undo?: ApUndoMetadata;
    rolled_back_at: string;
}
type FinalStatus = "pending" | "approved" | "denied" | "edited" | "expired";
interface ApStatusResult {
    request_id: string;
    status: FinalStatus;
    action: ApAction;
    decision?: Omit<ApDecideParams, "request_id">;
    execution?: ApExecutionInfo;
    created_at: string;
    decided_at?: string;
}
interface ApAuditItem {
    request_id: string;
    action_name: string;
    status: FinalStatus;
    execution_status?: ExecutionStatus;
    decided_by?: string;
    created_at: string;
    decided_at?: string;
}
interface ApAuditResult {
    items: ApAuditItem[];
    total: number;
}
type ApErrorCode = "INVALID_REQUEST" | "NOT_FOUND" | "POLICY_VIOLATION" | "EXPIRED" | "INTERNAL_ERROR";
interface ApError {
    error: {
        code: ApErrorCode;
        message: string;
    };
}
interface ApServerConfig {
    port?: number;
    dbPath?: string;
    channel: ApChannel;
    policies?: Record<string, ApPolicy>;
}
interface ApChannel {
    name: string;
    notify(request: ApStatusResult): Promise<void>;
}

export type { ApAction as A, BlastRadius as B, Decision as D, EstimatedImpact as E, FinalStatus as F, PolicyRequires as P, RequestStatus as R, TrustLevel as T, UndoType as U, ApAuditItem as a, ApAuditResult as b, ApChannel as c, ApConfirmParams as d, ApConfirmResult as e, ApContext as f, ApDecideParams as g, ApDecideResult as h, ApError as i, ApErrorCode as j, ApExecutionInfo as k, ApNegotiateRequest as l, ApNegotiateResponse as m, ApPolicy as n, ApRequestParams as o, ApRequestResult as p, ApRiskMetadata as q, ApRollbackParams as r, ApRollbackResult as s, ApServerConfig as t, ApStatusResult as u, ApUndoMetadata as v, ExecutionMode as w, ExecutionStatus as x };
