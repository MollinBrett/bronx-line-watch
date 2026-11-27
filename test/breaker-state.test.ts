import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, planAnnouncements, primed, type State } from "../src/state.js";
import { makeAlert } from "./helpers.js";

const MIN = 60;
const HOUR = 60 * MIN;
const T0 = 1_000_000;

// While the watcher is paused (#56) every poll calls primed() with the state it had: everything
// in the feed is marked as announced, nothing is sent, and what it already remembered is kept.
describe("primed with the previous state (a poll while paused)", () => {
  const a = makeAlert({ id: "a" });
  const b = makeAlert({ id: "b" });
  const before = (): State => planAnnouncements([a], { announced: {} }, T0).next;

  it("marks alerts that arrived during the pause as announced, so resuming sends no backlog", () => {
    const paused = primed([a, b], T0 + MIN, before());
    expect(planAnnouncements([a, b], paused, T0 + 2 * MIN).toAnnounce).toEqual([]);
  });

  it("marks a change made during the pause as announced too", () => {
    const changed = { ...a, header: "[4] trains are suspended." };
    const paused = primed([changed], T0 + HOUR, before());
    expect(planAnnouncements([changed], paused, T0 + HOUR + MIN).toAnnounce).toEqual([]);
  });

  it("still announces what is new after the pause", () => {
    const paused = primed([a], T0 + MIN, before());
    const c = makeAlert({ id: "c" });
    expect(planAnnouncements([a, c], paused, T0 + 2 * MIN).toAnnounce).toEqual([c]);
  });

  it("keeps remembering an alert that left the feed, for the same six hours", () => {
    let state = before();
    for (let t = T0 + MIN; t < T0 + 6 * HOUR; t += 30 * MIN) state = primed([], t, state);
    expect(Object.keys(state.announced)).toEqual(["a"]);
    expect(planAnnouncements([a], state, T0 + 6 * HOUR - 1).toAnnounce).toEqual([]);
    expect(Object.keys(primed([], T0 + 6 * HOUR, state).announced)).toEqual([]);
  });

  it("keeps when an alert was last sent, so a change is not announced sooner because of a pause", () => {
    const paused = primed([a], T0 + MIN, before());
    expect(paused.lastSent).toEqual({ a: T0 });
    const changed = { ...a, header: "[4] trains are suspended." };
    expect(planAnnouncements([changed], paused, T0 + 2 * MIN).toAnnounce).toEqual([]);
    expect(planAnnouncements([changed], paused, T0 + DEFAULT_LIMITS.minReannounceSeconds).toAnnounce).toEqual([changed]);
  });

  it("without a previous state it is the first run, exactly as before", () => {
    expect(primed([a, b], T0)).toEqual(primed([a, b], T0, undefined));
    expect(Object.keys(primed([a, b], T0).announced)).toEqual(["a", "b"]);
    expect(primed([a, b], T0).lastSent).toEqual({});
  });

  it("stores an alert id that is an object-property name (#96)", () => {
    const odd = makeAlert({ id: "__proto__" });
    const paused = primed([odd], T0 + MIN, before());
    expect(planAnnouncements([odd], JSON.parse(JSON.stringify(paused)), T0 + 2 * MIN).toAnnounce).toEqual([]);
  });
});
