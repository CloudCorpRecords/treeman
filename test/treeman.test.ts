import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planWorktrees } from "../src/treeman.js";

/**
 * All tests are pure local computation over inline worktree
 * facts: no git, no filesystem, no network. Every one of
 * the seven statuses with its exact reason and cleanup, the
 * precedence order between them, the strictly-greater
 * staleness boundary for owned and unowned trees, the
 * owner / owners-map semantics (code-unit ascending keys,
 * input-order path lists, unowned excluded, owner null
 * echo), the counts including removable, the duplicate-path
 * error, a main_path that matches nothing, and every
 * validation path are each pinned.
 */

type W = Record<string, unknown>;

const tree = (over: W = {}): W => ({
  path: "/trees/a",
  branch: "feat/a",
  owner: "alice",
  dirty: false,
  last_activity_days: 2,
  ...over,
});

const plan = (worktrees: unknown, over: W = {}) =>
  planWorktrees({ worktrees, stale_days: 30, ...over });

const one = (over: W = {}, planOver: W = {}) =>
  plan([tree(over)], planOver).worktrees[0];

describe("planWorktrees — the seven statuses", () => {
  it("main: path equal to main_path, exact reason and cleanup", () => {
    assert.deepEqual(one({}, { main_path: "/trees/a" }), {
      path: "/trees/a",
      branch: "feat/a",
      owner: "alice",
      status: "main",
      cleanup: "keep",
      reason: "primary worktree",
    });
  });

  it("locked: locked true, exact reason and cleanup", () => {
    const out = one({ locked: true });
    assert.equal(out.status, "locked");
    assert.equal(out.cleanup, "keep");
    assert.equal(out.reason, "worktree is locked");
  });

  it("blocked: dirty true, exact reason and cleanup", () => {
    const out = one({ dirty: true });
    assert.equal(out.status, "blocked");
    assert.equal(out.cleanup, "keep");
    assert.equal(out.reason, "uncommitted changes present");
  });

  it("orphaned: stale and unowned, exact reason and cleanup remove", () => {
    const out = one({ owner: undefined, last_activity_days: 45 });
    // owner: undefined in the literal still counts as present-but-undefined;
    // the dedicated absent case is covered below.
    assert.equal(out.status, "orphaned");
    assert.equal(out.cleanup, "remove");
    assert.equal(out.reason, "no owner and inactive beyond the stale threshold");
    assert.equal(out.owner, null);
  });

  it("stale: stale and owned, exact reason and cleanup review", () => {
    const out = one({ last_activity_days: 45 });
    assert.equal(out.status, "stale");
    assert.equal(out.cleanup, "review");
    assert.equal(out.reason, "inactive beyond the stale threshold");
  });

  it("unowned: recent and unowned, exact reason and cleanup review", () => {
    const { owner: _drop, ...rest } = tree();
    const out = plan([rest]).worktrees[0];
    assert.equal(out.status, "unowned");
    assert.equal(out.cleanup, "review");
    assert.equal(out.reason, "no recorded owner");
    assert.equal(out.owner, null);
  });

  it("active: owned and recently active, exact reason and cleanup keep", () => {
    const out = one({});
    assert.equal(out.status, "active");
    assert.equal(out.cleanup, "keep");
    assert.equal(out.reason, "owned and recently active");
    assert.equal(out.owner, "alice");
  });
});

describe("planWorktrees — precedence", () => {
  it("main beats locked, dirty, stale, and unowned all at once", () => {
    const { owner: _drop, ...rest } = tree({
      locked: true,
      dirty: true,
      last_activity_days: 999,
    });
    const out = plan([rest], { main_path: "/trees/a" }).worktrees[0];
    assert.equal(out.status, "main");
    assert.equal(out.cleanup, "keep");
    assert.equal(out.reason, "primary worktree");
  });

  it("locked beats dirty", () => {
    const out = one({ locked: true, dirty: true });
    assert.equal(out.status, "locked");
    assert.equal(out.reason, "worktree is locked");
  });

  it("locked beats stale and unowned", () => {
    const { owner: _drop, ...rest } = tree({
      locked: true,
      last_activity_days: 999,
    });
    const out = plan([rest]).worktrees[0];
    assert.equal(out.status, "locked");
  });

  it("dirty beats orphaned even when the tree is stale and unowned", () => {
    const { owner: _drop, ...rest } = tree({
      dirty: true,
      last_activity_days: 999,
    });
    const out = plan([rest]).worktrees[0];
    assert.equal(out.status, "blocked");
    assert.equal(out.cleanup, "keep");
    assert.equal(out.reason, "uncommitted changes present");
  });

  it("dirty beats stale for an owned tree", () => {
    const out = one({ dirty: true, last_activity_days: 999 });
    assert.equal(out.status, "blocked");
  });

  it("orphaned beats unowned: a stale unowned tree is orphaned, not unowned", () => {
    const { owner: _drop, ...rest } = tree({ last_activity_days: 31 });
    const out = plan([rest]).worktrees[0];
    assert.equal(out.status, "orphaned");
  });

  it("stale beats active for an owned tree", () => {
    assert.equal(one({ last_activity_days: 31 }).status, "stale");
  });

  it("locked false behaves exactly like locked absent", () => {
    assert.equal(one({ locked: false }).status, "active");
  });
});

describe("planWorktrees — staleness boundary (strictly greater)", () => {
  it("owned: last_activity_days == stale_days is NOT stale (active)", () => {
    const out = one({ last_activity_days: 30 });
    assert.equal(out.status, "active");
    assert.equal(out.reason, "owned and recently active");
  });

  it("owned: stale_days + 1 IS stale", () => {
    assert.equal(one({ last_activity_days: 31 }).status, "stale");
  });

  it("unowned: last_activity_days == stale_days is NOT stale (unowned, not orphaned)", () => {
    const { owner: _drop, ...rest } = tree({ last_activity_days: 30 });
    const out = plan([rest]).worktrees[0];
    assert.equal(out.status, "unowned");
    assert.equal(out.cleanup, "review");
  });

  it("unowned: stale_days + 1 IS past the threshold (orphaned)", () => {
    const { owner: _drop, ...rest } = tree({ last_activity_days: 31 });
    const out = plan([rest]).worktrees[0];
    assert.equal(out.status, "orphaned");
    assert.equal(out.cleanup, "remove");
  });

  it("boundary holds at stale_days 0: 0 days is not stale, 1 day is", () => {
    assert.equal(one({ last_activity_days: 0 }, { stale_days: 0 }).status, "active");
    assert.equal(one({ last_activity_days: 1 }, { stale_days: 0 }).status, "stale");
  });
});

describe("planWorktrees — owner semantics (pinned judgement call)", () => {
  it("an absent owner means unowned and echoes as null", () => {
    const { owner: _drop, ...rest } = tree();
    const out = plan([rest]).worktrees[0];
    assert.equal(out.owner, null);
    assert.equal(out.status, "unowned");
  });

  it("an empty-string owner means unowned and echoes as null", () => {
    const out = one({ owner: "" });
    assert.equal(out.owner, null);
    assert.equal(out.status, "unowned");
  });

  it("a whitespace-only owner means unowned and echoes as null", () => {
    for (const owner of [" ", "   ", "\t", " \t\n "]) {
      const out = one({ owner });
      assert.equal(out.owner, null);
      assert.equal(out.status, "unowned");
    }
  });

  it("a whitespace-only owner on a stale tree is orphaned (unowned judgement call)", () => {
    const out = one({ owner: "   ", last_activity_days: 90 });
    assert.equal(out.owner, null);
    assert.equal(out.status, "orphaned");
    assert.equal(out.cleanup, "remove");
  });

  it("an owned worktree's owner echoes verbatim, including surrounding spaces", () => {
    const out = one({ owner: " alice " });
    assert.equal(out.owner, " alice ");
    assert.equal(out.status, "active");
  });
});

describe("planWorktrees — owners map", () => {
  it("keys are sorted code-unit ascending regardless of input order", () => {
    const out = plan([
      tree({ path: "/trees/1", owner: "carol" }),
      tree({ path: "/trees/2", owner: "Alice" }),
      tree({ path: "/trees/3", owner: "bob" }),
      tree({ path: "/trees/4", owner: "alice" }),
    ]);
    // Code-unit ascending: uppercase letters sort before lowercase.
    assert.deepEqual(Object.keys(out.owners), ["Alice", "alice", "bob", "carol"]);
  });

  it("each owner's path list follows input order, not sorted order", () => {
    const out = plan([
      tree({ path: "/trees/z", owner: "alice" }),
      tree({ path: "/trees/b", owner: "bob" }),
      tree({ path: "/trees/a", owner: "alice" }),
      tree({ path: "/trees/m", owner: "alice" }),
    ]);
    assert.deepEqual(out.owners, {
      alice: ["/trees/z", "/trees/a", "/trees/m"],
      bob: ["/trees/b"],
    });
  });

  it("unowned worktrees are excluded from the owners map entirely", () => {
    const { owner: _drop, ...rest } = tree({ path: "/trees/x" });
    const out = plan([rest, tree({ path: "/trees/y", owner: "  " })]);
    assert.deepEqual(out.owners, {});
  });

  it("an owner whose only tree is the main tree still appears in the map", () => {
    const out = plan([tree({})], { main_path: "/trees/a" });
    assert.deepEqual(out.owners, { alice: ["/trees/a"] });
  });
});

describe("planWorktrees — output shape and counts", () => {
  const mixed = () =>
    plan(
      [
        tree({ path: "/trees/main", branch: "main" }),
        tree({ path: "/trees/lock", owner: "bob", locked: true }),
        tree({ path: "/trees/dirty", owner: "bob", dirty: true }),
        { path: "/trees/orphan", branch: "feat/o", dirty: false, last_activity_days: 60 },
        tree({ path: "/trees/stale", owner: "carol", last_activity_days: 60 }),
        { path: "/trees/lost", branch: "feat/l", dirty: false, last_activity_days: 1 },
        tree({ path: "/trees/live", owner: "carol", last_activity_days: 1 }),
      ],
      { main_path: "/trees/main" },
    );

  it("worktrees come back in input order with one of each status", () => {
    const out = mixed();
    assert.deepEqual(
      out.worktrees.map((w) => w.path),
      [
        "/trees/main",
        "/trees/lock",
        "/trees/dirty",
        "/trees/orphan",
        "/trees/stale",
        "/trees/lost",
        "/trees/live",
      ],
    );
    assert.deepEqual(
      out.worktrees.map((w) => w.status),
      ["main", "locked", "blocked", "orphaned", "stale", "unowned", "active"],
    );
  });

  it("counts tally every status, the total, and removable, with keys in the pinned order", () => {
    const out = mixed();
    assert.deepEqual(out.counts, {
      total: 7,
      main: 1,
      locked: 1,
      blocked: 1,
      orphaned: 1,
      stale: 1,
      unowned: 1,
      active: 1,
      removable: 1,
    });
    assert.deepEqual(Object.keys(out.counts), [
      "total",
      "main",
      "locked",
      "blocked",
      "orphaned",
      "stale",
      "unowned",
      "active",
      "removable",
    ]);
  });

  it("removable counts only cleanup remove (orphaned), never review or keep", () => {
    const out = plan([
      { path: "/trees/o1", branch: "b", dirty: false, last_activity_days: 90 },
      { path: "/trees/o2", branch: "b", dirty: false, last_activity_days: 90 },
      tree({ path: "/trees/s", last_activity_days: 90 }),
      tree({ path: "/trees/a" }),
    ]);
    assert.equal(out.counts.orphaned, 2);
    assert.equal(out.counts.removable, 2);
    assert.equal(out.counts.total, 4);
  });

  it("a single active tree gives counts with zeroes everywhere else", () => {
    assert.deepEqual(plan([tree({})]).counts, {
      total: 1,
      main: 0,
      locked: 0,
      blocked: 0,
      orphaned: 0,
      stale: 0,
      unowned: 0,
      active: 1,
      removable: 0,
    });
  });

  it("branch echoes verbatim per worktree", () => {
    const out = plan([tree({ branch: "agent/x-42" })]);
    assert.equal(out.worktrees[0].branch, "agent/x-42");
  });
});

describe("planWorktrees — main_path matching nothing", () => {
  it("no worktree gets the main status when main_path matches no path", () => {
    const out = plan([tree({}), tree({ path: "/trees/b", locked: true })], {
      main_path: "/trees/elsewhere",
    });
    assert.deepEqual(
      out.worktrees.map((w) => w.status),
      ["active", "locked"],
    );
    assert.equal(out.counts.main, 0);
  });

  it("main_path matching is exact: a near-match path is not main", () => {
    const out = plan([tree({ path: "/trees/a2" })], { main_path: "/trees/a" });
    assert.equal(out.worktrees[0].status, "active");
  });
});

describe("planWorktrees — duplicate paths", () => {
  it("duplicate path values are an error naming the duplicated path", () => {
    assert.throws(
      () => plan([tree({}), tree({ branch: "other" })]),
      { message: "duplicate worktree path: /trees/a" },
    );
  });

  it("the error names the second occurrence's path when several trees are present", () => {
    assert.throws(
      () =>
        plan([
          tree({ path: "/trees/a" }),
          tree({ path: "/trees/b" }),
          tree({ path: "/trees/b", branch: "dup" }),
        ]),
      { message: "duplicate worktree path: /trees/b" },
    );
  });

  it("no partial result is produced on a duplicate", () => {
    assert.throws(() => plan([tree({}), tree({})]));
  });
});

describe("planWorktrees — validation", () => {
  const throws = (args: unknown, message: string) =>
    assert.throws(() => planWorktrees(args), { message });

  it("worktrees missing is an error naming worktrees", () => {
    throws({ stale_days: 30 }, "worktrees is required");
    throws({}, "worktrees is required");
  });

  it("a non-object top-level argument is treated as {} and fails on worktrees", () => {
    throws(null, "worktrees is required");
    throws([], "worktrees is required");
    throws("x", "worktrees is required");
    throws(42, "worktrees is required");
    throws(undefined, "worktrees is required");
  });

  it("worktrees not an array or empty names worktrees", () => {
    throws({ worktrees: "x", stale_days: 1 }, "worktrees must be a non-empty array");
    throws({ worktrees: {}, stale_days: 1 }, "worktrees must be a non-empty array");
    throws({ worktrees: 3, stale_days: 1 }, "worktrees must be a non-empty array");
    throws({ worktrees: [], stale_days: 1 }, "worktrees must be a non-empty array");
  });

  it("an item that is not an object names its index", () => {
    throws({ worktrees: ["x"], stale_days: 1 }, "worktrees[0] must be an object");
    throws({ worktrees: [null], stale_days: 1 }, "worktrees[0] must be an object");
    throws({ worktrees: [[]], stale_days: 1 }, "worktrees[0] must be an object");
    throws(
      { worktrees: [tree({}), 7], stale_days: 1 },
      "worktrees[1] must be an object",
    );
  });

  it("path missing, empty, or non-string names worktrees[i].path", () => {
    const { path: _p, ...noPath } = tree();
    throws({ worktrees: [noPath], stale_days: 1 }, "worktrees[0].path is required");
    throws(
      { worktrees: [tree({ path: "" })], stale_days: 1 },
      "worktrees[0].path must be a non-empty string",
    );
    throws(
      { worktrees: [tree({ path: 42 })], stale_days: 1 },
      "worktrees[0].path must be a non-empty string",
    );
    throws(
      { worktrees: [tree({ path: null })], stale_days: 1 },
      "worktrees[0].path must be a non-empty string",
    );
  });

  it("branch missing, empty, or non-string names worktrees[i].branch", () => {
    const { branch: _b, ...noBranch } = tree();
    throws(
      { worktrees: [noBranch], stale_days: 1 },
      "worktrees[0].branch is required",
    );
    throws(
      { worktrees: [tree({ branch: "" })], stale_days: 1 },
      "worktrees[0].branch must be a non-empty string",
    );
    throws(
      { worktrees: [tree({}), tree({ branch: false })], stale_days: 1 },
      "worktrees[1].branch must be a non-empty string",
    );
  });

  it("owner present but not a string names worktrees[i].owner", () => {
    for (const bad of [42, true, null, [], {}]) {
      throws(
        { worktrees: [tree({ owner: bad })], stale_days: 1 },
        "worktrees[0].owner must be a string",
      );
    }
  });

  it("dirty missing names worktrees[i].dirty as required (spec example shape)", () => {
    const { dirty: _d, ...noDirty } = tree();
    throws(
      { worktrees: [tree({ path: "/trees/ok" }), noDirty], stale_days: 1 },
      "worktrees[1].dirty is required",
    );
  });

  it("dirty not a boolean names worktrees[i].dirty (spec example)", () => {
    throws(
      { worktrees: [tree({}), tree({ dirty: "yes" })], stale_days: 1 },
      "worktrees[1].dirty must be a boolean",
    );
    for (const bad of [0, 1, null, [], {}]) {
      throws(
        { worktrees: [tree({ dirty: bad })], stale_days: 1 },
        "worktrees[0].dirty must be a boolean",
      );
    }
  });

  it("locked present but not a boolean names worktrees[i].locked", () => {
    for (const bad of ["true", 0, 1, null, [], {}]) {
      throws(
        { worktrees: [tree({ locked: bad })], stale_days: 1 },
        "worktrees[0].locked must be a boolean",
      );
    }
  });

  it("last_activity_days missing names worktrees[i].last_activity_days as required", () => {
    const { last_activity_days: _l, ...noDays } = tree();
    throws(
      { worktrees: [noDays], stale_days: 1 },
      "worktrees[0].last_activity_days is required",
    );
  });

  it("last_activity_days non-integer or negative names worktrees[i].last_activity_days", () => {
    for (const bad of [-1, -100, 1.5, 0.5, "3", true, null, [], {}]) {
      throws(
        { worktrees: [tree({ last_activity_days: bad })], stale_days: 1 },
        "worktrees[0].last_activity_days must be an integer >= 0",
      );
    }
  });

  it("last_activity_days of 0 is valid", () => {
    assert.equal(one({ last_activity_days: 0 }).status, "active");
  });

  it("stale_days missing names stale_days as required", () => {
    throws({ worktrees: [tree({})] }, "stale_days is required");
  });

  it("stale_days non-integer or negative names stale_days", () => {
    for (const bad of [-1, 2.5, "30", true, null, [], {}]) {
      throws(
        { worktrees: [tree({})], stale_days: bad },
        "stale_days must be an integer >= 0",
      );
    }
  });

  it("stale_days of 0 is valid", () => {
    assert.equal(plan([tree({})], { stale_days: 0 }).worktrees[0].status, "stale");
  });

  it("main_path present but empty or non-string names main_path", () => {
    throws(
      { worktrees: [tree({})], stale_days: 1, main_path: "" },
      "main_path must be a non-empty string",
    );
    for (const bad of [42, true, null, [], {}]) {
      throws(
        { worktrees: [tree({})], stale_days: 1, main_path: bad },
        "main_path must be a non-empty string",
      );
    }
  });

  it("unknown extra fields are ignored, including inside items", () => {
    const out = planWorktrees({
      worktrees: [tree({ prunable: true, bare: false })],
      stale_days: 30,
      generated_by: "test",
    });
    assert.equal(out.worktrees[0].status, "active");
    assert.equal(out.counts.total, 1);
  });

  it("no partial result is produced on invalid input deep in the list", () => {
    assert.throws(() =>
      plan([tree({}), tree({ path: "/trees/b" }), tree({ path: "/trees/c", dirty: 1 })]),
    );
  });
});
