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
 * Only tiers that have members are written; empty tiers are skipped (left
 * untouched on the PBX). Each written tier chains to the next written tier; the
 * last goes to the system's configured final destination.
 *
 * Tier numbering depends on `maintainStructure`:
 *   - false (default): sequential by position (<prefix>1, <prefix>2, ...), so
 *     tiers collapse to the lowest numbers when some are empty.
 *   - true: the tier's priority sets its number (<prefix><priority>), so
 *     numbering stays stable and an empty priority is bypassed (priority 1
 *     chains straight to priority 3).
 */
export function buildUpdates(system: System, groups: ScheduleGroup[]): RingGroupUpdate[] {
  const finalPostAnswer = toPostAnswer(finalDestOf(system));

  // Skip tiers with no members — they are left untouched on the PBX.
  const populated = groups.filter((g) => g.recipients.length > 0);

  // The number assigned to a populated tier at position `i`.
  const tierNumber = (group: ScheduleGroup, i: number): number =>
    system.maintainStructure ? group.priority : i + 1;

  // Optional per-tier ring time overrides, keyed by tier number.
  const overrides = (system.ringTimeOverrides ?? {}) as Record<string, number>;
  const defaultRingTime =
    populated.length === 1 ? system.ringTimeSingle : system.ringTimeMulti;

  return populated.map((group, i) => {
    const num = tierNumber(group, i);
    const groupNumber = `${system.ringGroupPrefix}${num}`;
    const extensionList = group.recipients.map((r) => `${r.number}#`).join("-");
    const override = overrides[String(num)];
    const ringTime = typeof override === "number" ? override : defaultRingTime;

    const isLast = i === populated.length - 1;
    const postAnswer = isLast
      ? finalPostAnswer
      : `ext-group,${system.ringGroupPrefix}${tierNumber(populated[i + 1], i + 1)},1`;

    const description = system.descriptionTemplate
      .replace(/\{name\}/g, system.name)
      .replace(/\{n\}/g, String(num));

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
      // No change — just record that we polled. We deliberately do NOT write an
      // ApplyEvent here; unchanged polls happen every cron tick and would swamp
      // the audit log. lastPolledAt/lastStatus reflect that polling is healthy.
      await prisma.system.update({
        where: { id: system.id },
        data: { lastPolledAt: now, lastStatus: system.lastError ? system.lastStatus : "ok" },
      });
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
