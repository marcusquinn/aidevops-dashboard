const HOME = process.env.HOME ?? "/tmp";

export const config = {
  port: Number(process.env.DASHBOARD_PORT ?? 3000),

  // Paths
  aidevopsDir: process.env.AIDEVOPS_DIR ?? `${HOME}/.aidevops`,
  aidevopsAgents: process.env.AIDEVOPS_AGENTS ?? `${HOME}/.aidevops/agents`,
  aidevopsRepo: process.env.AIDEVOPS_REPO ?? `${HOME}/Git/aidevops`,
  workspaceDir: process.env.WORKSPACE_DIR ?? `${HOME}/.aidevops/.agent-workspace`,
  gitDir: process.env.GIT_DIR ?? `${HOME}/Git`,

  // VPS SSH
  vpsHost: process.env.VPS_HOST ?? null,
  vpsUser: process.env.VPS_USER ?? "root",
  vpsPort: Number(process.env.VPS_PORT ?? 22),

  // Ollama
  ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",

  // Token tracking
  claudeLogDir: process.env.CLAUDE_LOG_DIR ?? `${HOME}/.claude/projects`,

  // Feature flags
  enableVPS: process.env.ENABLE_VPS !== "false",
  enableGit: process.env.ENABLE_GIT !== "false",
  enableUptime: process.env.ENABLE_UPTIME !== "false",
  enablePagespeed: process.env.ENABLE_PAGESPEED !== "false",

  // Alert thresholds
  thresholds: {
    tokenBudget: {
      monthlyCap: Number(process.env.DASHBOARD_TOKEN_BUDGET ?? 400),
      dailyWarn: Number(process.env.DASHBOARD_TOKEN_DAILY_WARN ?? 25),
      monthlyWarnPct: 75,
      monthlyAlertPct: 90,
    },
    health: {
      cpuWarn: 80,
      ramWarn: 85,
      diskWarn: 90,
    },
    ssl: {
      expiryWarnDays: 14,
      expiryAlertDays: 7,
    },
    tasks: {
      overdueAfterDays: 7,
    },
    branches: {
      staleDays: 30,
    },
  },

  // PageSpeed
  pagespeedUrls: (process.env.PAGESPEED_URLS ?? "").split(",").filter(Boolean),

  // Auth (Phase 4)
  localhostBypass: process.env.DASHBOARD_LOCALHOST_BYPASS !== "false",
  allowedTailscaleUsers: (process.env.DASHBOARD_ALLOWED_USERS ?? "").split(",").filter(Boolean),
  // Only trust X-Forwarded-For / X-Real-IP when behind a known proxy (e.g. Tailscale Serve, Traefik).
  // When false (default), uses Bun's native requestIP() for localhost detection — prevents
  // remote clients from spoofing 127.0.0.1 via headers to bypass auth.
  trustProxy: process.env.TRUST_PROXY === "true",

  // Rate limiting
  readRateLimit: Number(process.env.DASHBOARD_READ_RATE_LIMIT ?? 100),
  wsMaxConnections: Number(process.env.DASHBOARD_WS_MAX ?? 5),
};
