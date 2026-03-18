import { config } from "../config";
import { getSecret } from "../secrets";

export interface AuthResult {
  authenticated: boolean;
  user: string | null;
  method: "localhost" | "tailscale" | "token" | "none";
}

/** Bun server interface — only the requestIP method we need */
interface BunServer {
  requestIP?: (req: Request) => { address: string } | null;
}

export async function authenticate(req: Request, remoteIp?: string): Promise<AuthResult> {
  const ip = remoteIp ?? "unknown";

  // Tier 1: Localhost bypass
  if (config.localhostBypass && isLocalhost(ip)) {
    return { authenticated: true, user: "localhost", method: "localhost" };
  }

  // Tier 2: Tailscale identity headers (set by `tailscale serve`)
  const tsLogin = req.headers.get("Tailscale-User-Login");
  const tsName = req.headers.get("Tailscale-User-Name");

  if (tsLogin) {
    if (config.allowedTailscaleUsers.length === 0 || config.allowedTailscaleUsers.includes(tsLogin)) {
      return { authenticated: true, user: tsName ?? tsLogin, method: "tailscale" };
    }
    return { authenticated: false, user: tsLogin, method: "none" };
  }

  // Tier 3: Bearer token
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const dashboardToken = await getSecret("DASHBOARD_TOKEN");
    if (dashboardToken && token === dashboardToken) {
      return { authenticated: true, user: "api-token", method: "token" };
    }
  }

  return { authenticated: false, user: null, method: "none" };
}

/**
 * Extract the real client IP address.
 *
 * Security: X-Forwarded-For and X-Real-IP are trivially spoofable by any client.
 * They are ONLY trusted when config.trustProxy is true (TRUST_PROXY=true), meaning
 * the server is behind a reverse proxy (Tailscale Serve, Traefik, nginx) that
 * overwrites these headers with the actual client IP.
 *
 * When trustProxy is false (default), we use Bun's native requestIP() which reads
 * the TCP socket address — this cannot be spoofed.
 */
export function extractClientIp(req: Request, server: BunServer): string {
  if (config.trustProxy) {
    // Trusted proxy mode: proxy overwrites forwarded headers with real client IP
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();

    const realIp = req.headers.get("x-real-ip");
    if (realIp) return realIp;
  }

  // Direct mode (default): use TCP socket address — cannot be spoofed
  try {
    const ip = server.requestIP?.(req);
    if (ip?.address) return ip.address;
  } catch {
    // requestIP not available (e.g. in tests)
  }

  return "unknown";
}

function isLocalhost(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost") return true;
  // Docker bridge networks (Traefik container → host) are local infrastructure
  if (ip.startsWith("172.") || ip.startsWith("192.168.") || ip.startsWith("::ffff:172.") || ip.startsWith("::ffff:192.168.")) return true;
  return false;
}

// Public paths that skip auth entirely
const PUBLIC_PATHS = new Set([
  "/api/health/ping",
  "/api/auth/status",
]);

export async function authMiddleware(req: Request, remoteIp?: string): Promise<Response | null> {
  const path = new URL(req.url).pathname;

  // Public endpoints — no auth required
  if (PUBLIC_PATHS.has(path)) return null;

  // Static assets and SPA fallback — no auth (Tailscale Serve handles network-level access)
  if (!path.startsWith("/api/") && !path.startsWith("/ws")) return null;

  const auth = await authenticate(req, remoteIp);
  if (!auth.authenticated) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required", method: auth.method } },
      { status: 401 }
    );
  }

  return null; // Pass through — authenticated
}
