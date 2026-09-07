# Project-Specific Guidelines: ssh-mcp-dynamic

This file extends the global AIQ-Ralph configuration (`~/.claude/CLAUDE.md`).

---

## Selected Policies

Load the following policy modules from `~/.claude/policies/`:

- `git/strict.md`
- `release-safety/simplified.md`
- `security/input-hygiene.md`
- `security/owasp-review.md`
- `security/supply-chain.md`
- `testing/philosophy.md`
- `communication/standards.md`

No language policy module applies: the codebase is TypeScript, and `languages/` currently
ships Python, Go, and Bash only. No integration module applies: the project lives on
GitHub (not GitLab) and has no issue tracker.

---

## Ralph Settings

<!-- Machine-readable settings consumed by ralph-spec-execute and other skills.
     Edit via /ralph-setup, not by hand. -->

```yaml
validation: strict   # strict | milestones-only | disabled
```

---

## Project Overview

- **Type**: CLI / MCP server, published to npm as `@calevi/ssh-mcp-dynamic`
- **Language**: TypeScript (CommonJS, target ES2020, `strict: true`)
- **Purpose**: Model Context Protocol server that runs SSH commands with the host and key
  supplied per call rather than fixed in server configuration.

---

## Relaxed Rules

None. All global defaults are kept at their strict setting:

- Validation reports: `strict` — every spec so far (001–004) has a matching report in
  `validation-reports/`; the convention is already established.
- Code quality refactor pass: always runs.
- Test requirements: tests must pass before a spec is marked complete.
- Communication standards: strict.
- Tool installation: always ask before installing.

---

## Additional Rules

### Specs have no issue tracker ticket

There is no issue tracker for this project. Name specs `specs/<NNN>-<short-description>.md`
and include the no-ticket notice at the top, matching specs 001–004. Do not ask for a ticket
ID on each new spec.

### npm release rollback

A publish to the public npm registry is effectively irreversible: unpublish is restricted
after 72 hours, and any released version may already be in a consumer's lockfile. The
rollback path for a bad release is therefore **forward**, not backward:

1. Publish a corrected patch version.
2. `npm deprecate @calevi/ssh-mcp-dynamic@<bad-version> "<reason; use <fixed-version>>"`.
3. Move the `latest` dist-tag if it still points at the bad version.

Phase 5.5 for any version-bumping change must state which of these applies. Never plan a
release around unpublishing.

### `main` is protected

`main` requires passing CI checks and has `enforce_admins` on. All changes land through a
pull request — no direct pushes, including for one-line changes.

### Credentials never enter the repo or the transcript

This server handles SSH private keys, passphrases, and target hostnames. `.gitignore` blocks
`*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, and `.env*`. When testing or debugging, use
throwaway keys and redact host and key material before pasting output anywhere.

---

## Environment

- **Node.js**: `>=18` per `package.json` engines. CI builds and tests on 18, 20, 22, and 24 —
  a change that requires a newer Node than 18 is a breaking change and needs an engines bump.
- **Build**: `npm run build` (tsc → `dist/`). `prepare` runs the build, so it also runs on install.
- **Test**: `npm test` (compiles via `tsconfig.test.json`, then `node scripts/run-tests.js`).
- **CI** (`.github/workflows/ci.yml`): build + test matrix, a stdio smoke test asserting the
  server advertises `ssh-mcp-dynamic` and reports `host key checking: strict`, and an
  `npm audit --audit-level=high` gate.
- **Publish** (`.github/workflows/publish.yml`): npm trusted publishing with provenance.

---

## Security Extensions

Additive to the non-negotiable global Phase 5 minimums:

- **Dependency scanner**: `npm audit --audit-level=high` is the required tool for this project
  (it is also the CI gate). Record the npm version in the security review output.
- **Host key verification is a security control, not a convenience.** Any change that touches
  `src/knownHosts.ts` or the host key checking path requires an explicit note in the security
  review explaining why the change does not weaken verification. The CI smoke test asserting
  `host key checking: strict` must not be relaxed.
- **Command policy**: changes to `src/policy.ts` (host allowlisting, command restrictions) are
  security-relevant by default and require the same explicit review note.
- **Audit log**: `src/audit.ts` must never log private keys, passphrases, or full command
  output containing credentials.

---

## Configuration Summary

| Category | Setting | Notes |
|----------|---------|-------|
| Validation Reports | `strict` | Report required before every code commit; matches existing 001–004 convention |
| Code Quality Checks | Strict | Phase 4 always runs |
| Test Requirements | Strict | `npm test` must pass before a spec is marked complete |
| Communication Style | Strict | Factual language, no superlatives, neutral voice |
| Tool Installation | Ask first | No automatic installs |
| Policies | git/strict, release-safety/simplified, security ×3, testing/philosophy, communication/standards | No language or integration module applies |
| Security | Mandatory + extensions | Host key, command policy, and audit log rules added above |

---

*Generated by /ralph-setup on 2026-09-07*
