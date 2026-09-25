import {
  adminClient,
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
  const payload = await readJson(req, 16_384);
  if (payload instanceof Response) return payload;
  const body = payload as Record<string, unknown>;

  const platform = String(body.platform ?? "").toUpperCase();
  const login = String(body.login ?? "").trim();
  const server = String(body.server ?? "").trim();
  const keyId = String(body.key_id ?? "").trim();
  const ciphertext = String(body.ciphertext_base64 ?? "").trim();

  if (!["MT4", "MT5"].includes(platform)) {
    return jsonResponse(req, { error: "invalid_platform" }, 400, true);
  }
  if (!login || login.length > 64 || !/^[0-9]+$/.test(login)) {
    return jsonResponse(req, { error: "invalid_login" }, 400, true);
  }
  if (!server || server.length > 128 || /[\r\n]/.test(server)) {
    return jsonResponse(req, { error: "invalid_server" }, 400, true);
  }
  if (!keyId || keyId.length > 128) {
    return jsonResponse(req, { error: "invalid_key_id" }, 400, true);
  }
  if (ciphertext.length !== 512 || !/^[A-Za-z0-9+/]+$/.test(ciphertext)) {
    return jsonResponse(req, { error: "invalid_ciphertext" }, 400, true);
  }
  try {
    if (atob(ciphertext).length !== 384) throw new Error("wrong length");
  } catch {
    return jsonResponse(req, { error: "invalid_ciphertext" }, 400, true);
  }

  const { data, error } = await adminClient().rpc("broker_connect_service", {
    p_user_id: user.userId,
    p_platform: platform,
    p_login: login,
    p_server: server,
    p_key_id: keyId,
    p_ciphertext_base64: ciphertext,
  });
  if (error) {
    const code = String(error.message || "").includes("collector key unavailable")
      ? "collector_key_stale"
      : "connect_failed";
    return jsonResponse(req, { error: code }, code === "collector_key_stale" ? 409 : 400, true);
  }
  return jsonResponse(req, { connection_id: data, state: "PENDING_VALIDATION" }, 202, true);
});
