// Host allowlist: SSH_MCP_ALLOWED_HOSTS="10.0.0.5,*.example.com,web-0?"

export function parseAllowedHosts(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

// Convert a shell-style glob (`*`, `?`) into an anchored, case-insensitive RegExp.
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

// An empty allowlist means "any host" (backwards compatible with v1.0.0).
export function isHostAllowed(host: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  return allowed.some((pattern) => globToRegExp(pattern).test(host));
}
