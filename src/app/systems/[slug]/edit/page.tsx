import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import SystemForm, { type SystemFormValues } from "@/components/SystemForm";
import type { TierCfg } from "@/components/TierConfigEditor";
import type { FinalDestType } from "@/lib/destinations";

export const dynamic = "force-dynamic";

// Normalize the stored tierConfig JSON into fully-populated form rows.
function normalizeTierConfig(raw: unknown): Record<string, TierCfg> {
  const out: Record<string, TierCfg> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, Partial<TierCfg>>)) {
      out[k] = {
        forceEmpty: Boolean(v?.forceEmpty),
        destType: (v?.destType as TierCfg["destType"]) ?? "next",
        destValue: v?.destValue ?? "",
        destSubtype: v?.destSubtype ?? "hangup",
      };
    }
  }
  return out;
}

export default async function EditSystemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const system = await prisma.system.findUnique({ where: { slug } });
  if (!system) notFound();

  const values: SystemFormValues = {
    id: system.id,
    name: system.name,
    slug: system.slug,
    description: system.description ?? "",
    enabled: system.enabled,
    scheduleUrl: system.scheduleUrl,
    scheduleHeaderName: system.scheduleHeaderName,
    hasScheduleToken: Boolean(system.scheduleToken),
    ringGroupPrefix: system.ringGroupPrefix,
    callerId: system.callerId ?? "",
    ringStrategy: system.ringStrategy,
    ringTimeSingle: system.ringTimeSingle,
    ringTimeMulti: system.ringTimeMulti,
    descriptionTemplate: system.descriptionTemplate,
    maintainStructure: system.maintainStructure,
    keepEntryGroup: system.keepEntryGroup,
    entryGroupMode: system.entryGroupMode === "mirror" ? "mirror" : "forward",
    internalExtMinLen: system.internalExtMinLen != null ? String(system.internalExtMinLen) : "",
    internalExtMaxLen: system.internalExtMaxLen != null ? String(system.internalExtMaxLen) : "",
    tierCount: system.tierCount != null ? String(system.tierCount) : "",
    tierConfig: normalizeTierConfig(system.tierConfig),
    ringTimeOverrides: Object.entries(
      (system.ringTimeOverrides ?? {}) as Record<string, number>,
    )
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([tier, seconds]) => ({ tier, seconds: String(seconds) })),
    finalDestType: system.finalDestType as FinalDestType,
    finalDestValue: system.finalDestValue ?? "",
    finalDestSubtype: system.finalDestSubtype ?? "",
    cronString: system.cronString,
    timezone: system.timezone,
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/systems/${system.slug}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← Back
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Edit {system.name}</h1>
      </div>
      <SystemForm values={values} />
    </div>
  );
}
