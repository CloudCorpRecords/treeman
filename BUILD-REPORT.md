# treeman — Build Report

MCP Rebuild 1000, Batch 18. Original program build from the
packages-100 plan (cluster C #35), built from the spec in
`~/workspace/mcp-rebuild-100/specs-batch18/treeman.md`
(read first). There is no external original; the tool surface
is the program's defined spec. Local build only — nothing
pushed or published.

Identity: repo `treeman`, npm `@reneturcios/treeman`,
MCP name `io.github.CloudCorpRecords/treeman`, version
`0.1.0`, bin `treeman` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Map
  parallel-agent git worktrees to owners and plan safe
  cleanup from supplied facts." — 85 chars, verified by
  count; npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/treeman:0.1.0` carries **no**
  `version` field), `Dockerfile` (node:20-alpine two-stage,
  label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/treeman"`),
  `tsconfig.json` (byte-identical to the reference),
  `.gitignore`, `LICENSE` (MIT, Copyright (c) 2026 Rene
  Turcios), `README.md` (fresh text), `CHANGELOG.md`
  (single 0.1.0 entry, 2026-10-27), `package-lock.json`
  (Route 3, see below)
- `src/index.ts`, `src/cli.ts` (`plan --input <args.json>`
  where the file holds the full arguments object, `mcp`,
  `--version`; exit 2 usage / 1 runtime error, argument
  validation before any file read), `src/mcp.ts`,
  `src/types.ts`, `src/treeman.ts` (core,
  `VERSION = "0.1.0"`, `formatPayload`)
- `test/treeman.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (publish-container `IMAGE = ghcr.io/cloudcorprecords/treeman`,
  smoke-test server-name assertion `treeman`)

Plus the parity fixture at
`harness/fixtures/treeman-tools-original.json`, labelled
as a program spec from the packages-100 plan cluster C #35.

## Tools implemented (1)

- `plan_worktrees` — arguments: `worktrees` (array,
  required, at least 1 item), `stale_days` (integer,
  required, >= 0), and `main_path` (string, optional).
  Each worktree item: `path` (string, required, non-empty),
  `branch` (string, required, non-empty), `owner` (string,
  optional), `dirty` (boolean, required),
  `last_activity_days` (integer, required, >= 0), and
  `locked` (boolean, optional, absent means false).
  Required is exactly `["worktrees", "stale_days"]` at the
  top level and `["path", "branch", "dirty",
  "last_activity_days"]` per item.

  Status precedence is pinned, first match wins:
  1. `main_path` supplied and path equals it → "main",
     cleanup "keep", reason "primary worktree".
  2. locked → "locked", "keep", "worktree is locked".
  3. dirty → "blocked", "keep", "uncommitted changes
     present".
  4. `last_activity_days > stale_days` and unowned →
     "orphaned", "remove", "no owner and inactive beyond
     the stale threshold".
  5. `last_activity_days > stale_days` → "stale",
     "review", "inactive beyond the stale threshold".
  6. unowned → "unowned", "review", "no recorded owner".
  7. otherwise → "active", "keep", "owned and recently
     active".
  The staleness comparison is strictly greater-than:
  `last_activity_days` exactly equal to `stale_days` is
  NOT stale.

  Returns `{worktrees, owners, counts}`, where `worktrees`
  holds one `{path, branch, owner, status, cleanup,
  reason}` per input worktree in input order (owner null
  when unowned); `owners` maps each distinct owner name to
  its worktree paths in input order with owner keys sorted
  code-unit ascending (unowned worktrees excluded); and
  `counts` is `{total, main, locked, blocked, orphaned,
  stale, unowned, active, removable}` in that key order,
  with `removable` counting worktrees whose cleanup is
  "remove".

  The fixture literal
  (`harness/fixtures/treeman-tools-original.json`) and the
  `src/mcp.ts` literal are identical, with no `$schema`
  and no `additionalProperties` — confirmed by the parity
  run below.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with an
  explicit inputSchema literal exactly matching the
  fixture, per the standing fleet rule (no McpServer/zod
  schema conversion). Every `tools/call` is validated by
  the core itself, so the MCP and CLI paths share one
  validation implementation; the core takes the full
  arguments object.
- Validation is path-naming and total: a missing, non-array,
  or empty `worktrees`; a non-object item; a missing, empty,
  or non-string `path` or `branch`; a non-string `owner`;
  a missing or non-boolean `dirty`; a non-boolean `locked`;
  a missing, non-integer, or negative `last_activity_days`
  or `stale_days`; or a present-but-empty-or-non-string
  `main_path` throws an Error naming the offending path
  (e.g. `worktrees[1].dirty must be a boolean`) and produces
  no partial result (MCP: `isError`; CLI: exit 1).
  Duplicate `path` values throw `duplicate worktree path:
  <path>`. Unknown extra fields are ignored, including
  inside items; a non-object top-level argument is treated
  as {}.

## Verification (foreground, this session)

- `npm test` (`tsx --test test/*.test.ts`): **58 tests,
  58 pass, 0 fail** — each of the seven statuses with its
  exact reason and cleanup; precedence (main beating
  locked + dirty + stale + unowned together, locked beating
  dirty, dirty beating orphaned on a stale unowned tree,
  orphaned beating unowned, stale beating active, locked
  false equal to absent); the strictly-greater staleness
  boundary for owned trees (== stale_days active, +1 stale)
  and unowned trees (== unowned, +1 orphaned), plus the
  stale_days 0 edge; owner semantics (absent / empty /
  whitespace-only owners unowned and echoing null —
  including a dedicated whitespace-owner-on-stale-tree
  orphaned case — and verbatim echo of an owned owner with
  surrounding spaces); the owners map (code-unit ascending
  keys across a mixed-case set, per-owner path lists in
  input order, unowned excluded entirely, a main tree's
  owner still listed); counts including removable with the
  pinned key order; duplicate-path errors naming the path;
  a `main_path` matching no worktree (no main status) and
  an exact-match near-miss; and every validation path
  (worktrees missing / non-array / empty, non-object items,
  path and branch missing / empty / non-string, owner
  non-string, dirty missing and non-boolean, locked
  non-boolean, last_activity_days and stale_days missing /
  negative / fractional / string / boolean / null / array /
  object plus 0 valid, main_path empty and non-string,
  non-object top-level treated as {}, unknown extras
  ignored, no partial result).
- `npx tsc --noEmit` → exit 0; `npm run build` produced
  `dist/` with all 15 outputs.
- `dist/cli.js --version` → `0.1.0`; unknown command exits
  2 with usage; `plan` with no `--input` exits 2;
  `plan --input <valid file>` exits 0 and prints the
  hand-checked plan for the input `{"worktrees":
  [{"path": "/trees/main", "branch": "main", "owner":
  "alice", "dirty": false, "last_activity_days": 0},
  {"path": "/trees/old", "branch": "exp/spike", "dirty":
  false, "last_activity_days": 74}, {"path": "/trees/wip",
  "branch": "feat/x", "owner": "bob", "dirty": true,
  "last_activity_days": 1}], "stale_days": 30, "main_path":
  "/trees/main"}` — main/keep for the primary tree,
  orphaned/remove with owner null for the ownerless
  74-day tree, blocked/keep for the dirty tree, owners
  `{alice: ["/trees/main"], bob: ["/trees/wip"]}`, counts
  total 3 with main 1, blocked 1, orphaned 1, removable 1;
  `plan --input <invalid file>` (second item's `dirty` the
  string "yes") exits 1 with
  `error: worktrees[1].dirty must be a boolean`.
- Parity: `harness/parity.py` vs
  `harness/fixtures/treeman-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1** (run with
  the rebuild path as an absolute path; the harness does
  not expand a `~` inside the quoted stdio command
  string). Report saved under `parity-out/`.

## Lockfile status

`package-lock.json` generated clean via Route 3 (in the
build directory with no `node_modules` present, offline
`npm install --package-lock-only --ignore-scripts
--offline`), verified: parses, name
`@reneturcios/treeman`, **128 package entries**. The
subsequent offline `npm install --ignore-scripts
--offline`, build, tests, and parity all ran against
this lockfile's tree.

## Gaps / honest notes

- **Pinned judgement calls** (each with a dedicated test
  where applicable): (1) an owner that is absent, empty,
  or whitespace-only means the worktree is unowned and
  echoes as null — the spec pins this call explicitly and
  it is tested for absent, empty, and several
  whitespace-only values, including on a stale tree where
  it decides orphaned vs stale; an owned owner echoes
  verbatim, surrounding spaces included; (2) owners-map
  key order is the default JavaScript string sort
  (code-unit ascending), pinned with a mixed-case owner
  set where capitals sort before lowercase; (3) unknown
  extra fields are ignored rather than rejected, at the
  top level and inside items (the spec says so); (4) a
  non-object top-level arguments value is treated as an
  empty object, so it fails as `worktrees is required`;
  (5) error-message wording follows the fleet's
  path-naming pattern, distinguishing a missing field
  (`worktrees[1].dirty is required`) from a malformed one
  (`worktrees[1].dirty must be a boolean`), matching the
  spec's example. No other spec ambiguity was found in
  the core behaviour.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
- Nothing pushed or published; this is a local build only.
