// Fetches and normalizes scheduling data for a system. Preserves the two API
// shapes the original DiALERT supported:
//   - New: { groups: [{ priority, recipients: [{ number, ... }] }], hash }
//   - Old: { recipients: [{ priority, number, ... }], hash }  (each recipient
//          becomes its own single-member tier)

export interface Recipient {
  number: string;
  role?: string;
  priority?: number;
  firstName?: string;
  lastName?: string;
}

export interface ScheduleGroup {
  priority: number;
  recipients: Recipient[];
}

export interface NormalizedSchedule {
  hash: string;
  groups: ScheduleGroup[];
}

export class ScheduleError extends Error {}

export async function fetchSchedule(params: {
  url: string;
  token?: string | null;
  headerName?: string;
}): Promise<NormalizedSchedule> {
  const { url, token, headerName = "x-api-key" } = params;

  const headers: Record<string, string> = {};
  if (token) headers[headerName] = token;

  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers });
  } catch (err) {
    throw new ScheduleError(
      `Network error fetching schedule from ${url}: ${(err as Error).message}`,
    );
  }

  if (!res.ok) {
    throw new ScheduleError(
      `Failed to fetch schedule: ${res.status} ${res.statusText} (${url})`,
    );
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new ScheduleError(`Schedule response was not valid JSON (${url})`);
  }

  if (body.error) {
    throw new ScheduleError(`Schedule API returned an error: ${body.error}`);
  }

  let groups: ScheduleGroup[];
  if (Array.isArray(body.groups)) {
    groups = body.groups.map((g: any) => ({ priority: g.priority, recipients: g.recipients }));
  } else if (Array.isArray(body.recipients)) {
    groups = body.recipients.map((r: Recipient) => ({ priority: r.priority ?? 0, recipients: [r] }));
  } else {
    throw new ScheduleError("Schedule response contained neither `groups` nor `recipients`");
  }

  if (groups.length === 0) {
    throw new ScheduleError("Schedule contained no groups");
  }

  // recipients must be an array before we merge.
  for (const group of groups) {
    if (!Array.isArray(group.recipients)) {
      throw new ScheduleError(
        `Schedule group (priority ${group.priority}) has an invalid recipients value`,
      );
    }
  }

  // Merge entries that share a priority into one tier. A scheduling system may
  // emit multiple entries at the same priority — e.g. two people on the same
  // tier with different shift windows — and they should all ring together in
  // that tier. Recipients are concatenated (de-duplicated by number) and tiers
  // are ordered by ascending priority.
  groups = mergeByPriority(groups);

  // A tier may be empty (simply skipped when building the chain), but any
  // recipient present must have a phone number, and at least one tier overall
  // must have members.
  for (const group of groups) {
    for (const r of group.recipients) {
      if (!r.number) {
        throw new ScheduleError(
          `Recipient missing phone number in group with priority ${group.priority}`,
        );
      }
    }
  }
  if (!groups.some((g) => g.recipients.length > 0)) {
    throw new ScheduleError("Schedule has no tiers with members");
  }

  // If the API doesn't provide a hash, derive one from the normalized content
  // so we can still detect "no change".
  const hash = body.hash ?? deriveHash(groups);

  return { hash, groups };
}

// Combine groups sharing a priority into a single tier, ordered by priority.
function mergeByPriority(groups: ScheduleGroup[]): ScheduleGroup[] {
  const byPriority = new Map<number, Recipient[]>();
  for (const g of groups) {
    const list = byPriority.get(g.priority) ?? [];
    list.push(...g.recipients);
    byPriority.set(g.priority, list);
  }
  return [...byPriority.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([priority, recipients]) => ({ priority, recipients: dedupeByNumber(recipients) }));
}

// Remove duplicate numbers within a tier (e.g. overlapping shifts of the same
// person), keeping the first occurrence so a number isn't dialed twice.
function dedupeByNumber(recipients: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of recipients) {
    if (r.number && seen.has(r.number)) continue;
    if (r.number) seen.add(r.number);
    out.push(r);
  }
  return out;
}

function deriveHash(groups: ScheduleGroup[]): string {
  const canonical = JSON.stringify(
    groups.map((g) => ({
      p: g.priority,
      r: g.recipients.map((r) => r.number),
    })),
  );
  // Small FNV-1a hash — dependency-free and good enough for change detection.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
