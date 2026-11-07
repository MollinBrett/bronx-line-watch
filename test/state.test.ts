import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { afterRewriteFailure, clearRewriteFailures, loadState, MAX_REWRITE_ATTEMPTS, planAnnouncements, saveState, type State } from "../src/state.js";
import { makeAlert } from "./helpers.js";

describe("planAnnouncements", () => {
  const a = makeAlert({ id: "a" });

  it("announces a new alert once", () => {
    const first = planAnnouncements([a], { announced: {} });
    expect(first.toAnnounce).toEqual([a]);
    const second = planAnnouncements([a], first.next);
    expect(second.toAnnounce).toEqual([]);
  });

  it("re-announces when the alert text changes", () => {
    const { next } = planAnnouncements([a], { announced: {} });
    const changed = { ...a, header: "[4] trains are suspended." };
    expect(planAnnouncements([changed], next).toAnnounce).toEqual([changed]);
  });

  it("forgets alerts that ended", () => {
    const { next } = planAnnouncements([a], { announced: {} });
    expect(planAnnouncements([], next).next.announced).toEqual({});
  });
});

describe("state file", () => {
  it("returns null before the first save, then round-trips", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "blw-")), "nested", "state.json");
    expect(await loadState(path)).toBeNull();
    await saveState(path, { announced: { a: "123" } });
    expect(await loadState(path)).toEqual({ announced: { a: "123" } });
  });
});

describe("rewrite failures (#65)", () => {
  const a = makeAlert({ id: "a" });

  it("never retries a permanent failure", () => {
    const { next } = planAnnouncements([a], { announced: {} });
    expect(afterRewriteFailure(next, a, "permanent")).toEqual({ retry: false, attempts: 1 });
    expect(planAnnouncements([a], next).toAnnounce).toEqual([]);
  });

  it("retries a transient failure a bounded number of times, then stops", () => {
    let state: State = { announced: {} };
    let polls = 0;
    for (;;) {
      const { toAnnounce, next } = planAnnouncements([a], state);
      if (!toAnnounce.length) break;
      polls++;
      afterRewriteFailure(next, a, "transient");
      state = next;
      if (polls > 50) throw new Error("retried forever");
    }
    expect(polls).toBe(MAX_REWRITE_ATTEMPTS);
  });

  it("starts over when the alert text changes", () => {
    const { next } = planAnnouncements([a], { announced: {} });
    afterRewriteFailure(next, a, "permanent");
    const changed = { ...a, header: "[4] trains are suspended." };
    const plan = planAnnouncements([changed], next);
    expect(plan.toAnnounce).toEqual([changed]);
    expect(plan.next.failures).toEqual({});
    expect(afterRewriteFailure(plan.next, changed, "transient")).toEqual({ retry: true, attempts: 1 });
  });

  it("clears the count after a success and forgets alerts that ended", () => {
    const { next } = planAnnouncements([a], { announced: {} });
    afterRewriteFailure(next, a, "transient");
    clearRewriteFailures(next, "a");
    expect(next.failures).toEqual({});
    afterRewriteFailure(next, a, "transient");
    expect(planAnnouncements([], next).next.failures).toEqual({});
  });

  it("reads state files saved before failures were tracked", () => {
    expect(planAnnouncements([a], { announced: { a: "old" } }).next.failures).toEqual({});
  });
});
