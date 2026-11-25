import { DurableObject } from "cloudflare:workers";

// Cloudflare Worker: serves the dashboard files AND stores the uploaded data permanently.
//   GET  /api/data              -> info (file name, upload time, uploader) for all 3 datasets
//   GET  /api/data?type=pending -> the saved file itself (also: registration, closure)
//   POST /api/data?type=pending -> save/replace the file (Admin key required)
//   GET  /api/data?type=avatars -> small map of profile photos (shown on the login page)
//   GET/POST /api/data?type=budget -> monthly branch targets + locked months (JSON, Admin key to save)
//   POST /api/data?type=profile -> a user updates own name / password / photo (checked with their own password)
//   POST /api/overtime          -> Overtime module (list / save / status), checked with the user's own User ID + password
// Needs: KV binding DASH_KV (set in wrangler.jsonc) and a Secret named ADMIN_UPLOAD_KEY.
// Saving a new file under the same key automatically replaces (deletes) the old one.

const TYPES = ["pending", "registration", "closure", "users", "repair", "counter", "budget"];
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
    if (url.pathname === "/api/overtime") return handleOvertime(request, env);
    if (url.pathname === "/api/chat") return handleChat(request, env);
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

    if (type === "budget") {                              // monthly targets + locked months (JSON)
      try {
        const b = JSON.parse(new TextDecoder().decode(body));
        if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("not an object");
      } catch { return json({ error: "Budget data is not valid JSON" }, 400); }
    }

    await env.DASH_KV.put("file:" + type, body);        // overwrites previous file
    const info = await readInfo();
    info[type] = meta;
    await env.DASH_KV.put("meta", JSON.stringify(info));
    return json({ ok: true, meta });
  }

  return json({ error: "Method not allowed" }, 405);
}


/* ==========================================================================
   OVERTIME MODULE storage (Cloudflare KV): one record list per branch ("ot:b:<branch>") + "ot:people"
   ========================================================================== */
async function handleOvertime(request, env) {
  if (!env.DASH_KV) return json({ error: "KV binding DASH_KV is not configured" }, 500);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let p;
  try { p = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const raw = await env.DASH_KV.get("file:users");
  if (!raw) return json({ error: "User list is not saved online yet. Ask the Admin to open User Management and save once." }, 409);
  let users;
  try { users = JSON.parse(raw); } catch { return json({ error: "Saved user list is unreadable" }, 500); }

  const readJson = async (key, fb) => { try { const t = await env.DASH_KV.get(key); return t ? JSON.parse(t) : fb; } catch { return fb; } };
  const store = {
    async listKeys() {
      const keys = []; let cursor;
      do {
        const r = await env.DASH_KV.list({ prefix: "ot:b:", cursor });
        r.keys.forEach(k => keys.push(k.name));
        cursor = r.list_complete ? undefined : r.cursor;
      } while (cursor);
      return keys;
    },
    getShard: key => readJson(key, []),
    putShard: (key, arr) => env.DASH_KV.put(key, JSON.stringify(arr)),
    getPeople: () => readJson("ot:people", {}),
    putPeople: obj => env.DASH_KV.put("ot:people", JSON.stringify(obj))
  };
  const out = await otHandle(store, users, p);
  return json(out.body, out.status);
}

/* ---------- Overtime rules (same code is used in server.js) ----------
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


/* ==========================================================================
   CHAT: /api/chat is a WebSocket that is handed to the ChatRoom Durable Object (needs the CHAT_ROOM binding in wrangler.jsonc)
   ========================================================================== */
function handleChat(request, env) {
  if (!env.CHAT_ROOM) return json({ error: "Chat is not enabled on this server" }, 503);
  if (request.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket required" }, 426);
  return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName("main")).fetch(request);
}

/* ==========================================================================
   CHAT (Cloudflare Durable Object, WebSocket Hibernation API, SQLite storage)
   - One shared room object ("main"). Connected + logged-in sockets = users who are online now.
   - Idle connections hibernate (no duration charge); keep-alive "ping" is answered by setWebSocketAutoResponse
     (no wake-up, no charge). Outgoing messages are free; incoming messages are billed 20:1.
   - History is kept per pair of users (last 300 messages) in the object's own SQLite database. KV is only read
     (1 read) to check the user's login, so the KV write/list limits are never touched.
   Client -> server (JSON): {t:"auth",username,password} {t:"history",with} {t:"msg",to,text} {t:"read",with}
   Server -> client (JSON): {t:"ready",me,users,unread} {t:"presence",users} {t:"history",with,msgs}
                            {t:"msg",msg} {t:"error",error} {t:"authfail"}
   ========================================================================== */
export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, from_u TEXT NOT NULL, to_u TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (pair, id)");
    sql.exec("CREATE TABLE IF NOT EXISTS reads (u TEXT NOT NULL, peer TEXT NOT NULL, last_id INTEGER NOT NULL, PRIMARY KEY (u, peer))");
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const now = Date.now();
    for (const w of this.ctx.getWebSockets()) {          // drop connections that never logged in
      const a = w.deserializeAttachment();
      if (!a || (!a.u && now - (a.at || 0) > 30000)) { try { w.close(4000, "no login"); } catch (e) { /* already closed */ } }
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ at: now });
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---------- helpers ---------- */
  async users(force) {
    if (!force && this._users && Date.now() - this._usersAt < 300000) return this._users;
    let arr = [];
    try { arr = JSON.parse((await this.env.DASH_KV.get("file:users")) || "[]"); } catch (e) { arr = []; }
    this._users = Array.isArray(arr) ? arr : [];
    this._usersAt = Date.now();
    return this._users;
  }
  findUser(users, name) {
    const n = String(name || "").trim().toLowerCase();
    return users.find(u => String(u.username || "").toLowerCase() === n) || null;
  }
  pub(u) { return { username: u.username, name: String(u.name || u.username), role: u.role || "", branch: u.branch || "" }; }
  pairKey(a, b) { return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join("|"); }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* socket is closing */ } }
  open() { return this.ctx.getWebSockets().filter(w => w.readyState === undefined || w.readyState === 1); }

  onlineList(skip) {
    const seen = new Map();
    for (const w of this.open()) {
      if (w === skip) continue;
      const a = w.deserializeAttachment();
      if (a && a.u && !seen.has(a.u)) seen.set(a.u, { username: a.u, name: a.n, role: a.r, branch: a.b });
    }
    return Array.from(seen.values()).sort((x, y) => x.name.localeCompare(y.name));
  }
  // leaving = socket that is closing (not in the list, not a recipient); joining = socket that already got "ready" (in the list, not a recipient)
  broadcastPresence(leaving, joining) {
    const users = this.onlineList(leaving);
    for (const w of this.open()) {
      if (w === leaving || w === joining) continue;
      const a = w.deserializeAttachment();
      if (a && a.u) this.send(w, { t: "presence", users });
    }
  }
  unreadFor(me, users) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT m.from_u AS peer, COUNT(*) AS n FROM messages m LEFT JOIN reads r ON r.u = m.to_u AND r.peer = m.from_u " +
      "WHERE m.to_u = ? AND m.id > COALESCE(r.last_id, 0) GROUP BY m.from_u", me).toArray();
    return rows.map(r => { const u = this.findUser(users, r.peer); return { u: r.peer, name: u ? String(u.name || u.username) : r.peer, n: r.n }; });
  }
  markRead(me, peer) {
    this.ctx.storage.sql.exec(
      "INSERT INTO reads (u, peer, last_id) VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) FROM messages WHERE pair = ?)) " +
      "ON CONFLICT (u, peer) DO UPDATE SET last_id = excluded.last_id", me, peer, this.pairKey(me, peer));
  }

  /* ---------- WebSocket events ---------- */
  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 4000) return;
    let m;
    try { m = JSON.parse(message); } catch (e) { return; }
    if (!m || typeof m !== "object") return;
    const att = ws.deserializeAttachment() || {};

    if (m.t === "auth") {
      let users = await this.users(false);
      let user = this.findUser(users, m.username);
      if (!user || user.password !== String(m.password || "")) {           // maybe the password changed: re-read the user list once
        users = await this.users(true);
        user = this.findUser(users, m.username);
      }
      if (!user || user.password !== String(m.password || "")) { this.send(ws, { t: "authfail" }); try { ws.close(4001, "login"); } catch (e) { /* closed */ } return; }
      const p = this.pub(user);
      ws.serializeAttachment({ u: p.username, n: p.name, r: p.role, b: p.branch, at: att.at || Date.now() });
      this.send(ws, { t: "ready", me: p, users: this.onlineList(), unread: this.unreadFor(p.username, users) });
      this.broadcastPresence(null, ws);
      return;
    }

    if (!att.u) { this.send(ws, { t: "authfail" }); try { ws.close(4001, "login"); } catch (e) { /* closed */ } return; }

    // simple flood guard: max 20 requests per 10 seconds per connection
    const now = Date.now();
    const rl = att.rl && now - att.rl[0] < 10000 ? att.rl : [now, 0];
    rl[1]++;
    ws.serializeAttachment(Object.assign({}, att, { rl: rl }));
    if (rl[1] > 20) { this.send(ws, { t: "error", error: "You are sending too fast. Please wait a moment." }); return; }

    const users = await this.users(false);
    const peerUser = this.findUser(users, m.t === "msg" ? m.to : m.with);
    if (!peerUser) { this.send(ws, { t: "error", error: "User not found." }); return; }
    const peer = peerUser.username;
    if (peer === att.u) return;

    if (m.t === "history") {
      const rows = this.ctx.storage.sql.exec(
        "SELECT id, from_u, to_u, text, ts FROM messages WHERE pair = ? ORDER BY id DESC LIMIT 100", this.pairKey(att.u, peer)).toArray().reverse();
      this.send(ws, { t: "history", with: peer, msgs: rows.map(r => ({ id: r.id, from: r.from_u, to: r.to_u, text: r.text, ts: r.ts })) });
      this.markRead(att.u, peer);
      return;
    }

    if (m.t === "read") { this.markRead(att.u, peer); return; }

    if (m.t === "msg") {
      const text = String(m.text == null ? "" : m.text).trim().slice(0, 500);
      if (!text) return;
      const key = this.pairKey(att.u, peer), ts = Date.now();
      const id = this.ctx.storage.sql.exec(
        "INSERT INTO messages (pair, from_u, to_u, text, ts) VALUES (?, ?, ?, ?, ?) RETURNING id", key, att.u, peer, text, ts).toArray()[0].id;
      this.ctx.storage.sql.exec(                                            // keep the newest 300 messages per pair
        "DELETE FROM messages WHERE pair = ? AND id <= (SELECT id FROM messages WHERE pair = ? ORDER BY id DESC LIMIT 1 OFFSET 300)", key, key);
      const out = { t: "msg", msg: { id: id, from: att.u, to: peer, text: text, ts: ts } };
      for (const w of this.open()) {
        const a = w.deserializeAttachment();
        if (a && (a.u === att.u || a.u === peer)) this.send(w, out);        // recipient + the sender's other tabs
      }
      return;
    }
  }

  async webSocketClose(ws, code) {
    const ok = code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code);
    try { ws.close(ok ? code : 1000, "bye"); } catch (e) { /* already closed */ }
    this.broadcastPresence(ws);
  }
  async webSocketError(ws) {
    try { ws.close(1011, "error"); } catch (e) { /* already closed */ }
    this.broadcastPresence(ws);
  }
}
