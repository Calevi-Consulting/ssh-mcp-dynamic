## Validation Report: Security hardening (host allowlist, host key verification, audit log)
**Date**: 2026-09-06 15:04
**Commit**: pre-commit (branch feat/security-hardening)
**Spec**: specs/001-security-hardening.md
**Status**: PASSED

### Phase 3: Tests
- Test suite: `npm test` (tsc -p tsconfig.test.json && node --test ".test-build/test/*.test.js")
- Results: 24 passing, 0 failing
- Coverage (node --experimental-test-coverage): 88.35% lines, 83.86% branches, 82.39% functions
- Integration boundary: 12 tests run a real SSH handshake and exec against an in-process ssh2 Server with generated ed25519 host/client keys (no SSH layer mocked)
- Manual smoke: dist/index.js driven over stdio with JSON-RPC initialize, tools/list, tools/call; allowlist hint present in tool descriptions, denied call returned isError and produced one audit line on stderr and in SSH_MCP_AUDIT_LOG
- Status: PASSED

### Phase 4: Code Quality
- Dead code: removed unused TOOL_NAMES / ToolName exports from src/tools.ts
- Duplication: none found (quoteList shared; single audit writer)
- Encapsulation: src/index.ts (v1.0.0, 257 lines, one file) split into config.ts, policy.ts, knownHosts.ts, audit.ts, ssh.ts, tools.ts, index.ts. runTool reduced by extracting parseCallArgs and createAuditor; remaining length is sequential policy steps
- Refactorings: extract parseCallArgs; extract createAuditor; tool description assembly via describe()
- Status: PASSED

### Phase 5: Security Review (via /ralph-security-review)
- Verdict: CONCERNS (non-blocking)
- Quoted summary from /ralph-security-review:
  - Diff scope: working tree vs HEAD (16 files changed, 1384 insertions(+), 242 deletions(-))
  - Phase A: npm audit (npm 10.9.8, node v22.23.2): found 0 vulnerabilities
  - Phase B (AI-assisted, best-effort, not compliance evidence): Injection: by design the tool executes caller-supplied commands; sudo prefixing unchanged from v1.0.0 (src/tools.ts parseCallArgs). Auth/session: n/a (key-based SSH only). Sensitive data exposure: CONCERN, the audit record includes the full command string, so secrets embedded in a command by the caller would land in stderr/the audit file; documented in README ("Command output and key material are never logged", command text is). Access control: new host allowlist and host key verification (src/policy.ts, src/knownHosts.ts). Misconfiguration: strict default; "off" is explicit opt-in. XSS: n/a. Deserialization: JSON.parse of operator env only. Known-vuln components: none. Logging: denied and error events now logged (src/audit.ts). SSRF/trust: host bounded by allowlist; known_hosts and audit paths come from operator env, not from the caller. Verdict: concerns
  - Phase C: inline AI scan (git-secrets, trufflehog, detect-secrets, gitleaks not installed; no install attempted): 0 findings. Test keys are generated at runtime, none committed
  - Phase D (advisory): package.json touched (version bump and scripts only; no dependencies added; package-lock.json unchanged). No agent/editor config paths in the diff
- Status: PASSED (CONCERNS acknowledged: command text in audit log is intentional and documented)

### Phase 5.5: Release Safety
- Change type: Code-only (plus docs and tests); no schema, API or infrastructure
- Behaviour change: host key checking defaults to strict; first connection to a host absent from known_hosts is refused with an actionable message
- Rollback plan: git revert of the feature commit on this branch; or, without redeploying, set SSH_MCP_HOST_KEY_CHECKING=off and leave SSH_MCP_ALLOWED_HOSTS unset to restore 1.0.x behaviour (documented in README)
- Additive: all new configuration is optional; tool names, parameters and response text unchanged (AC9 test)
- Status: PASSED

### Overall
- All gates passed: YES
- Notes: Spec 001 has no issue tracker ticket (repo has no issues). Version bumped 1.0.0 -> 1.1.0; the stricter default could justify 2.0.0 under strict semver. Not pushed; branch feat/security-hardening only.
