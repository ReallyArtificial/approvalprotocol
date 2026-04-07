import { z } from "zod";

// ── Risk Metadata ──────────────────────────────────────────────

export const BlastRadiusSchema = z.enum([
  "self",
  "single_user",
  "team",
  "org",
  "external",
  "public",
]);

export const EstimatedImpactSchema = z.enum([
  "financial",
  "data",
  "communication",
  "system",
]);

export const ApRiskMetadataSchema = z.object({
  reversible: z.boolean(),
  blast_radius: BlastRadiusSchema,
  confidence: z.number().min(0).max(1).optional(),
  estimated_impact: EstimatedImpactSchema.optional(),
});

// ── Action ─────────────────────────────────────────────────────

export const ApActionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  params: z.record(z.unknown()),
});

// ── Context ────────────────────────────────────────────────────

export const ApContextSchema = z.object({
  agent: z.string().min(1),
  session: z.string().optional(),
  reason: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── Policy & Execution Mode ────────────────────────────────────

export const PolicyRequiresSchema = z.enum(["always", "never", "conditional"]);

export const ExecutionModeSchema = z.enum(["live", "sandbox", "dry_run"]);

export const ApPolicySchema = z.object({
  requires: PolicyRequiresSchema,
  when: z.string().optional(),
  execution: ExecutionModeSchema.optional(),
});

// ── Undo Metadata ──────────────────────────────────────────────

export const UndoTypeSchema = z.enum(["api_call", "function", "manual", "none"]);

export const ApUndoMetadataSchema = z.object({
  type: UndoTypeSchema,
  description: z.string().optional(),
  instructions: z.record(z.unknown()).optional(),
});

// ── ap/negotiate ───────────────────────────────────────────────

export const ApNegotiateRequestSchema = z.object({
  agent: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1),
});

// ── ap/request ─────────────────────────────────────────────────

export const ApRequestParamsSchema = z.object({
  action: ApActionSchema,
  context: ApContextSchema,
  risk: ApRiskMetadataSchema.optional(),
  timeout: z.number().positive().optional(),
  callback_url: z.string().url().optional(),
});

// ── ap/decide ──────────────────────────────────────────────────

export const DecisionSchema = z.enum(["approve", "deny", "edit"]);

export const ApDecideParamsSchema = z.object({
  request_id: z.string().min(1),
  decision: DecisionSchema,
  modified_params: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
  decided_by: z.string().min(1),
});

// ── ap/confirm ─────────────────────────────────────────────────

export const ApConfirmParamsSchema = z.object({
  request_id: z.string().min(1),
  success: z.boolean(),
  result: z.record(z.unknown()).optional(),
  undo: ApUndoMetadataSchema.optional(),
  error: z.string().optional(),
  confirmed_by: z.string().min(1),
});

// ── ap/rollback ────────────────────────────────────────────────

export const ApRollbackParamsSchema = z.object({
  request_id: z.string().min(1),
  reason: z.string().optional(),
  initiated_by: z.string().min(1),
});
