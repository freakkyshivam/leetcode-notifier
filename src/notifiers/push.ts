import webpush from "web-push";
import { config } from "../config";
import { PushSubscriptionJSON, removePushSubscriptionByEndpoint } from "../store";

let configured = false;

function ensureConfigured() {
  const { publicKey, privateKey, subject } = config.push;
  if (!publicKey || !privateKey) {
    throw new Error("Push is not configured on the server: set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY");
  }
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
}

export async function sendPush(
  subscriptions: PushSubscriptionJSON[],
  title: string,
  body: string,
  extraData: Record<string, any> = {}
): Promise<void> {
  ensureConfigured();

  if (subscriptions.length === 0) {
    throw new Error("Push is enabled but this user hasn't enabled browser notifications on any device yet");
  }

  const payload = JSON.stringify({ title, body, ...extraData });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub as any, payload);
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await removePushSubscriptionByEndpoint(sub.endpoint);
        } else {
          throw err;
        }
      }
    })
  );
}
