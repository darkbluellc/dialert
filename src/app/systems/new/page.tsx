import Link from "next/link";
import SystemForm from "@/components/SystemForm";

export default function NewSystemPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← Back
        </Link>
        <h1 className="mt-1 text-2xl font-bold">New system</h1>
      </div>
      <SystemForm />
    </div>
  );
}
