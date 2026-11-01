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

export async function postToTelegram(cfg: TelegramConfig, chatId: string, text: string): Promise<void> {
  // Plain text on purpose (no parse_mode): Claude's output can never be read as Markdown/HTML links.
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
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
