import type { NextRequest } from "next/server";

// Build an absolute URL for redirects that respects the PUBLIC host/proto when
// the app runs behind a reverse proxy (e.g. Coolify/Traefik). Using req.url
// directly would send users to the internal origin (e.g. localhost:3000).
export function externalUrl(req: NextRequest, path: string): URL {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host") || req.nextUrl.host;

  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || req.nextUrl.protocol.replace(/:$/, "");

  return new URL(path, `${proto}://${host}`);
}
