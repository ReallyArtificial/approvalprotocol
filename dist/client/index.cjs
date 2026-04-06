"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var client_exports = {};
__export(client_exports, {
  ApprovalClient: () => ApprovalClient,
  DryRunResult: () => DryRunResult,
  withApproval: () => withApproval
});
module.exports = __toCommonJS(client_exports);

// src/client/wrappers.ts
var DryRunResult = class {
  constructor(requestId, executionMode, action, params) {
    this.requestId = requestId;
    this.executionMode = executionMode;
    this.action = action;
    this.params = params;
  }
  requestId;
  executionMode;
  action;
  params;
  dryRun = true;
};
function withApproval(fn, config) {
  return async (...args) => {
    const params = config.mapParams ? config.mapParams(...args) : { args };
    const agentName = config.agent ?? "unknown";
    const { request_id, status, execution_mode } = await config.client.request({
      action: { name: config.action, params },
      context: { agent: agentName },
      risk: config.risk,
      timeout: config.timeout
    });
    if (status === "auto_denied") {
      throw new Error(`Action "${config.action}" was auto-denied by policy`);
    }
    if (status === "pending") {
      const result = await config.client.waitForDecision(request_id, {
        timeout: (config.timeout ?? 300) * 1e3,
        pollInterval: config.pollInterval ?? 1e3
      });
      if (result.status === "denied") {
        throw new Error(
          `Action "${config.action}" was denied${result.decision?.reason ? `: ${result.decision.reason}` : ""}`
        );
      }
      if (result.status === "expired") {
        throw new Error(`Action "${config.action}" expired before a decision was made`);
      }
    }
    if (execution_mode === "dry_run") {
      await config.client.confirm({
        request_id,
        success: true,
        result: { dry_run: true, action: config.action, params },
        confirmed_by: agentName
      });
      throw new DryRunResult(request_id, execution_mode, config.action, params);
    }
    try {
      const result = await fn(...args);
      const undo = config.buildUndo ? config.buildUndo(result, args) : config.undo;
      await config.client.confirm({
        request_id,
        success: true,
        result: result != null ? { value: result } : void 0,
        undo,
        confirmed_by: agentName
      });
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await config.client.confirm({
        request_id,
        success: false,
        error: errorMessage,
        confirmed_by: agentName
      }).catch(() => {
      });
      throw err;
    }
  };
}

// src/client/index.ts
var ApprovalClient = class {
  baseUrl;
  headers;
  constructor(baseUrlOrConfig) {
    if (typeof baseUrlOrConfig === "string") {
      this.baseUrl = baseUrlOrConfig.replace(/\/$/, "");
      this.headers = {};
    } else {
      this.baseUrl = baseUrlOrConfig.baseUrl.replace(/\/$/, "");
      this.headers = baseUrlOrConfig.headers ?? {};
    }
  }
  async post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      const err = data;
      throw new Error(
        err.error?.message ?? `HTTP ${res.status}: ${res.statusText}`
      );
    }
    return data;
  }
  async get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers
    });
    const data = await res.json();
    if (!res.ok) {
      const err = data;
      throw new Error(
        err.error?.message ?? `HTTP ${res.status}: ${res.statusText}`
      );
    }
    return data;
  }
  /** Negotiate a session — declare capabilities, get policies back */
  async negotiate(agent, capabilities) {
    return this.post("/ap/negotiate", {
      agent,
      capabilities
    });
  }
  /** Request approval for an action */
  async request(params) {
    return this.post("/ap/request", params);
  }
  /** Submit a decision on a pending request */
  async decide(params) {
    return this.post("/ap/decide", params);
  }
  /** Confirm execution of an approved action — closes the lifecycle loop */
  async confirm(params) {
    return this.post("/ap/confirm", params);
  }
  /** Request rollback of a confirmed action */
  async rollback(params) {
    return this.post("/ap/rollback", params);
  }
  /** Check the status of an approval request */
  async status(requestId) {
    return this.get(`/ap/status/${requestId}`);
  }
  /**
   * Poll until a request is resolved or times out.
   * Returns the final status result.
   */
  async waitForDecision(requestId, options = {}) {
    const timeout = options.timeout ?? 3e5;
    const pollInterval = options.pollInterval ?? 1e3;
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
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ApprovalClient,
  DryRunResult,
  withApproval
});
//# sourceMappingURL=index.cjs.map