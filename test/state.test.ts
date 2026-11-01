import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadState, planAnnouncements, saveState } from "../src/state.js";
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
