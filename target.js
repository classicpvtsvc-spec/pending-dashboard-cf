/* ==========================================================================
   MONTHLY BRANCH TARGET DASHBOARD
   OW repair revenue + spare-parts counter sale: target vs achievement.
   Admin uploads two data files (Repair Revenue, Counter Sale); everyone with
   the "Monthly Branch Target" access sees the dashboard.
   Only app.js helpers are reused (currentUser, hasPerm, parseDateString ...).
   ========================================================================== */

/* ---- 1. BUILT-IN TARGETS (fallback only) ----
   Targets are now entered by the Admin: Admin icon > Monthly Budget Target (no coding needed).
   This list is used ONLY until the first budget is saved online, then the saved budget replaces it.
   ow = Out-of-Warranty collection target (80%),  counter = Spare-parts counter sale target (20%)  */
const MONTHLY_TARGETS = {
    '2026-10': {
        'Jeddah':   { ow: 328970.00, counter: 82242.50 },
        'Riyadh':   { ow: 388446.56, counter: 97111.64 },
        'Khobar':   { ow: 331236.32, counter: 82809.08 },
        'Madinah':  { ow: 118243.00, counter: 29560.75 },
        'Makkah':   { ow: 146452.00, counter: 36613.00 },
        'Taif':     { ow:  73536.50, counter: 18384.13 },
        'Qassim':   { ow:  56006.00, counter: 14001.50 },
        'Hassa':    { ow:  78800.02, counter: 19700.01 },
        'Al Kharj': { ow:  22083.00, counter:  5520.75 },
        'Jizan':    { ow:  60152.50, counter: 15038.13 },
        'Tabuke':   { ow:  29864.50, counter:  7466.13 },
        'Yanbu':    { ow:  48464.00, counter: 12116.00 },
        'Khamis':   { ow: 111226.28, counter: 27806.57 }
    }
};

/* Extra non-working dates (public holidays etc.) in YYYY-MM-DD. Fridays are always off, Saturdays are half day. */
const TARGET_HOLIDAYS = [];

/* Minimum achievement and grades (from the target e-mail) */
const MT_MIN_PCT = 90;   // below this = minimum not met; 90-90.9 = Grade C; 91-95.9 = Grade B; 96+ = Grade A

/* ---- 2. DATA CODES ---- */
const BRANCH_CODE_MAP = {
    '100': 'Khumra',   '9340': 'Jeddah',  '9341': 'Tabuke',  '9343': 'Makkah',
    '9344': 'Khamis',  '9345': 'Jizan',   '9347': 'Yanbu',   '9348': 'Madinah',
    '9353': 'Taif',    '9540': 'Riyadh',  '9550': 'Qassim',  '9740': 'Khobar',
    '9741': 'Hassa',   '9743': 'Al Kharj', '9745': 'Khobar', '9742': 'Khobar'
};

const BRAND_NAME_MAP = {      // BRAND_CD (number) -> Brand name, for the Counter Sale brand breakdown
    1: 'LG', 2: 'LAKES', 3: 'TANGO', 17: 'Philips', 18: 'Others', 19: 'GALANZ', 20: 'TANNUR', 21: 'MAGIC',
    22: 'AQUARIA', 23: 'SMEG', 24: 'COWAY', 25: 'TOOLS', 26: 'OCEAN', 27: 'CENTURY', 28: 'AUX', 29: 'EDDY',
    30: 'TCL', 31: 'RHEEM', 32: 'HISENSE', 33: 'Samsung', 34: 'Xiaomi'
};

const WARRANTY_CATEGORY_MAP = {   // WARRANTY_CODE (upper case) -> OW / W
    'AW': 'OW', 'V': 'OW', 'K': 'W', 'EW': 'W', 'HW': 'OW', 'I': 'W', 'O': 'OW', 'Q': 'W',
    'R': 'W', 'RW': 'OW', 'SE': 'OW', 'SW': 'W', 'A': 'W', 'XW': 'OW', 'CP': 'W', 'X': 'W'
};

/* ---- 3. STATE ---- */
let repairRows = [];    // { date:'YYYY-MM-DD', code:'9340', w:'AW', amt:123.4 }
let counterRows = [];   // { date, code, w:'', amt }
let mtMonth = null;     // month shown on the dashboard ('YYYY-MM'); null = the open (current) budget month
let mtMetric = 'total';
const mtCharts = {};
const mtMsg = { repair: '', counter: '' };
const MT_LABEL = { repair: 'Repair Revenue', counter: 'Counter Sale' };

/* ==========================================================================
   FILE READING + PARSING
   ========================================================================== */
function mtSplitLine(line, delim) {
    if (line.indexOf('"') < 0) return line.split(delim);
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (c === delim && !q) { out.push(cur); cur = ''; }
        else cur += c;
    }
    out.push(cur);
    return out;
}

function mtFindHeader(rows2d) {
    const lim = Math.min(rows2d.length, 40);
    for (let i = 0; i < lim; i++) {
        const row = rows2d[i] || [];
        if (row.some(c => String(c).trim().toUpperCase() === 'INVOICE_DT')) {
            return { headers: row.map(c => String(c).trim().toUpperCase()), rows: rows2d.slice(i + 1) };
        }
    }
    throw new Error('column INVOICE_DT was not found in the file');
}

function mtTableFromText(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
    const hl = lines.slice(0, 40).find(l => l.toUpperCase().includes('INVOICE_DT'));
    if (!hl) throw new Error('column INVOICE_DT was not found in the file');
    const delim = ['\t', ',', ';', '|'].map(d => [d, hl.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    return mtFindHeader(lines.map(l => mtSplitLine(l, delim)));
}

function mtReadTable(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('the file could not be read'));
        if (/\.(txt|tsv|csv)$/i.test(file.name)) {
            reader.onload = e => { try { resolve(mtTableFromText(String(e.target.result))); } catch (err) { reject(err); } };
            reader.readAsText(file);
        } else {
            reader.onload = e => {
                try {
                    const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
                    const sheet = wb.Sheets[wb.SheetNames[0]];
                    resolve(mtFindHeader(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })));
                } catch (err) { reject(err); }
            };
            reader.readAsArrayBuffer(file);
        }
    });
}

const mtPad = n => String(n).padStart(2, '0');

/** INVOICE_DT is YYYYMMDD (text or number). Other common date forms are accepted as a fallback. */
function mtDateKey(v) {
    if (v === undefined || v === null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : `${v.getFullYear()}-${mtPad(v.getMonth() + 1)}-${mtPad(v.getDate())}`;
    const s = String(v).trim();
    const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\D|$)/);
    if (m) {
        const y = +m[1], mo = +m[2], d = +m[3];
        if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
        return '';
    }
    const dt = (typeof parseDateString === 'function') ? parseDateString(v) : null;
    return dt && !isNaN(dt) ? `${dt.getFullYear()}-${mtPad(dt.getMonth() + 1)}-${mtPad(dt.getDate())}` : '';
}

function mtNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v === undefined || v === null ? '' : v).trim();
    if (!s) return 0;
    s = s.replace(/[\u2212\u2013\u2012\uFE63\uFF0D]/g, '-');          // unicode minus / dash variants -> "-"
    let neg = /^\(.*\)$/.test(s) || /^\s*-/.test(s) || /-\s*$/.test(s) || /\bCR\s*$/i.test(s);   // (123) | -123 | 123- (SAP style) | 123 CR
    s = s.replace(/[^0-9.]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : (neg ? -Math.abs(n) : n);
}

function mtCode(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    return /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
}

/** Reads only the needed columns. Repair: INVOICE_DT, BRANCH_CD, WARRANTY_CODE, INVOICE_AMT. Counter: INVOICE_DT, BRANCH_CD, NET_PRICE. */
function mtBuildRows(type, table) {
    const H = table.headers;
    const amtName = type === 'repair' ? 'INVOICE_AMT' : 'NET_PRICE';
    const need = ['INVOICE_DT', 'BRANCH_CD'].concat(type === 'repair' ? ['WARRANTY_CODE'] : [], [amtName]);
    const missing = need.filter(n => H.indexOf(n) < 0);
    if (missing.length) throw new Error('column(s) not found: ' + missing.join(', '));
    const iD = H.indexOf('INVOICE_DT'), iB = H.indexOf('BRANCH_CD'), iW = H.indexOf('WARRANTY_CODE'), iA = H.indexOf(amtName);
    // optional columns for the breakdown tables (older saved files may not have them)
    const iWT = H.indexOf('WARRANTY_TYPE'), iBR = H.indexOf('BRAND_CD');
    const clean = v => String(v === undefined || v === null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();

    const rows = [];
    const legend = {};      // saved-file shortcut: id -> Warranty Type name (see mtCompactFile)
    table.rows.forEach(r => { if (r && String(r[0]).trim() === '#T') legend[String(r[1]).trim()] = clean(r[2]); });
    table.rows.forEach(r => {
        if (!r || !r.length) return;
        const date = mtDateKey(r[iD]);
        if (!date) return;
        const code = mtCode(r[iB]);
        const amt = mtNum(r[iA]);
        // Counter Sale: negative Net Price lines are kept (they reduce the total), except for Branch Code 100.
        if (type === 'counter' && amt < 0 && code === '100') return;
        rows.push({
            date: date,
            code: code,
            w: type === 'repair' ? String(r[iW] === undefined || r[iW] === null ? '' : r[iW]).trim().toUpperCase() : '',
            amt: amt,
            wt: type === 'repair' ? (iWT >= 0 ? (legend[clean(r[iWT])] !== undefined ? legend[clean(r[iWT])] : clean(r[iWT])) : null) : null,      // Warranty Type (repair)
            b: type === 'counter' ? (iBR >= 0 ? mtCode(clean(r[iBR])) : null) : null  // Brand code (counter)
        });
    });
    return rows;
}

/** Only date, branch code, warranty code/type (repair), brand code (counter) and amount are kept online - nothing else from the original file. */
function mtCompactFile(type, rows, originalName) {
    const head = type === 'repair' ? 'INVOICE_DT\tBRANCH_CD\tWARRANTY_CODE\tINVOICE_AMT\tWARRANTY_TYPE' : 'INVOICE_DT\tBRANCH_CD\tNET_PRICE\tBRAND_CD';
    const ids = {}, legendLines = [];
    const typeId = name => {
        if (!name) return '';
        if (ids[name] === undefined) { ids[name] = String(legendLines.length + 1); legendLines.push(`#T\t${ids[name]}\t${name}`); }
        return ids[name];
    };
    const lines = rows.map(r => {
        const d = r.date.replace(/-/g, '');
        return type === 'repair' ? `${d}\t${r.code}\t${r.w}\t${r.amt}\t${typeId(r.wt)}` : `${d}\t${r.code}\t${r.amt}\t${r.b || ''}`;
    });
    if (legendLines.length) lines.unshift.apply(lines, legendLines);
    const base = String(originalName || type).replace(/\.[^.]+$/, '');
    return new File([head + '\n' + lines.join('\n')], base + '.txt', { type: 'text/plain' });
}

/** Called for a fresh Admin upload (save = true) and when the saved file is loaded for everyone (save = false). */
async function loadRevenueFile(file, type, save) {
    try {
        const table = await mtReadTable(file);
        const rows = mtBuildRows(type, table);
        if (!rows.length) throw new Error('no rows with a valid INVOICE_DT (YYYYMMDD) were found');
        if (type === 'repair') repairRows = rows; else counterRows = rows;
        mtMsg[type] = '';

        if (save) {
            mtMonth = mtActiveMonth();      // a new upload counts for the open (not yet locked) budget month
            if (currentUser && currentUser.role === 'Admin') saveAdminUploadToCloud(mtCompactFile(type, rows, file.name), type);
        }
        renderMonthlyTarget();
        return true;
    } catch (err) {
        mtMsg[type] = `⚠ ${MT_LABEL[type]} file not loaded: ${err.message}`;
        renderMonthlyTarget();
        return false;
    }
}

/* ==========================================================================
   CALCULATION
   ========================================================================== */
const mtBAlias = { madina: 'madinah', tabuk: 'tabuke', alhassa: 'hassa', alhasa: 'hassa', hasa: 'hassa' };
function mtBKey(s) {
    const k = String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return mtBAlias[k] || k;
}

function mtTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${mtPad(d.getMonth() + 1)}-${mtPad(d.getDate())}`;
}

const MT_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MT_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---- BUDGET DATA (set by the Admin in  Admin icon > Monthly Budget Target, saved online for everyone) ----
   budget.targets = { 'YYYY-MM': { Branch: { ow, counter } } }
   budget.locks   = { 'YYYY-MM': { lockedAt, lockedBy, targets, raw } }   raw = final achievement snapshot of that month */
let budget = { targets: {}, locks: {} };
let budgetLoaded = false;      // true once a saved budget exists online; until then the built-in MONTHLY_TARGETS above is used

function mtNormBudget(b) {
    b = (b && typeof b === 'object') ? b : {};
    return {
        v: 1,
        targets: (b.targets && typeof b.targets === 'object') ? b.targets : {},
        locks: (b.locks && typeof b.locks === 'object') ? b.locks : {},
        updatedAt: b.updatedAt || '', updatedBy: b.updatedBy || ''
    };
}

/** Called by app.js with the saved budget file (everyone with the Monthly Target access). */
function mtLoadBudgetText(text) {
    try { budget = mtNormBudget(JSON.parse(text)); budgetLoaded = true; }
    catch (e) { console.warn('Saved budget is unreadable:', e); }
}

function mtTargetSource() { return budgetLoaded ? budget.targets : MONTHLY_TARGETS; }
function mtTargets(month) {
    if (budget.locks[month]) return budget.locks[month].targets;
    const t = mtTargetSource()[month];
    return t && Object.keys(t).length ? t : null;
}
function mtAllMonths() {
    const set = new Set(Object.keys(mtTargetSource()).filter(m => mtTargets(m)));
    Object.keys(budget.locks).forEach(m => set.add(m));
    return Array.from(set).sort();
}
/** The month that new uploads count for = the earliest month that has a target and is not locked yet. */
function mtOpenMonths() { return mtAllMonths().filter(m => !budget.locks[m]); }
function mtActiveMonth() {
    const open = mtOpenMonths();
    if (open.length) return open[0];
    const all = mtAllMonths();
    return all.length ? all[all.length - 1] : '';
}
function mtMonthLabel(m) { return `${MT_MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`; }

/* ==========================================================================
   COLLECT: reads the uploaded rows for one month (all branches that have a target).
   The result ("raw") is exactly what is stored when the Admin locks the month.
   ========================================================================== */
function mtLockedBefore(month) {
    const l = Object.keys(budget.locks).filter(m => m < month).sort();
    return l.length ? l[l.length - 1] : '';
}

function mtCollect(month, targets) {
    const [Y, M] = month.split('-').map(Number);
    const dim = new Date(Y, M, 0).getDate();
    const first = month + '-01';
    const lb = mtLockedBefore(month);
    const coveredTo = lb ? lb + '-31' : '';     // credits dated up to the end of an earlier LOCKED month are already inside that lock
    const names = Object.keys(targets);
    const raw = { asOf: '', ow: {}, counter: {}, credit: {}, wt: {}, br: {}, brCredit: {}, noTarget: {}, unmapped: 0, wtMsg: '', brMsg: '' };
    names.forEach(n => {
        raw.ow[n] = new Array(dim).fill(0); raw.counter[n] = new Array(dim).fill(0);
        raw.credit[n] = 0; raw.wt[n] = {}; raw.br[n] = {}; raw.brCredit[n] = 0;
    });
    const brandName = b => { const num = parseInt(b, 10); return (!isNaN(num) && BRAND_NAME_MAP[num]) ? BRAND_NAME_MAP[num] : (b ? 'Brand ' + b : 'Not specified'); };

    const feed = (rows, metric) => rows.forEach(r => {
        const name = BRANCH_CODE_MAP[r.code];
        if (metric === 'counter' && r.amt < 0 && r.date < first) {       // credit of an older invoice date: no day row, only deducted
            if (coveredTo && r.date <= coveredTo) return;
            if (name && raw.credit[name] !== undefined) {
                raw.credit[name] += r.amt;
                const k = brandName(r.b);
                raw.br[name][k] = (raw.br[name][k] || 0) + r.amt;
                raw.brCredit[name] += r.amt;
            }
            return;
        }
        if (!r.date.startsWith(month)) return;
        if (r.date > raw.asOf) raw.asOf = r.date;
        if (metric === 'ow' && WARRANTY_CATEGORY_MAP[r.w] !== 'OW') return;
        if (!name) { raw.unmapped += r.amt; return; }
        if (raw[metric][name]) {
            raw[metric][name][+r.date.slice(8, 10) - 1] += r.amt;
            if (metric === 'ow') { const k = r.wt || 'Not specified'; raw.wt[name][k] = (raw.wt[name][k] || 0) + r.amt; }
            else { const k = brandName(r.b); raw.br[name][k] = (raw.br[name][k] || 0) + r.amt; }
        } else {
            raw.noTarget[name] = raw.noTarget[name] || { ow: 0, counter: 0 };
            raw.noTarget[name][metric] += r.amt;
        }
    });
    feed(repairRows, 'ow');
    feed(counterRows, 'counter');

    if (!repairRows.length) raw.wtMsg = 'Repair Revenue file not uploaded yet.';
    else if (repairRows.every(r => r.wt === null)) raw.wtMsg = 'WARRANTY_TYPE is not in the saved Repair Revenue file. Please upload the Repair Revenue file again.';
    if (!counterRows.length) raw.brMsg = 'Counter Sale file not uploaded yet.';
    else if (counterRows.every(r => r.b === null)) raw.brMsg = 'BRAND_CD is not in the saved Counter Sale file. Please upload the Counter Sale file again.';
    return raw;
}

function mtRound(o) {       // keeps the saved snapshot small
    if (typeof o === 'number') return Math.round(o * 100) / 100;
    if (Array.isArray(o)) return o.map(mtRound);
    if (o && typeof o === 'object') { const r = {}; Object.keys(o).forEach(k => { r[k] = mtRound(o[k]); }); return r; }
    return o;
}

function mtModel() {
    const months = mtAllMonths();
    if (!months.length) return null;
    if (!mtMonth || !months.includes(mtMonth)) mtMonth = mtActiveMonth();
    const lock = budget.locks[mtMonth] || null;
    const targets = lock ? lock.targets : mtTargets(mtMonth);
    const raw = lock ? lock.raw : mtCollect(mtMonth, targets);
    const [Y, M] = mtMonth.split('-').map(Number);
    const dim = new Date(Y, M, 0).getDate();

    // Working-day weights: Friday off (0), Saturday half day (0.5), other days full (1)
    const days = [], idx = {};
    for (let d = 1; d <= dim; d++) {
        const dow = new Date(Y, M - 1, d).getDay();
        const key = `${mtMonth}-${mtPad(d)}`;
        let w = dow === 5 ? 0 : (dow === 6 ? 0.5 : 1);
        if (TARGET_HOLIDAYS.includes(key)) w = 0;
        idx[key] = d - 1;
        days.push({ key: key, d: d, dow: dow, w: w });
    }
    const totalW = days.reduce((s, x) => s + x.w, 0);

    const sel = (document.getElementById('branch-filter') || {}).value || 'ALL';
    let names = Object.keys(targets);
    if (sel !== 'ALL') { const k = mtBKey(sel); names = names.filter(n => mtBKey(n) === k); }

    const ach = { ow: {}, counter: {} }, credit = {};
    names.forEach(n => {
        ach.ow[n] = (raw.ow[n] || []).slice(); ach.counter[n] = (raw.counter[n] || []).slice();
        while (ach.ow[n].length < dim) ach.ow[n].push(0);
        while (ach.counter[n].length < dim) ach.counter[n].push(0);
        credit[n] = (raw.credit && raw.credit[n]) || 0;
    });
    const noTarget = sel === 'ALL' ? (raw.noTarget || {}) : {};

    const asOf = lock ? `${mtMonth}-${mtPad(dim)}` : raw.asOf;     // a locked month is complete
    const asOfIdx = asOf ? idx[asOf] : -1;
    const remW = days.reduce((s, x, i) => s + (i > asOfIdx ? x.w : 0), 0);
    const doneW = totalW - remW;

    const sum = a => a.reduce((s, v) => s + v, 0);
    const branch = {};
    names.forEach(n => {
        branch[n] = {
            ow: { T: targets[n].ow || 0, A: sum(ach.ow[n]) },
            counter: { T: targets[n].counter || 0, A: sum(ach.counter[n]) + credit[n] }
        };
        branch[n].total = { T: branch[n].ow.T + branch[n].counter.T, A: branch[n].ow.A + branch[n].counter.A };
    });

    const series = metric => {
        const daily = new Array(dim).fill(0);
        let T = 0;
        names.forEach(n => {
            T += branch[n][metric].T;
            ['ow', 'counter'].forEach(m => { if (metric === 'total' || metric === m) ach[m][n].forEach((v, i) => { daily[i] += v; }); });
        });
        const dt = days.map(x => totalW ? T * x.w / totalW : 0);
        const cumT = [], cumA = [];
        let ct = 0, ca = 0;
        days.forEach((x, i) => {
            ct += dt[i]; ca += daily[i];
            cumT.push(ct);
            cumA.push(i <= asOfIdx ? ca : null);
        });
        const cr = metric === 'ow' ? 0 : names.reduce((s, n) => s + credit[n], 0);
        const A = sum(daily) + cr;
        const expected = asOfIdx >= 0 ? cumT[asOfIdx] : 0;
        return { T: T, A: A, credit: cr, daily: daily, dt: dt, cumT: cumT, cumA: cumA, expected: expected };
    };

    return {
        month: mtMonth, months: months, days: days, totalW: totalW, doneW: doneW, remW: remW, dim: dim,
        names: names, branch: branch, sel: sel, asOf: asOf, asOfIdx: asOfIdx,
        noTarget: noTarget, unmapped: lock ? 0 : (raw.unmapped || 0),
        lock: lock, raw: raw, noOpen: mtOpenMonths().length === 0,
        s: { ow: series('ow'), counter: series('counter'), total: series('total') }
    };
}

/* ==========================================================================
   RENDERING
   ========================================================================== */
const mtFmt = n => Math.round(n).toLocaleString('en-US');
const mtPct = (a, t) => t > 0 ? (a / t) * 100 : null;
const mtPctTxt = p => p === null ? '-' : p.toFixed(1) + '%';
const mtDM = key => key ? `${key.slice(8, 10)}/${key.slice(5, 7)}` : '-';

function mtGrade(p) {
    if (p === null) return { cls: 'none', label: '-' };
    if (p >= 96) return { cls: 'a', label: 'Grade A' };
    if (p >= 91) return { cls: 'b', label: 'Grade B' };
    if (p >= MT_MIN_PCT) return { cls: 'c', label: 'Grade C' };
    return { cls: 'low', label: 'Below ' + MT_MIN_PCT + '%' };
}

function mtPctPill(p) {
    const g = mtGrade(p);
    return `<span class="mt-pill ${g.cls}" title="${g.label}">${mtPctTxt(p)}</span>`;
}

function mtKpiCard(title, sub, o, M) {
    const p = mtPct(o.A, o.T);
    const g = mtGrade(p);
    const balance = Math.max(0, o.T - o.A);
    const forMin = Math.max(0, o.T * MT_MIN_PCT / 100 - o.A);
    const expPct = o.T > 0 ? Math.min(100, o.expected / o.T * 100) : 0;
    const diff = o.A - o.expected;
    const req = M.remW > 0 ? balance / M.remW : null;
    const reqMin = M.remW > 0 ? forMin / M.remW : null;
    const asOfTxt = M.asOf ? mtDM(M.asOf) : '-';

    let pace = '<dd>-</dd>', achPctExp = '<dd>-</dd>';
    if (M.asOfIdx >= 0) {
        const pe = o.expected > 0 ? (o.A / o.expected) * 100 : null;
        achPctExp = pe === null ? '<dd>-</dd>' : `<dd><b class="${pe >= 100 ? 'mt-up' : 'mt-down'}">${pe.toFixed(1)}%</b> <small>of expected</small></dd>`;
        pace = `<dd>${mtFmt(o.expected)} <em class="${diff >= 0 ? 'mt-up' : 'mt-down'}">${diff >= 0 ? 'Ahead' : 'Behind'} ${mtFmt(Math.abs(diff))}</em></dd>`;
    }
    return `
    <div class="mt-kpi">
        <div class="mt-kpi-head"><span class="mt-kpi-title">${title}<small>${sub}</small></span>${p === null ? '' : `<span class="mt-pill ${g.cls}">${g.label}</span>`}</div>
        <div class="mt-kpi-main"><span class="mt-kpi-val">${mtFmt(o.A)}</span><span class="mt-kpi-of">achieved of <b>${mtFmt(o.T)}</b> target &middot; <b class="mt-kpi-pct ${g.cls}">${mtPctTxt(p)}</b></span></div>
        <div class="mt-bar" title="Bar = achieved. Dark tick = expected pace till ${asOfTxt}. Dashed tick = ${MT_MIN_PCT}% minimum.">
            <div class="mt-bar-fill ${g.cls}" style="width:${p === null ? 0 : Math.min(100, p)}%"></div>
            <div class="mt-bar-exp" style="left:${expPct}%"></div>
            <div class="mt-bar-min" style="left:${MT_MIN_PCT}%"></div>
        </div>
        <dl class="mt-stats">
            <div><dt>Balance to achieve</dt><dd><b>${mtFmt(balance)}</b></dd></div>
            <div><dt>Needed for ${MT_MIN_PCT}% minimum</dt><dd>${forMin > 0 ? mtFmt(forMin) : '<em class="mt-up">Reached</em>'}</dd></div>
            <div><dt>Expected till ${asOfTxt}</dt>${pace}</div>
            <div><dt>Required per working day</dt><dd>${req === null ? '-' : (balance > 0 ? mtFmt(req) : '<em class="mt-up">Target reached</em>')}</dd></div>
            <div><dt>Achieved % (as per expected)</dt>${achPctExp}</div>
            <div><dt>Daily target (full day)</dt><dd>${M.totalW ? mtFmt(o.T / M.totalW) : '-'}</dd></div>
            <div><dt>Per day for ${MT_MIN_PCT}% minimum</dt><dd>${reqMin === null ? '-' : (forMin > 0 ? mtFmt(reqMin) : '-')}</dd></div>
        </dl>
    </div>`;
}

function mtRenderInfo(M) {
    const el = document.getElementById('mt-info');
    if (!el) return;
    const isAdmin = currentUser && currentUser.role === 'Admin';
    let html = `<span class="lu-item">📅 Working days: <strong>${M.totalW}</strong> (Fri off, Sat half) &middot; done <strong>${M.doneW}</strong> &middot; remaining <strong>${M.remW}</strong></span>`;
    if (M.lock) {
        html += `<span class="lu-item">🔒 Budget locked${M.lock.lockedAt ? ' on <strong>' + escapeEmailHtml(formatCloudTime(M.lock.lockedAt)) + '</strong>' : ''}` +
                `${M.lock.lockedBy ? ' by ' + escapeEmailHtml(M.lock.lockedBy) : ''} &mdash; final data, new uploads do not change it</span>`;
        if (M.raw && M.raw.asOf) html += `<span class="lu-item">Data up to: <strong>${mtDM(M.raw.asOf)}</strong></span>`;
    } else {
        ['repair', 'counter'].forEach(t => {
            const rows = t === 'repair' ? repairRows : counterRows;
            const info = (typeof cloudInfo !== 'undefined') ? cloudInfo[t] : null;
            if (rows.length) {
                html += `<span class="lu-item">🕒 ${MT_LABEL[t]} last uploaded (Online): ` +
                        (info && info.uploadedAt ? `<strong>${escapeEmailHtml(formatCloudTime(info.uploadedAt))}</strong>` + (info.uploadedBy ? ` by ${escapeEmailHtml(info.uploadedBy)}` : '') : '<strong>-</strong>') + `</span>`;
            } else {
                html += `<span class="lu-temp">${MT_LABEL[t]} data not uploaded yet${isAdmin ? ' (use the ⇫ button at the top)' : ''}</span>`;
            }
            if (mtMsg[t]) html += `<span class="lu-error">${escapeEmailHtml(mtMsg[t])}</span>`;
        });
        if (M.asOf) html += `<span class="lu-item">Data up to: <strong>${mtDM(M.asOf)}</strong></span>`;
        if (M.unmapped) html += `<span class="lu-error">⚠ ${mtFmt(M.unmapped)} amount skipped: branch code not in the branch list</span>`;
    }
    if (M.noOpen) html += `<span class="lu-temp">All budget months are locked.${isAdmin ? ' Set the next month target in Admin &gt; Monthly Budget Target; new uploads will count for it.' : ' The next month target has not been set yet.'}</span>`;
    el.innerHTML = html;
}

/* ---- Breakdown tables: Repair Revenue by Warranty Type (OW only) and Counter Sale by Brand ---- */
function mtBreakdownTable(tblId, noteId, firstHead, rows, emptyMsg, note) {
    const tbl = document.getElementById(tblId), nt = document.getElementById(noteId);
    if (!tbl) return;
    if (nt) nt.innerHTML = note || '';
    if (!rows) { tbl.innerHTML = `<tbody><tr><td class="mt-break-empty">${emptyMsg}</td></tr></tbody>`; return; }
    const total = rows.reduce((s, r) => s + r.v, 0);
    const pct = v => total ? ((v / total) * 100).toFixed(1) + '%' : '-';
    let body = '<tbody>';
    rows.forEach(r => {
        body += `<tr><td class="bold">${escapeEmailHtml(r.k)}</td><td class="text-right">${mtFmt(r.v)}</td><td class="text-center">${pct(r.v)}</td></tr>`;
    });
    body += `<tr class="daily-total-row"><td class="bold">Total</td><td class="text-right bold">${mtFmt(total)}</td><td class="text-center bold">${total ? '100.0%' : '-'}</td></tr></tbody>`;
    tbl.innerHTML = `<thead><tr><th>${firstHead}</th><th class="text-right">Revenue</th><th class="text-center">%</th></tr></thead>` + body;
}

function mtRenderBreakdowns(M) {
    const raw = M.raw;
    const agg = src => {
        const g = {};
        M.names.forEach(n => { const o = (src && src[n]) || {}; Object.keys(o).forEach(k => { g[k] = (g[k] || 0) + o[k]; }); });
        const rows = Object.keys(g).map(k => ({ k: k, v: g[k] })).sort((a, b) => b.v - a.v);
        return rows.length ? rows : null;
    };
    const wtRows = raw.wtMsg ? null : agg(raw.wt);
    mtBreakdownTable('table-mt-wtype', 'mt-wtype-note', 'Warranty Type', wtRows, raw.wtMsg || 'No OW Repair Revenue for this month.', '');

    const brRows = raw.brMsg ? null : agg(raw.br);
    const credit = M.names.reduce((s, n) => s + ((raw.brCredit && raw.brCredit[n]) || 0), 0);
    mtBreakdownTable('table-mt-brand', 'mt-brand-note', 'Brand', brRows, raw.brMsg || 'No Counter Sale for this month.',
        credit ? `Includes credit of <b class="mt-down">-${mtFmt(Math.abs(credit))}</b> (negative Net Price of older invoice dates).` : '');
}

function mtRenderBranchTable(M) {
    const tbl = document.getElementById('table-mt-branch');
    if (!tbl) return;
    const cell = o => {
        const p = mtPct(o.A, o.T);
        return `<td class="text-right">${mtFmt(o.T)}</td><td class="text-right bold">${mtFmt(o.A)}</td><td class="text-center">${mtPctPill(p)}</td>`;
    };
    let body = '<tbody>';
    const sortedNames = M.names.slice().sort((x, y) => {
        const px = mtPct(M.branch[x].total.A, M.branch[x].total.T), py = mtPct(M.branch[y].total.A, M.branch[y].total.T);
        return (py === null ? -Infinity : py) - (px === null ? -Infinity : px);
    });
    sortedNames.forEach(n => {
        const b = M.branch[n];
        body += `<tr><td class="bold">${n}</td>` +
            cell(b.ow) + `<td class="text-right muted">${mtFmt(Math.max(0, b.ow.T - b.ow.A))}</td>` +
            cell(b.counter) + `<td class="text-right muted">${mtFmt(Math.max(0, b.counter.T - b.counter.A))}</td>` +
            cell(b.total) + `</tr>`;
    });
    if (M.names.length) {
        const tot = { ow: { T: 0, A: 0 }, counter: { T: 0, A: 0 }, total: { T: 0, A: 0 } };
        M.names.forEach(n => ['ow', 'counter', 'total'].forEach(m => { tot[m].T += M.branch[n][m].T; tot[m].A += M.branch[n][m].A; }));
        body += `<tr class="daily-total-row"><td class="bold">Total</td>` +
            cell(tot.ow) + `<td class="text-right">${mtFmt(Math.max(0, tot.ow.T - tot.ow.A))}</td>` +
            cell(tot.counter) + `<td class="text-right">${mtFmt(Math.max(0, tot.counter.T - tot.counter.A))}</td>` +
            cell(tot.total) + `</tr>`;
    } else {
        body += '<tr><td colspan="12" class="muted text-center">No target is set for this branch in ' + M.month + '.</td></tr>';
    }
    body += '</tbody>';
    const head = `<thead>
        <tr><th rowspan="2">Branch</th><th colspan="4" class="text-center mt-grp">OW Revenue</th><th colspan="4" class="text-center mt-grp">Counter Sale</th><th colspan="3" class="text-center mt-grp">Total</th></tr>
        <tr class="mt-sub">
            <th class="text-right mt-grp">Target</th><th class="text-right">Achieved</th><th class="text-center">Ach %</th><th class="text-right">Balance</th>
            <th class="text-right mt-grp">Target</th><th class="text-right">Achieved</th><th class="text-center">Ach %</th><th class="text-right">Balance</th>
            <th class="text-right mt-grp">Target</th><th class="text-right">Achieved</th><th class="text-center">Ach %</th>
        </tr></thead>`;
    tbl.innerHTML = head + body;

    const note = document.getElementById('mt-notarget');
    if (note) {
        const keys = Object.keys(M.noTarget).filter(k => M.noTarget[k].ow || M.noTarget[k].counter);
        note.innerHTML = keys.length
            ? 'No target set (not included in totals): ' + keys.map(k => `<b>${k}</b> - OW ${mtFmt(M.noTarget[k].ow)}, Counter ${mtFmt(M.noTarget[k].counter)}`).join(' &nbsp;|&nbsp; ')
            : '';
    }
}

function mtRenderDailyTable(M) {
    const tbl = document.getElementById('table-mt-daily');
    if (!tbl) return;
    const S = M.s[mtMetric];
    let body = '<tbody>', cumA = 0;
    M.days.forEach((x, i) => {
        const done = i <= M.asOfIdx;
        cumA += S.daily[i];
        const type = x.w === 1 ? 'Full' : (x.w === 0.5 ? 'Half' : 'Off');
        const dTarget = S.dt[i];
        const v = S.daily[i] - dTarget;
        const p = done ? mtPct(S.daily[i], dTarget) : null;
        const cp = done ? mtPct(cumA, S.cumT[i]) : null;
        const cls = (x.w === 0 ? 'mt-off ' : '') + (done ? '' : 'mt-future');
        body += `<tr class="${cls}">
            <td class="bold">${mtPad(x.d)}/${M.month.slice(5, 7)}</td><td>${MT_DOW[x.dow]}</td><td class="text-center">${type}</td>
            <td class="text-right">${x.w ? mtFmt(dTarget) : '-'}</td>
            <td class="text-right bold">${done ? mtFmt(S.daily[i]) : '-'}</td>
            <td class="text-right ${done && x.w ? (v >= 0 ? 'mt-up' : 'mt-down') : ''}">${done && x.w ? (v >= 0 ? '+' : '-') + mtFmt(Math.abs(v)) : '-'}</td>
            <td class="text-center">${x.w && done ? mtPctPill(p) : '-'}</td>
            <td class="text-right">${mtFmt(S.cumT[i])}</td>
            <td class="text-right bold">${done ? mtFmt(cumA) : '-'}</td>
            <td class="text-center">${done ? mtPctPill(cp) : '-'}</td>
            <td class="text-right">-</td></tr>`;
    });
    const cp = mtPct(S.A, S.T);
    body += `<tr class="daily-total-row"><td class="bold" colspan="3">Month</td><td class="text-right">${mtFmt(S.T)}</td><td class="text-right">${mtFmt(S.A)}</td><td></td><td class="text-center">${mtPctPill(cp)}</td><td class="text-right">${mtFmt(S.T)}</td><td class="text-right">${mtFmt(S.A)}</td><td class="text-center">${mtPctPill(cp)}</td><td class="text-right ${S.credit ? 'mt-down' : ''}" title="Counter Sale negative Net Price of older invoice dates - already deducted in the Month total">${S.credit ? '-' + mtFmt(Math.abs(S.credit)) : '-'}</td></tr></tbody>`;
    tbl.innerHTML = `<thead><tr><th>Date</th><th>Day</th><th class="text-center">Day Type</th><th class="text-right">Daily Target</th><th class="text-right">Achieved</th><th class="text-right">Variance</th><th class="text-center">Ach %</th><th class="text-right">Accum. Target</th><th class="text-right">Accum. Achieved</th><th class="text-center">Accum. %</th><th class="text-right">Credit</th></tr></thead>` + body;
}

function mtDrawChart(id, config) {
    const cv = document.getElementById(id);
    if (!cv || typeof Chart === 'undefined') return;
    if (mtCharts[id]) { mtCharts[id].destroy(); mtCharts[id] = null; }
    mtCharts[id] = new Chart(cv.getContext('2d'), config);
}

const MT_METRIC_NAME = { total: 'Total (OW + Counter)', ow: 'OW Revenue', counter: 'Counter Sale' };

function mtRenderCharts(M) {
    const S = M.s[mtMetric];
    const labels = M.days.map(x => `${x.d} ${MT_DOW[x.dow]}`);
    const axis = { ticks: { callback: v => Number(v).toLocaleString('en-US') } };
    const tip = { callbacks: { label: c => `${c.dataset.label}: ${Number(c.parsed.y !== undefined && c.parsed.y !== null && c.chart.options.indexAxis !== 'y' ? c.parsed.y : c.parsed.x).toLocaleString('en-US', { maximumFractionDigits: 1 })}` } };

    const t1 = document.getElementById('mt-chart1-title'); if (t1) t1.textContent = `Daily Target vs Achieved - ${MT_METRIC_NAME[mtMetric]}`;
    const t2 = document.getElementById('mt-chart2-title'); if (t2) t2.textContent = `Accumulated Achieved vs Target - ${MT_METRIC_NAME[mtMetric]}`;
    const t3 = document.getElementById('mt-chart3-title'); if (t3) t3.textContent = M.names.length === 1 ? 'Achievement % - OW, Counter, Total' : `Branch Achievement % - ${MT_METRIC_NAME[mtMetric]}`;

    mtDrawChart('mt-chart-daily', {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'bar', label: 'Achieved',
                    data: S.daily.map((v, i) => i <= M.asOfIdx ? v : null),
                    backgroundColor: S.daily.map((v, i) => M.days[i].w === 0 ? '#94a3b8' : (v >= S.dt[i] ? '#00b37d' : '#f87171')),
                    borderRadius: 3, order: 2
                },
                {
                    type: 'line', label: 'Daily Target', data: S.dt,
                    borderColor: '#334155', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, stepped: 'middle', order: 1
                }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom' }, tooltip: tip }, scales: { y: Object.assign({ beginAtZero: true }, axis), x: { ticks: { maxRotation: 90, minRotation: 60, font: { size: 10 } } } } }
    });

    mtDrawChart('mt-chart-cum', {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Accumulated Achieved', data: S.cumA, borderColor: '#00b37d', backgroundColor: 'rgba(0,179,125,0.15)', fill: true, borderWidth: 3, pointRadius: 2, tension: 0.2, spanGaps: false },
                { label: 'Accumulated Target', data: S.cumT, borderColor: '#334155', borderDash: [6, 4], borderWidth: 2, pointRadius: 0 },
                { label: MT_MIN_PCT + '% Minimum', data: S.cumT.map(v => v * MT_MIN_PCT / 100), borderColor: '#d97706', borderDash: [2, 3], borderWidth: 2, pointRadius: 0 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom' }, tooltip: tip }, scales: { y: Object.assign({ beginAtZero: true }, axis), x: { ticks: { maxRotation: 90, minRotation: 60, font: { size: 10 } } } } }
    });

    // Branch achievement % (all branches) - or OW / Counter / Total when one branch is selected
    let bl, bv;
    if (M.names.length === 1) {
        const b = M.branch[M.names[0]];
        bl = ['OW Revenue', 'Counter Sale', 'Total'];
        bv = [mtPct(b.ow.A, b.ow.T), mtPct(b.counter.A, b.counter.T), mtPct(b.total.A, b.total.T)];
    } else {
        bl = M.names;
        bv = M.names.map(n => mtPct(M.branch[n][mtMetric].A, M.branch[n][mtMetric].T));
    }
    const expPct = M.totalW ? (M.doneW / M.totalW) * 100 : 0;
    const colorOf = p => ({ a: '#00b37d', b: '#3b82f6', c: '#d97706', low: '#ef4444', none: '#94a3b8' })[mtGrade(p).cls];
    const box = document.getElementById('mt-chart-branch-box');
    if (box) box.style.height = Math.max(260, bl.length * 26 + 70) + 'px';
    mtDrawChart('mt-chart-branch', {
        type: 'bar',
        data: {
            labels: bl,
            datasets: [
                { label: 'Achieved %', data: bv.map(v => v === null ? 0 : +v.toFixed(1)), backgroundColor: bv.map(colorOf), borderRadius: 3 },
                { label: 'Expected pace %', data: bl.map(() => +expPct.toFixed(1)), backgroundColor: 'rgba(51,65,85,0.25)', borderRadius: 3 }
            ]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.x}%` } } },
            scales: { x: { beginAtZero: true, ticks: { callback: v => v + '%' } } } }
    });
}

function mtRenderEmpty() {
    const lbl = document.getElementById('mt-month-label'); if (lbl) lbl.textContent = '-';
    const isAdmin = currentUser && currentUser.role === 'Admin';
    const info = document.getElementById('mt-info');
    if (info) info.innerHTML = `<span class="lu-temp">No monthly budget target is set yet.${isAdmin ? ' Use Admin icon &gt; Monthly Budget Target.' : ''}</span>`;
    ['mt-kpis', 'table-mt-branch', 'table-mt-daily', 'table-mt-wtype', 'table-mt-brand', 'mt-notarget'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
    ['mt-chart-daily', 'mt-chart-cum', 'mt-chart-branch'].forEach(id => { if (mtCharts[id]) { mtCharts[id].destroy(); mtCharts[id] = null; } });
    ['mt-year', 'mt-month'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
    const b = document.getElementById('mt-lock-badge'); if (b) b.style.display = 'none';
}

function mtRenderPeriod(M) {
    const ysel = document.getElementById('mt-year'), msel = document.getElementById('mt-month');
    const yr = M.month.slice(0, 4);
    if (ysel) {
        const years = Array.from(new Set(M.months.map(m => m.slice(0, 4)))).sort();
        ysel.innerHTML = years.map(y => `<option value="${y}" ${y === yr ? 'selected' : ''}>${y}</option>`).join('');
    }
    if (msel) {
        msel.innerHTML = M.months.filter(m => m.startsWith(yr)).map(m =>
            `<option value="${m}" ${m === M.month ? 'selected' : ''}>${budget.locks[m] ? '🔒 ' : ''}${MT_MON[+m.slice(5, 7) - 1]}</option>`).join('');
    }
    const badge = document.getElementById('mt-lock-badge');
    if (badge) {
        badge.style.display = '';
        badge.className = 'mt-lock-badge ' + (M.lock ? 'locked' : 'open');
        badge.textContent = M.lock ? '🔒 Locked - final data' : (M.month === mtActiveMonth() ? '● Current budget month' : '○ Open');
    }
}

function renderMonthlyTarget() {
    const sec = document.getElementById('month-target-section');
    if (!sec || !currentUser || !hasPerm('monthTarget')) return;

    const M = mtModel();
    if (!M) { mtRenderEmpty(); return; }
    const lbl = document.getElementById('mt-month-label');
    if (lbl) lbl.textContent = mtMonthLabel(M.month);

    mtRenderPeriod(M);
    document.querySelectorAll('#mt-metric-seg button').forEach(b => b.classList.toggle('active', b.dataset.m === mtMetric));

    mtRenderInfo(M);
    const k = document.getElementById('mt-kpis');
    if (k) {
        const withExp = o => Object.assign({}, o);
        k.innerHTML = mtKpiCard('OW Revenue', '80% weightage', withExp(M.s.ow), M) +
                      mtKpiCard('Spare Parts Counter Sale', '20% weightage', withExp(M.s.counter), M) +
                      mtKpiCard('Total Target', 'OW + Counter Sale', withExp(M.s.total), M);
    }
    mtRenderBranchTable(M);
    mtRenderDailyTable(M);
    mtRenderBreakdowns(M);
    mtRenderCharts(M);
    if (document.getElementById('budget-modal') && document.getElementById('budget-modal').style.display !== 'none') bgRenderMonths();
}

/* ==========================================================================
   ADMIN: MONTHLY BUDGET TARGET  (Admin icon > Monthly Budget Target)
   - pick Year + Month, type OW / Counter Sale target per branch, press Update Target
   - Lock a completed month: its final targets + achievement are stored permanently
   - Delete removes the locked data (or the target of an open month)
   ========================================================================== */
const MT_BRANCHES = ['Jeddah', 'Riyadh', 'Khobar', 'Madinah', 'Makkah', 'Taif', 'Qassim', 'Hassa', 'Al Kharj', 'Jizan', 'Tabuke', 'Yanbu', 'Khamis'];
let bgBusy = false;

const bgEl = id => document.getElementById(id);
const bgIsAdmin = () => currentUser && currentUser.role === 'Admin';
function bgMonthKey() { return `${bgEl('bg-year').value}-${bgEl('bg-month').value}`; }

function bgMsg(text, ok) {
    const e = bgEl('bg-msg'); if (!e) return;
    e.textContent = text || ''; e.className = 'bg-msg ' + (text ? (ok ? 'ok' : 'err') : '');
}

function bgOpen() {
    if (!bgIsAdmin()) return;
    const now = new Date().getFullYear();
    const active = mtActiveMonth() || `${now}-${mtPad(new Date().getMonth() + 1)}`;
    const years = new Set([now - 1, now, now + 1, now + 2]);
    mtAllMonths().forEach(m => years.add(+m.slice(0, 4)));
    bgEl('bg-year').innerHTML = Array.from(years).sort().map(y => `<option value="${y}">${y}</option>`).join('');
    bgEl('bg-month').innerHTML = MT_MON.map((n, i) => `<option value="${mtPad(i + 1)}">${n}</option>`).join('');
    bgEl('bg-year').value = active.slice(0, 4);
    bgEl('bg-month').value = active.slice(5, 7);
    bgMsg('');
    bgRenderTargets();
    bgRenderMonths();
    bgEl('budget-modal').style.display = 'flex';
}

function bgRenderTargets() {
    const month = bgMonthKey();
    const lock = budget.locks[month] || null;
    const cur = (lock ? lock.targets : mtTargets(month)) || {};
    const branches = MT_BRANCHES.concat(Object.keys(cur).filter(n => !MT_BRANCHES.includes(n)));
    const dis = lock ? 'disabled' : '';
    let body = '<tbody>';
    branches.forEach(n => {
        const t = cur[n] || {};
        body += `<tr><td class="bold">${escapeEmailHtml(n)}</td>` +
            `<td><input type="number" class="bg-input" min="0" step="0.01" data-b="${escapeEmailHtml(n)}" data-k="ow" value="${t.ow ? t.ow : ''}" placeholder="0" ${dis}></td>` +
            `<td><input type="number" class="bg-input" min="0" step="0.01" data-b="${escapeEmailHtml(n)}" data-k="counter" value="${t.counter ? t.counter : ''}" placeholder="0" ${dis}></td>` +
            `<td class="text-right bg-rowtot" data-tot="${escapeEmailHtml(n)}">0</td></tr>`;
    });
    body += `<tr class="daily-total-row"><td class="bold">Total</td><td class="text-right bold" id="bg-tot-ow">0</td><td class="text-right bold" id="bg-tot-counter">0</td><td class="text-right bold" id="bg-tot-all">0</td></tr></tbody>`;
    bgEl('bg-table').innerHTML = '<thead><tr><th>Branch</th><th class="text-right">OW Revenue Target</th><th class="text-right">Counter Sale Target</th><th class="text-right">Total</th></tr></thead>' + body;

    const st = bgEl('bg-status');
    st.className = 'bg-status ' + (lock ? 'locked' : 'open');
    st.textContent = lock ? `🔒 ${mtMonthLabel(month)} is locked - targets cannot be changed (Delete the locked data to edit)` : `${mtMonthLabel(month)} - ${mtTargets(month) ? 'target set, open' : 'no target set yet'}`;
    bgEl('bg-update').disabled = !!lock;
    bgEl('bg-fill-counter').disabled = !!lock;
    bgSumTotals();
}

function bgSumTotals() {
    const t = { ow: 0, counter: 0 }, row = {};
    document.querySelectorAll('#bg-table .bg-input').forEach(i => {
        const v = parseFloat(i.value) || 0;
        t[i.dataset.k] += v; row[i.dataset.b] = (row[i.dataset.b] || 0) + v;
    });
    document.querySelectorAll('#bg-table [data-tot]').forEach(c => { c.textContent = mtFmt(row[c.dataset.tot] || 0); });
    bgEl('bg-tot-ow').textContent = mtFmt(t.ow); bgEl('bg-tot-counter').textContent = mtFmt(t.counter); bgEl('bg-tot-all').textContent = mtFmt(t.ow + t.counter);
}

function bgReadInputs() {
    const targets = {};
    let bad = '';
    document.querySelectorAll('#bg-table .bg-input').forEach(i => {
        const raw = i.value.trim();
        const v = raw === '' ? 0 : Number(raw);
        if (!isFinite(v) || v < 0) { bad = `Invalid amount for ${i.dataset.b}`; return; }
        if (!targets[i.dataset.b]) targets[i.dataset.b] = { ow: 0, counter: 0 };
        targets[i.dataset.b][i.dataset.k] = Math.round(v * 100) / 100;
    });
    if (bad) throw new Error(bad);
    Object.keys(targets).forEach(n => { if (!targets[n].ow && !targets[n].counter) delete targets[n]; });
    if (!Object.keys(targets).length) throw new Error('Enter at least one branch target');
    return targets;
}

function bgRenderMonths() {
    const tbl = bgEl('bg-months'); if (!tbl) return;
    const months = mtAllMonths().slice().reverse();
    let body = '<tbody>';
    if (!months.length) body += '<tr><td colspan="6" class="mt-break-empty">No month has a target yet.</td></tr>';
    months.forEach(m => {
        const lock = budget.locks[m], t = lock ? lock.targets : (mtTargets(m) || {});
        const ow = Object.keys(t).reduce((s, n) => s + (t[n].ow || 0), 0), ct = Object.keys(t).reduce((s, n) => s + (t[n].counter || 0), 0);
        const status = lock
            ? `<span class="bg-chip locked">🔒 Locked</span><small> ${escapeEmailHtml(formatCloudTime(lock.lockedAt))}${lock.lockedBy ? ' by ' + escapeEmailHtml(lock.lockedBy) : ''}</small>`
            : `<span class="bg-chip open">${m === mtActiveMonth() ? 'Current' : 'Open'}</span>`;
        body += `<tr><td class="bold"><a href="#" class="bg-pick" data-m="${m}">${mtMonthLabel(m)}</a></td><td class="text-right">${mtFmt(ow)}</td><td class="text-right">${mtFmt(ct)}</td><td class="text-right bold">${mtFmt(ow + ct)}</td><td>${status}</td>` +
            `<td class="bg-btns">${lock ? '' : `<button type="button" class="btn-action bg-lock" data-act="lock" data-m="${m}">🔒 Lock</button>`}` +
            `<button type="button" class="btn-action bg-del" data-act="delete" data-m="${m}">🗑 Delete</button></td></tr>`;
    });
    tbl.innerHTML = '<thead><tr><th>Month</th><th class="text-right">OW Target</th><th class="text-right">Counter Target</th><th class="text-right">Total</th><th>Status</th><th>Action</th></tr></thead>' + body + '</tbody>';
}

/** Read the latest saved budget, apply one change, save it back (so two admins never overwrite each other's months). */
async function bgSave(mutator) {
    let key = getAdminUploadKey(false);
    if (!key) throw new Error('No Admin Upload Key entered');
    for (let attempt = 0; attempt < 2; attempt++) {
        let latest;
        const r = await fetch(`${CLOUD_API}?type=budget`, { cache: 'no-store' });
        if (r.ok) latest = mtNormBudget(JSON.parse(await r.text()));
        else if (r.status === 404) { latest = mtNormBudget({ targets: JSON.parse(JSON.stringify(MONTHLY_TARGETS)) }); }   // first save: start from the built-in list
        else throw new Error(`Could not read the saved budget (server ${r.status})`);
        mutator(latest);
        latest.updatedAt = new Date().toISOString(); latest.updatedBy = displayName(currentUser);

        const res = await fetch(`${CLOUD_API}?type=budget`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'x-admin-key': key, 'x-file-name': encodeURIComponent('budget.json'), 'x-uploaded-by': encodeURIComponent(displayName(currentUser)) },
            body: new Blob([JSON.stringify(latest)], { type: 'application/json' })
        });
        if (res.status === 401) { sessionStorage.removeItem(CLOUD_KEY_STORAGE); key = getAdminUploadKey(true); if (!key) throw new Error('Invalid Admin Upload Key'); continue; }
        if (!res.ok) { let m = `Server error ${res.status}`; try { m = (await res.json()).error || m; } catch (e) {} throw new Error(m); }
        const saved = await res.json();
        budget = latest; budgetLoaded = true;
        if (typeof cloudInfo !== 'undefined') cloudInfo.budget = saved.meta;
        return;
    }
    throw new Error('Invalid Admin Upload Key');
}

async function bgRun(label, fn) {
    if (bgBusy || !bgIsAdmin()) return;
    bgBusy = true; bgMsg('Saving...', true);
    document.querySelectorAll('#budget-modal button').forEach(b => { b.dataset.was = b.disabled ? '1' : ''; b.disabled = true; });
    try { await fn(); bgMsg(label, true); }
    catch (err) { console.error(err); bgMsg('⚠ ' + err.message, false); }
    bgBusy = false;
    document.querySelectorAll('#budget-modal button').forEach(b => { b.disabled = b.dataset.was === '1'; });
    bgRenderTargets(); bgRenderMonths(); renderMonthlyTarget();
}

function bgUpdate() {
    const month = bgMonthKey();
    let targets;
    try { targets = bgReadInputs(); } catch (e) { bgMsg('⚠ ' + e.message, false); return; }
    bgRun(`✓ ${mtMonthLabel(month)} target saved`, async () => {
        await bgSave(latest => {
            if (latest.locks[month]) throw new Error(`${mtMonthLabel(month)} is locked. Delete its locked data first to change the target.`);
            latest.targets[month] = targets;
        });
        mtMonth = month;       // dashboard follows the updated month
    });
}

function bgLock(month) {
    const targets = mtTargets(month);
    if (!targets) { bgMsg('⚠ Set the target for this month first', false); return; }
    if (budget.locks[month]) return;
    const [Y, M] = month.split('-').map(Number);
    const lastDay = `${month}-${mtPad(new Date(Y, M, 0).getDate())}`;
    const raw = mtCollect(month, targets);
    let q = `Lock ${mtMonthLabel(month)}?\n\nThe final targets and achievement (data up to ${raw.asOf ? mtDM(raw.asOf) : 'none'}) will be stored permanently and will not be changed by new uploads. New Repair Revenue / Counter Sale uploads will then count for the next open month.\n\nContinue?`;
    if (!raw.asOf) q = `No Repair Revenue / Counter Sale data dated ${mtMonthLabel(month)} is loaded, so the locked month would show zero achievement.\n\n` + q;
    else if (mtTodayKey() <= lastDay) q = `${mtMonthLabel(month)} is not finished yet.\n\n` + q;
    if (!confirm(q)) return;
    const snap = { lockedAt: new Date().toISOString(), lockedBy: displayName(currentUser), targets: mtRound(targets), raw: mtRound(raw) };
    bgRun(`✓ ${mtMonthLabel(month)} locked`, async () => {
        await bgSave(latest => {
            if (latest.locks[month]) throw new Error(`${mtMonthLabel(month)} is already locked`);
            latest.locks[month] = snap;
            if (!latest.targets[month]) latest.targets[month] = snap.targets;
        });
        mtMonth = mtActiveMonth();     // uploads from now on count for the next open month
    });
}

function bgDelete(month) {
    const locked = !!budget.locks[month];
    const msg = locked
        ? `Delete the LOCKED data of ${mtMonthLabel(month)}?\n\nThe month goes back to open and is recalculated from the currently uploaded files (if they no longer contain this month it will show zero). The target is kept. This cannot be undone.`
        : `Delete the target of ${mtMonthLabel(month)}?\n\nThis cannot be undone.`;
    if (!confirm(msg)) return;
    bgRun(locked ? `✓ Locked data of ${mtMonthLabel(month)} deleted` : `✓ Target of ${mtMonthLabel(month)} deleted`, async () => {
        await bgSave(latest => {
            if (latest.locks[month]) delete latest.locks[month];
            else delete latest.targets[month];
        });
        if (mtMonth === month || !mtAllMonths().includes(mtMonth)) mtMonth = null;
    });
}

function initBudgetAdmin() {
    const open = bgEl('btn-budget-target');
    if (open) open.addEventListener('click', bgOpen);
    const close = () => { bgEl('budget-modal').style.display = 'none'; };
    bgEl('btn-close-budget').addEventListener('click', close);
    bgEl('budget-modal').addEventListener('mousedown', e => { if (e.target === bgEl('budget-modal')) close(); });
    ['bg-year', 'bg-month'].forEach(id => bgEl(id).addEventListener('change', () => { bgMsg(''); bgRenderTargets(); }));
    bgEl('bg-table').addEventListener('input', bgSumTotals);
    bgEl('bg-update').addEventListener('click', bgUpdate);
    bgEl('bg-fill-counter').addEventListener('click', () => {
        document.querySelectorAll('#bg-table .bg-input[data-k="ow"]').forEach(i => {
            const c = document.querySelector(`#bg-table .bg-input[data-k="counter"][data-b="${i.dataset.b.replace(/"/g, '\\"')}"]`);
            const v = parseFloat(i.value);
            if (c && isFinite(v)) c.value = (Math.round(v * 25) / 100).toFixed(2);
        });
        bgSumTotals();
    });
    bgEl('bg-months').addEventListener('click', e => {
        const pick = e.target.closest('.bg-pick');
        if (pick) { e.preventDefault(); const m = pick.dataset.m; bgEl('bg-year').value = m.slice(0, 4); bgEl('bg-month').value = m.slice(5, 7); bgMsg(''); bgRenderTargets(); return; }
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        if (b.dataset.act === 'lock') bgLock(b.dataset.m); else bgDelete(b.dataset.m);
    });
}

function initMonthlyTarget() {
    document.querySelectorAll('#mt-metric-seg button').forEach(b => {
        b.addEventListener('click', () => { mtMetric = b.dataset.m; renderMonthlyTarget(); });
    });
    const ysel = document.getElementById('mt-year'), msel = document.getElementById('mt-month');
    if (msel) msel.addEventListener('change', () => { mtMonth = msel.value; renderMonthlyTarget(); });
    if (ysel) ysel.addEventListener('change', () => {
        const inYear = mtAllMonths().filter(m => m.startsWith(ysel.value));
        const active = mtActiveMonth();
        mtMonth = inYear.includes(active) ? active : (inYear[inYear.length - 1] || mtMonth);
        renderMonthlyTarget();
    });

    [['repair-file-input', 'repair', 'btn-upload-repair', 'Repair Revenue Uploaded'],
     ['counter-file-input', 'counter', 'btn-upload-counter', 'Counter Sale Uploaded']].forEach(([inputId, type, btnId, label]) => {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('change', async e => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            if (await loadRevenueFile(file, type, true)) highlightUploadButton(btnId, label);
        });
    });
    initBudgetAdmin();
}

document.addEventListener('DOMContentLoaded', initMonthlyTarget);
