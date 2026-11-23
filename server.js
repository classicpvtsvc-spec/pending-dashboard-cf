// Classic Dashboard - self-hosted server (runs on your own Oracle Cloud VM in Saudi Arabia).
// Replaces worker.js: serves the website files AND stores the uploaded data on this server's disk.
// Same /api/data address as before, so index.html / app.js need NO change.
//
//   GET  /api/data                -> info (file name, upload time, uploader) for all datasets
//   GET  /api/data?type=pending   -> the saved file (also: registration, closure, users)
//   GET  /api/data?type=avatars   -> small map of profile photos
//   POST /api/data?type=pending   -> save/replace the file (Admin key required)
//   POST /api/data?type=profile   -> a user updates own name / password / photo
//   POST /api/overtime            -> Overtime module (list / save / status), checked with the user's own User ID + password
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

/* ==========================================================================
   OVERTIME MODULE storage (disk): DATA_DIR/overtime/b_<branch>.json  +  DATA_DIR/overtime/people.json
   ========================================================================== */
const OT_DIR = path.join(DATA_DIR, "overtime");
fs.mkdirSync(OT_DIR, { recursive: true });
const otFile = key => path.join(OT_DIR, key.replace(/^ot:b:/, "b_").replace(/[^a-z0-9_-]/gi, "_") + ".json");
const otStore = {
  async listKeys() { return fs.readdirSync(OT_DIR).filter(f => /^b_.*\.json$/.test(f)).map(f => "ot:b:" + f.slice(2, -5)); },
  async getShard(key) { try { return JSON.parse(fs.readFileSync(otFile(key), "utf8")); } catch { return []; } },
  async putShard(key, arr) { const f = otFile(key); fs.writeFileSync(f + ".tmp", JSON.stringify(arr)); fs.renameSync(f + ".tmp", f); },
  async getPeople() { try { return JSON.parse(fs.readFileSync(path.join(OT_DIR, "people.json"), "utf8")); } catch { return {}; } },
  async putPeople(obj) { const f = path.join(OT_DIR, "people.json"); fs.writeFileSync(f + ".tmp", JSON.stringify(obj)); fs.renameSync(f + ".tmp", f); }
};
let otBusy = Promise.resolve();   // one request at a time, so two saves never overwrite each other
async function handleOvertimeApi(req, res) {
  if (req.method !== "POST") return sendJson(res, { error: "Method not allowed" }, 405);
  let p;
  try { p = JSON.parse((await readBody(req, 100 * 1024)).toString("utf8")); } catch { return sendJson(res, { error: "Invalid request" }, 400); }
  const raw = readText("file_users", "");
  if (!raw) return sendJson(res, { error: "User list is not saved online yet. Ask the Admin to open User Management and save once." }, 409);
  let users;
  try { users = JSON.parse(raw); } catch { return sendJson(res, { error: "Saved user list is unreadable" }, 500); }
  const run = otBusy.then(() => otHandle(otStore, users, p));
  otBusy = run.catch(() => {});
  const out = await run;
  return sendJson(res, out.body, out.status);
}

/* ---------- Overtime rules (same code is used in worker.js) ----------
 * POST /api/overtime   JSON body: { username, password, action, ... }
 *   action "list"   -> entries this user may see (+ remembered people)
 *   action "save"   -> Supervisor / Manager: add a new entry or edit an existing one (only while its status is "Submitted")
 *   action "status" -> Admin only: change the status of an entry
 * Users are verified against the saved user list (same as the profile endpoint), so no Admin key is needed.
 * Entries are stored per branch (one small record list per branch) so two branches never overwrite each other.
 */
const OT_DESIGNATIONS = ["Driver", "Spare parts", "Supervisor/PIC", "Technician", "Helper"];
const OT_JOB_TYPES = ["Parts sale", "Pickup Job", "Service job", "Supervision"];
const OT_STATUSES = ["Submitted", "Submitted to HR", "Rejected", "Reviewing"];

const otBranchKey = b => "ot:b:" + String(b || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* store = { listKeys(), getShard(key), putShard(key, arr), getPeople(), putPeople(obj) }  (all async) */
async function otHandle(store, users, p) {
  const fail = (status, error) => ({ status, body: { error } });

  const uid = String(p.username || "").trim().toLowerCase();
  const user = Array.isArray(users) ? users.find(u => String(u.username || "").toLowerCase() === uid) : null;
  if (!user || user.password !== String(p.password || "")) return fail(401, "Your login is not valid. Please log out and log in again.");
  const role = ["Admin", "Manager", "Supervisor"].includes(user.role) ? user.role : "Supervisor";
  const myBranch = String(user.branch || "").trim();
  const myName = String(user.name || user.username || "").trim();
  if (role === "Supervisor" && (!myBranch || myBranch === "ALL")) return fail(403, "No branch is assigned to your user. Ask the Admin.");

  // Read the shards this user may see. `over` = shards just written in this request (so the reply is never stale).
  const readScope = async over => {
    let keys = role === "Supervisor" ? [otBranchKey(myBranch)] : await store.listKeys();   // Admin + Manager read every branch (Manager is view-only; edit/status rules below still apply)
    keys = Array.from(new Set(keys.concat(Object.keys(over))));
    let all = [];
    for (const k of keys) {
      const arr = over[k] !== undefined ? over[k] : await store.getShard(k);
      all = all.concat(arr);
    }
    all.sort((a, b) => String(b.otDate).localeCompare(String(a.otDate)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return all;
  };
  const reply = async over => ({ status: 200, body: { ok: true, entries: await readScope(over || {}), people: await store.getPeople(), statuses: OT_STATUSES } });

  const action = String(p.action || "list");
  if (action === "list") return reply();

  /* ---------- Admin: change status ---------- */
  if (action === "status") {
    if (role !== "Admin") return fail(403, "Only the Admin can change the status.");
    const status = String(p.status || "");
    if (!OT_STATUSES.includes(status)) return fail(400, "Invalid status.");
    const id = String(p.id || "");
    let keys = [];
    if (p.branch) keys.push(otBranchKey(p.branch));
    keys = keys.concat(await store.listKeys());
    for (const k of Array.from(new Set(keys))) {
      const arr = await store.getShard(k);
      const i = arr.findIndex(e => e.id === id);
      if (i < 0) continue;
      arr[i].status = status; arr[i].statusBy = myName; arr[i].statusAt = new Date().toISOString();
      await store.putShard(k, arr);
      return reply({ [k]: arr });
    }
    return fail(404, "Entry not found (it may have been removed).");
  }

  /* ---------- Supervisor / Manager: add or edit ---------- */
  if (action === "save") {
    const e = p.entry || {};
    const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
    const num = (v, label, max, integer) => {
      const s = String(v == null ? "" : v).trim();
      if (!(integer ? /^\d+$/ : /^\d+(\.\d+)?$/).test(s)) throw new Error(label + (integer ? " must be a whole number." : " must be a number."));
      const n = Number(s);
      if (!isFinite(n) || n > max) throw new Error(label + " is too large.");
      return n;
    };
    let c;
    try {
      c = {
        branch: role === "Supervisor" ? myBranch : str(e.branch, 40),
        cssId: str(e.cssId, 30), employeeId: str(e.employeeId, 30), designation: str(e.designation, 30),
        employeeName: str(e.employeeName, 80), jobType: str(e.jobType, 30), otDate: str(e.otDate, 10),
        remarks: str(e.remarks, 300)
      };
      if (!c.branch) throw new Error("Branch is required.");
      if (!c.cssId) throw new Error("CSS ID is required.");
      if (!c.employeeId) throw new Error("Employee ID is required.");
      if (!OT_DESIGNATIONS.includes(c.designation)) throw new Error("Select a valid Designation.");
      if (!c.employeeName) throw new Error("Employee Name is required.");
      if (!OT_JOB_TYPES.includes(c.jobType)) throw new Error("Select a valid Job Type.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.otDate) || isNaN(Date.parse(c.otDate))) throw new Error("OT Date is not valid.");
      c.attendQty = num(e.attendQty, "TTL ATTEND Qty", 99999, true);
      c.closedQty = num(e.closedQty, "TTL Closed Qty", 99999, true);
      c.otHrs = num(e.otHrs, "TTL OT Hrs", 744, false);
      c.basicSalary = num(e.basicSalary, "Basic Salary", 9999999, false);
    } catch (err) { return fail(400, err.message); }

    const now = new Date().toISOString();
    const newKey = otBranchKey(c.branch);
    const over = {};
    let rec;

    if (e.id) {                                                   // ----- edit
      const id = String(e.id);
      const oldKey = otBranchKey(e.fromBranch || c.branch);
      const oldArr = await store.getShard(oldKey);
      const i = oldArr.findIndex(x => x.id === id);
      if (i < 0) return fail(404, "Entry not found.");
      const cur = oldArr[i];
      const mine = role === "Supervisor" ? otBranchKey(cur.branch) === otBranchKey(myBranch) : cur.createdBy === user.username;
      if (!mine) return fail(403, "You cannot edit this entry.");
      if (cur.status !== "Submitted") return fail(409, "This entry is now '" + cur.status + "' and can no longer be edited.");
      rec = Object.assign({}, cur, c, { updatedAt: now, updatedBy: myName });
      if (oldKey === newKey) { oldArr[i] = rec; over[newKey] = oldArr; }
      else {
        oldArr.splice(i, 1);
        const target = await store.getShard(newKey); target.push(rec);
        over[oldKey] = oldArr; over[newKey] = target;
      }
    } else {                                                      // ----- new
      rec = Object.assign({ id: "ot_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }, c,
        { status: "Submitted", createdBy: user.username, createdByName: myName, createdAt: now, updatedAt: now });
      const target = await store.getShard(newKey); target.push(rec);
      over[newKey] = target;
    }
    for (const k of Object.keys(over)) await store.putShard(k, over[k]);

    // remember Employee ID + name for this CSS ID (used to auto-fill next time)
    const people = await store.getPeople();
    people[c.cssId.toUpperCase()] = { employeeId: c.employeeId, name: c.employeeName, branch: c.branch, updatedAt: now };
    await store.putPeople(people);
    return reply(over);
  }

  return fail(400, "Unknown action.");
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
    if (url.pathname === "/api/overtime") return await handleOvertimeApi(req, res);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, { error: "Server error" }, 500);
  }
}).listen(PORT, HOST, () => console.log(`Dashboard server running on http://${HOST}:${PORT}  (data folder: ${DATA_DIR})`));
