import { w as ExecutionMode, q as ApRiskMetadata, v as ApUndoMetadata, m as ApNegotiateResponse, o as ApRequestParams, p as ApRequestResult, g as ApDecideParams, h as ApDecideResult, d as ApConfirmParams, e as ApConfirmResult, r as ApRollbackParams, s as ApRollbackResult, u as ApStatusResult } from '../types-DjTePD_w.cjs';

interface WithApprovalConfig {
    action: string;
    client: ApprovalClient;
    agent?: string;
    risk?: ApRiskMetadata;
    timeout?: number;
    pollInterval?: number;
    /** Static undo metadata — how to reverse this action */
    undo?: ApUndoMetadata;
    /** Map function arguments to action params. Defaults to { args: [...args] } */
    mapParams?: (...args: unknown[]) => Record<string, unknown>;
    /**
     * Build undo metadata dynamically from the function result.
     * Called after successful execution. Overrides static `undo` if provided.
     */
    buildUndo?: (result: unknown, args: unknown[]) => ApUndoMetadata;
}
/** Thrown when policy dictates dry_run mode — action is not executed */
declare class DryRunResult {
    readonly requestId: string;
    readonly executionMode: ExecutionMode;
    readonly action: string;
    readonly params: Record<string, unknown>;
    readonly dryRun = true;
    constructor(requestId: string, executionMode: ExecutionMode, action: string, params: Record<string, unknown>);
}
/**
 * Wraps a function with the full approval lifecycle:
 * request → decide → execute → confirm (with undo metadata)
 *
 * - If approved: executes the function, auto-confirms with result + undo info
 * - If denied: throws with reason
 * - If dry_run mode: throws DryRunResult (action skipped, confirmed as dry run)
 * - If execution fails: auto-confirms as failed with error
 */
declare function withApproval<TArgs extends unknown[], TReturn>(fn: (...args: TArgs) => TReturn | Promise<TReturn>, config: WithApprovalConfig): (...args: TArgs) => Promise<TReturn>;

interface ApprovalClientConfig {
    baseUrl: string;
    headers?: Record<string, string>;
}
declare class ApprovalClient {
    private baseUrl;
    private headers;
    constructor(baseUrlOrConfig: string | ApprovalClientConfig);
    private post;
    private get;
    /** Negotiate a session — declare capabilities, get policies back */
    negotiate(agent: string, capabilities: string[]): Promise<ApNegotiateResponse>;
    /** Request approval for an action */
    request(params: ApRequestParams): Promise<ApRequestResult>;
    /** Submit a decision on a pending request */
    decide(params: ApDecideParams): Promise<ApDecideResult>;
    /** Confirm execution of an approved action — closes the lifecycle loop */
    confirm(params: ApConfirmParams): Promise<ApConfirmResult>;
    /** Request rollback of a confirmed action */
    rollback(params: ApRollbackParams): Promise<ApRollbackResult>;
    /** Check the status of an approval request */
    status(requestId: string): Promise<ApStatusResult>;
    /**
     * Poll until a request is resolved or times out.
     * Returns the final status result.
     */
    waitForDecision(requestId: string, options?: {
        timeout?: number;
        pollInterval?: number;
    }): Promise<ApStatusResult>;
}

export { ApprovalClient, type ApprovalClientConfig, DryRunResult, type WithApprovalConfig, withApproval };
