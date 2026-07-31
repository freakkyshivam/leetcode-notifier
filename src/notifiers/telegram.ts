import { config } from "../config";

function requireBotToken(): string {
  if (!config.telegram.botToken) {
    throw new Error("Telegram is not configured on the server: set TELEGRAM_BOT_TOKEN");
  }
  return config.telegram.botToken;
}

export async function sendTelegram(chatId: string, message: string): Promise<void> {
  const botToken = requireBotToken();
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${detail}`);
  }
}

/** Used by the bot listener to reply directly, without going through the reminder-message wrapper. */
export async function sendRawTelegram(chatId: number | string, text: string): Promise<void> {
  const botToken = requireBotToken();
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
