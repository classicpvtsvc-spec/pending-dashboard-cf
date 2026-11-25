/**
 * CHAT - floating button + list of users who are online now + one-to-one conversation.
 *
 * Works over one WebSocket (/api/chat -> Durable Object "ChatRoom" in worker.js). A connection stays open while the dashboard is
 * open and costs nothing while idle. If the server has no chat (self-hosted server.js, or the Durable Object is not set up yet)
 * the button simply never appears and nothing else on the dashboard is affected.
 *
 * Reads from app.js (read only): currentUser (username, password).
 */
(function () {
    'use strict';

    const WS_PATH = '/api/chat';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const user = () => (typeof currentUser !== 'undefined' ? currentUser : null);

    /* ---------- state ---------- */
    let ws = null, who = null;                 // socket / username it was opened for
    let ready = false, everReady = false, stopped = false;
    let tries = 0, retryTimer = null, hbTimer = null;
    let me = null, online = [];                // me = {username,name,...}; online = users online now (includes me)
    let unread = {};                           // peer username -> unread count
    const names = {};                          // username -> display name
    const roles = {};                          // username -> "role - branch"
    const msgs = {};                           // peer username -> messages loaded for the open conversation
    let panelOpen = false, convo = null;       // convo = username of the open conversation (null = list view)

    const isOnline = u => online.some(o => o.username === u);
    const nameOf = u => names[u] || u;
    const totalUnread = () => Object.keys(unread).reduce((s, k) => s + (unread[k] || 0), 0);

    /* ==========================================================================
       CONNECTION
       ========================================================================== */
    function connect() {
        const u = user();
        if (!u || stopped) return;
        let sock;
        try { sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + WS_PATH); }
        catch (e) { stopped = true; return; }
        ws = sock; who = u.username; ready = false;

        sock.onopen = () => {
            if (ws !== sock) return;
            sock.send(JSON.stringify({ t: 'auth', username: u.username, password: u.password }));
            clearInterval(hbTimer);
            hbTimer = setInterval(() => { try { if (sock.readyState === 1) sock.send('ping'); } catch (e) { /* ignore */ } }, 30000);   // keep-alive, answered by Cloudflare without cost
        };
        sock.onmessage = ev => {
            let m; try { m = JSON.parse(ev.data); } catch (e) { return; }      // "pong" is not JSON
            if (m && m.t) handle(m);
        };
        sock.onclose = () => {
            clearInterval(hbTimer);
            if (ws !== sock) return;
            ws = null; ready = false; online = [];
            render();
            if (stopped || !user()) return;
            // never connected at all -> chat is not available on this server: try only twice more, then stay hidden
            if (!everReady && tries >= 2) { stopped = true; return; }
            tries++;
            retryTimer = setTimeout(connect, Math.min(60000, 3000 * Math.pow(2, Math.min(tries, 5))));
        };
        sock.onerror = () => { /* onclose follows */ };
    }

    function disconnect() {
        clearTimeout(retryTimer); clearInterval(hbTimer);
        const s = ws; ws = null; who = null; ready = false;
        if (s) { try { s.onclose = null; s.close(1000); } catch (e) { /* ignore */ } }
    }

    function send(obj) { if (ws && ws.readyState === 1 && ready) { ws.send(JSON.stringify(obj)); return true; } return false; }

    /* ==========================================================================
       MESSAGES FROM THE SERVER
       ========================================================================== */
    function remember(list) {
        (list || []).forEach(o => { names[o.username] = o.name || o.username; roles[o.username] = [o.role, o.branch && o.branch !== 'ALL' ? o.branch : ''].filter(Boolean).join(' - '); });
    }

    function handle(m) {
        if (m.t === 'ready') {
            me = m.me; ready = true; everReady = true; tries = 0;
            remember([me]); remember(m.users); online = m.users || [];
            unread = {};
            (m.unread || []).forEach(x => { unread[x.u] = x.n; names[x.u] = x.name || x.u; });
            showFab();
            if (convo) openConversation(convo);      // reconnect: reload the open conversation
            else render();
        } else if (m.t === 'presence') {
            remember(m.users); online = m.users || [];
            render();
        } else if (m.t === 'history') {
            msgs[m.with] = m.msgs || [];
            unread[m.with] = 0;
            render();
        } else if (m.t === 'msg') {
            const x = m.msg, peer = x.from === me.username ? x.to : x.from;
            (msgs[peer] = msgs[peer] || []).push(x);
            if (x.to === me.username) {
                if (panelOpen && convo === peer) { unread[peer] = 0; send({ t: 'read', with: peer }); }
                else unread[peer] = (unread[peer] || 0) + 1;
            }
            render();
        } else if (m.t === 'error') {
            flash(m.error);
        } else if (m.t === 'authfail') {
            stopped = true; hideFab();
        }
    }

    /* ==========================================================================
       UI
       ========================================================================== */
    function ensureUI() {
        if ($('chat-fab')) return;
        const fab = document.createElement('button');
        fab.id = 'chat-fab'; fab.type = 'button'; fab.className = 'chat-fab'; fab.style.display = 'none';
        fab.setAttribute('aria-label', 'Chat');
        fab.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg><span class="chat-fab-badge" id="chat-fab-badge" style="display:none"></span>';
        fab.addEventListener('click', () => togglePanel());
        document.body.appendChild(fab);

        const p = document.createElement('div');
        p.id = 'chat-panel'; p.className = 'chat-panel'; p.style.display = 'none';
        p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Chat');
        document.body.appendChild(p);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && panelOpen) togglePanel(false); });
    }
    const showFab = () => { ensureUI(); $('chat-fab').style.display = ''; render(); };
    function hideFab() {
        const f = $('chat-fab'), p = $('chat-panel');
        if (f) f.style.display = 'none';
        if (p) p.style.display = 'none';
        panelOpen = false;
    }

    function togglePanel(force) {
        panelOpen = force === undefined ? !panelOpen : force;
        $('chat-panel').style.display = panelOpen ? 'flex' : 'none';
        if (panelOpen && convo) { unread[convo] = 0; send({ t: 'read', with: convo }); }
        render();
    }

    function openConversation(peer) {
        convo = peer;
        if (!msgs[peer]) msgs[peer] = [];
        unread[peer] = 0;
        send({ t: 'history', with: peer });
        render();
        setTimeout(() => { const i = $('chat-input'); if (i) i.focus(); }, 30);
    }

    function flash(text) {
        const el = $('chat-flash'); if (!el) return;
        el.textContent = text; el.style.display = 'block';
        clearTimeout(flash.t); flash.t = setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    const pad = n => String(n).padStart(2, '0');
    function stamp(ts) {
        const d = new Date(ts), n = new Date();
        const t = pad(d.getHours()) + ':' + pad(d.getMinutes());
        return d.toDateString() === n.toDateString() ? t : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${t}`;
    }

    function render() {
        const badge = $('chat-fab-badge');
        if (badge) { const n = totalUnread(); badge.style.display = n ? '' : 'none'; badge.textContent = n > 99 ? '99+' : n; }
        const p = $('chat-panel');
        if (!p || !panelOpen) return;
        const banner = ready ? '' : '<div class="chat-banner">Connecting...</div>';
        if (convo) renderConversation(p, banner); else renderList(p, banner);
    }

    function renderList(p, banner) {
        const others = online.filter(o => me && o.username !== me.username);
        const offlineUnread = Object.keys(unread).filter(u => unread[u] > 0 && !isOnline(u));
        const row = (u, on) => `<button type="button" class="chat-user" data-peer="${esc(u)}">
                <span class="chat-dot ${on ? 'on' : ''}"></span>
                <span class="chat-user-info"><span class="chat-user-name">${esc(nameOf(u))}</span><span class="chat-user-sub">${esc(roles[u] || (on ? '' : 'offline'))}</span></span>
                ${unread[u] ? `<span class="chat-unread">${unread[u]}</span>` : ''}</button>`;
        p.innerHTML = `
            <div class="chat-head"><div class="chat-title">Chat <span class="chat-sub">${others.length} online</span></div>
                <button type="button" class="chat-x" id="chat-close" aria-label="Close">&times;</button></div>
            ${banner}
            <div class="chat-list">
                ${others.length ? others.map(o => row(o.username, true)).join('') : '<div class="chat-empty">No other users are online right now.</div>'}
                ${offlineUnread.length ? '<div class="chat-group">Unread messages</div>' + offlineUnread.map(u => row(u, false)).join('') : ''}
            </div>`;
        $('chat-close').addEventListener('click', () => togglePanel(false));
        p.querySelectorAll('[data-peer]').forEach(b => b.addEventListener('click', () => openConversation(b.getAttribute('data-peer'))));
    }

    function renderConversation(p, banner) {
        const list = msgs[convo] || [];
        const on = isOnline(convo);
        let lastDay = '';
        const bubbles = list.map(x => {
            const day = new Date(x.ts).toDateString();
            const sep = day !== lastDay ? `<div class="chat-day">${esc(new Date(x.ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }))}</div>` : '';
            lastDay = day;
            const mine = me && x.from === me.username;
            return `${sep}<div class="chat-msg ${mine ? 'mine' : 'theirs'}"><div class="chat-bubble">${esc(x.text)}</div><div class="chat-time">${esc(stamp(x.ts))}</div></div>`;
        }).join('');
        const keepText = $('chat-input') ? $('chat-input').value : '';
        const hadFocus = !!$('chat-input') && document.activeElement === $('chat-input');
        const wasAtBottom = !$('chat-msgs') || ($('chat-msgs').scrollHeight - $('chat-msgs').scrollTop - $('chat-msgs').clientHeight < 60);
        p.innerHTML = `
            <div class="chat-head">
                <button type="button" class="chat-back" id="chat-back" aria-label="Back">&#8592;</button>
                <div class="chat-title chat-peer"><span class="chat-dot ${on ? 'on' : ''}"></span>${esc(nameOf(convo))}<span class="chat-sub">${on ? 'online' : 'offline'}</span></div>
                <button type="button" class="chat-x" id="chat-close" aria-label="Close">&times;</button></div>
            ${banner}
            <div class="chat-msgs" id="chat-msgs">${bubbles || '<div class="chat-empty">No messages yet. Say hello!</div>'}</div>
            <div class="chat-flash" id="chat-flash" style="display:none"></div>
            <form class="chat-form" id="chat-form" autocomplete="off">
                <textarea id="chat-input" rows="1" maxlength="500" placeholder="${on ? 'Type a message...' : 'User is offline - they will see it later'}"></textarea>
                <button type="submit" class="chat-send" aria-label="Send">&#10148;</button>
            </form>`;
        const box = $('chat-msgs');
        if (wasAtBottom) box.scrollTop = box.scrollHeight;
        const input = $('chat-input'); input.value = keepText;
        if (hadFocus) { input.focus(); input.setSelectionRange(keepText.length, keepText.length); }
        $('chat-close').addEventListener('click', () => togglePanel(false));
        $('chat-back').addEventListener('click', () => { convo = null; render(); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chat-form').requestSubmit(); } });
        $('chat-form').addEventListener('submit', e => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            if (!send({ t: 'msg', to: convo, text: text })) { flash('Not connected. Trying to reconnect...'); return; }
            input.value = '';
            wasAtBottom && setTimeout(() => { const b = $('chat-msgs'); if (b) b.scrollTop = b.scrollHeight; }, 0);
        });
    }

    /* ==========================================================================
       START / STOP WITH THE LOGIN
       ========================================================================== */
    function sync() {
        const u = user();
        if (!u) {                                   // logged out
            if (who) { disconnect(); }
            online = []; unread = {}; convo = null; me = null; ready = false; everReady = false; stopped = false; tries = 0;
            Object.keys(msgs).forEach(k => delete msgs[k]);
            hideFab();
            return;
        }
        if (who !== u.username) {                   // new login (or another user logged in)
            disconnect(); stopped = false; tries = 0; everReady = false; convo = null;
            Object.keys(msgs).forEach(k => delete msgs[k]);
            connect();
        }
    }

    function init() {
        sync();
        const app = $('app-container');
        if (app) new MutationObserver(sync).observe(app, { attributes: true, attributeFilter: ['style'] });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
