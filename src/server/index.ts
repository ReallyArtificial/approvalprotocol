import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { ApprovalStore } from "./store.js";
import { createRouter } from "./router.js";
import type { ApServerConfig, ApPolicy, ApChannel } from "../types.js";

export class ApprovalServer {
  private store: ApprovalStore;
  private channel: ApChannel;
  private port: number;
  private server: ServerType | null = null;
  readonly app;

  constructor(config: ApServerConfig) {
    this.port = config.port ?? 4000;
    this.channel = config.channel;
    this.store = new ApprovalStore(config.dbPath);

    // Load initial policies
    if (config.policies) {
      for (const [action, policy] of Object.entries(config.policies)) {
        this.store.setPolicy(action, policy);
      }
    }

    this.app = createRouter(this.store, this.channel);
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve(
        { fetch: this.app.fetch, port: this.port },
        () => {
          console.log(`Approval Protocol server running on http://localhost:${this.port}`);
          resolve();
        }
      );
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.server = null;
    }
    this.store.close();
  }

  setPolicy(actionName: string, policy: ApPolicy) {
    this.store.setPolicy(actionName, policy);
  }

  /** Direct access to store for testing */
  getStore(): ApprovalStore {
    return this.store;
  }
}

export { ApprovalStore } from "./store.js";
export { createRouter } from "./router.js";
export { CliChannel } from "./channels/cli.js";
export { WebhookChannel } from "./channels/webhook.js";
export type { WebhookChannelConfig } from "./channels/webhook.js";
export type { ApChannel } from "./channels/base.js";
