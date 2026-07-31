import { Router } from "express";
import { config } from "./config";
import { hasSolvedToday } from "./leetcode";
import {
  createUser,
  getUser,
  markSolvedManually,
  addPushSubscription,
  removePushSubscription,
} from "./store";
import { notifyUser, notifyUserStage } from "./notifiers";
import { runStageCheckForUser } from "./scheduler";

export const router = Router();

// ---- Signup ----

router.post("/api/signup", async (req, res) => {
  const { name, leetcodeUsername, email, telegramChatId, channels } = req.body ?? {};

  if (!leetcodeUsername || typeof leetcodeUsername !== "string") {
    return res.status(400).json({ error: "leetcodeUsername is required" });
  }
  if (channels?.email && !email) {
    return res.status(400).json({ error: "email is required when the email channel is enabled" });
  }
  if (channels?.telegram && !telegramChatId) {
    return res.status(400).json({ error: "telegramChatId is required when the telegram channel is enabled" });
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
