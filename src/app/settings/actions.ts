"use server";

import { sendTestEmail, type TestEmailResult } from "@/lib/mailer";

export async function sendTestEmailAction(
  _prev: TestEmailResult | null,
  _form: FormData,
): Promise<TestEmailResult | null> {
  return sendTestEmail();
}
