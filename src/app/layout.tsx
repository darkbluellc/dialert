import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "DiALERT",
  description: "Manage FreePBX ring-group chains for multiple phone systems.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const authed = await verifySessionToken(token);

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          {authed && (
            <header className="border-b border-slate-200 bg-white">
              <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
                <Link href="/" className="text-lg font-bold tracking-tight text-brand">
                  Di<span className="text-slate-900">ALERT</span>
                </Link>
                <form action="/api/logout" method="post">
                  <button
                    className="text-sm text-slate-500 hover:text-slate-900"
                    type="submit"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </header>
          )}
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
