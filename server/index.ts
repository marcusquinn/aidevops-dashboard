import { readFileSync } from "fs";
import { join } from "path";
import { config } from "./config";
import { getSecret, hasSecret } from "./secrets";
import { handleTasks } from "./routes/tasks";

// Read dashboard version from root package.json (single source of truth)
const DASHBOARD_VERSION = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf-8")).version as string;
import { handleAgents } from "./routes/agents";
import { handleStatus } from "./routes/status";
import { handleDocumentsTree, handleDocumentsContent } from "./routes/documents";
import { handleSettings } from "./routes/settings";
import { handleHealth, handleHealthLocal, handleHealthVPS } from "./routes/health";
import { handleOllama } from "./routes/ollama";
import { handleProjects } from "./routes/projects";
import { handleTokens, handleTokenModels, handleTokenProjects, handleTokenBudget, handleTokenSessions } from "./routes/tokens";
import { handleUptime } from "./routes/uptime";
import { handleNeeds } from "./routes/needs";
import { handleSSL } from "./routes/ssl";
import { handleAlerts } from "./routes/alerts";
import { handleCI } from "./routes/ci";
import { handlePageSpeed } from "./routes/pagespeed";
import { handleAuthStatus } from "./routes/auth";
import { handleDiagnostics } from "./health/diagnostics";
import { handleTaskMove, handleTaskCreate, handleTaskUpdate } from "./routes/actions/tasks";
import { handlePRApprove, handlePRMerge, handleWorkflowRerun } from "./routes/actions/github";
import { handleAgentDispatch } from "./routes/actions/agents";
import { handleSettingsGet, handleBudgetUpdate, handleAlertUpdate, handleCollectorToggle, handleRefreshIntervalUpdate, handleUpdateModeChange } from "./routes/actions/settings";
import { handleNeedDismiss, handleNeedSnooze } from "./routes/actions/needs";
import { handleVPSUpdate } from "./routes/actions/vps";
import { handleUpdateCheck, handleUpdateApply } from "./routes/update";
import { handleAudit } from "./routes/audit";
import { addClient, removeClient, clientCount } from "./ws/realtime";
import { startFileWatchers } from "./watchers/file-watcher";
import { startCacheCleanup } from "./cache/store";
import { logger } from "./health/logger";
import { apiError } from "./routes/_helpers";
import { authMiddleware, extractClientIp } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { securityHeaders, handlePreflight } from "./middleware/security";

// Global error handlers — prevent crashes from unhandled errors
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: String(err), stack: (err as Error).stack });
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
});

// Start subsystems with resilience — failures don't prevent server startup
// Note: auto-update timer removed — launchd handles scheduling + restart via update.sh
const startupResults = await Promise.allSettled([
  Promise.resolve(startFileWatchers()),
  Promise.resolve(startCacheCleanup()),
]);

for (const [i, result] of startupResults.entries()) {
  const names = ["file-watchers", "cache-cleanup"];
  if (result.status === "rejected") {
    logger.error(`Startup: ${names[i]} failed`, { error: String(result.reason) });
  } else {
    logger.info(`Startup: ${names[i]} started`);
  }
}

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  // Auth
  "/api/auth/status": handleAuthStatus,
  // Phase 2A — filesystem parsers
  "/api/tasks": handleTasks,
  "/api/agents": handleAgents,
  "/api/status": handleStatus,
  "/api/documents/tree": handleDocumentsTree,
  "/api/documents/content": handleDocumentsContent,
  "/api/settings": handleSettings,
  // Phase 2B — external collectors
  "/api/health": handleHealth,
  "/api/health/local": handleHealthLocal,
  "/api/health/vps": handleHealthVPS,
  "/api/ollama": handleOllama,
  "/api/projects": handleProjects,
  "/api/tokens": handleTokens,
  "/api/tokens/models": handleTokenModels,
  "/api/tokens/projects": handleTokenProjects,
  "/api/tokens/budget": handleTokenBudget,
  "/api/tokens/sessions": handleTokenSessions,
  "/api/uptime": handleUptime,
  "/api/needs": handleNeeds,
  // Phase 3 — intelligence & integrations
  "/api/ssl": handleSSL,
  "/api/alerts": handleAlerts,
  "/api/ci": handleCI,
  "/api/pagespeed": handlePageSpeed,
  // Phase 4 — operational
  "/api/diagnostics": handleDiagnostics,
  // Phase 5 — write operations (tasks)
  "/api/actions/tasks/move": handleTaskMove,
  "/api/actions/tasks/create": handleTaskCreate,
  "/api/actions/tasks/update": handleTaskUpdate,
  // Phase 5 — write operations (github)
  "/api/actions/github/pr/approve": handlePRApprove,
  "/api/actions/github/pr/merge": handlePRMerge,
  "/api/actions/github/workflow/rerun": handleWorkflowRerun,
  // Phase 5 — write operations (agents)
  "/api/actions/agents/dispatch": handleAgentDispatch,
  // Phase 5 — write operations (settings)
  "/api/actions/settings": handleSettingsGet,
  "/api/actions/settings/budget": handleBudgetUpdate,
  "/api/actions/settings/alerts": handleAlertUpdate,
  "/api/actions/settings/collectors": handleCollectorToggle,
  "/api/actions/settings/refresh-intervals": handleRefreshIntervalUpdate,
  "/api/actions/settings/update-mode": handleUpdateModeChange,
  // Phase 5 — write operations (needs)
  "/api/actions/needs/dismiss": handleNeedDismiss,
  "/api/actions/needs/snooze": handleNeedSnooze,
  // VPS management
  "/api/actions/vps/update": handleVPSUpdate,
  // Dashboard update
  "/api/update/check": handleUpdateCheck,
  "/api/actions/update/apply": handleUpdateApply,
  // Phase 5 — audit
  "/api/audit": handleAudit,
};

const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0", // Accept connections from Tailscale, not just localhost

  async fetch(req, srv) {
    const url = new URL(req.url);
    const remoteIp = extractClientIp(req, srv);

    // CORS preflight — handle before auth
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = srv.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined as unknown as Response;
    }

    // Rate limiting — before auth to prevent brute force
    const rateLimited = rateLimitMiddleware(req, remoteIp);
    if (rateLimited) return securityHeaders(req, rateLimited);

    // Authentication
    const authBlocked = await authMiddleware(req, remoteIp);
    if (authBlocked) return securityHeaders(req, authBlocked);

    // API routes
    const handler = ROUTES[url.pathname];
    if (handler) {
      try {
        const response = await handler(req);
        return securityHeaders(req, response);
      } catch (err) {
        return securityHeaders(req, apiError("INTERNAL_ERROR", String(err), url.pathname));
      }
    }

    // Health check (public, already past auth via PUBLIC_PATHS)
    if (url.pathname === "/api/health/ping") {
      const response = Response.json({
        status: "ok",
        version: DASHBOARD_VERSION,
        uptime: process.uptime(),
        wsClients: clientCount(),
        timestamp: new Date().toISOString(),
      });
      return securityHeaders(req, response);
    }

    // Unknown API route
    if (url.pathname.startsWith("/api/")) {
      return securityHeaders(req, apiError("NOT_FOUND", `Unknown endpoint: ${url.pathname}`, "router", 404));
    }

    // SPA fallback: serve client build
    try {
      const clientPath = new URL("../client/dist" + (url.pathname === "/" ? "/index.html" : url.pathname), import.meta.url).pathname;
      const file = Bun.file(clientPath);
      if (await file.exists()) {
        return new Response(file);
      }
      // SPA fallback — serve index.html for client-side routing
      const indexFile = Bun.file(new URL("../client/dist/index.html", import.meta.url).pathname);
      if (await indexFile.exists()) {
        return new Response(indexFile);
      }
    } catch {
      // Client not built yet
    }

    return new Response("Not found. Run `bun run build` in client/ first.", { status: 404 });
  },

  websocket: {
    open(ws) {
      addClient(ws);
      logger.info(`WebSocket client connected (${clientCount()} total)`);
    },
    close(ws) {
      removeClient(ws);
      logger.info(`WebSocket client disconnected (${clientCount()} total)`);
    },
    message(_ws, _message) {
      // Client messages not used yet — future: subscribe to specific channels
    },
  },
});

const hasDashboardToken = await hasSecret("DASHBOARD_TOKEN");
const authMode = hasDashboardToken ? "token" : config.localhostBypass ? "localhost-only" : "open";

logger.info("AiDevOps Dashboard Server started", {
  version: DASHBOARD_VERSION,
  http: `http://0.0.0.0:${server.port}`,
  ws: `ws://0.0.0.0:${server.port}/ws`,
  routes: Object.keys(ROUTES).length + 1, // +1 for /api/health/ping
  auth: authMode,
  localhostBypass: config.localhostBypass,
  trustProxy: config.trustProxy,
  readRateLimit: config.readRateLimit,
  github: (await hasSecret("GITHUB_TOKEN")) ? "configured" : "not configured",
  vps: config.enableVPS && config.vpsHost ? config.vpsHost : "disabled",
  ollama: config.ollamaHost,
  uptime: (await hasSecret("UPDOWN_API_KEY")) ? "configured" : "not configured",
});

// Also print to console for dev visibility
console.log(`
  AiDevOps Dashboard Server v${DASHBOARD_VERSION}
  -------------------------
  HTTP:      http://0.0.0.0:${server.port}
  WebSocket: ws://0.0.0.0:${server.port}/ws
  Routes:    ${Object.keys(ROUTES).length} endpoints + /api/health/ping
  Auth:      ${authMode} (localhost bypass: ${config.localhostBypass}, trust proxy: ${config.trustProxy})
`);
