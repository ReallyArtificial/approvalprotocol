import type { ApChannel, ApStatusResult } from "../../types.js";

export interface WebhookChannelConfig {
  url: string;
  headers?: Record<string, string>;
}

export class WebhookChannel implements ApChannel {
  name = "webhook";

  private url: string;
  private headers: Record<string, string>;

  constructor(config: WebhookChannelConfig) {
    this.url = config.url;
    this.headers = config.headers ?? {};
  }

  async notify(request: ApStatusResult): Promise<void> {
    await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify({
        type: "approval_request",
        request_id: request.request_id,
        action: request.action,
        status: request.status,
        created_at: request.created_at,
      }),
    });
  }
}
