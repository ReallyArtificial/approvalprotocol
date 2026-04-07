/**
 * Basic Approval Protocol Demo — Full Lifecycle
 *
 * Demonstrates: negotiate → request → approve → execute → confirm → rollback
 *
 * Run: npx tsx examples/basic.ts
 */

import { ApprovalServer, ApprovalClient, CliChannel } from "../src/index.js";

async function main() {
  // ── 1. Start the server ────────────────────────────────────
  const server = new ApprovalServer({
    port: 4000,
    channel: new CliChannel("http://localhost:4000"),
    policies: {
      send_email: { requires: "always" },
      search_kb: { requires: "never" },
      issue_refund: { requires: "conditional", when: "params.amount > 100" },
      delete_user: { requires: "always", execution: "sandbox" },
    },
  });

  await server.start();

  // ── 2. Create a client ─────────────────────────────────────
  const client = new ApprovalClient("http://localhost:4000");

  // ── 3. Negotiate session ───────────────────────────────────
  const session = await client.negotiate("demo-agent", [
    "send_email",
    "search_kb",
    "issue_refund",
    "delete_user",
  ]);
  console.log("\nSession established:", session.session_id);
  console.log("Policies:", JSON.stringify(session.policies, null, 2));

  // ── 4. Auto-approved action ────────────────────────────────
  console.log("\n--- Action: search_kb (auto-approved) ---");
  const searchResult = await client.request({
    action: { name: "search_kb", params: { query: "refund policy" } },
    context: { agent: "demo-agent", reason: "Looking up refund policy" },
  });
  console.log(`Status: ${searchResult.status} | Mode: ${searchResult.execution_mode}`);

  // Confirm execution
  await client.confirm({
    request_id: searchResult.request_id,
    success: true,
    result: { documents: ["refund-policy-v2.md"] },
    confirmed_by: "demo-agent",
  });
  console.log("Execution confirmed.");

  // ── 5. Action requiring approval (full lifecycle) ──────────
  console.log("\n--- Action: send_email (requires approval → confirm → rollback) ---");
  const emailResult = await client.request({
    action: {
      name: "send_email",
      description: "Send refund confirmation to customer",
      params: {
        to: "customer@example.com",
        subject: "Your refund has been processed",
        body: "Hi, your refund of $50 has been issued.",
      },
    },
    context: {
      agent: "demo-agent",
      session: session.session_id,
      reason: "Customer requested refund status update",
    },
    risk: {
      reversible: false,
      blast_radius: "external",
      confidence: 0.95,
      estimated_impact: "communication",
    },
    timeout: 120,
  });

  console.log(`Request ID: ${emailResult.request_id}`);
  console.log(`Status: ${emailResult.status} | Mode: ${emailResult.execution_mode}`);

  if (emailResult.status === "pending") {
    console.log("\nWaiting for human decision...");
    const decision = await client.waitForDecision(emailResult.request_id, {
      timeout: 120_000,
    });
    console.log(`\nDecision: ${decision.status}`);

    if (decision.status === "approved" || decision.status === "edited") {
      // Execute the action
      console.log("[Agent] Executing send_email action...");
      console.log("[Agent] Email sent successfully!");

      // Confirm execution with undo metadata
      await client.confirm({
        request_id: emailResult.request_id,
        success: true,
        result: { message_id: "msg_12345", delivered_at: new Date().toISOString() },
        undo: {
          type: "manual",
          description: "Contact customer to disregard the email",
        },
        confirmed_by: "demo-agent",
      });
      console.log("[Agent] Execution confirmed with undo instructions.");

      // Show full status
      const fullStatus = await client.status(emailResult.request_id);
      console.log("\nFull status:");
      console.log(`  Approval: ${fullStatus.status}`);
      console.log(`  Execution: ${fullStatus.execution?.status}`);
      console.log(`  Mode: ${fullStatus.execution?.mode}`);
      console.log(`  Undo: ${fullStatus.execution?.undo?.description}`);
    } else {
      console.log("[Agent] Action denied. Skipping.");
    }
  }

  // ── 6. Conditional + small refund (auto-approved) ──────────
  console.log("\n--- Action: issue_refund $50 (conditional — auto-approved) ---");
  const smallRefund = await client.request({
    action: { name: "issue_refund", params: { amount: 50, customer: "cust_123" } },
    context: { agent: "demo-agent", reason: "Small refund" },
    risk: { reversible: false, blast_radius: "single_user", estimated_impact: "financial" },
  });
  console.log(`Status: ${smallRefund.status} | Mode: ${smallRefund.execution_mode}`);

  // ── 7. Sandbox mode action ─────────────────────────────────
  console.log("\n--- Action: delete_user (sandbox mode, requires approval) ---");
  const deleteResult = await client.request({
    action: { name: "delete_user", params: { user_id: "usr_789", reason: "GDPR request" } },
    context: { agent: "demo-agent", reason: "User requested account deletion" },
    risk: { reversible: false, blast_radius: "single_user", estimated_impact: "data" },
  });
  console.log(`Request ID: ${deleteResult.request_id}`);
  console.log(`Status: ${deleteResult.status} | Mode: ${deleteResult.execution_mode}`);

  if (deleteResult.status === "pending") {
    console.log("\nWaiting for human decision on sandbox delete...");
    const decision = await client.waitForDecision(deleteResult.request_id, {
      timeout: 120_000,
    });

    if (decision.status === "approved") {
      console.log(`[Agent] Running delete_user in SANDBOX mode (${deleteResult.execution_mode})...`);
      console.log("[Agent] Sandbox: user soft-deleted, no actual data removed.");

      await client.confirm({
        request_id: deleteResult.request_id,
        success: true,
        result: { sandbox: true, soft_deleted: true, user_id: "usr_789" },
        undo: {
          type: "function",
          description: "Restore user from soft-delete",
          instructions: { function: "restoreUser", args: ["usr_789"] },
        },
        confirmed_by: "demo-agent",
      });
      console.log("[Agent] Sandbox execution confirmed.");
    }
  }

  // ── 8. Print audit log ─────────────────────────────────────
  console.log("\n--- Audit Log ---");
  const audit = await (await fetch("http://localhost:4000/ap/audit")).json();
  console.log(JSON.stringify(audit, null, 2));

  // ─�� 9. Cleanup ─────────────────────────���───────────────────
  await server.stop();
  console.log("\nServer stopped.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
