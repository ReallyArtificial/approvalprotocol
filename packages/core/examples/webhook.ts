/**
 * Webhook Approval Protocol Demo — Full Lifecycle
 *
 * Demonstrates async approval via webhook channel with
 * execution confirmation and rollback.
 *
 * Run: npx tsx examples/webhook.ts
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { ApprovalServer, ApprovalClient, WebhookChannel } from "../src/index.js";

async function main() {
  // ── 1. Start a mock webhook receiver on port 4001 ──────────
  const webhookApp = new Hono();

  webhookApp.post("/webhook/approval", async (c) => {
    const body = await c.req.json();
    console.log("\n[Webhook Receiver] Got approval request:");
    console.log(JSON.stringify(body, null, 2));

    // Auto-approve after 2s (simulates a human approving via UI)
    setTimeout(async () => {
      console.log("\n[Webhook Receiver] Auto-approving request...");
      await fetch("http://localhost:4000/ap/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: (body as { request_id: string }).request_id,
          decision: "approve",
          decided_by: "webhook_auto",
          reason: "Auto-approved by webhook receiver",
        }),
      });
    }, 2000);

    return c.json({ received: true });
  });

  const webhookServer = serve({ fetch: webhookApp.fetch, port: 4001 }, () => {
    console.log("Webhook receiver running on http://localhost:4001");
  });

  // ── 2. Start AP server with webhook channel ────────────────
  const server = new ApprovalServer({
    port: 4000,
    channel: new WebhookChannel({ url: "http://localhost:4001/webhook/approval" }),
    policies: {
      deploy_code: { requires: "always" },
      run_tests: { requires: "never" },
    },
  });
  await server.start();

  // ── 3. Simulate agent workflow ─────────────────────────────
  const client = new ApprovalClient("http://localhost:4000");

  await client.negotiate("deploy-agent", ["deploy_code", "run_tests"]);

  // Auto-approved: run tests
  console.log("\n--- Action: run_tests (auto-approved) ---");
  const testResult = await client.request({
    action: { name: "run_tests", params: { suite: "integration" } },
    context: { agent: "deploy-agent", reason: "Pre-deploy checks" },
  });
  console.log(`Status: ${testResult.status} | Mode: ${testResult.execution_mode}`);

  // Confirm test execution
  await client.confirm({
    request_id: testResult.request_id,
    success: true,
    result: { passed: 142, failed: 0, duration_ms: 8500 },
    confirmed_by: "deploy-agent",
  });
  console.log("Tests confirmed: 142 passed, 0 failed.");

  // Requires approval: deploy
  console.log("\n--- Action: deploy_code (requires approval via webhook) ---");
  const deployResult = await client.request({
    action: {
      name: "deploy_code",
      description: "Deploy v2.1.0 to production",
      params: { version: "2.1.0", environment: "production" },
    },
    context: { agent: "deploy-agent", reason: "Release v2.1.0" },
    risk: {
      reversible: true,
      blast_radius: "org",
      confidence: 0.99,
      estimated_impact: "system",
    },
  });

  console.log(`Request ID: ${deployResult.request_id}`);
  console.log(`Status: ${deployResult.status} | Mode: ${deployResult.execution_mode}`);

  if (deployResult.status === "pending") {
    console.log("Polling for decision (webhook will auto-approve in ~2s)...");
    const decision = await client.waitForDecision(deployResult.request_id, {
      timeout: 30_000,
      pollInterval: 500,
    });
    console.log(`\nDecision: ${decision.status}`);

    if (decision.status === "approved") {
      console.log("[Agent] Deploying v2.1.0 to production...");
      console.log("[Agent] Deploy complete!");

      // Confirm with rollback instructions
      await client.confirm({
        request_id: deployResult.request_id,
        success: true,
        result: { deploy_id: "deploy_abc", sha: "a1b2c3d", replicas: 3 },
        undo: {
          type: "api_call",
          description: "Rollback to previous version via deploy API",
          instructions: {
            method: "POST",
            url: "https://deploy.internal/rollback",
            body: { deploy_id: "deploy_abc", target_version: "2.0.9" },
          },
        },
        confirmed_by: "deploy-agent",
      });
      console.log("[Agent] Execution confirmed with rollback instructions.");

      // Simulate a rollback
      console.log("\n--- Simulating rollback ---");
      const rollback = await client.rollback({
        request_id: deployResult.request_id,
        reason: "Critical bug found in v2.1.0",
        initiated_by: "oncall-engineer",
      });
      console.log(`Rollback status: ${rollback.execution_status}`);
      console.log(`Undo instructions: ${JSON.stringify(rollback.undo)}`);
      console.log("[System] Would execute rollback API call to revert to v2.0.9");
    }
  }

  // ── 4. Print audit log ─────────────────────────────────────
  console.log("\n--- Audit Log ---");
  const audit = await (await fetch("http://localhost:4000/ap/audit")).json();
  console.log(JSON.stringify(audit, null, 2));

  // ── 5. Cleanup ─────────────────────────────────────────────
  webhookServer.close();
  await server.stop();
  console.log("\nServers stopped.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
