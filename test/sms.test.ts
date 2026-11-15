import { describe, expect, it } from "vitest";
import {
  parseSubscribers,
  plainPunctuation,
  smsSegments,
  twilioConfigFromEnv,
  wantsAlert,
} from "../src/sms.js";

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

describe("plainPunctuation (#18)", () => {
  it("swaps curly quotes and long dashes for plain ones, one for one", () => {
    const curly = "It\u2019s the \u2018local\u2019 \u201C[4]\u201D \u2013 Burnside Av\u2014167 St";
    const plain = plainPunctuation(curly);
    expect(plain).toBe("It's the 'local' \"[4]\" - Burnside Av-167 St");
    expect(plain.length).toBe(curly.length);
  });

  it("turns a curly-apostrophe English text back into GSM-7", () => {
    const text = "[4] It\u2019s running every 16 min.";
    expect(smsSegments(text).encoding).toBe("UCS-2");
    expect(smsSegments(plainPunctuation(text)).encoding).toBe("GSM-7");
  });

  it("leaves Spanish accents and punctuation alone", () => {
    const es = "[4] \u00BFVas a la 170? Est\u00E1 cerrada. \u00A1Sal con tiempo!";
    expect(plainPunctuation(es)).toBe(es);
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
    expect(() => parseSubscribers("+17185550100:es:4,L")).toThrow(/entry #1.*aren't Bronx lines/);
    expect(() => parseSubscribers("+17185550100:es:4,L")).not.toThrow(/7185550100/);
    expect(() => parseSubscribers("+17185550100:es:")).toThrow(); // empty list is a typo, not "all"
    expect(() => parseSubscribers("+17185550100:es:4:5")).toThrow(/too many/);
  });

  it("doesn't expose raw invalid tokens in errors", () => {
    const raw = "+17185550100:es:4,13475550199";
    expect(() => parseSubscribers(raw)).toThrow(/entry #1.*aren't Bronx lines/);
    expect(() => parseSubscribers(raw)).not.toThrow(/13475550199/);
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

describe("twilioConfigFromEnv (#67)", () => {
  const twilio = { TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+18885550100" };

  it("texts only when SEND_SMS is exactly \"true\"", () => {
    expect(twilioConfigFromEnv({ ...twilio, SEND_SMS: "true" })).toEqual({
      accountSid: "AC_test",
      authToken: "t",
      from: "+18885550100",
    });
  });

  it("doesn't text with Twilio settings alone, as on a laptop with a .env", () => {
    expect(twilioConfigFromEnv(twilio)).toBeNull();
    expect(twilioConfigFromEnv({ ...twilio, SEND_SMS: "1" })).toBeNull();
    expect(twilioConfigFromEnv({ ...twilio, SEND_SMS: "TRUE" })).toBeNull();
  });

  it("doesn't text with SEND_SMS but missing Twilio settings", () => {
    expect(twilioConfigFromEnv({ SEND_SMS: "true" })).toBeNull();
  });
});
