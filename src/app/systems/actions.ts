"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { maybeEncrypt, encrypt } from "@/lib/crypto";
import { parseSystemForm } from "@/lib/validation";
import { applySystem, previewSystem } from "@/lib/apply";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Create or update a system (distinguished by a hidden `id` field). */
export async function saveSystemAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const id = String(form.get("id") ?? "");
  const parsed = parseSystemForm(form);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }

  const d = parsed.data;
  const common = {
    name: d.name,
    slug: d.slug,
    description: d.description || null,
    enabled: d.enabled,
    scheduleUrl: d.scheduleUrl,
    scheduleHeaderName: d.scheduleHeaderName,
    ringGroupPrefix: d.ringGroupPrefix,
    callerId: d.callerId || null,
    ringStrategy: d.ringStrategy,
    ringTimeSingle: d.ringTimeSingle,
    ringTimeMulti: d.ringTimeMulti,
    descriptionTemplate: d.descriptionTemplate,
    maintainStructure: d.maintainStructure,
    keepEntryGroup: d.keepEntryGroup,
    entryGroupMode: d.entryGroupMode,
    internalExtMinLen: d.internalExtMinLen,
    internalExtMaxLen: d.internalExtMaxLen,
    ringTimeOverrides: d.ringTimeOverrides,
    finalDestType: d.finalDestType,
    finalDestValue: d.finalDestValue || null,
    finalDestSubtype: d.finalDestSubtype || null,
    cronString: d.cronString,
    timezone: d.timezone,
  };

  let slug = d.slug;
  try {
    if (id) {
      // On edit, only overwrite the schedule token if a new one was entered.
      const data: Prisma.SystemUpdateInput = { ...common };
      if (d.scheduleToken && d.scheduleToken.length > 0) {
        data.scheduleToken = encrypt(d.scheduleToken);
      }
      const updated = await prisma.system.update({ where: { id }, data });
      slug = updated.slug;
    } else {
      const created = await prisma.system.create({
        data: {
          ...common,
          scheduleToken: maybeEncrypt(d.scheduleToken || null),
          triggerToken: encrypt(crypto.randomBytes(24).toString("hex")),
        },
      });
      slug = created.slug;
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "That slug is already in use.", fieldErrors: { slug: "Already in use" } };
    }
    return { error: `Save failed: ${(err as Error).message}` };
  }

  revalidatePath("/");
  revalidatePath(`/systems/${slug}`);
  redirect(`/systems/${slug}`);
}

export async function deleteSystemAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  if (id) await prisma.system.delete({ where: { id } });
  revalidatePath("/");
  redirect("/");
}

export async function applyNowAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  const system = await prisma.system.findUnique({ where: { id } });
  if (system) await applySystem(system, "manual", { force: true });
  revalidatePath(`/systems/${system?.slug ?? ""}`);
  revalidatePath("/");
}

export async function pollNowAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  const system = await prisma.system.findUnique({ where: { id } });
  if (system) await applySystem(system, "manual", { force: false });
  revalidatePath(`/systems/${system?.slug ?? ""}`);
  revalidatePath("/");
}

export async function regenerateTriggerTokenAction(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  const system = await prisma.system.findUnique({ where: { id } });
  if (!system) return;
  await prisma.system.update({
    where: { id },
    data: { triggerToken: encrypt(crypto.randomBytes(24).toString("hex")) },
  });
  revalidatePath(`/systems/${system.slug}`);
}

export interface PreviewState {
  ok?: boolean;
  error?: string;
  hash?: string;
  finalDestination?: string;
  tiers?: { groupNumber: string; members: string; ringTime: number; postAnswer: string }[];
}

/** Dry-run: fetch the schedule and show the resulting chain without applying. */
export async function previewAction(
  _prev: PreviewState,
  form: FormData,
): Promise<PreviewState> {
  const id = String(form.get("id") ?? "");
  const system = await prisma.system.findUnique({ where: { id } });
  if (!system) return { error: "System not found" };
  try {
    const preview = await previewSystem(system);
    return {
      ok: true,
      hash: preview.hash,
      finalDestination: preview.finalDestination,
      tiers: preview.updates.map((u) => ({
        groupNumber: u.groupNumber,
        members: u.extensionList.replace(/#/g, "").replace(/-/g, ", "),
        ringTime: u.ringTime,
        postAnswer: u.postAnswer,
      })),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
