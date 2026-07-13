import nodemailer, { type Transporter } from "nodemailer";
import { getAppConfig } from "../../appConfig";
import type { DeliveryResult, NotificationPayload, ProviderHandler } from "./types";

// Not cached across calls (unlike before) since the SMTP settings can now
// change at runtime from App Settings — a stale cached transporter would
// keep using the old host/credentials until a restart.
function getTransporter(): Transporter {
  const { smtpHost, smtpPort, smtpUser, smtpPass } = getAppConfig();
  if (!smtpHost) throw new Error("SMTP host is not configured (see /config)");
  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: smtpUser ? { user: smtpUser, pass: smtpPass ?? undefined } : undefined,
  });
}

export const emailProvider: ProviderHandler = {
  key: "email",
  async send(userConfig, notification: NotificationPayload): Promise<DeliveryResult> {
    const to = typeof userConfig.address === "string" ? userConfig.address : "";
    if (!to) {
      return { ok: false, error: "Missing email address" };
    }
    try {
      const { smtpFrom, smtpUser } = getAppConfig();
      const from = smtpFrom ?? smtpUser;
      if (!from) return { ok: false, error: "SMTP from address is not configured (see /config)" };
      await getTransporter().sendMail({
        from,
        to,
        subject: notification.title,
        text: notification.body,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
