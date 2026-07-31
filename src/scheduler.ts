import cron from "node-cron";
import { config } from "./config";
import { hasSolvedToday } from "./leetcode";
import { getAllUsers, getUser, markStageSent, User } from "./store";
import { notifyUserStage, ChannelResult } from "./notifiers";

export interface StageOutcome {
  userId: string;
  stage: 1 | 2 | 3 | 4;
  skippedReason?: "already-sent-stage" | "manual-override" | "solved";
  results?: ChannelResult[];
}

export async function runStageCheckForUser(user: User, stage: 1 | 2 | 3 | 4): Promise<StageOutcome> {
  const stageProp = `stage${stage}Sent` as "stage1Sent" | "stage2Sent" | "stage3Sent" | "stage4Sent";
  if (user.status[stageProp]) {
    return { userId: user.id, stage, skippedReason: "already-sent-stage" };
  }
  if (user.status.manuallyMarkedDone) {
    return { userId: user.id, stage, skippedReason: "manual-override" };
  }

  let solved: boolean;
  try {
    solved = await hasSolvedToday(user.leetcodeUsername);
  } catch (err) {
    console.error(`[scheduler] LeetCode check failed for ${user.leetcodeUsername}:`, err);
    solved = false; // fail open to remind user
  }

  if (solved) {
    return { userId: user.id, stage, skippedReason: "solved" };
  }

  let title = "LeetCode Reminder";
  let body = "";
  let targetChannels: Array<"push" | "telegram" | "email"> = [];
  let extraData: Record<string, any> = {};

  switch (stage) {
    case 1:
      title = "Streak danger ⚠️";
      body = `No submission today (${user.leetcodeUsername}). Don't lose your streak!`;
      targetChannels = ["push"];
      break;
    case 2:
      title = "⏰ 2 hours left";
      body = `2 hours left to solve a LeetCode problem today (${user.leetcodeUsername}).`;
      targetChannels = ["telegram", "email"];
      break;
    case 3:
      title = "🔥 60 minutes left";
      body = `60 minutes. Go solve one right now (${user.leetcodeUsername})!`;
      targetChannels = ["push", "telegram", "email"];
      break;
    case 4:
      title = "FINAL BOSS 🚨 15 minutes left";
      body = `🚨 15 MINUTES LEFT! Final warning for ${user.leetcodeUsername} to solve a LeetCode problem!`;
      targetChannels = ["push", "telegram", "email"];
      extraData = { isFinalBoss: true, urgency: "high" };
      break;
  }

  const results = await notifyUserStage(user, title, body, targetChannels, extraData);
  await markStageSent(user.id, stage);

  return { userId: user.id, stage, results };
}

export async function runStageCheckForAllUsers(stage: 1 | 2 | 3 | 4): Promise<StageOutcome[]> {
  const users = await getAllUsers();
  const outcomes: StageOutcome[] = [];

  for (const user of users) {
    const outcome = await runStageCheckForUser(user, stage);
    outcomes.push(outcome);

    if (outcome.skippedReason) {
      console.log(`[scheduler] Stage ${stage} - ${user.leetcodeUsername}: skipped (${outcome.skippedReason})`);
    } else {
      outcome.results?.forEach((r) => {
        if (r.ok) console.log(`[scheduler] Stage ${stage} - ${user.leetcodeUsername}: ${r.channel} sent`);
        else console.error(`[scheduler] Stage ${stage} - ${user.leetcodeUsername}: ${r.channel} FAILED - ${r.error}`);
      });
    }
  }

  return outcomes;
}

export function startScheduler(): void {
  const timezone = config.timezone;

  // Stage 1: 9:00 PM (21:00)
  cron.schedule("0 21 * * *", () => {
    console.log("[scheduler] Triggering Stage 1 (21:00)...");
    runStageCheckForAllUsers(1).catch((err) => console.error("[scheduler] Error in Stage 1:", err));
  }, { timezone });

  // Stage 2: 10:00 PM (22:00)
  cron.schedule("0 22 * * *", () => {
    console.log("[scheduler] Triggering Stage 2 (22:00)...");
    runStageCheckForAllUsers(2).catch((err) => console.error("[scheduler] Error in Stage 2:", err));
  }, { timezone });

  // Stage 3: 11:00 PM (23:00)
  cron.schedule("0 23 * * *", () => {
    console.log("[scheduler] Triggering Stage 3 (23:00)...");
    runStageCheckForAllUsers(3).catch((err) => console.error("[scheduler] Error in Stage 3:", err));
  }, { timezone });

  // Stage 4: 11:45 PM (23:45) - FINAL BOSS
  cron.schedule("45 23 * * *", () => {
    console.log("[scheduler] Triggering Stage 4 FINAL BOSS (23:45)...");
    runStageCheckForAllUsers(4).catch((err) => console.error("[scheduler] Error in Stage 4:", err));
  }, { timezone });

  console.log(`[scheduler] 4-Stage Escalation Scheduler started in timezone ${timezone}:`);
  console.log(`  Stage 1 (Push warning): 21:00`);
  console.log(`  Stage 2 (Telegram/Email): 22:00`);
  console.log(`  Stage 3 (Strong reminder): 23:00`);
  console.log(`  Stage 4 (FINAL BOSS 🚨): 23:45`);
}
