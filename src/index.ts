// ── Types ──────────────────────────────────────────────────────
export type {
  ApRiskMetadata,
  BlastRadius,
  EstimatedImpact,
  ApAction,
  ApContext,
  ApPolicy,
  PolicyRequires,
  ExecutionMode,
  TrustLevel,
  UndoType,
  ApUndoMetadata,
  ExecutionStatus,
  ApExecutionInfo,
  ApNegotiateRequest,
  ApNegotiateResponse,
  ApRequestParams,
  ApRequestResult,
  RequestStatus,
  ApDecideParams,
  ApDecideResult,
  Decision,
  ApConfirmParams,
  ApConfirmResult,
  ApRollbackParams,
  ApRollbackResult,
  ApStatusResult,
  FinalStatus,
  ApAuditItem,
  ApAuditResult,
  ApError,
  ApErrorCode,
  ApServerConfig,
  ApChannel,
} from "./types.js";

// ── Schemas ────────────────────────────────────────────────────
export {
  BlastRadiusSchema,
  EstimatedImpactSchema,
  ApRiskMetadataSchema,
  ApActionSchema,
  ApContextSchema,
  PolicyRequiresSchema,
  ExecutionModeSchema,
  ApPolicySchema,
  UndoTypeSchema,
  ApUndoMetadataSchema,
  ApNegotiateRequestSchema,
  ApRequestParamsSchema,
  DecisionSchema,
  ApDecideParamsSchema,
  ApConfirmParamsSchema,
  ApRollbackParamsSchema,
} from "./schemas.js";

// ── Server ─────────────────────────────────────────────────────
export { ApprovalServer, ApprovalStore, createRouter } from "./server/index.js";
export { CliChannel } from "./server/channels/cli.js";
export { WebhookChannel } from "./server/channels/webhook.js";
export type { WebhookChannelConfig } from "./server/channels/webhook.js";

// ── Client ─────────────────────────────────────────────────────
export { ApprovalClient } from "./client/index.js";
export { withApproval, DryRunResult } from "./client/wrappers.js";
export type { WithApprovalConfig } from "./client/wrappers.js";
export type { ApprovalClientConfig } from "./client/index.js";
