// Cloudflare Pages Function: permanent storage for the dashboard's uploaded data files.
// URL: /api/data   (same address the dashboard already uses, so app.js needs no change)
//   GET  /api/data              -> info (file name, upload time, uploader) for all 3 datasets
//   GET  /api/data?type=pending -> the saved file itself (also: registration, closure)
//   POST /api/data?type=pending -> save/replace the file (Admin key required)
//
// Needs two settings in Cloudflare (Pages project -> Settings):
//   * KV namespace binding, variable name:  DASH_KV
//   * Secret variable:                      ADMIN_UPLOAD_KEY
// Saving a new file under the same key automatically replaces (deletes) the old one.

const TYPES = ["pending", "registration", "closure"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (KV allows up to 25 MB per value)

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

export async function onRequest({ request, env }) {
  if (!env.DASH_KV) return json({ error: "KV binding DASH_KV is not configured" }, 500);

  const type = new URL(request.url).searchParams.get("type");

  // Small index of file info so a normal page load only reads one tiny key.
  const readInfo = async () => {
    const raw = await env.DASH_KV.get("meta");
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  };

  // ---------- READ (all users) ----------
  if (request.method === "GET") {
    if (!type) {
      const info = await readInfo();
      const out = {};
      TYPES.forEach(t => { out[t] = info[t] || null; });
      return json(out);
    }
    if (!TYPES.includes(type)) return json({ error: "Invalid type" }, 400);

    const data = await env.DASH_KV.get("file:" + type, { type: "arrayBuffer" });
    if (!data) return json({ error: "No data saved yet" }, 404);
    return new Response(data, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" }
    });
  }

  // ---------- SAVE (Admin only) ----------
  if (request.method === "POST") {
    if (!env.ADMIN_UPLOAD_KEY) return json({ error: "ADMIN_UPLOAD_KEY is not configured" }, 500);
    if (request.headers.get("x-admin-key") !== env.ADMIN_UPLOAD_KEY) return json({ error: "Invalid admin key" }, 401);
    if (!TYPES.includes(type)) return json({ error: "Invalid type" }, 400);

    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return json({ error: "Empty file" }, 400);
    if (body.byteLength > MAX_BYTES) return json({ error: "File too large (max 10 MB)" }, 413);

    const decode = (v, fallback) => { try { return decodeURIComponent(v || ""); } catch { return fallback; } };
    const meta = {
      fileName: decode(request.headers.get("x-file-name"), type) || type,
      uploadedBy: decode(request.headers.get("x-uploaded-by"), "Admin") || "Admin",
      uploadedAt: new Date().toISOString(),
      size: body.byteLength
    };

    await env.DASH_KV.put("file:" + type, body);        // overwrites previous file
    const info = await readInfo();
    info[type] = meta;
    await env.DASH_KV.put("meta", JSON.stringify(info));
    return json({ ok: true, meta });
  }

  return json({ error: "Method not allowed" }, 405);
}
