"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { sendTestEmailAction } from "@/app/settings/actions";
import type { TestEmailResult } from "@/lib/mailer";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={disabled || pending}>
      {pending ? "Sending…" : "Send test email"}
    </button>
  );
}

export default function TestEmailButton({ disabled }: { disabled: boolean }) {
  const [result, action] = useActionState<TestEmailResult | null, FormData>(
    sendTestEmailAction,
    null,
  );

  return (
    <div className="space-y-3">
      <form action={action}>
        <SubmitButton disabled={disabled} />
      </form>
      {result && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
          }`}
        >
          <strong>{result.ok ? "Success: " : "Failed: "}</strong>
          <span className="break-words">{result.message}</span>
        </div>
      )}
    </div>
  );
}
