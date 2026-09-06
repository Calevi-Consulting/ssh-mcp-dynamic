import * as fs from "fs";
import * as path from "path";

// One JSON line per tool call. Never includes key material or command output.
export interface AuditEvent {
  ts: string;
  tool: string;
  host: string;
  port: number;
  user: string;
  /** The `key` argument as supplied (shortcut name or path), never file contents. */
  key: string;
  /** Final command sent to the host, including any `sudo` prefix. */
  command: string;
  /** ok = exit 0; error = non-zero exit or connection failure; denied = blocked by policy. */
  outcome: "ok" | "error" | "denied";
  exit_code?: number | null;
  duration_ms: number;
  error?: string;
}

export type StderrWriter = (text: string) => void;

const defaultStderr: StderrWriter = (text) => process.stderr.write(text);

export function writeAuditEvent(
  event: AuditEvent,
  auditLogPath: string | undefined,
  stderr: StderrWriter = defaultStderr
): void {
  const line = `${JSON.stringify(event)}\n`;
  stderr(line);
  if (!auditLogPath) return;
  try {
    fs.mkdirSync(path.dirname(auditLogPath), { recursive: true });
    fs.appendFileSync(auditLogPath, line, { mode: 0o600 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr(`Failed to write audit log ${auditLogPath}: ${message}\n`);
  }
}
