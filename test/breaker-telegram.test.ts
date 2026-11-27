import { afterEach, describe, expect, it, vi } from "vitest";
import { adminChatFromEnv, postTripAlert } from "../src/telegram.js";
import { tripMessage, type Trip } from "../src/breaker.js";

const bot = { TELEGRAM_BOT_TOKEN: "t" };

describe("adminChatFromEnv", () => {
  it("is off when TELEGRAM_CHANNEL_ADMIN is not set or blank", () => {
    expect(adminChatFromEnv({ ...bot })).toBeNull();
    expect(adminChatFromEnv({ ...bot, TELEGRAM_CHANNEL_ADMIN: "  " })).toBeNull();
  });

  it("takes a numeric chat id: a private channel, a private group, or a person", () => {
    for (const id of ["-1001234567890", "-4567", "123456789"]) {
      expect(adminChatFromEnv({ ...bot, TELEGRAM_CHANNEL_ADMIN: ` ${id} ` })).toEqual({ botToken: "t", chatId: id });
    }
  });

  it("works without any public channel: texting alone still gets the alert", () => {
    expect(adminChatFromEnv({ ...bot, TELEGRAM_CHANNEL_ADMIN: "-1001" })).toEqual({ botToken: "t", chatId: "-1001" });
  });

  it.each(["@bronxlinewatch", "bronxlinewatch", "@-100123", "-100abc", "-100 123", "+100123", "1e5"])(
    "refuses %j: a name could be a public channel",
    (id) => {
      expect(() => adminChatFromEnv({ ...bot, TELEGRAM_CHANNEL_ADMIN: id })).toThrow("TELEGRAM_CHANNEL_ADMIN");
    },
  );

  it("refuses a chat that is also one of the public channels", () => {
    for (const which of ["TELEGRAM_CHANNEL_EN", "TELEGRAM_CHANNEL_ES"]) {
      expect(() => adminChatFromEnv({ ...bot, TELEGRAM_CHANNEL_ADMIN: "-1001", [which]: " -1001 " })).toThrow("public");
    }
  });

  it("refuses a chat with no bot to post to it", () => {
    expect(() => adminChatFromEnv({ TELEGRAM_CHANNEL_ADMIN: "-1001" })).toThrow("TELEGRAM_CHANNEL_ADMIN");
  });
});

describe("postTripAlert", () => {
  afterEach(() => vi.unstubAllGlobals());
  const trip: Trip = { at: 1_763_561_580, reason: "safety-blocks", count: 3, wanted: 0, limit: 3, alerted: false, alertTries: 0 };

  it("posts the fixed message for that trip to the private chat, as plain text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await postTripAlert({ botToken: "SECRET", chatId: "-1001" }, trip);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({ chat_id: "-1001", text: tripMessage(trip) });
    expect(body.parse_mode).toBeUndefined();
  });

  it("throws when Telegram refuses it, without the bot token in the error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"description":"Bad Request: chat not found"}', { status: 400 })));
    const err = await postTripAlert({ botToken: "SECRET", chatId: "-1001" }, trip).catch((e: Error) => e);
    expect(String(err)).toContain("chat not found");
    expect(String(err)).not.toContain("SECRET");
  });
});
