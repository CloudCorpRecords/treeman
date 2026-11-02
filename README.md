# treeman

When several agents work in the same repository at once,
each one usually gets its own git worktree, and after a
while nobody remembers which tree belongs to whom, which
ones still hold uncommitted work, and which are safe to
delete. treeman answers those questions from facts you
already have. You supply, for each worktree, its path, the
branch checked out in it, who owns it if anyone does,
whether it has uncommitted changes, how many days have
passed since it last changed, and whether it is locked —
plus the inactivity threshold beyond which a tree counts
as stale, and optionally the path of the primary tree.
treeman hands back the plan: an ownership map, a status
and cleanup action for every tree, and the tallies. It
never runs git and never touches the filesystem; it plans
from the supplied facts only.

Each tree is judged by a fixed set of checks, first match
wins. A tree whose path is the supplied `main_path` is
`main` and is always kept. A locked tree is `locked` and
kept. A dirty tree is `blocked` and kept — uncommitted
changes are never planned away. A tree that is both past
the stale threshold and unowned is `orphaned`, and it is
the only kind planned for removal. An owned tree past the
threshold is `stale` and marked for review; a recent tree
with no recorded owner is `unowned` and also reviewed; an
owned, recently active tree is `active` and kept. The
staleness comparison is strictly greater-than: a tree
whose last activity is exactly `stale_days` ago is not
stale.

Ownership has one pinned judgement call: an owner that is
absent, empty, or only whitespace means the tree is
unowned, and its owner is reported as `null`. The owners
map in the result lists every other owner with the paths
it owns in the order you supplied them, with the owner
keys sorted ascending; unowned trees never appear in it.
The counts report the total, one tally per status, and
`removable` — how many trees the plan marks `remove`.

Malformed input — a missing or empty worktree list, a
missing, empty, or non-string `path` or `branch`, a
non-string `owner`, a missing or non-boolean `dirty`, a
non-boolean `locked`, a negative or fractional day count,
a bad `stale_days`, or an empty `main_path` — is a
validation error naming the offending path, with no
partial result. Two worktrees with the same path are an
error naming the duplicated path. Unknown extra fields
are ignored.

## CLI

```bash
npx @reneturcios/treeman plan --input args.json
npx @reneturcios/treeman --version
```

`args.json` contains the full arguments object:

```json
{
  "worktrees": [
    {
      "path": "/trees/main",
      "branch": "main",
      "owner": "alice",
      "dirty": false,
      "last_activity_days": 0
    },
    {
      "path": "/trees/old-experiment",
      "branch": "exp/spike",
      "dirty": false,
      "last_activity_days": 74
    },
    {
      "path": "/trees/agent-2",
      "branch": "feat/search",
      "owner": "agent-2",
      "dirty": true,
      "last_activity_days": 1
    }
  ],
  "stale_days": 30,
  "main_path": "/trees/main"
}
```

The plan is printed as JSON:

```json
{
  "worktrees": [
    {
      "path": "/trees/main",
      "branch": "main",
      "owner": "alice",
      "status": "main",
      "cleanup": "keep",
      "reason": "primary worktree"
    },
    {
      "path": "/trees/old-experiment",
      "branch": "exp/spike",
      "owner": null,
      "status": "orphaned",
      "cleanup": "remove",
      "reason": "no owner and inactive beyond the stale threshold"
    },
    {
      "path": "/trees/agent-2",
      "branch": "feat/search",
      "owner": "agent-2",
      "status": "blocked",
      "cleanup": "keep",
      "reason": "uncommitted changes present"
    }
  ],
  "owners": {
    "agent-2": ["/trees/agent-2"],
    "alice": ["/trees/main"]
  },
  "counts": {
    "total": 3,
    "main": 1,
    "locked": 0,
    "blocked": 1,
    "orphaned": 1,
    "stale": 0,
    "unowned": 0,
    "active": 0,
    "removable": 1
  }
}
```

Exit codes: `0` on success, `1` on a runtime error
(including an unreadable or invalid input file, or
invalid input), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/treeman mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "treeman": {
      "command": "npx",
      "args": ["-y", "@reneturcios/treeman", "mcp"]
    }
  }
}
```

### Tools

- `plan_worktrees` — Plan parallel-agent git worktrees
  from caller-supplied worktree facts: the ownership map,
  each tree's status, and which trees are safe to remove.
  - `worktrees` (array, required, at least 1 item) — the
    worktrees to plan, in the caller's order; each item:
    - `path` (string, required, non-empty) — worktree path
    - `branch` (string, required, non-empty) — branch
      checked out in the worktree
    - `owner` (string, optional) — agent or person who
      owns the worktree; absent, empty, or whitespace-only
      means unowned
    - `dirty` (boolean, required) — whether the worktree
      has uncommitted changes
    - `last_activity_days` (integer, required, at
      least 0) — days since the worktree last changed
    - `locked` (boolean, optional) — whether the worktree
      is locked; absent means false
  - `stale_days` (integer, required, at least 0) —
    inactivity threshold in days; beyond it a worktree is
    stale (exactly at it is not)
  - `main_path` (string, optional) — path of the primary
    worktree, which is never cleaned up

  Returns `{worktrees, owners, counts}`, where
  `worktrees` holds one `{path, branch, owner, status,
  cleanup, reason}` per input worktree in input order
  (`owner` is `null` when unowned), `owners` maps each
  distinct owner to its paths, and `counts` is `{total,
  main, locked, blocked, orphaned, stale, unowned, active,
  removable}`.

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/treeman
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/treeman plan --input /w/args.json
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
