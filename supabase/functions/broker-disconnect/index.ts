import {
  adminClient,
  isUuid,
  jsonResponse,
  optionsResponse,
  readJson,
  requireApprovedUser,
} from "./shared.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405, true);

  const user = await requireApprovedUser(req);
  if (user instanceof Response) return user;
  const payload = await readJson(req, 8_192);
  if (payload instanceof Response) return payload;
  const connectionId = (payload as Record<string, unknown>).connection_id;

  if (!isUuid(connectionId)) {
    return jsonResponse(req, { error: "invalid_connection_id" }, 400, true);
  }
  const { data, error } = await adminClient().rpc("broker_disconnect_service", {
    p_user_id: user.userId,
    p_connection_id: connectionId,
  });
  if (error) return jsonResponse(req, { error: "disconnect_failed" }, 500, true);
  if (data !== true) return jsonResponse(req, { error: "not_found" }, 404, true);
  return jsonResponse(req, { disconnected: true }, 200, true);
});
