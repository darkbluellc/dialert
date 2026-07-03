import "dotenv/config";
import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "@/lib/prisma";
import { applySystem } from "@/lib/apply";

// Standalone poller. For each enabled system it schedules a cron job (in the
// system's timezone) that runs an apply cycle. It reconciles against the DB
// periodically so that systems added / removed / re-scheduled in the UI take
// effect without a restart.

const RECONCILE_INTERVAL_MS = 30_000;

interface Tracked {
  task: ScheduledTask;
  cronString: string;
  timezone: string;
}

const tracked = new Map<string, Tracked>();

async function runSystem(systemId: string): Promise<void> {
  // Always reload the system so we use the latest config.
  const system = await prisma.system.findUnique({ where: { id: systemId } });
  if (!system || !system.enabled) return;
  try {
    const result = await applySystem(system, "cron", { force: false });
    console.log(`[${system.slug}] ${result.status}: ${result.message}`);
  } catch (err) {
    console.error(`[${system.slug}] unexpected worker error: ${(err as Error).message}`);
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
      console.error(`[${s.slug}] invalid cron string "${s.cronString}"; skipping`);
      tracked.delete(s.id);
      continue;
    }

    const task = cron.schedule(s.cronString, () => void runSystem(s.id), {
      timezone: s.timezone,
    });
    tracked.set(s.id, { task, cronString: s.cronString, timezone: s.timezone });
    console.log(`[${s.slug}] scheduled "${s.cronString}" (${s.timezone})`);
  }

  // Drop tasks for systems that are gone or disabled.
  for (const [id, t] of tracked) {
    if (!seen.has(id)) {
      t.task.stop();
      tracked.delete(id);
    }
  }
}

async function main(): Promise<void> {
  console.log("DiALERT worker starting…");
  await reconcile();

  // Run an initial cycle for every enabled system on boot.
  const systems = await prisma.system.findMany({ where: { enabled: true } });
  for (const s of systems) await runSystem(s.id);

  setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
