// ONEST creative-ID service.
// One running number per creative, shared across the whole team.
// Backed by a single-row D1 table so increments are atomic — no two
// editors can ever claim the same ID, even clicking at the same instant.

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: HEADERS });
    }

    try {
      if (url.pathname === "/next") {
        // Atomic claim: D1 serialises writes, so RETURNING hands each
        // caller a distinct value.
        const row = await env.DB
          .prepare("UPDATE counter SET val = val + 1 WHERE id = 1 RETURNING val")
          .first();
        if (!row) throw new Error("counter row missing");
        return Response.json({ id: row.val }, { headers: HEADERS });
      }

      if (url.pathname === "/peek") {
        const row = await env.DB
          .prepare("SELECT val FROM counter WHERE id = 1")
          .first();
        const current = row ? row.val : 0;
        return Response.json({ current, next: current + 1 }, { headers: HEADERS });
      }

      if (url.pathname === "/" || url.pathname === "/health") {
        return Response.json(
          { ok: true, service: "onest-creative-id" },
          { headers: HEADERS },
        );
      }

      return Response.json({ error: "not found" }, { status: 404, headers: HEADERS });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      return Response.json({ error: message }, { status: 500, headers: HEADERS });
    }
  },
};
