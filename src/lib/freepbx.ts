import { ClientCredentials } from "simple-oauth2";
import { env } from "./env";

// FreePBX driver: OAuth2 client-credentials auth + GraphQL ring-group mutations.
// Ported from the original DiALERT server.js. Credentials default to the shared
// env values but can be overridden per system (future multi-PBX support).

export interface FreepbxCreds {
  apiUrl: string; // API base, e.g. https://pbx.example.com/admin/api/api/
  gqlUrl: string; // GraphQL endpoint
  tokenUrl: string; // OAuth token endpoint ("" = derive "<apiUrl>/token")
  clientId: string;
  clientSecret: string;
  scope: string; // space-separated
}

export interface RingGroupUpdate {
  groupNumber: string;
  description: string;
  extensionList: string; // "num#-num#-..."
  strategy: string;
  ringTime: number;
  postAnswer: string; // FreePBX destination string
  callerId?: string | null;
}

// FreePBX exposes its GraphQL endpoint at "<apiBase>/gql" (the token endpoint is
// "<apiBase>/token"). Derive the GQL URL from the API URL when it isn't set
// explicitly, so FREEPBX_GQL_URL is optional.
function deriveGqlUrl(apiUrl: string): string {
  if (!apiUrl) return "";
  return `${apiUrl.replace(/\/+$/, "")}/gql`;
}

export function resolveCreds(overrides?: Partial<FreepbxCreds>): FreepbxCreds {
  const base = env.freepbx();
  const apiUrl = overrides?.apiUrl || base.apiUrl;
  const creds: FreepbxCreds = {
    apiUrl,
    gqlUrl: overrides?.gqlUrl || base.gqlUrl || deriveGqlUrl(apiUrl),
    tokenUrl: overrides?.tokenUrl || base.tokenUrl,
    clientId: overrides?.clientId || base.clientId,
    clientSecret: overrides?.clientSecret || base.clientSecret,
    scope: overrides?.scope || base.scope,
  };
  // gqlUrl is derived from apiUrl, so it's not independently required.
  const required: (keyof FreepbxCreds)[] = ["apiUrl", "clientId", "clientSecret", "scope"];
  const missing = required.filter((k) => !creds[k]);
  if (missing.length) {
    throw new Error(
      `FreePBX credentials incomplete; missing: ${missing.join(", ")}. ` +
        `Set FREEPBX_API_URL, FREEPBX_CLIENT_ID, and FREEPBX_CLIENT_SECRET in the environment.`,
    );
  }
  return creds;
}

// Readable summary of an HTTP error payload (JSON object, Buffer, or string),
// preferring OAuth-style error fields when present.
function payloadDetail(payload: unknown): string {
  if (payload == null) return "";
  if (Buffer.isBuffer(payload)) payload = payload.toString("utf8");
  if (typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const fields = ["error", "error_description", "message", "hint"]
      .map((k) => p[k])
      .filter((v) => typeof v === "string" && v);
    return fields.length ? fields.join(" — ") : JSON.stringify(payload).slice(0, 400);
  }
  return String(payload).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
}

async function getAccessToken(creds: FreepbxCreds): Promise<string> {
  // Use FREEPBX_TOKEN_URL verbatim when set. Otherwise derive "<apiUrl>/token";
  // the token path is resolved relative to the API URL, which only preserves the
  // URL's path when it ends in "/" (".../api/api" + "token" would become
  // ".../api/token"), so normalize the trailing slash first.
  const apiBase = creds.apiUrl.endsWith("/") ? creds.apiUrl : `${creds.apiUrl}/`;
  const tokenUrl = creds.tokenUrl || `${apiBase}token`;
  const parsed = new URL(tokenUrl);
  const tokenHost = parsed.origin;
  const tokenPath = `${parsed.pathname}${parsed.search}`;

  const client = new ClientCredentials({
    client: { id: creds.clientId, secret: creds.clientSecret },
    auth: { tokenHost, tokenPath },
    // `true` (not "strict"): JSON responses are still parsed, but a non-JSON
    // error body (e.g. an HTML 500 page) is kept so the status and body can be
    // reported instead of a generic content-type error.
    http: { json: true },
  });

  let token;
  try {
    token = await client.getToken({ scope: creds.scope.split(" ") });
  } catch (err) {
    const e = err as Error & { data?: { payload?: unknown } };
    const detail = payloadDetail(e.data?.payload);
    console.error(`[freepbx] token request to ${tokenUrl} failed: ${e.message}${detail ? ` — ${detail}` : ""}`);
    throw new Error(
      `FreePBX token request to ${tokenUrl} failed: ${e.message}${detail ? ` — ${detail}` : ""}`,
    );
  }
  const accessToken = (token.token as { access_token?: string }).access_token;
  if (!accessToken) throw new Error(`FreePBX did not return an access token (${tokenUrl})`);
  return accessToken;
}

interface GqlResult {
  status: number;
  body: {
    data?: Record<string, { status?: unknown; message?: string } | null>;
    errors?: { message?: string }[];
  } | null;
  text: string; // raw response body, kept for diagnostics (e.g. a PHP error page)
}

async function gql(
  creds: FreepbxCreds,
  accessToken: string,
  query: string,
): Promise<GqlResult> {
  const res = await fetch(creds.gqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body: GqlResult["body"] = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body (e.g. an HTML error page) — kept in `text` */
  }
  return { status: res.status, body, text };
}

// Best available explanation of a failed call: GraphQL error messages if
// present, otherwise a trimmed, tag-stripped snippet of the raw body.
function failureDetail(result: GqlResult): string {
  const errors = result.body?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => e?.message ?? "unknown").join("; ");
  }
  const snippet = result.text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return snippet || "(empty response body)";
}

/**
 * Throw a descriptive error if a GraphQL call failed at the HTTP level, the
 * GraphQL level, or the mutation level (FreePBX returns `status: false` with a
 * message inside a 200 response for logical failures).
 */
function assertGqlOk(context: string, result: GqlResult, mutation?: string): void {
  if (result.status >= 400) {
    throw new Error(`${context} failed: HTTP ${result.status} — ${failureDetail(result)}`);
  }
  const errors = result.body?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`${context} failed: ${failureDetail(result)}`);
  }
  const payload = mutation ? result.body?.data?.[mutation] : undefined;
  if (payload && (payload.status === false || payload.status === "false")) {
    throw new Error(`${context} failed: ${payload.message ?? "FreePBX reported failure"}`);
  }
}

// Escape a value for safe interpolation inside a double-quoted GraphQL string.
// All schedule-derived and configured values pass through this to prevent a
// malformed/hostile value from breaking out of the query.
function gqlString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/**
 * Apply a set of ring-group updates and then reload the PBX configuration.
 * Throws if any mutation or the reload fails. Returns per-group HTTP statuses.
 */
export async function applyRingGroups(
  creds: FreepbxCreds,
  updates: RingGroupUpdate[],
): Promise<{ statuses: number[]; reloadStatus: number }> {
  const accessToken = await getAccessToken(creds);
  const statuses: number[] = [];

  for (const u of updates) {
    const cidFields = u.callerId
      ? `changecid: "fixed"\n          fixedcid: "${gqlString(u.callerId)}"`
      : `changecid: "default"`;

    const query = `mutation{
      updateRingGroup(input:{
        groupNumber: "${gqlString(u.groupNumber)}"
        description: "${gqlString(u.description)}"
        extensionList: "${gqlString(u.extensionList)}"
        strategy: "${gqlString(u.strategy)}"
        ringTime: "${gqlString(String(u.ringTime))}"
        postAnswer: "${gqlString(u.postAnswer)}"
        ${cidFields}
      }) {
        message status
      }
    }`;

    const result = await gql(creds, accessToken, query);
    try {
      assertGqlOk(
        `updateRingGroup ${u.groupNumber} (members: ${u.extensionList || "none"}, ` +
          `ringTime: ${u.ringTime}, postAnswer: ${u.postAnswer}, ` +
          `cid: ${u.callerId ? "fixed" : "default"})`,
        result,
        "updateRingGroup",
      );
    } catch (err) {
      // Full mutation in the container logs for debugging (no secrets in it;
      // the access token is only in the Authorization header).
      console.error(`[freepbx] failing mutation:\n${query}\n[freepbx] raw response (HTTP ${result.status}):\n${result.text.slice(0, 2000)}`);
      throw err;
    }
    statuses.push(result.status);
  }

  const reload = await gql(
    creds,
    accessToken,
    `mutation{ doreload(input:{}) { message status transaction_id } }`,
  );
  assertGqlOk("PBX reload", reload, "doreload");

  return { statuses, reloadStatus: reload.status };
}
