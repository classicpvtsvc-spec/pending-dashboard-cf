/**
 * Sentinel Daily Pending Jobs Dashboard
 */

// User Database Configuration
let USERS = [
    { username: 'Arun', password: '1234', role: 'Admin', branch: 'ALL' },
    { username: 'Yasir', password: '1234', role: 'Manager', branch: 'ALL' },
    { username: 'Dibil', password: '1234', role: 'Supervisor', branch: 'Jeddah' },
    { username: '1891', password: '1891', role: 'Supervisor', branch: 'Al Kharj' },
    { username: '2651', password: '2651', role: 'Supervisor', branch: 'Hassa' },
    { username: '2652', password: '2652', role: 'Supervisor', branch: 'Jeddah' },
    { username: 'FG364', password: 'FG364', role: 'Supervisor', branch: 'Jizan' },
    { username: '1921', password: '1921', role: 'Supervisor', branch: 'Khamis' },
    { username: '2354', password: '2354', role: 'Supervisor', branch: 'Khobar' },
    { username: '1719', password: '1719', role: 'Supervisor', branch: 'Madinah' },
    { username: 'FG359', password: 'FG359', role: 'Supervisor', branch: 'Makkah' },
    { username: '2047', password: '2047', role: 'Supervisor', branch: 'Qassim' },
    { username: '2647', password: '2647', role: 'Supervisor', branch: 'Riyadh' },
    { username: '1148', password: '1148', role: 'Supervisor', branch: 'Tabuke' },
    { username: '1823', password: '1823', role: 'Supervisor', branch: 'Taif' },
    { username: '1714', password: '1714', role: 'Supervisor', branch: 'Yanbu' },
    { username: 'FG355', password: 'FG355', role: 'Supervisor', branch: 'Jizan' },
    { username: 'FG356', password: 'FG356', role: 'Supervisor', branch: 'Khamis' },
    { username: 'FG365', password: 'FG365', role: 'Supervisor', branch: 'Riyadh' },
    { username: '9408', password: '9408', role: 'Supervisor', branch: 'Khobar' }
];

// Mappings for Codes and Descriptions
const SERVICE_TYPE_MAP = {
    'Carry In': 'CI',
    'Dealer Inspection': 'DI',
    'In Home': 'IH',
    'Installation': 'IS',
    'Marketing Support': 'MS',
    'Pickup & Delivery': 'PD'
};

const WARRANTY_TYPE_MAP = {
    'Aux Warranty': 'AW',
    'Customer Damaged & NAR': 'OW',
    'Dealer Warranty': 'CDNAR',
    'Extra Warranty': 'LG-W',
    'Hisense Warranty': 'Hi-W',
    'In Warranty': 'Cla-W',
    'Out Of Warranty': 'OW',
    'PRO-AV WARRANTY': 'Cla-W',
    'Retail Extended Warranty': 'Cla-W',
    'Rheem Warranty': 'Rh-W',
    'SAMSUNG EXTENDED WARRANTY': 'OW',
    'Samsung Warranty': 'SAM-W',
    'Service Warranty': 'Serv-W',
    'Xiaomi Warranty': 'Xi-W',
    'Closed by phone': 'Cla-W',
    'disposal after 3 months': 'Cla-W'
};

const PEND_REASON_MAP = {
    'customer no response': 'No Response',
    'First Visit Arranged': 'First Visit Arngd',
    'Job for Cancellation': 'Job for Canc',
    'Open Scheduled': 'Open Scheduled',
    'Parts with Store': 'Parts with Store',
    'Parts with Technician': 'Parts with Tech',
    'Pending Scheduled': 'Pend Scheduled',
    'Repair Finished': 'Repair Finished',
    'Repair Finished ': 'Repair Finished',
    'Repair Que': 'Repair Que',
    'Spare Parts N.L.A.': 'Parts N.L.A.',
    'Waiting for Customer Approval': 'Cust. Approval',
    'Waiting for parts': 'Waiting for parts',
    'Waiting for Technical Assistance': 'Tech. Assistance',
    'waiting for unit pick up': 'For Unit pickup'
};

// Application State variables
let currentUser = null;
let rawData = [];
let filteredData = [];

// Admin Specific Datasets
let registrationData = [];
let closureData = [];
let activeGraphBrandFilter = new Set();
let regCloseChartInstance = null;

// Ageing categories definition
const AGE_CATEGORIES = ['0~02', '03~04', '05~06', '07~09', '10~14', '15~25', 'Over 25'];

// DOM Content Loaded Handler
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initEventListeners();
    initUserManagement();
    initJobCardModal();
    initOutsideClickDismissal();
    initScrollToTop();
});

function initAuth() {
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const uInput = document.getElementById('username').value.trim();
        const pInput = document.getElementById('password').value.trim();

        const user = USERS.find(u => u.username.toLowerCase() === uInput.toLowerCase() && u.password === pInput);
        if (user) {
            currentUser = user;
            localStorage.setItem('sentinel_session_user', JSON.stringify(currentUser));
            
            document.getElementById('login-error').style.display = 'none';
            document.getElementById('login-page').style.display = 'none';
            document.getElementById('app-container').style.display = 'block';
            
            setupUserSession();
            loadDefaultDataFile();
        } else {
            document.getElementById('login-error').style.display = 'block';
        }
    });

    const savedUser = localStorage.getItem('sentinel_session_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            document.getElementById('login-page').style.display = 'none';
            document.getElementById('app-container').style.display = 'block';
            setupUserSession();
            loadDefaultDataFile();
        } catch (e) {
            localStorage.removeItem('sentinel_session_user');
        }
    }

    document.getElementById('btn-logout').addEventListener('click', () => {
        currentUser = null;
        localStorage.removeItem('sentinel_session_user');
        document.getElementById('app-container').style.display = 'none';
        document.getElementById('login-page').style.display = 'flex';
        document.getElementById('login-form').reset();
    });
}

function setupUserSession() {
    document.getElementById('user-display-name').textContent = currentUser.username;
    document.getElementById('user-display-role').textContent = `${currentUser.role}${currentUser.branch !== 'ALL' ? ' (' + currentUser.branch + ')' : ''}`;

    const userMgmtBtn = document.getElementById('btn-user-mgmt');
    const adminUploadControls = document.getElementById('admin-upload-controls');
    const adminAnalyticsSection = document.getElementById('admin-daily-analytics-section');

    const emailBtn = document.getElementById('btn-send-email');
    if (emailBtn) emailBtn.style.display = currentUser.role === 'Admin' ? 'inline-flex' : 'none';

    if (currentUser.role === 'Admin') {
        userMgmtBtn.style.display = 'inline-flex';
        if (adminUploadControls) adminUploadControls.style.display = 'flex';
        if (adminAnalyticsSection) adminAnalyticsSection.style.display = 'block';
    } else {
        userMgmtBtn.style.display = 'none';
        if (adminUploadControls) adminUploadControls.style.display = 'none';
        if (adminAnalyticsSection) adminAnalyticsSection.style.display = 'none';
    }

    const branchSelect = document.getElementById('branch-filter');
    branchSelect.innerHTML = '';

    if (currentUser.role === 'Admin' || currentUser.role === 'Manager') {
        const optAll = document.createElement('option');
        optAll.value = 'ALL';
        optAll.textContent = 'All Branches';
        branchSelect.appendChild(optAll);
        branchSelect.disabled = false;
    } else {
        const opt = document.createElement('option');
        opt.value = currentUser.branch;
        opt.textContent = currentUser.branch;
        branchSelect.appendChild(opt);
        branchSelect.value = currentUser.branch;
        branchSelect.disabled = true;
    }
}

function initEventListeners() {
    document.getElementById('branch-filter').addEventListener('change', () => {
        processDashboardData();
    });

    document.getElementById('excel-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            processUploadedFile(file, 'pending');
            handleUploadPersistence(file, 'pending');
            highlightUploadButton('btn-upload-pending', 'Pending Jobs Uploaded');
        }
    });

    const regInput = document.getElementById('registration-file-input');
    if (regInput) {
        regInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                processUploadedFile(file, 'registration');
                handleUploadPersistence(file, 'registration');
                highlightUploadButton('btn-upload-registration', 'Registration Data Uploaded');
            }
        });
    }

    const closeInput = document.getElementById('closure-file-input');
    if (closeInput) {
        closeInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                processUploadedFile(file, 'closure');
                handleUploadPersistence(file, 'closure');
                highlightUploadButton('btn-upload-closure', 'Closure Data Uploaded');
            }
        });
    }

    document.getElementById('btn-export-excel').addEventListener('click', exportToExcel);

    const togglePwBtn = document.getElementById('toggle-pw');
    if (togglePwBtn) {
        togglePwBtn.addEventListener('click', () => {
            const passwordInput = document.getElementById('password');
            const isPassword = passwordInput.getAttribute('type') === 'password';
            passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
        });
    }
}

function highlightUploadButton(buttonId, labelText) {
    const btn = document.getElementById(buttonId);
    if (btn) {
        btn.classList.add('uploaded-success');
        btn.innerHTML = `✓ ${labelText}`;
    }
}

function processUploadedFile(file, type = 'pending') {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.txt') || fileName.endsWith('.tsv')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (type === 'registration') parseRegistrationText(e.target.result);
            else if (type === 'closure') parseClosureText(e.target.result);
            else parseTextData(e.target.result);
        };
        reader.readAsText(file);
    } else {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (type === 'registration') parseRegistrationExcel(e.target.result);
            else if (type === 'closure') parseClosureExcel(e.target.result);
            else parseExcelBuffer(e.target.result);
        };
        reader.readAsArrayBuffer(file);
    }
}

/* ==========================================================================
   ADMIN REGISTRATION & CLOSURE PARSING
   ========================================================================== */

function parseRegistrationText(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return;

    const headers = lines[0].split('\t').map(h => h.trim().toUpperCase());
    const dataRows = lines.slice(1).map(l => l.trim().split('\t')).filter(r => r.length > 1);

    buildRegistrationData(headers, dataRows);
}

function parseRegistrationExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (json.length < 2) return;

    const headers = json[0].map(h => String(h || '').trim().toUpperCase());
    buildRegistrationData(headers, json.slice(1));
}

function buildRegistrationData(headers, rows) {
    const rcptIdx = getColIndex(headers, ['RECEIPT_DATE', 'RECEIPT_DT', 'RECEIPT DT', 'RCVE_DATE'], 0);
    const brandIdx = getColIndex(headers, ['BRAND_NAME', 'BRAND', 'BRAND NAME'], 1);
    const branchIdx = getColIndex(headers, ['BRANCH_NAME', 'BRANCH', 'BRANCH NAME'], 2);

    registrationData = [];
    rows.forEach(row => {
        const dStr = getRowVal(row, rcptIdx);
        const dt = parseDateString(dStr);
        if (dt) {
            const year = dt.getFullYear();
            const month = String(dt.getMonth() + 1).padStart(2, '0');
            const day = String(dt.getDate()).padStart(2, '0');
            const formattedDate = `${year}-${month}-${day}`;
            const brand = getRowVal(row, brandIdx) || 'Unknown';
            const branch = getRowVal(row, branchIdx) || 'Unknown';
            registrationData.push({ date: formattedDate, brand: brand, branch: branch });
        }
    });

    renderAdminDailyAnalytics();
}

function parseClosureText(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return;

    const headers = lines[0].split('\t').map(h => h.trim().toUpperCase());
    const dataRows = lines.slice(1).map(l => l.trim().split('\t')).filter(r => r.length > 1);

    buildClosureData(headers, dataRows);
}

function parseClosureExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (json.length < 2) return;

    const headers = json[0].map(h => String(h || '').trim().toUpperCase());
    buildClosureData(headers, json.slice(1));
}

function buildClosureData(headers, rows) {
    const closeIdx = getColIndex(headers, ['CLOSING_DATE', 'CLOSING_DT', 'CLOSE_DATE'], 0);
    const brandIdx = getColIndex(headers, ['BRAND_NAME', 'BRAND', 'BRANCH NAME'], 1);
    const branchIdx = getColIndex(headers, ['BRANCH_NAME', 'BRANCH', 'BRANCH NAME'], 2);

    closureData = [];
    rows.forEach(row => {
        const dStr = getRowVal(row, closeIdx);
        const dt = parseDateString(dStr);
        if (dt) {
            const year = dt.getFullYear();
            const month = String(dt.getMonth() + 1).padStart(2, '0');
            const day = String(dt.getDate()).padStart(2, '0');
            const formattedDate = `${year}-${month}-${day}`;
            const brand = getRowVal(row, brandIdx) || 'Unknown';
            const branch = getRowVal(row, branchIdx) || 'Unknown';
            closureData.push({ date: formattedDate, brand: brand, branch: branch });
        }
    });

    renderAdminDailyAnalytics();
}

function formatDateToDDMM(isoDateStr) {
    if (!isoDateStr) return '';
    const parts = isoDateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}`;
    }
    return isoDateStr;
}

function renderMatrixTable(dataset, tableContainerId, rowLabel = 'Branch') {
    const tableElem = document.getElementById(tableContainerId);
    if (!tableElem) return;

    // Daily tables always show the complete dataset. The graph Brand filter
    // applies only to the graph, not to these tables.
    const rows = Array.from(new Set(dataset.map(i => i.branch || 'Unknown')));
    const dates = Array.from(new Set(dataset.map(i => i.date))).sort();

    const matrix = {};
    rows.forEach(row => {
        matrix[row] = {};
        dates.forEach(d => { matrix[row][d] = 0; });
    });

    dataset.forEach(item => {
        const row = item.branch || 'Unknown';
        if (matrix[row] && matrix[row][item.date] !== undefined) {
            matrix[row][item.date]++;
        }
    });

    // Sort rows high-to-low using the latest date count.
    const lastDate = dates.length ? dates[dates.length - 1] : null;
    rows.sort((a, b) => {
        const diff = (lastDate ? matrix[b][lastDate] : 0) - (lastDate ? matrix[a][lastDate] : 0);
        return diff || a.localeCompare(b);
    });

    let theadHtml = `<thead><tr><th>${rowLabel}</th>`;
    dates.forEach(d => {
        theadHtml += `<th class="text-center">${formatDateToDDMM(d)}</th>`;
    });
    theadHtml += '</tr></thead>';

    const totals = {};
    dates.forEach(d => {
        totals[d] = dataset.reduce((sum, item) => sum + (item.date === d ? 1 : 0), 0);
    });

    let tbodyHtml = '<tbody>';
    rows.forEach(row => {
        tbodyHtml += `<tr><td class="bold">${row}</td>`;
        dates.forEach(d => {
            const val = matrix[row][d];
            tbodyHtml += `<td class="text-center">${val > 0 ? val : ''}</td>`;
        });
        tbodyHtml += '</tr>';
    });

    if (dates.length) {
        tbodyHtml += '<tr class="daily-total-row"><td class="bold">Total</td>';
        dates.forEach(d => {
            tbodyHtml += `<td class="text-center bold">${totals[d] > 0 ? totals[d] : ''}</td>`;
        });
        tbodyHtml += '</tr>';
    }

    tbodyHtml += '</tbody>';
    tableElem.innerHTML = theadHtml + tbodyHtml;
}

function renderBrandMatrixTable(dataset, tableContainerId) {
    const tableElem = document.getElementById(tableContainerId);
    if (!tableElem) return;

    const rows = Array.from(new Set(dataset.map(i => i.brand || 'Unknown')));
    const dates = Array.from(new Set(dataset.map(i => i.date))).sort();

    const matrix = {};
    rows.forEach(row => {
        matrix[row] = {};
        dates.forEach(d => { matrix[row][d] = 0; });
    });

    dataset.forEach(item => {
        const row = item.brand || 'Unknown';
        if (matrix[row] && matrix[row][item.date] !== undefined) {
            matrix[row][item.date]++;
        }
    });

    // Sort brands high-to-low using the latest date count.
    const lastDate = dates.length ? dates[dates.length - 1] : null;
    rows.sort((a, b) => {
        const diff = (lastDate ? matrix[b][lastDate] : 0) - (lastDate ? matrix[a][lastDate] : 0);
        return diff || a.localeCompare(b);
    });

    let theadHtml = '<thead><tr><th>Brand</th>';
    dates.forEach(d => {
        theadHtml += `<th class="text-center">${formatDateToDDMM(d)}</th>`;
    });
    theadHtml += '</tr></thead>';

    const totals = {};
    dates.forEach(d => {
        totals[d] = dataset.reduce((sum, item) => sum + (item.date === d ? 1 : 0), 0);
    });

    let tbodyHtml = '<tbody>';
    rows.forEach(row => {
        tbodyHtml += `<tr><td class="bold">${row}</td>`;
        dates.forEach(d => {
            const val = matrix[row][d];
            tbodyHtml += `<td class="text-center">${val > 0 ? val : ''}</td>`;
        });
        tbodyHtml += '</tr>';
    });

    if (dates.length) {
        tbodyHtml += '<tr class="daily-total-row"><td class="bold">Total</td>';
        dates.forEach(d => {
            tbodyHtml += `<td class="text-center bold">${totals[d] > 0 ? totals[d] : ''}</td>`;
        });
        tbodyHtml += '</tr>';
    }

    tbodyHtml += '</tbody>';
    tableElem.innerHTML = theadHtml + tbodyHtml;
}

function getBranchFilteredAdminData() {
    const branchSelect = document.getElementById('branch-filter');
    const selectedBranch = branchSelect ? branchSelect.value : 'ALL';

    if (selectedBranch === 'ALL') {
        return { registration: registrationData, closure: closureData };
    }

    const branchKey = String(selectedBranch).trim().toLowerCase();
    return {
        registration: registrationData.filter(item => String(item.branch || '').trim().toLowerCase() === branchKey),
        closure: closureData.filter(item => String(item.branch || '').trim().toLowerCase() === branchKey)
    };
}

function renderAdminDailyAnalytics() {
    if (currentUser.role !== 'Admin') return;

    const branchData = getBranchFilteredAdminData();

    renderMatrixTable(branchData.registration, 'table-daily-registration', 'Branch');
    renderMatrixTable(branchData.closure, 'table-daily-closing', 'Branch');

    renderBrandMatrixTable(branchData.registration, 'table-daily-registration-brand');
    renderBrandMatrixTable(branchData.closure, 'table-daily-closing-brand');

    renderGraphFilterButtons(branchData);
    renderDailyAnalyticsChart(branchData);
}

function renderGraphFilterButtons(branchData = getBranchFilteredAdminData()) {
    const container = document.getElementById('graph-filter-container');
    if (!container) return;

    const brands = Array.from(new Set([
        ...branchData.registration.map(r => r.brand),
        ...branchData.closure.map(c => c.brand)
    ])).filter(brand => brand && brand !== 'Unknown').sort();

    container.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'brand-filter-label';
    label.textContent = 'Brand:';
    container.appendChild(label);

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `brand-filter-btn ${activeGraphBrandFilter.size === 0 ? 'active' : ''}`;
    allBtn.textContent = 'ALL';
    allBtn.title = 'Show all brands';
    allBtn.onclick = () => {
        activeGraphBrandFilter = new Set();
        renderAdminDailyAnalytics();
    };
    container.appendChild(allBtn);

    brands.forEach(brand => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `brand-filter-btn ${activeGraphBrandFilter.size > 0 && activeGraphBrandFilter.has(brand) ? 'active' : ''}`;
        btn.textContent = brand;
        btn.title = `Toggle ${brand}`;
        btn.onclick = () => {
            const selected = new Set(activeGraphBrandFilter);

            if (selected.size === 0) {
                // From ALL, selecting one brand starts a single-brand selection.
                selected.add(brand);
            } else if (selected.has(brand)) {
                selected.delete(brand);
            } else {
                selected.add(brand);
            }

            activeGraphBrandFilter = selected;
            renderAdminDailyAnalytics();
        };
        container.appendChild(btn);
    });
}

function renderDailyAnalyticsChart(branchData = getBranchFilteredAdminData()) {
    const canvas = document.getElementById('regCloseChart');
    if (!canvas) return;

    const filteredReg = activeGraphBrandFilter.size === 0
        ? branchData.registration
        : branchData.registration.filter(r => activeGraphBrandFilter.has(r.brand));

    const filteredClose = activeGraphBrandFilter.size === 0
        ? branchData.closure
        : branchData.closure.filter(c => activeGraphBrandFilter.has(c.brand));

    const regCounts = {};
    filteredReg.forEach(r => regCounts[r.date] = (regCounts[r.date] || 0) + 1);

    const closeCounts = {};
    filteredClose.forEach(c => closeCounts[c.date] = (closeCounts[c.date] || 0) + 1);

    const dates = Array.from(new Set([...Object.keys(regCounts), ...Object.keys(closeCounts)])).sort();

    const displayLabels = dates.map(d => formatDateToDDMM(d));
    const regDataPoints = dates.map(d => regCounts[d] || 0);
    const closeDataPoints = dates.map(d => closeCounts[d] || 0);

    if (regCloseChartInstance) {
        regCloseChartInstance.destroy();
    }

    const ctx = canvas.getContext('2d');

    // Gradient backgrounds for smooth line chart filling
    const gradReg = ctx.createLinearGradient(0, 0, 0, 300);
    gradReg.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
    gradReg.addColorStop(1, 'rgba(59, 130, 246, 0.01)');

    const gradClose = ctx.createLinearGradient(0, 0, 0, 300);
    gradClose.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
    gradClose.addColorStop(1, 'rgba(16, 185, 129, 0.01)');

    regCloseChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: displayLabels,
            datasets: [
                {
                    label: 'Daily Registration',
                    data: regDataPoints,
                    borderColor: '#3b82f6',
                    backgroundColor: gradReg,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6
                },
                {
                    label: 'Daily Closing',
                    data: closeDataPoints,
                    borderColor: '#10b981',
                    backgroundColor: gradClose,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                tooltip: {
                    padding: 10
                }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function scrollToSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function initOutsideClickDismissal() {
    document.addEventListener('click', (e) => {
        const popup = document.getElementById('active-part-popup');
        if (popup && !popup.contains(e.target) && !e.target.classList.contains('part-status-clickable')) {
            popup.remove();
        }
    });
}

function loadLocalDefaultDataFile() {
    fetch('20092026.txt')
        .then(res => {
            if (!res.ok) throw new Error("TXT file not found");
            return res.text();
        })
        .then(textData => {
            parseTextData(textData);
        })
        .catch(() => {
            fetch('DATA_1709.xlsx')
                .then(res => {
                    if (!res.ok) throw new Error("Default file not found");
                    return res.arrayBuffer();
                })
                .then(buffer => {
                    parseExcelBuffer(buffer);
                })
                .catch(() => {
                    console.log("No default text or excel dataset found. Waiting for manual upload.");
                });
        });
}

function parseTextData(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return;

    const headers = lines[0].split('\t').map(h => h.trim().toUpperCase());
    const dataRows = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const row = line.split('\t');
        dataRows.push(row);
    }

    buildRawDataFromRows(headers, dataRows);
}

function parseExcelBuffer(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (json.length < 2) return;

    const headers = json[0].map(h => String(h || '').trim().toUpperCase());
    const dataRows = json.slice(1);

    buildRawDataFromRows(headers, dataRows);
}

function buildRawDataFromRows(headers, rows) {
    const today = new Date();
    
    const colIdx = {
        jobNo: getColIndex(headers, ['RCPT_NO', 'JOB_NO', 'JOB NO', 'RCPT NO'], 0),
        userName: getColIndex(headers, ['USER_NAME', 'NAME', 'CUSTOMER_NAME'], 1),
        homeTel: getColIndex(headers, ['HOME_TEL', 'TEL', 'PHONE'], 2),
        mobileNo: getColIndex(headers, ['MOBILE_NO', 'MOB', 'MOBILE'], 3),
        area: getColIndex(headers, ['AREA', 'LOCATION'], 4),
        branch: getColIndex(headers, ['BRANCH_NAME', 'BRANCH', 'BRANCH NAME'], 9),
        receiptDate: getColIndex(headers, ['RECEIPT_DT', 'RECEIPT_DATE', 'RECEIPT DT', 'RCVE_DATE'], 22),
        model: getColIndex(headers, ['MODEL_CD', 'MODEL_NO', 'MODEL', 'MODEL NO'], 16),
        brand: getColIndex(headers, ['BRAND_NAME', 'BRAND', 'BRAND NAME'], 15),
        technician: getColIndex(headers, ['TECHNICIAN_JOB_COMPLETED', 'ENG_NAME', 'TECHNICIAN', 'TECH_NAME'], 37),
        warrantyType: getColIndex(headers, ['WARRANTY_TYPE', 'WARRANTY', 'WARRANTY TYPE'], 38),
        serviceType: getColIndex(headers, ['SERVICE_TYPE', 'SERVICE TYPE', 'S_TYPE'], 39),
        pendReason: getColIndex(headers, ['PEND_REASON', 'STATUS_NAME', 'PENDING_REASON', 'REASON'], 42),
        customerRemark: getColIndex(headers, ['CUSTOMER_REMRAK', 'CUSTOMER_REMARK', 'REMARK', 'REMARKS'], 45),
        receptionRemark: getColIndex(headers, ['RECEPTION_REMARK', 'RECEPT_REMARK', 'RCPT_REMARK'], 44),
        techRemark: getColIndex(headers, ['TECH_REMARK', 'TECHNICIAN_REMARK'], 46),
        
        part1Status: getColIndex(headers, ['PART_STATUS1', 'PART_1_STATUS', 'PART1_STATUS'], 59),
        part2Status: getColIndex(headers, ['PART_STATUS2', 'PART_2_STATUS', 'PART2_STATUS'], 63),
        part3Status: getColIndex(headers, ['PART_STATUS3', 'PART_3_STATUS', 'PART3_STATUS'], 67),
        part4Status: getColIndex(headers, ['PART_STATUS4', 'PART_4_STATUS', 'PART4_STATUS'], 71),
        part5Status: getColIndex(headers, ['PART_STATUS5', 'PART_5_STATUS', 'PART5_STATUS'], 75),
        part6Status: getColIndex(headers, ['PART_STATUS6', 'PART_6_STATUS', 'PART6_STATUS'], 79),
        part7Status: getColIndex(headers, ['PART_STATUS7', 'PART_7_STATUS', 'PART7_STATUS'], 83),

        part1No: getColIndex(headers, ['PART_NO1', 'PART_1_NO', 'PART1_NO'], 57),
        part2No: getColIndex(headers, ['PART_NO2', 'PART_2_NO', 'PART2_NO'], 61),
        part3No: getColIndex(headers, ['PART_NO3', 'PART_3_NO', 'PART3_NO'], 65),
        part4No: getColIndex(headers, ['PART_NO4', 'PART_4_NO', 'PART4_NO'], 69),
        part5No: getColIndex(headers, ['PART_NO5', 'PART_5_NO', 'PART5_NO'], 73),
        part6No: getColIndex(headers, ['PART_NO6', 'PART_6_NO', 'PART6_NO'], 77),
        part7No: getColIndex(headers, ['PART_NO7', 'PART_7_NO', 'PART7_NO'], 81)
    };

    rawData = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const jobNo = getRowVal(row, colIdx.jobNo);
        if (!jobNo) continue;

        const rawDate = getRowVal(row, colIdx.receiptDate);
        const receiptDate = parseDateString(rawDate);

        let days = 0;
        if (receiptDate) {
            const diffTime = Math.abs(today - receiptDate);
            days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        }

        const ageCat = getAgeCategory(days);

        const getPartStatusVal = (idx) => {
            let val = getRowVal(row, idx);
            if (/^\d+$/.test(val)) {
                const adjVal = getRowVal(row, idx + 1);
                if (adjVal && isNaN(adjVal) && adjVal !== '-') {
                    val = adjVal;
                }
            }
            return val || '-';
        };

        const rawServiceType = getRowVal(row, colIdx.serviceType) || '';
        const serviceTypeCode = SERVICE_TYPE_MAP[rawServiceType] || rawServiceType;

        const rawWarrantyType = getRowVal(row, colIdx.warrantyType) || '';
        const warrantyTypeCode = WARRANTY_TYPE_MAP[rawWarrantyType] || WARRANTY_TYPE_MAP[rawWarrantyType.trim()] || rawWarrantyType;

        const rawPendReason = getRowVal(row, colIdx.pendReason) || 'Unspecified';
        const pendReasonCode = PEND_REASON_MAP[rawPendReason] || PEND_REASON_MAP[rawPendReason.trim()] || rawPendReason;

        const partStatuses = [
            getPartStatusVal(colIdx.part1Status),
            getPartStatusVal(colIdx.part2Status),
            getPartStatusVal(colIdx.part3Status),
            getPartStatusVal(colIdx.part4Status),
            getPartStatusVal(colIdx.part5Status),
            getPartStatusVal(colIdx.part6Status),
            getPartStatusVal(colIdx.part7Status)
        ];

        let calculatedPartStatus = 'No Parts requested';
        const hasPend = partStatuses.some(s => String(s).toUpperCase().trim() === 'PEND');
        const hasAnyStatus = partStatuses.some(s => s && s !== '-' && s !== '0');

        if (hasPend) {
            calculatedPartStatus = 'Parts Pending';
        } else if (hasAnyStatus) {
            calculatedPartStatus = 'Parts Available';
        }

        const record = {
            jobNo: jobNo,
            userName: getRowVal(row, colIdx.userName) || '',
            homeTel: getRowVal(row, colIdx.homeTel) || '',
            mobileNo: getRowVal(row, colIdx.mobileNo) || '',
            area: getRowVal(row, colIdx.area) || '',
            branch: getRowVal(row, colIdx.branch) || 'Unknown',
            receiptDate: receiptDate,
            days: days,
            ageCategory: ageCat,
            model: getRowVal(row, colIdx.model) || '',
            brand: getRowVal(row, colIdx.brand) || 'Unknown',
            technician: getRowVal(row, colIdx.technician) || 'Unassigned',
            warrantyType: warrantyTypeCode || 'Unspecified',
            serviceType: serviceTypeCode,
            pendReason: pendReasonCode,
            rawPendReason: rawPendReason,
            customerRemark: getRowVal(row, colIdx.customerRemark) || '-',
            receptionRemark: getRowVal(row, colIdx.receptionRemark) || '-',
            techRemark: getRowVal(row, colIdx.techRemark) || '-',
            partStatusCalc: calculatedPartStatus,
            
            part1: partStatuses[0],
            part2: partStatuses[1],
            part3: partStatuses[2],
            part4: partStatuses[3],
            part5: partStatuses[4],
            part6: partStatuses[5],
            part7: partStatuses[6],

            part1No: getRowVal(row, colIdx.part1No) || '-',
            part2No: getRowVal(row, colIdx.part2No) || '-',
            part3No: getRowVal(row, colIdx.part3No) || '-',
            part4No: getRowVal(row, colIdx.part4No) || '-',
            part5No: getRowVal(row, colIdx.part5No) || '-',
            part6No: getRowVal(row, colIdx.part6No) || '-',
            part7No: getRowVal(row, colIdx.part7No) || '-'
        };

        rawData.push(record);
    }

    if (currentUser.role === 'Admin' || currentUser.role === 'Manager') {
        const branchSelect = document.getElementById('branch-filter');
        const currentSelectedBranch = branchSelect.value || 'ALL';

        const branches = [...new Set(rawData.map(r => r.branch))].sort();
        branchSelect.innerHTML = '<option value="ALL">All Branches</option>';
        branches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.textContent = b;
            branchSelect.appendChild(opt);
        });

        if ([...branchSelect.options].some(opt => opt.value === currentSelectedBranch)) {
            branchSelect.value = currentSelectedBranch;
        } else {
            branchSelect.value = 'ALL';
        }
    }

    processDashboardData();
}

function getColIndex(headers, possibleNames, defaultIdx) {
    for (const name of possibleNames) {
        const idx = headers.indexOf(name.toUpperCase());
        if (idx !== -1) return idx;
    }
    return defaultIdx;
}

function getRowVal(row, idx) {
    if (idx < 0 || idx >= row.length) return '';
    const val = row[idx];
    if (val === undefined || val === null) return '';
    return String(val).trim();
}

function parseDateString(val) {
    if (!val || val === '-') return null;
    if (val instanceof Date) return val;
    
    if (typeof val === 'number') {
        return new Date(Math.round((val - 25569) * 86400 * 1000));
    }

    const strVal = String(val).trim();

    if (strVal.includes('/')) {
        const datePart = strVal.split(' ')[0];
        const parts = datePart.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                return new Date(year, month, day);
            }
        }
    }

    if (strVal.includes('-')) {
        const datePart = strVal.split(' ')[0];
        const parts = datePart.split('-');
        if (parts.length === 3) {
            if (parts[0].length === 4) {
                return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            } else {
                return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
            }
        }
    }

    const d = new Date(strVal);
    return isNaN(d.getTime()) ? null : d;
}

function getAgeCategory(days) {
    if (days <= 2) return '0~02';
    if (days <= 4) return '03~04';
    if (days <= 6) return '05~06';
    if (days <= 9) return '07~09';
    if (days <= 14) return '10~14';
    if (days <= 25) return '15~25';
    return 'Over 25';
}

function processDashboardData() {
    const selectedBranch = document.getElementById('branch-filter').value;

    if (selectedBranch === 'ALL') {
        filteredData = rawData;
    } else {
        filteredData = rawData.filter(r => r.branch.toLowerCase() === selectedBranch.toLowerCase());
    }

    renderKPICards();
    renderPendingReasonTable();
    renderWarrantyTypeTable();
    renderAgeWiseMatrix('brand', 'table-age-brand');
    renderAgeWiseMatrix('branch', 'table-age-branch');
    renderAgeWiseMatrix('technician', 'table-age-tech');
    
    if (currentUser && currentUser.role === 'Admin') {
        renderAdminDailyAnalytics();
    }

    filterDetailedTable('ALL', 'Total Pending Jobs', null, false);
}

function hasPendingPartStatus(record) {
    const statuses = [record.part1, record.part2, record.part3, record.part4, record.part5, record.part6, record.part7];
    return statuses.some(s => String(s).toUpperCase().trim() === 'PEND');
}

function hasAvailablePartStatus(record) {
    const availableStatuses = ['OPEN', 'RNTD', 'CLOSE', 'CLOS', 'DELT'];
    const statuses = [
        record.part1, record.part2, record.part3, 
        record.part4, record.part5, record.part6, record.part7
    ].map(s => String(s).toUpperCase().trim());

    const hasPending = statuses.includes('PEND');
    const hasAvailable = statuses.some(s => availableStatuses.includes(s));

    return hasAvailable && !hasPending;
}

function renderKPICards() {
    const ttlCount = filteredData.length;
    const above5Count = filteredData.filter(r => r.days > 5).length;
    const partsPendCount = filteredData.filter(r => hasPendingPartStatus(r)).length;
    const exceptPartsCount = ttlCount - partsPendCount;
    const partsAvailCount = filteredData.filter(r => hasAvailablePartStatus(r)).length;

    const above5Pct = ttlCount ? ((above5Count / ttlCount) * 100).toFixed(1) : 0;
    const partsPendPct = ttlCount ? ((partsPendCount / ttlCount) * 100).toFixed(1) : 0;
    const exceptPartsPct = ttlCount ? ((exceptPartsCount / ttlCount) * 100).toFixed(1) : 0;

    document.getElementById('kpi-ttl-pend').textContent = ttlCount.toLocaleString();
    document.getElementById('kpi-above-5').textContent = above5Count.toLocaleString();
    document.getElementById('kpi-above-5-pct').textContent = `${above5Pct}%`;
    document.getElementById('kpi-parts-pend').textContent = partsPendCount.toLocaleString();
    document.getElementById('kpi-parts-pend-pct').textContent = `${partsPendPct}%`;
    document.getElementById('kpi-except-parts').textContent = exceptPartsCount.toLocaleString();
    document.getElementById('kpi-except-parts-pct').textContent = `${exceptPartsPct}%`;
    document.getElementById('kpi-parts-avail').textContent = partsAvailCount.toLocaleString();
}

function renderPendingReasonTable() {
    const tbody = document.querySelector('#table-pend-reason tbody');
    tbody.innerHTML = '';
    const counts = {};

    filteredData.forEach(r => {
        const reason = r.pendReason || 'Unspecified';
        counts[reason] = (counts[reason] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const ttl = filteredData.length;

    sorted.forEach(([reason, count]) => {
        const pct = ttl ? ((count / ttl) * 100).toFixed(1) : 0;
        const tr = document.createElement('tr');
        tr.className = 'clickable-row';
        tr.innerHTML = `
            <td>${reason}</td>
            <td class="text-right bold">${count}</td>
            <td class="text-right muted">${pct}%</td>
        `;
        tr.onclick = () => filterDetailedTable('PEND_REASON', `Pending Reason: ${reason}`, reason, true);
        tbody.appendChild(tr);
    });
}

function renderWarrantyTypeTable() {
    const tbody = document.querySelector('#table-warranty tbody');
    tbody.innerHTML = '';
    const counts = {};

    filteredData.forEach(r => {
        const wType = r.warrantyType || 'Unspecified';
        counts[wType] = (counts[wType] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const ttl = filteredData.length;

    sorted.forEach(([wType, count]) => {
        const pct = ttl ? ((count / ttl) * 100).toFixed(1) : 0;
        const tr = document.createElement('tr');
        tr.className = 'clickable-row';
        tr.innerHTML = `
            <td>${wType}</td>
            <td class="text-right bold">${count}</td>
            <td class="text-right muted">${pct}%</td>
        `;
        tr.onclick = () => filterDetailedTable('WARRANTY_TYPE', `Warranty Type: ${wType}`, wType, true);
        tbody.appendChild(tr);
    });
}

function renderAgeWiseMatrix(groupByKey, tableId) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    tbody.innerHTML = '';

    const matrix = {};

    filteredData.forEach(r => {
        const key = r[groupByKey] || 'Unassigned';
        if (!matrix[key]) {
            matrix[key] = { '0~02': 0, '03~04': 0, '05~06': 0, '07~09': 0, '10~14': 0, '15~25': 0, 'Over 25': 0, total: 0 };
        }
        matrix[key][r.ageCategory] = (matrix[key][r.ageCategory] || 0) + 1;
        matrix[key].total += 1;
    });

    const sortedKeys = Object.keys(matrix).sort((a, b) => matrix[b].total - matrix[a].total);

    sortedKeys.forEach(key => {
        const rowData = matrix[key];
        const tr = document.createElement('tr');
        
        let html = `<td class="bold">${key}</td>`;
        
        AGE_CATEGORIES.forEach(cat => {
            const count = rowData[cat] || 0;
            html += `<td class="text-center ${count > 0 ? 'clickable-cell' : 'muted'}" onclick="filterDetailedTable('${groupByKey.toUpperCase()}_AGE', '${groupByKey.toUpperCase()}: ${key} (${cat})', { key: '${key}', age: '${cat}' }, true)">${count || '-'}</td>`;
        });

        html += `<td class="text-center bold clickable-cell" style="color:var(--primary-green);" onclick="filterDetailedTable('${groupByKey.toUpperCase()}_TOTAL', '${groupByKey.toUpperCase()}: ${key} (All Ages)', '${key}', true)">${rowData.total}</td>`;

        if (groupByKey === 'technician') {
            const safeTech = key.replace(/'/g, "\\'");
            html += `<td class="text-center action-col"><button class="btn-action btn-print-tech" onclick="event.stopPropagation(); printTechnicianData('${safeTech}')">PRINT</button></td>`;
        }

        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

function printTechnicianData(techName) {
    let techJobs = filteredData.filter(r => r.technician === techName);

    if (techJobs.length === 0) {
        alert("No pending jobs found for technician: " + techName);
        return;
    }

    const existingModal = document.getElementById('print-filter-modal');
    if (existingModal) existingModal.remove();

    // Standard requested print order for PEND_REASON.
    const pendReasonOrder = [
        'Open Scheduled',
        'First Visit Arranged',
        'customer no response',
        'Pending Scheduled',
        'Parts with Store',
        'Parts with Technician',
        'Repair Que',
        'Waiting for Technical Assistance',
        'Waiting for parts',
        'Waiting for Customer Approval',
        'waiting for unit pick up',
        'Job for Cancellation',
        'Repair Finished'
    ];

    const normalizeReason = (reason) => String(reason || '').trim();
    const presentReasons = Array.from(new Set(techJobs.map(r => normalizeReason(r.pendReason)).filter(Boolean)));

    // Categorize reasons based on the specified sort list and group any unexpected values at the end.
    const knownReasons = pendReasonOrder.filter(reason => presentReasons.some(r => r.toLowerCase() === reason.toLowerCase()));
    const otherReasons = presentReasons
        .filter(reason => !pendReasonOrder.some(r => r.toLowerCase() === reason.toLowerCase()))
        .sort((a, b) => a.localeCompare(b));
    const filterReasons = [...knownReasons, ...otherReasons];

    if (filterReasons.length === 0) {
        alert("No PEND_REASON data found for technician: " + techName);
        return;
    }

    const reasonKey = (reason) => reason.toLowerCase();

    // Generate clickable filter column buttons matching the attached layout structure
    const filterColumns = filterReasons.map((reason) => `
        <button type="button" class="print-pend-filter-col active" data-reason-key="${reasonKey(reason).replace(/"/g, '&quot;')}" title="Click to select/deselect">
            <span class="print-pend-filter-check">✓</span>
            <span>${reason}</span>
        </button>
    `).join('');

    const modalHtml = `
        <div id="print-filter-modal" class="print-filter-overlay">
            <div class="print-filter-card">
                <h4 style="margin-bottom:0.5rem; color:var(--primary-green); font-size:1.1rem;">PEND_REASON Filter</h4>
                <p style="font-size:0.8rem; color:#64748b; margin-bottom:0.75rem;">Click any column to include or exclude it from the print. Selected filters will be included in a single table.</p>
                <div class="print-pend-filter-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:8px; margin:1rem 0;">
                    ${filterColumns}
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:12px;">
                    <button id="btn-select-all-pend" class="btn-action" type="button">Select/ Deselect All</button>
                    <span id="print-pend-selected-count" style="font-size:0.8rem; color:#64748b;"></span>
                    <div class="print-filter-actions" style="margin-top:0; margin-left:auto; display:flex; gap:8px;">
                        <button id="btn-cancel-print" class="btn-action" type="button">Cancel</button>
                        <button id="btn-confirm-print" class="btn-print-tech" style="padding:6px 14px; font-size:0.85rem;" type="button">Print</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('print-filter-modal');
    const filterButtons = Array.from(modal.querySelectorAll('.print-pend-filter-col'));
    const selectedCount = document.getElementById('print-pend-selected-count');

    const updateSelectedCount = () => {
        const selected = filterButtons.filter(btn => btn.classList.contains('active')).length;
        selectedCount.textContent = `${selected} of ${filterButtons.length} selected`;
    };

    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            updateSelectedCount();
        });
    });

    document.getElementById('btn-select-all-pend').addEventListener('click', () => {
        const allSelected = filterButtons.every(btn => btn.classList.contains('active'));
        filterButtons.forEach(btn => btn.classList.toggle('active', !allSelected));
        updateSelectedCount();
    });

    document.getElementById('btn-cancel-print').addEventListener('click', () => {
        modal.remove();
    });

    updateSelectedCount();

    document.getElementById('btn-confirm-print').addEventListener('click', () => {
        const selectedKeys = new Set(
            filterButtons
                .filter(btn => btn.classList.contains('active'))
                .map(btn => btn.getAttribute('data-reason-key'))
        );

        if (selectedKeys.size === 0) {
            alert('Please select at least one PEND_REASON filter.');
            return;
        }

        modal.remove();

        const printJobs = techJobs.filter(r => selectedKeys.has(reasonKey(normalizeReason(r.pendReason))));

        if (printJobs.length === 0) {
            alert('No data matches the selected PEND_REASON filters.');
            return;
        }

        // Rank PEND_REASON entries based on specified sorting order
        const reasonRank = (reason) => {
            const idx = pendReasonOrder.findIndex(r => r.toLowerCase() === reasonKey(reason));
            return idx === -1 ? pendReasonOrder.length : idx;
        };

        // Sort records into a single merged dataset ordered by PEND_REASON rank and then by Days (Ageing)
        printJobs.sort((a, b) => {
            const rankDiff = reasonRank(normalizeReason(a.pendReason)) - reasonRank(normalizeReason(b.pendReason));
            if (rankDiff !== 0) return rankDiff;
            return (Number(b.days) || 0) - (Number(a.days) || 0);
        });

        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const todayStr = new Date().toLocaleDateString('en-GB');
        const selectedLabels = filterReasons.filter(reason => selectedKeys.has(reasonKey(reason)));
        const filterSummary = selectedLabels.join(', ');

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Please allow pop-ups for this dashboard to print the technician data.');
            return;
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Technician Pending Jobs - ${escapeHtml(techName)}</title>
                <style>
                    @page { size: A4 landscape; margin: 8mm; }
                    body { font-family: Arial, sans-serif; font-size: 10px; color: #000; margin: 0; padding: 0; }
                    .print-header { font-size: 13px; font-weight: bold; margin-bottom: 4px; border-bottom: 1px solid #000; padding-bottom: 4px; }
                    .print-filter-summary { font-size: 9px; margin-bottom: 7px; color: #333; }
                    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                    th, td { border: 1px solid #000; padding: 4px 3px; word-wrap: break-word; overflow: hidden; text-overflow: ellipsis; font-size: 12px; line-height: 1.2; vertical-align: middle; }
                    th { background-color: #f0f0f0; font-weight: bold; text-align: left; }
                    .col-no { width: 3%; text-align: center; }
                    .col-age { width: 3%; text-align: center; }
                    .col-job { width: 12%; }
                    .col-name { width: 11%; }
                    .col-tel { width: 8%; }
                    .col-mob { width: 8%; }
                    .col-area { width: 9%; }
                    .col-model { width: 11%; }
                    .col-wtype { width: 5%; text-align: center; }
                    .col-stype { width: 5%; text-align: center; }
                    .col-reason { width: 25%; }
                    tr { break-inside: avoid; }
                </style>
            </head>
            <body>
                <div class="print-header">${escapeHtml(todayStr)} | ${escapeHtml(techName)} | PEND_REASON Pending Jobs</div>
                <div class="print-filter-summary">Selected filters: ${escapeHtml(filterSummary)}</div>
                <table>
                    <thead>
                        <tr>
                            <th class="col-no">No:</th>
                            <th class="col-age">Age</th>
                            <th class="col-job">JOB NO:</th>
                            <th class="col-name">NAME:</th>
                            <th class="col-tel">TEL:</th>
                            <th class="col-mob">MOB:</th>
                            <th class="col-area">AREA</th>
                            <th class="col-model">MODEL</th>
                            <th class="col-wtype">W-TYPE</th>
                            <th class="col-stype">S-TYPE</th>
                            <th class="col-reason">PEND_REASON</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${printJobs.map((r, idx) => `
                            <tr>
                                <td class="col-no">${idx + 1}</td>
                                <td class="col-age">${escapeHtml(r.days)}</td>
                                <td class="col-job">${escapeHtml(r.jobNo)}</td>
                                <td class="col-name">${escapeHtml(r.userName)}</td>
                                <td class="col-tel">${escapeHtml(r.homeTel)}</td>
                                <td class="col-mob">${escapeHtml(r.mobileNo)}</td>
                                <td class="col-area">${escapeHtml(r.area)}</td>
                                <td class="col-model">${escapeHtml(r.model)}</td>
                                <td class="col-wtype">${escapeHtml(r.warrantyType)}</td>
                                <td class="col-stype">${escapeHtml(r.serviceType)}</td>
                                <td class="col-reason">${escapeHtml(r.pendReason)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <script>
                    window.onload = function() { window.print(); };
                <\/script>
            </body>
            </html>
        `);

        printWindow.document.close();
    });
}
function generateTechnicianPrintDocument(techName, techJobs, filters) {
    let printJobs = techJobs.filter(r => {
        if (r.partStatusCalc === 'Parts Available' && filters.showAvail) return true;
        if (r.partStatusCalc === 'No Parts requested' && filters.showNoReq) return true;
        if (r.partStatusCalc === 'Parts Pending' && filters.showPend) return true;
        return false;
    });

    if (printJobs.length === 0) {
        alert("No data matches the selected filters.");
        return;
    }

    const categories = [];
    if (filters.showAvail) categories.push('Parts Available');
    if (filters.showNoReq) categories.push('No Parts requested');
    if (filters.showPend) categories.push('Parts Pending');

    const todayStr = new Date().toLocaleDateString('en-GB');

    let printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Technician Pending Jobs - ${techName}</title>
            <style>
                @page { size: A4 landscape; margin: 8mm; }
                body { font-family: Arial, sans-serif; font-size: 10px; color: #000; margin: 0; padding: 0; }
                .section-container { margin-bottom: 16px; }
                .print-header { font-size: 13px; font-weight: bold; margin-bottom: 6px; border-bottom: 1px solid #000; padding-bottom: 4px; }
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                th, td { border: 1px solid #000; padding: 4px 3px; word-wrap: break-word; overflow: hidden; text-overflow: ellipsis; font-size: 12px; line-height: 1.2; vertical-align: middle; }
                th { background-color: #f0f0f0; font-weight: bold; text-align: left; }
                .col-no { width: 3%; text-align: center; }
                .col-age { width: 3%; text-align: center; }
                .col-job { width: 12%; }
                .col-name { width: 11%; }
                .col-tel { width: 8%; }
                .col-mob { width: 8%; }
                .col-area { width: 9%; }
                .col-model { width: 11%; }
                .col-wtype { width: 5%; text-align: center; }
                .col-stype { width: 5%; text-align: center; }
                .col-reason { width: 25%; }
            </style>
        </head>
        <body>
    `);

    categories.forEach(statusKey => {
        let groupRecords = printJobs.filter(r => r.partStatusCalc === statusKey);
        
        if (groupRecords.length > 0) {
            groupRecords.sort((a, b) => b.days - a.days);

            printWindow.document.write(`
                <div class="section-container">
                    <div class="print-header">${todayStr} | ${techName} | ${statusKey}</div>
                    <table>
                        <thead>
                            <tr>
                                <th class="col-no">No:</th>
                                <th class="col-age">Age</th>
                                <th class="col-job">JOB NO:</th>
                                <th class="col-name">NAME:</th>
                                <th class="col-tel">TEL:</th>
                                <th class="col-mob">MOB:</th>
                                <th class="col-area">AREA</th>
                                <th class="col-model">MODEL</th>
                                <th class="col-wtype">W-TYPE</th>
                                <th class="col-stype">S-TYPE</th>
                                <th class="col-reason">REASON</th>
                            </tr>
                        </thead>
                        <tbody>
            `);

            groupRecords.forEach((r, idx) => {
                printWindow.document.write(`
                    <tr>
                        <td class="col-no">${idx + 1}</td>
                        <td class="col-age">${r.days}</td>
                        <td class="col-job">${r.jobNo}</td>
                        <td class="col-name">${r.userName}</td>
                        <td class="col-tel">${r.homeTel}</td>
                        <td class="col-mob">${r.mobileNo}</td>
                        <td class="col-area">${r.area}</td>
                        <td class="col-model">${r.model}</td>
                        <td class="col-wtype">${r.warrantyType}</td>
                        <td class="col-stype">${r.serviceType}</td>
                        <td class="col-reason">${r.pendReason}</td>
                    </tr>
                `);
            });

            printWindow.document.write(`
                        </tbody>
                    </table>
                </div>
            `);
        }
    });

    printWindow.document.write(`
            <script>
                window.onload = function() { window.print(); };
            <\/script>
        </body>
        </html>
    `);

    printWindow.document.close();
}

let currentDetailedRecords = [];

function filterDetailedTable(filterType, label, param = null, shouldScroll = true) {
    document.getElementById('detailed-filter-label').textContent = `Showing: ${label}`;

    let records = [];

    if (filterType === 'ALL') {
        records = [...filteredData];
    } else if (filterType === 'ABOVE_5') {
        records = filteredData.filter(r => r.days > 5);
    } else if (filterType === 'PARTS_PEND') {
        records = filteredData.filter(r => hasPendingPartStatus(r));
    } else if (filterType === 'EXCEPT_PARTS') {
        records = filteredData.filter(r => !hasPendingPartStatus(r));
    } else if (filterType === 'PARTS_AVAIL') {
        records = filteredData.filter(r => hasAvailablePartStatus(r));
    } else if (filterType === 'PEND_REASON') {
        records = filteredData.filter(r => r.pendReason === param);
    } else if (filterType === 'WARRANTY_TYPE') {
        records = filteredData.filter(r => r.warrantyType === param);
    } else if (filterType === 'BRAND_AGE') {
        records = filteredData.filter(r => r.brand === param.key && r.ageCategory === param.age);
    } else if (filterType === 'BRANCH_AGE') {
        records = filteredData.filter(r => r.branch === param.key && r.ageCategory === param.age);
    } else if (filterType === 'TECHNICIAN_AGE') {
        records = filteredData.filter(r => r.technician === param.key && r.ageCategory === param.age);
    } else if (filterType === 'TECHNICIAN_TOTAL') {
        records = filteredData.filter(r => r.technician === param);
    } else if (filterType === 'BRAND_TOTAL') {
        records = filteredData.filter(r => r.brand === param);
    } else if (filterType === 'BRANCH_TOTAL') {
        records = filteredData.filter(r => r.branch === param);
    }

    records.sort((a, b) => b.days - a.days);
    
    currentDetailedRecords = records;
    
    renderDetailedTable(records);
    
    if (shouldScroll) {
        scrollToDetailedOverview();
    }
}

function renderDetailedTable(records) {
    const tbody = document.querySelector('#table-detailed tbody');
    tbody.innerHTML = '';

    document.getElementById('detailed-record-count').textContent = records.length.toLocaleString();

    records.forEach((r, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="clickable-job-no" onclick="openJobCardModal('${r.jobNo}')">${r.jobNo}</td>
            <td>${r.branch}</td>
            <td class="text-right bold">${r.days}</td>
            <td>${r.model}</td>
            <td>${r.brand}</td>
            <td>${r.technician}</td>
            <td>${r.pendReason}</td>
            <td>${formatPartStatus(r.part1, r.part1No, 1)}</td>
            <td>${formatPartStatus(r.part2, r.part2No, 2)}</td>
            <td>${formatPartStatus(r.part3, r.part3No, 3)}</td>
            <td>${formatPartStatus(r.part4, r.part4No, 4)}</td>
            <td>${formatPartStatus(r.part5, r.part5No, 5)}</td>
            <td>${formatPartStatus(r.part6, r.part6No, 6)}</td>
            <td>${formatPartStatus(r.part7, r.part7No, 7)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function scrollToDetailedOverview() {
    const detailedSection = document.getElementById('detailed-section');
    if (detailedSection) {
        detailedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function formatPartStatus(status, partNo, partIndex) {
    if (!status || status === '-' || status === '0') return '-';
    const s = String(status).toUpperCase().trim();

    let cls = 'status-default';
    if (s === 'PEND') {
        cls = 'status-pend';
    } else if (['RNTD', 'OPEN', 'CLOSE', 'CLOS', 'DELT'].includes(s)) {
        cls = 'status-green';
    }
    
    const displayPartNo = (partNo && partNo !== '0') ? partNo : 'N/A';
    const safePartNo = displayPartNo.replace(/'/g, "\\'");

    return `<span class="status-badge ${cls} part-status-clickable" 
                  title="Click to view Part Number" 
                  onclick="showPartPopup(event, '${safePartNo}', ${partIndex}, '${s}')">${s}</span>`;
}

function showPartPopup(event, partNo, partIndex, status) {
    event.stopPropagation();

    const existingPopup = document.getElementById('active-part-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    const badgeElem = event.currentTarget;
    const rect = badgeElem.getBoundingClientRect();

    const popup = document.createElement('div');
    popup.id = 'active-part-popup';
    popup.className = 'part-popup';

    popup.innerHTML = `
        <div class="part-popup-header">
            <span>PART ${partIndex} (${status})</span>
        </div>
        <div class="part-popup-body">
            <span class="part-popup-number" id="popup-part-text">${partNo}</span>
            ${partNo !== 'N/A' && partNo !== '-' ? `<button class="btn-copy-part" onclick="copyPartNumber('${partNo}', this)">Copy</button>` : ''}
        </div>
    `;

    document.body.appendChild(popup);

    const popupRect = popup.getBoundingClientRect();
    let top = rect.top + window.scrollY - popupRect.height - 8;
    let left = rect.left + window.scrollX + (rect.width / 2) - (popupRect.width / 2);

    if (top < window.scrollY) {
        top = rect.bottom + window.scrollY + 8;
    }

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
}

function copyPartNumber(partNo, btnElem) {
    navigator.clipboard.writeText(partNo).then(() => {
        const originalText = btnElem.textContent;
        btnElem.textContent = 'Copied!';
        btnElem.style.backgroundColor = '#006837';
        btnElem.style.color = '#fff';
        
        setTimeout(() => {
            btnElem.textContent = originalText;
            btnElem.style.backgroundColor = '';
            btnElem.style.color = '';
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
}

function exportToExcel() {
    const exportData = currentDetailedRecords.map(r => ({
        'JOB NUMBER': r.jobNo || '',
        'BRANCH': r.branch || '',
        'DAYS': r.days !== undefined ? r.days : '',
        'MODEL': r.model || '',
        'BRAND': r.brand || '',
        'TECHNICIAN': r.technician || '',
        'PENDING REASON': r.pendReason || '',
        'P-STATUS1': r.part1 || '',
        'P-NO1': r.part1No || '',
        'P-STATUS2': r.part2 || '',
        'P-NO2': r.part2No || '',
        'P-STATUS3': r.part3 || '',
        'P-NO3': r.part3No || '',
        'P-STATUS4': r.part4 || '',
        'P-NO4': r.part4No || '',
        'P-STATUS5': r.part5 || '',
        'P-NO5': r.part5No || '',
        'P-STATUS6': r.part6 || '',
        'P-NO6': r.part6No || '',
        'P-STATUS7': r.part7 || '',
        'P-NO7': r.part7No || ''
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Detailed_Jobs_Overview");
    XLSX.writeFile(wb, "Detailed_Job_Overview_Report.xlsx");
}

/* SCREENCAPTURE / COPY TO CLIPBOARD FUNCTIONS */
function captureTableToClipboard(tableId, captureMode = 'full') {
    const tableElem = document.getElementById(tableId);
    if (!tableElem) return;

    const captureContainer = tableElem.closest('.summary-card') || tableElem.closest('.detailed-dashboard-section') || tableElem;
    const wrapper = tableElem.closest('.table-wrapper');
    
    const captureBtn = captureContainer.querySelector('.btn-capture-table');
    if (captureBtn) captureBtn.style.display = 'none';

    const origMaxHeight = wrapper ? wrapper.style.maxHeight : '';
    const origOverflow = wrapper ? wrapper.style.overflow : '';

    if (captureMode === 'full' && wrapper) {
        wrapper.style.maxHeight = 'none';
        wrapper.style.overflow = 'visible';
    }

    html2canvas(captureContainer, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff'
    }).then(canvas => {
        if (captureMode === 'full' && wrapper) {
            wrapper.style.maxHeight = origMaxHeight;
            wrapper.style.overflow = origOverflow;
        }
        if (captureBtn) captureBtn.style.display = '';

        canvas.toBlob(blob => {
            if (navigator.clipboard && window.ClipboardItem) {
                const item = new ClipboardItem({ 'image/png': blob });
                navigator.clipboard.write([item]).then(() => {
                    alert('Card & table image copied to clipboard!');
                }).catch(err => {
                    console.error('Clipboard write error: ', err);
                    fallbackSaveImage(canvas, tableId);
                });
            } else {
                fallbackSaveImage(canvas, tableId);
            }
        });
    }).catch(err => {
        if (captureMode === 'full' && wrapper) {
            wrapper.style.maxHeight = origMaxHeight;
            wrapper.style.overflow = origOverflow;
        }
        if (captureBtn) captureBtn.style.display = '';
        console.error('Capture error: ', err);
        alert('Could not capture table image.');
    });
}
/* GRAPH / CHART SCREEN CAPTURE FUNCTION */
// Screen Capture handler for Graph Field
function captureGraph() {
    const graphContainer = document.querySelector('#admin-daily-analytics-section .summary-card') 
        || document.getElementById('regCloseChart')?.parentElement;

    if (!graphContainer) return;

    html2canvas(graphContainer, {
        scale: 2,
        backgroundColor: '#ffffff'
    }).then(canvas => {
        canvas.toBlob(blob => {
            if (navigator.clipboard && window.ClipboardItem) {
                const item = new ClipboardItem({ 'image/png': blob });
                navigator.clipboard.write([item]).then(() => {
                    alert('Graph screen capture copied to clipboard!');
                }).catch(err => {
                    console.error('Failed to copy graph capture: ', err);
                });
            } else {
                const link = document.createElement('a');
                link.download = 'graph-capture.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
            }
        });
    });
}

// Bind to button click event
document.addEventListener('DOMContentLoaded', () => {
    const captureGraphBtn = document.getElementById('btn-capture-graph');
    if (captureGraphBtn) {
        captureGraphBtn.addEventListener('click', captureGraph);
    }
});

function captureTechTableToClipboard() {
    const selectedBranch = document.getElementById('branch-filter').value;
    const tableElem = document.getElementById('table-age-tech');
    if (!tableElem) return;

    const captureContainer = tableElem.closest('.summary-card') || tableElem;

    const actionElements = tableElem.querySelectorAll('.action-col');
    actionElements.forEach(el => el.style.display = 'none');

    const captureBtn = captureContainer.querySelector('.btn-capture-table');
    if (captureBtn) captureBtn.style.display = 'none';

    const wrapper = tableElem.closest('.table-wrapper');
    const origMaxHeight = wrapper ? wrapper.style.maxHeight : '';
    const origOverflow = wrapper ? wrapper.style.overflow : '';

    if (selectedBranch !== 'ALL' && wrapper) {
        wrapper.style.maxHeight = 'none';
        wrapper.style.overflow = 'visible';
    }

    html2canvas(captureContainer, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff'
    }).then(canvas => {
        if (selectedBranch !== 'ALL' && wrapper) {
            wrapper.style.maxHeight = origMaxHeight;
            wrapper.style.overflow = origOverflow;
        }
        actionElements.forEach(el => el.style.display = '');
        if (captureBtn) captureBtn.style.display = '';

        canvas.toBlob(blob => {
            if (navigator.clipboard && window.ClipboardItem) {
                const item = new ClipboardItem({ 'image/png': blob });
                navigator.clipboard.write([item]).then(() => {
                    alert('Technician table image copied to clipboard!');
                }).catch(err => {
                    console.error('Clipboard error:', err);
                    fallbackSaveImage(canvas, 'Technician_Wise_Pending');
                });
            } else {
                fallbackSaveImage(canvas, 'Technician_Wise_Pending');
            }
        });
    }).catch(err => {
        if (selectedBranch !== 'ALL' && wrapper) {
            wrapper.style.maxHeight = origMaxHeight;
            wrapper.style.overflow = origOverflow;
        }
        actionElements.forEach(el => el.style.display = '');
        if (captureBtn) captureBtn.style.display = '';
        console.error('Capture error:', err);
        alert('Could not capture technician table.');
    });
}

function fallbackSaveImage(canvas, name) {
    const link = document.createElement('a');
    link.download = `${name}_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    alert('Clipboard not accessible. Image saved to downloads.');
}

/* JOB CARD MODAL FUNCTIONS */
function initJobCardModal() {
    const modal = document.getElementById('job-card-modal');
    const btnClose = document.getElementById('btn-close-job-card');
    const btnCopyImg = document.getElementById('btn-copy-card-img');

    if (btnClose) {
        btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
    }

    if (btnCopyImg) {
        btnCopyImg.addEventListener('click', copyJobCardAsImage);
    }
}

function openJobCardModal(jobNo) {
    const rec = rawData.find(r => String(r.jobNo) === String(jobNo));
    if (!rec) return;

    document.getElementById('jc-brand-badge').textContent = rec.brand || 'CLASSIC';
    document.getElementById('jc-age-days').textContent = rec.days;
    document.getElementById('jc-technician').textContent = rec.technician || '-';
    document.getElementById('jc-brand').textContent = rec.brand || '-';
    document.getElementById('jc-rcpt-no').textContent = rec.jobNo || '-';
    document.getElementById('jc-user-name').textContent = rec.userName || '-';
    document.getElementById('jc-home-tel').textContent = rec.homeTel || '-';
    document.getElementById('jc-mobile-no').textContent = rec.mobileNo || '-';
    document.getElementById('jc-model-cd').textContent = rec.model || '-';
    document.getElementById('jc-pend-reason').textContent = rec.rawPendReason || rec.pendReason || '-';
    document.getElementById('jc-cust-remark').textContent = rec.customerRemark || '-';
    document.getElementById('jc-rcpt-remark').textContent = rec.receptionRemark || '-';
    document.getElementById('jc-tech-remark').textContent = rec.techRemark || '-';

    const partsTbody = document.getElementById('jc-parts-tbody');
    partsTbody.innerHTML = '';

    const rawPartsList = [
        { no: rec.part1No, status: rec.part1 },
        { no: rec.part2No, status: rec.part2 },
        { no: rec.part3No, status: rec.part3 },
        { no: rec.part4No, status: rec.part4 },
        { no: rec.part5No, status: rec.part5 },
        { no: rec.part6No, status: rec.part6 },
        { no: rec.part7No, status: rec.part7 }
    ];

    const activeParts = rawPartsList.filter(p => (p.no && p.no !== '-' && p.no !== '0') || (p.status && p.status !== '-' && p.status !== '0'));

    if (activeParts.length > 0) {
        activeParts.forEach((p, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="text-center">${idx + 1}</td>
                <td class="bold">${p.no || '-'}</td>
                <td class="text-center"><span class="status-badge status-default">${p.status || '-'}</span></td>
            `;
            partsTbody.appendChild(tr);
        });
    } else {
        partsTbody.innerHTML = '<tr><td colspan="3" class="text-center muted">No parts requested for this job card.</td></tr>';
    }

    const modal = document.getElementById('job-card-modal');
    modal.style.display = 'flex';
}

function copyJobCardAsImage() {
    const cardContainer = document.getElementById('job-card-render-area') || document.getElementById('renderable-job-card');
    if (!cardContainer) return;

    html2canvas(cardContainer, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff'
    }).then(canvas => {
        canvas.toBlob(blob => {
            if (navigator.clipboard && window.ClipboardItem) {
                const item = new ClipboardItem({ 'image/png': blob });
                navigator.clipboard.write([item]).then(() => {
                    alert('Job Card image copied to clipboard!');
                }).catch(err => {
                    console.error('Clipboard copy error: ', err);
                    fallbackSaveImage(canvas, 'Job_Card');
                });
            } else {
                fallbackSaveImage(canvas, 'Job_Card');
            }
        });
    }).catch(err => {
        console.error('Render error: ', err);
        alert('Could not generate Job Card image.');
    });
}

/* USER MANAGEMENT FUNCTIONS */
function initUserManagement() {
    const btnUserMgmt = document.getElementById('btn-user-mgmt');
    const modal = document.getElementById('user-mgmt-modal');
    const btnClose = document.getElementById('btn-close-modal') || document.getElementById('btn-close-user-mgmt');
    const userForm = document.getElementById('user-form');

    if (btnUserMgmt) {
        btnUserMgmt.addEventListener('click', () => {
            renderUserTable();
            modal.style.display = 'flex';
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    if (userForm) {
        userForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('um-username').value.trim();
            const password = document.getElementById('um-password').value.trim();
            const role = document.getElementById('um-role').value;
            const branch = document.getElementById('um-branch').value.trim() || 'ALL';

            if (!username || !password) return;

            const existingIdx = USERS.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
            if (existingIdx !== -1) {
                USERS[existingIdx] = { username, password, role, branch };
            } else {
                USERS.push({ username, password, role, branch });
            }

            userForm.reset();
            renderUserTable();
        });
    }
}

function renderUserTable() {
    const tbody = document.querySelector('#table-users tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    USERS.forEach((u, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="bold">${u.username}</td>
            <td>••••••</td>
            <td>${u.role}</td>
            <td>${u.branch}</td>
            <td class="text-center">
                <button class="btn-icon danger" onclick="deleteUser(${idx})">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteUser(index) {
    if (confirm(`Are you sure you want to delete user "${USERS[index].username}"?`)) {
        USERS.splice(index, 1);
        renderUserTable();
    }
}

/* SCROLL TO TOP FUNCTIONALITY */
function initScrollToTop() {
    const scrollBtn = document.getElementById('scroll-top-btn');
    if (!scrollBtn) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            scrollBtn.classList.add('show');
        } else {
            scrollBtn.classList.remove('show');
        }
    });

    scrollBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}
/* ==========================================================================
   EMAIL GENERATION & CONFIRMATION LOGIC FOR OUTLOOK
   --------------------------------------------------------------------------
   Admin presses "Email" -> confirmation popup -> dashboard sections are
   captured as images -> a ready-to-send Outlook draft (.eml) is created with
   the text + all images embedded in the body. Admin reviews and presses Send.
   ========================================================================== */

// Email Recipient Definitions
const EMAIL_TO = "arun.kumar@classicpvt.com";
const EMAIL_CC = "tahir.ali@classicpvt.com";

// Email body text (single source of truth: used for popup preview and the email itself)
const EMAIL_BODY_PARAGRAPHS = [
    "Dear All,",
    "Check the below Total pending jobs count.",
    "Kindly requesting you all to mandatory apply the Pre-screening and triage for all the jobs and request the parts from the day 1",
    "Use the Pending Job Data Dashboard to check the abnormal pending from your branches."
];
const EMAIL_SIGNATURE = ["Regards,", "Service & Maintenance Dashboard"];

// Sections captured as images, in the order they appear in the email
const EMAIL_CAPTURE_SECTIONS = [
    { selector: '.kpi-grid',                        name: 'Pending Jobs KPI Summary' },
    { selector: '#table-age-branch',                name: 'Age Wise Pending Jobs - Branch Wise' },
    { selector: '#table-age-brand',                 name: 'Age Wise Pending Jobs - Brand Wise' },
    { selector: '#table-pend-reason',               name: 'Pending Reason Summary' },
    { selector: '#table-warranty',                  name: 'Warranty Type Breakdown' },
    { selector: '#table-daily-registration',        name: 'Daily Job Registration' },
    { selector: '#table-daily-closing',             name: 'Daily Job Closing' },
    { selector: '#table-daily-registration-brand',  name: 'Daily Registration (Brand Wise)' },
    { selector: '#table-daily-closing-brand',       name: 'Daily Job Closing (Brand Wise)' },
    { selector: '#regCloseChart',                   name: 'Daily Registration vs Closing' }
];

function getEmailSubject() {
    const total = filteredData ? filteredData.length : 0;
    return `Pending Jobs Alert - Total Pending Jobs: ${total}`;
}

function escapeEmailHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Triggered when the Admin clicks the 'Email' button at the top.
 * Step 1: validate + show the confirmation popup.
 */
function handleSendEmailClick() {
    if (!currentUser || currentUser.role !== 'Admin') {
        alert('Only Admin users can send the pending jobs email.');
        return;
    }
    if (!filteredData || filteredData.length === 0) {
        alert('No pending job data is loaded. Please upload the pending data first.');
        return;
    }
    openEmailConfirmModal();
}

/**
 * Builds and shows the confirmation popup (preview of recipients, subject, text and images).
 */
function openEmailConfirmModal() {
    closeEmailConfirmModal();

    const branchValue = document.getElementById('branch-filter')?.value || 'ALL';
    const branchNote = branchValue !== 'ALL'
        ? `<div class="email-note email-note-warn">Branch filter is set to <strong>${escapeEmailHtml(branchValue)}</strong>. The images will show this filtered view. Select "All Branches" first if you want the full picture.</div>`
        : '';

    const overlay = document.createElement('div');
    overlay.id = 'email-confirm-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-card email-modal-card">
            <div class="modal-header">
                <h3>📧 Send Pending Jobs Email</h3>
                <button type="button" class="btn-close" id="email-modal-close" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="email-meta">
                    <div><span>To</span><strong>${escapeEmailHtml(EMAIL_TO)}</strong></div>
                    <div><span>CC</span><strong>${escapeEmailHtml(EMAIL_CC)}</strong></div>
                    <div><span>Subject</span><strong>${escapeEmailHtml(getEmailSubject())}</strong></div>
                </div>
                ${branchNote}
                <div class="email-preview">
                    ${EMAIL_BODY_PARAGRAPHS.map(p => `<p>${escapeEmailHtml(p)}</p>`).join('')}
                    <p class="email-preview-label">Images attached in the email body (${EMAIL_CAPTURE_SECTIONS.length}):</p>
                    <ol>${EMAIL_CAPTURE_SECTIONS.map(s => `<li>${escapeEmailHtml(s.name)}</li>`).join('')}</ol>
                </div>
                <div class="email-note">After you confirm, the email is created automatically and opens in Outlook with all images inside the body. Review it and press <strong>Send</strong>.</div>
                <div id="email-progress" class="email-progress" style="display:none;">
                    <div class="email-progress-bar"><div id="email-progress-fill"></div></div>
                    <div id="email-progress-text">Preparing...</div>
                </div>
                <div class="email-actions">
                    <button type="button" class="btn-action" id="email-cancel-btn">Cancel</button>
                    <button type="button" class="btn-action email-confirm-btn" id="email-confirm-btn">✔ Confirm &amp; Create Email</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    document.getElementById('email-modal-close').addEventListener('click', closeEmailConfirmModal);
    document.getElementById('email-cancel-btn').addEventListener('click', closeEmailConfirmModal);
    document.getElementById('email-confirm-btn').addEventListener('click', confirmAndCreateEmail);
}

function closeEmailConfirmModal() {
    const el = document.getElementById('email-confirm-modal');
    if (el) el.remove();
}

/**
 * Step 2: after confirmation -> capture images -> build the Outlook draft -> download/open it.
 */
async function confirmAndCreateEmail() {
    const confirmBtn = document.getElementById('email-confirm-btn');
    const cancelBtn = document.getElementById('email-cancel-btn');
    const closeBtn = document.getElementById('email-modal-close');
    const progressBox = document.getElementById('email-progress');
    const fill = document.getElementById('email-progress-fill');
    const text = document.getElementById('email-progress-text');

    if (typeof html2canvas === 'undefined') {
        alert('Screen capture library (html2canvas) failed to load. Please check your internet connection and reload the page.');
        return;
    }

    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    closeBtn.disabled = true;
    progressBox.style.display = 'block';

    try {
        const images = await captureDashboardImagesForEmail((done, total, name) => {
            fill.style.width = `${Math.round((done / total) * 100)}%`;
            text.textContent = done < total
                ? `Capturing ${done + 1} of ${total}: ${name}`
                : 'Building email...';
        });

        if (images.length === 0) {
            throw new Error('No dashboard sections could be captured.');
        }

        const emlBlob = buildOutlookDraftEml(images);
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `Pending_Jobs_Alert_${dateStr}.eml`;

        const link = document.createElement('a');
        link.href = URL.createObjectURL(emlBlob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 60000);

        fill.style.width = '100%';
        text.innerHTML = `✅ Email created (<strong>${images.length}</strong> images). Open the downloaded file <strong>${escapeEmailHtml(fileName)}</strong>: it opens in Outlook, ready to send. Review it and press <strong>Send</strong>.`;
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Close';
        closeBtn.disabled = false;
        confirmBtn.style.display = 'none';
    } catch (err) {
        console.error('Email creation failed:', err);
        alert('Could not create the email: ' + (err.message || err));
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        closeBtn.disabled = false;
        progressBox.style.display = 'none';
    }
}

/**
 * Captures every required dashboard section as a PNG image.
 * Tables are expanded to full height during capture and restored afterwards.
 */
async function captureDashboardImagesForEmail(onProgress) {
    const results = [];
    const total = EMAIL_CAPTURE_SECTIONS.length;
    const scale = 1.5;

    for (let i = 0; i < total; i++) {
        const section = EMAIL_CAPTURE_SECTIONS[i];
        if (onProgress) onProgress(i, total, section.name);

        const el = document.querySelector(section.selector);
        if (!el) { console.warn('Email capture: element not found', section.selector); continue; }

        const container = section.selector === '.kpi-grid'
            ? el
            : (el.closest('.summary-card') || el);

        // Skip sections that are hidden (e.g. admin-only sections not rendered)
        if (container.offsetParent === null && container.getClientRects().length === 0) {
            console.warn('Email capture: element hidden', section.selector);
            continue;
        }

        // Temporarily hide camera buttons and expand scrollable table wrappers
        const hidden = [];
        container.querySelectorAll('.btn-capture-table, .action-col').forEach(b => {
            hidden.push([b, b.style.display]);
            b.style.display = 'none';
        });
        const wrappers = [];
        container.querySelectorAll('.table-wrapper').forEach(w => {
            wrappers.push([w, w.style.maxHeight, w.style.overflow]);
            w.style.maxHeight = 'none';
            w.style.overflow = 'visible';
        });

        try {
            const canvas = await html2canvas(container, {
                scale: scale,
                useCORS: true,
                backgroundColor: '#ffffff',
                scrollX: 0,
                scrollY: -window.scrollY
            });
            results.push({
                name: section.name,
                base64: canvas.toDataURL('image/png').split(',')[1],
                width: Math.round(canvas.width / scale),
                height: Math.round(canvas.height / scale)
            });
        } catch (err) {
            console.warn('Email capture failed for', section.name, err);
        } finally {
            hidden.forEach(([b, d]) => { b.style.display = d; });
            wrappers.forEach(([w, mh, ov]) => { w.style.maxHeight = mh; w.style.overflow = ov; });
        }
    }

    if (onProgress) onProgress(total, total, '');
    return results;
}

/**
 * Builds an unsent Outlook draft (.eml, X-Unsent: 1) with the HTML body and
 * every image embedded inline (cid), so the images appear inside the email body.
 */
function buildOutlookDraftEml(images) {
    const CRLF = '\r\n';
    const boundary = '----=_ClassicDashboard_' + Date.now().toString(16);
    const wrap76 = s => s.replace(/(.{76})/g, '$1' + CRLF);
    const utf8ToBase64 = str => {
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        bytes.forEach(b => { bin += String.fromCharCode(b); });
        return btoa(bin);
    };

    // ---- HTML body ----
    const font = "font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2937;";
    const paragraphs = EMAIL_BODY_PARAGRAPHS
        .map(p => `<p style="${font}margin:0 0 12px 0;">${escapeEmailHtml(p)}</p>`).join('');
    const imageBlocks = images.map((img, i) => {
        const w = Math.min(img.width, 900);
        return `<p style="${font}margin:18px 0 6px 0;"><strong>${i + 1}. ${escapeEmailHtml(img.name)}</strong></p>` +
               `<img src="cid:dash-img-${i}@classic" alt="${escapeEmailHtml(img.name)}" width="${w}" style="width:${w}px;max-width:100%;height:auto;border:1px solid #dfe6e4;">`;
    }).join('');
    const signature = `<p style="${font}margin:24px 0 0 0;">${EMAIL_SIGNATURE.map(escapeEmailHtml).join('<br>')}</p>`;
    const html = `<html><head><meta charset="UTF-8"></head><body>${paragraphs}${imageBlocks}${signature}</body></html>`;

    // ---- MIME ----
    const subjectB64 = '=?UTF-8?B?' + utf8ToBase64(getEmailSubject()) + '?=';
    const lines = [
        `To: ${EMAIL_TO}`,
        `Cc: ${EMAIL_CC}`,
        `Subject: ${subjectB64}`,
        'X-Unsent: 1',
        'MIME-Version: 1.0',
        `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(utf8ToBase64(html))
    ];

    images.forEach((img, i) => {
        const safeName = img.name.replace(/[^A-Za-z0-9]+/g, '_') + '.png';
        lines.push(
            `--${boundary}`,
            `Content-Type: image/png; name="${safeName}"`,
            'Content-Transfer-Encoding: base64',
            `Content-ID: <dash-img-${i}@classic>`,
            `Content-Disposition: inline; filename="${safeName}"`,
            '',
            wrap76(img.base64)
        );
    });
    lines.push(`--${boundary}--`, '');

    return new Blob([lines.join(CRLF)], { type: 'message/rfc822' });
}


/* ==========================================================================
   PERMANENT DATA STORAGE (Netlify Functions + Netlify Blobs)
   - Admin uploads are saved online (replacing the previous file automatically).
   - Every user gets the last Admin-saved data on load / refresh / re-login.
   - A non-Admin upload is used for the current session only.
   ========================================================================== */
const CLOUD_API = '/api/data';
const CLOUD_KEY_STORAGE = 'dashboard_admin_upload_key';
const CLOUD_LABELS = { pending: 'Pending Jobs', registration: 'Registration', closure: 'Closure' };
const cloudInfo = { pending: null, registration: null, closure: null };
let cloudTempNotice = '';   // shown when a non-admin uploads a temporary file
let cloudStatusNotice = ''; // "Saving..." / error messages

function formatCloudTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '-';
    return d.toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    });
}

function renderLastUpdated() {
    const el = document.getElementById('last-updated-info');
    if (!el) return;
    const isAdmin = currentUser && currentUser.role === 'Admin';
    const types = isAdmin ? ['pending', 'registration', 'closure'] : ['pending'];
    let html = '';

    types.forEach(t => {
        const info = cloudInfo[t];
        if (!info) return;
        html += `<span class="lu-item">🕒 ${CLOUD_LABELS[t]} data last updated: <strong>${escapeEmailHtml(formatCloudTime(info.uploadedAt))}</strong>` +
                (info.uploadedBy ? ` by ${escapeEmailHtml(info.uploadedBy)}` : '') + `</span>`;
    });
    if (cloudTempNotice) html += `<span class="lu-temp">${escapeEmailHtml(cloudTempNotice)}</span>`;
    if (cloudStatusNotice) html += `<span class="${cloudStatusNotice.startsWith('⚠') ? 'lu-error' : 'lu-item'}">${escapeEmailHtml(cloudStatusNotice)}</span>`;
    el.innerHTML = html;
}

/** Load the last Admin-saved data for everyone; fall back to the old local default files. */
async function loadDefaultDataFile() {
    cloudTempNotice = '';
    const found = await loadCloudData();
    if (!found) loadLocalDefaultDataFile();
}

async function loadCloudData() {
    try {
        const res = await fetch(CLOUD_API, { cache: 'no-store' });
        if (!res.ok) return false;
        const info = await res.json();
        const isAdmin = currentUser && currentUser.role === 'Admin';
        const types = isAdmin ? ['pending', 'registration', 'closure'] : ['pending'];
        let pendingLoaded = false;

        for (const t of types) {
            if (!info[t]) continue;
            const fileRes = await fetch(`${CLOUD_API}?type=${t}`, { cache: 'no-store' });
            if (!fileRes.ok) continue;
            const blob = await fileRes.blob();
            processUploadedFile(new File([blob], info[t].fileName || `${t}.xlsx`), t);
            cloudInfo[t] = info[t];
            if (t === 'pending') pendingLoaded = true;
        }
        renderLastUpdated();
        return pendingLoaded;
    } catch (err) {
        console.warn('Cloud data not available, using local default file:', err);
        return false;
    }
}

/** Called right after any file upload. Admin -> save online. Others -> temporary only. */
function handleUploadPersistence(file, type) {
    if (currentUser && currentUser.role === 'Admin') {
        saveAdminUploadToCloud(file, type);
    } else {
        cloudTempNotice = 'Showing your uploaded file for this session only. It is not saved and will reset on refresh.';
        renderLastUpdated();
    }
}

function getAdminUploadKey(forcePrompt) {
    let key = forcePrompt ? '' : sessionStorage.getItem(CLOUD_KEY_STORAGE);
    if (!key) {
        key = (prompt('Enter the Admin Upload Key to save this file online for all users:') || '').trim();
        if (key) sessionStorage.setItem(CLOUD_KEY_STORAGE, key);
    }
    return key;
}

async function saveAdminUploadToCloud(file, type) {
    let key = getAdminUploadKey(false);
    if (!key) {
        cloudStatusNotice = '⚠ Not saved online (no Admin Upload Key entered). Visible in this session only.';
        renderLastUpdated();
        return;
    }

    cloudStatusNotice = `Saving ${CLOUD_LABELS[type]} data online...`;
    renderLastUpdated();

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(`${CLOUD_API}?type=${type}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'x-admin-key': key,
                    'x-file-name': encodeURIComponent(file.name),
                    'x-uploaded-by': encodeURIComponent(currentUser.username)
                },
                body: file
            });

            if (res.status === 401) {          // wrong key -> ask once more
                sessionStorage.removeItem(CLOUD_KEY_STORAGE);
                key = getAdminUploadKey(true);
                if (!key) break;
                continue;
            }
            if (!res.ok) {
                let msg = `Server error ${res.status}`;
                try { msg = (await res.json()).error || msg; } catch (e) {}
                throw new Error(msg);
            }

            const saved = await res.json();
            cloudInfo[type] = saved.meta;
            cloudTempNotice = '';
            cloudStatusNotice = `✓ ${CLOUD_LABELS[type]} data saved online`;
            renderLastUpdated();
            setTimeout(() => { cloudStatusNotice = ''; renderLastUpdated(); }, 5000);
            return;
        } catch (err) {
            console.error('Cloud save failed:', err);
            cloudStatusNotice = `⚠ Could not save online (${err.message}). Visible in this session only.`;
            renderLastUpdated();
            return;
        }
    }
    cloudStatusNotice = '⚠ Not saved online (invalid Admin Upload Key). Visible in this session only.';
    renderLastUpdated();
}
