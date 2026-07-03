import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { externalUrl } from "@/lib/url";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(externalUrl(req, "/login"), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
