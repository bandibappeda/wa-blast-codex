import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppConfig } from "../../config";

export function sessionCookieName(config: AppConfig): string {
  return config.sessionCookieSecure ? "__Host-session" : "session";
}

export function readSessionCookie(
  context: Context,
  config: AppConfig,
): string | undefined {
  return getCookie(context, sessionCookieName(config));
}

export function writeSessionCookie(
  context: Context,
  config: AppConfig,
  token: string,
): void {
  setCookie(context, sessionCookieName(config), token, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: "Strict",
    path: "/",
    maxAge: config.sessionTtlHours * 60 * 60,
  });
}

export function clearSessionCookie(context: Context, config: AppConfig): void {
  deleteCookie(context, sessionCookieName(config), {
    secure: config.sessionCookieSecure,
    sameSite: "Strict",
    path: "/",
  });
}
