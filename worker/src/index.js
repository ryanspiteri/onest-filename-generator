// ONEST creative-ID service.
// One running number per creative, shared across the whole team.
// Backed by a single-row D1 table so increments are atomic — no two
// editors can ever claim the same ID, even clicking at the same instant.

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

      if (url.pathname === "/create-task" && request.method === "POST") {
        // Create the ClickUp task for a creative. Locked to the two ad boards
        // and to ID-prefixed names so the open endpoint can't be abused freely.
        const ALLOWED = new Set([
          "901605225338", // VIDEO AD BOARD
          "900302632860", // GRAPHIC AD BOARD
        ]);
        const body = await request.json().catch(() => ({}));
        const listId = String(body.listId || "");
        const name = String(body.name || "").trim();
        if (!ALLOWED.has(listId)) {
          return Response.json({ error: "list not allowed" }, { status: 400, headers: HEADERS });
        }
        if (!/^\d/.test(name)) {
          return Response.json({ error: "name must start with the creative ID" }, { status: 400, headers: HEADERS });
        }
        if (!env.CLICKUP_TOKEN) {
          return Response.json({ error: "server not configured" }, { status: 500, headers: HEADERS });
        }
        const cu = await fetch("https://api.clickup.com/api/v2/list/" + listId + "/task", {
          method: "POST",
          headers: { "Authorization": env.CLICKUP_TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const j = await cu.json().catch(() => ({}));
        if (!cu.ok) {
          return Response.json({ error: "clickup error", detail: j }, { status: 502, headers: HEADERS });
        }
        return Response.json({ id: j.id, url: j.url, name: j.name }, { headers: HEADERS });
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
