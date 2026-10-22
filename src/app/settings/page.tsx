import Link from "next/link";
import { smtpSummary } from "@/lib/mailer";
import TestEmailButton from "@/components/TestEmailButton";

// Read env at request time, not build time.
export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="break-all text-right font-medium text-slate-900">{children}</span>
    </div>
  );
}

export default function SettingsPage() {
  const smtp = smtpSummary();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← All systems
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500">
          These values come from the server environment and are changed there (e.g. in Coolify).
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Email notifications
        </h2>

        {!smtp.configured && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Email isn&rsquo;t configured — errors are only logged and shown in the UI. Set{" "}
            <code>SMTP_SERVER</code> and <code>ERROR_EMAIL_ADDRESS</code> to enable it.
          </div>
        )}

        <div>
          <Row label="SMTP server">{smtp.host || "—"}</Row>
          <Row label="Port">{smtp.port}</Row>
          <Row label="Security">{smtp.security}</Row>
          <Row label="Username">{smtp.user || "— (no authentication)"}</Row>
          <Row label="Password">{smtp.passwordSet ? "set" : "not set"}</Row>
          <Row label="From">{smtp.from}</Row>
          <Row label="Sends to">{smtp.to || "—"}</Row>
        </div>

        <div>
          <p className="mb-2 text-sm text-slate-600">
            Connects to the SMTP server, signs in, and sends a test message to{" "}
            {smtp.to ? <strong>{smtp.to}</strong> : "the configured address"}. Doesn&rsquo;t affect
            the error-email cooldown.
          </p>
          <TestEmailButton disabled={!smtp.configured} />
        </div>
      </div>
    </div>
  );
}
