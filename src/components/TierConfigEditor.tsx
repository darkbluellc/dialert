"use client";

import { useState } from "react";
import { TERMINATE_SUBTYPES } from "@/lib/destinations";

export interface TierCfg {
  forceEmpty: boolean;
  destType: "next" | "ring_group" | "extension" | "terminate";
  destValue: string;
  destSubtype: string;
}

const DEFAULT_TIER: TierCfg = {
  forceEmpty: false,
  destType: "next",
  destValue: "",
  destSubtype: "hangup",
};

const DEST_OPTIONS: { value: TierCfg["destType"]; label: string }[] = [
  { value: "next", label: "Chain to next tier (default)" },
  { value: "ring_group", label: "Another ring group" },
  { value: "extension", label: "An extension" },
  { value: "terminate", label: "Terminate the call" },
];

export default function TierConfigEditor({
  maintain,
  prefix,
  initialCount,
  initialTiers,
}: {
  maintain: boolean;
  prefix: string;
  initialCount: string;
  initialTiers: Record<string, TierCfg>;
}) {
  const [count, setCount] = useState(initialCount);
  const [tiers, setTiers] = useState<Record<string, TierCfg>>(initialTiers);

  const n = Math.min(Math.max(parseInt(count, 10) || 0, 0), 20);
  const getTier = (t: number): TierCfg => tiers[String(t)] ?? DEFAULT_TIER;
  const setTier = (t: number, patch: Partial<TierCfg>) =>
    setTiers((prev) => ({ ...prev, [t]: { ...getTier(t), ...patch } }));

  // Only serialize tiers within range that differ from the default.
  const serialized: Record<string, TierCfg> = {};
  for (let t = 1; t <= n; t++) {
    const c = getTier(t);
    if (c.forceEmpty || c.destType !== "next") serialized[t] = c;
  }

  return (
    <div>
      <input type="hidden" name="tierConfigJson" value={JSON.stringify(serialized)} />
      <span className="label">Declared tiers</span>
      <p className="hint mt-0 mb-2">
        Optionally fix the tier structure: set how many tiers the system has, force specific tiers to
        have no members, and/or send a tier to a specific destination on no answer. Members still
        come from the schedule by tier number; a tier with neither members nor an override is skipped
        and the chain jumps across it. Applies only when structure is maintained{" "}
        {maintain ? "" : "(currently off)"}.
      </p>

      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span>Number of tiers</span>
        <input
          className="input w-24"
          name="tierCount"
          type="number"
          min={1}
          max={20}
          placeholder="none"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
      </div>

      {maintain && n > 0 && (
        <div className="mt-3 space-y-2">
          {Array.from({ length: n }, (_, i) => i + 1).map((t) => {
            const c = getTier(t);
            return (
              <div
                key={t}
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2 text-sm"
              >
                <span className="font-mono text-slate-700">
                  Tier {t} ({prefix || "<prefix>"}
                  {t})
                </span>
                <label className="flex items-center gap-1 text-slate-600">
                  <input
                    type="checkbox"
                    checked={c.forceEmpty}
                    onChange={(e) => setTier(t, { forceEmpty: e.target.checked })}
                  />
                  force empty
                </label>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">no answer →</span>
                <select
                  className="input w-auto"
                  value={c.destType}
                  onChange={(e) => setTier(t, { destType: e.target.value as TierCfg["destType"] })}
                >
                  {DEST_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {(c.destType === "ring_group" || c.destType === "extension") && (
                  <input
                    className="input w-32"
                    placeholder={c.destType === "ring_group" ? "group #" : "extension"}
                    value={c.destValue}
                    onChange={(e) => setTier(t, { destValue: e.target.value })}
                  />
                )}
                {c.destType === "terminate" && (
                  <select
                    className="input w-auto"
                    value={c.destSubtype}
                    onChange={(e) => setTier(t, { destSubtype: e.target.value })}
                  >
                    {TERMINATE_SUBTYPES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
