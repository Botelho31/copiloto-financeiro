import { config } from "../../../config";
import type { DeliveryResult, NotificationPayload, ProviderHandler } from "./types";

// Plain fetch, no SDK — Pushover's API is one form-encoded POST, matching
// the style already used for Pluggy (pluggy/client.ts) rather than adding a
// dependency for a single HTTP call.
export const pushoverProvider: ProviderHandler = {
  key: "pushover",
  async send(userConfig, notification: NotificationPayload): Promise<DeliveryResult> {
    if (!config.pushoverAppToken) {
      return { ok: false, error: "PUSHOVER_APP_TOKEN is not configured on the server" };
    }
    const userKey = typeof userConfig.userKey === "string" ? userConfig.userKey : "";
    if (!userKey) {
      return { ok: false, error: "Missing Pushover user key" };
    }

    const res = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: config.pushoverAppToken,
        user: userKey,
        title: notification.title,
        message: notification.body,
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `Pushover ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  },
};
