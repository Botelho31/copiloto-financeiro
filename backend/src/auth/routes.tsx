import { Elysia } from "elysia";
import { config } from "../config";
import { redirectTo } from "../lib/redirect";
import { LoginPage } from "../pages/Login";
import { SetupPage } from "../pages/Setup";
import { createAdmin, hasAdmin, verifyAdmin } from "./admin";
import { clearAttempts, isRateLimited, recordAttempt } from "./rateLimit";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSession,
  destroySession,
} from "./session";

const sessionCookieOptions = {
  httpOnly: true,
  secure: !config.isDev,
  sameSite: "lax" as const,
  path: "/",
};

function clientIp(
  request: Request,
  server: { requestIP(req: Request): { address: string } | null } | null
): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    server?.requestIP(request)?.address ??
    "unknown"
  );
}

export const authRoutes = new Elysia()
  .get("/setup", ({ set }) => {
    if (hasAdmin()) return redirectTo(set, "/login");
    return <SetupPage />;
  })
  .post("/setup", async ({ body, set }) => {
    if (hasAdmin()) return redirectTo(set, "/login");
    const { username, password } = body as { username?: string; password?: string };
    if (!username || !password || password.length < 8) {
      return <SetupPage error="Username and a password of at least 8 characters are required." />;
    }
    await createAdmin(username, password);
    return redirectTo(set, "/login");
  })
  .get("/login", ({ set }) => {
    if (!hasAdmin()) return redirectTo(set, "/setup");
    return <LoginPage />;
  })
  .post("/login", async ({ body, cookie, request, server, set }) => {
    if (!hasAdmin()) return redirectTo(set, "/setup");

    const ip = clientIp(request, server);
    if (isRateLimited(ip)) {
      return <LoginPage error="Too many attempts. Try again in a few minutes." />;
    }

    const { username, password } = body as { username?: string; password?: string };
    const ok = !!username && !!password && (await verifyAdmin(username, password));
    if (!ok) {
      recordAttempt(ip);
      return <LoginPage error="Invalid username or password." />;
    }

    clearAttempts(ip);
    const { token } = createSession();
    cookie[SESSION_COOKIE_NAME]?.set({
      value: token,
      ...sessionCookieOptions,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return redirectTo(set, "/");
  })
  .post("/logout", ({ cookie, set }) => {
    destroySession(cookie[SESSION_COOKIE_NAME]?.value as string | undefined);
    cookie[SESSION_COOKIE_NAME]?.remove();
    return redirectTo(set, "/login");
  });
