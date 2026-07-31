import { config } from "./config";
import { sendRawTelegram } from "./notifiers/telegram";
import { getUserByTelegramChatId, createUser, updateUser, markSolvedManually, User } from "./store";
import { hasSolvedToday } from "./leetcode";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
}

// Conversation states for signup and editing
type SessionState =
  | { type: "SIGNUP_WAITING_LEETCODE" }
  | { type: "SIGNUP_WAITING_NAME"; leetcodeUsername: string }
  | { type: "SIGNUP_WAITING_EMAIL"; leetcodeUsername: string; name?: string }
  | { type: "EDIT_WAITING_LEETCODE"; userId: string }
  | { type: "EDIT_WAITING_NAME"; userId: string }
  | { type: "EDIT_WAITING_EMAIL"; userId: string };

const userSessions = new Map<string, SessionState>();
let offset = 0;
let polling = false;

async function sendTelegramMessage(chatId: string | number, text: string, replyMarkup?: any): Promise<void> {
  const botToken = config.telegram.botToken;
  if (!botToken) return;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
  });
}

async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const botToken = config.telegram.botToken;
  if (!botToken) return;

  const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function handleStartCommand(chatIdStr: string): Promise<void> {
  const user = await getUserByTelegramChatId(chatIdStr);
  if (user) {
    const text = `Welcome back ${user.name || user.leetcodeUsername}! 👋\n\nYour account is linked with LeetCode handle: *${user.leetcodeUsername}*\n\nAvailable commands:\n/status - Check today's progress\n/done - Mark today solved manually\n/edit - Update your profile\n/channels - Manage notification channels\n/help - View help`;
    await sendTelegramMessage(chatIdStr, text);
  } else {
    userSessions.set(chatIdStr, { type: "SIGNUP_WAITING_LEETCODE" });
    await sendTelegramMessage(
      chatIdStr,
      `Hello! Let's get you set up for LeetCode reminders. 🎯\n\nPlease reply with your **LeetCode Username** (e.g. \`riya_codes\`):`
    );
  }
}

async function handleStatusCommand(chatIdStr: string): Promise<void> {
  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await sendTelegramMessage(chatIdStr, "You are not registered yet! Send /start to sign up.");
    return;
  }

  let solved: boolean | null = null;
  try {
    solved = await hasSolvedToday(user.leetcodeUsername);
  } catch {}

  const text = `📊 **Today's Status** (${user.status.date})\n` +
    `• User: ${user.leetcodeUsername}\n` +
    `• Solved on LeetCode: ${solved ? "✅ Yes" : "❌ Not yet"}\n` +
    `• Manual Override: ${user.status.manuallyMarkedDone ? "✅ Marked Done" : "❌ No"}\n` +
    `• Stages Triggered Today:\n` +
    `   Stage 1 (21:00): ${user.status.stage1Sent ? "Sent" : "Pending"}\n` +
    `   Stage 2 (22:00): ${user.status.stage2Sent ? "Sent" : "Pending"}\n` +
    `   Stage 3 (23:00): ${user.status.stage3Sent ? "Sent" : "Pending"}\n` +
    `   Stage 4 (23:45): ${user.status.stage4Sent ? "Sent" : "Pending"}\n` +
    `• Channels: ${Object.entries(user.channels).filter(([,v])=>v).map(([k])=>k).join(", ") || "None"}`;

  await sendTelegramMessage(chatIdStr, text);
}

async function handleDoneCommand(chatIdStr: string): Promise<void> {
  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await sendTelegramMessage(chatIdStr, "You are not registered yet! Send /start to sign up.");
    return;
  }

  await markSolvedManually(user.id);
  await sendTelegramMessage(chatIdStr, "✅ Marked today as solved! Rest easy tonight.");
}

async function handleEditCommand(chatIdStr: string): Promise<void> {
  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await sendTelegramMessage(chatIdStr, "You are not registered yet! Send /start to sign up.");
    return;
  }

  const text = `⚙️ **Edit Details**\n\nCurrent details:\n• LeetCode: ${user.leetcodeUsername}\n• Name: ${user.name || "(none)"}\n• Email: ${user.email || "(none)"}\n\nWhat would you like to edit?`;
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "✏️ LeetCode Username", callback_data: "edit_leetcode" },
        { text: "✏️ Name", callback_data: "edit_name" },
      ],
      [{ text: "✏️ Email", callback_data: "edit_email" }],
    ],
  };

  await sendTelegramMessage(chatIdStr, text, replyMarkup);
}

async function handleChannelsCommand(chatIdStr: string): Promise<void> {
  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await sendTelegramMessage(chatIdStr, "You are not registered yet! Send /start to sign up.");
    return;
  }

  const text = `🔔 **Manage Channels**\n\nTelegram is active for this chat.\n• Email: ${user.channels.email ? "ON ✅" : "OFF ❌"}\n• Browser Push: ${user.channels.push ? "ON ✅" : "OFF ❌"}`;
  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: user.channels.email ? "Disable Email ❌" : "Enable Email ✅",
          callback_data: "toggle_email",
        },
        {
          text: user.channels.push ? "Disable Push ❌" : "Enable Push ✅",
          callback_data: "toggle_push",
        },
      ],
    ],
  };

  await sendTelegramMessage(chatIdStr, text, replyMarkup);
}

async function handleHelpCommand(chatIdStr: string): Promise<void> {
  const text = `🤖 **LeetCode Notifier Bot Commands**\n\n` +
    `/start - Register or restart session\n` +
    `/status - View your solve status & stage notifications\n` +
    `/done - Mark today's goal manually done\n` +
    `/edit - Update username, name, or email\n` +
    `/channels - Toggle notification channels\n` +
    `/help - View this message`;

  await sendTelegramMessage(chatIdStr, text);
}

async function handleMessage(chatId: number, text: string): Promise<void> {
  const chatIdStr = String(chatId);
  const trimmed = text.trim();

  // Command handlers
  if (trimmed === "/start") return handleStartCommand(chatIdStr);
  if (trimmed === "/status") return handleStatusCommand(chatIdStr);
  if (trimmed === "/done") return handleDoneCommand(chatIdStr);
  if (trimmed === "/edit") return handleEditCommand(chatIdStr);
  if (trimmed === "/channels") return handleChannelsCommand(chatIdStr);
  if (trimmed === "/help") return handleHelpCommand(chatIdStr);

  // Check active stateful session
  const session = userSessions.get(chatIdStr);
  if (!session) {
    // Default reply if no session active and text wasn't a command
    await sendTelegramMessage(chatIdStr, `Your Telegram Chat ID is: \`${chatIdStr}\`\n\nType /help to see available commands.`);
    return;
  }

  switch (session.type) {
    case "SIGNUP_WAITING_LEETCODE": {
      userSessions.set(chatIdStr, {
        type: "SIGNUP_WAITING_NAME",
        leetcodeUsername: trimmed,
      });
      await sendTelegramMessage(chatIdStr, `Got it! LeetCode username: *${trimmed}*\n\nNow send your **Name** (or type \`skip\`):`);
      break;
    }
    case "SIGNUP_WAITING_NAME": {
      const name = trimmed.toLowerCase() === "skip" ? undefined : trimmed;
      userSessions.set(chatIdStr, {
        type: "SIGNUP_WAITING_EMAIL",
        leetcodeUsername: session.leetcodeUsername,
        name,
      });
      await sendTelegramMessage(chatIdStr, `Thanks! Now send your **Email address** for email notifications (or type \`skip\`):`);
      break;
    }
    case "SIGNUP_WAITING_EMAIL": {
      const email = trimmed.toLowerCase() === "skip" ? undefined : trimmed;
      userSessions.delete(chatIdStr);

      const user = await createUser({
        leetcodeUsername: session.leetcodeUsername,
        name: session.name,
        email: email,
        telegramChatId: chatIdStr,
        channels: {
          telegram: true,
          email: !!email,
          push: false,
        },
      });

      await sendTelegramMessage(
        chatIdStr,
        `🎉 **Registration Complete!**\n\n` +
          `• LeetCode: ${user.leetcodeUsername}\n` +
          `• Telegram Notifications: ON ✅\n` +
          `• Email Notifications: ${user.email ? "ON ✅ (" + user.email + ")" : "OFF"}\n\n` +
          `You'll receive notifications automatically if you miss your deadline today. Type /status anytime!`
      );
      break;
    }
    case "EDIT_WAITING_LEETCODE": {
      userSessions.delete(chatIdStr);
      await updateUser(session.userId, { leetcodeUsername: trimmed });
      await sendTelegramMessage(chatIdStr, `✅ LeetCode username updated to: *${trimmed}*`);
      break;
    }
    case "EDIT_WAITING_NAME": {
      userSessions.delete(chatIdStr);
      const name = trimmed.toLowerCase() === "skip" ? undefined : trimmed;
      await updateUser(session.userId, { name });
      await sendTelegramMessage(chatIdStr, `✅ Name updated to: *${name || "(cleared)"}*`);
      break;
    }
    case "EDIT_WAITING_EMAIL": {
      userSessions.delete(chatIdStr);
      const email = trimmed.toLowerCase() === "skip" ? undefined : trimmed;
      await updateUser(session.userId, { email });
      await sendTelegramMessage(chatIdStr, `✅ Email updated to: *${email || "(cleared)"}*`);
      break;
    }
  }
}

async function handleCallbackQuery(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const chatIdStr = String(cb.message?.chat.id);
  const data = cb.data;
  await answerCallbackQuery(cb.id);

  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) return;

  if (data === "edit_leetcode") {
    userSessions.set(chatIdStr, { type: "EDIT_WAITING_LEETCODE", userId: user.id });
    await sendTelegramMessage(chatIdStr, `Please send your new **LeetCode Username**:`);
  } else if (data === "edit_name") {
    userSessions.set(chatIdStr, { type: "EDIT_WAITING_NAME", userId: user.id });
    await sendTelegramMessage(chatIdStr, `Please send your new **Name** (or type \`skip\` to clear):`);
  } else if (data === "edit_email") {
    userSessions.set(chatIdStr, { type: "EDIT_WAITING_EMAIL", userId: user.id });
    await sendTelegramMessage(chatIdStr, `Please send your new **Email** (or type \`skip\` to clear):`);
  } else if (data === "toggle_email") {
    const nextState = !user.channels.email;
    await updateUser(user.id, { channels: { ...user.channels, email: nextState } });
    await handleChannelsCommand(chatIdStr);
  } else if (data === "toggle_push") {
    const nextState = !user.channels.push;
    await updateUser(user.id, { channels: { ...user.channels, push: nextState } });
    await handleChannelsCommand(chatIdStr);
  }
}

async function pollOnce(): Promise<void> {
  const botToken = config.telegram.botToken;
  if (!botToken) return;

  const url = `https://api.telegram.org/bot${botToken}/getUpdates?timeout=25&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getUpdates failed: ${res.status}`);

  const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
  if (!data.ok) return;

  for (const update of data.result) {
    offset = update.update_id + 1;

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message?.chat?.id && update.message?.text) {
      await handleMessage(update.message.chat.id, update.message.text);
    }
  }
}

export function startTelegramBotListener(): void {
  if (!config.telegram.botToken) {
    console.log("[telegram-bot] TELEGRAM_BOT_TOKEN not set, skipping Telegram bot listener.");
    return;
  }
  if (polling) return;
  polling = true;

  console.log("[telegram-bot] Interactive Telegram bot listener started.");

  const loop = async () => {
    while (polling) {
      try {
        await pollOnce();
      } catch (err) {
        console.error("[telegram-bot] Poll error:", err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };

  loop();
}
