import { ClientCredentials } from "simple-oauth2";
import { env } from "./env";

// FreePBX driver: OAuth2 client-credentials auth + GraphQL ring-group mutations.
// Ported from the original DiALERT server.js. Credentials default to the shared
// env values but can be overridden per system (future multi-PBX support).

export interface FreepbxCreds {
  apiUrl: string; // token host, e.g. https://pbx.example.com/admin/api/api/
  gqlUrl: string; // GraphQL endpoint
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

export function resolveCreds(overrides?: Partial<FreepbxCreds>): FreepbxCreds {
  const base = env.freepbx();
  const creds: FreepbxCreds = {
    apiUrl: overrides?.apiUrl || base.apiUrl,
    gqlUrl: overrides?.gqlUrl || base.gqlUrl,
    clientId: overrides?.clientId || base.clientId,
    clientSecret: overrides?.clientSecret || base.clientSecret,
    scope: overrides?.scope || base.scope,
  };
  const missing = Object.entries(creds)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`FreePBX credentials incomplete; missing: ${missing.join(", ")}`);
  }
  return creds;
}

async function getAccessToken(creds: FreepbxCreds): Promise<string> {
  const client = new ClientCredentials({
    client: { id: creds.clientId, secret: creds.clientSecret },
    auth: { tokenHost: creds.apiUrl, tokenPath: "token" },
    http: { json: "strict" },
  });
  const token = await client.getToken({ scope: creds.scope.split(" ") });
  const accessToken = (token.token as { access_token?: string }).access_token;
  if (!accessToken) throw new Error("FreePBX did not return an access token");
  return accessToken;
}

interface GqlResult {
  status: number;
  body: { data?: unknown; errors?: { message?: string }[] } | null;
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
  let body: GqlResult["body"] = null;
  try {
    body = await res.json();
  } catch {
    /* ignore non-JSON bodies */
  }
  return { status: res.status, body };
}

/** Throw a descriptive error if a GraphQL call failed at the HTTP or GraphQL level. */
function assertGqlOk(context: string, result: GqlResult): void {
  if (result.status >= 400) {
    throw new Error(`${context} failed: HTTP ${result.status}`);
  }
  const errors = result.body?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const messages = errors.map((e) => e?.message ?? "unknown").join("; ");
    throw new Error(`${context} failed: ${messages}`);
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
    assertGqlOk(`updateRingGroup ${u.groupNumber}`, result);
    statuses.push(result.status);
  }

  const reload = await gql(
    creds,
    accessToken,
    `mutation{ doreload(input:{}) { message status transaction_id } }`,
  );
  assertGqlOk("PBX reload", reload);

  return { statuses, reloadStatus: reload.status };
}
