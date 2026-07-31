import mongoose, { Schema, Document } from "mongoose";

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface UserChannels {
  email: boolean;
  telegram: boolean;
  push: boolean;
}

export interface DailyStatus {
  date: string;
  manuallyMarkedDone: boolean;
  stage1Sent: boolean;
  stage2Sent: boolean;
  stage3Sent: boolean;
  stage4Sent: boolean;
}

export interface IUser extends Document {
  id: string; // custom string UUID or unique identifier
  name?: string;
  leetcodeUsername: string;
  email?: string;
  telegramChatId?: string;
  channels: UserChannels;
  createdAt: string;
  status: DailyStatus;
  pushSubscriptions: PushSubscriptionJSON[];
  otpCode?: string;
  otpExpiresAt?: Date;
}

const UserSchema = new Schema<IUser>({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String },
  leetcodeUsername: { type: String, required: true, trim: true },
  email: { type: String, trim: true, index: true },
  telegramChatId: { type: String, trim: true, index: true },
  channels: {
    email: { type: Boolean, default: false },
    telegram: { type: Boolean, default: false },
    push: { type: Boolean, default: false },
  },
  createdAt: { type: String, default: () => new Date().toISOString() },
  status: {
    date: { type: String, required: true },
    manuallyMarkedDone: { type: Boolean, default: false },
    stage1Sent: { type: Boolean, default: false },
    stage2Sent: { type: Boolean, default: false },
    stage3Sent: { type: Boolean, default: false },
    stage4Sent: { type: Boolean, default: false },
  },
  pushSubscriptions: [
    {
      endpoint: { type: String, required: true },
      keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true },
      },
    },
  ],
  otpCode: { type: String },
  otpExpiresAt: { type: Date },
});

export const UserModel = mongoose.model<IUser>("User", UserSchema);
