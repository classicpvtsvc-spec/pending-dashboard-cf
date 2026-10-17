// Classic Dashboard - self-hosted server (runs on your own Oracle Cloud VM in Saudi Arabia).
// Replaces worker.js: serves the website files AND stores the uploaded data on this server's disk.
// Same /api/data address as before, so index.html / app.js need NO change.
//
//   GET  /api/data                -> info (file name, upload time, uploader) for all datasets
//   GET  /api/data?type=pending   -> the saved file (also: registration, closure, users)
//   GET  /api/data?type=avatars   -> small map of profile photos
//   POST /api/data?type=pending   -> save/replace the file (Admin key required)
//   POST /api/data?type=profile   -> a user updates own name / password / photo
//
// Settings (environment variables):  ADMIN_UPLOAD_KEY (required), PORT (default 3000), DATA_DIR (default ./data)
// No npm packages needed. Node.js 18 or newer.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";          // Caddy (HTTPS) sits in front of this
const ADMIN_KEY = process.env.ADMIN_UPLOAD_KEY || "";
const APP_DIR = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(APP_DIR, "data"));
const TYPES = ["pending", "registration", "closure", "users", "repair", "counter"];
const MAX_BYTES = 10 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- website files that may be served (server/config files are never served) ----
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".webp": "image/webp"
};
const BLOCKED = new Set(["server.js", "worker.js", "wrangler.jsonc", "package.json", "caddyfile", "dashboard.service", ".assetsignore"]);

// ---- tiny storage helpers (atomic writes) ----
const fileOf = name => path.join(DATA_DIR, name);
function readText(name, fallback) { try { return fs.readFileSync(fileOf(name), "utf8"); } catch { return fallback; } }
function writeAtomic(name, data) {
  const tmp = fileOf(name + ".tmp");
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, fileOf(name));
}
const readJson = (name, fb) => { try { return JSON.parse(readText(name, "")) ; } catch { return fb; } };

const sendJson = (res, obj, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("too large"), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  const type = url.searchParams.get("type");

  // ---------- READ ----------
  if (req.method === "GET") {
    if (!type) {
      const info = readJson("meta.json", {});
      const out = {};
      TYPES.forEach(t => { out[t] = info[t] || null; });
      return sendJson(res, out);
    }
    if (type === "avatars") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(readText("avatars.json", "{}"));
    }
    if (!TYPES.includes(type)) return sendJson(res, { error: "Invalid type" }, 400);
    let data;
    try { data = fs.readFileSync(fileOf("file_" + type)); } catch { return sendJson(res, { error: "No data saved yet" }, 404); }
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" });
    return res.end(data);
  }

  if (req.method !== "POST") return sendJson(res, { error: "Method not allowed" }, 405);

  // ---------- PROFILE (any user, verified with own User ID + password) ----------
  if (type === "profile") {
    let p;
    try { p = JSON.parse((await readBody(req, 100 * 1024)).toString("utf8")); } catch { return sendJson(res, { error: "Invalid request" }, 400); }
    const raw = readText("file_users", "");
    if (!raw) return sendJson(res, { error: "User list is not saved online yet. Ask the Admin to open User Mgmt and save once." }, 409);
    let users;
    try { users = JSON.parse(raw); } catch { return sendJson(res, { error: "Saved user list is unreadable" }, 500); }
    const uid = String(p.username || "").trim().toLowerCase();
    const user = Array.isArray(users) ? users.find(u => String(u.username || "").toLowerCase() === uid) : null;
    if (!user || user.password !== String(p.password || "")) return sendJson(res, { error: "Current password is not correct" }, 401);

    if (typeof p.name === "string") user.name = p.name.trim().slice(0, 60);
    if (p.newPassword) {
      const np = String(p.newPassword);
      if (np.length < 4 || np.length > 60) return sendJson(res, { error: "New password must be 4-60 characters" }, 400);
      user.password = np;
    }
    writeAtomic("file_users", JSON.stringify(users));

    if (p.photo !== undefined) {
      const map = readJson("avatars.json", {});
      if (p.photo === "") delete map[uid];
      else {
        const ph = String(p.photo);
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(ph) || ph.length > 30000) return sendJson(res, { error: "Photo is not valid or too large" }, 400);
        map[uid] = ph;
      }
      writeAtomic("avatars.json", JSON.stringify(map));
    }
    return sendJson(res, { ok: true });
  }

  // ---------- SAVE (Admin only) ----------
  if (!ADMIN_KEY) return sendJson(res, { error: "ADMIN_UPLOAD_KEY is not configured" }, 500);
  if (req.headers["x-admin-key"] !== ADMIN_KEY) return sendJson(res, { error: "Invalid admin key" }, 401);
  if (!TYPES.includes(type)) return sendJson(res, { error: "Invalid type" }, 400);

  let body;
  try { body = await readBody(req, MAX_BYTES); }
  catch (e) { return sendJson(res, { error: "File too large (max 10 MB)" }, 413); }
  if (body.length === 0) return sendJson(res, { error: "Empty file" }, 400);

  const decode = (v, fb) => { try { return decodeURIComponent(v || ""); } catch { return fb; } };
  const meta = {
    fileName: decode(req.headers["x-file-name"], type) || type,
    uploadedBy: decode(req.headers["x-uploaded-by"], "Admin") || "Admin",
    uploadedAt: new Date().toISOString(),
    size: body.length
  };
  writeAtomic("file_" + type, body);                 // overwrites the previous file
  const info = readJson("meta.json", {});
  info[type] = meta;
  writeAtomic("meta.json", JSON.stringify(info));
  return sendJson(res, { ok: true, meta });
}

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === "/") rel = "/index.html";
  const full = path.resolve(APP_DIR, "." + rel);
  const name = path.basename(full).toLowerCase();
  const inside = full.startsWith(APP_DIR + path.sep) && !full.startsWith(DATA_DIR + path.sep);
  const ext = path.extname(full).toLowerCase();
  if (!inside || BLOCKED.has(name) || name.startsWith(".") || !MIME[ext]) { res.writeHead(404); return res.end("Not found"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[ext], "Cache-Control": ext === ".html" || ext === ".js" || ext === ".css" ? "no-cache" : "public, max-age=3600" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/data") return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, { error: "Server error" }, 500);
  }
}).listen(PORT, HOST, () => console.log(`Dashboard server running on http://${HOST}:${PORT}  (data folder: ${DATA_DIR})`));
