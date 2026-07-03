"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { previewAction, type PreviewState } from "@/app/systems/actions";

function PreviewButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-secondary" type="submit" disabled={pending}>
      {pending ? "Fetching…" : "Preview from schedule"}
    </button>
  );
}

export default function PreviewPanel({ systemId }: { systemId: string }) {
  const [state, action] = useActionState<PreviewState, FormData>(previewAction, {});

  return (
    <div className="space-y-3">
      <form action={action}>
        <input type="hidden" name="id" value={systemId} />
        <PreviewButton />
      </form>

      {state.error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
      )}

      {state.ok && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Schedule hash <code className="rounded bg-slate-100 px-1">{state.hash}</code> · final
            destination: {state.finalDestination}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-4">Ring group</th>
                  <th className="py-1 pr-4">Members</th>
                  <th className="py-1 pr-4">Ring time</th>
                  <th className="py-1">No-answer → </th>
                </tr>
              </thead>
              <tbody>
                {state.tiers?.map((t) => (
                  <tr key={t.groupNumber} className="border-t border-slate-100">
                    <td className="py-1 pr-4 font-mono">{t.groupNumber}</td>
                    <td className="py-1 pr-4">{t.members}</td>
                    <td className="py-1 pr-4">{t.ringTime}s</td>
                    <td className="py-1 font-mono text-xs">{t.postAnswer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">This is a dry run — nothing was pushed to the PBX.</p>
        </div>
      )}
    </div>
  );
}
