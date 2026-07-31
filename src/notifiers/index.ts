import { sendEmail } from "./email";
import { sendTelegram } from "./telegram";
import { sendPush } from "./push";
import { User } from "../store";

export interface ChannelResult {
  channel: string;
  ok: boolean;
  error?: string;
}

/**
 * Sends notifications to a user across specific channels if the user has enabled them.
 */
export async function notifyUserStage(
  user: User,
  title: string,
  body: string,
  targetChannels: Array<"push" | "telegram" | "email">,
  extraData: Record<string, any> = {}
): Promise<ChannelResult[]> {
  const tasks: Array<Promise<ChannelResult>> = [];

  if (targetChannels.includes("email") && user.channels.email) {
    tasks.push(
      (async () => {
        try {
          if (!user.email) throw new Error("email channel enabled but no email address on file");
          await sendEmail(user.email, title, body);
          return { channel: "email", ok: true };
        } catch (err) {
          return { channel: "email", ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      })()
    );
  }

  if (targetChannels.includes("telegram") && user.channels.telegram) {
    tasks.push(
      (async () => {
        try {
          if (!user.telegramChatId) throw new Error("telegram channel enabled but no chat id on file");
          await sendTelegram(user.telegramChatId, `${title}\n\n${body}`);
          return { channel: "telegram", ok: true };
        } catch (err) {
          return { channel: "telegram", ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      })()
    );
  }

  if (targetChannels.includes("push") && user.channels.push) {
    tasks.push(
      (async () => {
        try {
          await sendPush(user.pushSubscriptions, title, body, extraData);
          return { channel: "push", ok: true };
        } catch (err) {
          return { channel: "push", ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      })()
    );
  }

  return Promise.all(tasks);
}

/**
 * Sends a standard test reminder across all user-enabled channels.
 */
export async function notifyUser(user: User): Promise<ChannelResult[]> {
  const title = "LeetCode reminder (Test)";
  const body = `You haven't submitted an accepted LeetCode solution today (${user.leetcodeUsername}). Get one in before the day resets.`;
  return notifyUserStage(user, title, body, ["push", "telegram", "email"]);
}
