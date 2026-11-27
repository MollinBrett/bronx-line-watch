import { tripMessage, type Trip } from "./breaker.js";
import type { RiderMessage } from "./rewrite.js";

/**
 * Posts alerts to public Telegram channels through a bot that is an admin of each channel.
 * Channels are "@username" for public channels, or the numeric id (-100...) for private ones.
 */
export interface TelegramConfig {
  botToken: string;
  /** Where English alerts go. */
  channelEn: string;
  /** Where Spanish alerts go. Same as channelEn = one channel with both languages per post. */
  channelEs: string;
}

export function telegramConfigFromEnv(env = process.env): TelegramConfig | null {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_EN, TELEGRAM_CHANNEL_ES } = env;
  if (!TELEGRAM_BOT_TOKEN || (!TELEGRAM_CHANNEL_EN && !TELEGRAM_CHANNEL_ES)) return null;
  const channelEn = TELEGRAM_CHANNEL_EN || TELEGRAM_CHANNEL_ES!;
  const channelEs = TELEGRAM_CHANNEL_ES || channelEn;
  return { botToken: TELEGRAM_BOT_TOKEN, channelEn, channelEs };
}

/** The posts to make for one alert: one per channel. */
export function telegramPosts(cfg: TelegramConfig, msg: RiderMessage): { chatId: string; text: string }[] {
  if (cfg.channelEn === cfg.channelEs) {
    return [{ chatId: cfg.channelEn, text: `${msg.en}\n\nES: ${msg.es}` }];
  }
  return [
    { chatId: cfg.channelEn, text: msg.en },
    { chatId: cfg.channelEs, text: msg.es },
  ];
}

/** The operators' private chat, where the watcher says that it has paused itself (#56). */
export interface AdminChat {
  botToken: string;
  chatId: string;
}

/**
 * TELEGRAM_CHANNEL_ADMIN, posted to by the same bot. It must be a numeric chat id: a public
 * channel is set by its @name, and this alert must never go to the public channels.
 */
export function adminChatFromEnv(env = process.env): AdminChat | null {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ADMIN, TELEGRAM_CHANNEL_EN, TELEGRAM_CHANNEL_ES } = env;
  const chatId = TELEGRAM_CHANNEL_ADMIN?.trim();
  if (!chatId) return null;
  if (!/^-?\d+$/.test(chatId)) {
    throw new Error("TELEGRAM_CHANNEL_ADMIN must be a numeric chat id (a private channel's starts with -100), not an @name");
  }
  if (chatId === TELEGRAM_CHANNEL_EN?.trim() || chatId === TELEGRAM_CHANNEL_ES?.trim()) {
    throw new Error("TELEGRAM_CHANNEL_ADMIN must not be one of the public channels");
  }
  if (!TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_CHANNEL_ADMIN is set, but there is no bot to post with");
  return { botToken: TELEGRAM_BOT_TOKEN, chatId };
}

/**
 * Tell the operators that the breaker tripped. It takes the trip, not a text, so the only thing
 * it can ever post is the fixed message built from that trip's numbers.
 */
export async function postTripAlert(chat: AdminChat, trip: Trip): Promise<void> {
  await send(chat.botToken, chat.chatId, tripMessage(trip));
}

export async function postToTelegram(cfg: TelegramConfig, chatId: string, text: string): Promise<void> {
  await send(cfg.botToken, chatId, text);
}

async function send(botToken: string, chatId: string, text: string): Promise<void> {
  // Plain text on purpose (no parse_mode): Claude's output can never be read as Markdown/HTML links.
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Report Telegram's description only - never the URL, which contains the bot token.
    const body = (await res.json().catch(() => ({}))) as { description?: string };
    throw new Error(`Telegram returned HTTP ${res.status}: ${body.description ?? "no details"}`);
  }
}
