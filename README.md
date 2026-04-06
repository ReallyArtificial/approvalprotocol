# Approval Protocol

**A protocol for AI agent human-in-the-loop approval and action lifecycle management.**

What MCP did for tool access, Approval Protocol does for human oversight.

---

AI agents take actions in the real world — send emails, spend money, modify databases, deploy code. Every agent framework has its own half-baked human-in-the-loop mechanism, all framework-locked, all missing notification channels and escalation.

Approval Protocol (AP) is a **protocol** — not a library — that standardizes how agents get human permission before executing actions, confirm execution results, and enable rollback when things go wrong.

## How It Works

```
Agent                    AP Server                   Human
  │                         │                          │
  ├── ap/negotiate ────────►│                          │
  │◄── policies + session ──┤                          │
  │                         │                          │
  ├── ap/request ──────────►│                          │
  │◄── request_id + mode ───┤── notify ───────────────►│
  │                         │                          │
  ├── ap/status ───────────►│         ap/decide ◄──────┤
  │◄── approved ────────────┤                          │
  │                         │                          │
  ├── [execute action]      │                          │
  │                         │                          │
  ├── ap/confirm ──────────►│  (result + undo info)    │
  │◄── confirmed ───────────┤                          │
  │                         │                          │
  │   ap/rollback ◄─────────┤──────────────────────────┤
  │◄── undo instructions ───┤                          │
```

## Quickstart

```bash
npm install approval-protocol
```

```typescript
import { ApprovalServer, ApprovalClient, CliChannel } from "approval-protocol";

// Start server with CLI approval channel
const server = new ApprovalServer({
  port: 4000,
  channel: new CliChannel(),
  policies: {
    send_email: { requires: "always" },
    search_kb: { requires: "never" },
    delete_records: { requires: "always", execution: "sandbox" },
  },
});
await server.start();

// Client requests approval
const client = new ApprovalClient("http://localhost:4000");
const session = await client.negotiate("my-agent", ["send_email", "search_kb"]);

const { request_id, status, execution_mode } = await client.request({
  action: { name: "send_email", params: { to: "user@example.com", body: "Hello" } },
  context: { agent: "my-agent", reason: "Customer requested help" },
  risk: { reversible: false, blast_radius: "external" },
});

if (status === "pending") {
  const result = await client.waitForDecision(request_id, { timeout: 60_000 });

  if (result.status === "approved") {
    // Execute the action...
    const emailResult = sendEmail("user@example.com", "Hello");

    // Confirm execution with undo instructions
    await client.confirm({
      request_id,
      success: true,
      result: { message_id: emailResult.id },
      undo: {
        type: "api_call",
        description: "Recall the email",
        instructions: { method: "POST", url: `/recall/${emailResult.id}` },
      },
      confirmed_by: "my-agent",
    });
  }
}

// Later, if something went wrong:
await client.rollback({
  request_id,
  reason: "Email contained incorrect information",
  initiated_by: "admin@company.com",
});
// → Returns the undo instructions for the caller to execute
```

Or use the `withApproval` wrapper for transparent lifecycle management:

```typescript
import { withApproval } from "approval-protocol/client";

const sendEmail = withApproval(
  async (to: string, body: string) => { /* actual send logic */ },
  {
    action: "send_email",
    client,
    risk: { reversible: false, blast_radius: "external" },
    undo: { type: "manual", description: "Contact recipient to disregard" },
  }
);

// Approval + execution + confirmation happens transparently
await sendEmail("user@example.com", "Your refund is ready");
```

## Run the Demo

```bash
git clone <repo-url>
cd ApprovalProtocol
npm install
npx tsx examples/basic.ts
```

## Protocol

The full protocol specification is in [PROTOCOL.md](./PROTOCOL.md).

6 methods over JSON-RPC 2.0-style HTTP:

| Method | Purpose |
|--------|---------|
| `ap/negotiate` | Trust handshake — agent declares capabilities, server returns policies + execution modes |
| `ap/request` | Agent requests approval for an action |
| `ap/decide` | Human submits approval decision |
| `ap/confirm` | Agent confirms execution result with undo metadata |
| `ap/rollback` | Request rollback of a confirmed action |
| `ap/status` | Agent polls for full lifecycle status |

## Execution Modes

Policies can specify how actions should be executed:

| Mode | Behavior |
|------|----------|
| `live` | Normal execution (default) |
| `sandbox` | Run in isolated/test environment |
| `dry_run` | Simulate without side effects |

```typescript
policies: {
  delete_records: { requires: "always", execution: "sandbox" },
  generate_report: { requires: "never", execution: "dry_run" },
}
```

## Channels

AP routes approval requests to humans via **channels**:

- **CLI** — Terminal prompt (built-in, great for demos)
- **Webhook** — POST to any URL (Slack bot, email service, custom UI)
- More in v0.2: Slack native, email, SMS, web dashboard

## Key Concepts

- **Policies**: Per-action rules — `"always"` require approval, `"never"` auto-approve, `"conditional"` evaluate an expression
- **Execution Modes**: `"live"`, `"sandbox"`, `"dry_run"` — control how actions run
- **Risk Metadata**: Agents declare `reversible`, `blast_radius`, `confidence` — humans see the stakes
- **Execution Confirmation**: Agents report back what happened — closes the lifecycle loop
- **Undo Metadata**: Agents provide reversal instructions at confirmation time
- **Rollback**: Request reversal of a confirmed action — server returns undo instructions
- **Audit Log**: Every request, decision, execution, and rollback is stored. Full traceability.
- **Framework Agnostic**: Works with any agent framework. AP is a protocol, not a plugin.

## Roadmap

- **v0.1.1** (current): Full action lifecycle — approval, execution confirmation, rollback, execution modes
- **v0.2**: WebSocket transport, stdio transport, Slack channel, web dashboard, monorepo split
- **v0.3**: Escalation chains, multi-approver workflows, proper expression parser

## License

MIT
