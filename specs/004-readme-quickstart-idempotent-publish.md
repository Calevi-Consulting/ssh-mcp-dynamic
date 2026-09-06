# 004 — README quick start first; idempotent publish workflow; 1.1.2

> **Note**: This work has no associated issue tracker ticket. Consider creating one for traceability.

## Status: INCOMPLETE

## Context

Readers arrive at the README from npm or from the launch post looking for the one-line install, but the document opened with Requirements, a local build, and the full configuration reference before reaching the Claude Code and Claude Desktop instructions. Building from a checkout is a contributor task and belongs under Development. The README shown on npmjs.com is the one inside the published tarball, so the reorganisation is paired with a patch release. The publish workflow failed on the v1.1.1 release because that version had been published manually; re-publishing a release should be safe.

## Requirements

- R1. README order: intro and tools; contents line; Quick start (requirements as one line, Claude Code, Claude Desktop); Usage; Configuration; Security model; Development (local checkout, tests, releasing); License. No existing content is dropped.
- R2. Version bumped to 1.1.2 in `package.json` and `package-lock.json`; README pin examples reference 1.1.2.
- R3. `publish.yml` checks the registry before publishing and skips the publish step when `name@version` already exists.
- R4. All internal README links resolve to headings.

## Acceptance Criteria

- [x] AC1. Heading order in README matches R1 (verified by script).
- [x] AC2. `package.json` and lockfile report 1.1.2; README references `@calevi/ssh-mcp-dynamic@1.1.2` and `#v1.1.2`.
- [x] AC3. `publish.yml` has a registry check step whose output gates the publish step; the YAML parses; the check command returns success for the existing 1.1.1 and failure for the absent 1.1.2 when run locally.
- [x] AC4. Internal anchor check reports no missing anchors.
- [ ] AC5. CI is green on this spec's pull request.

## Risks & Assumptions

- **Rollback**: revert the PR. 1.1.2 is docs, metadata and workflow only; no runtime change.
- **Publish of 1.1.2**: through the workflow once the trusted publisher is configured on npmjs.com, otherwise manually as for 1.1.1. Either way the tarball is identical to `npm publish --dry-run` on the tag.
- The npm badge in the README uses shields.io; it renders only after the package page is public, which it is.
