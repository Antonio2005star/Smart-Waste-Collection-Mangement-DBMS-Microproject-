let allBins = [];
let selectedRouteId = null;


// ============================================================
// PAGE LOAD
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    fetchDashboard();
    fetchBins();
    fetchZones();
    fetchRoutes();
    fetchTodaySchedules();
    fetchCollections();
});


// ============================================================
// HELPER FUNCTIONS
// ============================================================

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function showMessage(elementId, text, success = true) {
    const message = document.getElementById(elementId);

    if (!message) {
        return;
    }

    message.innerText = text || "";

    message.style.color = success
        ? "var(--normal-text)"
        : "var(--critical-text)";
}


// ============================================================
// 1. DASHBOARD
// ============================================================

async function fetchDashboard() {
    try {
        const response = await fetch("/api/dashboard", {
            method: "GET",
            cache: "no-store"
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Failed to load dashboard");
        }

        document.getElementById("totalBins").innerText =
            data.total_bins ?? 0;

        document.getElementById("criticalBins").innerText =
            data.critical_bins ?? 0;

        document.getElementById("averageFill").innerText =
            Number(data.average_fill ?? 0).toFixed(2) + "%";

        document.getElementById("totalRoutes").innerText =
            data.total_routes ?? 0;

    } catch (error) {
        console.error("Error fetching dashboard data:", error);
    }
}


// ============================================================
// 2. BIN MONITORING
// ============================================================

async function fetchBins() {
    try {
        const response = await fetch("/api/bins", {
            method: "GET",
            cache: "no-store"
        });

        const data = await response.json();

        if (!response.ok || !Array.isArray(data)) {
            console.error("Bin API error:", data);
            return;
        }

        allBins = data;

        allBins.sort((a, b) => {
            return Number(a.bin_id) - Number(b.bin_id);
        });

        renderBinsTable(allBins);

    } catch (error) {
        console.error("Error fetching bins:", error);
    }
}


// ============================================================
// RENDER BIN TABLE
// ============================================================

function renderBinsTable(bins) {
    const tbody = document.getElementById("binsTable");

    if (!tbody) {
        return;
    }

    if (!bins || bins.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="loading">
                    No bins found.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = bins.map(bin => {
        const status = bin.bin_status || "Normal";

        let badgeClass = "badge-normal";

        if (status === "Critical") {
            badgeClass = "badge-critical";
        } else if (status === "Warning") {
            badgeClass = "badge-warning";
        }

        return `
            <tr>
                <td>${escapeHtml(bin.bin_id)}</td>

                <td>${escapeHtml(bin.street_address)}</td>

                <td>${escapeHtml(bin.zone_name)}</td>

                <td>
                    ${Number(bin.fill_level_percent ?? 0).toFixed(1)}%
                </td>

                <td>
                    <span class="badge ${badgeClass}">
                        ${escapeHtml(status)}
                    </span>
                </td>
            </tr>
        `;
    }).join("");
}


// ============================================================
// BIN FILTER
// ============================================================

function filterBins(type, btnElement) {
    document.querySelectorAll(".filter-btn").forEach(button => {
        button.classList.remove("active");
    });

    if (btnElement) {
        btnElement.classList.add("active");
    }

    if (type === "all") {
        renderBinsTable(allBins);
        return;
    }

    const filteredBins = allBins.filter(bin => {
        const status = String(bin.bin_status || "").toLowerCase();
        return status === type.toLowerCase();
    });

    renderBinsTable(filteredBins);
}


// ============================================================
// 3. ZONE ANALYSIS
// ============================================================

async function fetchZones() {
    const tbody = document.getElementById("zonesTable");

    if (!tbody) {
        return;
    }

    try {
        const response = await fetch("/api/zones", {
            method: "GET",
            cache: "no-store"
        });

        const data = await response.json();

        if (!response.ok || !Array.isArray(data)) {
            throw new Error(data.message || "Invalid zone data");
        }

        if (data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="loading">
                        No zone data found.
                    </td>
                </tr>
            `;
            return;
        }

        data.sort((a, b) => {
            return Number(b.average_fill_level ?? 0)
                - Number(a.average_fill_level ?? 0);
        });

        tbody.innerHTML = data.map(zone => {
            const averageFill =
                Number(zone.average_fill_level ?? 0);

            const priority =
                Number(zone.waste_priority ?? 1);

            let priorityText = "Very Low";

            if (priority === 5) {
                priorityText = "Critical";
            } else if (priority === 4) {
                priorityText = "High";
            } else if (priority === 3) {
                priorityText = "Moderate";
            } else if (priority === 2) {
                priorityText = "Low";
            }

            const priorityClass =
                priority === 5
                    ? "badge-critical"
                    : priority === 4 || priority === 3
                        ? "badge-warning"
                        : "badge-normal";

            return `
                <tr>
                    <td>${escapeHtml(zone.zone_id)}</td>

                    <td>${escapeHtml(zone.zone_name)}</td>

                    <td>${escapeHtml(zone.city || "N/A")}</td>

                    <td>${zone.total_bins ?? 0}</td>

                    <td>${averageFill.toFixed(2)}%</td>

                    <td>${zone.critical_bins ?? 0}</td>

                    <td>
                        <span class="badge ${priorityClass}">
                            ${priorityText}
                        </span>
                    </td>
                </tr>
            `;
        }).join("");

    } catch (error) {
        console.error("Error fetching zone data:", error);

        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="loading">
                    Error loading zone data.
                </td>
            </tr>
        `;
    }
}
// ============================================================
// 4. ROUTE MANAGEMENT
// ============================================================

// ============================================================
// LOAD ROUTES
// ============================================================

async function fetchRoutes() {
    const tbody = document.getElementById("routesTable");

    if (!tbody) {
        console.error("Routes table body with ID 'routesTable' was not found.");
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td colspan="7" class="loading">
                Loading routes...
            </td>
        </tr>
    `;

    try {
        const response = await fetch("/api/routes", {
            method: "GET",
            cache: "no-store"
        });

        const data = await response.json();

        console.log("Routes received from backend:", data);

        if (!response.ok || !Array.isArray(data)) {
            throw new Error(
                data.message || "Failed to load routes"
            );
        }

        if (data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="loading">
                        No routes found.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = data.map(route => {
            const routeId = Number(route.route_id);
            const routeName = String(route.route_name || "");

            return `
                <tr>
                    <td>${escapeHtml(route.route_id)}</td>

                    <td>${escapeHtml(route.route_name)}</td>

                    <td>${escapeHtml(route.zone_name)}</td>

                    <td>
                        ${escapeHtml(route.driver_name || "Unassigned")}
                    </td>

                    <td>
                        ${escapeHtml(route.vehicle || "Unassigned")}
                    </td>

                    <td>${escapeHtml(route.stop_count ?? 0)}</td>

                    <td>
                        <button
                            class="manage-btn"
                            onclick="manageRoute(${routeId}, '${escapeHtml(routeName)}')">
                            Manage
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

    } catch (error) {
        console.error("Error loading routes:", error);

        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="loading">
                    Failed to load routes.
                </td>
            </tr>
        `;
    }
}


// ============================================================
// MANAGE ROUTE
// ============================================================

async function manageRoute(routeId, routeName) {
    selectedRouteId = Number(routeId);

    const selectedRouteName =
        document.getElementById("selectedRouteName");

    const routeManager =
        document.getElementById("routeManager");

    if (selectedRouteName) {
        selectedRouteName.innerText = routeName;
    }

    if (routeManager) {
        routeManager.style.display = "block";
    }

    await fetchDrivers();
    await loadVehicles();
    await fetchRouteStops(selectedRouteId);

    if (routeManager) {
        routeManager.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}


// ============================================================
// LOAD DRIVERS
// ============================================================

async function fetchDrivers() {
    const driverSelect =
        document.getElementById("driverSelect");

    if (!driverSelect) {
        console.error(
            "Driver dropdown with ID 'driverSelect' was not found."
        );
        return;
    }

    driverSelect.innerHTML = `
        <option value="">Loading drivers...</option>
    `;

    try {
        const response = await fetch("/api/drivers", {
            method: "GET",
            cache: "no-store"
        });

        const data = await response.json();

        console.log("Drivers received from backend:", data);

        if (!response.ok || !Array.isArray(data)) {
            throw new Error(
                data.message || "Failed to load drivers"
            );
        }

        driverSelect.innerHTML = `
            <option value="">Select Driver</option>
        `;

        if (data.length === 0) {
            driverSelect.innerHTML = `
                <option value="">No available drivers</option>
            `;
            return;
        }

        data.forEach(driver => {
            const option = document.createElement("option");

            option.value = driver.driver_id;

            option.textContent =
                `${driver.first_name} ${driver.last_name}`;

            driverSelect.appendChild(option);
        });

    } catch (error) {
        console.error("Driver loading error:", error);

        driverSelect.innerHTML = `
            <option value="">Failed to load drivers</option>
        `;
    }
}


// ============================================================
// LOAD VEHICLES
// ============================================================

async function loadVehicles() {
    const vehicleSelect =
        document.getElementById("vehicleSelect");

    if (!vehicleSelect) {
        console.error(
            "Vehicle dropdown with ID 'vehicleSelect' was not found."
        );
        return;
    }

    vehicleSelect.innerHTML = `
        <option value="">Loading vehicles...</option>
    `;

    try {
        const response = await fetch("/api/vehicles", {
            method: "GET",
            cache: "no-store"
        });

        const data = await response.json();

        console.log("Vehicles received from backend:", data);

        if (!response.ok || !Array.isArray(data)) {
            throw new Error(
                data.message || "Failed to load vehicles"
            );
        }

        vehicleSelect.innerHTML = `
            <option value="">Select Vehicle</option>
        `;

        if (data.length === 0) {
            vehicleSelect.innerHTML = `
                <option value="">No available vehicles</option>
            `;
            return;
        }

        data.forEach(vehicle => {
            const option = document.createElement("option");

            option.value = vehicle.vehicle_id;

            option.textContent =
                `${vehicle.registration_number} (${vehicle.capacity_kg} kg)`;

            vehicleSelect.appendChild(option);
        });

    } catch (error) {
        console.error("Vehicle loading error:", error);

        vehicleSelect.innerHTML = `
            <option value="">Failed to load vehicles</option>
        `;
    }
}


// ============================================================
// ASSIGN DRIVER
// ============================================================

async function assignDriver() {
    if (!selectedRouteId) {
        showRouteMessage(
            "Please select a route first.",
            false
        );
        return;
    }

    const driverSelect =
        document.getElementById("driverSelect");

    if (!driverSelect) {
        showRouteMessage(
            "Driver dropdown was not found.",
            false
        );
        return;
    }

    const driverId = driverSelect.value;

    if (!driverId) {
        showRouteMessage(
            "Please select a driver.",
            false
        );
        return;
    }

    const requestBody = {
        route_id: Number(selectedRouteId),
        driver_id: Number(driverId)
    };

    console.log("Assigning driver:", requestBody);

    try {
        const response = await fetch("/api/routes/driver", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        console.log("Driver assignment response:", data);

        showRouteMessage(
            data.message || "Driver assignment completed.",
            response.ok
        );

        if (response.ok) {
            await fetchRoutes();
            await fetchDrivers();

            if (typeof fetchTodaySchedules  === "function") {
                await fetchTodaySchedules();
            }

            if (typeof fetchCollections === "function") {
                await fetchCollections();
            }
        }

    } catch (error) {
        console.error("Assign driver error:", error);

        showRouteMessage(
            "Server connection error.",
            false
        );
    }
}


// ============================================================
// ASSIGN VEHICLE
// ============================================================

async function assignVehicle() {
    if (!selectedRouteId) {
        showRouteMessage(
            "Please select a route first.",
            false
        );
        return;
    }

    const vehicleSelect =
        document.getElementById("vehicleSelect");

    if (!vehicleSelect) {
        showRouteMessage(
            "Vehicle dropdown was not found.",
            false
        );
        return;
    }

    const vehicleId = vehicleSelect.value;

    if (!vehicleId) {
        showRouteMessage(
            "Please select a vehicle.",
            false
        );
        return;
    }

    const requestBody = {
        route_id: Number(selectedRouteId),
        vehicle_id: Number(vehicleId)
    };

    console.log("Assigning vehicle:", requestBody);

    try {
        const response = await fetch("/api/routes/vehicle", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        const responseText = await response.text();

        console.log(
            "Vehicle assignment HTTP status:",
            response.status
        );

        console.log(
            "Raw vehicle assignment response:",
            responseText
        );

        let data;

        try {
            data = JSON.parse(responseText);
        } catch (jsonError) {
            console.error(
                "Backend returned invalid JSON:",
                jsonError
            );

            showRouteMessage(
                `Server returned an invalid response. HTTP ${response.status}`,
                false
            );

            return;
        }

        showRouteMessage(
            data.message ||
            data.error ||
            `Vehicle assignment failed. HTTP ${response.status}`,
            response.ok
        );

        if (response.ok) {
            await fetchRoutes();
            await loadVehicles();

            if (typeof fetchTodaySchedules  === "function") {
                await fetchTodaySchedules();
            }

            if (typeof fetchCollections === "function") {
                await fetchCollections();
            }
        }

    } catch (error) {
        console.error("Assign vehicle request failed:", error);

        showRouteMessage(
            `Request failed: ${error.message}`,
            false
        );
    }
}


// ============================================================
// GET ROUTE STOPS
// ============================================================

async function fetchRouteStops(routeId) {
    const tbody =
        document.getElementById("routeStopsTable");

    if (!tbody) {
        console.error(
            "Route stops table body with ID 'routeStopsTable' was not found."
        );
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td colspan="6" class="loading">
                Loading route stops...
            </td>
        </tr>
    `;

    try {
        const response = await fetch(
            `/api/routes/${Number(routeId)}/stops`,
            {
                method: "GET",
                cache: "no-store"
            }
        );

        const data = await response.json();

        console.log("Route stops received from backend:", data);

        if (!response.ok || !Array.isArray(data)) {
            throw new Error(
                data.message || "Failed to load route stops"
            );
        }

        if (data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="loading">
                        No bins assigned to this route.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = data.map(stop => {
            return `
                <tr>
                    <td>${escapeHtml(stop.stop_sequence)}</td>

                    <td>${escapeHtml(stop.bin_id)}</td>

                    <td>${escapeHtml(stop.street_address)}</td>

                    <td>${escapeHtml(stop.zone_name)}</td>

                    <td>
                        ${Number(
                            stop.fill_level_percent ?? 0
                        ).toFixed(1)}%
                    </td>

                    <td>${escapeHtml(stop.priority || "Normal")}</td>
                </tr>
            `;
        }).join("");

    } catch (error) {
        console.error("Route stops error:", error);

        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="loading">
                    Failed to load route stops.
                </td>
            </tr>
        `;
    }
}


// ============================================================
// ROUTE MESSAGE
// ============================================================

function showRouteMessage(text, success) {
    if (typeof showMessage === "function") {
        showMessage("routeMessage", text, success);
    } else {
        console.log(
            success ? "Success:" : "Error:",
            text
        );
    }
}


// ============================================================
// SAFE HTML ESCAPE
// ============================================================

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ============================================================
// 5. TODAY'S DRIVER SCHEDULE
// ============================================================

async function fetchTodaySchedules() {
    const tableBody =
        document.getElementById("todaySchedulesTableBody");

    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = `
        <tr>
            <td colspan="7" class="loading">
                Loading today's schedules...
            </td>
        </tr>
    `;

    try {
        const response = await fetch("/api/schedules", {
            method: "GET",
            cache: "no-store"
        });

        const schedules = await response.json();

        if (!response.ok || !Array.isArray(schedules)) {
            throw new Error(
                schedules.message || "Invalid schedule data"
            );
        }

        tableBody.innerHTML = "";

        if (schedules.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="loading">
                        No driver schedules available.
                    </td>
                </tr>
            `;
            return;
        }

        schedules.forEach(schedule => {
            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${escapeHtml(schedule.schedule_id)}</td>

                <td>${escapeHtml(
                    schedule.route_name || "N/A"
                )}</td>

                <td>${escapeHtml(
                    schedule.start_time || "N/A"
                )}</td>

                <td>${escapeHtml(
                    schedule.end_time || "N/A"
                )}</td>

                <td>${escapeHtml(
                    schedule.status || "Scheduled"
                )}</td>
            `;

            tableBody.appendChild(row);
        });

    } catch (error) {
        console.error(
            "Unable to load today's schedules:",
            error
        );

        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="loading">
                    Unable to load today's schedules.
                </td>
            </tr>
        `;
    }
}
// ============================================================
// 6. PICKUP MANAGEMENT
// ============================================================

async function fetchCollections() {
    const tbody = document.getElementById("collectionsTable");

    if (!tbody) {
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td colspan="9" class="loading">
                Loading pickup data...
            </td>
        </tr>
    `;

    try {
        const response = await fetch("/api/collections", {
            method: "GET",
            cache: "no-store"
        });

        const data = await response.json();

        if (!response.ok || !Array.isArray(data)) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="loading">
                        ${escapeHtml(
                            data.message || "Failed to load pickup data."
                        )}
                    </td>
                </tr>
            `;
            return;
        }

        if (data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="loading">
                        No bins currently require collection.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = data.map(bin => {
            return `
                <tr>
                    <td>${escapeHtml(bin.schedule_id)}</td>

                    <td>${escapeHtml(bin.bin_id)}</td>

                    <td>${escapeHtml(bin.street_address)}</td>

                    <td>${escapeHtml(bin.zone_name)}</td>

                    <td>
                        ${Number(
                            bin.fill_level_percent ?? 0
                        ).toFixed(1)}%
                    </td>

                    <td>${escapeHtml(bin.route_name || "Unassigned")}</td>

                    <td>${escapeHtml(bin.driver_name || "Unassigned")}</td>

                    <td>${escapeHtml(bin.vehicle || "Unassigned")}</td>

                    <td class="action-buttons">

                        <button
                            class="pickup-btn"
                            onclick="completePickup(
                                ${Number(bin.bin_id)},
                                ${Number(bin.schedule_id)},
                                ${Number(bin.route_id)}
                            )">
                            Complete Pickup
                        </button>

                        <button
                            class="cancel-btn"
                            onclick="cancelSchedule(
                                ${Number(bin.schedule_id)}
                            )">
                            Cancel Schedule
                        </button>

                    </td>
                </tr>
            `;
        }).join("");

    } catch (error) {
        console.error("Pickup Management error:", error);

        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="loading">
                    Server connection error.
                </td>
            </tr>
        `;
    }
}


// ============================================================
// 7. COMPLETE BIN PICKUP
// ============================================================

async function completePickup(binId, scheduleId, routeId) {

    if (!binId || !scheduleId || !routeId) {
        showMessage(
            "pickupMessage",
            "Missing bin, schedule, or route information.",
            false
        );
        return;
    }

    const confirmed = confirm(
        `Complete pickup for Bin ${binId}?`
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch("/api/pickup", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                bin_id: Number(binId),
                schedule_id: Number(scheduleId),
                route_id: Number(routeId)
            })
        });

        const data = await response.json();

        showMessage(
            "pickupMessage",
            data.message || "Pickup completed.",
            response.ok
        );

        if (response.ok) {
            await fetchCollections();
            await fetchBins();
            await fetchDashboard();
            await fetchZones();
            await fetchRoutes();

            // Refresh Feature 3: Today's Driver Schedule
            await fetchTodaySchedules();

            // Ensure all updated values are displayed
            window.location.reload();
        }

    } catch (error) {
        console.error("Complete pickup error:", error);

        showMessage(
            "pickupMessage",
            "Server connection error.",
            false
        );
    }
}


// ============================================================
// 8. CANCEL COLLECTION SCHEDULE
// ============================================================

async function cancelSchedule(scheduleId) {

    const confirmed = confirm(
        `Are you sure you want to cancel Schedule ${scheduleId}?`
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(
            `/api/schedules/${Number(scheduleId)}/cancel`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        const result = await response.json();

        showMessage(
            "pickupMessage",
            result.message || "Schedule cancelled.",
            response.ok
        );

        if (response.ok) {
            await fetchCollections();

            // Refresh Feature 3: Today's Driver Schedule
            await fetchTodaySchedules();

            await fetchDashboard();
            await fetchRoutes();

            // Reload the page so the cancelled status is visible
            window.location.reload();
        }

    } catch (error) {
        console.error("Cancellation error:", error);

        showMessage(
            "pickupMessage",
            "Server connection error.",
            false
        );
    }
}

// ============================================================
// END OF SCRIPT
// ============================================================
