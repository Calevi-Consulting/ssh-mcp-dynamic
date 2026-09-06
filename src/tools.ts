import * as fs from "fs";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Config, resolveKey } from "./config";
import { isHostAllowed } from "./policy";
import { createHostVerification, HostVerification } from "./knownHosts";
import { sshExec, Executor, ExecResult } from "./ssh";
import { writeAuditEvent, AuditEvent, StderrWriter } from "./audit";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export interface ToolDeps {
  exec?: Executor;
  stderr?: StderrWriter;
}

function quoteList(items: string[]): string {
  return items.map((i) => `'${i}'`).join(", ");
}

export function toolDefinitions(config: Config): Tool[] {
  const shortcutNames = Object.keys(config.keyShortcuts);
  const shortcutHint = shortcutNames.length
    ? `Configured key shortcuts: ${quoteList(shortcutNames)}. `
    : "";
  const allowedHint = config.allowedHosts.length
    ? ` Only these hosts are allowed (SSH_MCP_ALLOWED_HOSTS): ${quoteList(config.allowedHosts)}.`
    : "";
  const keyDescription =
    shortcutHint +
    "Provide a configured key shortcut or a full path to the private key file " +
    `(supports a leading ~ for the home directory)${
      config.defaultKey ? ", default is the SSH_MCP_DEFAULT_KEY value" : ""
    }.`;

  const inputSchema = (commandDescription: string): Tool["inputSchema"] => ({
    type: "object",
    properties: {
      host: {
        type: "string",
        description: `IP address or hostname of the remote server.${allowedHint}`,
      },
      command: { type: "string", description: commandDescription },
      key: {
        type: "string",
        description: keyDescription,
        ...(config.defaultKey ? { default: config.defaultKey } : {}),
      },
      user: {
        type: "string",
        description: `SSH username (default: ${config.defaultUser})`,
        default: config.defaultUser,
      },
      port: {
        type: "number",
        description: `SSH port (default: ${config.defaultPort})`,
        default: config.defaultPort,
      },
      timeout: {
        type: "number",
        description: `Timeout in milliseconds (default: ${config.defaultTimeoutMs})`,
        default: config.defaultTimeoutMs,
      },
    },
    required: ["host", "command"],
  });

  const describe = (base: string) => [base, shortcutHint.trim(), allowedHint.trim()].filter(Boolean).join(" ");

  return [
    {
      name: "ssh_exec",
      description: describe("Execute a shell command on a remote host via SSH."),
      inputSchema: inputSchema("Shell command to execute on the remote server"),
    },
    {
      name: "ssh_sudo_exec",
      description: describe("Execute a shell command with sudo on a remote host via SSH."),
      inputSchema: inputSchema("Shell command to execute with sudo (do not include 'sudo' prefix)"),
    },
  ];
}

// Tool response text, unchanged from v1.0.0.
export function formatExecResult(result: ExecResult): { text: string; isError: boolean } {
  const { stdout, stderr, code } = result;
  if (code !== 0 && !stdout && stderr) {
    return { text: `ERROR: Exit code ${code}: ${stderr}`, isError: true };
  }
  const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
  return { text: combined || `(exit code: ${code})`, isError: false };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: `ERROR: ${message}` }], isError: true };
}

interface CallArgs {
  host: string;
  keyInput: string;
  user: string;
  port: number;
  timeout: number;
  /** Command as sent to the host, including the `sudo` prefix for ssh_sudo_exec. */
  finalCommand: string;
}

// Validation errors are thrown (not returned as isError results), as in v1.0.0.
function parseCallArgs(name: string, args: Record<string, unknown> | undefined, config: Config): CallArgs {
  if (name !== "ssh_exec" && name !== "ssh_sudo_exec") {
    throw new Error(`Unknown tool: ${name}`);
  }
  const host = args?.host as string;
  const command = args?.command as string;
  const keyInput = (args?.key as string) || config.defaultKey;

  if (!host) throw new Error("Parameter 'host' is required");
  if (!command) throw new Error("Parameter 'command' is required");
  if (!keyInput) {
    throw new Error("Parameter 'key' is required (no SSH_MCP_DEFAULT_KEY configured)");
  }

  return {
    host,
    keyInput,
    user: (args?.user as string) || config.defaultUser,
    port: (args?.port as number) || config.defaultPort,
    timeout: (args?.timeout as number) || config.defaultTimeoutMs,
    finalCommand: name === "ssh_sudo_exec" ? `sudo ${command}` : command,
  };
}

type AuditFields = Pick<AuditEvent, "outcome" | "exit_code" | "error">;

// One audit record per call; duration is measured from when the auditor is created.
function createAuditor(tool: string, call: CallArgs, config: Config, deps: ToolDeps): (fields: AuditFields) => void {
  const started = Date.now();
  return (fields) =>
    writeAuditEvent(
      {
        ts: new Date().toISOString(),
        tool,
        host: call.host,
        port: call.port,
        user: call.user,
        key: call.keyInput,
        command: call.finalCommand,
        duration_ms: Date.now() - started,
        ...fields,
      },
      config.auditLogPath,
      deps.stderr
    );
}

export async function runTool(
  name: string,
  args: Record<string, unknown> | undefined,
  config: Config,
  deps: ToolDeps = {}
): Promise<ToolResult> {
  const call = parseCallArgs(name, args, config);
  const { host, keyInput, user, port, timeout, finalCommand } = call;
  const exec = deps.exec ?? sshExec;
  const audit = createAuditor(name, call, config, deps);

  if (!isHostAllowed(host, config.allowedHosts)) {
    const message = `Host '${host}' is not in SSH_MCP_ALLOWED_HOSTS (${quoteList(config.allowedHosts)})`;
    audit({ outcome: "denied", error: message });
    return errorResult(message);
  }

  const keyPath = resolveKey(keyInput, config.keyShortcuts);
  if (!fs.existsSync(keyPath)) {
    throw new Error(`PEM key file not found: ${keyPath}`);
  }

  let verification: HostVerification;
  try {
    verification = createHostVerification(host, port, {
      mode: config.hostKeyChecking,
      knownHostsPath: config.knownHostsPath,
    });
  } catch (err) {
    const message = `Could not read known_hosts ${config.knownHostsPath}: ${
      err instanceof Error ? err.message : String(err)
    }`;
    audit({ outcome: "error", error: message });
    return errorResult(message);
  }

  try {
    const result = await exec({
      host,
      port,
      user,
      keyPath,
      command: finalCommand,
      timeoutMs: timeout,
      verification,
    });
    const { text, isError } = formatExecResult(result);
    audit({
      outcome: result.code === 0 ? "ok" : "error",
      exit_code: result.code,
      ...(result.code === 0 ? {} : { error: `exit code ${result.code}` }),
    });
    return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    audit({ outcome: verification.failure() ? "denied" : "error", error: message });
    return errorResult(message);
  }
}
