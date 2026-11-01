import { afterEach, describe, expect, it, vi } from "vitest";
import { postToTelegram, telegramConfigFromEnv, telegramPosts } from "../src/telegram.js";

const msg = { en: "[4] delayed.", es: "[4] con retraso." };

describe("telegramConfigFromEnv", () => {
  it("is off without a token or channel", () => {
    expect(telegramConfigFromEnv({})).toBeNull();
    expect(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "t" })).toBeNull();
  });

  it("uses one channel for both languages when only one is set", () => {
    expect(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHANNEL_EN: "@blw" })).toEqual({
      botToken: "t",
      channelEn: "@blw",
      channelEs: "@blw",
    });
  });
});

describe("telegramPosts", () => {
  it("combines both languages in a shared channel", () => {
    const posts = telegramPosts({ botToken: "t", channelEn: "@blw", channelEs: "@blw" }, msg);
    expect(posts).toEqual([{ chatId: "@blw", text: "[4] delayed.\n\nES: [4] con retraso." }]);
  });

  it("posts each language to its own channel", () => {
    const posts = telegramPosts({ botToken: "t", channelEn: "@en", channelEs: "@es" }, msg);
    expect(posts).toEqual([
      { chatId: "@en", text: msg.en },
      { chatId: "@es", text: msg.es },
    ]);
  });
});

describe("postToTelegram", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends plain text with no parse mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await postToTelegram({ botToken: "SECRET", channelEn: "@en", channelEs: "@en" }, "@en", "hi");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({ chat_id: "@en", text: "hi" });
    expect(body.parse_mode).toBeUndefined();
  });

  it("never puts the bot token in error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"description":"Forbidden: bot is not a member"}', { status: 403 })),
    );
    const err = await postToTelegram({ botToken: "SECRET", channelEn: "@en", channelEs: "@en" }, "@en", "hi").catch(
      (e: Error) => e,
    );
    expect(String(err)).toContain("bot is not a member");
    expect(String(err)).not.toContain("SECRET");
  });
});
