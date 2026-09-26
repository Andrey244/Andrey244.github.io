import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((req: Request) => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "gone" }), { status: 410, headers });
  }
  const body = req.method === "HEAD" ? null : JSON.stringify({
    error: "gone",
    message: "Legacy journal endpoint retired. Use the GitHub Pages application.",
  });
  return new Response(body, { status: 410, headers });
});
