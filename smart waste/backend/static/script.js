// ==========================================================

// SmartWaste — Operations Platform

// Frontend logic for all six workflow sections.

//

// Every section calls a real API endpoint first. If the endpoint

// isn't available yet (e.g. while the backend is still being wired

// up), a small demo dataset renders instead so the interface can be

// reviewed on its own. Look for "DEMO FALLBACK" comments — swap in

// your live data and the fallback is never used.

// ==========================================================

 

const FILL_ALERT_THRESHOLD = 85;

const FILL_WARN_THRESHOLD = 60;

 

let state = {

    bins: [],

    routes: [],

    schedules: [],

    vehicles: [],

    drivers: [],

    pickups: [],

    alerts: [],

    scheduleRange: 'today',

    trackingFilter: 'all',

};

 

// ==========================================================

// 1. NAVIGATION

// ==========================================================

function showTab(tabId, el) {

    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));

 

    document.getElementById(tabId).classList.add('active');

    if (el) el.classList.add('active');

 

    if (tabId === 'dashboard') loadDashboard();

    if (tabId === 'bins') fetchBins();

    if (tabId === 'routes') fetchRoutes();

    if (tabId === 'schedules') { fetchRoutes(true); fetchResources(true); fetchSchedules(); }

    if (tabId === 'resources') fetchResources();

    if (tabId === 'tracking') { fetchTracking(); fetchAlerts('tracking-alert-feed'); }

    if (tabId === 'reports') fetchAllReports();

}

 

// ==========================================================

// Helpers: status vocabulary shared across every section

// ==========================================================

function fillStatus(pct) {

    if (pct >= FILL_ALERT_THRESHOLD) return 'critical';

    if (pct >= FILL_WARN_THRESHOLD) return 'warning';

    return 'ok';

}

 

function fillBadge(pct) {

    const s = fillStatus(pct);

    if (s === 'critical') return `<span class="badge badge-danger">Needs collection</span>`;

    if (s === 'warning') return `<span class="badge badge-warn">Approaching full</span>`;

    return `<span class="badge badge-ok">Ok</span>`;

}

 

function fillBar(pct) {

    const s = fillStatus(pct);

    const cls = s === 'critical' ? 'danger' : s === 'warning' ? 'warn' : '';

    return `

        <div class="fill-bar-wrap">

            <div class="fill-bar-track"><div class="fill-bar-fill ${cls}" style="width:${pct}%"></div></div>

            <span class="fill-pct">${pct}%</span>

        </div>`;

}

 

function statusBadge(status) {

    const map = {

        scheduled: 'badge-info', pending: 'badge-info', in_progress: 'badge-warn',

        completed: 'badge-ok', collected: 'badge-ok', active: 'badge-ok',

        skipped: 'badge-neutral', failed: 'badge-danger', overdue: 'badge-danger',

        cancelled: 'badge-neutral',

    };

    const cls = map[status] || 'badge-neutral';

    const label = (status || 'unknown').replace(/_/g, ' ');

    return `<span class="badge ${cls}">${label.charAt(0).toUpperCase() + label.slice(1)}</span>`;

}

 

async function tryFetchJSON(url, opts) {

    try {

        const res = await fetch(url, opts);

        if (!res.ok) throw new Error('Request failed: ' + res.status);

        return await res.json();

    } catch (err) {

        return null; // caller falls back to demo data

    }

}

 

// ==========================================================

// 2. DASHBOARD

// ==========================================================

async function loadDashboard() {

    await fetchBins(true);

    const critical = state.bins.filter(b => fillStatus(b.fill) === 'critical');

    const avg = state.bins.length

        ? Math.round(state.bins.reduce((s, b) => s + b.fill, 0) / state.bins.length)

        : 0;

 

    document.getElementById('stat-total-bins').textContent = state.bins.length;

    document.getElementById('stat-critical-bins').textContent = critical.length;

    document.getElementById('stat-avg-fill').textContent = avg + '%';

 

    await fetchSchedules(true);

    const today = new Date().toISOString().slice(0, 10);

    const todaysSchedules = state.schedules.filter(s => s.date === today);

    document.getElementById('stat-active-routes').textContent = todaysSchedules.length;

 

    const body = document.getElementById('dash-needs-collection-body');

    const top = [...state.bins].sort((a, b) => b.fill - a.fill).slice(0, 5);

    body.innerHTML = top.length ? top.map(b => `

        <tr>

            <td class="cell-primary">${b.id}</td>

            <td>${b.area}</td>

            <td>${fillBar(b.fill)}</td>

            <td>${fillBadge(b.fill)}</td>

        </tr>

    `).join('') : `<tr><td colspan="4" class="table-empty">No bins registered yet.</td></tr>`;

 

    await fetchAlerts('dash-alert-feed', 4);

}

 

// ==========================================================

// 3. BIN MONITORING (Module 01)

// ==========================================================

async function fetchBins(silent) {

    const data = await tryFetchJSON('/api/reports/needs-collection');

    if (data) {

        state.bins = data.map(b => ({

            id: b.BIN_ID, area: b.AREA_NAME, address: b.LOCATION_ADDRESS,

            fill: Number(b.CURRENT_FILL), status: b.ALERT_STATUS,

        }));

    } else if (!state.bins.length) {

        // DEMO FALLBACK — replace by wiring /api/reports/needs-collection

        state.bins = [

            { id: 'BIN-014', area: 'Market Road', address: '14 Market Road, near bus stand', fill: 92 },

            { id: 'BIN-027', area: 'Lakeview Colony', address: '2nd Cross, Lakeview Colony', fill: 78 },

            { id: 'BIN-003', area: 'Temple Street', address: 'Opp. Temple Street entrance', fill: 41 },

            { id: 'BIN-041', area: 'Industrial Estate', address: 'Gate 3, Industrial Estate', fill: 88 },

            { id: 'BIN-009', area: 'Market Road', address: '9 Market Road', fill: 22 },

        ];

    }

    if (!silent) renderBinsTable();

}

 

function renderBinsTable() {

    const search = (document.getElementById('bin-search')?.value || '').toLowerCase();

    const filter = document.getElementById('bin-status-filter')?.value || 'all';

 

    let rows = state.bins.filter(b =>

        (b.id + b.area + b.address).toLowerCase().includes(search)

    );

    if (filter !== 'all') rows = rows.filter(b => fillStatus(b.fill) === filter);

 

    document.getElementById('bins-count').textContent = state.bins.length;

    const body = document.getElementById('bins-table-body');

    body.innerHTML = rows.length ? rows.map(b => `

        <tr onclick="selectBin('${b.id}')">

            <td class="id-cell">${b.id}</td>

            <td>${b.area}</td>

            <td>${b.address}</td>

            <td>${fillBar(b.fill)}</td>

            <td>${fillBadge(b.fill)}</td>

            <td class="row-actions">

                <button class="icon-btn" onclick="event.stopPropagation(); prefillSensorModal('${b.id}')" title="Update reading">↻</button>

            </td>

        </tr>

    `).join('') : `<tr><td colspan="6" class="table-empty">No bins match the current filters.</td></tr>`;

}

 

function selectBin(id) {

    const bin = state.bins.find(b => b.id === id);

    const panel = document.getElementById('bin-detail-panel');

    if (!bin) return;

    panel.innerHTML = `

        <div class="card-header"><div><h3>${bin.id}</h3><p>${bin.area}</p></div>${fillBadge(bin.fill)}</div>

        <div class="detail-row"><span>Address</span><span>${bin.address}</span></div>

        <div class="detail-row"><span>Fill level</span><span>${bin.fill}%</span></div>

        <div class="detail-row"><span>Status</span><span>${fillStatus(bin.fill)}</span></div>

        <div class="detail-row"><span>Last reading</span><span>Just now (demo)</span></div>

        <button class="btn-primary" style="width:100%; justify-content:center; margin-top:14px;" onclick="prefillSensorModal('${bin.id}')">Update sensor reading</button>

    `;

}

 

function prefillSensorModal(binId) {

    const numeric = (binId.match(/\d+/) || [''])[0];

    document.getElementById('sim-bin-id').value = numeric;

    openModal('updateBinModal');

}

 

async function submitSensorUpdate() {

    const binId = document.getElementById('sim-bin-id').value;

    const fillLevel = document.getElementById('sim-fill').value;

 

    const result = await tryFetchJSON('/api/bins/update-sensor', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ bin_id: binId, fill_level: fillLevel }),

    });

 

    closeModal('updateBinModal');

    fetchBins();

    if (!result) {

        // Reflect the change locally so the demo stays usable offline

        const match = state.bins.find(b => b.id.includes(binId));

        if (match) { match.fill = Number(fillLevel); renderBinsTable(); }

    }

}

 

async function submitRegisterBin() {

    const area = document.getElementById('new-bin-area').value;

    const address = document.getElementById('new-bin-address').value;

    const capacity = document.getElementById('new-bin-capacity').value;

    if (!area || !address) return;

 

    await tryFetchJSON('/api/bins/register', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ area, address, capacity }),

    });

 

    closeModal('registerBinModal');

    fetchBins();

}

 

// ==========================================================

// 4. ROUTES (Module 02)

// ==========================================================

async function fetchRoutes(silent) {

    const data = await tryFetchJSON('/api/routes');

    if (data) {

        state.routes = data;

    } else if (!state.routes.length) {

        // DEMO FALLBACK — replace by wiring GET /api/routes

        state.routes = [

            { id: 'RT-01', name: 'Market Road Loop', area: 'Market Road', bin_count: 12, status: 'active',

              stops: ['BIN-009', 'BIN-014', 'BIN-002'] },

            { id: 'RT-02', name: 'Lakeview Morning', area: 'Lakeview Colony', bin_count: 8, status: 'active',

              stops: ['BIN-027', 'BIN-031'] },

            { id: 'RT-03', name: 'Industrial Estate Circuit', area: 'Industrial Estate', bin_count: 15, status: 'inactive',

              stops: ['BIN-041', 'BIN-045', 'BIN-048'] },

        ];

    }

    if (!silent) renderRoutesTable();

    populateRouteSelect();

}

 

function renderRoutesTable() {

    document.getElementById('routes-count').textContent = state.routes.length;

    const body = document.getElementById('routes-table-body');

    body.innerHTML = state.routes.length ? state.routes.map(r => `

        <tr onclick="selectRoute('${r.id}')">

            <td class="cell-primary">${r.name}<span class="cell-sub">${r.id}</span></td>

            <td>${r.area}</td>

            <td>${r.bin_count}</td>

            <td>${statusBadge(r.status)}</td>

            <td class="row-actions"><button class="icon-btn" onclick="event.stopPropagation(); selectRoute('${r.id}')" title="View stops">→</button></td>

        </tr>

    `).join('') : `<tr><td colspan="5" class="table-empty">No routes created yet.</td></tr>`;

}

 

function selectRoute(id) {

    const route = state.routes.find(r => r.id === id);

    const panel = document.getElementById('route-detail-panel');

    if (!route) return;

    panel.innerHTML = `

        <div class="card-header"><div><h3>${route.name}</h3><p>${route.area}</p></div>${statusBadge(route.status)}</div>

        <div class="detail-row"><span>Bins assigned</span><span>${route.bin_count}</span></div>

        <div style="margin-top:14px;">

            ${(route.stops || []).map((s, i) => `

                <div class="list-item" style="margin-bottom:8px;">

                    <div class="list-item-main">

                        <div class="list-item-icon">${i + 1}</div>

                        <div><div class="list-item-title">${s}</div><div class="list-item-sub">Stop ${i + 1}</div></div>

                    </div>

                </div>

            `).join('') || '<div class="detail-empty">No stops assigned yet.</div>'}

        </div>

    `;

}

 

function populateRouteSelect() {

    const sel = document.getElementById('s-route');

    if (!sel) return;

    const current = sel.value;

    sel.innerHTML = '<option value="">Select route</option>' +

        state.routes.map(r => `<option value="${r.id}">${r.name} (${r.area})</option>`).join('');

    sel.value = current;

}

 

async function submitCreateRoute() {

    const name = document.getElementById('new-route-name').value;

    const area = document.getElementById('new-route-area').value;

    if (!name || !area) return;

 

    await tryFetchJSON('/api/routes', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ name, area }),

    });

 

    closeModal('createRouteModal');

    fetchRoutes();

}

 

// ==========================================================

// 5. SCHEDULING (Module 03)

// ==========================================================

async function fetchSchedules(silent) {

    const data = await tryFetchJSON('/api/schedules');

    if (data) {

        state.schedules = data;

    } else if (!state.schedules.length) {

        const today = new Date().toISOString().slice(0, 10);

        // DEMO FALLBACK — replace by wiring GET /api/schedules

        state.schedules = [

            { id: 'SCH-101', route: 'Market Road Loop', driver: 'R. Menon', vehicle: 'KL-01-AB-1234', date: today, status: 'in_progress' },

            { id: 'SCH-102', route: 'Lakeview Morning', driver: 'S. Nair', vehicle: 'KL-01-CD-5678', date: today, status: 'scheduled' },

            { id: 'SCH-098', route: 'Industrial Estate Circuit', driver: 'A. Pillai', vehicle: 'KL-01-EF-9012', date: '2026-09-12', status: 'completed' },

        ];

    }

    if (!silent) renderSchedulesTable();

}

 

function setScheduleRange(range, el) {

    state.scheduleRange = range;

    document.querySelectorAll('#schedules .chip').forEach(c => c.classList.remove('active'));

    el.classList.add('active');

    renderSchedulesTable();

}

 

function renderSchedulesTable() {

    const today = new Date().toISOString().slice(0, 10);

    let rows = state.schedules;

    if (state.scheduleRange === 'today') rows = rows.filter(s => s.date === today);

    if (state.scheduleRange === 'upcoming') rows = rows.filter(s => s.date > today);

 

    const body = document.getElementById('schedules-table-body');

    body.innerHTML = rows.length ? rows.map(s => `

        <tr>

            <td class="cell-primary">${s.route}<span class="cell-sub">${s.id}</span></td>

            <td>${s.driver}<span class="cell-sub">${s.vehicle}</span></td>

            <td class="mono">${s.date}</td>

            <td>${statusBadge(s.status)}</td>

        </tr>

    `).join('') : `<tr><td colspan="4" class="table-empty">No schedules in this range.</td></tr>`;

}

 

document.addEventListener('DOMContentLoaded', () => {

    const form = document.getElementById('scheduleForm');

    if (form) {

        form.onsubmit = async (e) => {

            e.preventDefault();

            const payload = {

                route_id: document.getElementById('s-route').value,

                driver_id: document.getElementById('s-driver').value,

                vehicle_id: document.getElementById('s-vehicle').value,

                date: document.getElementById('s-date').value,

                time: document.getElementById('s-time').value,

            };

            await tryFetchJSON('/api/schedules', {

                method: 'POST',

                headers: { 'Content-Type': 'application/json' },

                body: JSON.stringify(payload),

            });

            form.reset();

            fetchSchedules();

        };

    }

});

 

// ==========================================================

// 6. DRIVERS & VEHICLES (Module 04)

// ==========================================================

async function fetchResources(silent) {

    const [vehiclesData, driversData] = await Promise.all([

        tryFetchJSON('/api/resources/vehicles'),

        tryFetchJSON('/api/resources/drivers'),

    ]);

 

    if (vehiclesData) {

        state.vehicles = vehiclesData;

    } else if (!state.vehicles.length) {

        // DEMO FALLBACK — replace by wiring GET /api/resources/vehicles

        state.vehicles = [

            { id: 'V-1', reg: 'KL-01-AB-1234', type: 'Compactor', capacity: 5000, status: 'active' },

            { id: 'V-2', reg: 'KL-01-CD-5678', type: 'Tipper', capacity: 3000, status: 'active' },

            { id: 'V-3', reg: 'KL-01-EF-9012', type: 'Compactor', capacity: 5000, status: 'idle' },

        ];

    }

 

    if (driversData) {

        state.drivers = driversData;

    } else if (!state.drivers.length) {

        // DEMO FALLBACK — replace by wiring GET /api/resources/drivers

        state.drivers = [

            { id: 'D-1', name: 'R. Menon', license: 'KL-DL-2291', status: 'on_route' },

            { id: 'D-2', name: 'S. Nair', license: 'KL-DL-4482', status: 'available' },

            { id: 'D-3', name: 'A. Pillai', license: 'KL-DL-7723', status: 'available' },

        ];

    }

 

    if (!silent) { renderFleetList(); renderDriverList(); }

    populateResourceSelects();

}

 

function renderFleetList() {

    document.getElementById('fleet-count').textContent = state.vehicles.length;

    const el = document.getElementById('fleet-list');

    el.innerHTML = state.vehicles.length ? state.vehicles.map(v => `

        <div class="list-item">

            <div class="list-item-main">

                <div class="list-item-icon">🚛</div>

                <div>

                    <div class="list-item-title">${v.reg}</div>

                    <div class="list-item-sub">${v.type} · ${v.capacity} kg capacity</div>

                </div>

            </div>

            ${statusBadge(v.status)}

        </div>

    `).join('') : `<div class="detail-empty">No vehicles registered yet.</div>`;

}

 

function renderDriverList() {

    document.getElementById('driver-count').textContent = state.drivers.length;

    const el = document.getElementById('driver-list');

    el.innerHTML = state.drivers.length ? state.drivers.map(d => `

        <div class="list-item">

            <div class="list-item-main">

                <div class="list-item-icon">🧑‍✈️</div>

                <div>

                    <div class="list-item-title">${d.name}</div>

                    <div class="list-item-sub">License ${d.license}</div>

                </div>

            </div>

            ${statusBadge(d.status)}

        </div>

    `).join('') : `<div class="detail-empty">No drivers registered yet.</div>`;

}

 

function populateResourceSelects() {

    const driverSel = document.getElementById('s-driver');

    const vehicleSel = document.getElementById('s-vehicle');

    if (driverSel) {

        driverSel.innerHTML = '<option value="">Select driver</option>' +

            state.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');

    }

    if (vehicleSel) {

        vehicleSel.innerHTML = '<option value="">Select vehicle</option>' +

            state.vehicles.map(v => `<option value="${v.id}">${v.reg} (${v.type})</option>`).join('');

    }

}

 

document.addEventListener('DOMContentLoaded', () => {

    const vForm = document.getElementById('vehicleForm');

    if (vForm) {

        vForm.onsubmit = async (e) => {

            e.preventDefault();

            const payload = {

                registration: document.getElementById('v-reg').value,

                type: document.getElementById('v-type').value,

                capacity: document.getElementById('v-cap').value,

            };

            await tryFetchJSON('/api/register/vehicle', {

                method: 'POST',

                headers: { 'Content-Type': 'application/json' },

                body: JSON.stringify(payload),

            });

            vForm.reset();

            fetchResources();

        };

    }

 

    const dForm = document.getElementById('driverForm');

    if (dForm) {

        dForm.onsubmit = async (e) => {

            e.preventDefault();

            const payload = {

                name: document.getElementById('d-name').value,

                license: document.getElementById('d-license').value,

            };

            await tryFetchJSON('/api/register/driver', {

                method: 'POST',

                headers: { 'Content-Type': 'application/json' },

                body: JSON.stringify(payload),

            });

            dForm.reset();

            fetchResources();

        };

    }

});

 

// ==========================================================

// 7. PICKUP TRACKING & ALERTS (Module 05)

// ==========================================================

async function fetchTracking(silent) {

    const data = await tryFetchJSON('/api/pickups/today');

    if (data) {

        state.pickups = data;

    } else if (!state.pickups.length) {

        // DEMO FALLBACK — replace by wiring GET /api/pickups/today

        state.pickups = [

            { pickup_id: 'PU-501', schedule: 'SCH-101', bin_id: 'BIN-014', address: '14 Market Road', fill: 92, status: 'pending' },

            { pickup_id: 'PU-502', schedule: 'SCH-101', bin_id: 'BIN-009', address: '9 Market Road', fill: 22, status: 'collected' },

            { pickup_id: 'PU-503', schedule: 'SCH-102', bin_id: 'BIN-027', address: '2nd Cross, Lakeview Colony', fill: 78, status: 'pending' },

            { pickup_id: 'PU-504', schedule: 'SCH-098', bin_id: 'BIN-041', address: 'Gate 3, Industrial Estate', fill: 88, status: 'failed' },

        ];

    }

    if (!silent) renderTrackingTable();

}

 

function setTrackingFilter(status, el) {

    state.trackingFilter = status;

    document.querySelectorAll('#tracking .chip').forEach(c => c.classList.remove('active'));

    el.classList.add('active');

    renderTrackingTable();

}

 

function renderTrackingTable() {

    let rows = state.pickups;

    if (state.trackingFilter === 'pending') rows = rows.filter(p => p.status === 'pending');

    if (state.trackingFilter === 'collected') rows = rows.filter(p => p.status === 'collected');

    if (state.trackingFilter === 'skipped') rows = rows.filter(p => p.status === 'skipped' || p.status === 'failed');

 

    const body = document.getElementById('tracking-table-body');

    body.innerHTML = rows.length ? rows.map(p => `

        <tr>

            <td class="mono">${p.schedule}</td>

            <td class="id-cell">${p.bin_id}</td>

            <td>${p.address}</td>

            <td>${fillBar(p.fill)}</td>

            <td>${statusBadge(p.status)}</td>

            <td class="row-actions">

                ${p.status === 'pending' ? `

                    <button class="icon-btn" title="Mark collected" onclick="updatePickupStatus('${p.pickup_id}', 'collected')">✓</button>

                    <button class="icon-btn" title="Mark skipped" onclick="updatePickupStatus('${p.pickup_id}', 'skipped')">⤫</button>

                ` : `<span class="cell-sub">No action needed</span>`}

            </td>

        </tr>

    `).join('') : `<tr><td colspan="6" class="table-empty">No pickups match this filter.</td></tr>`;

}

 

async function updatePickupStatus(pickupId, status) {

    await tryFetchJSON('/api/pickup/status', {

        method: 'PUT',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ pickup_id: pickupId, status: status }),

    });

 

    const match = state.pickups.find(p => p.pickup_id === pickupId);

    if (match) match.status = status;

    renderTrackingTable();

    fetchAlerts('tracking-alert-feed');

}

 

async function fetchAlerts(targetId, limit) {

    const data = await tryFetchJSON('/api/alerts');

    let alerts = data;

    if (!alerts) {

        // DEMO FALLBACK — replace by wiring GET /api/alerts

        alerts = [

            { level: 'danger', title: 'Overflow: BIN-014', detail: 'Fill level at 92%, above threshold for 3 hours.', time: '10 min ago' },

            { level: 'warn', title: 'Overdue pickup: SCH-098', detail: 'Scheduled collection is 1 day past due.', time: '2 hr ago' },

            { level: 'info', title: 'Missed pickup: BIN-041', detail: 'Marked failed — vehicle access blocked.', time: 'Yesterday' },

        ];

    }

    if (limit) alerts = alerts.slice(0, limit);

 

    const el = document.getElementById(targetId);

    if (!el) return;

    el.innerHTML = alerts.length ? alerts.map(a => `

        <div class="alert-item ${a.level}">

            <div>

                <strong>${a.title}</strong>

                <p>${a.detail}</p>

            </div>

            <time>${a.time}</time>

        </div>

    `).join('') : `<div class="detail-empty">No active alerts.</div>`;

}

 

// ==========================================================

// 8. REPORTS (Module 06)

// ==========================================================

async function fetchAllReports() {

    await fetchEfficiencyReport();

    await fetchProblematicBinsReport();

    await fetchNeedsCollectionReport();

    await fetchRouteBinCountReport();

    await fetchVehicleUtilizationReport();

    await fetchDriverWorkloadReport();

    await fetchMissedCollectionsReport();

    await fetchAreaWasteReport();

}

 

function fillReportBody(selector, rows, emptyColspan, rowTemplate) {

    const body = document.querySelector(selector + ' tbody');

    if (!body) return;

    body.innerHTML = rows.length ? rows.map(rowTemplate).join('')

        : `<tr><td colspan="${emptyColspan}" class="table-empty">No data available.</td></tr>`;

}

 

async function fetchNeedsCollectionReport() {

    await fetchBins(true);

    fillReportBody('#report-needs-collection', state.bins, 3, b => `

        <tr><td class="id-cell">${b.id}</td><td>${b.area}</td><td>${fillBar(b.fill)}</td></tr>

    `);

}

 

async function fetchEfficiencyReport() {

    const data = await tryFetchJSON('/api/reports/efficiency');

    const rows = data || [

        { SCHEDULE_ID: 'SCH-101', SUCCESS_RATE: '96%' },

        { SCHEDULE_ID: 'SCH-102', SUCCESS_RATE: '88%' },

        { SCHEDULE_ID: 'SCH-098', SUCCESS_RATE: '74%' },

    ];

    fillReportBody('#efficiency-report', rows, 2, e => `<tr><td class="mono">${e.SCHEDULE_ID}</td><td>${e.SUCCESS_RATE}</td></tr>`);

}

 

async function fetchProblematicBinsReport() {

    const data = await tryFetchJSON('/api/reports/problematic-bins');

    const rows = data || [

        { BIN_ID: 'BIN-014', OVERFLOW_COUNT: 7 },

        { BIN_ID: 'BIN-041', OVERFLOW_COUNT: 5 },

        { BIN_ID: 'BIN-027', OVERFLOW_COUNT: 3 },

    ];

    fillReportBody('#problematic-report', rows, 2, p => `<tr><td class="id-cell">${p.BIN_ID}</td><td>${p.OVERFLOW_COUNT} times</td></tr>`);

}

 

async function fetchRouteBinCountReport() {

    const data = await tryFetchJSON('/api/reports/route-bin-count');

    await fetchRoutes(true);

    const rows = data || state.routes.map(r => ({ route: r.name, bins: r.bin_count }));

    fillReportBody('#route-bincount-report', rows, 2, r => `<tr><td>${r.route}</td><td>${r.bins}</td></tr>`);

}

 

async function fetchVehicleUtilizationReport() {

    const data = await tryFetchJSON('/api/reports/vehicle-utilization');

    const rows = data || [

        { vehicle: 'KL-01-AB-1234', trips: 18 },

        { vehicle: 'KL-01-CD-5678', trips: 14 },

        { vehicle: 'KL-01-EF-9012', trips: 9 },

    ];

    fillReportBody('#vehicle-utilization-report', rows, 2, v => `<tr><td class="mono">${v.vehicle}</td><td>${v.trips}</td></tr>`);

}

 

async function fetchDriverWorkloadReport() {

    const data = await tryFetchJSON('/api/reports/driver-workload');

    const rows = data || [

        { driver: 'R. Menon', schedules: 21 },

        { driver: 'S. Nair', schedules: 17 },

        { driver: 'A. Pillai', schedules: 12 },

    ];

    fillReportBody('#driver-workload-report', rows, 2, d => `<tr><td>${d.driver}</td><td>${d.schedules}</td></tr>`);

}

 

async function fetchMissedCollectionsReport() {

    const data = await tryFetchJSON('/api/reports/missed-collections');

    const rows = data || [

        { bin: 'BIN-041', date: '2026-09-12', reason: 'Vehicle access blocked' },

        { bin: 'BIN-018', date: '2026-09-10', reason: 'Marked skipped by driver' },

    ];

    fillReportBody('#missed-collections-report', rows, 3, m => `<tr><td class="id-cell">${m.bin}</td><td class="mono">${m.date}</td><td>${m.reason}</td></tr>`);

}

 

async function fetchAreaWasteReport() {

    const data = await tryFetchJSON('/api/reports/area-waste-generation');

    const rows = data || [

        { area: 'Market Road', volume: 3120 },

        { area: 'Lakeview Colony', volume: 2450 },

        { area: 'Industrial Estate', volume: 4890 },

    ];

    fillReportBody('#area-waste-report', rows, 2, a => `<tr><td>${a.area}</td><td>${a.volume.toLocaleString()}</td></tr>`);

}

 

// ==========================================================

// 9. MODALS

// ==========================================================

function openModal(id) { document.getElementById(id).classList.add('open'); }

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

 

document.addEventListener('click', (e) => {

    if (e.target.classList.contains('modal')) e.target.classList.remove('open');

});

 

// ==========================================================

// Initial load

// ==========================================================

window.onload = () => {

    loadDashboard();

};

