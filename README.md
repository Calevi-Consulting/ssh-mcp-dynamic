# ssh-mcp-dynamic

A minimal [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets an MCP client (e.g. Claude Desktop) run shell commands on remote hosts over SSH. The host, private key, user and port are chosen **per call**, so a single server instance can reach many machines.

It exposes two tools:

| Tool | Description |
|------|-------------|
| `ssh_exec` | Run a shell command on a remote host. |
| `ssh_sudo_exec` | Run a shell command with `sudo` (don't include the `sudo` prefix yourself). |

Authentication is key-based only (PEM private keys). No passwords are handled or stored.

## Requirements

- Node.js 18+
- SSH access to the target hosts with a private key

## Install & build

```bash
npm install
npm run build
```

This compiles `src/index.ts` to `dist/index.js`.

## Configuration

Everything host-specific is supplied through environment variables — nothing is hardcoded in the source.

| Variable | Default | Purpose |
|----------|---------|---------|
| `SSH_MCP_KEYS` | `{}` | JSON object mapping **key shortcuts** to private-key paths. A leading `~` expands to the home directory. |
| `SSH_MCP_DEFAULT_KEY` | *(none)* | Shortcut or path used when a call omits `key`. If unset, `key` is required per call. |
| `SSH_MCP_DEFAULT_USER` | `root` | Default SSH username. |
| `SSH_MCP_DEFAULT_PORT` | `22` | Default SSH port. |
| `SSH_MCP_TIMEOUT_MS` | `60000` | Default command/connection timeout in milliseconds. |

Example `SSH_MCP_KEYS`:

```json
{
  "prod": "~/keys/prod.pem",
  "staging": "~/keys/staging.pem"
}
```

With that set, a call can pass `"key": "prod"` instead of a full path. You can also pass a full path directly at call time without configuring any shortcut.

### Tool parameters

Both tools accept:

- `host` (required) — IP or hostname.
- `command` (required) — the shell command.
- `key` — a configured shortcut or a path to the PEM file. Required unless `SSH_MCP_DEFAULT_KEY` is set.
- `user` — SSH username (defaults to `SSH_MCP_DEFAULT_USER`).
- `port` — SSH port (defaults to `SSH_MCP_DEFAULT_PORT`).
- `timeout` — timeout in ms (defaults to `SSH_MCP_TIMEOUT_MS`).

## Use with Claude Code (CLI)

The quickest way — no clone, no manual build. Claude Code runs it on demand via `npx` straight from GitHub:

```bash
claude mcp add ssh-mcp -s user \
  -e SSH_MCP_KEYS='{"prod":"~/keys/prod.pem"}' \
  -e SSH_MCP_DEFAULT_KEY=prod \
  -e SSH_MCP_DEFAULT_USER=ubuntu \
  -- npx -y github:Calevi-Consulting/ssh-mcp-dynamic
```

`npx` clones the repo, builds it (via the `prepare` script) and launches the server. Once published to npm you can drop the `github:` prefix and use `npx -y ssh-mcp-dynamic`.

Prefer a local checkout? Build it once and point Claude Code at the compiled file:

```bash
git clone https://github.com/Calevi-Consulting/ssh-mcp-dynamic.git
cd ssh-mcp-dynamic && npm install && npm run build

claude mcp add ssh-mcp -s user \
  -e SSH_MCP_KEYS='{"prod":"~/keys/prod.pem"}' \
  -e SSH_MCP_DEFAULT_KEY=prod \
  -- node "$(pwd)/dist/index.js"
```

**Scopes** (`-s`): `local` (default, current project only), `user` (all your projects), `project` (saved to a versioned `.mcp.json` to share with your team).

Verify with `claude mcp list`, or `/mcp` inside a session. Remove with `claude mcp remove ssh-mcp`.

## Use with Claude Desktop

Add the server to your `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ssh-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/ssh-mcp-dynamic/dist/index.js"],
      "env": {
        "SSH_MCP_KEYS": "{\"prod\":\"~/keys/prod.pem\",\"staging\":\"~/keys/staging.pem\"}",
        "SSH_MCP_DEFAULT_KEY": "prod",
        "SSH_MCP_DEFAULT_USER": "ubuntu"
      }
    }
  }
}
```

Restart Claude Desktop after editing the config.

## Usage

Once the server is registered, you don't call the tools directly — you ask your MCP client (Claude Code / Claude Desktop) in plain language and it invokes `ssh_exec` / `ssh_sudo_exec` for you. Some example prompts:

```text
Using ssh-mcp, run `hostname && uptime` on 10.0.0.5 with the prod key.

Check the free disk space on staging.example.com (df -h) via ssh-mcp.

On 10.0.0.5, tail the last 50 lines of /var/log/syslog with sudo.

Restart nginx on web-01.example.com with sudo, then show `systemctl status nginx`.

Run `docker ps` on 203.0.113.10 as user ubuntu on port 2222 using ~/keys/prod.pem.
```

How those map to a tool call (the client fills this in for you):

```jsonc
// "run hostname on 10.0.0.5 with the prod key"
{
  "tool": "ssh_exec",
  "host": "10.0.0.5",
  "command": "hostname",
  "key": "prod"          // a configured shortcut, or a full path like ~/keys/prod.pem
}

// "tail syslog with sudo on 10.0.0.5"
{
  "tool": "ssh_sudo_exec",
  "host": "10.0.0.5",
  "command": "tail -n 50 /var/log/syslog"   // no 'sudo' prefix — the tool adds it
}
```

Tips:
- Mention the host, the command, and which key/user/port when they aren't the configured defaults.
- Naming the server ("using ssh-mcp…") helps the client pick the right tool when you have several MCP servers registered.
- For privileged commands ask for "with sudo" so the client uses `ssh_sudo_exec` — and don't put `sudo` in the command yourself.

## Security notes

- **This server executes arbitrary shell commands on remote hosts**, including with `sudo` via `ssh_sudo_exec`. Only connect it to hosts and keys you control, and only run it with an MCP client you trust.
- Private keys are read from disk at call time. **Never commit private keys** — `*.pem`, `*.key`, and common key filenames are already in `.gitignore`.
- Prefer keys that are passphrase-protected or scoped to specific hosts.
- The server communicates over stdio with the local MCP client; it does not open any network listener of its own.

## License

[MIT](./LICENSE)
