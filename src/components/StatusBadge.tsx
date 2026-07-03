const STYLES: Record<string, string> = {
  ok: "bg-green-100 text-green-800",
  skipped: "bg-slate-100 text-slate-600",
  error: "bg-red-100 text-red-800",
  disabled: "bg-amber-100 text-amber-800",
  never: "bg-slate-100 text-slate-500",
};

const LABELS: Record<string, string> = {
  ok: "OK",
  skipped: "No change",
  error: "Error",
  disabled: "Disabled",
  never: "Never run",
};

export default function StatusBadge({ status }: { status: string }) {
  const key = STYLES[status] ? status : "never";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[key]}`}>
      {LABELS[key]}
    </span>
  );
}
