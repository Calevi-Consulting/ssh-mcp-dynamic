# 003 — Publish to npm: package metadata, provenance workflow, install docs

> **Note**: This work has no associated issue tracker ticket. Consider creating one for traceability.

## Status: INCOMPLETE

## Context

The only distribution channel is `npx github:Calevi-Consulting/ssh-mcp-dynamic`, which clones the repository and compiles it on every user's machine. The README has anticipated an npm release since 1.0.0 ("Once published to npm you can drop the `github:` prefix"). The package name `ssh-mcp-dynamic` is unclaimed on registry.npmjs.org (HTTP 404 on 2026-09-06) and the maintainer has an npm account with an active session on the release machine.

## Requirements

- R1. `package.json` carries `repository`, `homepage`, `bugs` and `publishConfig.access = public`; version bumped to 1.1.1 so the first npm release corresponds exactly to a tagged commit that includes this metadata.
- R2. A `Publish to npm` workflow runs when a GitHub Release is published: installs, runs the test suite, verifies the release tag equals `package.json` version, and runs `npm publish --provenance --access public` using npm trusted publishing (OIDC, `id-token: write`). No npm token is stored in the repository.
- R3. The published tarball contains only `dist/`, `README.md`, `LICENSE` and `package.json`.
- R4. README install instructions use the npm package for Claude Code and Claude Desktop; the GitHub form remains documented for pinning a tag or tracking `main`; a Releasing section documents the flow.

## Acceptance Criteria

- [x] AC1. `package.json` version is 1.1.1 and has `repository`, `homepage`, `bugs`, `publishConfig`; `package-lock.json` version matches.
- [x] AC2. `.github/workflows/publish.yml` triggers on `release: published`, declares `permissions: contents: read, id-token: write`, runs `npm test`, fails when the tag does not match the version, and publishes with `--provenance`.
- [x] AC3. `npm publish --dry-run` lists exactly 10 files: `dist/*.js` (7), `LICENSE`, `README.md`, `package.json`; no `src/`, `test/`, `specs/` or `validation-reports/`.
- [x] AC4. README: Claude Code and Claude Desktop examples use `npx -y ssh-mcp-dynamic`; the `github:` variant and a Releasing section are present; the "Once published to npm" sentence is gone.
- [ ] AC5. CI is green on this spec's pull request.

## Risks & Assumptions

- **First publish is manual.** npm trusted publishing is configured in the settings of an existing package, so 1.1.1 is published once from the maintainer's session (`npm publish` from the tagged checkout, after `npm ci` and `npm test`). Later releases go through the workflow. The manual publish carries no provenance attestation; the next one will.
- **Short window of stale docs**: between merging this PR and the first publish, the README points at a package that does not exist yet. Publishing immediately after merge closes it.
- **Rollback**: revert the PR. An npm version cannot be unpublished after 72 hours except via `npm deprecate`; publish only after tests pass on the tagged checkout.
- **Semver**: 1.1.1 contains no runtime code change over 1.1.0 (metadata, docs, workflow). The tag `v1.1.0` stays as the GitHub-only release.
- **Trusted publishing needs npm >= 11.5.1**; the workflow upgrades npm before publishing.
