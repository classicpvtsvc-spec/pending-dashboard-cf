// Cloudflare Worker: serves the dashboard files AND stores the uploaded data permanently.
//   GET  /api/data              -> info (file name, upload time, uploader) for all 3 datasets
//   GET  /api/data?type=pending -> the saved file itself (also: registration, closure)
//   POST /api/data?type=pending -> save/replace the file (Admin key required)
//   GET  /api/data?type=avatars -> small map of profile photos (shown on the login page)
//   POST /api/data?type=profile -> a user updates own name / password / photo (checked with their own password)
// Needs: KV binding DASH_KV (set in wrangler.jsonc) and a Secret named ADMIN_UPLOAD_KEY.
// Saving a new file under the same key automatically replaces (deletes) the old one.

const TYPES = ["pending", "registration", "closure", "users"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (KV allows up to 25 MB per value)

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/data") return handleData(request, env);
    return env.ASSETS.fetch(request); // everything else = your website files
  }
};

async function handleData(request, env) {
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
    if (type === "avatars") {
      const raw = await env.DASH_KV.get("avatars");
      return new Response(raw || "{}", { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    if (!TYPES.includes(type)) return json({ error: "Invalid type" }, 400);

    const data = await env.DASH_KV.get("file:" + type, { type: "arrayBuffer" });
    if (!data) return json({ error: "No data saved yet" }, 404);
    return new Response(data, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" }
    });
  }

  // ---------- PROFILE (any user, verified with their own User ID + password) ----------
  if (request.method === "POST" && type === "profile") {
    let p;
    try { p = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
    const raw = await env.DASH_KV.get("file:users");
    if (!raw) return json({ error: "User list is not saved online yet. Ask the Admin to open User Mgmt and save once." }, 409);
    let users;
    try { users = JSON.parse(raw); } catch { return json({ error: "Saved user list is unreadable" }, 500); }
    const uid = String(p.username || "").trim().toLowerCase();
    const user = Array.isArray(users) ? users.find(u => String(u.username || "").toLowerCase() === uid) : null;
    if (!user || user.password !== String(p.password || "")) return json({ error: "Current password is not correct" }, 401);

    if (typeof p.name === "string") user.name = p.name.trim().slice(0, 60);
    if (p.newPassword) {
      const np = String(p.newPassword);
      if (np.length < 4 || np.length > 60) return json({ error: "New password must be 4-60 characters" }, 400);
      user.password = np;
    }
    await env.DASH_KV.put("file:users", JSON.stringify(users));

    if (p.photo !== undefined) {
      let map = {};
      try { map = JSON.parse((await env.DASH_KV.get("avatars")) || "{}"); } catch { map = {}; }
      if (p.photo === "") delete map[uid];
      else {
        const ph = String(p.photo);
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(ph) || ph.length > 30000) return json({ error: "Photo is not valid or too large" }, 400);
        map[uid] = ph;
      }
      await env.DASH_KV.put("avatars", JSON.stringify(map));
    }
    return json({ ok: true });
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
