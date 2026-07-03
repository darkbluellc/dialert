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
    groups = body.groups
      .slice()
      .sort((a: any, b: any) => a.priority - b.priority)
      .map((g: any) => ({ priority: g.priority, recipients: g.recipients }));
  } else if (Array.isArray(body.recipients)) {
    groups = body.recipients
      .slice()
      .sort((a: any, b: any) => a.priority - b.priority)
      .map((r: Recipient) => ({ priority: r.priority ?? 0, recipients: [r] }));
  } else {
    throw new ScheduleError("Schedule response contained neither `groups` nor `recipients`");
  }

  // Validate every tier has at least one recipient with a phone number.
  if (groups.length === 0) {
    throw new ScheduleError("Schedule contained no groups");
  }
  for (const group of groups) {
    if (!Array.isArray(group.recipients) || group.recipients.length === 0) {
      throw new ScheduleError(
        `Schedule contains a group (priority ${group.priority}) with no recipients`,
      );
    }
    for (const r of group.recipients) {
      if (!r.number) {
        throw new ScheduleError(
          `Recipient missing phone number in group with priority ${group.priority}`,
        );
      }
    }
  }

  // If the API doesn't provide a hash, derive one from the normalized content
  // so we can still detect "no change".
  const hash = body.hash ?? deriveHash(groups);

  return { hash, groups };
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
