import { emailProvider } from "./email";
import { pushoverProvider } from "./pushover";
import type { ProviderHandler } from "./types";

export type { DeliveryResult, NotificationPayload, ProviderHandler } from "./types";

// Adding a provider is: write a new ProviderHandler (see pushover.ts/
// email.ts for the shape) and register it here — nothing else in the
// dispatch/routes layer needs to change, since both key off this registry
// rather than a hardcoded provider list.
export const PROVIDER_HANDLERS: Record<string, ProviderHandler> = {
  pushover: pushoverProvider,
  email: emailProvider,
};
