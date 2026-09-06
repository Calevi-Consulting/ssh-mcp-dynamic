# 001 — Security hardening: host allowlist, host key verification, audit log

> **Note**: This work has no associated issue tracker ticket. Consider creating one for traceability.

## Status: COMPLETE

## Context

`ssh-mcp-dynamic` accepts any `host`, `key`, `user` and `port` per call. Review of `src/index.ts` (v1.0.0) found three gaps relative to what a security-conscious user would expect from a tool that runs arbitrary commands over SSH:

1. No server-side host allowlist. The `host` parameter is free text.
2. No SSH host key verification. `ssh2` auto-accepts any host key when `hostVerifier` is not set (ssh2 1.17.0 README, `hostVerifier` option), so a DNS/ARP redirect or rebuilt host is silently trusted.
3. No audit trail. Nothing records which command ran where, or which calls were blocked.

A public comment on the launch post asks how security policy is handled when the model chooses hosts per call. These three items are the honest gaps in that answer.

## Requirements

- R1. `SSH_MCP_ALLOWED_HOSTS` (optional): comma-separated list of hostnames / IPs; `*` and `?` glob wildcards; case-insensitive. When set, calls to hosts not matching any pattern are refused before any network connection. When unset or empty, behaviour is unchanged (any host).
- R2. `SSH_MCP_HOST_KEY_CHECKING` (optional): `strict` (default), `accept-new`, or `off`, mirroring OpenSSH `StrictHostKeyChecking` semantics for non-interactive use.
  - `strict`: the server's host key must match an entry in the known_hosts file; unknown hosts and mismatches are refused.
  - `accept-new`: unknown hosts are recorded to the known_hosts file and accepted; mismatches are refused.
  - `off`: no verification (previous behaviour).
- R3. `SSH_MCP_KNOWN_HOSTS` (optional): path to the known_hosts file, default `~/.ssh/known_hosts`. Plain, hashed (`|1|salt|hash`), `[host]:port`, comma-separated, wildcard and `!`-negated host patterns are supported. `@revoked` entries refuse the key; `@cert-authority` entries are ignored.
- R4. When known_hosts has keys for the target, the client's host key algorithm preference is ordered so a known key type is negotiated first (avoids false "unknown host" when the server has several key types).
- R5. Every tool call emits exactly one audit record as a JSON line: `ts`, `tool`, `host`, `port`, `user`, `key` (as supplied by the caller, never key contents), `command` (final command including any `sudo` prefix), `outcome` (`ok` = exit 0, `error` = non-zero exit or connection failure, `denied` = blocked by allowlist or host key policy), `exit_code` when the command ran, `duration_ms`, `error` message when not `ok`. Records go to stderr always and, when `SSH_MCP_AUDIT_LOG` is set, are appended to that file (mode 0600). Command output is never logged.
- R6. Tool response text for successful and failed commands is unchanged from v1.0.0 (stdout, `[stderr]` section, `(exit code: N)`, `ERROR: Exit code N: ...`).
- R7. Tool descriptions advertise the configured allowlist so the model can choose hosts correctly.
- R8. README documents the new variables, the layered security model, and how to resolve an "unknown host" refusal.
- R9. Automated tests exist and run with `npm test` using only existing dependencies (ssh2 in-process `Server`, Node built-in test runner).

## Acceptance Criteria

- [x] AC1. With `allowedHosts` set and a non-matching host, `runTool` returns `isError: true` mentioning `SSH_MCP_ALLOWED_HOSTS`, and the test SSH server observes no new connection.
- [x] AC2. With `allowedHosts` set and a matching glob pattern, the call succeeds.
- [x] AC3. In `strict` mode with an empty known_hosts, the call is refused with a message containing "Host key verification failed" and the test server executes nothing.
- [x] AC4. In `accept-new` mode with an empty known_hosts, the call succeeds and the file afterwards contains exactly `[127.0.0.1]:<port> ssh-ed25519 <base64 of the test server's host key>`; a subsequent `strict` call against that file succeeds.
- [x] AC5. With a known_hosts entry holding a different ed25519 key for the target, both `strict` and `accept-new` refuse with a message containing "HOST KEY MISMATCH" and the test server executes nothing.
- [x] AC6. A hashed (`|1|...`) known_hosts entry for `[127.0.0.1]:<port>` is matched in `strict` mode.
- [x] AC7. In `off` mode the call succeeds with a nonexistent known_hosts path and the file is not created.
- [x] AC8. With `auditLogPath` set, three calls (ok, non-zero exit, denied host) produce three JSON lines with the fields in R5, `outcome` values `ok`, `error`, `denied`, and `exit_code` 0 and 3 for the first two.
- [x] AC9. Output formatting: a command writing stdout and stderr returns `out\n\n[stderr]\nwarn\n` without `isError`; a command exiting 3 with only stderr returns `ERROR: Exit code 3: boom\n` with `isError: true`.
- [x] AC10. `ssh_sudo_exec` sends `sudo <command>` to the server.
- [x] AC11. Unit tests cover allowlist parsing/matching and known_hosts parsing (`@revoked`, `[host]:port`, wildcard, negation, other-key-type reporting, host key algorithm ordering).
- [x] AC12. `npm run build` and `npm test` pass; `npm audit` reports no vulnerabilities.
- [x] AC13. README updated per R8; `package.json` version bumped.

## Integration-boundary AC

AC1, AC3, AC4, AC5, AC6, AC7, AC9 and AC10 exercise a real SSH handshake and exec against an in-process ssh2 `Server` with generated ed25519 host and client keys. No SSH layer is mocked.

## Risks & Assumptions

- **Default change**: `strict` host key checking is on by default. A first call to a host the local user has never `ssh`'d to will now be refused with an actionable message (run `ssh` once, or set `accept-new`). This is the same behaviour as OpenSSH `BatchMode`. Rationale: fail closed for a tool that runs `sudo` on remote hosts. Flipping the default is a one-line change in `parseHostKeyChecking`.
- **Rollback**: `git revert` of the feature commits, or set `SSH_MCP_HOST_KEY_CHECKING=off` and leave `SSH_MCP_ALLOWED_HOSTS` unset to get v1.0.0 behaviour without redeploying.
- **known_hosts writes**: only in `accept-new` mode, append-only, a missing trailing newline in the existing file is handled. The default file is the user's own `~/.ssh/known_hosts`, as OpenSSH does.
- **Audit log write failure** does not fail the call; the failure is reported on stderr. Fail-closed auditing was considered and rejected as surprising for a stdio tool whose stderr already carries the record.
- **Certificates** (`@cert-authority`) are not supported; such entries are ignored and the host falls through to the unknown-host path.
- Version bump to 1.1.0. The stricter default arguably warrants 2.0.0 under strict semver; 1.0.0 is a month old with no known downstream users.

## Executive Summary

Adds three operator-configurable controls to the MCP server: a host allowlist (`SSH_MCP_ALLOWED_HOSTS`), OpenSSH-compatible host key verification against known_hosts (`SSH_MCP_HOST_KEY_CHECKING`, strict by default), and a JSON-lines audit log (`SSH_MCP_AUDIT_LOG`). Tool names, parameters and response text are unchanged. Reviewers should start with `src/knownHosts.ts` (verification semantics) and `test/integration.test.ts` (real SSH handshake against an in-process server).

## Alternatives Considered

- Considered a command allow/deny list in the server; rejected for this iteration because command policy is better expressed in `sudoers` and `authorized_keys command=` on the host, where it is enforced regardless of the client.
- Considered making the audit log fail-closed; rejected (see Risks).
