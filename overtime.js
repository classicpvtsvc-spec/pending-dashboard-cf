/**
 * OVERTIME MODULE (popup only - nothing is added to the dashboard page itself)
 *
 *  Supervisor / Manager : top-bar "Overtime" button  -> data collection form + their submitted entries (Edit while status = Submitted)
 *  Admin                : Admin menu -> "Overtime"   -> Overtime sheet (all entries, Amount column, status drop-down, Export Excel)
 *
 * Uses from app.js (read only): currentUser, closureData, getKnownBranches(), XLSX (SheetJS, already loaded by index.html).
 * Data is saved through POST /api/overtime (see worker.js / server.js).
 */
(function () {
    'use strict';

    const API = '/api/overtime';
    const DESIGNATIONS = ['Driver', 'Spare parts', 'Supervisor/PIC', 'Technician', 'Helper'];
    const JOB_TYPES = ['Parts sale', 'Pickup Job', 'Service job', 'Supervision'];
    const STATUSES = ['Submitted', 'Submitted to HR', 'Rejected', 'Reviewing'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /* ---------- OT amount policy ----------
     * Driver, Helper                              : TTL OT Hrs x 8
     * Spare parts, Supervisor/PIC, Technician     : TTL OT Hrs x 1.5 x 1 hour basic salary,  1 hour = (Basic salary / 30) / 8
     */
    function otAmount(e) {
        const hrs = Number(e.otHrs) || 0;
        let amt;
        if (e.designation === 'Driver' || e.designation === 'Helper') amt = hrs * 8;
        else amt = hrs * (((Number(e.basicSalary) || 0) / 30) / 8) * 1.5;
        return Math.round(amt * 100) / 100;
    }

    /* ---------- small helpers ---------- */
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const user = () => (typeof currentUser !== 'undefined' ? currentUser : null);
    const isAdmin = () => !!user() && user().role === 'Admin';
    const canSubmit = () => !!user() && (user().role === 'Supervisor' || user().role === 'Manager');
    const lc = s => String(s || '').trim().toLowerCase();
    const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}-${MONTHS[+m[2] - 1]}-${m[1]}` : (iso || ''); };
    const fmtNum = (n, d) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 2 : d });
    const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const optionList = (arr, sel, placeholder) =>
        (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
        arr.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

    /* ---------- state ---------- */
    let state = { entries: [], people: {} };
    let editing = null;              // the entry being edited (user view)
    let cloudTechs = [];             // technicians read from the saved Closure file (when closure data is not already in memory)
    let cloudTechsTried = false;
    let loadError = '';
    const adminFilter = { branch: '', status: '', from: '', to: '' };

    /* ==========================================================================
       SERVER CALLS
       ========================================================================== */
    async function api(action, extra) {
        const u = user();
        if (!u) throw new Error('Please log in again.');
        let res;
        try {
            res = await fetch(API, {
                method: 'POST', cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ username: u.username, password: u.password, action: action }, extra || {}))
            });
        } catch (e) { throw new Error('Cannot reach the server. Check the internet connection.'); }
        let data = {};
        try { data = await res.json(); } catch (e) { /* not JSON */ }
        if (res.status === 404 && !data.error) throw new Error('The Overtime service is not available on this server yet. Deploy the updated worker.js / server.js.');
        if (!res.ok || data.error) throw new Error(data.error || ('Server error ' + res.status));
        return data;
    }

    /* ==========================================================================
       TECHNICIAN LIST (CSS ID drop-down) - from the uploaded Closure data: TECH_CODE + technician name + branch
       ========================================================================== */
    function memoryTechs() {
        const out = [];
        try {
            if (typeof closureData !== 'undefined' && Array.isArray(closureData)) {
                closureData.forEach(r => {
                    if (r && r.techKey && r.tech && r.techKey !== r.tech) out.push({ branch: r.branch, code: String(r.techKey), name: String(r.tech) });
                });
            }
        } catch (e) { /* ignore */ }
        return out;
    }

    async function loadCloudTechs() {
        if (cloudTechsTried) return;
        cloudTechsTried = true;
        try {
            if (memoryTechs().length) return;                 // Admin already has the closure data open
            if (typeof XLSX === 'undefined') return;
            const info = await (await fetch('/api/data', { cache: 'no-store' })).json();
            if (!info || !info.closure) return;
            const res = await fetch('/api/data?type=closure', { cache: 'no-store' });
            if (!res.ok) return;
            const wb = XLSX.read(await res.arrayBuffer(), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
            if (rows.length < 2) return;
            const headers = rows[0].map(h => String(h || '').trim().toUpperCase());
            const find = (names, fb) => { for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; } return fb; };
            const bi = find(['BRANCH_NAME', 'BRANCH', 'BRANCH NAME'], 2);
            const ni = find(['TECHNICIAN_JOB_COMPLETED', 'TECHNICIAN_COMPLETED', 'TECHNICIAN_NAME', 'TECHNICIAN'], -1);
            const ci = find(['TECH_CODE_JOB_COMPLETED', 'TECH_CODE_COMPLETED', 'TECH_CODE'], -1);
            if (ci < 0) return;
            const seen = new Set();
            rows.slice(1).forEach(r => {
                const code = String(r[ci] == null ? '' : r[ci]).trim();
                const branch = String(r[bi] == null ? '' : r[bi]).trim();
                const name = ni >= 0 ? String(r[ni] == null ? '' : r[ni]).trim() : '';
                const k = lc(branch) + '|' + code.toUpperCase();
                if (!code || seen.has(k)) return;
                seen.add(k);
                cloudTechs.push({ branch: branch, code: code, name: name });
            });
        } catch (e) { console.warn('Technician list not loaded from the saved Closure file:', e); }
    }

    /** Technicians of one branch: [{code, name}] (unique by code, sorted by name) */
    function techsForBranch(branch) {
        const b = lc(branch), map = new Map();
        memoryTechs().concat(cloudTechs).forEach(t => {
            if (lc(t.branch) !== b) return;
            const k = t.code.toUpperCase();
            if (!map.has(k)) map.set(k, { code: t.code, name: t.name });
        });
        return Array.from(map.values()).sort((a, c) => (a.name || a.code).localeCompare(c.name || c.code));
    }

    function branchList() {
        const names = [];
        const add = n => { n = String(n || '').trim(); if (n && n !== 'ALL' && n !== 'Unknown' && !names.some(x => lc(x) === lc(n))) names.push(n); };
        try { if (typeof getKnownBranches === 'function') getKnownBranches().forEach(add); } catch (e) { /* ignore */ }
        memoryTechs().concat(cloudTechs).forEach(t => add(t.branch));
        state.entries.forEach(e => add(e.branch));
        Object.keys(state.people).forEach(k => add(state.people[k].branch));
        return names.sort((a, b) => a.localeCompare(b));
    }

    /* ==========================================================================
       MODAL SHELL
       ========================================================================== */
    function ensureModal() {
        let m = $('ot-modal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'ot-modal';
        m.className = 'modal-overlay ot-overlay';
        m.style.display = 'none';
        m.innerHTML = `
            <div class="modal-card ot-card" role="dialog" aria-modal="true" aria-labelledby="ot-title">
                <div class="modal-header">
                    <h3 id="ot-title">Overtime</h3>
                    <button type="button" class="btn-close" id="ot-close" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body ot-body" id="ot-body"></div>
            </div>`;
        document.body.appendChild(m);
        $('ot-close').addEventListener('click', closeOvertime);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.style.display !== 'none') closeOvertime(); });
        return m;
    }

    function closeOvertime() {
        const m = $('ot-modal');
        if (m) m.style.display = 'none';
        editing = null;
    }

    async function openOvertime() {
        if (!user() || (!isAdmin() && !canSubmit())) return;
        const m = ensureModal();
        editing = null;
        $('ot-title').textContent = isAdmin() ? 'Overtime - Admin Sheet' : 'Overtime - Data Collection';
        $('ot-body').innerHTML = '<div class="ot-loading">Loading...</div>';
        m.style.display = 'flex';

        loadError = '';
        const [listRes] = await Promise.all([api('list').catch(e => ({ error: e.message })), loadCloudTechs()]);
        if (listRes.error) loadError = listRes.error;
        else state = { entries: listRes.entries || [], people: listRes.people || {} };
        if (isAdmin()) renderAdmin(); else renderUser();
    }

    /* ==========================================================================
       SUPERVISOR / MANAGER VIEW  (form + own entries)
       ========================================================================== */
    function renderUser() {
        const u = user();
        const isSup = u.role === 'Supervisor';
        const branches = branchList();
        $('ot-body').innerHTML = `
            ${loadError ? `<div class="ot-banner err">${esc(loadError)}</div>` : ''}
            <div id="ot-edit-banner" class="ot-banner info" style="display:none"></div>
            <form id="ot-form" class="ot-form" autocomplete="off" novalidate>
                <div class="ot-grid">
                    <label class="ot-field"><span>Branch</span>
                        <select id="ot-branch" ${isSup ? 'disabled' : ''}>
                            ${isSup ? `<option value="${esc(u.branch)}">${esc(u.branch)}</option>` : optionList(branches, '', 'Select branch...')}
                        </select></label>
                    <label class="ot-field"><span>CSS ID</span>
                        <input id="ot-css" list="ot-css-list" maxlength="30" placeholder="Select or type ID" autocomplete="off">
                        <datalist id="ot-css-list"></datalist></label>
                    <label class="ot-field"><span>Employee ID</span>
                        <input id="ot-empid" maxlength="30" placeholder="Employee ID"></label>
                    <label class="ot-field"><span>Designation</span>
                        <select id="ot-desig">${optionList(DESIGNATIONS, '', 'Select...')}</select></label>
                    <label class="ot-field"><span>Employee Name</span>
                        <input id="ot-name" maxlength="80" placeholder="Employee name"></label>
                    <label class="ot-field"><span>Job Type</span>
                        <select id="ot-job">${optionList(JOB_TYPES, '', 'Select...')}</select></label>
                    <label class="ot-field"><span>OT Date:</span>
                        <input id="ot-date" type="date" value="${todayIso()}"></label>
                    <label class="ot-field"><span>TTL ATTEND Qty</span>
                        <input id="ot-attend" inputmode="numeric" maxlength="5" placeholder="0"></label>
                    <label class="ot-field"><span>TTL Closed Qty</span>
                        <input id="ot-closed" inputmode="numeric" maxlength="5" placeholder="0"></label>
                    <label class="ot-field"><span>TTL OT Hrs</span>
                        <input id="ot-hrs" inputmode="decimal" maxlength="6" placeholder="0.0"></label>
                    <label class="ot-field"><span>Basic Salary</span>
                        <input id="ot-salary" inputmode="decimal" maxlength="10" placeholder="0"></label>
                    <label class="ot-field"><span>Status</span>
                        <input id="ot-status" readonly tabindex="-1" class="ot-status-box" placeholder="Set after submit"></label>
                    <label class="ot-field ot-wide"><span>Any Remarks</span>
                        <input id="ot-remarks" maxlength="300" placeholder="Remarks (optional)"></label>
                </div>
                <div class="ot-actions">
                    <button type="submit" class="ot-btn primary" id="ot-submit">Submit</button>
                    <button type="button" class="ot-btn" id="ot-clear">Clear</button>
                    <span id="ot-msg" class="ot-msg" role="status"></span>
                </div>
            </form>
            <h4 class="ot-sub">${isSup ? 'Entries of ' + esc(u.branch) : 'My submitted entries'} <span class="ot-count" id="ot-count"></span></h4>
            <div class="ot-table-wrap"><table class="ot-table" id="ot-user-table"></table></div>`;

        wireForm();
        refreshCssList();
        renderUserTable();
        setStatusBox('');
    }

    const val = id => ($(id) ? $(id).value : '');
    const branchValue = () => (user().role === 'Supervisor' ? user().branch : val('ot-branch'));

    function setMsg(text, cls) { const el = $('ot-msg'); if (el) { el.textContent = text || ''; el.className = 'ot-msg ' + (cls || ''); } }
    function setStatusBox(text) {
        const el = $('ot-status'); if (!el) return;
        el.value = text || '';
        el.className = 'ot-status-box' + (text ? ' st-' + text.toLowerCase().replace(/[^a-z]+/g, '-') : '');
    }

    function refreshCssList() {
        const dl = $('ot-css-list'); if (!dl) return;
        const branch = branchValue();
        const rows = techsForBranch(branch);
        const seen = new Set(rows.map(r => r.code.toUpperCase()));
        Object.keys(state.people).forEach(code => {       // non-technician employees saved earlier for this branch
            const p = state.people[code];
            if (lc(p.branch) === lc(branch) && !seen.has(code)) { rows.push({ code: code, name: p.name }); seen.add(code); }
        });
        dl.innerHTML = rows.map(r => `<option value="${esc(r.code)}">${esc(r.name || '')}</option>`).join('');
        const hint = $('ot-css'); if (hint) hint.placeholder = rows.length ? 'Select or type ID' : (branch ? 'Type ID (no technician list for this branch)' : 'Select branch first');
    }

    let autoName = false, autoId = false;
    function applyCssId() {
        const code = val('ot-css').trim();
        if (!code) return;
        const person = state.people[code.toUpperCase()];
        const tech = techsForBranch(branchValue()).find(t => t.code.toUpperCase() === code.toUpperCase());
        const name = (person && person.name) || (tech && tech.name) || '';
        const empId = (person && person.employeeId) || '';
        if (name) { $('ot-name').value = name; autoName = true; } else if (autoName) { $('ot-name').value = ''; autoName = false; }
        if (empId) { $('ot-empid').value = empId; autoId = true; } else if (autoId) { $('ot-empid').value = ''; autoId = false; }
    }

    const onlyDigits = v => v.replace(/\D/g, '');
    const onlyDecimal = v => { v = v.replace(/[^0-9.]/g, ''); const i = v.indexOf('.'); return i < 0 ? v : v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ''); };

    function wireForm() {
        const clean = (id, fn) => $(id).addEventListener('input', () => { const c = fn($(id).value); if (c !== $(id).value) $(id).value = c; });
        clean('ot-attend', onlyDigits); clean('ot-closed', onlyDigits);
        clean('ot-hrs', onlyDecimal); clean('ot-salary', onlyDecimal);

        $('ot-branch').addEventListener('change', () => {
            refreshCssList();
            if (autoName) { $('ot-name').value = ''; autoName = false; }
            if (autoId) { $('ot-empid').value = ''; autoId = false; }
            $('ot-css').value = '';
        });
        $('ot-css').addEventListener('input', applyCssId);
        $('ot-css').addEventListener('change', applyCssId);
        $('ot-name').addEventListener('input', () => { autoName = false; });
        $('ot-empid').addEventListener('input', () => { autoId = false; });

        // typing a new entry clears the "Submitted" tick of the previous one
        $('ot-form').addEventListener('input', () => { if (!editing) setStatusBox(''); setMsg(''); });
        $('ot-form').addEventListener('submit', e => { e.preventDefault(); submitForm(); });
        $('ot-clear').addEventListener('click', () => { editing = null; resetForm(true); });
    }

    function resetForm(full) {
        const keepBranch = branchValue(), keepDate = val('ot-date');
        ['ot-css', 'ot-empid', 'ot-desig', 'ot-name', 'ot-job', 'ot-attend', 'ot-closed', 'ot-hrs', 'ot-salary', 'ot-remarks'].forEach(id => { $(id).value = ''; });
        autoName = autoId = false;
        if (!full) $('ot-date').value = keepDate; else $('ot-date').value = todayIso();
        if (user().role !== 'Supervisor') $('ot-branch').value = full ? '' : keepBranch;
        $('ot-submit').textContent = 'Submit';
        $('ot-edit-banner').style.display = 'none';
        $('ot-form').classList.remove('editing');
        setStatusBox('');
        setMsg('');
        refreshCssList();
    }

    function collect() {
        return {
            branch: branchValue(), cssId: val('ot-css').trim(), employeeId: val('ot-empid').trim(), designation: val('ot-desig'),
            employeeName: val('ot-name').trim(), jobType: val('ot-job'), otDate: val('ot-date'),
            attendQty: val('ot-attend').trim(), closedQty: val('ot-closed').trim(), otHrs: val('ot-hrs').trim(),
            basicSalary: val('ot-salary').trim(), remarks: val('ot-remarks').trim()
        };
    }

    function validate(e) {
        if (!e.branch) return ['ot-branch', 'Select the Branch.'];
        if (!e.cssId) return ['ot-css', 'Enter the CSS ID.'];
        if (!e.employeeId) return ['ot-empid', 'Enter the Employee ID.'];
        if (!e.designation) return ['ot-desig', 'Select the Designation.'];
        if (!e.employeeName) return ['ot-name', 'Enter the Employee Name.'];
        if (!e.jobType) return ['ot-job', 'Select the Job Type.'];
        if (!e.otDate) return ['ot-date', 'Select the OT Date.'];
        if (!/^\d+$/.test(e.attendQty)) return ['ot-attend', 'TTL ATTEND Qty: enter a whole number (0 if none).'];
        if (!/^\d+$/.test(e.closedQty)) return ['ot-closed', 'TTL Closed Qty: enter a whole number (0 if none).'];
        if (!/^\d+(\.\d+)?$/.test(e.otHrs)) return ['ot-hrs', 'TTL OT Hrs: enter a number (decimals allowed).'];
        if (!/^\d+(\.\d+)?$/.test(e.basicSalary)) return ['ot-salary', 'Basic Salary: enter a number.'];
        return null;
    }

    async function submitForm() {
        const e = collect();
        const bad = validate(e);
        if (bad) { setMsg(bad[1], 'err'); $(bad[0]).focus(); return; }
        if (editing) { e.id = editing.id; e.fromBranch = editing.branch; }

        const btn = $('ot-submit');
        btn.disabled = true; setMsg('Submitting...', '');
        try {
            const data = await api('save', { entry: e });
            state = { entries: data.entries || [], people: data.people || {} };
            const wasEditing = !!editing;
            editing = null;
            resetForm(false);
            setStatusBox('Submitted');
            setMsg(wasEditing ? '✓ Updated and submitted.' : '✓ Submitted.', 'ok');
            refreshCssList();
            renderUserTable();
        } catch (err) {
            setMsg(err.message, 'err');
        } finally {
            btn.disabled = false;
        }
    }

    function renderUserTable() {
        const t = $('ot-user-table'); if (!t) return;
        const rows = state.entries;
        $('ot-count').textContent = rows.length ? `(${rows.length})` : '';
        const head = ['Branch', 'CSS ID', 'Employee ID', 'Designation', 'Employee Name', 'Job Type', 'OT Date:', 'TTL ATTEND Qty', 'TTL Closed Qty', 'TTL OT Hrs', 'Basic Salary', 'Any Remarks', 'Status', ''];
        let h = '<thead><tr>' + head.map(x => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
        if (!rows.length) h += `<tr><td colspan="${head.length}" class="ot-empty">No overtime entries yet.</td></tr>`;
        rows.forEach(e => {
            const canEdit = e.status === 'Submitted';
            h += `<tr${editing && editing.id === e.id ? ' class="ot-row-editing"' : ''}>
                <td>${esc(e.branch)}</td><td>${esc(e.cssId)}</td><td>${esc(e.employeeId)}</td><td>${esc(e.designation)}</td>
                <td class="ot-left">${esc(e.employeeName)}</td><td>${esc(e.jobType)}</td><td class="ot-nowrap">${esc(fmtDate(e.otDate))}</td>
                <td>${esc(e.attendQty)}</td><td>${esc(e.closedQty)}</td><td>${esc(e.otHrs)}</td><td>${esc(fmtNum(e.basicSalary))}</td>
                <td class="ot-left ot-remarks">${esc(e.remarks)}</td>
                <td><span class="ot-badge st-${esc(lc(e.status).replace(/[^a-z]+/g, '-'))}">${esc(e.status)}</span></td>
                <td>${canEdit ? `<button type="button" class="ot-btn small" data-edit="${esc(e.id)}">Edit</button>` : '<span class="ot-lock" title="Locked: status changed by Admin">🔒</span>'}</td></tr>`;
        });
        t.innerHTML = h + '</tbody>';
        t.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => startEdit(b.getAttribute('data-edit'))));
    }

    function startEdit(id) {
        const e = state.entries.find(x => x.id === id);
        if (!e || e.status !== 'Submitted') return;
        editing = e;
        if (user().role !== 'Supervisor') $('ot-branch').value = e.branch;
        refreshCssList();
        $('ot-css').value = e.cssId; $('ot-empid').value = e.employeeId; $('ot-desig').value = e.designation;
        $('ot-name').value = e.employeeName; $('ot-job').value = e.jobType; $('ot-date').value = e.otDate;
        $('ot-attend').value = e.attendQty; $('ot-closed').value = e.closedQty; $('ot-hrs').value = e.otHrs;
        $('ot-salary').value = e.basicSalary; $('ot-remarks').value = e.remarks || '';
        autoName = autoId = false;
        setStatusBox(e.status);
        $('ot-submit').textContent = 'Update & Submit';
        const b = $('ot-edit-banner');
        b.innerHTML = `Editing: <strong>${esc(e.employeeName)}</strong> (${esc(e.cssId)}) - ${esc(fmtDate(e.otDate))}. <button type="button" class="ot-link" id="ot-cancel-edit">Cancel edit</button>`;
        b.style.display = 'block';
        $('ot-cancel-edit').addEventListener('click', () => { editing = null; resetForm(true); renderUserTable(); });
        $('ot-form').classList.add('editing');
        setMsg('');
        renderUserTable();
        $('ot-body').scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ==========================================================================
       ADMIN VIEW  (Overtime sheet)
       ========================================================================== */
    function adminRows() {
        const f = adminFilter;
        return state.entries.filter(e =>
            (!f.branch || lc(e.branch) === lc(f.branch)) &&
            (!f.status || e.status === f.status) &&
            (!f.from || e.otDate >= f.from) &&
            (!f.to || e.otDate <= f.to));
    }

    const ADMIN_HEAD = ['Branch', 'CSS ID', 'Employee ID', 'Designation', 'Employee Name', 'Job Type', 'OT Date:', 'TTL ATTEND Qty', 'TTL Closed Qty', 'TTL OT Hrs', 'Basic Salary', 'Amount', 'Any Remarks', 'Status'];

    function renderAdmin() {
        const branches = [];
        state.entries.forEach(e => { if (!branches.some(b => lc(b) === lc(e.branch))) branches.push(e.branch); });
        branches.sort((a, b) => a.localeCompare(b));
        $('ot-body').innerHTML = `
            ${loadError ? `<div class="ot-banner err">${esc(loadError)}</div>` : ''}
            <div class="ot-toolbar">
                <label class="ot-field inline"><span>Branch</span><select id="ot-f-branch">${optionList(branches, adminFilter.branch, 'All')}</select></label>
                <label class="ot-field inline"><span>Status</span><select id="ot-f-status">${optionList(STATUSES, adminFilter.status, 'All')}</select></label>
                <label class="ot-field inline"><span>From</span><input type="date" id="ot-f-from" value="${esc(adminFilter.from)}"></label>
                <label class="ot-field inline"><span>To</span><input type="date" id="ot-f-to" value="${esc(adminFilter.to)}"></label>
                <button type="button" class="ot-btn" id="ot-f-reset">Reset</button>
                <span class="ot-spacer"></span>
                <button type="button" class="ot-btn" id="ot-refresh">Refresh</button>
                <button type="button" class="ot-btn primary" id="ot-export">Export Excel</button>
            </div>
            <div class="ot-summary" id="ot-summary"></div>
            <span id="ot-msg" class="ot-msg" role="status"></span>
            <div class="ot-table-wrap tall"><table class="ot-table" id="ot-admin-table"></table></div>`;

        const bind = (id, key) => $(id).addEventListener('change', () => { adminFilter[key] = $(id).value; renderAdminTable(); });
        bind('ot-f-branch', 'branch'); bind('ot-f-status', 'status'); bind('ot-f-from', 'from'); bind('ot-f-to', 'to');
        $('ot-f-reset').addEventListener('click', () => { adminFilter.branch = adminFilter.status = adminFilter.from = adminFilter.to = ''; renderAdmin(); });
        $('ot-refresh').addEventListener('click', async () => {
            setMsg('Refreshing...', '');
            try { const d = await api('list'); state = { entries: d.entries || [], people: d.people || {} }; renderAdmin(); }
            catch (e) { setMsg(e.message, 'err'); }
        });
        $('ot-export').addEventListener('click', exportExcel);
        renderAdminTable();
    }

    function renderAdminTable() {
        const t = $('ot-admin-table'); if (!t) return;
        const rows = adminRows();
        let total = 0;
        let h = '<thead><tr>' + ADMIN_HEAD.map(x => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
        if (!rows.length) h += `<tr><td colspan="${ADMIN_HEAD.length}" class="ot-empty">No overtime entries${state.entries.length ? ' for the selected filters' : ' submitted yet'}.</td></tr>`;
        rows.forEach(e => {
            const amt = otAmount(e); total += amt;
            h += `<tr>
                <td>${esc(e.branch)}</td><td>${esc(e.cssId)}</td><td>${esc(e.employeeId)}</td><td>${esc(e.designation)}</td>
                <td class="ot-left">${esc(e.employeeName)}</td><td>${esc(e.jobType)}</td><td class="ot-nowrap">${esc(fmtDate(e.otDate))}</td>
                <td>${esc(e.attendQty)}</td><td>${esc(e.closedQty)}</td><td>${esc(e.otHrs)}</td><td>${esc(fmtNum(e.basicSalary))}</td>
                <td class="ot-amount">${esc(fmtNum(amt, 2))}</td>
                <td class="ot-left ot-remarks">${esc(e.remarks)}</td>
                <td><select class="ot-status-sel st-${esc(lc(e.status).replace(/[^a-z]+/g, '-'))}" data-id="${esc(e.id)}" data-branch="${esc(e.branch)}" data-old="${esc(e.status)}">${optionList(STATUSES, e.status)}</select></td></tr>`;
        });
        if (rows.length) h += `<tr class="ot-total"><td colspan="11" class="ot-left">Total (${rows.length} entries)</td><td class="ot-amount">${esc(fmtNum(total, 2))}</td><td colspan="2"></td></tr>`;
        t.innerHTML = h + '</tbody>';
        $('ot-summary').textContent = `${rows.length} of ${state.entries.length} entries shown`;
        t.querySelectorAll('.ot-status-sel').forEach(sel => sel.addEventListener('change', () => changeStatus(sel)));
    }

    async function changeStatus(sel) {
        const id = sel.getAttribute('data-id'), old = sel.getAttribute('data-old'), next = sel.value;
        sel.disabled = true; setMsg('Saving status...', '');
        try {
            const d = await api('status', { id: id, branch: sel.getAttribute('data-branch'), status: next });
            state = { entries: d.entries || [], people: d.people || {} };
            renderAdminTable();
            setMsg('✓ Status updated.', 'ok');
        } catch (e) {
            sel.value = old; sel.disabled = false;
            setMsg(e.message, 'err');
        }
    }

    function exportExcel() {
        if (typeof XLSX === 'undefined') { setMsg('Excel library is not loaded. Check the internet connection and try again.', 'err'); return; }
        const rows = adminRows();
        if (!rows.length) { setMsg('There is no data to export.', 'err'); return; }
        const aoa = [ADMIN_HEAD.slice()];
        rows.forEach(e => aoa.push([
            e.branch, e.cssId, e.employeeId, e.designation, e.employeeName, e.jobType, e.otDate,
            Number(e.attendQty), Number(e.closedQty), Number(e.otHrs), Number(e.basicSalary), otAmount(e), e.remarks || '', e.status
        ]));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const dateCol = 6, moneyCols = [10, 11];
        rows.forEach((e, i) => {
            const r = i + 1;
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.otDate);
            if (m) ws[XLSX.utils.encode_cell({ r: r, c: dateCol })] = { t: 'n', v: (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000, z: 'dd-mmm-yyyy' };
            moneyCols.forEach(c => { const cell = ws[XLSX.utils.encode_cell({ r: r, c: c })]; if (cell) cell.z = '#,##0.00'; });
        });
        ws['!cols'] = [12, 10, 12, 16, 26, 14, 13, 15, 15, 11, 13, 12, 34, 16].map(w => ({ wch: w }));
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: ADMIN_HEAD.length - 1 } }) };
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Overtime');
        XLSX.writeFile(wb, `Overtime_${todayIso()}.xlsx`);
        setMsg(`✓ Exported ${rows.length} entries.`, 'ok');
    }

    /* ==========================================================================
       TOP-BAR BUTTON / ADMIN MENU ITEM
       Shown after login: Supervisor + Manager -> top bar button; Admin -> item inside the Admin menu.
       ========================================================================== */
    function syncButtons() {
        const top = $('btn-overtime'), adm = $('btn-overtime-admin');
        if (top) top.style.display = canSubmit() ? '' : 'none';
        if (adm) adm.style.display = isAdmin() ? '' : 'none';
        if (!user()) closeOvertime();
    }

    function init() {
        const top = $('btn-overtime'), adm = $('btn-overtime-admin');
        if (top) top.addEventListener('click', openOvertime);
        if (adm) adm.addEventListener('click', openOvertime);
        syncButtons();
        const app = $('app-container');
        if (app) new MutationObserver(syncButtons).observe(app, { attributes: true, attributeFilter: ['style'] });
        const nm = $('user-display-name');
        if (nm) new MutationObserver(syncButtons).observe(nm, { childList: true, characterData: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.openOvertime = openOvertime;
    window.__otAmount = otAmount;   // exposed for testing the policy
})();
