import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { afterRewriteFailure, clearRewriteFailures, loadState, MAX_OUTPUT_ATTEMPTS, planAnnouncements, saveState, type RewriteFailure, type State } from "../src/state.js";
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

  /** Poll once a minute, failing every rewrite the same way; returns the times a rewrite was tried. */
  function failEveryPoll(kind: RewriteFailure, minutes: number): number[] {
    let state: State = { announced: {} };
    const tried: number[] = [];
    for (let now = 0; now < minutes * 60; now += 60) {
      const { toAnnounce, next } = planAnnouncements([a], state, now);
      if (toAnnounce.length) {
        tried.push(now / 60);
        afterRewriteFailure(next, a, kind, now);
      }
      state = next;
    }
    return tried;
  }

  it("gives unusable output a few tries, further apart each time, then gives up", () => {
    const tried = failEveryPoll("output", 24 * 60);
    expect(tried).toEqual([0, 1, 3]);
    expect(tried).toHaveLength(MAX_OUTPUT_ATTEMPTS);
  });

  it("keeps retrying an API failure while the alert is active, at most every 15 minutes", () => {
    const tried = failEveryPoll("api", 24 * 60);
    expect(tried.slice(0, 6)).toEqual([0, 1, 3, 7, 15, 30]);
    expect(tried.at(-1)).toBeGreaterThan(23 * 60); // still trying at the end of the day
    expect(tried.length).toBeLessThan(110); // not 1,440
  });

  it("still announces an alert once the API is back after a long outage", () => {
    let state: State = { announced: {} };
    for (let now = 0; now < 3600; now += 60) {
      const { toAnnounce, next } = planAnnouncements([a], state, now);
      if (toAnnounce.length) afterRewriteFailure(next, a, "api", now);
      state = next;
    }
    const due = state.failures!.a!.retryAt!;
    expect(planAnnouncements([a], state, due - 1).toAnnounce).toEqual([]);
    const { toAnnounce, next } = planAnnouncements([a], state, due);
    expect(toAnnounce).toEqual([a]);
    clearRewriteFailures(next, "a"); // the rewrite worked this time
    expect(next).toEqual({ announced: { a: next.announced.a }, failures: {} });
    expect(planAnnouncements([a], next, due + 60).toAnnounce).toEqual([]);
  });

  it("does not let API failures use up the tries for unusable output", () => {
    const { next } = planAnnouncements([a], { announced: {} }, 0);
    for (let i = 0; i < 10; i++) afterRewriteFailure(next, a, "api", 0);
    expect(afterRewriteFailure(next, a, "output", 0).retry).toBe(true);
    expect(afterRewriteFailure(next, a, "output", 0).retry).toBe(true);
    expect(afterRewriteFailure(next, a, "output", 0)).toMatchObject({ retry: false, attempts: 13 });
  });

  it("starts over when the alert text changes", () => {
    const { next } = planAnnouncements([a], { announced: {} }, 0);
    for (let i = 0; i < MAX_OUTPUT_ATTEMPTS; i++) afterRewriteFailure(next, a, "output", 0);
    expect(planAnnouncements([a], next, 10_000).toAnnounce).toEqual([]); // given up
    const changed = { ...a, header: "[4] trains are suspended." };
    const plan = planAnnouncements([changed], next, 0);
    expect(plan.toAnnounce).toEqual([changed]);
    expect(plan.next.failures).toEqual({});
    expect(afterRewriteFailure(plan.next, changed, "output", 0)).toMatchObject({ retry: true, attempts: 1 });
  });

  it("clears the count after a success and forgets alerts that ended", () => {
    const { next } = planAnnouncements([a], { announced: {} }, 0);
    afterRewriteFailure(next, a, "api", 0);
    clearRewriteFailures(next, "a");
    expect(next.failures).toEqual({});
    afterRewriteFailure(next, a, "api", 0);
    expect(planAnnouncements([], next, 0).next.failures).toEqual({});
  });

  it("reads state files saved before failures were tracked, or before retries had a wait", () => {
    expect(planAnnouncements([a], { announced: { a: "old" } }).next.failures).toEqual({});
    const { next } = planAnnouncements([a], { announced: {} }, 0);
    const old: State = { announced: {}, failures: { a: { fp: next.announced.a!, n: 2 } } };
    expect(planAnnouncements([a], old, 0).toAnnounce).toEqual([a]);
  });
});
