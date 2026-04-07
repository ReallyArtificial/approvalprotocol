import { DynamicStructuredTool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { z } from "zod";
import type {
  ApprovalClient,
  ApRiskMetadata,
  ApUndoMetadata,
} from "@approval-protocol/core";

export interface ApprovalToolConfig {
  /** ApprovalClient instance pointed at your AP server */
  client: ApprovalClient;
  /** Agent identifier for the AP request context */
  agent: string;
  /** Risk metadata attached to every approval request */
  risk?: ApRiskMetadata;
  /** Static undo metadata — how to reverse this action */
  undo?: ApUndoMetadata;
  /** Timeout in seconds for waiting on a human decision (default: 300) */
  timeout?: number;
  /** Poll interval in ms when waiting for decision (default: 1000) */
  pollInterval?: number;
}

/** Thrown when the AP server returns dry_run execution mode */
export class ApprovalDryRunResult extends Error {
  readonly dryRun = true;

  constructor(
    public readonly requestId: string,
    public readonly toolName: string,
    public readonly toolInput: Record<string, unknown>,
  ) {
    super(
      `Dry run: "${toolName}" was not executed (request ${requestId})`,
    );
    this.name = "ApprovalDryRunResult";
  }
}

/** Thrown when a human denies the approval request */
export class ApprovalDeniedError extends Error {
  constructor(
    public readonly requestId: string,
    public readonly toolName: string,
    public readonly reason?: string,
  ) {
    super(
      `Action "${toolName}" was denied${reason ? `: ${reason}` : ""}`,
    );
    this.name = "ApprovalDeniedError";
  }
}

/**
 * Wraps a LangChain tool with the Approval Protocol lifecycle.
 *
 * Returns a new `DynamicStructuredTool` with the same name, description,
 * and schema — but its `func` runs the full AP flow:
 *   request → waitForDecision → invoke original → confirm
 *
 * The wrapped tool is a drop-in replacement that works in any LangChain
 * agent (ReAct, OpenAI Functions, custom chains, etc.).
 */
export function approvalTool<T extends z.ZodObject<z.ZodRawShape>>(
  tool: StructuredToolInterface<T>,
  config: ApprovalToolConfig,
): DynamicStructuredTool<T> {
  const { client, agent, risk, undo, timeout = 300, pollInterval = 1000 } =
    config;

  // Capture ref so we can call invoke inside the wrapper
  const originalTool = tool;

  return new DynamicStructuredTool<T>({
    name: tool.name,
    description: tool.description,
    schema: tool.schema as T,

    async func(
      input: z.infer<T>,
    ): Promise<string> {
      const params =
        typeof input === "object" && input !== null
          ? (input as Record<string, unknown>)
          : { input };

      // 1. Request approval
      const { request_id, status, execution_mode } = await client.request({
        action: { name: originalTool.name, params },
        context: { agent },
        risk,
        timeout,
      });

      // 2. Handle auto-denied
      if (status === "auto_denied") {
        throw new ApprovalDeniedError(request_id, originalTool.name);
      }

      // 3. Wait for human decision if pending
      if (status === "pending") {
        const result = await client.waitForDecision(request_id, {
          timeout: timeout * 1000,
          pollInterval,
        });

        if (result.status === "denied") {
          throw new ApprovalDeniedError(
            request_id,
            originalTool.name,
            result.decision?.reason,
          );
        }

        if (result.status === "expired") {
          throw new Error(
            `Action "${originalTool.name}" expired before a decision was made`,
          );
        }
      }

      // 4. Dry-run mode — don't execute, confirm as dry run
      if (execution_mode === "dry_run") {
        await client.confirm({
          request_id,
          success: true,
          result: { dry_run: true, tool: originalTool.name, params },
          confirmed_by: agent,
        });
        throw new ApprovalDryRunResult(request_id, originalTool.name, params);
      }

      // 5. Invoke the original tool
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (originalTool as any).invoke(input);

        // 6. Confirm success
        await client.confirm({
          request_id,
          success: true,
          result: { value: result },
          undo,
          confirmed_by: agent,
        });

        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        // 7. Confirm failure
        const errorMessage =
          err instanceof Error ? err.message : String(err);

        await client.confirm({
          request_id,
          success: false,
          error: errorMessage,
          confirmed_by: agent,
        }).catch(() => {
          // Don't mask the original error
        });

        throw err;
      }
    },
  });
}
