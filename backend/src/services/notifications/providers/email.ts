import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../../../config";
import type { DeliveryResult, NotificationPayload, ProviderHandler } from "./types";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    if (!config.smtpHost) throw new Error("SMTP_HOST is not configured on the server");
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    });
  }
  return transporter;
}

export const emailProvider: ProviderHandler = {
  key: "email",
  async send(userConfig, notification: NotificationPayload): Promise<DeliveryResult> {
    const to = typeof userConfig.address === "string" ? userConfig.address : "";
    if (!to) {
      return { ok: false, error: "Missing email address" };
    }
    try {
      const from = config.smtpFrom ?? config.smtpUser;
      if (!from) return { ok: false, error: "SMTP_FROM (or SMTP_USER) is not configured" };
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
