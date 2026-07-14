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

## Security notes

- **This server executes arbitrary shell commands on remote hosts**, including with `sudo` via `ssh_sudo_exec`. Only connect it to hosts and keys you control, and only run it with an MCP client you trust.
- Private keys are read from disk at call time. **Never commit private keys** — `*.pem`, `*.key`, and common key filenames are already in `.gitignore`.
- Prefer keys that are passphrase-protected or scoped to specific hosts.
- The server communicates over stdio with the local MCP client; it does not open any network listener of its own.

## License

[MIT](./LICENSE)
