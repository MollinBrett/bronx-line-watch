// The circuit breaker (#56), tested through the real src/main.ts.
//
// Each run() below is what production does: one process start and one poll (--once). The MTA
// feed, Telegram, Twilio and Claude are fakes, so every Claude call, post and text the watcher
// tries to make is seen here. A second run() is a restart: main.ts is loaded again from
// nothing, and all it knows is what is in the state file.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  /** Like the SDK's: `status` is set when the API answered with an error, undefined when the connection failed. */
  class APIError extends Error {
    status: number | undefined;
    constructor(status: number | undefined, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { parse: vi.fn(), retrieve: vi.fn(), APIError };
});
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static APIError = sdk.APIError;
    beta = { messages: { parse: sdk.parse } };
    models = { retrieve: sdk.retrieve };
  }
  return { default: Anthropic };
});

const disk = vi.hoisted(() => ({ full: false }));
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return {
    ...real,
    writeFile: (async (...a: Parameters<typeof real.writeFile>) => {
      if (disk.full) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      return real.writeFile(...a);
    }) as typeof real.writeFile,
  };
});

const ADMIN = "-1001234567890";
const T0 = Date.parse("2026-11-19T14:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** What the watcher tried to send, in order. */
let sent: { via: "telegram" | "sms"; to: string; text: string }[] = [];
let feed: string[] = [];
let telegramDown = false;
let twilioDown = false;
/** Called just before each text would reach Twilio, with how many went out before it. Throw to stop it. */
let beforeText: ((alreadySent: number) => void) | null = null;
let stateFile = "";
const touched = new Set<string>();
const savedArgv = process.argv;

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    touched.add(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** One process start and one poll. */
async function run(): Promise<void> {
  vi.resetModules();
  await import("../src/main.js");
}

/** A minute passes, and the watcher polls a feed holding these alerts. */
async function pollWith(...ids: string[]): Promise<void> {
  feed = ids;
  vi.setSystemTime(Date.now() + MINUTE);
  await run();
}

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
const state = () => JSON.parse(readFileSync(stateFile, "utf8"));
const texts = () => sent.filter((s) => s.via === "sms");
const publicPosts = () => sent.filter((s) => s.via === "telegram" && s.to !== ADMIN);
const adminPosts = () => sent.filter((s) => s.to === ADMIN);
const toRiders = () => sent.filter((s) => s.to !== ADMIN);
const good = { stop_reason: "end_turn", parsed_output: { en: "[4] trains are delayed.", es: "[4] con retrasos." } };
const withLink = { stop_reason: "end_turn", parsed_output: { en: "[4] delayed. Refunds at mta-refund.top", es: "[4] con retrasos." } };

beforeEach(() => {
  sent = [];
  feed = [];
  telegramDown = false;
  twilioDown = false;
  beforeText = null;
  disk.full = false;
  sdk.parse.mockReset().mockResolvedValue(good);
  sdk.retrieve.mockReset().mockImplementation(async (model: string) => ({ id: model }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("api-endpoint.mta.info")) {
        const entity = feed.map((id) => ({
          id,
          alert: {
            informed_entity: [{ route_id: "4" }],
            header_text: { translation: [{ text: `[4] trains are delayed (${id}).`, language: "en" }] },
            "transit_realtime.mercury_alert": { alert_type: "Delays" },
          },
        }));
        return new Response(JSON.stringify({ entity }), { status: 200 });
      }
      if (u.includes("api.telegram.org")) {
        const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
        if (telegramDown) return new Response('{"description":"Bad Gateway"}', { status: 502 });
        sent.push({ via: "telegram", to: body.chat_id, text: body.text });
        return new Response("{}", { status: 200 });
      }
      if (u.includes("api.twilio.com")) {
        const body = init?.body as URLSearchParams;
        beforeText?.(texts().length);
        if (twilioDown) return new Response('{"message":"Internal Server Error"}', { status: 500 });
        sent.push({ via: "sms", to: body.get("To")!, text: body.get("Body")! });
        return new Response("{}", { status: 201 });
      }
      throw new Error(`unexpected request to ${u}`);
    }),
  );
  stateFile = join(mkdtempSync(join(tmpdir(), "blw-breaker-")), "state.json");
  process.argv = ["node", "src/main.ts", "--once"];
  setEnv({
    STATE_FILE: stateFile,
    ANTHROPIC_API_KEY: "test-key",
    TELEGRAM_BOT_TOKEN: "test-bot",
    TELEGRAM_CHANNEL_EN: "@blw_test_en",
    TELEGRAM_CHANNEL_ES: "@blw_test_es",
    TELEGRAM_CHANNEL_ADMIN: ADMIN,
    TWILIO_ACCOUNT_SID: "test-sid",
    TWILIO_AUTH_TOKEN: "test-auth",
    TWILIO_FROM_NUMBER: "+18885276698",
    SEND_SMS: "true",
    SMS_SUBSCRIBERS: "+17185550100:es,+13475550199:en",
    PAUSED: undefined,
    RESUME_AFTER_TRIP: undefined,
    POLL_SECONDS: undefined,
    MAX_ALERTS_PER_POLL: undefined,
    MAX_CLAUDE_CALLS_PER_HOUR: undefined,
    MAX_TEXTS_PER_HOUR: undefined,
    MAX_TEXTS_PER_DAY: undefined,
    MAX_SAFETY_BLOCKS_IN_A_ROW: undefined,
    CLAUDE_MODEL: undefined,
    CLAUDE_EFFORT: undefined,
  });
});

afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
  process.argv = savedArgv;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a normal day", () => {
  it("announces a new alert to both channels and every subscriber, and counts it", async () => {
    await pollWith("a"); // first run: remembers what is there, sends nothing
    expect(sent).toEqual([]);
    await pollWith("a", "b");
    expect(sdk.parse).toHaveBeenCalledTimes(1);
    expect(publicPosts().map((p) => p.to)).toEqual(["@blw_test_en", "@blw_test_es"]);
    expect(texts().map((t) => t.to)).toEqual(["+17185550100", "+13475550199"]);
    expect(adminPosts()).toEqual([]);
    const { breaker } = state();
    expect(breaker.tripped).toBeUndefined();
    expect(Object.values(breaker.claudeCalls)).toEqual([1]);
    expect(Object.values(breaker.texts)).toEqual([2]);
  });

  it("keeps the breaker's memory through polls with nothing new", async () => {
    await pollWith("a");
    await pollWith("a", "b");
    await pollWith("a", "b");
    await pollWith("a", "b");
    expect(Object.values(state().breaker.texts)).toEqual([2]);
  });

  // Measured on the English channel, Nov 12-19 2026: at most 12 alerts in an hour, 78 in 24 hours.
  it("does not trip on the busiest day measured, with the default limits", async () => {
    await pollWith("start");
    for (let i = 0; i < 12; i++) {
      later(4 * MINUTE);
      await pollWith(`busy-hour-${i}`); // 12 alerts in an hour
    }
    for (let i = 0; i < 66; i++) {
      later(19 * MINUTE);
      await pollWith(`rest-of-day-${i}`); // 66 more over the next 22 hours
    }
    expect(state().breaker.tripped).toBeUndefined();
    expect(texts()).toHaveLength(156); // 78 alerts to 2 subscribers
    expect(sdk.parse).toHaveBeenCalledTimes(78);
  });
});

describe("PAUSED", () => {
  it("makes no Claude call, post or text, and keeps polling and saving", async () => {
    await pollWith("a");
    setEnv({ PAUSED: "true" });
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
    expect(sdk.parse).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(Object.keys(state().announced).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not even check the Claude key at startup", async () => {
    setEnv({ PAUSED: "true" });
    await pollWith("a");
    expect(sdk.retrieve).not.toHaveBeenCalled();
    setEnv({ PAUSED: undefined });
    await pollWith("a");
    expect(sdk.retrieve).toHaveBeenCalledTimes(1);
  });

  it("sends no backlog when it is switched off again: only what is new after that", async () => {
    await pollWith("a");
    setEnv({ PAUSED: "true" });
    await pollWith("a", "b", "c");
    setEnv({ PAUSED: undefined });
    await pollWith("a", "b", "c");
    expect(sent).toEqual([]);
    await pollWith("a", "b", "c", "d");
    expect(sdk.parse).toHaveBeenCalledTimes(1);
    expect(texts()).toHaveLength(2);
  });

  it.each(["TRUE", " true ", "1", "yes", "on", "ture", "paused", "treu "])("treats PAUSED=%j as paused", async (value) => {
    await pollWith("a");
    setEnv({ PAUSED: value });
    await pollWith("a", "b");
    expect(sdk.parse).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it.each(["false", "FALSE", "0", "no", "off", "", "  "])("treats PAUSED=%j as running", async (value) => {
    await pollWith("a");
    setEnv({ PAUSED: value });
    await pollWith("a", "b");
    expect(texts()).toHaveLength(2);
  });
});

describe("texts per hour", () => {
  beforeEach(() => setEnv({ MAX_TEXTS_PER_HOUR: "4" }));

  it("trips before the alert that would pass the limit, and sends none of it to anyone", async () => {
    await pollWith("a");
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
    expect(texts()).toHaveLength(4); // at the limit, not over it
    expect(state().breaker.tripped).toBeUndefined();

    await pollWith("a", "b", "c", "d");
    expect(texts()).toHaveLength(4);
    expect(publicPosts()).toHaveLength(4); // nothing about "d" on Telegram either
    expect(state().breaker.tripped).toMatchObject({ reason: "texts-per-hour", count: 4, wanted: 2, limit: 4 });
  });

  it("stays tripped across restarts, with nothing sent and no Claude call", async () => {
    await pollWith("a");
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
    await pollWith("a", "b", "c", "d");
    const calls = sdk.parse.mock.calls.length;
    const before = sent.length;
    for (const next of ["e", "f", "g"]) await pollWith("a", "b", "c", "d", next);
    later(48 * HOUR); // the counts are long gone, the trip is not
    await pollWith("z");
    expect(sdk.parse).toHaveBeenCalledTimes(calls);
    expect(sent).toHaveLength(before);
    expect(state().breaker.tripped.reason).toBe("texts-per-hour");
  });

  it("lets texts through again once the hour has passed, if it never tripped", async () => {
    await pollWith("a");
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
    later(61 * MINUTE);
    await pollWith("a", "b", "c", "d");
    expect(texts()).toHaveLength(6);
    expect(state().breaker.tripped).toBeUndefined();
  });

  it("counts a text that Twilio refused: the limit is on what it tried to send", async () => {
    await pollWith("a");
    twilioDown = true;
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
    await pollWith("a", "b", "c", "d");
    expect(texts()).toEqual([]);
    expect(state().breaker.tripped).toMatchObject({ reason: "texts-per-hour", count: 4, wanted: 2 });
  });
});

describe("texts per day", () => {
  beforeEach(() => setEnv({ MAX_TEXTS_PER_HOUR: "4", MAX_TEXTS_PER_DAY: "6" }));

  it("trips on the daily limit even when no single hour is busy", async () => {
    await pollWith("a");
    for (const id of ["b", "c", "d"]) {
      later(2 * HOUR);
      await pollWith(id);
    }
    expect(texts()).toHaveLength(6);
    later(2 * HOUR);
    await pollWith("e");
    expect(texts()).toHaveLength(6);
    expect(state().breaker.tripped).toMatchObject({ reason: "texts-per-day", count: 6, wanted: 2, limit: 6 });
  });

  it("forgets texts older than a day", async () => {
    await pollWith("a");
    for (const id of ["b", "c", "d"]) {
      later(2 * HOUR);
      await pollWith(id);
    }
    later(26 * HOUR);
    await pollWith("e");
    expect(texts()).toHaveLength(8);
    expect(state().breaker.tripped).toBeUndefined();
  });
});

describe("Claude calls per hour", () => {
  beforeEach(() => setEnv({ MAX_CLAUDE_CALLS_PER_HOUR: "2" }));

  it("trips before the call that would pass the limit", async () => {
    await pollWith("a");
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
    await pollWith("a", "b", "c", "d");
    expect(sdk.parse).toHaveBeenCalledTimes(2);
    expect(texts()).toHaveLength(4);
    expect(state().breaker.tripped).toMatchObject({ reason: "claude-calls-per-hour", count: 2, limit: 2 });
  });

  it("trips part-way through one poll, and the alerts queued behind are never sent", async () => {
    await pollWith("a");
    await pollWith("a", "b", "c", "d", "e");
    expect(sdk.parse).toHaveBeenCalledTimes(2);
    expect(state().breaker.tripped.reason).toBe("claude-calls-per-hour");
    await pollWith("a", "b", "c", "d", "e");
    expect(sdk.parse).toHaveBeenCalledTimes(2);
    expect(texts()).toHaveLength(4);
  });

  it("puts each call on record before making it", async () => {
    await pollWith("a");
    let onDiskDuringCall: { breaker: { claudeCalls: Record<string, number> } } | undefined;
    sdk.parse.mockImplementation(async () => {
      onDiskDuringCall = state();
      return good;
    });
    await pollWith("a", "b");
    expect(Object.values(onDiskDuringCall!.breaker.claudeCalls)).toEqual([1]);
  });

  it("counts a call cut off by a crash, so a crash loop can't keep spending", async () => {
    await pollWith("a");
    for (let i = 0; i < 4; i++) {
      // Killed during the call: nothing after that point is saved, and the restart sees the
      // state file as it was then.
      let atKill = "";
      sdk.parse.mockImplementationOnce(async () => {
        atKill = readFileSync(stateFile, "utf8");
        throw new Error("killed");
      });
      await pollWith("a", "b");
      if (atKill) writeFileSync(stateFile, atKill);
    }
    expect(sdk.parse).toHaveBeenCalledTimes(2);
    expect(state().breaker.tripped).toMatchObject({ reason: "claude-calls-per-hour", count: 2 });
  });

  it("counts a call Claude answered with a refusal, which is billed and retried every poll", async () => {
    sdk.parse.mockResolvedValue({ stop_reason: "refusal", parsed_output: null });
    await pollWith("a");
    for (let i = 0; i < 4; i++) await pollWith("a", "b");
    expect(sdk.parse).toHaveBeenCalledTimes(2);
    expect(state().breaker.tripped.reason).toBe("claude-calls-per-hour");
    expect(toRiders()).toEqual([]);
  });

  it("does not count a call the API turned away, so an outage at Anthropic doesn't trip it", async () => {
    sdk.parse.mockRejectedValue(new sdk.APIError(529, "Overloaded"));
    await pollWith("a");
    for (let i = 0; i < 10; i++) await pollWith("a", "b");
    expect(sdk.parse).toHaveBeenCalledTimes(10);
    expect(state().breaker.tripped).toBeUndefined();
    sdk.parse.mockResolvedValue(good);
    await pollWith("a", "b");
    expect(texts()).toHaveLength(2);
  });

  it.each([
    ["a dropped connection", () => new sdk.APIError(undefined, "Connection error.")],
    ["an answer that didn't parse", () => new Error("Failed to parse structured output")],
  ])("counts a call that ended in %s, since it may have been billed", async (_what, error) => {
    sdk.parse.mockRejectedValue(error());
    await pollWith("a");
    for (let i = 0; i < 4; i++) await pollWith("a", "b");
    expect(sdk.parse).toHaveBeenCalledTimes(2);
    expect(state().breaker.tripped.reason).toBe("claude-calls-per-hour");
  });
});

describe("safety blocks in a row", () => {
  beforeEach(() => setEnv({ MAX_SAFETY_BLOCKS_IN_A_ROW: "2" }));

  it("trips when that many messages in a row are blocked", async () => {
    sdk.parse.mockResolvedValue(withLink);
    await pollWith("a");
    await pollWith("a", "b");
    expect(state().breaker.tripped).toBeUndefined();
    await pollWith("a", "b", "c");
    expect(state().breaker.tripped).toMatchObject({ reason: "safety-blocks", count: 2, limit: 2 });
    expect(toRiders()).toEqual([]);
  });

  it("starts counting again after a message that passes", async () => {
    await pollWith("a");
    sdk.parse.mockResolvedValueOnce(withLink);
    await pollWith("a", "b");
    await pollWith("a", "b", "c"); // passes
    sdk.parse.mockResolvedValueOnce(withLink);
    await pollWith("a", "b", "c", "d");
    expect(state().breaker.tripped).toBeUndefined();
    expect(state().breaker.safetyBlocks).toBe(1);
  });

  it("remembers the count across a restart", async () => {
    sdk.parse.mockResolvedValue(withLink);
    await pollWith("a");
    await pollWith("a", "b");
    expect(state().breaker.safetyBlocks).toBe(1);
    await pollWith("a", "b"); // a poll with nothing new must not lose it
    await pollWith("a", "b", "c");
    expect(state().breaker.tripped.reason).toBe("safety-blocks");
  });
});

describe("telling the operators", () => {
  beforeEach(() => setEnv({ MAX_TEXTS_PER_HOUR: "2" }));
  const trip = async () => {
    await pollWith("a");
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
  };

  it("posts once to the private chat, never to the public channels, with the numbers and the resume code", async () => {
    await trip();
    expect(adminPosts()).toHaveLength(1);
    const { text } = adminPosts()[0]!;
    const code = String(state().breaker.tripped.at);
    expect(text).toContain("2 texts in the last hour and 2 more about to go out; the limit is 2");
    expect(text).toContain(`set RESUME_AFTER_TRIP to ${code} and choose Save and deploy`);
    expect(publicPosts().every((p) => !p.text.includes("RESUME_AFTER_TRIP"))).toBe(true);
    expect(publicPosts()).toHaveLength(2); // alert "b" only
    await pollWith("a", "b", "c");
    await pollWith("a", "b", "c");
    expect(adminPosts()).toHaveLength(1);
    expect(state().breaker.tripped.alerted).toBe(true);
  });

  it("keeps trying on later polls when Telegram is down, then stops once it gets through", async () => {
    await pollWith("a");
    await pollWith("a", "b");
    telegramDown = true;
    await pollWith("a", "b", "c");
    await pollWith("a", "b", "c");
    expect(adminPosts()).toEqual([]);
    expect(state().breaker.tripped).toMatchObject({ alerted: false, alertTries: 2 });
    telegramDown = false;
    await pollWith("a", "b", "c");
    await pollWith("a", "b", "c");
    expect(adminPosts()).toHaveLength(1);
  });

  it("gives up on the alert after 30 tries, and stays paused", async () => {
    await pollWith("a");
    await pollWith("a", "b");
    telegramDown = true;
    for (let i = 0; i < 40; i++) await pollWith("a", "b", "c");
    expect(state().breaker.tripped).toMatchObject({ alerted: false, alertTries: 30 });
    telegramDown = false;
    await pollWith("a", "b", "c");
    expect(adminPosts()).toEqual([]);
    expect(texts()).toHaveLength(2);
  });

  it("still pauses when there is no private chat to tell", async () => {
    setEnv({ TELEGRAM_CHANNEL_ADMIN: undefined });
    await trip();
    await pollWith("a", "b", "c", "d");
    expect(state().breaker.tripped.reason).toBe("texts-per-hour");
    expect(texts()).toHaveLength(2);
    expect(sent.filter((s) => s.text.includes("RESUME_AFTER_TRIP"))).toEqual([]);
  });

  it("works when only texting is set up, with no public channel", async () => {
    setEnv({ TELEGRAM_CHANNEL_EN: undefined, TELEGRAM_CHANNEL_ES: undefined });
    await trip();
    expect(sent.filter((s) => s.via === "telegram").map((s) => s.to)).toEqual([ADMIN]);
  });

  it("refuses to start with a public channel as the private chat", async () => {
    setEnv({ TELEGRAM_CHANNEL_ADMIN: "@blw_test_en" });
    await expect(run()).rejects.toThrow(/TELEGRAM_CHANNEL_ADMIN/);
    setEnv({ TELEGRAM_CHANNEL_ADMIN: "-100123", TELEGRAM_CHANNEL_EN: "-100123" });
    await expect(run()).rejects.toThrow(/TELEGRAM_CHANNEL_ADMIN/);
  });
});

describe("resuming", () => {
  beforeEach(() => setEnv({ MAX_TEXTS_PER_HOUR: "2" }));
  const trip = async () => {
    await pollWith("a");
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
    return String(state().breaker.tripped.at);
  };

  it("resumes when RESUME_AFTER_TRIP holds that trip's code, counts from zero, and sends no backlog", async () => {
    const code = await trip();
    await pollWith("a", "b", "c", "d"); // still paused; "d" arrives meanwhile
    setEnv({ RESUME_AFTER_TRIP: code });
    await pollWith("a", "b", "c", "d");
    expect(state().breaker.tripped).toBeUndefined();
    expect(texts()).toHaveLength(2); // "c" and "d" are not sent afterwards
    await pollWith("a", "b", "c", "d", "e");
    expect(texts()).toHaveLength(4);
  });

  it.each(["1", "true", "yes", "0", "resume"])("does not resume on RESUME_AFTER_TRIP=%j", async (value) => {
    await trip();
    setEnv({ RESUME_AFTER_TRIP: value });
    await pollWith("a", "b", "c", "d");
    expect(state().breaker.tripped.reason).toBe("texts-per-hour");
    expect(texts()).toHaveLength(2);
  });

  it("a code left in place does not resume a later trip", async () => {
    const first = await trip();
    setEnv({ RESUME_AFTER_TRIP: first });
    await pollWith("a", "b", "c");
    await pollWith("a", "b", "c", "d"); // 2 texts
    await pollWith("a", "b", "c", "d", "e"); // would be 4: trips again
    const second = String(state().breaker.tripped.at);
    expect(second).not.toBe(first);
    await pollWith("a", "b", "c", "d", "e", "f");
    await pollWith("a", "b", "c", "d", "e", "f");
    expect(state().breaker.tripped.at).toBe(Number(second));
    expect(texts()).toHaveLength(4);
    expect(adminPosts()).toHaveLength(2);
  });

  it("PAUSED still holds after a resume", async () => {
    const code = await trip();
    setEnv({ RESUME_AFTER_TRIP: code, PAUSED: "true" });
    await pollWith("a", "b", "c", "d");
    await pollWith("a", "b", "c", "d", "e");
    expect(state().breaker.tripped).toBeUndefined();
    expect(texts()).toHaveLength(2);
  });
});

describe("when the breaker's own machinery fails", () => {
  it("treats memory it can't read as tripped, and can be resumed from that", async () => {
    await pollWith("a");
    writeFileSync(stateFile, JSON.stringify({ ...state(), breaker: { tripped: "no", texts: -5 } }));
    await pollWith("a", "b");
    expect(toRiders()).toEqual([]);
    expect(sdk.parse).not.toHaveBeenCalled();
    expect(state().breaker.tripped.reason).toBe("unreadable-memory");
    expect(adminPosts()).toHaveLength(1);
    setEnv({ RESUME_AFTER_TRIP: String(state().breaker.tripped.at) });
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
    expect(texts()).toHaveLength(2);
  });

  it("starts fresh from a state file written before the breaker existed", async () => {
    writeFileSync(stateFile, JSON.stringify({ announced: {} }));
    await pollWith("a");
    expect(texts()).toHaveLength(2);
    expect(state().breaker.tripped).toBeUndefined();
  });

  it("spends and sends nothing while the state file can't be written", async () => {
    await pollWith("a");
    disk.full = true;
    await pollWith("a", "b");
    await pollWith("a", "b");
    expect(sdk.parse).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    disk.full = false;
    await pollWith("a", "b");
    expect(texts()).toHaveLength(2);
  });

  it("does not send an alert twice when the process dies part-way through sending it", async () => {
    await pollWith("a");
    // The first text goes out, then the process is killed before the second. A killed process
    // saves nothing more, so the restart sees the state file as it was at that moment.
    let onDiskAtKill = "";
    beforeText = (alreadySent) => {
      if (alreadySent !== 1) return;
      onDiskAtKill = readFileSync(stateFile, "utf8");
      throw new Error("killed");
    };
    await pollWith("a", "b");
    expect(texts()).toHaveLength(1);
    beforeText = null;
    writeFileSync(stateFile, onDiskAtKill);

    await pollWith("a", "b");
    await pollWith("a", "b");
    expect(texts()).toHaveLength(1); // the rider who got it does not get it again
    expect(sdk.parse).toHaveBeenCalledTimes(1);
    // Both texts were on record before the first one left, so a crash loop can't hide them.
    expect(Object.values(JSON.parse(onDiskAtKill).breaker.texts)).toEqual([2]);
  });
});

describe("settings", () => {
  it("holds alerts over MAX_ALERTS_PER_POLL for the next poll, without tripping", async () => {
    setEnv({ MAX_ALERTS_PER_POLL: "2" });
    await pollWith("a");
    await pollWith("a", "b", "c", "d");
    expect(sdk.parse).toHaveBeenCalledTimes(2);
    await pollWith("a", "b", "c", "d");
    expect(sdk.parse).toHaveBeenCalledTimes(3);
    expect(state().breaker.tripped).toBeUndefined();
  });

  it("by default allows 24 texts an hour per subscriber", async () => {
    await pollWith("a");
    for (let i = 0; i < 24; i++) await pollWith(`n${i}`);
    expect(texts()).toHaveLength(48);
    expect(state().breaker.tripped).toBeUndefined();
    await pollWith("one-too-many");
    expect(texts()).toHaveLength(48);
    expect(state().breaker.tripped).toMatchObject({ reason: "texts-per-hour", count: 48, limit: 48 });
  });

  it.each([
    ["MAX_TEXTS_PER_HOUR", "0"],
    ["MAX_TEXTS_PER_HOUR", "-1"],
    ["MAX_TEXTS_PER_DAY", "lots"],
    ["MAX_CLAUDE_CALLS_PER_HOUR", "1e3"],
    ["MAX_SAFETY_BLOCKS_IN_A_ROW", "2.5"],
    ["MAX_ALERTS_PER_POLL", "none"],
    ["POLL_SECONDS", "0"],
    ["POLL_SECONDS", "60s"],
    ["POLL_SECONDS", "1"],
  ])("refuses to start with %s=%j", async (name, value) => {
    setEnv({ [name]: value });
    await expect(run()).rejects.toThrow(name);
    expect(sent).toEqual([]);
  });
});

describe("a dry run", () => {
  it("counts its Claude calls and sends nothing, not even to the operators", async () => {
    process.argv = ["node", "src/main.ts", "--once", "--dry-run"];
    setEnv({ MAX_CLAUDE_CALLS_PER_HOUR: "1" });
    await pollWith("a");
    await pollWith("a", "b");
    await pollWith("a", "b", "c");
    expect(sdk.parse).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    expect(state().breaker.tripped.reason).toBe("claude-calls-per-hour");
  });
});
