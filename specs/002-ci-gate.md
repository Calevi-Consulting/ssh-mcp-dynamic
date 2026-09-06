# 002 — CI gate: build, test, smoke and dependency audit on every PR

> **Note**: This work has no associated issue tracker ticket. Consider creating one for traceability.

## Status: COMPLETE

## Context

PR #1 was merged with no automated gate: the repository had no GitHub Actions workflow and no branch protection, so "wait for the gate to be green" could only mean the local test run. This spec adds a CI workflow so pull requests to `main` are checked before merge.

The existing `npm test` script used a Node CLI glob (`node --test "dir/*.test.js"`), which only Node 21+ understands. `package.json` declares `engines.node >= 18`, so a multi-version matrix would have failed on 18 and 20 for reasons unrelated to the code.

## Requirements

- R1. A workflow runs on `pull_request` targeting `main` and on `push` to `main`.
- R2. A matrix job over Node 18, 20, 22 and 24 runs `npm ci`, `npm run build`, `npm test`, and a smoke test that starts `dist/index.js` over stdio, sends an `initialize` request, and checks the server identifies itself and reports `host key checking: strict` on stderr.
- R3. A separate job runs `npm audit --audit-level=high`; high and critical advisories fail the gate.
- R4. `npm test` discovers compiled test files without relying on CLI glob semantics or shell glob expansion, and exits non-zero when any test fails.
- R5. Workflow permissions are read-only (`contents: read`); no secrets are used.
- R6. README shows the workflow status badge.

## Acceptance Criteria

- [x] AC1. `.github/workflows/ci.yml` exists with the triggers in R1 and `permissions: contents: read`.
- [x] AC2. `npm test` passes locally through the new runner (`scripts/run-tests.js`), and a deliberately failing test file makes it exit non-zero.
- [x] AC3. The smoke test commands from the workflow pass locally against `dist/index.js`.
- [x] AC4. The workflow runs on this spec's own pull request and all jobs (Node 18, 20, 22, 24 and the audit job) are green.
- [x] AC5. README carries the CI badge.

## Executive Summary

Adds a GitHub Actions workflow that builds, tests and smoke-runs the server on Node 18, 20, 22 and 24, and fails on high/critical `npm audit` findings, for every pull request to `main`. Replaces the Node-21-only glob in `npm test` with a portable runner. Verified by the workflow's own run on PR #2 (run 34051778282: all five jobs green).

## Risks & Assumptions

- **Rollback**: revert the PR, or delete `.github/workflows/ci.yml`; nothing else depends on it.
- **Audit gate flakiness**: a newly published high/critical advisory in a transitive dependency will block unrelated PRs until it is patched. This is intentional for a tool that runs `sudo` on remote hosts; relax with `--audit-level=critical` if it becomes noisy.
- **Action pinning**: `actions/checkout` and `actions/setup-node` are pinned to major tags (`@v4`), not commit SHAs. SHA pinning is stronger against tag hijacking and can be adopted later (Dependabot can keep SHAs current).
- **No branch protection** is configured by this change; the gate is visible on the PR but not enforced by GitHub until a rule requiring the `CI` checks is added in repository settings (an admin action, out of scope here).
- Node 18 is end-of-life but still declared in `engines`; it stays in the matrix until `engines` changes.
