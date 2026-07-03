import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { externalUrl } from "@/lib/url";

// Protect every route except the login page, the login API, and static assets.
const PUBLIC_PATHS = ["/login", "/api/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The push-trigger endpoint authenticates with its own bearer token.
  if (pathname.startsWith("/api/systems/") && pathname.endsWith("/trigger")) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) {
    return NextResponse.next();
  }

  // API routes get a 401; page routes redirect to login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = externalUrl(req, "/login");
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Exclude Next internals and static files from the middleware.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
