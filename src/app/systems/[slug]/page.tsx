import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { maybeDecrypt } from "@/lib/crypto";
import { describeDestination, type FinalDestType } from "@/lib/destinations";
import StatusBadge from "@/components/StatusBadge";
import PreviewPanel from "@/components/PreviewPanel";
import {
  applyNowAction,
  pollNowAction,
  deleteSystemAction,
  regenerateTriggerTokenAction,
} from "@/app/systems/actions";

export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{children}</span>
    </div>
  );
}

export default async function SystemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const system = await prisma.system.findUnique({
    where: { slug },
    include: { events: { orderBy: { createdAt: "desc" }, take: 15 } },
  });
  if (!system) notFound();

  const status = !system.enabled ? "disabled" : (system.lastStatus ?? "never");
  const triggerToken = maybeDecrypt(system.triggerToken);
  const hdrs = await headers();
  const host =
    hdrs.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    hdrs.get("host") ||
    "your-app-host";
  const proto =
    hdrs.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const triggerUrl = `${proto}://${host}/api/systems/${system.id}/trigger`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
            ← All systems
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold">{system.name}</h1>
            <StatusBadge status={status} />
          </div>
          {system.description && <p className="text-sm text-slate-500">{system.description}</p>}
        </div>
        <Link href={`/systems/${system.slug}/edit`} className="btn-secondary">
          Edit
        </Link>
      </div>

      {/* Actions */}
      <div className="card flex flex-wrap items-center gap-3">
        <form action={applyNowAction}>
          <input type="hidden" name="id" value={system.id} />
          <button className="btn-primary" type="submit">
            Apply now
          </button>
        </form>
        <form action={pollNowAction}>
          <input type="hidden" name="id" value={system.id} />
          <button className="btn-secondary" type="submit">
            Poll now
          </button>
        </form>
        <span className="text-xs text-slate-500">
          Apply forces a push; Poll only pushes if the schedule changed.
        </span>
      </div>

      {system.lastStatus === "error" && system.lastError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Last error:</strong> {system.lastError}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Configuration
          </h2>
          <Row label="Slug">{system.slug}</Row>
          <Row label="Enabled">{system.enabled ? "Yes" : "No"}</Row>
          <Row label="Schedule URL">
            <span className="break-all font-mono text-xs">{system.scheduleUrl}</span>
          </Row>
          <Row label="Ring group prefix">{system.ringGroupPrefix}</Row>
          <Row label="Ring strategy">{system.ringStrategy}</Row>
          <Row label="Ring time (single / chained)">
            {system.ringTimeSingle}s / {system.ringTimeMulti}s
          </Row>
          <Row label="Caller ID">{system.callerId || "—"}</Row>
          <Row label="No-answer destination">
            {describeDestination({
              type: system.finalDestType as FinalDestType,
              value: system.finalDestValue,
              subtype: system.finalDestSubtype,
            })}
          </Row>
          <Row label="Poll schedule">
            {system.cronString} ({system.timezone})
          </Row>
          <Row label="Last hash">{system.lastHash || "—"}</Row>
        </div>

        <div className="card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Preview (dry run)
          </h2>
          <PreviewPanel systemId={system.id} />
        </div>
      </div>

      {/* Push trigger */}
      <div className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Push trigger
        </h2>
        <p className="text-sm text-slate-600">
          Have the scheduling system push changes instantly instead of waiting for the poll:
        </p>
        <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
          {`curl -X POST ${triggerUrl} \\
  -H "Authorization: Bearer ${triggerToken ?? "<token>"}"`}
        </pre>
        <form action={regenerateTriggerTokenAction}>
          <input type="hidden" name="id" value={system.id} />
          <button className="btn-secondary" type="submit">
            Regenerate token
          </button>
        </form>
      </div>

      {/* Recent activity */}
      <div className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent activity
        </h2>
        {system.events.length === 0 ? (
          <p className="text-sm text-slate-500">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {system.events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 py-2">
                <div className="flex items-center gap-3">
                  <StatusBadge status={e.status} />
                  <span className="text-slate-700">{e.message}</span>
                </div>
                <span className="whitespace-nowrap text-xs text-slate-400">
                  {e.trigger} · {e.createdAt.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Danger zone */}
      <div className="card border-red-200">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-600">
          Danger zone
        </h2>
        <form action={deleteSystemAction}>
          <input type="hidden" name="id" value={system.id} />
          <button className="btn-danger" type="submit">
            Delete this system
          </button>
        </form>
      </div>
    </div>
  );
}
