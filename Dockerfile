# ── Build stage ──────────────────────────────────────────────
FROM node:22-bookworm AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build

# Copy dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/langchain/package.json ./packages/langchain/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ ./packages/
COPY tsconfig.json ./

# Build all packages
RUN pnpm run build

# ── Production stage ─────────────────────────────────────────
FROM node:22-slim

# Install pnpm and tsx for running the server
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm add -g tsx

WORKDIR /app

# Copy built artifacts and dependencies
COPY --from=builder /build/package.json /build/pnpm-lock.yaml /build/pnpm-workspace.yaml ./
COPY --from=builder /build/packages/ ./packages/
COPY --from=builder /build/node_modules/ ./node_modules/

# Create standalone server entry point
RUN cat > /app/server.ts << 'EOF'
/**
 * Standalone Approval Protocol Server
 *
 * Runs a persistent approval server on port 4000 with CLI channel.
 * Health endpoint: GET /health
 */

import { ApprovalServer, CliChannel } from "./packages/core/dist/index.js";

async function main() {
  const server = new ApprovalServer({
    port: 4000,
    channel: new CliChannel("http://localhost:4000"),
    policies: {
      send_email: { requires: "always" },
      search_kb: { requires: "never" },
      issue_refund: { requires: "conditional", when: "params.amount > 100" },
      delete_user: { requires: "always", execution: "sandbox" },
      deploy: { requires: "always", execution: "monitored" },
    },
  });

  await server.start();

  console.log("✓ Approval Protocol server running on port 4000");
  console.log("  Health: http://localhost:4000/health");
  console.log("  Status: http://localhost:4000/ap/status/:id");
  console.log("  Audit:  http://localhost:4000/ap/audit");

  // Keep process alive
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down...");
    await server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Server startup failed:", err);
  process.exit(1);
});
EOF

# Create non-root user
RUN useradd -m -u 1000 approver && \
    chown -R approver:approver /app

USER approver

EXPOSE 4000

# Health check using the built-in /health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["tsx", "/app/server.ts"]
