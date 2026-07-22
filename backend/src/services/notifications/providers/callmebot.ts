import type { DeliveryResult, NotificationPayload, ProviderHandler } from "./types";

// Free WhatsApp-via-HTTP-GET bot (callmebot.com) — unlike Pushover/email,
// there's no app-wide credential: each person gets their own apikey by
// messaging CallMeBot's WhatsApp number once to opt in, tied to their own
// phone number, so both fields live entirely in the person's own config row.
export const callmebotProvider: ProviderHandler = {
  key: "callmebot",
  async send(userConfig, notification: NotificationPayload): Promise<DeliveryResult> {
    const phone = typeof userConfig.phone === "string" ? userConfig.phone.trim() : "";
    const apikey = typeof userConfig.apikey === "string" ? userConfig.apikey.trim() : "";
    if (!phone || !apikey) {
      return { ok: false, error: "Missing CallMeBot phone number or API key" };
    }

    const url = new URL("https://api.callmebot.com/whatsapp.php");
    url.searchParams.set("phone", phone);
    url.searchParams.set("text", `${notification.title}\n${notification.body}`);
    url.searchParams.set("apikey", apikey);

    const res = await fetch(url);
    const body = await res.text();
    // CallMeBot returns HTTP 200 even for several error cases (invalid key,
    // phone never opted in) — the actual outcome is only in the body text,
    // which it sends as loose HTML fragments (<p>, <b>) even though this is
    // meant to be read as plain text, so strip tags before surfacing it.
    if (!res.ok || !/message queued/i.test(body)) {
      const plainText = body
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { ok: false, error: `CallMeBot: ${plainText || `HTTP ${res.status}`}` };
    }
    return { ok: true };
  },
};
