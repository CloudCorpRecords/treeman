/**
 * treeman core: plan parallel-agent git worktrees from
 * caller-supplied worktree facts.
 *
 *   planWorktrees(args) -> { worktrees, owners, counts }
 *
 * Ownership (pinned judgement call): an `owner` that is
 * absent, or a string that is empty or whitespace-only,
 * means the worktree is UNOWNED and its owner echoes as
 * null. An owned worktree's owner echoes verbatim.
 *
 * Status precedence (pinned, first match wins):
 *   1. main_path supplied and path equals it -> "main",
 *      cleanup "keep", reason "primary worktree".
 *   2. locked is true -> "locked", "keep",
 *      "worktree is locked".
 *   3. dirty is true -> "blocked", "keep",
 *      "uncommitted changes present".
 *   4. last_activity_days > stale_days and unowned ->
 *      "orphaned", "remove",
 *      "no owner and inactive beyond the stale threshold".
 *   5. last_activity_days > stale_days -> "stale",
 *      "review", "inactive beyond the stale threshold".
 *   6. unowned -> "unowned", "review", "no recorded owner".
 *   7. otherwise -> "active", "keep",
 *      "owned and recently active".
 * The staleness comparison is strictly greater-than:
 * last_activity_days exactly equal to stale_days is NOT
 * stale.
 *
 * The owners map lists each distinct owner name with its
 * worktree paths in input order; owner keys are sorted
 * code-unit ascending and unowned worktrees are excluded.
 * counts keys are in the order {total, main, locked,
 * blocked, orphaned, stale, unowned, active, removable};
 * removable counts worktrees whose cleanup is "remove".
 *
 * Duplicate `path` values across worktrees are an error
 * naming the duplicated path. Validation is strict and
 * path-naming: any malformed input throws an Error naming
 * the offending path and no partial result is produced.
 * Unknown extra fields are ignored, including inside
 * items; a non-object top-level argument is treated as {}.
 */
import type {
  CleanupAction,
  PlannedWorktree,
  TreemanResult,
  WorktreeCounts,
  WorktreeStatus,
} from "./types.js";

export const VERSION = "0.1.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface WorktreeFacts {
  path: string;
  branch: string;
  owner: string | null;
  dirty: boolean;
  lastActivityDays: number;
  locked: boolean;
}

function parseWorktree(item: unknown, index: number): WorktreeFacts {
  const at = `worktrees[${index}]`;
  if (!isRecord(item)) throw new Error(`${at} must be an object`);

  if (item.path === undefined) throw new Error(`${at}.path is required`);
  if (typeof item.path !== "string" || item.path.length === 0) {
    throw new Error(`${at}.path must be a non-empty string`);
  }

  if (item.branch === undefined) throw new Error(`${at}.branch is required`);
  if (typeof item.branch !== "string" || item.branch.length === 0) {
    throw new Error(`${at}.branch must be a non-empty string`);
  }

  let owner: string | null = null;
  if (item.owner !== undefined) {
    if (typeof item.owner !== "string") {
      throw new Error(`${at}.owner must be a string`);
    }
    owner = item.owner.trim().length === 0 ? null : item.owner;
  }

  if (item.dirty === undefined) throw new Error(`${at}.dirty is required`);
  if (typeof item.dirty !== "boolean") {
    throw new Error(`${at}.dirty must be a boolean`);
  }

  if (item.last_activity_days === undefined) {
    throw new Error(`${at}.last_activity_days is required`);
  }
  if (
    typeof item.last_activity_days !== "number" ||
    !Number.isInteger(item.last_activity_days) ||
    item.last_activity_days < 0
  ) {
    throw new Error(`${at}.last_activity_days must be an integer >= 0`);
  }

  let locked = false;
  if (item.locked !== undefined) {
    if (typeof item.locked !== "boolean") {
      throw new Error(`${at}.locked must be a boolean`);
    }
    locked = item.locked;
  }

  return {
    path: item.path,
    branch: item.branch,
    owner,
    dirty: item.dirty,
    lastActivityDays: item.last_activity_days,
    locked,
  };
}

function classify(
  facts: WorktreeFacts,
  staleDays: number,
  mainPath: string | undefined,
): { status: WorktreeStatus; cleanup: CleanupAction; reason: string } {
  if (mainPath !== undefined && facts.path === mainPath) {
    return { status: "main", cleanup: "keep", reason: "primary worktree" };
  }
  if (facts.locked) {
    return { status: "locked", cleanup: "keep", reason: "worktree is locked" };
  }
  if (facts.dirty) {
    return {
      status: "blocked",
      cleanup: "keep",
      reason: "uncommitted changes present",
    };
  }
  const stale = facts.lastActivityDays > staleDays;
  if (stale && facts.owner === null) {
    return {
      status: "orphaned",
      cleanup: "remove",
      reason: "no owner and inactive beyond the stale threshold",
    };
  }
  if (stale) {
    return {
      status: "stale",
      cleanup: "review",
      reason: "inactive beyond the stale threshold",
    };
  }
  if (facts.owner === null) {
    return { status: "unowned", cleanup: "review", reason: "no recorded owner" };
  }
  return {
    status: "active",
    cleanup: "keep",
    reason: "owned and recently active",
  };
}

/** Plan parallel-agent git worktrees from supplied facts. */
export function planWorktrees(args: unknown): TreemanResult {
  const raw: Record<string, unknown> = isRecord(args) ? args : {};

  if (raw.worktrees === undefined) throw new Error("worktrees is required");
  if (!Array.isArray(raw.worktrees) || raw.worktrees.length === 0) {
    throw new Error("worktrees must be a non-empty array");
  }

  if (raw.stale_days === undefined) throw new Error("stale_days is required");
  if (
    typeof raw.stale_days !== "number" ||
    !Number.isInteger(raw.stale_days) ||
    raw.stale_days < 0
  ) {
    throw new Error("stale_days must be an integer >= 0");
  }
  const staleDays = raw.stale_days;

  let mainPath: string | undefined;
  if (raw.main_path !== undefined) {
    if (typeof raw.main_path !== "string" || raw.main_path.length === 0) {
      throw new Error("main_path must be a non-empty string");
    }
    mainPath = raw.main_path;
  }

  const facts = raw.worktrees.map((item, i) => parseWorktree(item, i));

  const seen = new Set<string>();
  for (const f of facts) {
    if (seen.has(f.path)) {
      throw new Error(`duplicate worktree path: ${f.path}`);
    }
    seen.add(f.path);
  }

  const planned: PlannedWorktree[] = facts.map((f) => ({
    path: f.path,
    branch: f.branch,
    owner: f.owner,
    ...classify(f, staleDays, mainPath),
  }));

  const byOwner = new Map<string, string[]>();
  for (const f of facts) {
    if (f.owner === null) continue;
    const list = byOwner.get(f.owner);
    if (list) list.push(f.path);
    else byOwner.set(f.owner, [f.path]);
  }
  const owners: Record<string, string[]> = {};
  for (const key of [...byOwner.keys()].sort()) {
    owners[key] = byOwner.get(key)!;
  }

  const counts: WorktreeCounts = {
    total: planned.length,
    main: 0,
    locked: 0,
    blocked: 0,
    orphaned: 0,
    stale: 0,
    unowned: 0,
    active: 0,
    removable: 0,
  };
  for (const p of planned) {
    counts[p.status] += 1;
    if (p.cleanup === "remove") counts.removable += 1;
  }

  return { worktrees: planned, owners, counts };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
