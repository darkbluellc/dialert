import type { System } from "@prisma/client";
import { prisma } from "./prisma";
import { maybeDecrypt } from "./crypto";
import { fetchSchedule, ScheduleError, type ScheduleGroup, type Recipient } from "./schedule";
import { applyRingGroups, resolveCreds, type RingGroupUpdate } from "./freepbx";
import {
  toPostAnswer,
  describeDestination,
  type FinalDestination,
  type FinalDestType,
} from "./destinations";
import { sendErrorEmail } from "./mailer";

export type Trigger = "cron" | "manual" | "push";

// The tier number the inbound route lands on (<prefix>1). Member-less groups
// (entry pass-throughs, forced-empty tiers) use a tiny ring time since they
// fall straight through to their destination.
const ENTRY_TIER = 1;
const EMPTY_GROUP_RING_TIME = 1;

// Per-tier declaration stored on the system (only used in maintain mode).
interface TierConfigEntry {
  forceEmpty?: boolean;
  destType?: "next" | "ring_group" | "extension" | "terminate";
  destValue?: string | null;
  destSubtype?: string | null;
}

/**
 * Format a recipient number for a FreePBX ring group extension list. External
 * numbers get a trailing "#" so they dial out; internal extensions (digit count
 * within the system's configured range) are listed as-is so they ring
 * internally instead of hitting an outbound route.
 */
function formatMember(number: string, minLen: number | null, maxLen: number | null): string {
  const digits = number.replace(/\D/g, "").length;
  const hasRange = minLen != null || maxLen != null;
  const internal =
    hasRange && (minLen == null || digits >= minLen) && (maxLen == null || digits <= maxLen);
  return internal ? number : `${number}#`;
}

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
 * Only tiers that have members (or are explicitly declared) are written; other
 * tiers are skipped and left untouched on the PBX. Each written tier chains to
 * the next written tier — jumping across un-written ones — and the last goes to
 * the system's configured final destination.
 *
 * Collapse mode (maintainStructure = false): tiers numbered sequentially by
 * position (<prefix>1, <prefix>2, …), collapsing to the lowest numbers.
 *
 * Maintain mode (maintainStructure = true): tiers numbered by priority
 * (<prefix><priority>) so numbering stays stable. In this mode a per-system
 * tier declaration (tierCount + tierConfig) can additionally force specific
 * tiers to be member-less and/or route to a fixed destination.
 */
export function buildUpdates(system: System, groups: ScheduleGroup[]): RingGroupUpdate[] {
  const finalPostAnswer = toPostAnswer(finalDestOf(system));
  const overrides = (system.ringTimeOverrides ?? {}) as Record<string, number>;
  const populated = groups.filter((g) => g.recipients.length > 0);

  const renderDescription = (n: number): string =>
    system.descriptionTemplate.replace(/\{name\}/g, system.name).replace(/\{n\}/g, String(n));
  const fmt = (recipients: Recipient[]): string =>
    recipients
      .map((r) => formatMember(r.number, system.internalExtMinLen, system.internalExtMaxLen))
      .join("-");

  // --- Collapse mode: sequential numbering, skip empty tiers. ---
  if (!system.maintainStructure) {
    const defaultRingTime = populated.length === 1 ? system.ringTimeSingle : system.ringTimeMulti;
    return populated.map((group, i) => {
      const num = i + 1;
      const isLast = i === populated.length - 1;
      return {
        groupNumber: `${system.ringGroupPrefix}${num}`,
        description: renderDescription(num),
        extensionList: fmt(group.recipients),
        strategy: system.ringStrategy,
        ringTime: overrides[String(num)] ?? defaultRingTime,
        postAnswer: isLast ? finalPostAnswer : `ext-group,${system.ringGroupPrefix}${num + 1},1`,
        callerId: system.callerId,
      };
    });
  }

  // --- Maintain mode: numbering by priority/tier number. ---
  const membersByTier = new Map<number, Recipient[]>();
  for (const g of populated) membersByTier.set(g.priority, g.recipients);

  // Declared tier config: which tiers are forced empty / to a fixed destination.
  const tierCfg = (system.tierConfig ?? {}) as Record<string, TierConfigEntry>;
  const forceEmpty = new Set<number>();
  const forcedDest = new Map<number, FinalDestination>();
  for (const [key, c] of Object.entries(tierCfg)) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1) continue;
    if (c.forceEmpty) forceEmpty.add(n);
    if (c.destType && c.destType !== "next") {
      forcedDest.set(n, {
        type: c.destType as FinalDestType,
        value: c.destValue ?? null,
        subtype: c.destSubtype ?? null,
      });
    }
  }

  // A tier is written if it is staffed (and not forced empty) or explicitly
  // forced (empty and/or given a fixed destination).
  const writtenSet = new Set<number>();
  for (const p of membersByTier.keys()) if (!forceEmpty.has(p)) writtenSet.add(p);
  for (const n of forceEmpty) writtenSet.add(n);
  for (const n of forcedDest.keys()) writtenSet.add(n);

  const tiers = [...writtenSet]
    .sort((a, b) => a - b)
    .map((num) => ({ num, members: forceEmpty.has(num) ? [] : (membersByTier.get(num) ?? []) }));

  const staffedCount = tiers.filter((t) => t.members.length > 0).length;
  const defaultRingTime = staffedCount <= 1 ? system.ringTimeSingle : system.ringTimeMulti;

  const updates: RingGroupUpdate[] = tiers.map(({ num, members }, idx) => {
    const forced = forcedDest.get(num);
    const next = tiers[idx + 1];
    const postAnswer = forced
      ? toPostAnswer(forced)
      : next
        ? `ext-group,${system.ringGroupPrefix}${next.num},1`
        : finalPostAnswer;
    const ringTime =
      members.length === 0 ? EMPTY_GROUP_RING_TIME : (overrides[String(num)] ?? defaultRingTime);
    return {
      groupNumber: `${system.ringGroupPrefix}${num}`,
      description: renderDescription(num),
      extensionList: fmt(members),
      strategy: system.ringStrategy,
      ringTime,
      postAnswer,
      callerId: system.callerId,
    };
  });

  // Pinned entry group: keep <prefix>1 a live entry point when tier 1 isn't
  // otherwise written (priority 1 empty and not forced). Forward = member-less
  // pass-through to the first written tier; mirror = copy that tier.
  if (system.keepEntryGroup && tiers.length > 0 && !writtenSet.has(ENTRY_TIER)) {
    const entryGroupNumber = `${system.ringGroupPrefix}${ENTRY_TIER}`;
    if (system.entryGroupMode === "mirror") {
      updates.unshift({
        ...updates[0],
        groupNumber: entryGroupNumber,
        description: renderDescription(ENTRY_TIER),
      });
    } else {
      updates.unshift({
        groupNumber: entryGroupNumber,
        description: renderDescription(ENTRY_TIER),
        extensionList: "",
        strategy: system.ringStrategy,
        ringTime: EMPTY_GROUP_RING_TIME,
        postAnswer: `ext-group,${system.ringGroupPrefix}${tiers[0].num},1`,
        callerId: system.callerId,
      });
    }
  }

  return updates;
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
