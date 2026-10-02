import {
  adminClient,
  jsonResponse,
  optionsResponse,
  readJson,
  requireApprovedUser,
} from "./shared.ts";

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || /[\r\n]/.test(text)) return null;
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405, true);

  const user = await requireApprovedUser(req);
  if (user instanceof Response) return user;

  const payload = await readJson(req, 262_144);
  if (payload instanceof Response) return payload;
  const body = payload as Record<string, unknown>;

  const source = cleanText(body.source, 8)?.toUpperCase();
  const account = cleanText(body.account, 64);
  const server = cleanText(body.server, 128);
  const rawTradeIds = body.trade_ids;

  if (!source || !["MT4", "MT5"].includes(source)) {
    return jsonResponse(req, { error: "invalid_source" }, 400, true);
  }
  if (!account) return jsonResponse(req, { error: "invalid_account" }, 400, true);
  if (!server) return jsonResponse(req, { error: "invalid_server" }, 400, true);
  if (!Array.isArray(rawTradeIds) || rawTradeIds.length > 10_000) {
    return jsonResponse(req, { error: "invalid_trade_ids" }, 400, true);
  }

  const tradeIds = [...new Set(rawTradeIds
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => /^LT_[0-9a-f]+$/i.test(value) && value.length <= 96))];

  const { data, error } = await adminClient().rpc("account_delete_data_service", {
    p_user_id: user.userId,
    p_source: source,
    p_account: account,
    p_server: server,
    p_trade_ids: tradeIds,
  });

  if (error) {
    const code = String(error.message || "");
    const known = [
      "account_not_archived",
      "active_connection",
      "connector_active",
      "invalid_source",
      "invalid_account",
      "invalid_server",
      "too_many_trade_ids",
      "member_not_approved",
    ].find((value) => code.includes(value));
    if (known === "account_not_archived" || known === "active_connection" || known === "connector_active") {
      return jsonResponse(req, { error: known }, 409, true);
    }
    if (known) return jsonResponse(req, { error: known }, 400, true);
    return jsonResponse(req, { error: "delete_failed" }, 500, true);
  }

  const result = (data && typeof data === "object") ? data : {};
  return jsonResponse(req, { deleted: true, ...result }, 200, true);
});
