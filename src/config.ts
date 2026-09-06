import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseAllowedHosts } from "./policy";

export type HostKeyChecking = "strict" | "accept-new" | "off";

export interface Config {
  defaultUser: string;
  defaultPort: number;
  defaultTimeoutMs: number;
  defaultKey: string;
  keyShortcuts: Record<string, string>;
  /** Empty array = any host. */
  allowedHosts: string[];
  hostKeyChecking: HostKeyChecking;
  knownHostsPath: string;
  auditLogPath: string | undefined;
}

export type Warn = (message: string) => void;

const defaultWarn: Warn = (message) => process.stderr.write(`${message}\n`);

// Expand a leading ~ to the current user's home directory.
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return os.homedir() + p.slice(1);
  return p;
}

// Named PEM key shortcuts, supplied as JSON via SSH_MCP_KEYS, e.g.
//   SSH_MCP_KEYS='{"prod":"~/keys/prod.pem","staging":"~/keys/staging.pem"}'
// Keeps private-key paths out of the source tree.
export function loadKeyShortcuts(raw: string | undefined, warn: Warn = defaultWarn): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    warn("SSH_MCP_KEYS is not a JSON object; ignoring");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Failed to parse SSH_MCP_KEYS: ${message}`);
  }
  return {};
}

export function parseHostKeyChecking(raw: string | undefined, warn: Warn = defaultWarn): HostKeyChecking {
  const value = (raw ?? "strict").trim().toLowerCase();
  if (value === "" || value === "strict") return "strict";
  if (value === "accept-new" || value === "off") return value;
  warn(`Unknown SSH_MCP_HOST_KEY_CHECKING value '${raw}'; using 'strict'`);
  return "strict";
}

export function resolveKey(keyInput: string, shortcuts: Record<string, string>): string {
  const shortcut = shortcuts[keyInput];
  return expandHome(shortcut ?? keyInput);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, warn: Warn = defaultWarn): Config {
  return {
    defaultUser: env.SSH_MCP_DEFAULT_USER || "root",
    defaultPort: Number(env.SSH_MCP_DEFAULT_PORT) || 22,
    defaultTimeoutMs: Number(env.SSH_MCP_TIMEOUT_MS) || 60000,
    defaultKey: env.SSH_MCP_DEFAULT_KEY || "",
    keyShortcuts: loadKeyShortcuts(env.SSH_MCP_KEYS, warn),
    allowedHosts: parseAllowedHosts(env.SSH_MCP_ALLOWED_HOSTS),
    hostKeyChecking: parseHostKeyChecking(env.SSH_MCP_HOST_KEY_CHECKING, warn),
    knownHostsPath: expandHome(env.SSH_MCP_KNOWN_HOSTS || "~/.ssh/known_hosts"),
    auditLogPath: env.SSH_MCP_AUDIT_LOG ? expandHome(env.SSH_MCP_AUDIT_LOG) : undefined,
  };
}

export function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}
