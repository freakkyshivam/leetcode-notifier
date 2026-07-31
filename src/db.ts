import mongoose from "mongoose";
import { config } from "./config";

export async function connectDB(): Promise<void> {
  const uri = config.mongodbUri;
  if (!uri) {
    throw new Error("MONGODB_URI is not defined in environment variables or configuration.");
  }

  try {
    await mongoose.connect(uri);
    console.log("[db] Successfully connected to MongoDB.");
  } catch (error) {
    console.error("[db] Error connecting to MongoDB:", error);
    throw error;
  }
}
