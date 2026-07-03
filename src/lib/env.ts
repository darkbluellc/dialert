// Centralized access to server-side environment configuration.
// Keep all `process.env` reads here so requirements are documented in one place.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // App auth / session
  appPassword: () => required("APP_PASSWORD"),
  sessionSecret: () => required("SESSION_SECRET"),
  // 32-byte key (base64 or hex) used to encrypt secrets stored in Postgres.
  encryptionKey: () => required("ENCRYPTION_KEY"),

  // Shared FreePBX credentials (per-system overrides live in the DB).
  // gqlUrl is optional; when unset it's derived from apiUrl ("<apiUrl>/gql").
  freepbx: () => ({
    apiUrl: optional("FREEPBX_API_URL"),
    gqlUrl: optional("FREEPBX_GQL_URL"),
    clientId: optional("FREEPBX_CLIENT_ID"),
    clientSecret: optional("FREEPBX_CLIENT_SECRET"),
    scope: optional("FREEPBX_SCOPE", "gql:ringgroups gql:framework"),
  }),

  // Error-notification email (optional; if unset, errors are only logged/stored).
  smtp: () => ({
    host: optional("SMTP_SERVER"),
    port: Number(optional("SMTP_PORT", "587")),
    user: optional("SMTP_USER"),
    pass: optional("SMTP_PASS"),
    from: optional("SMTP_FROM", '"DiALERT" <noreply@dialert.local>'),
    to: optional("ERROR_EMAIL_ADDRESS"),
  }),

  defaultTimezone: () => optional("TZ", "America/New_York"),
};
