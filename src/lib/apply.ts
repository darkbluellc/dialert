import type { System } from "@prisma/client";
import { prisma } from "./prisma";
import { maybeDecrypt } from "./crypto";
import { fetchSchedule, ScheduleError, type ScheduleGroup } from "./schedule";
import { applyRingGroups, resolveCreds, type RingGroupUpdate } from "./freepbx";
import { toPostAnswer, describeDestination, type FinalDestination } from "./destinations";
import { sendErrorEmail } from "./mailer";

export type Trigger = "cron" | "manual" | "push";

export interface ApplyResult {
  status: "ok" | "skipped" | "error";
  message: string;
  hash?: string;
  updates?: RingGroupUpdate[];
}

function finalDestOf(system: System): FinalDestination {
  return {
    type: system.finalDestType as FinalDestination["type"],
    value: system.finalDestValue,
    subtype: system.finalDestSubtype,
  };
}

/**
 * Build the ordered ring-group updates for a system from a normalized schedule.
 * Intermediate tiers chain to the next tier; the last tier goes to the
 * system's configured final destination.
 */
export function buildUpdates(system: System, groups: ScheduleGroup[]): RingGroupUpdate[] {
  const finalPostAnswer = toPostAnswer(finalDestOf(system));

  return groups.map((group, i) => {
    const groupNumber = `${system.ringGroupPrefix}${i + 1}`;
    const extensionList = group.recipients.map((r) => `${r.number}#`).join("-");
    const ringTime = groups.length === 1 ? system.ringTimeSingle : system.ringTimeMulti;
    const isLast = i === groups.length - 1;
    const postAnswer = isLast
      ? finalPostAnswer
      : `ext-group,${system.ringGroupPrefix}${i + 2},1`;

    const description = system.descriptionTemplate
      .replace(/\{name\}/g, system.name)
      .replace(/\{n\}/g, String(i + 1));

    return {
      groupNumber,
      description,
      extensionList,
      strategy: system.ringStrategy,
      ringTime,
      postAnswer,
      callerId: system.callerId,
    };
  });
}

/** Preview (dry run): fetch the schedule and compute updates without applying. */
export async function previewSystem(system: System): Promise<{
  hash: string;
  groups: ScheduleGroup[];
  updates: RingGroupUpdate[];
  finalDestination: string;
}> {
  const schedule = await fetchSchedule({
    url: system.scheduleUrl,
    token: maybeDecrypt(system.scheduleToken),
    headerName: system.scheduleHeaderName,
  });
  return {
    hash: schedule.hash,
    groups: schedule.groups,
    updates: buildUpdates(system, schedule.groups),
    finalDestination: describeDestination(finalDestOf(system)),
  };
}

/**
 * Run a full apply cycle for a system: fetch schedule, skip if unchanged
 * (unless `force`), push ring groups to FreePBX, and persist status + an
 * ApplyEvent. Errors are caught, recorded, and emailed (with cooldown).
 */
export async function applySystem(
  system: System,
  trigger: Trigger,
  opts: { force?: boolean } = {},
): Promise<ApplyResult> {
  const now = new Date();

  try {
    const schedule = await fetchSchedule({
      url: system.scheduleUrl,
      token: maybeDecrypt(system.scheduleToken),
      headerName: system.scheduleHeaderName,
    });

    if (!opts.force && schedule.hash === system.lastHash) {
      await prisma.system.update({
        where: { id: system.id },
        data: { lastPolledAt: now, lastStatus: system.lastError ? system.lastStatus : "ok" },
      });
      await recordEvent(system.id, trigger, "skipped", "No schedule change", schedule.hash);
      return { status: "skipped", message: "No schedule change", hash: schedule.hash };
    }

    const updates = buildUpdates(system, schedule.groups);
    const creds = resolveCreds({
      apiUrl: system.pbxApiUrl ?? undefined,
      gqlUrl: system.pbxGqlUrl ?? undefined,
      clientId: system.pbxClientId ?? undefined,
      clientSecret: maybeDecrypt(system.pbxClientSecret) ?? undefined,
      scope: system.pbxScope ?? undefined,
    });

    // Throws on any HTTP or GraphQL-level failure.
    await applyRingGroups(creds, updates);

    const message = `Applied ${updates.length} ring group(s)`;
    await prisma.system.update({
      where: { id: system.id },
      data: {
        lastHash: schedule.hash,
        lastAppliedAt: now,
        lastPolledAt: now,
        lastStatus: "ok",
        lastError: null,
      },
    });
    await recordEvent(system.id, trigger, "ok", message, schedule.hash);
    return { status: "ok", message, hash: schedule.hash, updates };
  } catch (err) {
    const message =
      err instanceof ScheduleError
        ? err.message
        : `${(err as Error).message ?? "Unknown error"}`;

    await prisma.system.update({
      where: { id: system.id },
      data: { lastPolledAt: now, lastStatus: "error", lastError: message },
    });
    await recordEvent(system.id, trigger, "error", message);
    await sendErrorEmail(system.name, message);
    return { status: "error", message };
  }
}

async function recordEvent(
  systemId: string,
  trigger: Trigger,
  status: "ok" | "skipped" | "error",
  message: string,
  hash?: string,
): Promise<void> {
  try {
    await prisma.applyEvent.create({
      data: { systemId, trigger, status, message, hash },
    });
  } catch (err) {
    console.error(`Failed to record apply event: ${(err as Error).message}`);
  }
}
