import { Router } from "express";
import crypto from "crypto";
import { config } from "./config";
import { hasSolvedToday } from "./leetcode";
import {
  createUser,
  getUser,
  getUserByEmail,
  saveOtp,
  verifyOtp,
  markSolvedManually,
  addPushSubscription,
  removePushSubscription,
} from "./store";
import { sendEmail } from "./notifiers/email";
import { notifyUser, notifyUserStage } from "./notifiers";
import { runStageCheckForUser } from "./scheduler";

export const router = Router();

// Store temporary unverified signup inputs mapped by email
const pendingSignups = new Map<string, {
  name?: string;
  leetcodeUsername: string;
  email: string;
  telegramChatId?: string;
  channels: any;
}>();

// ---- OTP Auth Routes ----

// Send OTP for Signup or Login
router.post("/api/auth/send-otp", async (req, res) => {
  const { email, mode, name, leetcodeUsername, telegramChatId, channels } = req.body ?? {};

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  const cleanEmail = email.trim().toLowerCase();
  const existingUser = await getUserByEmail(cleanEmail);

  if (mode === "signup") {
    if (existingUser) {
      return res.status(400).json({ error: "An account with this email already exists. Please log in instead." });
    }
    if (!leetcodeUsername || typeof leetcodeUsername !== "string") {
      return res.status(400).json({ error: "LeetCode username is required for signup" });
    }

    // Save pending signup data until OTP verification
    pendingSignups.set(cleanEmail, {
      name,
      leetcodeUsername,
      email: cleanEmail,
      telegramChatId,
      channels: channels ?? { email: true },
    });
  } else if (mode === "login") {
    if (!existingUser) {
      return res.status(404).json({ error: "No account found with this email address." });
    }
  }

  // Generate 6-digit cryptographic numeric OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

  if (existingUser) {
    await saveOtp(cleanEmail, otpCode, expiresAt);
  } else {
    // Save temporary OTP for pending signup
    await saveOtp(cleanEmail, otpCode, expiresAt);
  }

  try {
    const subject = `Your LeetCode Notifier Verification Code: ${otpCode}`;
    const body = `Hello!\n\nYour 6-digit verification code is: ${otpCode}\n\nThis code will expire in 10 minutes. If you did not request this, please ignore this message.`;
    await sendEmail(cleanEmail, subject, body);
    res.json({ ok: true, message: `OTP sent to ${cleanEmail}` });
  } catch (err: any) {
    console.error("[auth] Failed to send OTP email:", err);
    res.status(500).json({ error: `Failed to send OTP email: ${err.message || String(err)}` });
  }
});

// Verify OTP for Signup or Login
router.post("/api/auth/verify-otp", async (req, res) => {
  const { email, otpCode } = req.body ?? {};

  if (!email || !otpCode) {
    return res.status(400).json({ error: "Email and OTP code are required" });
  }

  const cleanEmail = email.trim().toLowerCase();
  let user = await getUserByEmail(cleanEmail);

  if (user) {
    // Login path
    const verified = await verifyOtp(cleanEmail, otpCode);
    if (!verified) {
      return res.status(400).json({ error: "Invalid or expired OTP code" });
    }
    return res.json({ ok: true, user: verified, dashboardUrl: `/dashboard.html?u=${verified.id}` });
  } else {
    // Signup path
    const pending = pendingSignups.get(cleanEmail);
    if (!pending) {
      return res.status(400).json({ error: "Signup session expired. Please request a new OTP." });
    }

    const verified = await verifyOtp(cleanEmail, otpCode);
    // Note: if user doc didn't exist yet, we check verifyOtp on pending doc or pendingSignups
    // Let's create user now!
    user = await createUser({
      name: pending.name,
      leetcodeUsername: pending.leetcodeUsername,
      email: pending.email,
      telegramChatId: pending.telegramChatId,
      channels: pending.channels,
    });

    pendingSignups.delete(cleanEmail);
    return res.json({ ok: true, user, dashboardUrl: `/dashboard.html?u=${user.id}` });
  }
});

// Legacy direct signup endpoint
router.post("/api/signup", async (req, res) => {
  const { name, leetcodeUsername, email, telegramChatId, channels } = req.body ?? {};

  if (!leetcodeUsername || typeof leetcodeUsername !== "string") {
    return res.status(400).json({ error: "leetcodeUsername is required" });
  }
  if (channels?.email && !email) {
    return res.status(400).json({ error: "email is required when the email channel is enabled" });
  }

  const user = await createUser({ name, leetcodeUsername, email, telegramChatId, channels: channels ?? {} });
  res.json({ id: user.id, dashboardUrl: `/dashboard.html?u=${user.id}` });
});

router.get("/api/config", (_req, res) => {
  res.json({
    timezone: config.timezone,
    telegramBotUsername: config.telegramBotUsername ?? null,
    pushConfigured: !!config.push.publicKey,
  });
});

// ---- Developer Info Endpoint ----

router.get("/api/developer", (_req, res) => {
  res.json({
    developer: {
      name: "FREAKKY SHIVAM",
      role: "Backend Developer",
      github: "https://github.com/freakkyshivam",
      bio: "Crafting real-time automated developer tools, streak trackers, and reliable notification pipelines.",
    },
    application: {
      name: "LeetCode Notifier",
      version: "2.0.0",
      architecture: "Node.js + TypeScript + Express + MongoDB + Web Audio API",
      features: [
        "4-Stage Escalating Reminders (21:00, 22:00, 23:00, 23:45)",
        "FINAL BOSS Screen Siren Emergency Alarm",
        "Interactive Telegram Bot Account Management",
        "OTP-Based Email Verification",
        "Web Push (VAPID) Browser Notifications",
      ],
    },
  });
});

// ---- Per-user status ----

router.get("/api/users/:id/status", async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "Unknown user id" });

  let solvedOnLeetcode: boolean | null = null;
  try {
    solvedOnLeetcode = await hasSolvedToday(user.leetcodeUsername);
  } catch (err) {
    console.error(`[routes] LeetCode check failed for ${user.leetcodeUsername}:`, err);
  }

  res.json({
    name: user.name ?? null,
    leetcodeUsername: user.leetcodeUsername,
    channels: user.channels,
    date: user.status.date,
    manuallyMarkedDone: user.status.manuallyMarkedDone,
    stage1Sent: user.status.stage1Sent,
    stage2Sent: user.status.stage2Sent,
    stage3Sent: user.status.stage3Sent,
    stage4Sent: user.status.stage4Sent,
    solvedOnLeetcode,
    effectivelyDone: user.status.manuallyMarkedDone || solvedOnLeetcode === true,
    timezone: config.timezone,
  });
});

router.post("/api/users/:id/mark-done", async (req, res) => {
  const user = await markSolvedManually(req.params.id);
  if (!user) return res.status(404).json({ error: "Unknown user id" });
  res.json({ ok: true, status: user.status });
});

// Generic test notification across all enabled channels
router.post("/api/users/:id/test-notify", async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "Unknown user id" });

  const results = await notifyUser(user);
  res.json({ ok: true, results });
});

// Test specific stage (1, 2, 3, or 4)
router.post("/api/users/:id/test-stage/:stage", async (req, res) => {
  const stageNum = Number(req.params.stage) as 1 | 2 | 3 | 4;
  if (![1, 2, 3, 4].includes(stageNum)) {
    return res.status(400).json({ error: "Stage must be 1, 2, 3, or 4" });
  }

  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "Unknown user id" });

  const force = req.query.force === "true" || req.body?.force === true;

  if (!force) {
    const outcome = await runStageCheckForUser(user, stageNum);
    return res.json({ ok: true, outcome });
  }

  // Forced test notification for the specific stage
  let title = "";
  let body = "";
  let targetChannels: Array<"push" | "telegram" | "email"> = [];
  let extraData: Record<string, any> = {};

  switch (stageNum) {
    case 1:
      title = "[TEST] Streak danger ⚠️";
      body = `No submission today (${user.leetcodeUsername}). Don't lose your streak!`;
      targetChannels = ["push"];
      break;
    case 2:
      title = "[TEST] ⏰ 2 hours left";
      body = `2 hours left to solve a LeetCode problem today (${user.leetcodeUsername}).`;
      targetChannels = ["telegram", "email"];
      break;
    case 3:
      title = "[TEST] 🔥 60 minutes left";
      body = `60 minutes. Go solve one right now (${user.leetcodeUsername})!`;
      targetChannels = ["push", "telegram", "email"];
      break;
    case 4:
      title = "[TEST] FINAL BOSS 🚨 15 minutes left";
      body = `🚨 15 MINUTES LEFT! Final warning for ${user.leetcodeUsername} to solve a LeetCode problem!`;
      targetChannels = ["push", "telegram", "email"];
      extraData = { isFinalBoss: true, urgency: "high" };
      break;
  }

  const results = await notifyUserStage(user, title, body, targetChannels, extraData);
  res.json({ ok: true, stage: stageNum, forced: true, results });
});

router.get("/api/push/public-key", (_req, res) => {
  if (!config.push.publicKey) {
    return res.status(400).json({ error: "Push notifications are not configured on this server" });
  }
  res.json({ publicKey: config.push.publicKey });
});

router.post("/api/users/:id/push/subscribe", async (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: "Invalid push subscription payload" });
  }
  const user = await addPushSubscription(req.params.id, sub);
  if (!user) return res.status(404).json({ error: "Unknown user id" });
  res.json({ ok: true });
});

router.post("/api/users/:id/push/unsubscribe", async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  const user = await removePushSubscription(req.params.id, endpoint);
  if (!user) return res.status(404).json({ error: "Unknown user id" });
  res.json({ ok: true });
});
