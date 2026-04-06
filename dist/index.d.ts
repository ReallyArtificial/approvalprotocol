export { A as ApAction, a as ApAuditItem, b as ApAuditResult, c as ApChannel, d as ApConfirmParams, e as ApConfirmResult, f as ApContext, g as ApDecideParams, h as ApDecideResult, i as ApError, j as ApErrorCode, k as ApExecutionInfo, l as ApNegotiateRequest, m as ApNegotiateResponse, n as ApPolicy, o as ApRequestParams, p as ApRequestResult, q as ApRiskMetadata, r as ApRollbackParams, s as ApRollbackResult, t as ApServerConfig, u as ApStatusResult, v as ApUndoMetadata, B as BlastRadius, D as Decision, E as EstimatedImpact, w as ExecutionMode, x as ExecutionStatus, F as FinalStatus, P as PolicyRequires, R as RequestStatus, T as TrustLevel, U as UndoType } from './types-DjTePD_w.js';
import { z } from 'zod';
export { ApprovalServer, ApprovalStore, CliChannel, WebhookChannel, WebhookChannelConfig, createRouter } from './server/index.js';
export { ApprovalClient, ApprovalClientConfig, DryRunResult, WithApprovalConfig, withApproval } from './client/index.js';
import 'hono';
import 'hono/types';

declare const BlastRadiusSchema: z.ZodEnum<["self", "single_user", "team", "org", "external", "public"]>;
declare const EstimatedImpactSchema: z.ZodEnum<["financial", "data", "communication", "system"]>;
declare const ApRiskMetadataSchema: z.ZodObject<{
    reversible: z.ZodBoolean;
    blast_radius: z.ZodEnum<["self", "single_user", "team", "org", "external", "public"]>;
    confidence: z.ZodOptional<z.ZodNumber>;
    estimated_impact: z.ZodOptional<z.ZodEnum<["financial", "data", "communication", "system"]>>;
}, "strip", z.ZodTypeAny, {
    reversible: boolean;
    blast_radius: "self" | "single_user" | "team" | "org" | "external" | "public";
    confidence?: number | undefined;
    estimated_impact?: "financial" | "data" | "communication" | "system" | undefined;
}, {
    reversible: boolean;
    blast_radius: "self" | "single_user" | "team" | "org" | "external" | "public";
    confidence?: number | undefined;
    estimated_impact?: "financial" | "data" | "communication" | "system" | undefined;
}>;
declare const ApActionSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    params: Record<string, unknown>;
    name: string;
    description?: string | undefined;
}, {
    params: Record<string, unknown>;
    name: string;
    description?: string | undefined;
}>;
declare const ApContextSchema: z.ZodObject<{
    agent: z.ZodString;
    session: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    agent: string;
    reason?: string | undefined;
    session?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    agent: string;
    reason?: string | undefined;
    session?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
declare const PolicyRequiresSchema: z.ZodEnum<["always", "never", "conditional"]>;
declare const ExecutionModeSchema: z.ZodEnum<["live", "sandbox", "dry_run"]>;
declare const ApPolicySchema: z.ZodObject<{
    requires: z.ZodEnum<["always", "never", "conditional"]>;
    when: z.ZodOptional<z.ZodString>;
    execution: z.ZodOptional<z.ZodEnum<["live", "sandbox", "dry_run"]>>;
}, "strip", z.ZodTypeAny, {
    requires: "always" | "never" | "conditional";
    when?: string | undefined;
    execution?: "live" | "sandbox" | "dry_run" | undefined;
}, {
    requires: "always" | "never" | "conditional";
    when?: string | undefined;
    execution?: "live" | "sandbox" | "dry_run" | undefined;
}>;
declare const UndoTypeSchema: z.ZodEnum<["api_call", "function", "manual", "none"]>;
declare const ApUndoMetadataSchema: z.ZodObject<{
    type: z.ZodEnum<["api_call", "function", "manual", "none"]>;
    description: z.ZodOptional<z.ZodString>;
    instructions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "function" | "api_call" | "manual" | "none";
    description?: string | undefined;
    instructions?: Record<string, unknown> | undefined;
}, {
    type: "function" | "api_call" | "manual" | "none";
    description?: string | undefined;
    instructions?: Record<string, unknown> | undefined;
}>;
declare const ApNegotiateRequestSchema: z.ZodObject<{
    agent: z.ZodString;
    capabilities: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    agent: string;
    capabilities: string[];
}, {
    agent: string;
    capabilities: string[];
}>;
declare const ApRequestParamsSchema: z.ZodObject<{
    action: z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        params: Record<string, unknown>;
        name: string;
        description?: string | undefined;
    }, {
        params: Record<string, unknown>;
        name: string;
        description?: string | undefined;
    }>;
    context: z.ZodObject<{
        agent: z.ZodString;
        session: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        agent: string;
        reason?: string | undefined;
        session?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }, {
        agent: string;
        reason?: string | undefined;
        session?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    }>;
    risk: z.ZodOptional<z.ZodObject<{
        reversible: z.ZodBoolean;
        blast_radius: z.ZodEnum<["self", "single_user", "team", "org", "external", "public"]>;
        confidence: z.ZodOptional<z.ZodNumber>;
        estimated_impact: z.ZodOptional<z.ZodEnum<["financial", "data", "communication", "system"]>>;
    }, "strip", z.ZodTypeAny, {
        reversible: boolean;
        blast_radius: "self" | "single_user" | "team" | "org" | "external" | "public";
        confidence?: number | undefined;
        estimated_impact?: "financial" | "data" | "communication" | "system" | undefined;
    }, {
        reversible: boolean;
        blast_radius: "self" | "single_user" | "team" | "org" | "external" | "public";
        confidence?: number | undefined;
        estimated_impact?: "financial" | "data" | "communication" | "system" | undefined;
    }>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    callback_url: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: {
        params: Record<string, unknown>;
        name: string;
        description?: string | undefined;
    };
    context: {
        agent: string;
        reason?: string | undefined;
        session?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    };
    risk?: {
        reversible: boolean;
        blast_radius: "self" | "single_user" | "team" | "org" | "external" | "public";
        confidence?: number | undefined;
        estimated_impact?: "financial" | "data" | "communication" | "system" | undefined;
    } | undefined;
    timeout?: number | undefined;
    callback_url?: string | undefined;
}, {
    action: {
        params: Record<string, unknown>;
        name: string;
        description?: string | undefined;
    };
    context: {
        agent: string;
        reason?: string | undefined;
        session?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
    };
    risk?: {
        reversible: boolean;
        blast_radius: "self" | "single_user" | "team" | "org" | "external" | "public";
        confidence?: number | undefined;
        estimated_impact?: "financial" | "data" | "communication" | "system" | undefined;
    } | undefined;
    timeout?: number | undefined;
    callback_url?: string | undefined;
}>;
declare const DecisionSchema: z.ZodEnum<["approve", "deny", "edit"]>;
declare const ApDecideParamsSchema: z.ZodObject<{
    request_id: z.ZodString;
    decision: z.ZodEnum<["approve", "deny", "edit"]>;
    modified_params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    reason: z.ZodOptional<z.ZodString>;
    decided_by: z.ZodString;
}, "strip", z.ZodTypeAny, {
    request_id: string;
    decision: "approve" | "deny" | "edit";
    decided_by: string;
    modified_params?: Record<string, unknown> | undefined;
    reason?: string | undefined;
}, {
    request_id: string;
    decision: "approve" | "deny" | "edit";
    decided_by: string;
    modified_params?: Record<string, unknown> | undefined;
    reason?: string | undefined;
}>;
declare const ApConfirmParamsSchema: z.ZodObject<{
    request_id: z.ZodString;
    success: z.ZodBoolean;
    result: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    undo: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<["api_call", "function", "manual", "none"]>;
        description: z.ZodOptional<z.ZodString>;
        instructions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        type: "function" | "api_call" | "manual" | "none";
        description?: string | undefined;
        instructions?: Record<string, unknown> | undefined;
    }, {
        type: "function" | "api_call" | "manual" | "none";
        description?: string | undefined;
        instructions?: Record<string, unknown> | undefined;
    }>>;
    error: z.ZodOptional<z.ZodString>;
    confirmed_by: z.ZodString;
}, "strip", z.ZodTypeAny, {
    request_id: string;
    success: boolean;
    confirmed_by: string;
    result?: Record<string, unknown> | undefined;
    undo?: {
        type: "function" | "api_call" | "manual" | "none";
        description?: string | undefined;
        instructions?: Record<string, unknown> | undefined;
    } | undefined;
    error?: string | undefined;
}, {
    request_id: string;
    success: boolean;
    confirmed_by: string;
    result?: Record<string, unknown> | undefined;
    undo?: {
        type: "function" | "api_call" | "manual" | "none";
        description?: string | undefined;
        instructions?: Record<string, unknown> | undefined;
    } | undefined;
    error?: string | undefined;
}>;
declare const ApRollbackParamsSchema: z.ZodObject<{
    request_id: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
    initiated_by: z.ZodString;
}, "strip", z.ZodTypeAny, {
    request_id: string;
    initiated_by: string;
    reason?: string | undefined;
}, {
    request_id: string;
    initiated_by: string;
    reason?: string | undefined;
}>;

export { ApActionSchema, ApConfirmParamsSchema, ApContextSchema, ApDecideParamsSchema, ApNegotiateRequestSchema, ApPolicySchema, ApRequestParamsSchema, ApRiskMetadataSchema, ApRollbackParamsSchema, ApUndoMetadataSchema, BlastRadiusSchema, DecisionSchema, EstimatedImpactSchema, ExecutionModeSchema, PolicyRequiresSchema, UndoTypeSchema };
