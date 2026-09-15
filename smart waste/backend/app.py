import os
from datetime import datetime

import oracledb
from flask import Flask, jsonify, render_template, request

app = Flask(__name__, static_folder="static", template_folder="templates")


# ============================================================
# ORACLE DATABASE CONFIGURATION
# ============================================================

DB_CONFIG = {
    "user": os.getenv("ORACLE_USER", "SYSTEM"),
    "password": os.getenv("ORACLE_PASSWORD", "Antonio2005"),
    "dsn": os.getenv("ORACLE_DSN", "localhost:1521/XEPDB1"),
}


def get_db_connection():
    return oracledb.connect(**DB_CONFIG)


def rows_to_dict(cursor):
    columns = [column[0].lower() for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def execute_select(sql, params=None):
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(sql, params or {})
        return jsonify(rows_to_dict(cursor))

    except oracledb.DatabaseError as error:
        error_obj, = error.args
        return jsonify({"error": error_obj.message}), 500

    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


def call_procedure(procedure_name, parameters):
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.callproc(procedure_name, parameters)
        connection.commit()

        return jsonify({
            "message": f"{procedure_name} completed successfully."
        })

    except oracledb.DatabaseError as error:
        if connection:
            connection.rollback()

        error_obj, = error.args
        return jsonify({"error": error_obj.message}), 400

    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


def request_json():
    return request.get_json(silent=True) or {}


def missing_fields(data, fields):
    return [field for field in fields if data.get(field) in (None, "")]


# ============================================================
# MAIN PAGE
# ============================================================

@app.route("/")
def index():
    return render_template("index.html")


# ============================================================
# FEATURE 1: BIN MANAGEMENT AND MONITORING
# ============================================================

@app.route("/api/bins", methods=["GET"])
def get_bins():
    # There is no all-bins view in the supplied Oracle files.
    # This is only a read operation; fill-level business logic
    # remains inside Oracle's Update_Fill_Level procedure/function.
    return execute_select("""
        SELECT
            bin_id,
            bin_type,
            area_name,
            location_address,
            fill_level,
            collection_status
        FROM Bins
        ORDER BY fill_level DESC, bin_id
    """)


@app.route("/api/bins/update-sensor", methods=["POST"])
def update_bin_fill_level():
    data = request_json()
    required = ["bin_id", "fill_level"]
    missing = missing_fields(data, required)

    if missing:
        return jsonify({
            "error": "Missing fields: " + ", ".join(missing)
        }), 400

    try:
        bin_id = int(data["bin_id"])
        fill_level = float(data["fill_level"])
    except (TypeError, ValueError):
        return jsonify({
            "error": "bin_id must be an integer and fill_level must be numeric."
        }), 400

    if not 0 <= fill_level <= 100:
        return jsonify({
            "error": "fill_level must be between 0 and 100."
        }), 400

    # Oracle updates collection_status through Get_Fill_Status_Label
    # and records the reading through trg_bin_history.
    return call_procedure(
        "Update_Fill_Level",
        [bin_id, fill_level]
    )


# ============================================================
# FEATURE 2: ROUTE MANAGEMENT
# ============================================================

@app.route("/api/routes", methods=["GET"])
def get_routes():
    # Uses the existing Oracle view V_Route_Summary.
    return execute_select("""
        SELECT
            route_id,
            route_name,
            start_location,
            end_location,
            bin_count
        FROM V_Route_Summary
        ORDER BY route_id
    """)


@app.route("/api/routes/<int:route_id>/sequence", methods=["GET"])
def get_route_sequence(route_id):
    # Route_Bins has no separate sequence view in the supplied files.
    # This query only retrieves the existing route sequence.
    return execute_select("""
        SELECT
            rb.stop_order,
            rb.bin_id,
            b.location_address,
            b.fill_level,
            b.collection_status
        FROM Route_Bins rb
        JOIN Bins b
            ON b.bin_id = rb.bin_id
        WHERE rb.route_id = :route_id
        ORDER BY rb.stop_order
    """, {"route_id": route_id})


@app.route("/api/routes/assign", methods=["POST"])
def assign_bin_to_route():
    data = request_json()
    required = ["route_id", "bin_id", "stop_order"]
    missing = missing_fields(data, required)

    if missing:
        return jsonify({
            "error": "Missing fields: " + ", ".join(missing)
        }), 400

    try:
        route_id = int(data["route_id"])
        bin_id = int(data["bin_id"])
        stop_order = int(data["stop_order"])
    except (TypeError, ValueError):
        return jsonify({
            "error": "route_id, bin_id and stop_order must be integers."
        }), 400

    return call_procedure(
        "Assign_Bin_To_Route",
        [route_id, bin_id, stop_order]
    )


# ============================================================
# FEATURE 3: COLLECTION SCHEDULING
# ============================================================

@app.route("/api/schedules", methods=["GET"])
def get_schedules():
    # Uses the existing Oracle view V_Today_Schedules.
    # The view intentionally returns today's schedules only.
    return execute_select("""
        SELECT
            schedule_id,
            start_time,
            route_name,
            vehicle_reg,
            driver_name,
            status
        FROM V_Today_Schedules
        ORDER BY start_time, schedule_id
    """)


@app.route("/api/schedules", methods=["POST"])
def create_schedule():
    data = request_json()
    required = ["route_id", "driver_id", "vehicle_id", "date", "time"]
    missing = missing_fields(data, required)

    if missing:
        return jsonify({
            "error": "Missing fields: " + ", ".join(missing)
        }), 400

    try:
        route_id = int(data["route_id"])
        driver_id = int(data["driver_id"])
        vehicle_id = int(data["vehicle_id"])

        # Oracle procedure expects DATE, not a raw HTML date string.
        schedule_date = datetime.strptime(
            str(data["date"]),
            "%Y-%m-%d"
        )

        start_time = str(data["time"])

    except (TypeError, ValueError):
        return jsonify({
            "error": "Invalid schedule data. Date must use YYYY-MM-DD."
        }), 400

    # All schedule insertion rules, including the past-date trigger,
    # remain in Oracle's Create_Collection_Schedule procedure.
    return call_procedure(
        "Create_Collection_Schedule",
        [
            route_id,
            driver_id,
            vehicle_id,
            schedule_date,
            start_time
        ]
    )


@app.route("/api/schedules/status", methods=["PUT"])
def update_schedule_status():
    data = request_json()
    required = ["schedule_id", "status"]
    missing = missing_fields(data, required)

    if missing:
        return jsonify({
            "error": "Missing fields: " + ", ".join(missing)
        }), 400

    try:
        schedule_id = int(data["schedule_id"])
    except (TypeError, ValueError):
        return jsonify({
            "error": "schedule_id must be an integer."
        }), 400

    return call_procedure(
        "Update_Schedule_Status",
        [schedule_id, data["status"]]
    )


# ============================================================
# FEATURE 4: DRIVERS AND VEHICLES
# ============================================================

@app.route("/api/resources/vehicles", methods=["GET"])
def get_vehicles():
    return execute_select("""
        SELECT
            vehicle_id,
            registration_number,
            vehicle_type,
            capacity_kg,
            status
        FROM Vehicles
        ORDER BY vehicle_id
    """)


@app.route("/api/resources/drivers", methods=["GET"])
def get_drivers():
    # Uses the existing normalized driver contact view.
    return execute_select("""
        SELECT
            driver_id,
            name,
            phone_number,
            phone_type,
            status
        FROM V_Driver_Contact_List
        ORDER BY driver_id
    """)


@app.route("/api/register/vehicle", methods=["POST"])
def register_vehicle():
    data = request_json()
    required = ["registration", "type", "capacity"]
    missing = missing_fields(data, required)

    if missing:
        return jsonify({
            "error": "Missing fields: " + ", ".join(missing)
        }), 400

    try:
        capacity = float(data["capacity"])
    except (TypeError, ValueError):
        return jsonify({
            "error": "capacity must be numeric."
        }), 400

    return call_procedure(
        "Register_Vehicle",
        [
            data["registration"],
            data["type"],
            capacity
        ]
    )


@app.route("/api/register/driver", methods=["POST"])
def register_driver():
    data = request_json()

    if not data.get("name"):
        return jsonify({"error": "name is required."}), 400

    return call_procedure(
        "Register_Driver",
        [data["name"]]
    )


@app.route("/api/resources/status", methods=["PUT"])
def update_resource_status():
    data = request_json()
    required = ["resource_type", "id", "status"]
    missing = missing_fields(data, required)

    if missing:
        return jsonify({
            "error": "Missing fields: " + ", ".join(missing)
        }), 400

    try:
        resource_id = int(data["id"])
    except (TypeError, ValueError):
        return jsonify({
            "error": "id must be an integer."
        }), 400

    return call_procedure(
        "Update_Resource_Status",
        [
            data["resource_type"],
            resource_id,
            data["status"]
        ]
    )


@app.route("/api/resources/driver-phone", methods=["POST"])
def add_driver_phone():
    data = request_json()
    required = ["driver_id", "phone", "type"]
    missing = missing_fields(data, required)

    if missing:
        return jsonify({
            "error": "Missing fields: " + ", ".join(missing)
        }), 400

    try:
        driver_id = int(data["driver_id"])
    except (TypeError, ValueError):
        return jsonify({
            "error": "driver_id must be an integer."
        }), 400

    return call_procedure(
        "Add_Driver_Phone",
        [
            driver_id,
            data["phone"],
            data["type"]
        ]
    )


# ============================================================
# FEATURE 5: PICKUP TRACKING AND ALERTS
# ============================================================

@app.route("/api/pickups", methods=["GET"])
def get_pickups():
    # The supplied Oracle files provide V_Pending_Pickups only.
    # The frontend's pickup filters require all pickup statuses,
    # so this endpoint reads the existing Pickups table and joins
    # only for display information.
    return execute_select("""
        SELECT
            p.pickup_id,
            p.schedule_id,
            p.bin_id,
            b.location_address,
            b.fill_level,
            p.status,
            p.reason,
            p.collection_time
        FROM Pickups p
        JOIN Bins b
            ON b.bin_id = p.bin_id
        ORDER BY p.pickup_id DESC
    """)


@app.route("/api/pickup/status", methods=["PUT"])
def update_pickup_status():
    data = request_json()
    required = ["pickup_id", "status"]
    missing = missing_fields(data, required)

    if missing:
        return jsonify({
            "error": "Missing fields: " + ", ".join(missing)
        }), 400

    try:
        pickup_id = int(data["pickup_id"])
    except (TypeError, ValueError):
        return jsonify({
            "error": "pickup_id must be an integer."
        }), 400

    # Oracle updates collection_time and the trigger resets the bin
    # when the status becomes Collected.
    return call_procedure(
        "Update_Pickup_Status",
        [
            pickup_id,
            data["status"],
            data.get("reason")
        ]
    )


@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    # Alert_Unsuccessful_Pickups is a DBMS_OUTPUT procedure, not a
    # queryable view. This read retrieves the same unsuccessful
    # pickup records for display in the web interface.
    return execute_select("""
        SELECT
            p.pickup_id,
            p.schedule_id,
            p.bin_id,
            p.status,
            p.reason,
            b.location_address
        FROM Pickups p
        JOIN Bins b
            ON b.bin_id = p.bin_id
        WHERE p.status IN ('Skipped', 'Failed')
        ORDER BY p.pickup_id DESC
    """)


# ============================================================
# FEATURE 6: REPORTS AND OPTIMIZATION
# ============================================================

@app.route("/api/reports/needs-collection", methods=["GET"])
def report_needs_collection():
    return execute_select("""
        SELECT *
        FROM V_Needs_Collection
    """)


@app.route("/api/reports/daily-schedule", methods=["GET"])
def report_daily_schedule():
    return execute_select("""
        SELECT *
        FROM V_Daily_Schedule
    """)


@app.route("/api/reports/route-workload", methods=["GET"])
def report_route_workload():
    return execute_select("""
        SELECT *
        FROM V_Route_Workload
    """)


@app.route("/api/reports/efficiency", methods=["GET"])
def report_efficiency():
    return execute_select("""
        SELECT *
        FROM V_Collection_Efficiency
    """)


@app.route("/api/reports/area-analysis", methods=["GET"])
def report_area_analysis():
    return execute_select("""
        SELECT *
        FROM V_Area_Analysis
    """)


@app.route("/api/reports/problematic-bins", methods=["GET"])
def report_problematic_bins():
    return execute_select("""
        SELECT *
        FROM V_Problematic_Bins
    """)


# ============================================================
# APPLICATION START
# ============================================================

if __name__ == "__main__":
    app.run(debug=True, port=5000)
