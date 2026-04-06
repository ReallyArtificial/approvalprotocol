import * as hono from 'hono';
import { Hono } from 'hono';
import * as hono_types from 'hono/types';
import { n as ApPolicy, T as TrustLevel, A as ApAction, f as ApContext, q as ApRiskMetadata, w as ExecutionMode, u as ApStatusResult, v as ApUndoMetadata, a as ApAuditItem, c as ApChannel, t as ApServerConfig } from '../types-DjTePD_w.js';

declare class ApprovalStore {
    private db;
    constructor(dbPath?: string);
    private init;
    setPolicy(actionName: string, policy: ApPolicy): void;
    getPolicy(actionName: string): ApPolicy | null;
    getAllPolicies(): Record<string, ApPolicy>;
    createSession(id: string, agent: string, trustLevel?: TrustLevel): void;
    getSession(id: string): {
        id: string;
        agent: string;
        trust_level: string;
        created_at: string;
        expires_at: string | null;
    } | undefined;
    createRequest(params: {
        id: string;
        action: ApAction;
        context: ApContext;
        risk?: ApRiskMetadata;
        status: string;
        execution_mode: ExecutionMode;
        callback_url?: string;
        expires_at?: string;
    }): void;
    getRequest(id: string): ApStatusResult | null;
    recordDecision(params: {
        request_id: string;
        decision: string;
        modified_params?: Record<string, unknown>;
        reason?: string;
        decided_by: string;
    }): void;
    confirmExecution(params: {
        request_id: string;
        success: boolean;
        result?: Record<string, unknown>;
        undo?: ApUndoMetadata;
        error?: string;
        confirmed_by: string;
    }): void;
    recordRollback(params: {
        request_id: string;
        reason?: string;
        initiated_by: string;
    }): void;
    getUndoInfo(requestId: string): ApUndoMetadata | null;
    getExecutionMode(requestId: string): ExecutionMode;
    getCallbackUrl(requestId: string): string | null;
    getAuditLog(limit?: number, offset?: number): {
        items: ApAuditItem[];
        total: number;
    };
    private rowToStatus;
    close(): void;
}

declare function createRouter(store: ApprovalStore, channel: ApChannel): Hono;

declare class CliChannel implements ApChannel {
    name: string;
    private decideUrl;
    constructor(serverUrl?: string);
    notify(request: ApStatusResult): Promise<void>;
}

interface WebhookChannelConfig {
    url: string;
    headers?: Record<string, string>;
}
declare class WebhookChannel implements ApChannel {
    name: string;
    private url;
    private headers;
    constructor(config: WebhookChannelConfig);
    notify(request: ApStatusResult): Promise<void>;
}

declare class ApprovalServer {
    private store;
    private channel;
    private port;
    private server;
    readonly app: hono.Hono<hono_types.BlankEnv, hono_types.BlankSchema, "/">;
    constructor(config: ApServerConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    setPolicy(actionName: string, policy: ApPolicy): void;
    /** Direct access to store for testing */
    getStore(): ApprovalStore;
}

export { ApChannel, ApprovalServer, ApprovalStore, CliChannel, WebhookChannel, type WebhookChannelConfig, createRouter };
