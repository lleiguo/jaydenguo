import type { NextResponse } from "next/server";
import { appUrl } from "../config";
import { SESSION_COOKIE } from "./tokens";

// HttpOnly, SameSite=Lax, and Secure whenever the site runs on HTTPS (always
// in production; local runs and tests use plain http://localhost).
export function setSessionCookie(res: NextResponse, token: string, expires: Date) {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: appUrl().protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: appUrl().protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
