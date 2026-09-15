const state = {
  bins: [], routes: [], schedules: [], vehicles: [], drivers: [], pickups: [],
  scheduleRange: "today", trackingFilter: "all"
};
 
const FILL_ALERT_THRESHOLD = 75;
const FILL_WARN_THRESHOLD = 75;
 
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
 
function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}
function pick(o, ...keys) {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return "";
}
function number(value) {
  const n = Number(String(value ?? 0).replace("%", "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function dateOnly(value) {
  return String(value ?? "").slice(0, 10);
}
function fillStatus(fill) {
  const n = number(fill);
  return n >= FILL_ALERT_THRESHOLD ? "critical" : n >= FILL_WARN_THRESHOLD ? "warning" : "ok";
}
function oracleFillLabel(fill) {
  const n = number(fill);
  if (n >= 90) return "Full";
  if (n >= 75) return "Nearly Full";
  return "Normal";
}
function fillBadge(fill) {
  const label = oracleFillLabel(fill);
  const cls = label === "Full" ? "badge-danger" : label === "Nearly Full" ? "badge-warn" : "badge-ok";
  return `<span class="badge ${cls}">${label}</span>`;
}
function fillBar(fill) {
  const n = Math.max(0, Math.min(100, number(fill)));
  return `<div class="fill-bar-wrap"><div class="fill-bar-track"><div class="fill-bar-fill ${n >= FILL_ALERT_THRESHOLD ? "danger" : n >= FILL_WARN_THRESHOLD ? "warn" : ""}" style="width:${n}%"></div></div><span class="fill-pct">${n}%</span></div>`;
}
function statusBadge(status) {
  const value = String(status || "unknown").toLowerCase();
  const cls = {
    active:"badge-ok", available:"badge-ok", idle:"badge-info", scheduled:"badge-info",
    pending:"badge-info", in_progress:"badge-warn", completed:"badge-ok",
    collected:"badge-ok", skipped:"badge-neutral", failed:"badge-danger",
    cancelled:"badge-neutral"
  }[value] || "badge-neutral";
  return `<span class="badge ${cls}">${esc(value.replaceAll("_", " "))}</span>`;
}
async function api(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    console.error(url, error);
    return null;
  }
}
function post(url, body, method = "POST") {
  return api(url, { method, headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
}
 
function showTab(tabId, element) {
  document.querySelectorAll(".tab-content").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".nav-links li").forEach(x => x.classList.remove("active"));
  $(tabId)?.classList.add("active");
  element?.classList.add("active");
  if (tabId === "dashboard") loadDashboard();
  if (tabId === "bins") fetchBins();
  if (tabId === "routes") fetchRoutes();
  if (tabId === "schedules") { fetchRoutes(true); fetchResources(true); fetchSchedules(); }
  if (tabId === "resources") fetchResources();
  if (tabId === "tracking") { fetchTracking(); fetchAlerts("tracking-alert-feed"); }
  if (tabId === "reports") fetchAllReports();
}
 
async function fetchBins(silent = false) {
  const data = await api("/api/bins");
  if (data) {
    state.bins = normalizeRows(data).map(b => ({
      id: pick(b,"bin_id","BIN_ID","id"),
      type: pick(b,"bin_type","BIN_TYPE","type"),
      area: pick(b,"area_name","AREA_NAME","area"),
      address: pick(b,"location_address","LOCATION_ADDRESS","address"),
      fill: number(pick(b,"fill_level","FILL_LEVEL","current_fill","CURRENT_FILL")),
      status: pick(b,"collection_status","COLLECTION_STATUS","status")
    }));
  }
  if (!silent) renderBinsTable();
}
function renderBinsTable() {
  const search = ($("bin-search")?.value || "").toLowerCase();
  const filter = $("bin-status-filter")?.value || "all";
  let rows = state.bins.filter(b => `${b.id} ${b.area} ${b.address}`.toLowerCase().includes(search));
  if (filter !== "all") {
    rows = rows.filter(b => filter === "collection"
      ? b.fill >= FILL_ALERT_THRESHOLD
      : oracleFillLabel(b.fill) === filter);
  }
  $("bins-count").textContent = state.bins.length;
  $("bins-table-body").innerHTML = rows.length ? rows.map(b => `
    <tr onclick="selectBin('${esc(b.id)}')"><td class="id-cell">${esc(b.id)}</td><td>${esc(b.area)}</td>
    <td>${esc(b.address)}</td><td>${fillBar(b.fill)}</td><td>${fillBadge(b.fill)}</td>
    <td><button class="icon-btn" onclick="event.stopPropagation(); prefillSensorModal('${esc(b.id)}')">↻</button></td></tr>
  `).join("") : `<tr><td colspan="6" class="table-empty">No bins match the current filters.</td></tr>`;
}
function selectBin(id) {
  const b = state.bins.find(x => String(x.id) === String(id));
  if (!b) return;
  $("bin-detail-panel").innerHTML = `<div class="card-header"><div><h3>${esc(b.id)}</h3><p>${esc(b.area)}</p></div>${fillBadge(b.fill)}</div>
    <div class="detail-row"><span>Type</span><span>${esc(b.type || "—")}</span></div>
    <div class="detail-row"><span>Address</span><span>${esc(b.address)}</span></div>
    <div class="detail-row"><span>Fill level</span><span>${b.fill}%</span></div>
    <div class="detail-row"><span>Collection status</span><span>${esc(b.status || "—")}</span></div>
    <button class="btn-primary" style="width:100%;justify-content:center;margin-top:14px" onclick="prefillSensorModal('${esc(b.id)}')">Update sensor reading</button>`;
}
function prefillSensorModal(id) { $("sim-bin-id").value = String(id).replace(/\D/g,"") || id; openModal("updateBinModal"); }
async function submitSensorUpdate() {
  const result = await post("/api/bins/update-sensor", {bin_id:$("sim-bin-id").value, fill_level:$("sim-fill").value});
  if (result) { closeModal("updateBinModal"); await fetchBins(); loadDashboard(); }
}
 
async function fetchRoutes(silent = false) {
  const data = await api("/api/routes");
  if (data) state.routes = normalizeRows(data).map(r => ({
    id:pick(r,"route_id","ROUTE_ID","id"), name:pick(r,"route_name","ROUTE_NAME","name"),
    area:"", start:pick(r,"start_location","START_LOCATION","start"),
    end:pick(r,"end_location","END_LOCATION","end"), bin_count:number(pick(r,"bin_count","BIN_COUNT","total_assigned_bins")),
    status:pick(r,"route_status","ROUTE_STATUS","status") || "active"
  }));
  populateRouteSelect();
  if (!silent) renderRoutesTable();
}
function renderRoutesTable() {
  $("routes-count").textContent = state.routes.length;
  $("routes-table-body").innerHTML = state.routes.length ? state.routes.map(r => `
    <tr onclick="selectRoute('${esc(r.id)}')"><td class="cell-primary">${esc(r.name)}<span class="cell-sub">${esc(r.id)}</span></td>
    <td>${esc(`${r.start || "—"} → ${r.end || "—"}`)}</td><td>${r.bin_count}</td><td>${statusBadge(r.status)}</td>
    <td><button class="icon-btn" onclick="event.stopPropagation();selectRoute('${esc(r.id)}')">→</button></td></tr>`).join("")
    : `<tr><td colspan="5" class="table-empty">No routes created yet.</td></tr>`;
}
async function selectRoute(id) {
  const route = state.routes.find(r => String(r.id) === String(id));
  if (!route) return;
  const stops = await api(`/api/routes/${encodeURIComponent(id)}/sequence`);
  const list = normalizeRows(stops).map((s,i) => `<div class="list-item"><div class="list-item-main"><div class="list-item-icon">${i+1}</div><div><div class="list-item-title">${esc(pick(s,"bin_id","BIN_ID","id"))}</div><div class="list-item-sub">Stop ${i+1}</div></div></div></div>`).join("");
  $("route-detail-panel").innerHTML = `<div class="card-header"><div><h3>${esc(route.name)}</h3><p>${esc(`${route.start || "—"} → ${route.end || "—"}`)}</p></div>${statusBadge(route.status)}</div>
    <div class="detail-row"><span>Bins assigned</span><span>${route.bin_count}</span></div><div style="margin-top:14px">${list || '<div class="detail-empty">No stops assigned yet.</div>'}</div>
    <div class="field" style="margin-top:14px">
      <label for="assign-bin-id">Assign a bin to this route</label>
      <div class="form-row">
        <input type="number" id="assign-bin-id" placeholder="Bin ID">
        <input type="number" id="assign-stop-order" placeholder="Stop #" style="max-width:90px">
      </div>
      <button class="btn-primary" style="width:100%;justify-content:center;margin-top:8px" onclick="submitAssignBin('${esc(route.id)}')">Assign to route</button>
    </div>`;
}
async function submitAssignBin(routeId) {
  const binId = $("assign-bin-id").value, stopOrder = $("assign-stop-order").value;
  if (!binId || !stopOrder) return;
  const result = await post("/api/routes/assign", {route_id: routeId, bin_id: binId, stop_order: stopOrder});
  if (result) { await fetchRoutes(true); renderRoutesTable(); await selectRoute(routeId); }
}
function populateRouteSelect() {
  $("s-route").innerHTML = '<option value="">Select route</option>' + state.routes.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
}
 
async function fetchSchedules(silent=false) {
  const data=await api("/api/schedules");
  if (data) state.schedules=normalizeRows(data).map(s=>({
    id:pick(s,"schedule_id","SCHEDULE_ID","id"), route:pick(s,"route_name","ROUTE_NAME","route"),
    driver:pick(s,"driver_name","DRIVER_NAME","driver"), vehicle:pick(s,"vehicle_reg","VEHICLE_REG","vehicle"),
    date:dateOnly(pick(s,"schedule_date","SCHEDULE_DATE","date")), time:pick(s,"start_time","START_TIME","time"),
    status:pick(s,"schedule_status","SCHEDULE_STATUS","status") || "scheduled"
  }));
  if (!silent) renderSchedulesTable();
}
function renderSchedulesTable() {
  const today=new Date().toISOString().slice(0,10);
  let rows=state.schedules;
  if (state.scheduleRange==="today") rows=rows.filter(s=>s.date===today);
  if (state.scheduleRange==="upcoming") rows=rows.filter(s=>s.date>today);
  $("schedules-table-body").innerHTML=rows.length?rows.map(s=>`<tr><td class="cell-primary">${esc(s.route)}<span class="cell-sub">${esc(s.id)}</span></td><td>${esc(s.driver)}<span class="cell-sub">${esc(s.vehicle)}</span></td><td class="mono">${esc(s.date)} ${esc(s.time)}</td><td>${statusBadge(s.status)}</td></tr>`).join(""):`<tr><td colspan="4" class="table-empty">No schedules in this range.</td></tr>`;
}
function setScheduleRange(range,el){state.scheduleRange=range;document.querySelectorAll("#schedules .chip").forEach(x=>x.classList.remove("active"));el.classList.add("active");renderSchedulesTable();}
 
async function fetchResources(silent=false) {
  const [v,d]=await Promise.all([api("/api/resources/vehicles"),api("/api/resources/drivers")]);
  if(v) state.vehicles=normalizeRows(v).map(x=>({id:pick(x,"vehicle_id","VEHICLE_ID","id"),reg:pick(x,"registration_number","REGISTRATION_NUMBER","registration","reg"),type:pick(x,"vehicle_type","VEHICLE_TYPE","type"),capacity:pick(x,"capacity_kg","CAPACITY_KG","capacity"),status:pick(x,"status","STATUS")||"available"}));
  if(d) {
    // V_Driver_Contact_List LEFT JOINs Driver_Phones, so a driver with
    // more than one phone number comes back as more than one row —
    // collapse those into a single driver entry with a phones list.
    const byId = new Map();
    normalizeRows(d).forEach(x => {
      const id = pick(x,"driver_id","DRIVER_ID","id");
      if (!byId.has(id)) byId.set(id, {id, name:pick(x,"name","NAME"), status:pick(x,"status","STATUS")||"available", phones:[]});
      const phone = pick(x,"phone_number","PHONE_NUMBER");
      if (phone) {
        const type = pick(x,"phone_type","PHONE_TYPE");
        byId.get(id).phones.push(type ? `${phone} (${type})` : phone);
      }
    });
    state.drivers = [...byId.values()];
  }
  populateResourceSelects(); if(!silent){renderFleetList();renderDriverList();}
}
function renderFleetList(){ $("fleet-count").textContent=state.vehicles.length; $("fleet-list").innerHTML=state.vehicles.map(v=>`<div class="list-item"><div class="list-item-main"><div class="list-item-icon">🚛</div><div><div class="list-item-title">${esc(v.reg)}</div><div class="list-item-sub">${esc(v.type)} · ${esc(v.capacity)} kg</div></div></div>${statusBadge(v.status)}</div>`).join("")||'<div class="detail-empty">No vehicles registered yet.</div>'; }
function renderDriverList(){ $("driver-count").textContent=state.drivers.length; $("driver-list").innerHTML=state.drivers.map(d=>`<div class="list-item"><div class="list-item-main"><div class="list-item-icon">🧑‍✈️</div><div><div class="list-item-title">${esc(d.name)}</div><div class="list-item-sub">${d.phones.length?esc(d.phones.join(", ")):`Driver ID ${esc(d.id)}`}</div></div></div><button class="icon-btn" title="Add phone" onclick="prefillPhoneModal('${esc(d.id)}')">+</button>${statusBadge(d.status)}</div>`).join("")||'<div class="detail-empty">No drivers registered yet.</div>'; }
function populateResourceSelects(){ $("s-driver").innerHTML='<option value="">Select driver</option>'+state.drivers.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join(""); $("s-vehicle").innerHTML='<option value="">Select vehicle</option>'+state.vehicles.map(v=>`<option value="${esc(v.id)}">${esc(v.reg)}</option>`).join(""); }
function prefillPhoneModal(driverId){ $("phone-driver-id").value=driverId; $("phone-number").value=""; openModal("addPhoneModal"); }
async function submitAddPhone(){
  const driverId=$("phone-driver-id").value, phone=$("phone-number").value.trim();
  if(!driverId||!phone) return;
  const result=await post("/api/resources/driver-phone",{driver_id:driverId, phone, type:$("phone-type").value});
  if(result){ closeModal("addPhoneModal"); await fetchResources(); }
}
 
async function fetchTracking(silent=false){const data=await api("/api/pickups");if(data)state.pickups=normalizeRows(data).map(p=>({id:pick(p,"pickup_id","PICKUP_ID","id"),schedule:pick(p,"schedule_id","SCHEDULE_ID","schedule"),bin_id:pick(p,"bin_id","BIN_ID"),address:pick(p,"location_address","LOCATION_ADDRESS","address"),fill:number(pick(p,"fill_level","FILL_LEVEL","fill")),status:String(pick(p,"status","STATUS")||"pending").toLowerCase(),reason:pick(p,"reason","REASON"),collection_time:pick(p,"collection_time","COLLECTION_TIME")}));if(!silent)renderTrackingTable();}
function setTrackingFilter(status,el){state.trackingFilter=status;document.querySelectorAll("#tracking .chip").forEach(x=>x.classList.remove("active"));el.classList.add("active");renderTrackingTable();}
function renderTrackingTable(){let rows=state.pickups;if(state.trackingFilter==="pending")rows=rows.filter(p=>p.status==="pending");if(state.trackingFilter==="collected")rows=rows.filter(p=>p.status==="collected");if(state.trackingFilter==="skipped")rows=rows.filter(p=>["skipped","failed"].includes(p.status));$("tracking-table-body").innerHTML=rows.length?rows.map(p=>`<tr><td class="mono">${esc(p.schedule)}</td><td class="id-cell">${esc(p.bin_id)}</td><td>${esc(p.address)}</td><td>${fillBar(p.fill)}</td><td>${statusBadge(p.status)}</td><td>${p.status==="pending"?`<button class="icon-btn" onclick="updatePickupStatus('${esc(p.id)}','collected')">✓</button><button class="icon-btn" onclick="updatePickupStatus('${esc(p.id)}','skipped')">⤫</button>`:"—"}</td></tr>`).join(""):`<tr><td colspan="6" class="table-empty">No pickups match this filter.</td></tr>`;}
async function updatePickupStatus(id,status){const result=await post("/api/pickup/status",{pickup_id:id,status},"PUT");if(result){await fetchTracking();await fetchAlerts("tracking-alert-feed");}}
 
async function fetchAlerts(targetId,limit){let data=await api("/api/alerts");let alerts=normalizeRows(data);if(limit)alerts=alerts.slice(0,limit);$(targetId).innerHTML=alerts.length?alerts.map(a=>`<div class="alert-item warn"><div><strong>Pickup ${esc(pick(a,"pickup_id","PICKUP_ID"))}: ${esc(pick(a,"status","STATUS"))}</strong><p>Bin ${esc(pick(a,"bin_id","BIN_ID"))} · ${esc(pick(a,"location_address","LOCATION_ADDRESS"))}${pick(a,"reason","REASON")?` · ${esc(pick(a,"reason","REASON"))}`:""}</p></div></div>`).join(""):'<div class="detail-empty">No unsuccessful pickups.</div>'; }
 
async function report(endpoint, selector, cols, template){const data=await api(endpoint);const rows=normalizeRows(data);fillReportBody(selector,rows,cols,template);}
function fillReportBody(selector,rows,span,template){const body=document.querySelector(`${selector} tbody`);if(body)body.innerHTML=rows.length?rows.map(template).join(""):`<tr><td colspan="${span}" class="table-empty">No data available.</td></tr>`;}
async function fetchAllReports(){await report("/api/reports/needs-collection","#report-needs-collection",3,r=>`<tr><td>${esc(pick(r,"bin_id","BIN_ID"))}</td><td>${esc(pick(r,"area_name","AREA_NAME"))}</td><td>${esc(pick(r,"current_fill","CURRENT_FILL"))}</td></tr>`);await report("/api/reports/efficiency","#efficiency-report",2,r=>`<tr><td>${esc(pick(r,"schedule_id","SCHEDULE_ID"))}</td><td>${esc(pick(r,"success_rate","SUCCESS_RATE"))}</td></tr>`);await report("/api/reports/problematic-bins","#problematic-report",2,r=>`<tr><td>${esc(pick(r,"bin_id","BIN_ID"))}</td><td>${esc(pick(r,"overflow_incidents","OVERFLOW_INCIDENTS"))}</td></tr>`);await report("/api/reports/route-workload","#route-bincount-report",2,r=>`<tr><td>${esc(pick(r,"route_name","ROUTE_NAME"))}</td><td>${esc(pick(r,"total_assigned_bins","TOTAL_ASSIGNED_BINS"))}</td></tr>`);await report("/api/reports/daily-schedule","#daily-schedule-report",5,r=>`<tr><td>${esc(pick(r,"schedule_id","SCHEDULE_ID"))}</td><td>${esc(pick(r,"route_name","ROUTE_NAME"))}</td><td>${esc(pick(r,"vehicle_reg","VEHICLE_REG"))}</td><td>${esc(pick(r,"driver_name","DRIVER_NAME"))}</td><td>${esc(pick(r,"schedule_status","SCHEDULE_STATUS"))}</td></tr>`);await report("/api/reports/area-analysis","#area-analysis-report",3,r=>`<tr><td>${esc(pick(r,"area_name","AREA_NAME"))}</td><td>${esc(pick(r,"number_of_bins","NUMBER_OF_BINS"))}</td><td>${esc(pick(r,"avg_fill_pct","AVG_FILL_PCT"))}</td></tr>`);}
 
async function loadDashboard(){await fetchBins(true);$("stat-total-bins").textContent=state.bins.length;$("stat-critical-bins").textContent=state.bins.filter(b=>b.fill>=FILL_ALERT_THRESHOLD).length;$("stat-avg-fill").textContent=(state.bins.length?Math.round(state.bins.reduce((a,b)=>a+b.fill,0)/state.bins.length):0)+"%";await fetchSchedules(true);const today=new Date().toISOString().slice(0,10);$("stat-active-routes").textContent=state.schedules.filter(s=>s.date===today).length;const top=[...state.bins].sort((a,b)=>b.fill-a.fill).slice(0,5);$("dash-needs-collection-body").innerHTML=top.map(b=>`<tr><td>${esc(b.id)}</td><td>${esc(b.area)}</td><td>${fillBar(b.fill)}</td><td>${fillBadge(b.fill)}</td></tr>`).join("")||'<tr><td colspan="4" class="table-empty">No bins available.</td></tr>';await fetchAlerts("dash-alert-feed",4);}
function openModal(id){$(id).classList.add("open")}function closeModal(id){$(id).classList.remove("open")}
document.addEventListener("DOMContentLoaded",()=>{ $("scheduleForm")?.addEventListener("submit",async e=>{e.preventDefault();const r=await post("/api/schedules",{route_id:$("s-route").value,driver_id:$("s-driver").value,vehicle_id:$("s-vehicle").value,date:$("s-date").value,time:$("s-time").value});if(r){e.target.reset();fetchSchedules();}});$("vehicleForm")?.addEventListener("submit",async e=>{e.preventDefault();const r=await post("/api/register/vehicle",{registration:$("v-reg").value,type:$("v-type").value,capacity:$("v-cap").value});if(r){e.target.reset();fetchResources();}});$("driverForm")?.addEventListener("submit",async e=>{e.preventDefault();const r=await post("/api/register/driver",{name:$("d-name").value});if(r){e.target.reset();fetchResources();}});document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("open")}));loadDashboard();});
