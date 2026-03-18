# AiDevOps Command Center

A browser-based operational dashboard for the [aidevops](https://github.com/marcusquinn/aidevops) framework. Real-time visibility into projects, infrastructure health, AI agent activity, task management, token consumption, and human action queues — plus write-back operations for tasks, PRs, agents, and settings.

Built entirely by Claude Opus 4.6 via Claude Code. Human reviews and approves.

## Status

**Phases 1-5 complete. Phase 6 planned.**

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Frontend Mockup & Foundation | Done |
| 2 | Backend API & Data Layer | Done |
| 3 | Intelligence & Integrations | Done |
| 4 | Remote Access, Auth & Multi-Device | Done |
| 5 | Write Operations | Done |
| 6 | Matrix & Domain-Specific Panels | Planned |

## Stack

- **Runtime:** [Bun](https://bun.sh) (server + package manager)
- **Frontend:** React 19, Vite 7, Tailwind CSS 4, shadcn/ui, Recharts, dnd-kit
- **Backend:** Bun.serve with REST API + WebSocket
- **Auth:** 3-tier (localhost bypass, Tailscale identity, bearer token)
- **Data:** Filesystem-first (no database) — reads from `~/.aidevops/`, `TODO.md`, Claude JSONL logs
- **Remote access:** Tailscale mesh network

## Quick Start

```bash
# Install dependencies
bun install
cd client && bun install && cd ..

# Development (client + server with hot reload)
bun run dev

# Or run separately
DASHBOARD_PORT=3001 bun run server:dev   # Backend on :3001
cd client && bun run dev --port 3000     # Frontend on :3000 (proxies API to :3001)

# Production
cd client && bun run build
DASHBOARD_PORT=3001 bun run start
```

The client dev server proxies `/api` and `/ws` to the backend port.

## Architecture

```
Browser (:3000)                    Bun.serve (:3001)
┌──────────────────────┐          ┌──────────────────────────────┐
│  React SPA           │  REST    │  39 API endpoints            │
│  9 pages, 83 comps   │ ──────> │  WebSocket real-time push    │
│  Tailwind + shadcn   │  WS     │  6 collectors, 3 parsers     │
│  dnd-kit kanban      │ <────── │  5 writers (TODO, config,    │
│  Recharts charts     │          │    audit, settings, needs)   │
└──────────────────────┘          └──────────┬───────────────────┘
                                             │
                                  ┌──────────┴───────────────────┐
                                  │  Data Sources                │
                                  │  ~/.aidevops/ filesystem     │
                                  │  TODO.md (atomic R/W)        │
                                  │  ~/.claude/ JSONL logs       │
                                  │  GitHub API, Ollama API      │
                                  │  updown.io, PageSpeed        │
                                  │  macOS system metrics        │
                                  │  VPS metrics via SSH         │
                                  └──────────────────────────────┘
```

## Pages

| Page | Description |
|------|-------------|
| **Overview** | Quick stats, needs badge, recent activity, system gauges |
| **Projects** | Registered repos with GitHub status, PR counts, CI health |
| **Kanban** | Drag-and-drop task board backed by TODO.md with atomic writes |
| **Health** | System metrics (CPU/RAM/disk), SSL certs, CI/CD pipelines, uptime |
| **Needs From Me** | Aggregated action items — PR reviews, CI failures, overdue tasks, expiring certs |
| **Tokens** | Token spend analytics, budget tracking, burn rate projection, per-session costs |
| **Agents** | AI agent roster, subagent tree, MCP server status, agent dispatch |
| **Documents** | File tree browser with markdown viewer for framework docs |
| **Settings** | Framework version, API keys, MCP config, Tailscale status, dashboard config, audit log |

## API

39 REST endpoints + WebSocket + health ping. All responses follow:

```json
{ "data": { ... }, "meta": { "source": "...", "timestamp": "...", "cached": false, "ttl": 60 } }
```

### Read endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health/ping` | Server health check |
| GET | `/api/status` | Framework status |
| GET | `/api/tasks` | Parsed TODO.md tasks |
| GET | `/api/projects` | Registered repos with GitHub data |
| GET | `/api/agents` | Agent roster from `~/.aidevops/agents/` |
| GET | `/api/needs` | Aggregated needs from all sources |
| GET | `/api/tokens` | Token usage and budget analytics |
| GET | `/api/ci` | GitHub Actions pipeline status |
| GET | `/api/ssl` | SSL certificate expiry monitoring |
| GET | `/api/uptime` | updown.io uptime metrics |
| GET | `/api/pagespeed` | PageSpeed Insights scores |
| GET | `/api/system` | Local system metrics (CPU/RAM/disk) |
| GET | `/api/ollama` | Ollama model status |
| GET | `/api/audit` | Action audit trail (filterable) |
| GET | `/api/diagnostics` | Server diagnostics and health |

### Write endpoints

All write endpoints require authentication and log to the audit trail.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/actions/tasks/create` | Create a new task in TODO.md |
| POST | `/api/actions/tasks/move` | Move task between kanban columns |
| POST | `/api/actions/tasks/update` | Update task metadata |
| POST | `/api/actions/github/pr/approve` | Approve a GitHub PR |
| POST | `/api/actions/github/pr/merge` | Merge a GitHub PR (squash) |
| POST | `/api/actions/github/workflow/rerun` | Re-run a failed CI workflow |
| POST | `/api/actions/agents/dispatch` | Dispatch an AI agent |
| PUT | `/api/actions/settings/budget` | Update token budget cap |
| PUT | `/api/actions/settings/alerts` | Toggle alert rules |
| PUT | `/api/actions/settings/collectors` | Enable/disable data collectors |
| POST | `/api/actions/needs/dismiss` | Permanently dismiss a need |
| POST | `/api/actions/needs/snooze` | Snooze a need with duration |

## Write Safety

Every write action follows the same pattern:

1. User clicks action button
2. Confirmation dialog shows what will happen
3. API call with optimistic UI update
4. Rollback on failure, toast notification on result
5. Action logged to append-only audit trail (`~/.aidevops/dashboard/audit.jsonl`)

TODO.md writes use atomic operations: backup current file, write to temp, rename into place. Failures restore from backup automatically. Last 20 backups retained.

Rate limits: 100 reads/min, 30 writes/min per user.

## Auth

Three tiers, checked in order:

1. **Localhost bypass** — requests from `127.0.0.1` / `::1` are trusted (uses TCP socket address, not headers)
2. **Tailscale identity** — `Tailscale-User-Login` header from Tailscale Serve
3. **Bearer token** — `Authorization: Bearer <token>` for API access

### Proxy Trust (`TRUST_PROXY`)

By default, `TRUST_PROXY=false` — the server uses Bun's native `requestIP()` to read the TCP socket address for localhost detection. This **cannot be spoofed** by clients sending fake `X-Forwarded-For` or `X-Real-IP` headers.

Set `TRUST_PROXY=true` **only** when running behind a reverse proxy that overwrites forwarded headers with the real client IP:

| Deployment | `TRUST_PROXY` | Why |
|------------|---------------|-----|
| Direct (localhost dev) | `false` (default) | No proxy — socket IP is accurate |
| Tailscale Serve | `true` | Tailscale Serve sets `X-Forwarded-For` to the Tailscale peer IP |
| Traefik / nginx | `true` | Proxy overwrites forwarded headers |
| Public internet (no proxy) | `false` | Headers are client-controlled and spoofable |

### Tailscale Serve Header Security

When using Tailscale Serve as a reverse proxy, it sets identity headers (`Tailscale-User-Login`, `Tailscale-User-Name`) and `X-Forwarded-For`. Tailscale Serve **strips** any client-supplied `Tailscale-User-*` headers before forwarding, preventing identity spoofing. However, ensure your Tailscale Serve configuration does not expose the backend port directly — only the Tailscale Serve endpoint should be reachable from the tailnet.

## Dark Theme

Near-black background (`#0a0a0f`), dark gray cards (`#111118`), cyan accent (`#06b6d4`). JetBrains Mono for data/metrics, Plus Jakarta Sans for UI text. Dark mode only — no light theme.

## Project Structure

```
aidevops-dashboard/
├── client/
│   ├── src/
│   │   ├── pages/              # 9 page components
│   │   ├── components/         # 83 components
│   │   │   ├── actions/        # ConfirmDialog, ActionButton, TaskCreate, AuditLog
│   │   │   ├── agents/         # AgentCard, AgentDispatch, SubagentTree, MCPStatus
│   │   │   ├── health/         # CICDStatus, SSLPanel, ServerPanel
│   │   │   ├── kanban/         # KanbanBoard, KanbanColumn, TaskCard
│   │   │   ├── needs/          # NeedItem (with type-specific actions), NeedsList
│   │   │   ├── overview/       # QuickStats, NeedsBadge, RecentActivity
│   │   │   ├── settings/       # DashboardConfig, FrameworkVersion, APIKeyStatus
│   │   │   ├── tokens/         # BudgetDashboard, SessionCosts
│   │   │   ├── layout/         # Sidebar, TopBar, MobileNav, CommandPalette
│   │   │   └── shared/         # GaugeRing, MetricCard, LoadingPanel, StatusBadge
│   │   ├── hooks/              # useApiData, useWebSocket, useAuth, useAction
│   │   └── lib/                # Config, utilities
│   └── vite.config.ts
├── server/
│   ├── index.ts                # Route registration, Bun.serve
│   ├── config.ts               # Paths, secrets, thresholds
│   ├── collectors/             # system-local, system-vps, ollama, git, token, uptime, ssl, actions, pagespeed
│   ├── parsers/                # todo-parser, skill-parser, status-parser
│   ├── writers/                # todo-writer, audit-log, config-writer
│   ├── routes/                 # All API route handlers
│   │   └── actions/            # Write endpoints (tasks, github, agents, settings, needs)
│   ├── middleware/             # auth, rate-limit, security, write-auth
│   ├── cache/                  # Bounded in-memory cache (128MB limit)
│   ├── ws/                     # WebSocket real-time broadcast
│   ├── watchers/               # Filesystem watchers (fsevents)
│   └── health/                 # Structured logging, diagnostics
├── plan.md                     # Master plan (6 phases)
├── phase-1.md ... phase-5.md   # Phase specifications
└── package.json
```

## Runtime Data

Created at runtime, not in the repo:

```
~/.aidevops/dashboard/
├── logs/dashboard-YYYY-MM-DD.log   # Structured JSONL server logs
├── backups/TODO.md.*               # TODO.md write backups (last 20)
├── audit.jsonl                     # Append-only action audit trail
├── settings.json                   # Dashboard configuration (budget, alerts, collectors)
└── needs-state.json                # Dismissed/snoozed needs state
```

## Phase 6 — Planned

Matrix communications hub and domain-specific operational panels:

- **Matrix integration** — Room listing, message feeds, agent output filtering, unread tracking via Matrix Client-Server API (Conduit/Synapse)
- **SEO panel** — Google Search Console, DataForSEO, keyword tracking
- **WordPress panel** — MainWP integration, plugin/theme update status, site health
- **Extended git views** — Unified commit feed, branch management, PR review interface
- **Session replay** — Browse past Claude session logs with timeline
- **Notification system** — Desktop notifications, email digests
- **Dashboard as agent** — `@dashboard` agent with self-update capability

## Key Principles

1. **Plugin, not monolith** — Separate repo, reads from aidevops filesystem conventions
2. **Filesystem-first** — No database; state lives in markdown and JSON files
3. **Local-first** — Runs on localhost, extends to Tailscale mesh for remote access
4. **Confirm before write** — Every write action requires explicit confirmation dialog
5. **AI-built** — Every line written by Claude Opus 4.6, human reviews and approves

## License

[MIT](LICENSE)
