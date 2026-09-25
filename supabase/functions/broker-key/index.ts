import {
  adminClient,
  jsonResponse,
  optionsResponse,
  requireApprovedUser,
} from "./shared.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405, true);

  const user = await requireApprovedUser(req);
  if (user instanceof Response) return user;

  const { data, error } = await adminClient().rpc("collector_active_public_key_service");
  if (error) return jsonResponse(req, { error: "key_lookup_failed" }, 500, true);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.key_id || !row?.public_key_pem) {
    return jsonResponse(req, { error: "collector_not_ready" }, 503, true);
  }
  return jsonResponse(req, {
    key_id: row.key_id,
    algorithm: row.algorithm,
    public_key_pem: row.public_key_pem,
  }, 200, true);
});
