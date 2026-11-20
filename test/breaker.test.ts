import { describe, expect, it } from "vitest";
import {
  allowClaudeCall,
  allowTexts,
  breakerSettingsFromEnv,
  claudeCallNotBilled,
  freshBreaker,
  pausedBy,
  pollSecondsFromEnv,
  recordSafetyCheck,
  restoreBreaker,
  resumeCode,
  textsNotSent,
  tripMessage,
  tripReason,
  tripTime,
  type Caps,
  type Trip,
} from "../src/breaker.js";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

const MIN = 60;
const HOUR = 60 * MIN;
const T0 = 1_763_561_580; // 2026-11-19 14:13:00 UTC, the start of a minute
const caps: Caps = { claudeCallsPerHour: 3, textsPerHour: 10, textsPerDay: 25, safetyBlocksInARow: 3 };
const viaDisk = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe("pausedBy", () => {
  it.each([undefined, "", "  ", "false", "False", "0", "no", "off", " OFF "])("%j leaves the watcher running", (raw) => {
    expect(pausedBy(raw)).toBeNull();
  });

  it.each(["true", "TRUE", " true ", "1", "yes", "on"])("%j pauses it", (raw) => {
    expect(pausedBy(raw)).toBe("PAUSED is set");
  });

  it.each(["ture", "paused", "y", "enable", "tru e", "2", "null", "undefined", "false!"])(
    "%j is not a clear off, so it pauses too",
    (raw) => {
      expect(pausedBy(raw)).toMatch(/counts as true/);
    },
  );
});

describe("breakerSettingsFromEnv", () => {
  it("has defaults, with text limits that grow with the number of subscribers", () => {
    expect(breakerSettingsFromEnv(7, {})).toEqual({
      paused: null,
      resumeCode: null,
      alertsPerPoll: 5,
      claudeCallsPerHour: 30,
      textsPerHour: 7 * 24,
      textsPerDay: 7 * 120,
      safetyBlocksInARow: 3,
    });
  });

  it("never defaults a text limit to zero", () => {
    expect(breakerSettingsFromEnv(0, {})).toMatchObject({ textsPerHour: 24, textsPerDay: 120 });
  });

  it("reads each setting; a set text limit is a total, not per subscriber", () => {
    const env = {
      PAUSED: "true",
      RESUME_AFTER_TRIP: " 1763561580 ",
      MAX_ALERTS_PER_POLL: "2",
      MAX_CLAUDE_CALLS_PER_HOUR: "9",
      MAX_TEXTS_PER_HOUR: " 40 ",
      MAX_TEXTS_PER_DAY: "100",
      MAX_SAFETY_BLOCKS_IN_A_ROW: "4",
    };
    expect(breakerSettingsFromEnv(50, env)).toEqual({
      paused: "PAUSED is set",
      resumeCode: "1763561580",
      alertsPerPoll: 2,
      claudeCallsPerHour: 9,
      textsPerHour: 40,
      textsPerDay: 100,
      safetyBlocksInARow: 4,
    });
  });

  it("treats a blank setting as not set", () => {
    const blank = { PAUSED: "", RESUME_AFTER_TRIP: " ", MAX_TEXTS_PER_HOUR: "", MAX_CLAUDE_CALLS_PER_HOUR: "  " };
    expect(breakerSettingsFromEnv(1, blank)).toEqual(breakerSettingsFromEnv(1, {}));
  });

  it.each(["0", "-3", "2.5", "1e3", "ten", "5 per hour", "Infinity", "0x10", "1234567890"])(
    "refuses %j as a limit instead of guessing",
    (raw) => {
      for (const name of ["MAX_ALERTS_PER_POLL", "MAX_CLAUDE_CALLS_PER_HOUR", "MAX_TEXTS_PER_HOUR", "MAX_TEXTS_PER_DAY", "MAX_SAFETY_BLOCKS_IN_A_ROW"]) {
        expect(() => breakerSettingsFromEnv(1, { [name]: raw })).toThrow(name);
      }
    },
  );
});

describe("pollSecondsFromEnv", () => {
  it("defaults to a minute when unset or blank", () => {
    expect(pollSecondsFromEnv(undefined)).toBe(60);
    expect(pollSecondsFromEnv("")).toBe(60);
    expect(pollSecondsFromEnv("  ")).toBe(60);
  });

  it("accepts 10 seconds or more", () => {
    expect(pollSecondsFromEnv("10")).toBe(10);
    expect(pollSecondsFromEnv(" 90 ")).toBe(90);
    expect(pollSecondsFromEnv("30.5")).toBe(30.5);
  });

  it.each(["0", "1", "9.9", "-60", "60s", "a minute", "NaN", "Infinity", "3601", "1e12", "2200000"])("refuses %j: it would poll in a tight loop", (raw) => {
    expect(() => pollSecondsFromEnv(raw)).toThrow("POLL_SECONDS");
  });
});

describe("Claude calls per hour", () => {
  it("allows calls up to the limit, then trips and refuses", () => {
    const b = freshBreaker();
    for (let i = 0; i < 3; i++) expect(allowClaudeCall(b, caps, T0 + i * MIN)).toBe(true);
    expect(b.tripped).toBeUndefined();
    expect(allowClaudeCall(b, caps, T0 + 3 * MIN)).toBe(false);
    expect(b.tripped).toEqual({
      at: T0 + 3 * MIN,
      reason: "claude-calls-per-hour",
      count: 3,
      wanted: 1,
      limit: 3,
      alerted: false,
      alertTries: 0,
    });
  });

  it("is a rolling hour: a call stops counting between 60 and 61 minutes later", () => {
    const b = freshBreaker();
    for (let i = 0; i < 3; i++) allowClaudeCall(b, caps, T0);
    expect(allowClaudeCall(structuredClone(b), caps, T0 + 60 * MIN + 59)).toBe(false); // 60:59 later
    expect(allowClaudeCall(structuredClone(b), caps, T0 + 61 * MIN)).toBe(true);
  });

  it("does not let a burst straddle the top of the clock hour", () => {
    const b = freshBreaker();
    const topOfHour = Math.ceil(T0 / HOUR) * HOUR;
    for (let i = 0; i < 3; i++) expect(allowClaudeCall(b, caps, topOfHour - 30)).toBe(true);
    expect(allowClaudeCall(b, caps, topOfHour + 30)).toBe(false);
  });

  it("takes back a call the API turned away, and never goes below zero", () => {
    const b = freshBreaker();
    allowClaudeCall(b, caps, T0);
    claudeCallNotBilled(b, T0);
    claudeCallNotBilled(b, T0);
    for (let i = 0; i < 3; i++) expect(allowClaudeCall(b, caps, T0)).toBe(true);
    expect(allowClaudeCall(b, caps, T0)).toBe(false);
  });

  it("keeps a bounded number of buckets however long it runs", () => {
    const b = freshBreaker();
    const roomy = { ...caps, claudeCallsPerHour: 1_000_000, textsPerHour: 1_000_000, textsPerDay: 1_000_000 };
    for (let t = T0; t < T0 + 72 * HOUR; t += MIN) {
      allowClaudeCall(b, roomy, t);
      allowTexts(b, roomy, 1, t);
    }
    // The window (61 and 25 buckets) plus one: old buckets are dropped before the new one is added.
    expect(Object.keys(b.claudeCalls).length).toBeLessThanOrEqual(62);
    expect(Object.keys(b.texts).length).toBeLessThanOrEqual(62);
    expect(Object.keys(b.textsByHour).length).toBeLessThanOrEqual(26);
  });
});

describe("texts per hour and per day", () => {
  it("counts an alert's texts together: all of them fit, or the breaker trips and none may go", () => {
    const b = freshBreaker();
    expect(allowTexts(b, caps, 6, T0)).toBe(true);
    expect(allowTexts(b, caps, 5, T0 + MIN)).toBe(false); // 6 + 5 > 10
    expect(b.tripped).toMatchObject({ reason: "texts-per-hour", count: 6, wanted: 5, limit: 10, at: T0 + MIN });
  });

  it("allows exactly the limit", () => {
    const b = freshBreaker();
    expect(allowTexts(b, caps, 10, T0)).toBe(true);
    expect(b.tripped).toBeUndefined();
    expect(allowTexts(b, caps, 1, T0 + 59 * MIN)).toBe(false);
  });

  it("an alert with no one to text always fits", () => {
    const b = freshBreaker();
    allowTexts(b, caps, 10, T0);
    expect(allowTexts(b, caps, 0, T0)).toBe(true);
    expect(b.tripped).toBeUndefined();
  });

  it("trips on the day's total even when every hour is quiet", () => {
    const b = freshBreaker();
    for (let h = 0; h < 5; h++) expect(allowTexts(b, caps, 5, T0 + h * 2 * HOUR)).toBe(true); // 25 in 8 hours
    expect(allowTexts(b, caps, 1, T0 + 10 * HOUR)).toBe(false);
    expect(b.tripped).toMatchObject({ reason: "texts-per-day", count: 25, wanted: 1, limit: 25 });
  });

  it("is a rolling day: a text stops counting between 24 and 25 hours later", () => {
    const b = freshBreaker();
    for (let h = 0; h < 5; h++) allowTexts(b, caps, 5, T0 + h * 2 * HOUR);
    expect(allowTexts(structuredClone(b), caps, 5, T0 + 24 * HOUR)).toBe(false);
    expect(allowTexts(structuredClone(b), caps, 5, T0 + 25 * HOUR)).toBe(true);
  });

  it("still counts a bucket dated in the future, after the clock goes back", () => {
    const b = freshBreaker();
    allowTexts(b, caps, 10, T0 + 3 * HOUR);
    expect(allowTexts(b, caps, 1, T0)).toBe(false);
  });

  it("a clock that jumps ahead for one poll does not wipe out what was really sent", () => {
    const b = freshBreaker();
    allowTexts(b, caps, 10, T0);
    expect(allowTexts(b, caps, 0, T0 + 2 * HOUR)).toBe(true); // one poll with the clock two hours ahead
    expect(allowTexts(b, caps, 1, T0 + 5 * MIN)).toBe(false); // the clock is right again: still at the limit
    const c = freshBreaker();
    for (let i = 0; i < 3; i++) allowClaudeCall(c, caps, T0);
    claudeCallNotBilled(c, T0 + 2 * HOUR);
    expect(allowClaudeCall(c, caps, T0 + 5 * MIN)).toBe(false);
  });

  it("takes back texts that were never sent", () => {
    const b = freshBreaker();
    allowTexts(b, caps, 10, T0);
    textsNotSent(b, 10, T0);
    expect(allowTexts(b, caps, 10, T0)).toBe(true);
    expect(b.tripped).toBeUndefined();
  });

  it("once tripped, refuses everything, and keeps the first reason", () => {
    const b = freshBreaker();
    allowTexts(b, caps, 11, T0);
    const first = structuredClone(b.tripped);
    expect(allowTexts(b, caps, 1, T0 + 2 * HOUR)).toBe(false);
    expect(allowTexts(b, caps, 0, T0 + 2 * HOUR)).toBe(false);
    expect(allowClaudeCall(b, caps, T0 + 2 * HOUR)).toBe(false);
    recordSafetyCheck(b, caps, true, T0 + 2 * HOUR);
    recordSafetyCheck(b, caps, true, T0 + 2 * HOUR);
    recordSafetyCheck(b, caps, true, T0 + 2 * HOUR);
    expect(b.tripped).toEqual(first);
  });
});

describe("safety blocks in a row", () => {
  it("trips at the limit", () => {
    const b = freshBreaker();
    recordSafetyCheck(b, caps, true, T0);
    recordSafetyCheck(b, caps, true, T0 + 1);
    expect(b.tripped).toBeUndefined();
    recordSafetyCheck(b, caps, true, T0 + 2);
    expect(b.tripped).toMatchObject({ reason: "safety-blocks", count: 3, limit: 3, at: T0 + 2 });
  });

  it("starts again from zero after one message passes", () => {
    const b = freshBreaker();
    for (const blocked of [true, true, false, true, true]) recordSafetyCheck(b, caps, blocked, T0);
    expect(b.tripped).toBeUndefined();
    expect(b.safetyBlocks).toBe(2);
  });
});

describe("restoreBreaker", () => {
  const tripped = () => {
    const b = freshBreaker();
    allowTexts(b, caps, 4, T0 - MIN);
    allowTexts(b, caps, 7, T0);
    return b;
  };

  it("starts fresh when nothing was saved", () => {
    expect(restoreBreaker(undefined, null, T0)).toEqual({ breaker: freshBreaker(), note: null });
  });

  it("brings back counts and a trip exactly as they were saved", () => {
    const b = tripped();
    expect(restoreBreaker(viaDisk(b), null, T0 + 9 * HOUR)).toEqual({ breaker: b, note: null });
  });

  it("stays tripped whatever RESUME_AFTER_TRIP says, unless it is that trip's code", () => {
    const b = tripped();
    for (const code of ["", "true", "1", "yes", String(T0 - 1), String(T0 + 1), `${T0} `, `0${T0}`]) {
      expect(restoreBreaker(viaDisk(b), code, T0 + HOUR).breaker.tripped).toEqual(b.tripped);
    }
  });

  it("resumes on that trip's code, with every count back at zero", () => {
    const b = tripped();
    const restored = restoreBreaker(viaDisk(b), resumeCode(b.tripped!), T0 + HOUR);
    expect(restored.breaker).toEqual(freshBreaker());
    expect(restored.note).toContain("resumed");
  });

  it("ignores a resume code when nothing is tripped", () => {
    const b = freshBreaker();
    allowTexts(b, caps, 4, T0);
    expect(restoreBreaker(viaDisk(b), String(T0), T0 + MIN)).toEqual({ breaker: b, note: null });
  });

  it.each([
    ["null", null],
    ["a string", "tripped"],
    ["an empty object", {}],
    ["a negative count", { ...freshBreaker(), texts: { "29392693": -5 } }],
    ["a count that is not a number", { ...freshBreaker(), claudeCalls: { "29392693": "many" } }],
    ["a bucket that is not a number", { ...freshBreaker(), texts: { yesterday: 5 } }],
    ["a trip with a reason this version doesn't know", { ...freshBreaker(), tripped: { at: T0, reason: "moon-phase", count: 1, wanted: 1, limit: 1, alerted: true, alertTries: 1 } }],
    ["a trip cut short", { ...freshBreaker(), tripped: { at: T0 } }],
    ["tripped set to false by hand", { ...freshBreaker(), tripped: false }],
  ])("treats memory it can't read (%s) as tripped, never as fine", (_what, saved) => {
    const { breaker, note } = restoreBreaker(viaDisk(saved), null, T0);
    expect(breaker.tripped).toMatchObject({ reason: "unreadable-memory", at: T0, alerted: false });
    expect(note).toContain("can't be read");
    expect(allowClaudeCall(breaker, caps, T0)).toBe(false);
    expect(allowTexts(breaker, caps, 1, T0)).toBe(false);
  });

  it("does not resume unreadable memory on a code, since there is no trip to match it against", () => {
    expect(restoreBreaker({ tripped: "yes" }, String(T0), T0).breaker.tripped?.reason).toBe("unreadable-memory");
  });
});

describe("the alert for the operators", () => {
  const trips: Trip[] = [
    { at: T0, reason: "texts-per-hour", count: 118, wanted: 6, limit: 120, alerted: false, alertTries: 0 },
    { at: T0, reason: "texts-per-day", count: 598, wanted: 10, limit: 600, alerted: false, alertTries: 0 },
    { at: T0, reason: "claude-calls-per-hour", count: 30, wanted: 1, limit: 30, alerted: false, alertTries: 0 },
    { at: T0, reason: "safety-blocks", count: 3, wanted: 0, limit: 3, alerted: false, alertTries: 0 },
    { at: T0, reason: "unreadable-memory", count: 0, wanted: 0, limit: 0, alerted: false, alertTries: 0 },
  ];

  it("says what tripped, with the numbers", () => {
    expect(trips.map(tripReason)).toEqual([
      "118 texts in the last hour and 6 more about to go out; the limit is 120",
      "598 texts in the last 24 hours and 10 more about to go out; the limit is 600",
      "30 Claude calls in the last hour; the limit is 30",
      "the safety check blocked 3 messages in a row; the limit is 3",
      "its record of what it has sent could not be read",
    ]);
  });

  it("gives the time in New York and the code to resume with", () => {
    expect(tripTime(trips[0]!)).toBe("Nov 19, 09:13 EST");
    expect(tripTime({ ...trips[0]!, at: Date.parse("2026-07-04T03:30:00Z") / 1000 })).toBe("Jul 3, 23:30 EDT");
    expect(resumeCode(trips[0]!)).toBe("1763561580");
    const text = tripMessage(trips[0]!);
    expect(text).toContain("paused itself on Nov 19, 09:13 EST");
    expect(text).toContain("Why: 118 texts in the last hour and 6 more about to go out; the limit is 120.");
    expect(text).toContain("set RESUME_AFTER_TRIP to 1763561580 and choose Save and deploy");
    expect(text).toContain("set PAUSED to true");
  });

  // This alert is sent without checkRiderMessage(), so it is checked here instead: the same
  // link detector must find nothing in it that a phone or Telegram would make tappable.
  it.each(trips)("has no link, markup or odd characters for $reason", (trip) => {
    const text = tripMessage(trip);
    const problems = checkRiderMessage({ en: text, es: text }, makeAlert()).filter((p) => /link|markup|unexpected/.test(p));
    expect(problems).toEqual([]);
    expect(text).not.toMatch(/[@#<>]|:\/\/|www/i);
    expect(text).toMatch(/^[\x20-\x7E\n]+$/); // plain ASCII
    expect(text.length).toBeLessThan(1000); // Telegram's limit is 4096
  });
});
