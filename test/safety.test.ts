import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

const alert = makeAlert({ routes: ["4"] });
const good = {
  en: "[4] trains are delayed both ways after police activity at 149 St. Allow extra time.",
  es: "Los trenes [4] van con retrasos en ambas direcciones por actividad policial en 149 St.",
};

describe("checkRiderMessage", () => {
  it("passes a normal message", () => {
    expect(checkRiderMessage(good, alert)).toEqual([]);
  });

  it("ignores station abbreviations that look like domains", () => {
    expect(checkRiderMessage({ ...good, en: "[4] skips Mt Eden Av. and 170 St. today." }, alert)).toEqual([]);
  });

  it("blocks links to anywhere but the MTA", () => {
    const evil = { ...good, en: "[4] delayed. Free MetroCards at free-metrocard.xyz/claim" };
    expect(checkRiderMessage(evil, alert)).toContainEqual(expect.stringContaining("free-metrocard.xyz"));
    const mta = { ...good, en: "[4] delayed. Details: https://new.mta.info/alerts" };
    expect(checkRiderMessage(mta, alert)).toEqual([]);
  });

  it("blocks messages that are too long or empty", () => {
    expect(checkRiderMessage({ ...good, en: "[4] " + "x".repeat(400) }, alert).length).toBeGreaterThan(0);
    expect(checkRiderMessage({ ...good, es: "  " }, alert).length).toBeGreaterThan(0);
  });

  // #18: carriers bill per segment, and Spanish accents force UCS-2 (70 characters per segment).
  it("blocks a Spanish message that would cost more than 3 SMS segments", () => {
    // 246 characters with accents: under MAX_CHARS, but 4 UCS-2 segments.
    const es =
      "Los trenes [4] van con retrasos en ambas direcciones por actividad policial en 149 St-Grand Concourse. " +
      "Si puedes, toma el [2] o el [5] en la estaci\u00F3n m\u00E1s cercana. Sal con m\u00E1s tiempo de lo normal hoy, " +
      "porque los andenes est\u00E1n llenos y hay demoras.";
    expect(es.length).toBeLessThanOrEqual(320);
    expect(checkRiderMessage({ ...good, es }, alert)).toContainEqual(
      expect.stringMatching(/^es: \d+ SMS segments in UCS-2 \(max 3\)$/),
    );
  });

  it("passes a short Spanish message with accents", () => {
    const es = "Los trenes [4] van con retrasos por actividad policial en 149 St. Sal con m\u00E1s tiempo.";
    expect(checkRiderMessage({ ...good, es }, alert)).toEqual([]);
  });

  it("allows exactly 3 segments but not 4", () => {
    // UCS-2: 3 segments hold up to 201 characters, 202 needs a fourth.
    const pad = (n: number) => "[4] Est\u00E1n demorados. " + "a".repeat(n - "[4] Est\u00E1n demorados. ".length);
    expect(checkRiderMessage({ ...good, es: pad(201) }, alert)).toEqual([]);
    expect(checkRiderMessage({ ...good, es: pad(202) }, alert)).toContainEqual(
      expect.stringContaining("4 SMS segments"),
    );
  });

  it("blocks messages that don't name the affected line", () => {
    expect(checkRiderMessage({ ...good, en: "Trains are delayed." }, alert)).toContainEqual(
      expect.stringContaining("line"),
    );
  });

  it("doesn't confuse [4] with [45] or 14 St", () => {
    expect(checkRiderMessage({ ...good, en: "Service at 14 St is normal." }, alert).length).toBeGreaterThan(0);
  });
});

// Links a prompt-injected MTA alert might try to sneak into a rider text.
describe("checkRiderMessage vs. injected links", () => {
  const blocked = (en: string) => checkRiderMessage({ ...good, en }, alert);

  it("blocks userinfo tricks that start with an allowed host", () => {
    expect(blocked("[4] delayed. https://new.mta.info@evil.com/claim")).toContainEqual(
      expect.stringContaining("evil.com"),
    );
  });

  it("blocks lookalike hosts that only start with mta.info", () => {
    expect(blocked("[4] delayed. Info: mta.info.evil.com")).toContainEqual(
      expect.stringContaining("mta.info.evil.com"),
    );
  });

  it("blocks links in upper case", () => {
    expect(blocked("[4] delayed. FREE-METROCARD.XYZ")).toContainEqual(expect.stringContaining("free-metrocard.xyz"));
  });

  it("blocks a scheme link on any TLD", () => {
    expect(blocked("[4] delayed. https://mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
  });

  it("blocks links in the Spanish text too", () => {
    const evil = { ...good, es: "Los trenes [4] van con retrasos. Reembolsos en https://mta-refund.top/es" };
    expect(checkRiderMessage(evil, alert)).toContainEqual(expect.stringContaining("es: link to mta-refund.top"));
  });

  // Known gaps. `it.fails` keeps CI green while the gap exists and turns red once it is fixed:
  // when that happens, change these to plain `it`.
  it("blocks bare links on uncommon TLDs (#22)", () => {
    for (const en of [
      "[4] delayed. Claim your fare refund at mta-refund.top",
      "[4] delayed. Refunds: www.mta-refund.top",
      "[4] delayed. Details at mta-alerts.nyc",
    ]) {
      expect(blocked(en).length).toBeGreaterThan(0);
    }
  });

  it("doesn't mistake ordinary abbreviations for links", () => {
    for (const en of [
      "[4] skips Mt Eden Av. and 170 St. until 5 a.m. Monday.",
      "[4] runs local, e.g. at 149 St-Grand Concourse, until Jan. 5.",
      "[4] trains are delayed...Take the [2] or [5] instead.",
      "[4] service resumes at 6 p.m./7 p.m. on weekends.",
    ]) {
      expect(blocked(en)).toEqual([]);
    }
  });

  it.fails("blocks callback phone numbers - known gap, #23", () => {
    expect(blocked("[4] delayed. Call 718-555-0123 now for an OMNY fare refund.").length).toBeGreaterThan(0);
  });

  it.fails("blocks requests to reply with card details - known gap, #23", () => {
    expect(blocked("[4] delayed. Reply YES with your OMNY card number to get a refund.").length).toBeGreaterThan(0);
  });
});

// Link variants that don't fit the plain-ASCII `name.tld` shape. Non-ASCII characters are
// written as \u escapes so the file itself has no lookalike or invisible characters.
describe("checkRiderMessage vs. disguised links", () => {
  const blocked = (en: string) => checkRiderMessage({ ...good, en }, alert);

  // Regression guards: these are caught today and must stay caught.
  it("blocks email addresses and mailto links", () => {
    expect(blocked("[4] delayed. Email refunds@mta-help.top")).toContainEqual(expect.stringContaining("mta-help.top"));
    expect(blocked("[4] delayed. mailto:claims@mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
  });

  it("blocks t.me links and punycode hosts", () => {
    expect(blocked("[4] delayed. Updates at t.me/mta_refund")).toContainEqual(expect.stringContaining("t.me"));
    expect(blocked("[4] delayed. http://xn--mta-refund-abc.xn--p1ai/r").length).toBeGreaterThan(0);
  });

  // Disguised links (#38): hosts with non-ASCII letters, or IP addresses, never match the link
  // pattern at all - even with https:// in front.
  it("blocks a Cyrillic lookalike of mta.info (#38)", () => {
    expect(blocked("[4] delayed. Refunds at https://mt\u0430.info/refund").length).toBeGreaterThan(0);
  });

  it("blocks hosts with accented letters (#38)", () => {
    expect(blocked("[4] delayed. Reembolso en mta-reembols\u00f3.com").length).toBeGreaterThan(0);
  });

  it("blocks hosts with non-Latin letters (#38)", () => {
    expect(blocked("[4] delayed. Info: \u043c\u0442\u0430.com").length).toBeGreaterThan(0);
  });

  it("blocks IP-address links (#38)", () => {
    expect(blocked("[4] delayed. http://203.0.113.7/r").length).toBeGreaterThan(0);
  });

  it("blocks links written with a fullwidth dot (#38)", () => {
    expect(blocked("[4] delayed. mta-refund\uff0ecom").length).toBeGreaterThan(0);
  });

  it("blocks hosts containing combining marks (#38)", () => {
    expect(blocked("[4] delayed. mta\u0327.info").length).toBeGreaterThan(0);
    expect(blocked("[4] delayed. mta.info\uFE0F.top").length).toBeGreaterThan(0);
  });

  // Known gap (#39): Telegram turns @handles in plain text into tappable links.
  it.fails("blocks Telegram @username mentions - known gap, #39", () => {
    expect(blocked("[4] delayed. Claim a fare refund from @mta_refund_bot").length).toBeGreaterThan(0);
  });

  it("still passes normal Spanish: accents, \u00BF \u00A1, curly quotes, dashes, a.m. (#38)", () => {
    const es = "\u00BFVas al Bronx? Los trenes [4] van con retraso. \u00A1Sal con tiempo! Pr\u00F3ximo a las 11:30 a.m. en 161 St\u2013Yankee Stadium. \u201COjo\u201D: and\u00E9n cerrado\u2026";
    expect(checkRiderMessage({ ...good, es }, alert)).toEqual([]);
  });

  it("allows the real MTA site, even with a fullwidth dot (#38)", () => {
    expect(blocked("[4] delayed. Details: https://new.mta.info/alerts")).toEqual([]);
    expect(blocked("[4] delayed. Details: new\uFF0Emta\uFF0Einfo")).toEqual([]);
  });

  it("blocks a link hidden with invisible characters (#38)", () => {
    expect(blocked("[4] delayed. mta-refund\u200B.top").length).toBeGreaterThan(0);
  });

  it("doesn't flag an @ used as 'at' before a station", () => {
    expect(blocked("[4] trains skip 138 St @ Grand Concourse.")).toEqual([]);
  });
});
