import { describe, expect, it } from "vitest";
import { parseSubscribers, smsSegments, wantsAlert } from "../src/sms.js";

describe("smsSegments", () => {
  it("fits plain English in GSM-7", () => {
    expect(smsSegments("[4] trains are delayed.")).toEqual({ encoding: "GSM-7", segments: 1 });
    expect(smsSegments("a".repeat(161)).segments).toBe(2);
  });

  it("counts brackets as two characters", () => {
    expect(smsSegments("[".repeat(80)).segments).toBe(1);
    expect(smsSegments("[".repeat(81)).segments).toBe(2);
  });

  it("switches to UCS-2 for Spanish accents like ó", () => {
    const r = smsSegments("Próximo tren en dirección norte");
    expect(r.encoding).toBe("UCS-2");
    expect(smsSegments("ó".repeat(71)).segments).toBe(2);
  });

  it("keeps ñ and é in GSM-7", () => {
    expect(smsSegments("Mañana el tren é").encoding).toBe("GSM-7");
  });
});

describe("parseSubscribers", () => {
  it("parses phone:language pairs", () => {
    expect(parseSubscribers("+17185550100:es, +13475550199")).toEqual([
      { phone: "+17185550100", lang: "es" },
      { phone: "+13475550199", lang: "en" },
    ]);
    expect(parseSubscribers(undefined)).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => parseSubscribers("7185550100:es")).toThrow();
    expect(() => parseSubscribers("+17185550100:fr")).toThrow();
  });

  it("parses an optional list of lines, mixed with entries that have none", () => {
    expect(parseSubscribers("+17185550100:es:4,5, +13475550199:en,+13475550142:en:d")).toEqual([
      { phone: "+17185550100", lang: "es", lines: ["4", "5"] },
      { phone: "+13475550199", lang: "en" },
      { phone: "+13475550142", lang: "en", lines: ["D"] },
    ]);
  });

  it("rejects lines that aren't Bronx lines, without echoing the phone number", () => {
    expect(() => parseSubscribers("+17185550100:es:4,L")).toThrow(/entry #1.*"L"/);
    expect(() => parseSubscribers("+17185550100:es:4,L")).not.toThrow(/7185550100/);
    expect(() => parseSubscribers("+17185550100:es:")).toThrow(); // empty list is a typo, not "all"
    expect(() => parseSubscribers("+17185550100:es:4:5")).toThrow(/too many/);
  });
});

describe("wantsAlert", () => {
  const all = { phone: "+17185550100", lang: "en" as const };
  const dRider = { ...all, lines: ["D"] };

  it("sends everything to subscribers who didn't pick lines", () => {
    expect(wantsAlert(all, ["6"])).toBe(true);
  });

  it("sends only alerts on a subscriber's lines", () => {
    expect(wantsAlert(dRider, ["6"])).toBe(false);
    expect(wantsAlert(dRider, ["B", "D"])).toBe(true);
    expect(wantsAlert(dRider, [])).toBe(false);
  });
});
