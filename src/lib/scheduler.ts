import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "./prisma";
import { applySystem } from "./apply";

// The polling scheduler. For each enabled system it schedules a cron job (in the
// system's timezone) that runs an apply cycle, and reconciles against the DB
// periodically so systems added / removed / re-scheduled in the UI take effect
// without a restart.
//
// In the Docker image the container entrypoint starts this as a background
// process (npm run worker) alongside the web server, so a single container both
// serves the UI and polls. Set RUN_SCHEDULER=false to disable it.

const RECONCILE_INTERVAL_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Audit-log retention. Errors are kept much longer than successful applies.
// Both are overridable via env. "skipped" events are no longer written and any
// legacy ones are removed on every prune.
const OK_RETENTION_DAYS = Number(process.env.EVENT_RETENTION_DAYS ?? 14);
const ERROR_RETENTION_DAYS = Number(process.env.ERROR_RETENTION_DAYS ?? 90);

interface Tracked {
  task: ScheduledTask;
  cronString: string;
  timezone: string;
}

const tracked = new Map<string, Tracked>();
let started = false;

/**
 * Trim the apply-event audit log. Runs at startup and once a day:
 *   - drop legacy "skipped" events entirely;
 *   - expire errors after ERROR_RETENTION_DAYS;
 *   - expire successful applies after OK_RETENTION_DAYS, EXCEPT a "recovery" OK
 *     (the first success immediately after an error), which is kept for the
 *     longer error window so the record of when a system recovered survives.
 */
async function pruneEvents(): Promise<void> {
  const now = Date.now();
  const okCutoff = new Date(now - OK_RETENTION_DAYS * DAY_MS);
  const errorCutoff = new Date(now - ERROR_RETENTION_DAYS * DAY_MS);

  try {
    // Identify recovery OKs (first OK after an error) per system, ordered in
    // time. Computed before deletions so predecessors are still present.
    const seq = await prisma.applyEvent.findMany({
      where: { status: { in: ["ok", "error"] } },
      select: { id: true, systemId: true, status: true },
      orderBy: [{ systemId: "asc" }, { createdAt: "asc" }],
    });
    const recoveryIds: string[] = [];
    const prevStatus: Record<string, string> = {};
    for (const e of seq) {
      if (e.status === "ok" && prevStatus[e.systemId] === "error") recoveryIds.push(e.id);
      prevStatus[e.systemId] = e.status;
    }

    const skipped = await prisma.applyEvent.deleteMany({ where: { status: "skipped" } });
    const errored = await prisma.applyEvent.deleteMany({
      where: { status: "error", createdAt: { lt: errorCutoff } },
    });
    // Normal OKs expire at okCutoff; recovery OKs are excluded here…
    const okNormal = await prisma.applyEvent.deleteMany({
      where: { status: "ok", createdAt: { lt: okCutoff }, id: { notIn: recoveryIds } },
    });
    // …and instead expire at the longer errorCutoff.
    const okRecovery = await prisma.applyEvent.deleteMany({
      where: { status: "ok", createdAt: { lt: errorCutoff }, id: { in: recoveryIds } },
    });

    const total = skipped.count + errored.count + okNormal.count + okRecovery.count;
    if (total > 0) {
      console.log(
        `[scheduler] pruned ${total} apply events (skipped=${skipped.count}, error=${errored.count}, ok=${okNormal.count + okRecovery.count})`,
      );
    }
  } catch (err) {
    console.error(`[scheduler] prune error: ${(err as Error).message}`);
  }
}

async function runSystem(systemId: string): Promise<void> {
  // Always reload the system so we use the latest config.
  const system = await prisma.system.findUnique({ where: { id: systemId } });
  if (!system || !system.enabled) return;
  try {
    const result = await applySystem(system, "cron", { force: false });
    console.log(`[scheduler] [${system.slug}] ${result.status}: ${result.message}`);
  } catch (err) {
    console.error(`[scheduler] [${system.slug}] unexpected error: ${(err as Error).message}`);
  }
}

async function reconcile(): Promise<void> {
  const systems = await prisma.system.findMany({ where: { enabled: true } });
  const seen = new Set<string>();

  for (const s of systems) {
    seen.add(s.id);
    const existing = tracked.get(s.id);
    const changed =
      existing && (existing.cronString !== s.cronString || existing.timezone !== s.timezone);

    if (existing && !changed) continue;
    if (existing) existing.task.stop();

    if (!cron.validate(s.cronString)) {
      console.error(`[scheduler] [${s.slug}] invalid cron string "${s.cronString}"; skipping`);
      tracked.delete(s.id);
      continue;
    }

    const task = cron.schedule(s.cronString, () => void runSystem(s.id), {
      timezone: s.timezone,
    });
    tracked.set(s.id, { task, cronString: s.cronString, timezone: s.timezone });
    console.log(`[scheduler] [${s.slug}] scheduled "${s.cronString}" (${s.timezone})`);
  }

  // Drop tasks for systems that are gone or disabled.
  for (const [id, t] of tracked) {
    if (!seen.has(id)) {
      t.task.stop();
      tracked.delete(id);
    }
  }
}

/**
 * Start the scheduler. Idempotent per process. Never throws — startup errors are
 * logged and retried on the reconcile interval, so a transient DB hiccup at boot
 * can't take down the web server.
 */
export async function startScheduler(): Promise<void> {
  if (started) return;
  started = true;
  console.log("[scheduler] starting poller");

  try {
    await pruneEvents();
    await reconcile();
    // Run an initial cycle for every enabled system on boot.
    const systems = await prisma.system.findMany({ where: { enabled: true } });
    for (const s of systems) await runSystem(s.id);
  } catch (err) {
    console.error(`[scheduler] initial start error (will retry): ${(err as Error).message}`);
  }

  setInterval(() => {
    reconcile().catch((err) =>
      console.error(`[scheduler] reconcile error: ${(err as Error).message}`),
    );
  }, RECONCILE_INTERVAL_MS);

  setInterval(() => void pruneEvents(), DAY_MS);
}
