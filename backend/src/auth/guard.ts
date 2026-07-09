import { Elysia } from "elysia";
import { redirectTo } from "../lib/redirect";
import { SESSION_COOKIE_NAME, verifySession } from "./session";

const PUBLIC_PATHS = new Set(["/login", "/setup", "/api/health"]);

export const authGuard = new Elysia().onBeforeHandle(
  { as: "global" },
  ({ path, cookie, set }) => {
    if (PUBLIC_PATHS.has(path) || path.startsWith("/public/")) return;

    const token = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;
    if (verifySession(token)) return;

    if (path.startsWith("/api/")) {
      set.status = 401;
      return { error: "unauthorized" };
    }

    return redirectTo(set, "/login");
  }
);
