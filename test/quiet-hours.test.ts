import { describe, expect, it } from "vitest";
import { isQuietHours, shouldSendSms } from "../src/quiet-hours.js";
import { makeAlert } from "./helpers.js";

// Each time is written with New York's UTC offset that day, so the tests mean the same thing
// on a laptop in New York and on a server in UTC. Winter is EST (-05:00), summer is EDT (-04:00).
const seasons = {
  winter: "2026-01-15T{t}:00-05:00",
  summer: "2026-07-15T{t}:00-04:00",
};

describe("isQuietHours", () => {
  for (const [season, template] of Object.entries(seasons)) {
    const at = (t: string) => new Date(template.replace("{t}", t));

    it(`${season}: 10:59 PM is not quiet`, () => expect(isQuietHours(at("22:59"))).toBe(false));
    it(`${season}: 11:00 PM is quiet`, () => expect(isQuietHours(at("23:00"))).toBe(true));
    it(`${season}: midnight is quiet`, () => expect(isQuietHours(at("00:00"))).toBe(true));
    it(`${season}: 4:59 AM is quiet`, () => expect(isQuietHours(at("04:59"))).toBe(true));
    it(`${season}: 5:00 AM is not quiet`, () => expect(isQuietHours(at("05:00"))).toBe(false));
  }

  it("uses New York time, not UTC", () => {
    // 03:30 UTC in July is 11:30 PM the evening before in New York.
    expect(isQuietHours(new Date("2026-07-16T03:30:00Z"))).toBe(true);
    // 12:00 UTC is 8 AM in New York.
    expect(isQuietHours(new Date("2026-07-16T12:00:00Z"))).toBe(false);
  });
});

describe("shouldSendSms", () => {
  const night = new Date("2026-01-15T02:00:00-05:00");
  const day = new Date("2026-01-15T14:00:00-05:00");

  it("texts any alert during the day", () => {
    expect(shouldSendSms(makeAlert({ type: "Delays" }), day)).toBe(true);
  });

  it("holds back ordinary alerts at night", () => {
    expect(shouldSendSms(makeAlert({ type: "Delays" }), night)).toBe(false);
    expect(shouldSendSms(makeAlert({ type: "Reduced Service" }), night)).toBe(false);
  });

  it("still texts suspensions at night", () => {
    expect(shouldSendSms(makeAlert({ type: "Suspended" }), night)).toBe(true);
    expect(shouldSendSms(makeAlert({ type: "Part Suspended" }), night)).toBe(true);
  });
});
