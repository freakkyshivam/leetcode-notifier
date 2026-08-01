import { config } from "./config";
import { getUserByTelegramChatId, createUser, updateUser, markSolvedManually, User } from "./store";
import { hasSolvedToday } from "./leetcode";
import { sendEmail } from "./notifiers/email";

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

// Conversation states for signup and editing with OTP verification
type SessionState =
  | { type: "SIGNUP_WAITING_LEETCODE" }
  | { type: "SIGNUP_WAITING_NAME"; leetcodeUsername: string }
  | { type: "SIGNUP_WAITING_EMAIL"; leetcodeUsername: string; name?: string }
  | {
      type: "SIGNUP_WAITING_OTP";
      leetcodeUsername: string;
      name?: string;
      email: string;
      otpCode: string;
      expiresAt: number;
    }
  | { type: "EDIT_WAITING_LEETCODE"; userId: string }
  | { type: "EDIT_WAITING_NAME"; userId: string }
  | { type: "EDIT_WAITING_EMAIL"; userId: string }
  | {
      type: "EDIT_WAITING_EMAIL_OTP";
      userId: string;
      newEmail: string;
      otpCode: string;
      expiresAt: number;
    };

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
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", reply_markup: replyMarkup }),
  });
}

/** Sends Telegram's native chat action (e.g. animated "typing..." status indicator in header) */
async function sendChatAction(chatId: string | number, action: string = "typing"): Promise<void> {
  const botToken = config.telegram.botToken;
  if (!botToken) return;

  const url = `https://api.telegram.org/bot${botToken}/sendChatAction`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // Non-critical chat action failure ignore
  }
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

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function handleStartCommand(chatIdStr: string): Promise<void> {
  await sendChatAction(chatIdStr, "typing");
  const user = await getUserByTelegramChatId(chatIdStr);
  if (user) {
    const text = `Welcome back ${user.name || user.leetcodeUsername}! 👋\n\nYour account is linked with LeetCode handle: *${user.leetcodeUsername}*\n\nAvailable commands:\n/status - Check today's progress\n/done - Mark today solved manually\n/edit - Update your profile\n/channels - Manage notification channels\n/developer - Developer info\n/help - View help`;
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
  await sendChatAction(chatIdStr, "typing");
  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await sendTelegramMessage(chatIdStr, "You are not registered yet! Send /start to sign up.");
    return;
  }

  // Show active typing status while querying LeetCode GraphQL API
  await sendChatAction(chatIdStr, "typing");

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
  await sendChatAction(chatIdStr, "typing");
  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await sendTelegramMessage(chatIdStr, "You are not registered yet! Send /start to sign up.");
    return;
  }

  await markSolvedManually(user.id);
  await sendTelegramMessage(chatIdStr, "✅ Marked today as solved! Rest easy tonight.");
}

async function handleEditCommand(chatIdStr: string): Promise<void> {
  await sendChatAction(chatIdStr, "typing");
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
      [{ text: "✏️ Email (OTP Verified)", callback_data: "edit_email" }],
    ],
  };

  await sendTelegramMessage(chatIdStr, text, replyMarkup);
}

async function handleChannelsCommand(chatIdStr: string): Promise<void> {
  await sendChatAction(chatIdStr, "typing");
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

async function handleDeveloperCommand(chatIdStr: string): Promise<void> {
  await sendChatAction(chatIdStr, "typing");
  const text = `👨‍💻 **Developer Details & System Info**\n\n` +
    `• Developer: FREAKKY SHIVAM\n` +
    `• Role: Backend Developer\n` +
    `• GitHub: https://github.com/freakkyshivam\n` +
    `• Repo: https://github.com/freakkyshivam/leetcode-notifier\n\n` +
    `🚀 **System Architecture**:\n` +
    `• Node.js, TypeScript, Express, MongoDB (Mongoose)\n` +
    `• 4-Stage Escalation Reminders (21:00, 22:00, 23:00, 23:45)\n` +
    `• FINAL BOSS Web Audio Siren Emergency Alarm\n` +
    `• OTP-Based 6-Digit Email Verification`;

  await sendTelegramMessage(chatIdStr, text);
}

async function handleHelpCommand(chatIdStr: string): Promise<void> {
  await sendChatAction(chatIdStr, "typing");
  const text = `🤖 **LeetCode Notifier Bot Commands**\n\n` +
    `/start - Register or restart session\n` +
    `/status - View your solve status & stage notifications\n` +
    `/done - Mark today's goal manually done\n` +
    `/edit - Update username, name, or email\n` +
    `/channels - Toggle notification channels\n` +
    `/developer - Developer & system info\n` +
    `/help - View this message`;

  await sendTelegramMessage(chatIdStr, text);
}

async function handleMessage(chatId: number, text: string): Promise<void> {
  const chatIdStr = String(chatId);
  const trimmed = text.trim();

  // Send native typing chat action indicator immediately
  await sendChatAction(chatIdStr, "typing");

  // Command handlers
  if (trimmed === "/start") return handleStartCommand(chatIdStr);
  if (trimmed === "/status") return handleStatusCommand(chatIdStr);
  if (trimmed === "/done") return handleDoneCommand(chatIdStr);
  if (trimmed === "/edit") return handleEditCommand(chatIdStr);
  if (trimmed === "/channels") return handleChannelsCommand(chatIdStr);
  if (trimmed === "/developer" || trimmed === "/dev") return handleDeveloperCommand(chatIdStr);
  if (trimmed === "/help") return handleHelpCommand(chatIdStr);

  // Check active stateful session
  const session = userSessions.get(chatIdStr);
  if (!session) {
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
      await sendTelegramMessage(chatIdStr, `Thanks! Now send your **Email address** to receive your 6-digit verification OTP code:`);
      break;
    }
    case "SIGNUP_WAITING_EMAIL": {
      const email = trimmed.toLowerCase();
      if (!email.includes("@")) {
        await sendTelegramMessage(chatIdStr, `❌ Please enter a valid email address containing '@':`);
        return;
      }

      await sendChatAction(chatIdStr, "typing");

      const otpCode = generateOtp();
      const expiresAt = Date.now() + 10 * 60 * 1000;

      try {
        await sendEmail(
          email,
          `Your LeetCode Notifier Verification Code: ${otpCode}`,
          `Hello!\n\nYour 6-digit OTP verification code for LeetCode Notifier registration is: ${otpCode}\n\nValid for 10 minutes.`
        );

        userSessions.set(chatIdStr, {
          type: "SIGNUP_WAITING_OTP",
          leetcodeUsername: session.leetcodeUsername,
          name: session.name,
          email,
          otpCode,
          expiresAt,
        });

        await sendTelegramMessage(
          chatIdStr,
          `📩 **OTP Verification Code Sent!**\n\nWe sent a 6-digit verification OTP code to *${email}*.\n\nPlease reply with the **6-digit OTP code** to complete registration (or type \`resend\` to get a new code):`
        );
      } catch (err: any) {
        await sendTelegramMessage(chatIdStr, `❌ Failed to send OTP email: ${err.message || String(err)}\n\nPlease re-enter your email:`);
      }
      break;
    }
    case "SIGNUP_WAITING_OTP": {
      if (trimmed.toLowerCase() === "resend") {
        await sendChatAction(chatIdStr, "typing");
        const otpCode = generateOtp();
        const expiresAt = Date.now() + 10 * 60 * 1000;
        try {
          await sendEmail(
            session.email,
            `Your LeetCode Notifier Verification Code: ${otpCode}`,
            `Hello!\n\nYour new 6-digit OTP verification code is: ${otpCode}\n\nValid for 10 minutes.`
          );
          userSessions.set(chatIdStr, { ...session, otpCode, expiresAt });
          await sendTelegramMessage(chatIdStr, `🔄 New 6-digit OTP sent to *${session.email}*. Please reply with the code:`);
        } catch (err: any) {
          await sendTelegramMessage(chatIdStr, `❌ Failed to resend OTP: ${err.message || String(err)}`);
        }
        return;
      }

      if (Date.now() > session.expiresAt) {
        await sendTelegramMessage(chatIdStr, `⏰ OTP code expired! Type \`resend\` to get a new code:`);
        return;
      }

      if (trimmed !== session.otpCode) {
        await sendTelegramMessage(chatIdStr, `❌ Invalid OTP code! Please check your email and enter the correct 6-digit code (or type \`resend\`):`);
        return;
      }

      // OTP Verified -> Create User Account!
      userSessions.delete(chatIdStr);

      const user = await createUser({
        leetcodeUsername: session.leetcodeUsername,
        name: session.name,
        email: session.email,
        telegramChatId: chatIdStr,
        channels: {
          telegram: true,
          email: true,
          push: false,
        },
      });

      await sendTelegramMessage(
        chatIdStr,
        `🎉 **Registration Complete & Email Verified!**\n\n` +
          `• LeetCode Handle: *${user.leetcodeUsername}*\n` +
          `• Name: ${user.name || "(none)"}\n` +
          `• Email: ${user.email} ✅\n` +
          `• Telegram Notifications: ON ✅\n\n` +
          `You'll receive automated 4-stage notifications if you miss your daily LeetCode goal. Type /status anytime!`
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
      const email = trimmed.toLowerCase();
      if (!email.includes("@")) {
        await sendTelegramMessage(chatIdStr, `❌ Please enter a valid email address containing '@':`);
        return;
      }

      await sendChatAction(chatIdStr, "typing");

      const otpCode = generateOtp();
      const expiresAt = Date.now() + 10 * 60 * 1000;

      try {
        await sendEmail(
          email,
          `Verify Email Change - LeetCode Notifier Code: ${otpCode}`,
          `Hello!\n\nYour 6-digit verification code to update your LeetCode Notifier email is: ${otpCode}\n\nValid for 10 minutes.`
        );

        userSessions.set(chatIdStr, {
          type: "EDIT_WAITING_EMAIL_OTP",
          userId: session.userId,
          newEmail: email,
          otpCode,
          expiresAt,
        });

        await sendTelegramMessage(
          chatIdStr,
          `📩 We sent a 6-digit OTP verification code to *${email}*.\n\nPlease reply with the **6-digit code** to confirm updating your email:`
        );
      } catch (err: any) {
        await sendTelegramMessage(chatIdStr, `❌ Failed to send OTP email: ${err.message || String(err)}`);
      }
      break;
    }
    case "EDIT_WAITING_EMAIL_OTP": {
      if (Date.now() > session.expiresAt) {
        await sendTelegramMessage(chatIdStr, `⏰ OTP code expired! Please try updating your email again via /edit.`);
        userSessions.delete(chatIdStr);
        return;
      }

      if (trimmed !== session.otpCode) {
        await sendTelegramMessage(chatIdStr, `❌ Incorrect OTP code! Please reply with the correct 6-digit code sent to *${session.newEmail}*:`);
        return;
      }

      userSessions.delete(chatIdStr);
      await updateUser(session.userId, { email: session.newEmail, channels: { email: true } as any });
      await sendTelegramMessage(chatIdStr, `✅ Email verified and updated to: *${session.newEmail}*`);
      break;
    }
  }
}

async function handleCallbackQuery(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const chatIdStr = String(cb.message?.chat.id);
  const data = cb.data;

  // Immediately answer callback query with a toast notification to stop button spinner
  await answerCallbackQuery(cb.id, "⏳ Processing...");
  await sendChatAction(chatIdStr, "typing");

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
    await sendTelegramMessage(chatIdStr, `Please send your new **Email address** (an OTP code will be sent to verify):`);
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
