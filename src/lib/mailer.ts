import nodemailer from "nodemailer";
import { env } from "./env";

// Error-notification email with a per-process cooldown, ported from the
// original DiALERT. If SMTP is not configured, errors are logged only.

const COOLDOWN_MS = 15 * 60 * 1000;
// Fail fast instead of nodemailer's ~2 minute defaults, so an unreachable SMTP
// server can't stall the scheduler's error path or the test button.
const TIMEOUT_MS = 15_000;
let lastSentAt = 0;

function createTransport() {
  const smtp = env.smtp();
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Most useful description of an SMTP failure: nodemailer's message plus the
// error code and the SMTP command that failed, when available.
function smtpErrorDetail(err: unknown): string {
  const e = err as Error & { code?: string; command?: string };
  return [e.message, e.code && `code ${e.code}`, e.command && `during ${e.command}`]
    .filter(Boolean)
    .join("; ");
}

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

  try {
    const info = await createTransport().sendMail({
      from: smtp.from,
      to: smtp.to,
      subject: `DiALERT Error — ${systemName}`,
      text: `System: ${systemName}\n\nAn error occurred:\n${message}\n\nTime: ${new Date().toString()}`,
      html: `<b>System:</b> ${escapeHtml(systemName)}<br/><br/><b>An error occurred:</b><br/>${escapeHtml(message)}<br/><br/><b>Time:</b> ${escapeHtml(new Date().toString())}`,
    });
    lastSentAt = now;
    console.error(`[${systemName}] error email sent (${info.messageId}): ${message}`);
  } catch (err) {
    console.error(`[${systemName}] failed to send error email: ${smtpErrorDetail(err)}`);
  }
}

export interface SmtpSummary {
  configured: boolean;
  host: string;
  port: number;
  security: string;
  user: string;
  passwordSet: boolean;
  from: string;
  to: string;
}

/** The effective SMTP settings, safe to display (the password is never included). */
export function smtpSummary(): SmtpSummary {
  const smtp = env.smtp();
  return {
    configured: Boolean(smtp.host && smtp.to),
    host: smtp.host,
    port: smtp.port,
    security: smtp.port === 465 ? "Implicit TLS (port 465)" : "STARTTLS when offered",
    user: smtp.user,
    passwordSet: Boolean(smtp.pass),
    from: smtp.from,
    to: smtp.to,
  };
}

export interface TestEmailResult {
  ok: boolean;
  message: string;
}

/**
 * Verify the SMTP connection and credentials, then send a test message to
 * ERROR_EMAIL_ADDRESS. Bypasses (and doesn't affect) the error-email cooldown.
 * Never throws; failures come back as a readable message.
 */
export async function sendTestEmail(): Promise<TestEmailResult> {
  const smtp = env.smtp();
  if (!smtp.host) return { ok: false, message: "SMTP_SERVER is not set." };
  if (!smtp.to) return { ok: false, message: "ERROR_EMAIL_ADDRESS is not set." };

  const transporter = createTransport();
  try {
    await transporter.verify();
  } catch (err) {
    const message = `Could not connect or sign in to ${smtp.host}:${smtp.port} — ${smtpErrorDetail(err)}`;
    console.error(`[mailer] test email: ${message}`);
    return { ok: false, message };
  }

  try {
    const sentAt = new Date().toString();
    const info = await transporter.sendMail({
      from: smtp.from,
      to: smtp.to,
      subject: "DiALERT test email",
      text: `This is a test email from DiALERT.\n\nIf you received it, error notifications are configured correctly.\n\nSent: ${sentAt}`,
      html: `This is a test email from DiALERT.<br/><br/>If you received it, error notifications are configured correctly.<br/><br/><b>Sent:</b> ${escapeHtml(sentAt)}`,
    });
    if (info.rejected.length > 0) {
      const message = `The server rejected the recipient: ${info.rejected.join(", ")} (${info.response})`;
      console.error(`[mailer] test email: ${message}`);
      return { ok: false, message };
    }
    console.log(`[mailer] test email sent to ${smtp.to} (${info.messageId})`);
    return {
      ok: true,
      message: `Sent to ${smtp.to}. Server response: ${info.response}`,
    };
  } catch (err) {
    const message = `Connected, but sending failed — ${smtpErrorDetail(err)}`;
    console.error(`[mailer] test email: ${message}`);
    return { ok: false, message };
  }
}
