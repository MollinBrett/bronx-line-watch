import { describe, expect, it } from "vitest";
import { isQuietHours, shouldSendSms, textSubscribers } from "../src/quiet-hours.js";
import type { Subscriber } from "../src/sms.js";
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

describe("textSubscribers", () => {
  const subs: Subscriber[] = [
    { phone: "+17185550101", lang: "en" },
    { phone: "+17185550102", lang: "es" },
    { phone: "+17185550103", lang: "en" },
  ];

  // A fake clock that starts at the given New York time and moves forward one second per text,
  // like a slow Twilio request would. Records who got texted, in order.
  function fakeSend(start: string) {
    let t = new Date(start).getTime();
    const texted: string[] = [];
    return {
      texted,
      now: () => new Date(t),
      send: async (sub: Subscriber) => {
        texted.push(sub.phone);
        t += 1000;
      },
    };
  }

  it("texts everyone during the day", async () => {
    const f = fakeSend("2026-01-15T14:00:00-05:00");
    expect(await textSubscribers(makeAlert(), subs, f.send, f.now)).toEqual({ heldBack: 0 });
    expect(f.texted).toEqual(["+17185550101", "+17185550102", "+17185550103"]);
  });

  it("stops the moment quiet hours begin partway through the list", async () => {
    // First text at 10:59:59 PM; the clock reaches 11:00:00 PM before the second one.
    const f = fakeSend("2026-01-15T22:59:59-05:00");
    expect(await textSubscribers(makeAlert({ type: "Delays" }), subs, f.send, f.now)).toEqual({ heldBack: 2 });
    expect(f.texted).toEqual(["+17185550101"]);
  });

  it("keeps texting a suspension across 11 PM", async () => {
    const f = fakeSend("2026-01-15T22:59:59-05:00");
    expect(await textSubscribers(makeAlert({ type: "Suspended" }), subs, f.send, f.now)).toEqual({ heldBack: 0 });
    expect(f.texted).toHaveLength(3);
  });

  it("texts nobody at night for an ordinary alert", async () => {
    const f = fakeSend("2026-01-15T02:00:00-05:00");
    expect(await textSubscribers(makeAlert({ type: "Delays" }), subs, f.send, f.now)).toEqual({ heldBack: 3 });
    expect(f.texted).toEqual([]);
  });

  it("skips riders who only asked for other lines, and doesn't count them as held back", async () => {
    const f = fakeSend("2026-01-15T14:00:00-05:00");
    const dRider: Subscriber = { phone: "+17185550104", lang: "en", lines: ["D"] };
    expect(await textSubscribers(makeAlert({ routes: ["4"] }), [...subs, dRider], f.send, f.now)).toEqual({ heldBack: 0 });
    expect(f.texted).not.toContain(dRider.phone);

    const night = fakeSend("2026-01-15T02:00:00-05:00");
    expect(await textSubscribers(makeAlert({ routes: ["4"] }), [...subs, dRider], night.send, night.now)).toEqual({ heldBack: 3 });
  });
});
