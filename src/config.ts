import dotenv from "dotenv";
dotenv.config();

function optional(name: string): string | undefined {
  const val = process.env[name];
  return val && val.trim().length > 0 ? val : undefined;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongodbUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/leetcode-notifier",

  timezone: process.env.TIMEZONE ?? "Asia/Kolkata",

  // ---- Shared service-level SMTP credentials (e.g. Brevo SMTP) ----
  email: {
    host: optional("SMTP_HOST") ?? "smtp-relay.brevo.com",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: optional("SMTP_USER"),
    pass: optional("SMTP_PASS"),
    from: optional("EMAIL_FROM"),
  },

  telegram: {
    botToken: optional("TELEGRAM_BOT_TOKEN"),
  },

  push: {
    publicKey: optional("VAPID_PUBLIC_KEY"),
    privateKey: optional("VAPID_PRIVATE_KEY"),
    subject: process.env.VAPID_SUBJECT ?? "mailto:example@example.com",
  },

  telegramBotUsername: optional("TELEGRAM_BOT_USERNAME"),
};
