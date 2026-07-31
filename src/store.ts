import crypto from "crypto";
import { todayInTimezone } from "./leetcode";
import { UserModel, IUser, PushSubscriptionJSON, UserChannels, DailyStatus } from "./models/User";

export { PushSubscriptionJSON, UserChannels, DailyStatus };

export interface User {
  id: string;
  name?: string;
  leetcodeUsername: string;
  email?: string;
  telegramChatId?: string;
  channels: UserChannels;
  createdAt: string;
  status: DailyStatus;
  pushSubscriptions: PushSubscriptionJSON[];
}

export type NewUserInput = {
  name?: string;
  leetcodeUsername: string;
  email?: string;
  telegramChatId?: string;
  channels: Partial<UserChannels>;
};

function freshStatus(): DailyStatus {
  return {
    date: todayInTimezone(),
    manuallyMarkedDone: false,
    stage1Sent: false,
    stage2Sent: false,
    stage3Sent: false,
    stage4Sent: false,
  };
}

/** Converts Mongoose document to plain User object and handles date rollover. */
async function toUserAndCheckRollover(doc: IUser): Promise<User> {
  const today = todayInTimezone();
  if (doc.status.date !== today) {
    doc.status = freshStatus();
    await doc.save();
  }

  return {
    id: doc.id,
    name: doc.name,
    leetcodeUsername: doc.leetcodeUsername,
    email: doc.email,
    telegramChatId: doc.telegramChatId,
    channels: doc.channels,
    createdAt: doc.createdAt,
    status: doc.status,
    pushSubscriptions: doc.pushSubscriptions,
  };
}

export async function getAllUsers(): Promise<User[]> {
  const docs = await UserModel.find();
  return Promise.all(docs.map(toUserAndCheckRollover));
}

export async function getUser(id: string): Promise<User | null> {
  const doc = await UserModel.findOne({ id });
  if (!doc) return null;
  return toUserAndCheckRollover(doc);
}

export async function getUserByTelegramChatId(chatId: string): Promise<User | null> {
  const doc = await UserModel.findOne({ telegramChatId: chatId });
  if (!doc) return null;
  return toUserAndCheckRollover(doc);
}

export async function createUser(input: NewUserInput): Promise<User> {
  const id = crypto.randomUUID();
  const newUser = new UserModel({
    id,
    name: input.name?.trim() || undefined,
    leetcodeUsername: input.leetcodeUsername.trim(),
    email: input.email?.trim() || undefined,
    telegramChatId: input.telegramChatId?.trim() || undefined,
    channels: {
      email: !!input.channels.email,
      telegram: !!input.channels.telegram,
      push: !!input.channels.push,
    },
    createdAt: new Date().toISOString(),
    status: freshStatus(),
    pushSubscriptions: [],
  });

  await newUser.save();
  return toUserAndCheckRollover(newUser);
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  const doc = await UserModel.findOne({ id });
  if (!doc) return null;

  if (updates.name !== undefined) doc.name = updates.name.trim() || undefined;
  if (updates.leetcodeUsername !== undefined) doc.leetcodeUsername = updates.leetcodeUsername.trim();
  if (updates.email !== undefined) doc.email = updates.email.trim() || undefined;
  if (updates.telegramChatId !== undefined) doc.telegramChatId = updates.telegramChatId.trim() || undefined;
  if (updates.channels) {
    doc.channels = { ...doc.channels, ...updates.channels };
  }

  await doc.save();
  return toUserAndCheckRollover(doc);
}

export async function markSolvedManually(id: string): Promise<User | null> {
  const doc = await UserModel.findOne({ id });
  if (!doc) return null;
  doc.status.manuallyMarkedDone = true;
  await doc.save();
  return toUserAndCheckRollover(doc);
}

export async function markStageSent(id: string, stage: 1 | 2 | 3 | 4): Promise<User | null> {
  const doc = await UserModel.findOne({ id });
  if (!doc) return null;
  if (stage === 1) doc.status.stage1Sent = true;
  if (stage === 2) doc.status.stage2Sent = true;
  if (stage === 3) doc.status.stage3Sent = true;
  if (stage === 4) doc.status.stage4Sent = true;
  await doc.save();
  return toUserAndCheckRollover(doc);
}

export async function addPushSubscription(id: string, sub: PushSubscriptionJSON): Promise<User | null> {
  const doc = await UserModel.findOne({ id });
  if (!doc) return null;
  if (!doc.pushSubscriptions.some((s) => s.endpoint === sub.endpoint)) {
    doc.pushSubscriptions.push(sub);
    await doc.save();
  }
  return toUserAndCheckRollover(doc);
}

export async function removePushSubscription(id: string, endpoint: string): Promise<User | null> {
  const doc = await UserModel.findOne({ id });
  if (!doc) return null;
  doc.pushSubscriptions = doc.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
  await doc.save();
  return toUserAndCheckRollover(doc);
}

export async function removePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await UserModel.updateMany(
    {},
    { $pull: { pushSubscriptions: { endpoint } } }
  );
}
