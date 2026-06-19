// ONEST creative-ID service.
// One running number per creative, shared across the whole team.
// Backed by a single-row D1 table so increments are atomic. No two
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
        // POST-only: claiming mutates state, so a GET (scanners, prefetchers,
        // link previews) must not burn an ID.
        if (request.method !== "POST") {
          return Response.json({ error: "use POST to claim an ID" }, { status: 405, headers: HEADERS });
        }
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

      if (url.pathname === "/angles") {
        // Shared, controlled angle vocabulary so the whole team picks from one list
        // (kills "cortisol belly" vs "cortisol weight" drift). The angle drives the
        // Drive agent's Edited/<Angle>/ folder, so a single source of truth matters.
        // Lazily ensure the table exists via the runtime binding (the D1 CLI can't reach
        // this DB from local auth, but the binding can, same path the counter uses).
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS angles (name TEXT PRIMARY KEY)").run();
        const seeded = await env.DB.prepare("SELECT COUNT(*) AS n FROM angles").first();
        if (!seeded || seeded.n === 0) {
          await env.DB.prepare("INSERT OR IGNORE INTO angles (name) VALUES ('Dad Bod')").run();
        }
        if (request.method === "GET") {
          const { results } = await env.DB
            .prepare("SELECT name FROM angles ORDER BY name COLLATE NOCASE")
            .all();
          return Response.json(
            { angles: (results || []).map((r) => r.name) },
            { headers: HEADERS },
          );
        }
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          // Normalise exactly like the Drive agent's canonicalAngle so the list, the
          // filenames, and the folders all agree (dad-bod / DAD BOD -> "Dad Bod").
          const name = String(body.name || "")
            .replace(/[^A-Za-z0-9 '&/+-]/g, "")
            .replace(/[-_]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase());
          if (!name || name.length > 60) {
            return Response.json({ error: "invalid angle name" }, { status: 400, headers: HEADERS });
          }
          await env.DB
            .prepare("INSERT OR IGNORE INTO angles (name) VALUES (?)")
            .bind(name)
            .run();
          return Response.json({ name }, { headers: HEADERS });
        }
        return Response.json({ error: "use GET or POST" }, { status: 405, headers: HEADERS });
      }

      if (url.pathname === "/health") {
        return Response.json(
          { ok: true, service: "onest-creative-id" },
          { headers: HEADERS },
        );
      }

      if (
        url.pathname === "/" ||
        url.pathname === "/filenamegenerator" ||
        url.pathname === "/filenamegenerator/"
      ) {
        // Serve the generator (proxy the GitHub Pages site, single source of truth,
        // no duplicated HTML). Lives at the root of generator.onestos.org.
        const page = await fetch("https://ryanspiteri.github.io/onest-filename-generator/", {
          cf: { cacheTtl: 300 },
        });
        const html = await page.text();
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
        });
      }

      return Response.json({ error: "not found" }, { status: 404, headers: HEADERS });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      return Response.json({ error: message }, { status: 500, headers: HEADERS });
    }
  },
};
