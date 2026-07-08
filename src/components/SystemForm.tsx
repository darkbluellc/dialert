"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { saveSystemAction, type FormState } from "@/app/systems/actions";
import {
  FINAL_DEST_TYPES,
  TERMINATE_SUBTYPES,
  type FinalDestType,
} from "@/lib/destinations";

export interface SystemFormValues {
  id?: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  scheduleUrl: string;
  scheduleHeaderName: string;
  hasScheduleToken: boolean;
  ringGroupPrefix: string;
  callerId: string;
  ringStrategy: string;
  ringTimeSingle: number;
  ringTimeMulti: number;
  descriptionTemplate: string;
  maintainStructure: boolean;
  keepEntryGroup: boolean;
  ringTimeOverrides: { tier: string; seconds: string }[];
  finalDestType: FinalDestType;
  finalDestValue: string;
  finalDestSubtype: string;
  cronString: string;
  timezone: string;
}

const RING_STRATEGIES = [
  "ringall",
  "hunt",
  "memoryhunt",
  "firstavailable",
  "firstnotonphone",
  "random",
];

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error ? <p className="hint text-red-600">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create system"}
    </button>
  );
}

export default function SystemForm({ values }: { values?: SystemFormValues }) {
  const isEdit = Boolean(values?.id);
  const [state, formAction] = useActionState<FormState, FormData>(saveSystemAction, {});
  const [destType, setDestType] = useState<FinalDestType>(values?.finalDestType ?? "terminate");
  const [overrides, setOverrides] = useState<{ tier: string; seconds: string }[]>(
    values?.ringTimeOverrides ?? [],
  );
  const [maintain, setMaintain] = useState(values?.maintainStructure ?? false);
  const fe = state.fieldErrors ?? {};

  const setRow = (i: number, patch: Partial<{ tier: string; seconds: string }>) =>
    setOverrides((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setOverrides((rows) => [...rows, { tier: "", seconds: "" }]);
  const removeRow = (i: number) => setOverrides((rows) => rows.filter((_, j) => j !== i));

  return (
    <form action={formAction} className="space-y-6">
      {values?.id && <input type="hidden" name="id" value={values.id} />}

      {state.error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
      )}

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">System</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={fe.name}>
            <input className="input" name="name" defaultValue={values?.name} required />
          </Field>
          <Field label="Slug (URL)" hint="lowercase, hyphenated" error={fe.slug}>
            <input className="input" name="slug" defaultValue={values?.slug} required />
          </Field>
        </div>
        <Field label="Description" error={fe.description}>
          <input className="input" name="description" defaultValue={values?.description} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="enabled" defaultChecked={values?.enabled ?? true} />
          Enabled (polled automatically by the worker)
        </label>
      </section>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Scheduling data source
        </h2>
        <Field label="Schedule API URL" error={fe.scheduleUrl}>
          <input
            className="input"
            name="scheduleUrl"
            type="url"
            defaultValue={values?.scheduleUrl}
            placeholder="https://schedule.example.com/api/schedule"
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Auth header name" hint="Header the token is sent in" error={fe.scheduleHeaderName}>
            <input
              className="input"
              name="scheduleHeaderName"
              defaultValue={values?.scheduleHeaderName ?? "x-api-key"}
            />
          </Field>
          <Field
            label="Schedule API token"
            hint={values?.hasScheduleToken ? "Leave blank to keep the current token" : "Stored encrypted"}
            error={fe.scheduleToken}
          >
            <input
              className="input"
              name="scheduleToken"
              type="password"
              placeholder={values?.hasScheduleToken ? "••••••••" : ""}
              autoComplete="new-password"
            />
          </Field>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Ring-group chain
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Ring group prefix"
            hint="Tiers become PREFIX1, PREFIX2, … (e.g. 100 → 1001, 1002)"
            error={fe.ringGroupPrefix}
          >
            <input className="input" name="ringGroupPrefix" defaultValue={values?.ringGroupPrefix} required />
          </Field>
          <Field label="Fixed caller ID" hint="Optional outbound CID for the ring groups" error={fe.callerId}>
            <input className="input" name="callerId" defaultValue={values?.callerId} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ring strategy" error={fe.ringStrategy}>
            <select className="input" name="ringStrategy" defaultValue={values?.ringStrategy ?? "ringall"}>
              {RING_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ring time — single tier (s)" error={fe.ringTimeSingle}>
            <input className="input" name="ringTimeSingle" type="number" min={1} defaultValue={values?.ringTimeSingle ?? 60} />
          </Field>
          <Field label="Ring time — chained (s)" error={fe.ringTimeMulti}>
            <input className="input" name="ringTimeMulti" type="number" min={1} defaultValue={values?.ringTimeMulti ?? 30} />
          </Field>
        </div>

        <div>
          <span className="label">Per-tier ring time overrides</span>
          <p className="hint mt-0 mb-2">
            Override the ring time for specific tier numbers (the ring group suffix). Tiers without
            an override use the values above.
          </p>
          {fe.ringTimeOverrides && <p className="hint text-red-600 mb-2">{fe.ringTimeOverrides}</p>}
          {overrides.length > 0 && (
            <div className="space-y-2">
              {overrides.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="input w-28"
                    name="overrideTier"
                    type="number"
                    min={1}
                    placeholder="Tier #"
                    value={row.tier}
                    onChange={(e) => setRow(i, { tier: e.target.value })}
                  />
                  <span className="text-sm text-slate-500">rings for</span>
                  <input
                    className="input w-28"
                    name="overrideSeconds"
                    type="number"
                    min={1}
                    max={600}
                    placeholder="Seconds"
                    value={row.seconds}
                    onChange={(e) => setRow(i, { seconds: e.target.value })}
                  />
                  <span className="text-sm text-slate-500">s</span>
                  <button
                    type="button"
                    className="text-sm text-red-600 hover:underline"
                    onClick={() => removeRow(i)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="btn-secondary mt-2" onClick={addRow}>
            + Add tier override
          </button>
        </div>
        <Field
          label="Description template"
          hint="{name} and {n} are substituted per tier"
          error={fe.descriptionTemplate}
        >
          <input
            className="input"
            name="descriptionTemplate"
            defaultValue={values?.descriptionTemplate ?? "DiALERT {name} {n}"}
          />
        </Field>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="maintainStructure"
            className="mt-0.5"
            checked={maintain}
            onChange={(e) => setMaintain(e.target.checked)}
          />
          <span>
            Maintain ring-group structure
            <span className="hint mt-0 block">
              Number ring groups by tier priority (priority 2 → &lt;prefix&gt;2). Empty tiers are
              skipped and left untouched, so priority 1 chains straight to priority 3 instead of
              collapsing to the lowest numbers.
            </span>
          </span>
        </label>

        <label className="ml-6 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="keepEntryGroup"
            className="mt-0.5"
            defaultChecked={values?.keepEntryGroup ?? false}
            disabled={!maintain}
          />
          <span className={maintain ? "" : "opacity-50"}>
            Always keep the first ring group (&lt;prefix&gt;1) as the entry point
            <span className="hint mt-0 block">
              For when your inbound route always hits &lt;prefix&gt;1. If priority 1 has no members,
              &lt;prefix&gt;1 is written as a member-less group that immediately forwards to the
              first tier that does have members, so the inbound route still escalates. Applies only
              when structure is maintained.
            </span>
          </span>
        </label>
      </section>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          No-answer destination (last tier)
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Destination type" error={fe.finalDestType}>
            <select
              className="input"
              name="finalDestType"
              value={destType}
              onChange={(e) => setDestType(e.target.value as FinalDestType)}
            >
              {FINAL_DEST_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          {destType === "terminate" ? (
            <Field label="Terminate as" error={fe.finalDestSubtype}>
              <select
                className="input"
                name="finalDestSubtype"
                defaultValue={values?.finalDestSubtype || "hangup"}
              >
                {TERMINATE_SUBTYPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field
              label={
                destType === "ring_group"
                  ? "Ring group number"
                  : destType === "extension"
                    ? "Extension"
                    : destType === "voicemail"
                      ? "Mailbox number"
                      : "External number"
              }
              error={fe.finalDestValue}
            >
              <input className="input" name="finalDestValue" defaultValue={values?.finalDestValue} />
            </Field>
          )}
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Polling</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cron schedule" hint="Standard cron, e.g. * * * * *" error={fe.cronString}>
            <input className="input" name="cronString" defaultValue={values?.cronString ?? "* * * * *"} required />
          </Field>
          <Field label="Timezone" error={fe.timezone}>
            <input
              className="input"
              name="timezone"
              defaultValue={values?.timezone ?? "America/New_York"}
            />
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <SubmitButton isEdit={isEdit} />
        <Link href={isEdit ? `/systems/${values?.slug}` : "/"} className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
