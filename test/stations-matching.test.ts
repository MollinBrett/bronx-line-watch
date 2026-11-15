import { describe, expect, it } from "vitest";
import { matchingCases } from "../evals/matching-cases.js";
import { parseSubscribers, wantsAlert, type Subscriber } from "../src/sms.js";
import { MAX_STATIONS, STATION_CHOICES, alertReachesStations, findStation } from "../src/stations.js";
import { makeAlert, sampleAlerts } from "./helpers.js";

const rider = (stations: string[], lines?: string[]): Subscriber => ({ phone: "+17185550100", lang: "en", stations, lines });

describe("wantsAlert with stations (#49)", () => {
  const fordham4 = rider(["407"]);

  it("sends an alert at a subscriber's station", () => {
    expect(wantsAlert(fordham4, makeAlert({ routes: ["4"], stops: ["406", "407"] }))).toBe(true);
  });

  it("doesn't send an alert that is only at other stations", () => {
    expect(wantsAlert(fordham4, makeAlert({ routes: ["4"], stops: ["414", "626"] }))).toBe(false);
  });

  it("sends a line-wide alert (no stops) on a line that serves their station", () => {
    expect(wantsAlert(fordham4, makeAlert({ routes: ["4"], stops: [] }))).toBe(true);
  });

  it("doesn't send a line-wide alert on another line", () => {
    expect(wantsAlert(fordham4, makeAlert({ routes: ["6"], stops: [] }))).toBe(false);
    expect(wantsAlert(fordham4, makeAlert({ routes: ["B", "D"], stops: [] }))).toBe(false); // Fordham Rd (B D) is a different station
  });

  it("treats the express [6X] as the [6] for line-wide alerts", () => {
    expect(wantsAlert(rider(["608"]), makeAlert({ routes: ["6X"], stops: [] }))).toBe(true);
  });

  it("treats a transfer complex as one station", () => {
    // 149 St-Hostos: 222 is the [2][5] side, 415 the [4] side.
    expect(wantsAlert(rider(["222"]), makeAlert({ routes: ["4"], stops: ["415"] }))).toBe(true);
    expect(wantsAlert(rider(["222"]), makeAlert({ routes: ["4"], stops: [] }))).toBe(true);
  });

  it("lets stations decide when a rider has both stations and lines", () => {
    const both = rider(["407"], ["6"]);
    expect(wantsAlert(both, makeAlert({ routes: ["4"], stops: ["407"] }))).toBe(true);
    expect(wantsAlert(both, makeAlert({ routes: ["6"], stops: [] }))).toBe(false);
  });

  it("keeps today's behavior for riders with no stations", () => {
    const everything: Subscriber = { phone: "+17185550100", lang: "en" };
    expect(wantsAlert(everything, makeAlert({ routes: ["6"], stops: ["626"] }))).toBe(true);
    expect(wantsAlert({ ...everything, stations: [] }, makeAlert({ routes: ["6"], stops: ["626"] }))).toBe(true);
    expect(wantsAlert({ ...everything, lines: ["D"] }, makeAlert({ routes: ["6"], stops: [] }))).toBe(false);
  });
});

describe("matching eval set: real alerts, hand-labeled (evals/matching-cases.ts)", () => {
  for (const c of matchingCases) {
    it(`${c.alertId}: ${c.summary}`, () => {
      const alert = sampleAlerts.find((a) => a.id === c.alertId);
      expect(alert, "alert is in the fixture").toBeDefined();
      for (const stop of c.reaches) expect(alertReachesStations(alert!, [stop]), `should reach ${stop}`).toBe(true);
      for (const stop of c.misses) expect(alertReachesStations(alert!, [stop]), `should not reach ${stop}`).toBe(false);
    });
  }
});

describe("parseSubscribers with stations (#49)", () => {
  it("parses stations after the lines field, which may be empty", () => {
    expect(parseSubscribers("+17185550100:es::405,d05, +13475550199:en:4:407,+13475550142")).toEqual([
      { phone: "+17185550100", lang: "es", stations: ["405", "D05"] },
      { phone: "+13475550199", lang: "en", stations: ["407"], lines: ["4"] },
      { phone: "+13475550142", lang: "en" },
    ]);
  });

  it("rejects station IDs that aren't Bronx stations on a covered line", () => {
    expect(() => parseSubscribers("+17185550100:en::626")).toThrow(/entry #1.*isn't a Bronx stop ID/); // 86 St, Manhattan
    expect(() => parseSubscribers("+17185550100:en::101")).toThrow(/entry #1/); // Bronx, but on the [1]
    expect(() => parseSubscribers("+17185550100:en::Fordham Rd")).toThrow(/entry #1/); // names aren't IDs
  });

  it(`rejects more than ${MAX_STATIONS} stations, counting a transfer complex once`, () => {
    expect(() => parseSubscribers("+17185550100:en::401,402,405,406,407,408")).toThrow(/entry #1.*more than 5/);
    // 222 and 415 are both 149 St-Hostos, so this is five stations.
    expect(parseSubscribers("+17185550100:en::222,415,401,402,405,406")[0]!.stations).toHaveLength(6);
  });

  it("keeps phone numbers and station lists out of error messages", () => {
    for (const raw of [
      "+17185550100:en::407,626",
      "+17185550100:en::401,402,405,406,407,408",
      "+17185550100:en:4:407:x",
      "+17185550100:fr::407", // bad language
      "+1718555010:en::407", // bad phone number (one digit short)
      "17185550100:en::407", // bad phone number (no +)
    ]) {
      let message = "";
      try {
        parseSubscribers(raw);
      } catch (err) {
        message = String(err);
      }
      expect(message).toMatch(/entry #1/);
      expect(message).not.toMatch(/718555/);
      expect(message).not.toMatch(/\b(407|626|401|402|405|406|408)\b/);
    }
  });
});

describe("findStation", () => {
  const found = (typed: string) => {
    const r = findStation(typed);
    return r.kind === "found" ? r.station.label : r.kind;
  };

  it("finds a station by its exact MTA name, in any case", () => {
    expect(found("Parkchester")).toBe("Parkchester (6)");
    expect(found("west farms sq-e tremont av")).toBe("West Farms Sq-E Tremont Av (2 5)");
    expect(found("Tremont Av")).toBe("Tremont Av (B D)"); // exact name beats "...-E Tremont Av"
  });

  it("understands spelled-out and partial names", () => {
    expect(found("East 180th Street")).toBe("E 180 St (2 5)");
    expect(found("Yankee Stadium")).toBe("161 St-Yankee Stadium (4 B D)");
    expect(found("Bedford Park Boulevard Lehman College")).toBe("Bedford Park Blvd-Lehman College (4)");
    expect(found("Mount Eden Avenue")).toBe("Mt Eden Av (4)");
    expect(found("St. Mary's")).toBe("E 143 St-St Mary's St (6)");
  });

  it("forgives a small typo in a name without numbers", () => {
    expect(found("Parkchestr")).toBe("Parkchester (6)");
    expect(found("Woodlwan")).toBe("Woodlawn (4)");
  });

  it("keeps a line the rider gave when forgiving a typo", () => {
    expect(found("Fordam Rd 4")).toBe("Fordham Rd (4)");
    expect(found("Fordam Rd D")).toBe("Fordham Rd (B D)");
    expect(found("Fordam Rd")).toBe("ambiguous");
    expect(found("Parkchester D")).toBe("unknown"); // Parkchester is on the [6] only
    expect(found("Parkchestr 6")).toBe("Parkchester (6)");
  });

  it("treats words like \"constructor\" as ordinary unknown words", () => {
    for (const word of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(found(word)).toBe("unknown");
      expect(found(`Parkchester ${word}`)).toBe("unknown");
    }
  });

  it("never guesses between numbered streets", () => {
    expect(found("171 St")).toBe("unknown"); // one digit from 170 St and 174 St
  });

  it("asks which one when stations share a name, and takes a line as the answer", () => {
    const r = findStation("Fordham Rd");
    expect(r.kind === "ambiguous" && r.options.map((o) => o.label)).toEqual(["Fordham Rd (4)", "Fordham Rd (B D)"]);
    expect(found("Fordham Rd 4")).toBe("Fordham Rd (4)");
    expect(found("Fordham Road D")).toBe("Fordham Rd (B D)");
    expect(found("Fordham Rd (B D)")).toBe("Fordham Rd (B D)"); // the label we send back works as input
    expect(found("Gun Hill Rd 2")).toBe("Gun Hill Rd (2 5)");
    expect(found("Gun Hill Rd 5")).toBe("Gun Hill Rd (5)"); // served only by the [5]
  });

  it("accepts every label we could send back", () => {
    for (const c of STATION_CHOICES) expect(found(c.label)).toBe(c.label);
  });

  it("knows the transfer complex under its old name too", () => {
    expect(found("149 St-Hostos")).toBe("149 St-Hostos (2 4 5)");
    expect(found("149 St-Grand Concourse")).toBe("149 St-Hostos (2 4 5)");
  });

  it("rejects unknown and non-Bronx stations", () => {
    expect(found("Times Sq-42 St")).toBe("unknown");
    expect(found("86 St")).toBe("unknown");
    expect(found("Astor Pl")).toBe("unknown");
    expect(found("238 St")).toBe("unknown"); // Bronx, but on the [1], which we don't cover
    expect(found("")).toBe("unknown");
    expect(found("!!!")).toBe("unknown");
  });
});
