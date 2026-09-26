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

  const payload = await readJson(req, 1_100_000);
  if (payload instanceof Response) return payload;
  const body = payload as Record<string, unknown>;
  const jobId = body.job_id;
  const attempt = Number(body.attempt);
  const events = body.events;

  if (
    !isUuid(jobId) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !Array.isArray(events) ||
    events.length > 200
  ) {
    return jsonResponse(req, { error: "invalid_ingest" }, 400);
  }

  const { data, error } = await adminClient().rpc("collector_ingest_events_service", {
    p_node_id: collector.nodeId,
    p_job_id: jobId,
    p_attempt: attempt,
    p_events: events,
  });
  if (error) {
    const stale = String(error.message || "").includes("invalid leased job");
    return jsonResponse(req, { error: stale ? "stale_or_invalid_job" : "ingest_failed" }, stale ? 409 : 400);
  }
  return jsonResponse(req, { inserted: Number(data || 0) }, 200);
});
