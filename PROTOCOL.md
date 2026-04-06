# Approval Protocol Specification — v0.1.1

## Abstract

The Approval Protocol (AP) defines a standard interface for AI agents to request human approval before executing actions, confirm execution results, and enable rollback of completed actions. It provides a transport-agnostic, framework-independent protocol for full action lifecycle management in autonomous systems.

## 1. Overview

### 1.1 Design Goals

1. **Protocol, not library** — AP defines message formats and flows. Implementations can exist in any language.
2. **Framework agnostic** — Works with LangChain, OpenAI SDK, CrewAI, or raw HTTP.
3. **Channel agnostic** — Approval requests can be routed to any human interface (terminal, Slack, email, web UI).
4. **Full lifecycle** — Covers the entire action lifecycle: request, approve, execute, confirm, rollback.
5. **Auditable** — Every request, decision, execution, and rollback is logged with full context.
6. **Simple first** — v0.1 uses HTTP + polling. WebSocket and stdio come later.

### 1.2 Architecture

```
┌─────────┐         ┌──────────────┐         ┌─────────┐
│  Agent   │◄──────►│  AP Server   │◄──────►│  Human   │
│          │  HTTP   │              │ Channel │          │
│ (Client) │        │ Store+Policy │         │(Approver)│
└─────────┘         └──────────────┘         └─────────┘
```

### 1.3 Action Lifecycle

```
negotiate → request → decide → execute → confirm ──→ [done]
                                             │
                                             └──→ rollback → [undone]
```

**States:**

| Phase | Status Values |
|-------|--------------|
| Approval | `pending` → `approved` / `denied` / `edited` / `expired` / `auto_approved` / `auto_denied` |
| Execution | `pending_execution` → `confirmed` / `failed` → `rolled_back` / `rollback_failed` |

## 2. Transport

### 2.1 HTTP (v0.1)

All methods are HTTP endpoints accepting and returning JSON. Requests use JSON-RPC 2.0-inspired payloads but are mapped to REST-style routes for simplicity.

**Base URL**: Configurable (default: `http://localhost:4000`)

**Content-Type**: `application/json` for all requests and responses.

**Error Format**:
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Human-readable error description"
  }
}
```

Error codes: `INVALID_REQUEST`, `NOT_FOUND`, `POLICY_VIOLATION`, `EXPIRED`, `INTERNAL_ERROR`.

## 3. Methods

### 3.1 `ap/negotiate` — Trust Handshake

Establishes a session between an agent and the AP server. The agent declares what actions it may perform; the server responds with policies for each action, including execution modes.

**Request**: `POST /ap/negotiate`

```json
{
  "agent": "my-email-agent",
  "capabilities": ["send_email", "search_kb", "delete_records"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | string | Yes | Unique agent identifier |
| `capabilities` | string[] | Yes | List of action names the agent may invoke |

**Response**: `200 OK`

```json
{
  "session_id": "sess_abc123",
  "policies": {
    "send_email": { "requires": "always" },
    "search_kb": { "requires": "never" },
    "delete_records": { "requires": "always", "execution": "sandbox" }
  },
  "trust_level": "standard"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Unique session identifier |
| `policies` | Record<string, Policy> | Policy for each declared capability |
| `trust_level` | string | One of: `"new"`, `"standard"`, `"trusted"`, `"unrestricted"` |

**Policy Object**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requires` | string | Yes | `"always"`, `"never"`, or `"conditional"` |
| `when` | string | No | Condition expression (required when `requires` is `"conditional"`) |
| `execution` | string | No | Execution mode: `"live"` (default), `"sandbox"`, or `"dry_run"` |

### 3.2 `ap/request` — Request Approval

Agent submits an action for approval. The server evaluates the policy and either auto-resolves or creates a pending request. Response includes the execution mode the agent should use.

**Request**: `POST /ap/request`

```json
{
  "action": {
    "name": "send_email",
    "description": "Send a support response email",
    "params": {
      "to": "customer@example.com",
      "subject": "Re: Your refund request",
      "body": "Hi, your refund of $50 has been processed."
    }
  },
  "context": {
    "agent": "support-agent",
    "session": "sess_abc123",
    "reason": "Customer requested refund status update"
  },
  "risk": {
    "reversible": false,
    "blast_radius": "external",
    "confidence": 0.92,
    "estimated_impact": "communication"
  },
  "timeout": 300,
  "callback_url": "https://my-agent.example.com/webhook/approval"
}
```

**Response**: `200 OK`

```json
{
  "request_id": "req_def456",
  "status": "pending",
  "execution_mode": "live",
  "expires_at": "2025-01-15T10:05:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | string | Unique request identifier |
| `status` | string | `"pending"`, `"auto_approved"`, or `"auto_denied"` |
| `execution_mode` | string | How the agent should execute: `"live"`, `"sandbox"`, or `"dry_run"` |
| `expires_at` | string | ISO 8601 timestamp when the request expires (if pending) |

### 3.3 `ap/decide` — Submit Decision

A human (via a channel adapter or direct API call) submits their decision on a pending request.

**Request**: `POST /ap/decide`

```json
{
  "request_id": "req_def456",
  "decision": "approve",
  "reason": "Looks good, send it.",
  "decided_by": "alice@company.com"
}
```

For an **edit** decision (approve with modifications):

```json
{
  "request_id": "req_def456",
  "decision": "edit",
  "modified_params": {
    "body": "Hi, your refund of $50 has been processed. Please allow 3-5 business days."
  },
  "reason": "Added processing time note",
  "decided_by": "alice@company.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `request_id` | string | Yes | The request being decided on |
| `decision` | string | Yes | `"approve"`, `"deny"`, or `"edit"` |
| `modified_params` | object | No | Modified action parameters (required when decision is `"edit"`) |
| `reason` | string | No | Human's reason for the decision |
| `decided_by` | string | Yes | Identifier of the human making the decision |

**Response**: `200 OK`

```json
{
  "request_id": "req_def456",
  "status": "approved",
  "decided_at": "2025-01-15T10:01:30Z"
}
```

### 3.4 `ap/confirm` — Confirm Execution

After an approved action is executed, the agent reports the result back to the server. This closes the lifecycle loop and enables rollback by providing undo metadata.

**Request**: `POST /ap/confirm`

```json
{
  "request_id": "req_def456",
  "success": true,
  "result": {
    "message_id": "msg_789",
    "delivered_at": "2025-01-15T10:02:00Z"
  },
  "undo": {
    "type": "api_call",
    "description": "Recall the email via Gmail API",
    "instructions": {
      "method": "POST",
      "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_789/recall"
    }
  },
  "confirmed_by": "support-agent"
}
```

For a **failed** execution:

```json
{
  "request_id": "req_def456",
  "success": false,
  "error": "SMTP connection refused: relay.example.com:587",
  "confirmed_by": "support-agent"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `request_id` | string | Yes | The request that was executed |
| `success` | boolean | Yes | Whether execution succeeded |
| `result` | object | No | Execution result data (when success is true) |
| `undo` | UndoMetadata | No | How to reverse this action (when success is true) |
| `error` | string | No | Error message (when success is false) |
| `confirmed_by` | string | Yes | Identifier of the agent/system confirming |

**Undo Metadata Object**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `"api_call"` — reversible via API; `"function"` — reversible via function call; `"manual"` — requires human intervention; `"none"` — irreversible |
| `description` | string | No | Human-readable description of how to undo |
| `instructions` | object | No | Machine-readable undo instructions |

**Response**: `200 OK`

```json
{
  "request_id": "req_def456",
  "execution_status": "confirmed",
  "confirmed_at": "2025-01-15T10:02:05Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | string | Request identifier |
| `execution_status` | string | `"confirmed"` or `"failed"` |
| `confirmed_at` | string | ISO 8601 timestamp |

**Preconditions**: Request must have status `approved`, `edited`, or `auto_approved`. Cannot re-confirm.

### 3.5 `ap/rollback` — Request Rollback

Request the rollback of a previously confirmed action. Returns the undo metadata so the caller can execute the reversal.

**Request**: `POST /ap/rollback`

```json
{
  "request_id": "req_def456",
  "reason": "Customer changed their mind about the refund",
  "initiated_by": "alice@company.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `request_id` | string | Yes | The confirmed request to roll back |
| `reason` | string | No | Why the rollback is needed |
| `initiated_by` | string | Yes | Who is requesting the rollback |

**Response**: `200 OK`

```json
{
  "request_id": "req_def456",
  "execution_status": "rolled_back",
  "undo": {
    "type": "api_call",
    "description": "Recall the email via Gmail API",
    "instructions": {
      "method": "POST",
      "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_789/recall"
    }
  },
  "rolled_back_at": "2025-01-15T10:15:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | string | Request identifier |
| `execution_status` | string | `"rolled_back"` |
| `undo` | UndoMetadata | The undo instructions (if available) for the caller to execute |
| `rolled_back_at` | string | ISO 8601 timestamp |

**Preconditions**: Request must have execution status `confirmed`. Cannot roll back a failed or already rolled-back execution.

**Note**: The AP server marks the status as `rolled_back` and returns undo instructions. The actual reversal is the caller's responsibility — the protocol records intent, not execution of the rollback itself.

### 3.6 `ap/status` — Check Status

Agent polls for the current status of a request, including execution lifecycle information.

**Request**: `GET /ap/status/:request_id`

**Response**: `200 OK`

```json
{
  "request_id": "req_def456",
  "status": "approved",
  "action": {
    "name": "send_email",
    "params": {
      "to": "customer@example.com",
      "body": "Hi, your refund of $50 has been processed."
    }
  },
  "decision": {
    "decision": "approve",
    "reason": "Looks good, send it.",
    "decided_by": "alice@company.com"
  },
  "execution": {
    "status": "confirmed",
    "mode": "live",
    "result": { "message_id": "msg_789" },
    "undo": {
      "type": "api_call",
      "description": "Recall the email"
    },
    "confirmed_by": "support-agent",
    "confirmed_at": "2025-01-15T10:02:05Z"
  },
  "created_at": "2025-01-15T10:00:00Z",
  "decided_at": "2025-01-15T10:01:30Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | string | Request identifier |
| `status` | string | Approval status: `"pending"`, `"approved"`, `"denied"`, `"edited"`, `"expired"` |
| `action` | Action | The original action |
| `decision` | Decision | The human's decision (present when decided) |
| `execution` | ExecutionInfo | Execution lifecycle info (present after approval) |
| `created_at` | string | ISO 8601 timestamp |
| `decided_at` | string | ISO 8601 timestamp (present when decided) |

**Execution Info Object**:

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"pending_execution"`, `"confirmed"`, `"failed"`, `"rolled_back"`, `"rollback_failed"` |
| `mode` | string | Execution mode: `"live"`, `"sandbox"`, `"dry_run"` |
| `result` | object | Execution result (when confirmed) |
| `undo` | UndoMetadata | Undo instructions (when confirmed with undo) |
| `error` | string | Error message (when failed) |
| `confirmed_by` | string | Who confirmed the execution |
| `confirmed_at` | string | ISO 8601 timestamp |
| `rolled_back_by` | string | Who initiated rollback |
| `rolled_back_at` | string | ISO 8601 timestamp |

### 3.7 `ap/audit` — Audit Log (Extension)

List recent approval requests and decisions. Not part of the core protocol but included in the reference server.

**Request**: `GET /ap/audit?limit=50&offset=0`

**Response**: `200 OK`

```json
{
  "items": [
    {
      "request_id": "req_def456",
      "action_name": "send_email",
      "status": "approved",
      "execution_status": "confirmed",
      "decided_by": "alice@company.com",
      "created_at": "2025-01-15T10:00:00Z",
      "decided_at": "2025-01-15T10:01:30Z"
    }
  ],
  "total": 1
}
```

## 4. Execution Modes

Policies can specify an **execution mode** that tells the agent how to run the action:

| Mode | Behavior |
|------|----------|
| `live` | Normal execution. The default. |
| `sandbox` | Run in an isolated/test environment. The agent is responsible for honoring this — the protocol communicates intent, not enforcement. |
| `dry_run` | Simulate the action without side effects. Agent should confirm with the simulated result. |

Execution mode is set per-action in the policy and returned in the `ap/request` response. The agent is expected to honor the mode, but enforcement is implementation-specific.

```json
{
  "delete_records": {
    "requires": "always",
    "execution": "sandbox"
  }
}
```

## 5. Policy Evaluation

When an `ap/request` is received, the server evaluates the policy for the action:

1. **Look up policy** for `action.name` in the configured policies.
2. If no policy exists, default to `requires: "always"`, `execution: "live"` (fail-safe).
3. If `requires: "never"` — return `status: "auto_approved"`. No human needed.
4. If `requires: "always"` — create pending request, notify channel.
5. If `requires: "conditional"` — evaluate the `when` expression:
   - Expression has access to `params` (action parameters) and `risk` (risk metadata).
   - If expression evaluates to `true`, require approval (pending).
   - If `false`, auto-approve.
6. **Resolve execution mode** from the policy's `execution` field (default: `"live"`).
7. Return `execution_mode` in the response so the agent knows how to run the action.

## 6. Channels

Channels are the mechanism for notifying humans about pending requests. They implement a simple interface:

```
notify(request) → void
```

The channel sends the request details to a human. The human's response comes back via `POST /ap/decide` — channels are notification-only, not bidirectional.

### 6.1 CLI Channel

Prints the request to stdout and reads a decision from stdin. Suitable for development and demos.

### 6.2 Webhook Channel

POSTs the request payload to a configured URL. The receiving service is responsible for presenting the request to a human and POSTing the decision back to `/ap/decide`.

## 7. Security Considerations

- **v0.1 does not include authentication.** The AP server should be run in a trusted network or behind an auth proxy.
- **Conditional expressions** use `new Function()` with a sandboxed context in v0.1. Production deployments should use a proper expression parser.
- **Callback URLs** are not validated. In production, implement allowlisting.
- **Undo instructions** may contain sensitive data (API endpoints, credentials). Treat them as confidential.
- v0.2 will add API key authentication and HMAC-signed webhooks.

## 8. Versioning

The protocol version is `0.1.1`. Future versions will be backwards-compatible within a major version. The `ap/negotiate` response may include a `protocol_version` field in future versions.

### Changelog

- **v0.1.1**: Added `ap/confirm` (execution confirmation with undo metadata), `ap/rollback` (action reversal), execution modes (`live`/`sandbox`/`dry_run`) in policies.
- **v0.1.0**: Initial spec — `ap/negotiate`, `ap/request`, `ap/decide`, `ap/status`, `ap/audit`.
