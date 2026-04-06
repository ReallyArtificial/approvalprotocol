import type { ApprovalClient } from "./index.js";
import type { ApRiskMetadata, ApUndoMetadata, ExecutionMode } from "../types.js";

export interface WithApprovalConfig {
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
export class DryRunResult {
  readonly dryRun = true;
  constructor(
    public readonly requestId: string,
    public readonly executionMode: ExecutionMode,
    public readonly action: string,
    public readonly params: Record<string, unknown>
  ) {}
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
export function withApproval<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  config: WithApprovalConfig
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const params = config.mapParams
      ? config.mapParams(...args)
      : { args };

    const agentName = config.agent ?? "unknown";

    const { request_id, status, execution_mode } = await config.client.request({
      action: { name: config.action, params },
      context: { agent: agentName },
      risk: config.risk,
      timeout: config.timeout,
    });

    // Auto-denied by policy
    if (status === "auto_denied") {
      throw new Error(`Action "${config.action}" was auto-denied by policy`);
    }

    // If not auto-approved, wait for human decision
    if (status === "pending") {
      const result = await config.client.waitForDecision(request_id, {
        timeout: (config.timeout ?? 300) * 1000,
        pollInterval: config.pollInterval ?? 1000,
      });

      if (result.status === "denied") {
        throw new Error(
          `Action "${config.action}" was denied${
            result.decision?.reason ? `: ${result.decision.reason}` : ""
          }`
        );
      }

      if (result.status === "expired") {
        throw new Error(`Action "${config.action}" expired before a decision was made`);
      }
    }

    // Dry run mode: don't execute, confirm as dry run
    if (execution_mode === "dry_run") {
      await config.client.confirm({
        request_id,
        success: true,
        result: { dry_run: true, action: config.action, params },
        confirmed_by: agentName,
      });
      throw new DryRunResult(request_id, execution_mode, config.action, params);
    }

    // Execute the function
    try {
      const result = await fn(...args);

      // Build undo metadata
      const undo = config.buildUndo
        ? config.buildUndo(result, args)
        : config.undo;

      // Confirm successful execution
      await config.client.confirm({
        request_id,
        success: true,
        result: result != null ? { value: result } : undefined,
        undo,
        confirmed_by: agentName,
      });

      return result;
    } catch (err) {
      // Confirm failed execution
      const errorMessage = err instanceof Error ? err.message : String(err);

      await config.client.confirm({
        request_id,
        success: false,
        error: errorMessage,
        confirmed_by: agentName,
      }).catch(() => {
        // Don't mask the original error
      });

      throw err;
    }
  };
}
