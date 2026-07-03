import Link from "next/link";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

function relativeTime(date: Date | null): string {
  if (!date) return "never";
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function Dashboard() {
  const systems = await prisma.system.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Phone systems</h1>
          <p className="text-sm text-slate-500">
            {systems.length} system{systems.length === 1 ? "" : "s"} managed on your FreePBX.
          </p>
        </div>
        <Link href="/systems/new" className="btn-primary">
          + Add system
        </Link>
      </div>

      {systems.length === 0 ? (
        <div className="card text-center text-slate-500">
          No systems yet. <Link href="/systems/new" className="text-brand underline">Create your first one</Link>.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {systems.map((s) => {
            const status = !s.enabled ? "disabled" : (s.lastStatus ?? "never");
            return (
              <Link key={s.id} href={`/systems/${s.slug}`} className="card block hover:border-brand">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold">{s.name}</h2>
                    <p className="text-xs text-slate-500">
                      prefix {s.ringGroupPrefix} · {s.cronString}
                    </p>
                  </div>
                  <StatusBadge status={status} />
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  Last applied: {relativeTime(s.lastAppliedAt)} · Last polled: {relativeTime(s.lastPolledAt)}
                </div>
                {s.lastStatus === "error" && s.lastError && (
                  <p className="mt-2 truncate text-xs text-red-600" title={s.lastError}>
                    {s.lastError}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
