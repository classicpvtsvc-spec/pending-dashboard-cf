// Netlify Function: permanent storage for the dashboard's uploaded data files.
//   GET  /api/data              -> info (file name, upload time, uploader) for all 3 datasets
//   GET  /api/data?type=pending -> the saved file itself (also: registration, closure)
//   POST /api/data?type=pending -> save/replace the file (Admin key required)
// Storage = Netlify Blobs (built into Netlify, no extra account or setup).
// Saving a new file under the same key automatically replaces (deletes) the old one.
import { getStore } from "@netlify/blobs";

const TYPES = ["pending", "registration", "closure", "repair", "counter"];
const MAX_BYTES = 5 * 1024 * 1024; // Netlify functions accept request bodies up to ~6 MB

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

export default async (req) => {
  const store = getStore("dashboard-data");
  const type = new URL(req.url).searchParams.get("type");

  // ---------- READ (all users) ----------
  if (req.method === "GET") {
    if (!type) {
      const info = {};
      for (const t of TYPES) {
        const m = await store.getMetadata(t);
        info[t] = m ? m.metadata : null;
      }
      return json(info);
    }
    if (!TYPES.includes(type)) return json({ error: "Invalid type" }, 400);

    const item = await store.getWithMetadata(type, { type: "arrayBuffer" });
    if (!item) return json({ error: "No data saved yet" }, 404);
    return new Response(item.data, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" }
    });
  }

  // ---------- SAVE (Admin only) ----------
  if (req.method === "POST") {
    const serverKey = process.env.ADMIN_UPLOAD_KEY;
    if (!serverKey) return json({ error: "ADMIN_UPLOAD_KEY is not configured on Netlify" }, 500);
    if (req.headers.get("x-admin-key") !== serverKey) return json({ error: "Invalid admin key" }, 401);
    if (!TYPES.includes(type)) return json({ error: "Invalid type" }, 400);

    const body = await req.arrayBuffer();
    if (body.byteLength === 0) return json({ error: "Empty file" }, 400);
    if (body.byteLength > MAX_BYTES) return json({ error: "File too large (max 5 MB)" }, 413);

    const decode = (v, fallback) => { try { return decodeURIComponent(v || ""); } catch { return fallback; } };
    const meta = {
      fileName: decode(req.headers.get("x-file-name"), type) || type,
      uploadedBy: decode(req.headers.get("x-uploaded-by"), "Admin") || "Admin",
      uploadedAt: new Date().toISOString(),
      size: body.byteLength
    };
    await store.set(type, body, { metadata: meta }); // overwrites previous file
    return json({ ok: true, meta });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/data" };
