import {
  adminClient,
  jsonResponse,
  requireCollector,
} from "./shared.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);
  const collector = await requireCollector(req);
  if (collector instanceof Response) return collector;

  const { data, error } = await adminClient().rpc("collector_lease_job_service", {
    p_node_id: collector.nodeId,
  });
  if (error) return jsonResponse(req, { error: "lease_failed" }, 500);
  const job = Array.isArray(data) ? data[0] ?? null : null;
  return jsonResponse(req, { job }, 200);
});
