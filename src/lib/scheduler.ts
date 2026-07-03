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

interface Tracked {
  task: ScheduledTask;
  cronString: string;
  timezone: string;
}

const tracked = new Map<string, Tracked>();
let started = false;

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
}
