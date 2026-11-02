/**
 * treeman types.
 *
 * treeman plans parallel-agent git worktrees from
 * caller-supplied worktree facts only. For each worktree
 * the caller supplies its path, the branch checked out in
 * it, whether it has uncommitted changes, how many days
 * have passed since it last changed, and optionally who
 * owns it and whether it is locked. The caller also
 * supplies the inactivity threshold and optionally the
 * path of the primary worktree. From that data alone, as
 * pure local computation, treeman reports:
 *
 *   - one planned entry per worktree: its owner (null when
 *     unowned), a status, a cleanup action, and a reason
 *   - the ownership map: each distinct owner name to the
 *     paths it owns, owner keys sorted code-unit ascending
 *   - counts per status, plus the total and how many
 *     trees are removable
 *
 * The status set is pinned: "main", "locked", "blocked",
 * "orphaned", "stale", "unowned", "active". The cleanup
 * set is pinned: "keep", "remove", "review". Git and the
 * filesystem are never touched.
 */

/** Status assigned to one worktree. */
export type WorktreeStatus =
  | "main"
  | "locked"
  | "blocked"
  | "orphaned"
  | "stale"
  | "unowned"
  | "active";

/** Cleanup action planned for one worktree. */
export type CleanupAction = "keep" | "remove" | "review";

/** One worktree in the plan, in input order. */
export interface PlannedWorktree {
  /** Worktree path, echoed from the input. */
  path: string;
  /** Branch checked out in the worktree, echoed. */
  branch: string;
  /** Owner name echoed verbatim, or null when unowned. */
  owner: string | null;
  /** Status decided by the pinned precedence order. */
  status: WorktreeStatus;
  /** Cleanup action paired with the status. */
  cleanup: CleanupAction;
  /** Exact reason string for the status. */
  reason: string;
}

/** Status tallies plus the total and removable counts. */
export interface WorktreeCounts {
  /** Number of worktrees planned. */
  total: number;
  /** Worktrees with status "main". */
  main: number;
  /** Worktrees with status "locked". */
  locked: number;
  /** Worktrees with status "blocked". */
  blocked: number;
  /** Worktrees with status "orphaned". */
  orphaned: number;
  /** Worktrees with status "stale". */
  stale: number;
  /** Worktrees with status "unowned". */
  unowned: number;
  /** Worktrees with status "active". */
  active: number;
  /** Worktrees whose cleanup action is "remove". */
  removable: number;
}

/** The full worktree plan. */
export interface TreemanResult {
  /** One planned entry per input worktree, in input order. */
  worktrees: PlannedWorktree[];
  /** Owner name -> its worktree paths in input order. */
  owners: Record<string, string[]>;
  /** Status tallies, total, and removable count. */
  counts: WorktreeCounts;
}
