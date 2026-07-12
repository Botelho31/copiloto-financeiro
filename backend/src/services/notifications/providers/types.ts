export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
}

// One handler per provider key (matches notification_providers.provider).
// `config` is that person's own provider-specific config row, already
// JSON-parsed — Pushover's is `{ userKey }`, email's is `{ address }`.
export interface ProviderHandler {
  key: string;
  send(config: Record<string, unknown>, notification: NotificationPayload): Promise<DeliveryResult>;
}
