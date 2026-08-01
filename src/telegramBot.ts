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

async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: any
): Promise<number | undefined> {
  const botToken = config.telegram.botToken;
  if (!botToken) return undefined;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", reply_markup: replyMarkup }),
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      return data.result?.message_id;
    }
  } catch {}
  return undefined;
}

/** Replaces/edits the text of an existing temporary loading message with the final response */
async function editTelegramMessage(
  chatId: string | number,
  messageId: number | undefined,
  text: string,
  replyMarkup?: any
): Promise<number | undefined> {
  if (!messageId) {
    return sendTelegramMessage(chatId, text, replyMarkup);
  }

  const botToken = config.telegram.botToken;
  if (!botToken) return undefined;

  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup,
      }),
    });
    if (res.ok) return messageId;
  } catch {}

  // Fallback to sending a new message if editing fails
  return sendTelegramMessage(chatId, text, replyMarkup);
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
  } catch {}
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
  sendChatAction(chatIdStr, "typing");
  const tempMsgId = await sendTelegramMessage(chatIdStr, "⏳ *Loading session details...*");

  const user = await getUserByTelegramChatId(chatIdStr);
  if (user) {
    const text = `Welcome back ${user.name || user.leetcodeUsername}! 👋\n\nYour account is linked with LeetCode handle: *${user.leetcodeUsername}*\n\nAvailable commands:\n/status - Check today's progress\n/done - Mark today solved manually\n/edit - Update your profile\n/channels - Manage notification channels\n/developer - Developer info\n/help - View help`;
    await editTelegramMessage(chatIdStr, tempMsgId, text);
  } else {
    userSessions.set(chatIdStr, { type: "SIGNUP_WAITING_LEETCODE" });
    const text = `Hello! Let's get you set up for LeetCode reminders. 🎯\n\nPlease reply with your **LeetCode Username** (e.g. \`riya_codes\`):`;
    await editTelegramMessage(chatIdStr, tempMsgId, text);
  }
}

async function handleStatusCommand(chatIdStr: string): Promise<void> {
  sendChatAction(chatIdStr, "typing");
  const tempMsgId = await sendTelegramMessage(chatIdStr, "⏳ *Fetching today's LeetCode status & daily progress...*");

  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await editTelegramMessage(chatIdStr, tempMsgId, "You are not registered yet! Send /start to sign up.");
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

  await editTelegramMessage(chatIdStr, tempMsgId, text);
}

async function handleDoneCommand(chatIdStr: string): Promise<void> {
  sendChatAction(chatIdStr, "typing");
  const tempMsgId = await sendTelegramMessage(chatIdStr, "⏳ *Updating solve status...*");

  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await editTelegramMessage(chatIdStr, tempMsgId, "You are not registered yet! Send /start to sign up.");
    return;
  }

  await markSolvedManually(user.id);
  await editTelegramMessage(chatIdStr, tempMsgId, "✅ Marked today as solved! Rest easy tonight.");
}

async function handleEditCommand(chatIdStr: string): Promise<void> {
  sendChatAction(chatIdStr, "typing");
  const tempMsgId = await sendTelegramMessage(chatIdStr, "⏳ *Loading account profile...*");

  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await editTelegramMessage(chatIdStr, tempMsgId, "You are not registered yet! Send /start to sign up.");
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

  await editTelegramMessage(chatIdStr, tempMsgId, text, replyMarkup);
}

async function handleChannelsCommand(chatIdStr: string): Promise<void> {
  sendChatAction(chatIdStr, "typing");
  const tempMsgId = await sendTelegramMessage(chatIdStr, "⏳ *Loading channels...*");

  const user = await getUserByTelegramChatId(chatIdStr);
  if (!user) {
    await editTelegramMessage(chatIdStr, tempMsgId, "You are not registered yet! Send /start to sign up.");
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

  await editTelegramMessage(chatIdStr, tempMsgId, text, replyMarkup);
}

async function handleDeveloperCommand(chatIdStr: string): Promise<void> {
  sendChatAction(chatIdStr, "typing");
  const tempMsgId = await sendTelegramMessage(chatIdStr, "⏳ *Loading developer information...*");

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

  await editTelegramMessage(chatIdStr, tempMsgId, text);
}

async function handleHelpCommand(chatIdStr: string): Promise<void> {
  sendChatAction(chatIdStr, "typing");
  const tempMsgId = await sendTelegramMessage(chatIdStr, "⏳ *Loading commands list...*");

  const text = `🤖 **LeetCode Notifier Bot Commands**\n\n` +
    `/start - Register or restart session\n` +
    `/status - View your solve status & stage notifications\n` +
    `/done - Mark today's goal manually done\n` +
    `/edit - Update username, name, or email\n` +
    `/channels - Toggle notification channels\n` +
    `/developer - Developer & system info\n` +
    `/help - View this message`;

  await editTelegramMessage(chatIdStr, tempMsgId, text);
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

      sendChatAction(chatIdStr, "typing");
      const tempMsgId = await sendTelegramMessage(chatIdStr, `⏳ *Generating 6-digit OTP code and sending email to ${email}...*`);

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

        const text = `📩 **OTP Verification Code Sent!**\n\nWe sent a 6-digit verification OTP code to *${email}*.\n\nPlease reply with the **6-digit OTP code** to complete registration (or type \`resend\` to get a new code):`;
        await editTelegramMessage(chatIdStr, tempMsgId, text);
      } catch (err: any) {
        await editTelegramMessage(chatIdStr, tempMsgId, `❌ Failed to send OTP email: ${err.message || String(err)}\n\nPlease re-enter your email:`);
      }
      break;
    }
    case "SIGNUP_WAITING_OTP": {
      if (trimmed.toLowerCase() === "resend") {
        sendChatAction(chatIdStr, "typing");
        const tempMsgId = await sendTelegramMessage(chatIdStr, `⏳ *Resending 6-digit OTP code to ${session.email}...*`);
        const otpCode = generateOtp();
        const expiresAt = Date.now() + 10 * 60 * 1000;
        try {
          await sendEmail(
            session.email,
            `Your LeetCode Notifier Verification Code: ${otpCode}`,
            `Hello!\n\nYour new 6-digit OTP verification code is: ${otpCode}\n\nValid for 10 minutes.`
          );
          userSessions.set(chatIdStr, { ...session, otpCode, expiresAt });
          await editTelegramMessage(chatIdStr, tempMsgId, `🔄 New 6-digit OTP sent to *${session.email}*. Please reply with the code:`);
        } catch (err: any) {
          await editTelegramMessage(chatIdStr, tempMsgId, `❌ Failed to resend OTP: ${err.message || String(err)}`);
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
      sendChatAction(chatIdStr, "typing");
      const tempMsgId = await sendTelegramMessage(chatIdStr, "⏳ *Verifying OTP and creating your account...*");
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

      const text = `🎉 **Registration Complete & Email Verified!**\n\n` +
        `• LeetCode Handle: *${user.leetcodeUsername}*\n` +
        `• Name: ${user.name || "(none)"}\n` +
        `• Email: ${user.email} ✅\n` +
        `• Telegram Notifications: ON ✅\n\n` +
        `You'll receive automated 4-stage notifications if you miss your daily LeetCode goal. Type /status anytime!`;

      await editTelegramMessage(chatIdStr, tempMsgId, text);
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

      sendChatAction(chatIdStr, "typing");
      const tempMsgId = await sendTelegramMessage(chatIdStr, `⏳ *Sending verification code to ${email}...*`);

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

        const text = `📩 We sent a 6-digit OTP verification code to *${email}*.\n\nPlease reply with the **6-digit code** to confirm updating your email:`;
        await editTelegramMessage(chatIdStr, tempMsgId, text);
      } catch (err: any) {
        await editTelegramMessage(chatIdStr, tempMsgId, `❌ Failed to send OTP email: ${err.message || String(err)}`);
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

      sendChatAction(chatIdStr, "typing");
      const tempMsgId = await sendTelegramMessage(chatIdStr, "⏳ *Verifying code and updating email...*");

      userSessions.delete(chatIdStr);
      await updateUser(session.userId, { email: session.newEmail, channels: { email: true } as any });
      await editTelegramMessage(chatIdStr, tempMsgId, `✅ Email verified and updated to: *${session.newEmail}*`);
      break;
    }
  }
}

async function handleCallbackQuery(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const chatIdStr = String(cb.message?.chat.id);
  const data = cb.data;
  const cbMessageId = cb.message?.message_id;

  await answerCallbackQuery(cb.id, "⏳ Processing...");
  sendChatAction(chatIdStr, "typing");

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
    const updated = await updateUser(user.id, { channels: { ...user.channels, email: nextState } });
    if (updated) {
      const text = `🔔 **Manage Channels**\n\nTelegram is active for this chat.\n• Email: ${updated.channels.email ? "ON ✅" : "OFF ❌"}\n• Browser Push: ${updated.channels.push ? "ON ✅" : "OFF ❌"}`;
      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text: updated.channels.email ? "Disable Email ❌" : "Enable Email ✅",
              callback_data: "toggle_email",
            },
            {
              text: updated.channels.push ? "Disable Push ❌" : "Enable Push ✅",
              callback_data: "toggle_push",
            },
          ],
        ],
      };
      await editTelegramMessage(chatIdStr, cbMessageId, text, replyMarkup);
    }
  } else if (data === "toggle_push") {
    const nextState = !user.channels.push;
    const updated = await updateUser(user.id, { channels: { ...user.channels, push: nextState } });
    if (updated) {
      const text = `🔔 **Manage Channels**\n\nTelegram is active for this chat.\n• Email: ${updated.channels.email ? "ON ✅" : "OFF ❌"}\n• Browser Push: ${updated.channels.push ? "ON ✅" : "OFF ❌"}`;
      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text: updated.channels.email ? "Disable Email ❌" : "Enable Email ✅",
              callback_data: "toggle_email",
            },
            {
              text: updated.channels.push ? "Disable Push ❌" : "Enable Push ✅",
              callback_data: "toggle_push",
            },
          ],
        ],
      };
      await editTelegramMessage(chatIdStr, cbMessageId, text, replyMarkup);
    }
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
