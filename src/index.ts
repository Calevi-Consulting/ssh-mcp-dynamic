import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "ssh2";
import * as fs from "fs";
import * as os from "os";

// ---------------------------------------------------------------------------
// Configuration (all via environment variables — nothing host-specific here)
// ---------------------------------------------------------------------------

const DEFAULT_USER = process.env.SSH_MCP_DEFAULT_USER || "root";
const DEFAULT_TIMEOUT_MS = Number(process.env.SSH_MCP_TIMEOUT_MS) || 60000;
const DEFAULT_PORT = Number(process.env.SSH_MCP_DEFAULT_PORT) || 22;
const DEFAULT_KEY = process.env.SSH_MCP_DEFAULT_KEY || "";

// Named PEM key shortcuts, supplied as JSON via SSH_MCP_KEYS, e.g.
//   SSH_MCP_KEYS='{"prod":"~/keys/prod.pem","staging":"~/keys/staging.pem"}'
// Keeps private-key paths out of the source tree.
function loadKeyShortcuts(): Record<string, string> {
  const raw = process.env.SSH_MCP_KEYS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
    process.stderr.write("SSH_MCP_KEYS is not a JSON object; ignoring\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Failed to parse SSH_MCP_KEYS: ${message}\n`);
  }
  return {};
}

const KEY_SHORTCUTS = loadKeyShortcuts();

// Expand a leading ~ to the current user's home directory.
function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return os.homedir() + p.slice(1);
  return p;
}

function resolveKey(keyInput: string): string {
  const shortcut = KEY_SHORTCUTS[keyInput];
  return expandHome(shortcut ?? keyInput);
}

const shortcutNames = Object.keys(KEY_SHORTCUTS);
const shortcutHint = shortcutNames.length
  ? `Configured key shortcuts: ${shortcutNames.map((n) => `'${n}'`).join(", ")}. `
  : "";

function sshExec(
  host: string,
  port: number,
  user: string,
  keyPath: string,
  command: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = "";
    let errorOutput = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        conn.destroy();
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
      }
    }, timeoutMs);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            settled = true;
            conn.end();
            return reject(err);
          }

          stream
            .on("close", (code: number) => {
              clearTimeout(timer);
              settled = true;
              conn.end();
              const result = output + (errorOutput ? `\n[stderr]\n${errorOutput}` : "");
              if (code !== 0 && !output && errorOutput) {
                reject(new Error(`Exit code ${code}: ${errorOutput}`));
              } else {
                resolve(result || `(exit code: ${code})`);
              }
            })
            .on("data", (data: Buffer) => {
              output += data.toString();
            })
            .stderr.on("data", (data: Buffer) => {
              errorOutput += data.toString();
            });
        });
      })
      .on("error", (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error(`SSH connection error: ${err.message}`));
        }
      })
      .connect({
        host,
        port,
        username: user,
        privateKey: fs.readFileSync(keyPath),
        readyTimeout: timeoutMs,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      });
  });
}

const server = new Server(
  {
    name: "ssh-mcp-dynamic",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const keyDescription =
  shortcutHint +
  "Provide a configured key shortcut or a full path to the private key file " +
  `(supports a leading ~ for the home directory)${DEFAULT_KEY ? ", default is the SSH_MCP_DEFAULT_KEY value" : ""}.`;

function inputSchema(commandDescription: string) {
  return {
    type: "object",
    properties: {
      host: {
        type: "string",
        description: "IP address or hostname of the remote server",
      },
      command: {
        type: "string",
        description: commandDescription,
      },
      key: {
        type: "string",
        description: keyDescription,
        ...(DEFAULT_KEY ? { default: DEFAULT_KEY } : {}),
      },
      user: {
        type: "string",
        description: `SSH username (default: ${DEFAULT_USER})`,
        default: DEFAULT_USER,
      },
      port: {
        type: "number",
        description: `SSH port (default: ${DEFAULT_PORT})`,
        default: DEFAULT_PORT,
      },
      timeout: {
        type: "number",
        description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
        default: DEFAULT_TIMEOUT_MS,
      },
    },
    required: ["host", "command"],
  };
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "ssh_exec",
        description:
          "Execute a shell command on a remote host via SSH. " + shortcutHint,
        inputSchema: inputSchema("Shell command to execute on the remote server"),
      },
      {
        name: "ssh_sudo_exec",
        description:
          "Execute a shell command with sudo on a remote host via SSH. " + shortcutHint,
        inputSchema: inputSchema(
          "Shell command to execute with sudo (do not include 'sudo' prefix)"
        ),
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== "ssh_exec" && name !== "ssh_sudo_exec") {
    throw new Error(`Unknown tool: ${name}`);
  }

  const host = args?.host as string;
  const command = args?.command as string;
  const keyInput = (args?.key as string) || DEFAULT_KEY;
  const user = (args?.user as string) || DEFAULT_USER;
  const port = (args?.port as number) || DEFAULT_PORT;
  const timeout = (args?.timeout as number) || DEFAULT_TIMEOUT_MS;

  if (!host) throw new Error("Parameter 'host' is required");
  if (!command) throw new Error("Parameter 'command' is required");
  if (!keyInput)
    throw new Error(
      "Parameter 'key' is required (no SSH_MCP_DEFAULT_KEY configured)"
    );

  const keyPath = resolveKey(keyInput);

  if (!fs.existsSync(keyPath)) {
    throw new Error(`PEM key file not found: ${keyPath}`);
  }

  const finalCommand = name === "ssh_sudo_exec" ? `sudo ${command}` : command;

  try {
    const output = await sshExec(host, port, user, keyPath, finalCommand, timeout);
    return {
      content: [{ type: "text", text: output }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `ERROR: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("ssh-mcp-dynamic running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
