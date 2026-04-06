import type {
  ApNegotiateResponse,
  ApRequestParams,
  ApRequestResult,
  ApStatusResult,
  ApDecideParams,
  ApDecideResult,
  ApConfirmParams,
  ApConfirmResult,
  ApRollbackParams,
  ApRollbackResult,
} from "../types.js";

export interface ApprovalClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}

export class ApprovalClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(baseUrlOrConfig: string | ApprovalClientConfig) {
    if (typeof baseUrlOrConfig === "string") {
      this.baseUrl = baseUrlOrConfig.replace(/\/$/, "");
      this.headers = {};
    } else {
      this.baseUrl = baseUrlOrConfig.baseUrl.replace(/\/$/, "");
      this.headers = baseUrlOrConfig.headers ?? {};
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = data as { error?: { code: string; message: string } };
      throw new Error(
        err.error?.message ?? `HTTP ${res.status}: ${res.statusText}`
      );
    }
    return data as T;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers,
    });
    const data = await res.json();
    if (!res.ok) {
      const err = data as { error?: { code: string; message: string } };
      throw new Error(
        err.error?.message ?? `HTTP ${res.status}: ${res.statusText}`
      );
    }
    return data as T;
  }

  /** Negotiate a session — declare capabilities, get policies back */
  async negotiate(
    agent: string,
    capabilities: string[]
  ): Promise<ApNegotiateResponse> {
    return this.post<ApNegotiateResponse>("/ap/negotiate", {
      agent,
      capabilities,
    });
  }

  /** Request approval for an action */
  async request(params: ApRequestParams): Promise<ApRequestResult> {
    return this.post<ApRequestResult>("/ap/request", params);
  }

  /** Submit a decision on a pending request */
  async decide(params: ApDecideParams): Promise<ApDecideResult> {
    return this.post<ApDecideResult>("/ap/decide", params);
  }

  /** Confirm execution of an approved action — closes the lifecycle loop */
  async confirm(params: ApConfirmParams): Promise<ApConfirmResult> {
    return this.post<ApConfirmResult>("/ap/confirm", params);
  }

  /** Request rollback of a confirmed action */
  async rollback(params: ApRollbackParams): Promise<ApRollbackResult> {
    return this.post<ApRollbackResult>("/ap/rollback", params);
  }

  /** Check the status of an approval request */
  async status(requestId: string): Promise<ApStatusResult> {
    return this.get<ApStatusResult>(`/ap/status/${requestId}`);
  }

  /**
   * Poll until a request is resolved or times out.
   * Returns the final status result.
   */
  async waitForDecision(
    requestId: string,
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<ApStatusResult> {
    const timeout = options.timeout ?? 300_000; // 5 min default
    const pollInterval = options.pollInterval ?? 1_000; // 1s default
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const result = await this.status(requestId);
      if (result.status !== "pending") {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timed out waiting for decision on ${requestId}`);
  }
}

export { withApproval, DryRunResult } from "./wrappers.js";
export type { WithApprovalConfig } from "./wrappers.js";
