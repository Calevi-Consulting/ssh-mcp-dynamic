# ssh-mcp-dynamic

[![CI](https://github.com/Calevi-Consulting/ssh-mcp-dynamic/actions/workflows/ci.yml/badge.svg)](https://github.com/Calevi-Consulting/ssh-mcp-dynamic/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/%40calevi%2Fssh-mcp-dynamic)](https://www.npmjs.com/package/@calevi/ssh-mcp-dynamic)

A minimal [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets an MCP client (Claude Code, Claude Desktop) run shell commands on remote hosts over SSH. The host, private key, user and port are chosen **per call**, so a single server instance can reach many machines.

It exposes two tools:

| Tool | Description |
|------|-------------|
| `ssh_exec` | Run a shell command on a remote host. |
| `ssh_sudo_exec` | Run a shell command with `sudo` (don't include the `sudo` prefix yourself). |

Authentication is key-based only (PEM private keys). No passwords are handled or stored.

**Contents**: [Quick start](#quick-start) · [Usage](#usage) · [Configuration](#configuration) · [Security model](#security-model) · [Development](#development) · [License](#license)

## Quick start

You need Node.js 18+ on the machine that runs your MCP client, and SSH access to the target hosts with a private key. The server is published on npm as [`@calevi/ssh-mcp-dynamic`](https://www.npmjs.com/package/@calevi/ssh-mcp-dynamic); `npx` downloads and runs it on demand, so there is nothing to clone or build.

### Claude Code (CLI)

**Minimal** — no environment config at all. You provide the host, command and a full key path on every call:

```bash
claude mcp add ssh-mcp -- npx -y @calevi/ssh-mcp-dynamic
```

**With shortcuts and defaults** — preconfigure your keys once so calls can use a short name (e.g. `prod`) and omit the user/port, bound the reachable hosts, and keep an audit log:

```bash
claude mcp add ssh-mcp -s user \
  -e SSH_MCP_KEYS='{"prod":"~/keys/prod.pem"}' \
  -e SSH_MCP_DEFAULT_KEY=prod \
  -e SSH_MCP_DEFAULT_USER=ubuntu \
  -e SSH_MCP_ALLOWED_HOSTS='10.0.0.*,*.internal.example.com' \
  -e SSH_MCP_AUDIT_LOG=~/.ssh-mcp/audit.log \
  -- npx -y @calevi/ssh-mcp-dynamic
```

**Scopes** (`-s`): `local` (default, current project only), `user` (all your projects), `project` (saved to a versioned `.mcp.json` to share with your team).

Verify with `claude mcp list`, or `/mcp` inside a session. Remove with `claude mcp remove ssh-mcp`.

To pin an exact version use `npx -y @calevi/ssh-mcp-dynamic@1.1.2`. To run straight from GitHub instead (a tagged release, or `main` without the `#tag`), use `npx -y github:Calevi-Consulting/ssh-mcp-dynamic#v1.1.2`; `npx` then clones and builds it via the `prepare` script. For a local checkout see [Development](#development).

### Claude Desktop

Add the server to your `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ssh-mcp": {
      "command": "npx",
      "args": ["-y", "@calevi/ssh-mcp-dynamic"],
      "env": {
        "SSH_MCP_KEYS": "{\"prod\":\"~/keys/prod.pem\",\"staging\":\"~/keys/staging.pem\"}",
        "SSH_MCP_DEFAULT_KEY": "prod",
        "SSH_MCP_DEFAULT_USER": "ubuntu",
        "SSH_MCP_ALLOWED_HOSTS": "10.0.0.*,*.internal.example.com",
        "SSH_MCP_AUDIT_LOG": "~/.ssh-mcp/audit.log"
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

## Configuration

Everything host-specific is supplied through environment variables — nothing is hardcoded in the source.

| Variable | Default | Purpose |
|----------|---------|---------|
| `SSH_MCP_KEYS` | `{}` | JSON object mapping **key shortcuts** to private-key paths. A leading `~` expands to the home directory. |
| `SSH_MCP_DEFAULT_KEY` | *(none)* | Shortcut or path used when a call omits `key`. If unset, `key` is required per call. |
| `SSH_MCP_DEFAULT_USER` | `root` | Default SSH username. |
| `SSH_MCP_DEFAULT_PORT` | `22` | Default SSH port. |
| `SSH_MCP_TIMEOUT_MS` | `60000` | Default command/connection timeout in milliseconds. |
| `SSH_MCP_ALLOWED_HOSTS` | *(any)* | Comma-separated allowlist of hostnames / IPs. `*` and `?` wildcards, case-insensitive. Calls to any other host are refused before a connection is attempted. |
| `SSH_MCP_HOST_KEY_CHECKING` | `strict` | `strict`, `accept-new` or `off`. See [Host key verification](#host-key-verification). |
| `SSH_MCP_KNOWN_HOSTS` | `~/.ssh/known_hosts` | known_hosts file consulted for host key verification. |
| `SSH_MCP_AUDIT_LOG` | *(none)* | File that receives one JSON line per call. Records are always written to stderr as well. See [Audit log](#audit-log). |

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

### Host allowlist

Set `SSH_MCP_ALLOWED_HOSTS` to bound which machines the model can reach, regardless of what it puts in `host`:

```bash
SSH_MCP_ALLOWED_HOSTS='10.0.0.*,*.internal.example.com,web-01'
```

A call to a host outside the list returns an error and is recorded in the audit log with `"outcome":"denied"`. No SSH connection is opened. The configured list is also included in the tool description so the model knows the boundary up front. When the variable is unset, any host is allowed.

### Host key verification

The server verifies the remote host key against `SSH_MCP_KNOWN_HOSTS` (default `~/.ssh/known_hosts`), the same file OpenSSH uses. Plain, hashed (`|1|...`), `[host]:port`, wildcard and `@revoked` entries are understood. `SSH_MCP_HOST_KEY_CHECKING` selects the policy, mirroring OpenSSH `StrictHostKeyChecking`:

| Value | Unknown host | Key changed |
|-------|--------------|-------------|
| `strict` (default) | refused | refused |
| `accept-new` | recorded in the file, then accepted | refused |
| `off` | accepted | accepted |

A refused call returns an error explaining why and is audited as `denied`. If you hit `Host key verification failed` for a host you trust, either connect to it once with `ssh` from the same machine (so OpenSSH records the key), or run with `SSH_MCP_HOST_KEY_CHECKING=accept-new`. A `HOST KEY MISMATCH` means the key on record differs from the one the server presented: treat it as OpenSSH would, and only remove the old entry if you know the host was rebuilt.

### Audit log

Every call produces one JSON line on stderr (Claude Code and Claude Desktop keep MCP server stderr in their logs). Set `SSH_MCP_AUDIT_LOG` to also append it to a file (created with mode `0600`):

```json
{"ts":"2026-09-06T14:02:11.482Z","tool":"ssh_sudo_exec","host":"10.0.0.5","port":22,"user":"ubuntu","key":"prod","command":"sudo systemctl restart nginx","duration_ms":812,"outcome":"ok","exit_code":0}
{"ts":"2026-09-06T14:02:40.107Z","tool":"ssh_exec","host":"203.0.113.9","port":22,"user":"ubuntu","key":"prod","command":"id","duration_ms":1,"outcome":"denied","error":"Host '203.0.113.9' is not in SSH_MCP_ALLOWED_HOSTS ('10.0.0.*')"}
```

`outcome` is `ok` (exit code 0), `error` (non-zero exit or connection failure) or `denied` (blocked by the allowlist or host key policy). `key` is the shortcut or path as supplied by the caller. Command output and key material are never logged.

## Security model

**This server executes arbitrary shell commands on remote hosts**, including with `sudo` via `ssh_sudo_exec`. It is deliberately thin and does not try to be a policy engine. The controls are layered, and the server only owns some of them:

1. **The MCP client.** Claude Code and Claude Desktop show the exact host and command and ask for approval before each call. Nothing runs unattended unless you allowlist the tool in the client.
2. **This server.** `SSH_MCP_ALLOWED_HOSTS` bounds which hosts the model can reach. Host key verification (`strict` by default) refuses unknown or changed hosts. Every call, including refused ones, is written to the audit log. Authentication is key-based only; no passwords are handled or stored, and keys are read from disk at call time.
3. **The keys and the hosts.** A call can only reach hosts where the configured key is authorized, so keep one key per environment. On the host, scope what that identity can do with `authorized_keys` options (`from=`, `command=`, `restrict`), a dedicated low-privilege user, and `sudoers` rules that limit what `ssh_sudo_exec` can run.
4. **Transport.** The server talks to the MCP client over stdio and opens no network listener of its own.

What it does not do: there is no command allow/deny list (express that in `sudoers` and `authorized_keys`, where it is enforced regardless of the client), no support for SSH certificates (`@cert-authority` entries are ignored), and the audit log is advisory (a failure to write it is reported on stderr but does not block the call).

Practical notes:

- Only connect it to hosts and keys you control, and only run it with an MCP client you trust.
- **Never commit private keys.** `*.pem`, `*.key`, and common key filenames are already in `.gitignore`.
- Prefer passphrase-protected keys or keys scoped to specific hosts.
- Setting `SSH_MCP_HOST_KEY_CHECKING=off` and leaving `SSH_MCP_ALLOWED_HOSTS` unset restores the 1.0.x behaviour.

## Development

### Local checkout

```bash
git clone https://github.com/Calevi-Consulting/ssh-mcp-dynamic.git
cd ssh-mcp-dynamic
npm install
npm run build
```

This compiles `src/index.ts` to `dist/index.js`. Point your MCP client at the compiled file instead of the npm package:

```bash
claude mcp add ssh-mcp -s user \
  -e SSH_MCP_KEYS='{"prod":"~/keys/prod.pem"}' \
  -e SSH_MCP_DEFAULT_KEY=prod \
  -- node "$(pwd)/dist/index.js"
```

For Claude Desktop, use `"command": "node"` with `"args": ["/absolute/path/to/ssh-mcp-dynamic/dist/index.js"]`.

### Tests

```bash
npm test
```

Tests use Node's built-in test runner and an in-process SSH server from the `ssh2` package with generated ed25519 keys, so the host key, allowlist and audit paths are exercised over a real SSH handshake with no external dependencies. The same suite runs in CI on Node 18, 20, 22 and 24 for every pull request, together with a stdio smoke test of the built server and `npm audit`.

### Releasing

1. Bump `version` in `package.json` on a branch and merge it through a pull request (`main` requires green CI).
2. Tag the merge commit `vX.Y.Z` and publish a GitHub Release for that tag.
3. The `Publish to npm` workflow (`.github/workflows/publish.yml`) runs the tests, checks the tag matches `package.json`, and runs `npm publish --provenance`. It authenticates with npm trusted publishing (OIDC), so no npm token lives in the repository; the trusted publisher is configured once on npmjs.com under the package's settings. If that version is already on npm the publish step is skipped, so re-publishing a release is safe.

## License

[MIT](./LICENSE)
