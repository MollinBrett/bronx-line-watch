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

// Link forms that aren't a plain "https://name.tld": other URL schemes, encoded or numeric hosts,
// and dot lookalikes that NFKC folds. All caught today; these guard against a future refactor of
// the normalization or the scheme check. Non-ASCII written as \u escapes.
describe("checkRiderMessage vs. unusual link encodings", () => {
  const blocked = (en: string) => checkRiderMessage({ ...good, en }, alert);

  it("blocks app-opening schemes (Telegram tg://, Android intent://)", () => {
    expect(blocked("[4] delayed. Refunds: tg://resolve?domain=mta_refund_bot").length).toBeGreaterThan(0);
    expect(blocked("[4] delayed. intent://mta-refund#Intent;scheme=https;end").length).toBeGreaterThan(0);
  });

  it("blocks numeric, hex, IPv6 and percent-encoded hosts", () => {
    expect(blocked("[4] delayed. http://3405803783/r")).toContainEqual(expect.stringContaining("203.0.113.7"));
    expect(blocked("[4] delayed. http://0xcb.0.0x71.7/r")).toContainEqual(expect.stringContaining("203.0.113.7"));
    expect(blocked("[4] delayed. http://[2001:db8::1]/r").length).toBeGreaterThan(0);
    expect(blocked("[4] delayed. https://mta%2Erefund%2Etop/").length).toBeGreaterThan(0);
  });

  it("blocks malformed scheme links that browsers still open", () => {
    expect(blocked("[4] delayed. https:mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
    expect(blocked("[4] delayed. https:/\\mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
    expect(blocked("[4] delayed. //mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
  });

  it("blocks an allowed host used as userinfo with a port", () => {
    expect(blocked("[4] delayed. https://new.mta.info:8443@203.0.113.7")).toContainEqual(expect.stringContaining("203.0.113.7"));
  });

  it("blocks dots that NFKC folds: halfwidth, vertical, small, one-dot-leader", () => {
    for (const dot of ["\uFF61", "\uFE12", "\uFE52", "\u2024"]) {
      expect(blocked(`[4] delayed. mta-refund${dot}top`)).toContainEqual(expect.stringContaining("mta-refund.top"));
    }
    expect(blocked("[4] delayed. 203\uFF0E0\uFF0E113\uFF0E7")).toContainEqual(expect.stringContaining("203.0.113.7"));
  });

  it("blocks fullwidth letters and Unicode hyphens in a host", () => {
    expect(blocked("[4] delayed. \uFF4D\uFF54\uFF41-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
    expect(blocked("[4] delayed. mta\u2010refund.top").length).toBeGreaterThan(0);
    expect(blocked("[4] delayed. https://mta\u2011refund.top").length).toBeGreaterThan(0);
  });

  it("blocks chat invite links", () => {
    expect(blocked("[4] delayed. https://t.me/+AbCdEf")).toContainEqual(expect.stringContaining("t.me"));
    expect(blocked("[4] delayed. https://wa.me/message/ABC")).toContainEqual(expect.stringContaining("wa.me"));
  });
});

// Invisible format characters and feed route IDs (#51, #52). Non-ASCII written as \u escapes.
describe("checkRiderMessage vs. invisible characters and odd route IDs", () => {
  const blocked = (en: string) => checkRiderMessage({ ...good, en }, alert);

  // Regression guards: caught today, must stay caught.
  it("blocks a scheme link with a bidi mark before the ://", () => {
    expect(blocked("[4] delayed. https\u200E://mta-refund.top/r")).toContainEqual(expect.stringContaining("mta-refund.top"));
  });

  it("blocks a host padded with a Hangul filler", () => {
    expect(blocked("[4] delayed. Refunds: mta-refund\u3164.top").length).toBeGreaterThan(0);
  });

  // Known gap (#51): invisible format characters split the host so no link is seen,
  // though the rider still reads "mta-refund.top".
  it.fails("blocks links hidden with bidi marks and other invisible characters - known gap, #51", () => {
    for (const ch of ["\u200E", "\u200F", "\u202A", "\u202E", "\u2066", "\u2069", "\u2061", "\u061C", "\u180E", "\u2800"]) {
      expect(blocked(`[4] delayed. Refunds: mta-refund${ch}.top`).length).toBeGreaterThan(0);
    }
  });

  // Known gap (#52): route IDs from the feed are put into a RegExp unescaped.
  it.fails("does not throw on a route ID with regex characters - known gap, #52", () => {
    // No line named, so the check reaches the "(" route instead of stopping at "4".
    const msg = { en: "Trains are delayed.", es: "Los trenes van con retraso." };
    expect(() => checkRiderMessage(msg, makeAlert({ routes: ["4", "("] }))).not.toThrow();
  });

  it.fails("a route ID of a single dot does not bypass the line-name check - known gap, #52", () => {
    const msg = { en: "Trains are delayed.", es: "Los trenes van con retraso." };
    expect(checkRiderMessage(msg, makeAlert({ routes: ["."] })).length).toBeGreaterThan(0);
  });
});

// A second link glued onto an allowed link's path (#62). The link patterns treat everything after
// "mta.info/" up to the next space as path, but phones end a URL at characters like " | < \ and
// make the rest a separate link. Non-ASCII written as \u escapes.
describe("checkRiderMessage vs. links glued onto an MTA link", () => {
  const blocked = (en: string) => checkRiderMessage({ ...good, en }, alert);

  // Regression guards: caught today, must stay caught.
  it("blocks a host glued onto mta.info when there is no path", () => {
    expect(blocked('[4] delayed. Details: mta.info"mta-refund.top')).toContainEqual(expect.stringContaining("mta-refund.top"));
  });

  it("blocks a lookalike host in the path of an allowed link", () => {
    expect(blocked("[4] delayed. Details: https://new.mta.info/r/mt\u0430.info").length).toBeGreaterThan(0);
  });

  // Known gap (#62): the second link is swallowed as the first link's path.
  it.fails("blocks a link glued onto an mta.info path - known gap, #62", () => {
    for (const en of [
      '[4] delayed. Details: https://new.mta.info/"https://mta-refund.top/claim',
      "[4] delayed. Details: https://new.mta.info/|https://203.0.113.7/r",
      '[4] delayed. Details: mta.info/"mta-refund.top',
      "[4] delayed. Details: mta.info/<mta-refund.top",
      "[4] delayed. Details: mta.info/\\mta-refund.top",
      "[4] delayed. Details: mta.info/\u201Cmta-refund.top",
    ]) {
      expect(blocked(en).length).toBeGreaterThan(0);
    }
  });
});
