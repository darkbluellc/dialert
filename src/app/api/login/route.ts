import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { externalUrl } from "@/lib/url";

// Constant-time password comparison to avoid timing side channels.
function passwordMatches(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still do a comparison to keep timing roughly constant.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/") || "/";

  const target = next.startsWith("/") ? next : "/";

  if (!passwordMatches(password, env.appPassword())) {
    const url = externalUrl(req, "/login");
    url.searchParams.set("error", "1");
    if (target !== "/") url.searchParams.set("next", target);
    return NextResponse.redirect(url, { status: 303 });
  }

  const res = NextResponse.redirect(externalUrl(req, target), { status: 303 });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  return res;
}
