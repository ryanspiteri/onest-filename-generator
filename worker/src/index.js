// ONEST creative-ID service + shared vocabularies for the Filename Generator.
// One running number per creative (atomic, single-row D1 table) so no two editors
// ever claim the same ID. Plus shared add-able lists (angles, types, personas,
// actors) so the whole team names creatives from one source of truth.

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

// Angles drive the Drive agent's Edited/<Angle>/ folder, so they are title-cased to
// match how the agent canonicalises them (dad-bod / DAD BOD -> "Dad Bod").
const titleCase = (s) =>
  String(s || "")
    .replace(/[^A-Za-z0-9 '&/+-]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Types / personas / actors are display labels (kebab'd into the filename later), so
// keep the team's own casing; just tidy whitespace. Dedupe is case-insensitive (the
// table's COLLATE NOCASE primary key).
const preserveCase = (s) =>
  String(s || "")
    .replace(/[^A-Za-z0-9 '&/+-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Generic add-able vocabulary backed by D1. The table is created + seeded lazily via
// the runtime binding (the D1 CLI can't reach this DB from local auth, but the binding
// can, same path the counter uses).
async function handleVocab(request, env, table, seed, normalize, legacyKey) {
  await env.DB
    .prepare(`CREATE TABLE IF NOT EXISTS ${table} (name TEXT PRIMARY KEY COLLATE NOCASE)`)
    .run();
  if (seed.length) {
    const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
    if (!c || c.n === 0) {
      for (const s of seed) {
        await env.DB.prepare(`INSERT OR IGNORE INTO ${table} (name) VALUES (?)`).bind(s).run();
      }
    }
  }
  if (request.method === "GET") {
    const { results } = await env.DB
      .prepare(`SELECT name FROM ${table} ORDER BY name COLLATE NOCASE`)
      .all();
    const items = (results || []).map((r) => r.name);
    const payload = { items };
    if (legacyKey) payload[legacyKey] = items; // back-compat for cached clients
    return Response.json(payload, { headers: HEADERS });
  }
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = normalize(body.name);
    if (!name || name.length > 60) {
      return Response.json({ error: "invalid name" }, { status: 400, headers: HEADERS });
    }
    await env.DB.prepare(`INSERT OR IGNORE INTO ${table} (name) VALUES (?)`).bind(name).run();
    return Response.json({ name }, { headers: HEADERS });
  }
  return Response.json({ error: "use GET or POST" }, { status: 405, headers: HEADERS });
}

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
        const row = await env.DB.prepare("SELECT val FROM counter WHERE id = 1").first();
        const current = row ? row.val : 0;
        return Response.json({ current, next: current + 1 }, { headers: HEADERS });
      }

      // Secret-guarded counter correction (the running number drifts when scanners hit
      // a GET). POST { secret, next } sets the counter so the next claim returns `next`.
      if (url.pathname === "/set-next" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!env.ADMIN_SECRET || body.secret !== env.ADMIN_SECRET) {
          return Response.json({ error: "unauthorized" }, { status: 401, headers: HEADERS });
        }
        const next = Number(body.next);
        if (!Number.isInteger(next) || next < 1) {
          return Response.json({ error: "next must be a positive integer" }, { status: 400, headers: HEADERS });
        }
        await env.DB.prepare("UPDATE counter SET val = ? WHERE id = 1").bind(next - 1).run();
        return Response.json({ next }, { headers: HEADERS });
      }

      if (url.pathname === "/angles") {
        return handleVocab(request, env, "angles", ["Dad Bod"], titleCase, "angles");
      }
      if (url.pathname === "/types") {
        return handleVocab(request, env, "types", ["Green screen", "Sticky note", "B-roll VO"], preserveCase);
      }
      if (url.pathname === "/personas") {
        return handleVocab(request, env, "personas", [], preserveCase);
      }
      if (url.pathname === "/actors") {
        return handleVocab(request, env, "actors", ["Ryan", "Kath", "Tyson", "Blake"], preserveCase);
      }

      if (url.pathname === "/health") {
        return Response.json({ ok: true, service: "onest-creative-id" }, { headers: HEADERS });
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
