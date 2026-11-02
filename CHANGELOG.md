# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `plan_worktrees` MCP tool and `plan`
  CLI command planning parallel-agent git worktrees from
  caller-supplied worktree facts only; git and the
  filesystem are never touched.
- Pinned status precedence, first match wins: `main`
  (path equals `main_path`, cleanup `keep`), `locked`
  (`keep`), `blocked` for dirty trees (`keep`),
  `orphaned` for trees inactive beyond the stale
  threshold with no owner (`remove`), `stale` (cleanup
  `review`), `unowned` (`review`), and `active` (`keep`),
  each with its exact reason string. Staleness is
  strictly greater-than: activity exactly `stale_days`
  ago is not stale.
- Ownership map with owner keys sorted code-unit
  ascending and each owner's paths in input order;
  unowned trees (owner absent, empty, or whitespace-
  only, echoing as `null`) are excluded. Counts report
  the total, one tally per status, and `removable`.
- Path-naming validation errors for malformed input and
  a duplicate-path error naming the duplicated path; no
  partial results on invalid input.
