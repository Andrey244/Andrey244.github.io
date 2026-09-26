import {
  adminClient,
  isUuid,
  jsonResponse,
  readJson,
  requireCollector,
} from "./shared.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);
  const collector = await requireCollector(req);
  if (collector instanceof Response) return collector;

  const payload = await readJson(req, 16_384);
  if (payload instanceof Response) return payload;
  const body = payload as Record<string, unknown>;
  const jobId = body.job_id;
  const attempt = Number(body.attempt);
  const success = body.success;
  const errorCode = body.error_code == null ? null : String(body.error_code).slice(0, 128);
  const syncUntilMs = body.sync_until_ms == null ? null : Number(body.sync_until_ms);

  if (
    !isUuid(jobId) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    typeof success !== "boolean" ||
    (syncUntilMs !== null && (!Number.isSafeInteger(syncUntilMs) || syncUntilMs <= 0))
  ) {
    return jsonResponse(req, { error: "invalid_report" }, 400);
  }

  const { data, error } = await adminClient().rpc("collector_report_job_service", {
    p_node_id: collector.nodeId,
    p_job_id: jobId,
    p_attempt: attempt,
    p_success: success,
    p_error_code: errorCode,
    p_sync_until_ms: syncUntilMs,
  });
  if (error) return jsonResponse(req, { error: "report_failed" }, 500);
  if (data !== true) return jsonResponse(req, { error: "stale_or_invalid_job" }, 409);
  return jsonResponse(req, { accepted: true }, 200);
});
