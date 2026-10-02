import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const ALLOWED_ORIGIN = "https://andrey244.github.io";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

function mappedKey(mapEnv: string, legacyEnv: string): string {
  const raw = Deno.env.get(mapEnv);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const value = parsed?.default;
      if (typeof value === "string" && value.length > 20) return value;
    } catch {
      // Fall through to the legacy environment variable.
    }
  }
  const legacy = Deno.env.get(legacyEnv);
  if (!legacy) throw new Error("required Supabase key is unavailable");
  return legacy;
}

function publishableKey(): string {
  return mappedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
}

function secretKey(): string {
  return mappedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
}

export function adminClient() {
  return createClient(SUPABASE_URL, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  }
  return headers;
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
  cors = false,
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (cors) Object.assign(headers, corsHeaders(req));
  return new Response(JSON.stringify(body), { status, headers });
}

export function optionsResponse(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function requireApprovedUser(
  req: Request,
): Promise<{ userId: string } | Response> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.length < 32) {
    return jsonResponse(req, { error: "unauthorized" }, 401, true);
  }
  const token = auth.slice(7).trim();
  const userClient = createClient(SUPABASE_URL, publishableKey(), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse(req, { error: "unauthorized" }, 401, true);
  }
  const { data: approved, error: memberError } = await userClient.rpc("is_approved_member");
  if (memberError || approved !== true) {
    return jsonResponse(req, { error: "member_not_approved" }, 403, true);
  }
  return { userId: userData.user.id };
}

async function sha256Hex(value: string): Promise<string> {
  const input = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function requireCollector(
  req: Request,
): Promise<{ nodeId: string; keyId: string } | Response> {
  const token = (req.headers.get("x-collector-token") ?? "").trim();
  if (token.length < 32 || token.length > 256) {
    return jsonResponse(req, { error: "unauthorized" }, 401);
  }
  const tokenHash = await sha256Hex(token);
  const admin = adminClient();
  const { data, error } = await admin.rpc("collector_authenticate_service", {
    p_token_hash: tokenHash,
  });
  if (error) {
    return jsonResponse(req, { error: "collector_auth_failed" }, 500);
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.node_id || !row?.key_id) {
    return jsonResponse(req, { error: "unauthorized" }, 401);
  }
  return { nodeId: String(row.node_id), keyId: String(row.key_id) };
}

export async function readJson(
  req: Request,
  maxBytes = 32_768,
): Promise<unknown | Response> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return jsonResponse(req, { error: "payload_too_large" }, 413);
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return jsonResponse(req, { error: "payload_too_large" }, 413);
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    return jsonResponse(req, { error: "invalid_json" }, 400);
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
