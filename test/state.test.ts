import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, forget, loadState, planAnnouncements, primed, saveState, without, type State } from "../src/state.js";
import { makeAlert } from "./helpers.js";

const MIN = 60;
const HOUR = 60 * MIN;
const T0 = 1_000_000;
const empty = (): State => ({ announced: {} });

describe("planAnnouncements", () => {
  const a = makeAlert({ id: "a" });
  const changed = { ...a, header: "[4] trains are suspended." };

  it("announces a new alert once", () => {
    const first = planAnnouncements([a], empty(), T0);
    expect(first.toAnnounce).toEqual([a]);
    const second = planAnnouncements([a], first.next, T0 + MIN);
    expect(second.toAnnounce).toEqual([]);
  });

  it("re-announces when the alert text changes, once the per-alert wait is over", () => {
    const { next } = planAnnouncements([a], empty(), T0);
    const later = T0 + DEFAULT_LIMITS.minReannounceSeconds;
    expect(planAnnouncements([changed], next, later).toAnnounce).toEqual([changed]);
  });

  it("holds a change to an alert it just announced, then sends it after the wait (#40)", () => {
    let state = planAnnouncements([a], empty(), T0).next;
    // The header is rewritten every minute: nothing goes out during the wait.
    for (let t = T0 + MIN; t < T0 + DEFAULT_LIMITS.minReannounceSeconds; t += MIN) {
      const plan = planAnnouncements([{ ...changed, header: `[4] update at ${t}` }], state, t);
      expect(plan.toAnnounce).toEqual([]);
      state = plan.next;
    }
    const plan = planAnnouncements([changed], state, T0 + DEFAULT_LIMITS.minReannounceSeconds);
    expect(plan.toAnnounce).toEqual([changed]);
  });

  it("does not re-announce an alert that drops out of the feed for one poll (#40)", () => {
    const t1 = planAnnouncements([a], empty(), T0);
    const t2 = planAnnouncements([], t1.next, T0 + MIN);
    expect(planAnnouncements([a], t2.next, T0 + 2 * MIN).toAnnounce).toEqual([]);
  });

  it("forgets an alert that has been gone for six hours, so a re-issued one is announced", () => {
    const t1 = planAnnouncements([a], empty(), T0);
    const stillKnown = planAnnouncements([], t1.next, T0 + 6 * HOUR - 1);
    expect(Object.keys(stillKnown.next.announced)).toEqual(["a"]);
    const gone = planAnnouncements([], stillKnown.next, T0 + 6 * HOUR);
    expect(Object.keys(gone.next.announced)).toEqual([]);
    expect(planAnnouncements([a], gone.next, T0 + 6 * HOUR + MIN).toAnnounce).toEqual([a]);
  });

  it("reads a state file written before lastSeen existed", () => {
    const { next } = planAnnouncements([a], empty(), T0);
    const old: State = { announced: { ...next.announced } };
    expect(planAnnouncements([a], old, T0 + MIN).toAnnounce).toEqual([]);
    // Gone from the feed: the six hours start from the first poll that sees the old file.
    const t2 = planAnnouncements([], old, T0 + MIN);
    expect(planAnnouncements([a], t2.next, T0 + 2 * MIN).toAnnounce).toEqual([]);
  });

  it("announces at most 5 alerts per poll and holds the rest for the next one (#40)", () => {
    const eight = Array.from({ length: 8 }, (_, i) => makeAlert({ id: `x:${i}` }));
    const first = planAnnouncements(eight, empty(), T0);
    expect(first.toAnnounce).toEqual(eight.slice(0, 5));
    expect(first.deferred).toBe(3);
    const second = planAnnouncements(eight, first.next, T0 + MIN);
    expect(second.toAnnounce).toEqual(eight.slice(5));
    expect(second.deferred).toBe(0);
    expect(planAnnouncements(eight, second.next, T0 + 2 * MIN).toAnnounce).toEqual([]);
  });

  it("sends nothing when more than 10 alerts are new at once, and doesn't send them later (#40)", () => {
    const many = Array.from({ length: 200 }, (_, i) => makeAlert({ id: `x:${i}` }));
    const known = planAnnouncements([a], empty(), T0).next;
    const flood = planAnnouncements([a, ...many], known, T0 + MIN);
    expect(flood).toMatchObject({ toAnnounce: [], flood: true, deferred: 0 });
    const after = planAnnouncements([a, ...many], flood.next, T0 + 2 * MIN);
    expect(after).toMatchObject({ toAnnounce: [], flood: false });
  });

  it("10 new alerts at once is not a flood", () => {
    const ten = Array.from({ length: 10 }, (_, i) => makeAlert({ id: `x:${i}` }));
    expect(planAnnouncements(ten, empty(), T0)).toMatchObject({ flood: false, deferred: 5 });
  });

  it("lets a caller turn the flood check off, and still caps each poll", () => {
    const many = Array.from({ length: 30 }, (_, i) => makeAlert({ id: `x:${i}` }));
    const plan = planAnnouncements(many, empty(), T0, { ...DEFAULT_LIMITS, floodAbove: Infinity });
    expect(plan).toMatchObject({ flood: false, deferred: 25 });
    expect(plan.toAnnounce).toHaveLength(5);
  });
});

describe("primed", () => {
  it("marks every current alert as announced, however many there are", () => {
    const eight = Array.from({ length: 8 }, (_, i) => makeAlert({ id: `x:${i}` }));
    expect(planAnnouncements(eight, primed(eight, T0), T0 + MIN).toAnnounce).toEqual([]);
  });
});

describe("forget and without", () => {
  const a = makeAlert({ id: "a" });
  const b = makeAlert({ id: "b" });

  it("forget makes the next poll treat the alert as new, with no wait", () => {
    const { next } = planAnnouncements([a], empty(), T0);
    forget(next, "a");
    expect(planAnnouncements([a], next, T0 + MIN).toAnnounce).toEqual([a]);
  });

  it("without leaves the original alone and drops only the given ids", () => {
    const { next } = planAnnouncements([a, b], empty(), T0);
    const partial = without(next, ["b"]);
    expect(Object.keys(next.announced)).toEqual(["a", "b"]);
    expect(planAnnouncements([a, b], partial, T0 + MIN).toAnnounce).toEqual([b]);
  });
});

// Alert ids are keys in the state. "__proto__" on an ordinary object is never stored (#96).
// Each case runs the same path as tick(): plan, save to disk, load, plan again.
describe("alert ids that are object-property names", () => {
  for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "lmm:alert:12345"]) {
    it(`announces an alert with id ${id} once, not again on the next poll`, async () => {
      const alerts = [makeAlert({ id })];
      const file = join(await mkdtemp(join(tmpdir(), "blw-")), "state.json");
      const first = planAnnouncements(alerts, empty(), T0);
      expect(first.toAnnounce).toHaveLength(1);
      await saveState(file, without(first.next, []));
      const loaded = (await loadState(file)) as State;
      expect(planAnnouncements(alerts, loaded, T0 + MIN).toAnnounce).toEqual([]);
    });
  }

  it("an alert never seen before is new even when its id is an inherited property name", () => {
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect(planAnnouncements([makeAlert({ id })], empty(), T0).toAnnounce).toHaveLength(1);
    }
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
