import { describe, expect, it } from "vitest";
import { parseSubscribers, smsSegments } from "../src/sms.js";

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
});
