import * as readline from "node:readline";
import type { ApChannel, ApStatusResult } from "../../types.js";

export class CliChannel implements ApChannel {
  name = "cli";

  private decideUrl: string;

  constructor(serverUrl: string = "http://localhost:4000") {
    this.decideUrl = `${serverUrl}/ap/decide`;
  }

  async notify(request: ApStatusResult): Promise<void> {
    const { action, request_id } = request;
    const risk = request.decision ? undefined : request;

    console.log("\n┌──────────────────────────────────────────┐");
    console.log("│        APPROVAL REQUEST PENDING          │");
    console.log("├──────────────────────────────────────────┤");
    console.log(`│  Request ID: ${request_id}`);
    console.log(`│  Action:     ${action.name}`);
    if (action.description) {
      console.log(`│  Desc:       ${action.description}`);
    }
    console.log(`│  Params:     ${JSON.stringify(action.params)}`);
    console.log("└──────────────────────────────────────────┘");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question("  [approve/deny] > ", (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    const decision = answer === "deny" ? "deny" : "approve";

    try {
      await fetch(this.decideUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id,
          decision,
          decided_by: "cli_user",
          reason: `CLI ${decision}`,
        }),
      });
    } catch {
      console.error("  Failed to submit decision via HTTP, recording locally.");
    }
  }
}
