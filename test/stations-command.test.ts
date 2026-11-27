import { describe, expect, it } from "vitest";
import { checkRiderMessage, MAX_CHARS } from "../src/safety.js";
import { smsSegments } from "../src/sms.js";
import { answerStationsCommand, parseStationsCommand } from "../src/stations-command.js";
import { MAX_STATIONS, STATION_CHOICES } from "../src/stations.js";
import { makeAlert } from "./helpers.js";

describe("parseStationsCommand (#49)", () => {
  it("reads STATIONS in English and ESTACIONES in Spanish, in any case", () => {
    expect(parseStationsCommand("STATIONS")).toEqual({ lang: "en", action: "show" });
    expect(parseStationsCommand("  stations \n")).toEqual({ lang: "en", action: "show" });
    expect(parseStationsCommand("Estaciones")).toEqual({ lang: "es", action: "show" });
  });

  it("reads a list of names to set", () => {
    expect(parseStationsCommand("STATIONS 149 St-Grand Concourse, Fordham Rd")).toEqual({
      lang: "en",
      action: "set",
      names: ["149 St-Grand Concourse", "Fordham Rd"],
    });
    expect(parseStationsCommand("estaciones: Parkchester; E 180 St\nWoodlawn")).toEqual({
      lang: "es",
      action: "set",
      names: ["Parkchester", "E 180 St", "Woodlawn"],
    });
  });

  it("reads ALL / TODAS as clear", () => {
    expect(parseStationsCommand("STATIONS ALL")).toEqual({ lang: "en", action: "clear" });
    expect(parseStationsCommand("ESTACIONES TODAS")).toEqual({ lang: "es", action: "clear" });
    expect(parseStationsCommand("estaciones todas ")).toEqual({ lang: "es", action: "clear" });
  });

  it("ignores texts that aren't the command", () => {
    for (const body of ["BRONX", "ESPANOL", "STOP", "", "my stations are", "STATIONSX Fordham Rd", "station Fordham Rd"]) {
      expect(parseStationsCommand(body)).toBeNull();
    }
  });
});

describe("answerStationsCommand (#49)", () => {
  const answer = (body: string, current?: string[]) => answerStationsCommand(parseStationsCommand(body)!, current);

  it("shows the current stations with their exact MTA names, or how to pick some", () => {
    expect(answer("STATIONS", ["407", "608"]).reply).toContain("your stations: Fordham Rd (4), Parkchester (6).");
    expect(answer("ESTACIONES", ["407"]).reply).toContain("tus estaciones: Fordham Rd (4).");
    expect(answer("STATIONS").reply).toContain("every station on your lines");
    expect(answer("ESTACIONES", []).reply).toContain("todas las estaciones de tus líneas");
    expect(answer("STATIONS", ["407"]).stations).toBeUndefined(); // showing changes nothing
  });

  it("saves a list and confirms with the exact MTA names", () => {
    const r = answer("STATIONS 149 St-Grand Concourse, fordham road 4");
    expect(r.stations).toEqual(["222", "415", "407"]); // both sides of the 149 St complex
    expect(r.reply).toContain("149 St-Hostos (2 4 5), Fordham Rd (4)");
  });

  it("keeps station names in English in the Spanish reply", () => {
    const r = answer("ESTACIONES Bedford Park Blvd D, Yankee Stadium");
    expect(r.stations).toEqual(["D03", "414", "D11"]);
    expect(r.reply).toMatch(/^Bronx Line Watch: guardado\. Vas a recibir alertas de: Bedford Park Blvd \(B D\), 161 St-Yankee Stadium \(4 B D\)\./);
  });

  it("clears the list", () => {
    expect(answer("STATIONS ALL", ["407"])).toEqual({ reply: expect.stringContaining("every station on your lines"), stations: null });
    expect(answer("ESTACIONES TODAS", ["407"]).stations).toBeNull();
  });

  it("doesn't promise every Bronx station: a rider's line choices still apply", () => {
    for (const body of ["STATIONS", "STATIONS ALL", "ESTACIONES", "ESTACIONES TODAS"]) {
      expect(answer(body).reply).not.toMatch(/every Bronx station|todas las estaciones del Bronx/);
    }
  });

  it("saves nothing if any name is unknown or not in the Bronx", () => {
    const r = answer("STATIONS Parkchester, Times Sq-42 St");
    expect(r.stations).toBeUndefined();
    expect(r.reply).toContain("nothing changed");
    expect(r.reply).toContain("station #2");
    expect(answer("ESTACIONES Astor Pl").reply).toContain("no cambiamos nada");
  });

  it("answers odd input with the unknown-station reply instead of crashing", () => {
    const r = answer("STATIONS Parkchester constructor");
    expect(r.stations).toBeUndefined();
    expect(r.reply).toContain("nothing changed");
  });

  it("asks which station when a name fits more than one", () => {
    const r = answer("STATIONS Fordham Rd");
    expect(r.stations).toBeUndefined();
    expect(r.reply).toContain("Fordham Rd (4), Fordham Rd (B D)");
  });

  it(`saves nothing past ${MAX_STATIONS} stations, and counts a repeated station once`, () => {
    const six = "STATIONS Woodlawn, Mosholu Pkwy, Kingsbridge Rd 4, Fordham Rd 4, 183 St, Burnside Av";
    expect(answer(six).stations).toBeUndefined();
    expect(answer(six).reply).toContain("up to 5");
    expect(answer("STATIONS Woodlawn, woodlawn, Woodlawn (4)").stations).toEqual(["401"]);
  });

  it("never copies what the rider typed into the reply", () => {
    // Anyone can text this number, so a reply must not carry a stranger's words or links.
    const planted = "evil-example.top/claim";
    for (const body of [
      `STATIONS ${planted}`,
      `STATIONS Parkchester, ${planted}`,
      `ESTACIONES Fordham Rd ${planted}`,
      `STATIONS ${"Woodlawn, ".repeat(8)}${planted}`,
    ]) {
      const { reply, stations } = answer(body);
      expect(reply).not.toContain("evil");
      expect(reply).not.toContain(".top");
      expect(stations).toBeUndefined();
    }
  });

  it("writes replies that pass the rider safety check and fit in a few segments", () => {
    // The worst case for length: the five longest station labels.
    const longest = [...STATION_CHOICES].sort((a, b) => b.label.length - a.label.length).slice(0, MAX_STATIONS);
    const ids = longest.flatMap((c) => c.stopIds);
    const names = longest.map((c) => c.label).join(", ");
    const bodies = ["STATIONS", "STATIONS ALL", `STATIONS ${names}`, "STATIONS Nowhere", "STATIONS 149 St", "STATIONS a,b,c,d,e,f"];
    for (const body of [...bodies, ...bodies.map((b) => b.replace("STATIONS", "ESTACIONES").replace("ALL", "TODAS"))]) {
      for (const current of [undefined, ids]) {
        const { reply } = answer(body, current);
        expect(reply.length, reply).toBeLessThanOrEqual(MAX_CHARS);
        expect(smsSegments(reply).segments, reply).toBeLessThanOrEqual(5);
        // Every safety rule except one: checkRiderMessage also wants the alert's line named,
        // and a command reply is not about an alert. How replies are checked before they are
        // sent is decided with the webhook (#16).
        const problems = checkRiderMessage({ en: reply, es: reply }, makeAlert({ routes: ["4"] }))
          .filter((p) => !p.endsWith("doesn't name the affected line"));
        expect(problems, reply).toEqual([]);
      }
    }
  });
});
