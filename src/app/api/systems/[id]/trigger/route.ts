import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { maybeDecrypt } from "@/lib/crypto";
import { applySystem } from "@/lib/apply";

// Push endpoint: the scheduling system calls this to apply changes immediately
// instead of waiting for the next poll. Authenticated with the per-system
// bearer token (not the UI session).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const system = await prisma.system.findUnique({ where: { id } });
  if (!system) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const expected = maybeDecrypt(system.triggerToken);
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!system.enabled) {
    return NextResponse.json({ status: "skipped", message: "System disabled" });
  }

  const result = await applySystem(system, "push", { force: false });
  const httpStatus = result.status === "error" ? 502 : 200;
  return NextResponse.json(result, { status: httpStatus });
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
