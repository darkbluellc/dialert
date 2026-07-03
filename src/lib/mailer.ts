import nodemailer from "nodemailer";
import { env } from "./env";

// Error-notification email with a per-process cooldown, ported from the
// original DiALERT. If SMTP is not configured, errors are logged only.

const COOLDOWN_MS = 15 * 60 * 1000;
let lastSentAt = 0;

export async function sendErrorEmail(systemName: string, message: string): Promise<void> {
  const smtp = env.smtp();
  if (!smtp.host || !smtp.to) {
    console.error(`[${systemName}] ${message} (email not configured)`);
    return;
  }

  const now = Date.now();
  if (now - lastSentAt < COOLDOWN_MS) {
    console.error(`[${systemName}] ${message} (email suppressed by cooldown)`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  try {
    const info = await transporter.sendMail({
      from: smtp.from,
      to: smtp.to,
      subject: `DiALERT Error — ${systemName}`,
      text: `System: ${systemName}\n\nAn error occurred:\n${message}\n\nTime: ${new Date().toString()}`,
      html: `<b>System:</b> ${systemName}<br/><br/><b>An error occurred:</b><br/>${message}<br/><br/><b>Time:</b> ${new Date().toString()}`,
    });
    lastSentAt = now;
    console.error(`[${systemName}] error email sent (${info.messageId}): ${message}`);
  } catch (err) {
    console.error(`[${systemName}] failed to send error email: ${(err as Error).message}`);
  }
}
