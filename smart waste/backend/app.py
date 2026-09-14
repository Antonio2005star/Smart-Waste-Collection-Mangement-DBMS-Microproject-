import oracledb
from flask import Flask, request, jsonify, render_template
 
# static_folder / template_folder are Flask defaults ('static' and 'templates'
# next to this file) — spelled out here so the project layout is unambiguous:
#
#   app.py
#   templates/index.html   <-- rendered by "/"
#   static/script.js       <-- linked in index.html via url_for('static', ...)
#   static/style.css       <-- linked in index.html via url_for('static', ...)
app = Flask(__name__, static_folder="static", template_folder="templates")
 
# ==========================================
# ORACLE DATABASE CONFIGURATION
# ==========================================
db_config = {
    "user": "system",
    "password": "your_password",
    "dsn": "localhost:1521/xe"
}
 
def get_db_connection():
    try:
        conn = oracledb.connect(**db_config)
        return conn
    except oracledb.Error as e:
        print(f"Error connecting to Oracle: {e}")
        return None
 
def rows_to_dict(cursor):
    """
    IMPORTANT: python-oracledb reports unquoted column aliases in UPPERCASE
    regardless of how they were typed in the SQL (Oracle folds unquoted
    identifiers to uppercase). script.js expects lowercase keys for the
    routes/schedules/resources/alerts/pickups endpoints (e.g. r.id, r.name),
    so those queries below use double-quoted aliases (AS "id") to force
    Oracle to preserve lowercase. This function just passes through
    whatever cursor.description reports, unchanged.
    """
    columns = [col[0] for col in cursor.description]
    cursor.rowfactory = lambda *args: dict(zip(columns, args))
    return cursor.fetchall()
 
# ==========================================
# UI ROUTE
# ==========================================
@app.route('/')
def index():
    return render_template('index.html')
 
# ==========================================
# WORKFLOW STEP 1: BIN MANAGEMENT
# ==========================================
@app.route('/api/bins/update-sensor', methods=['POST'])
def api_update_bin():
    data = request.json
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor()
    try:
        cursor.callproc("Update_Fill_Level", [data['bin_id'], data['fill_level']])
        conn.commit()
        return jsonify({"message": "Bin fill level updated."})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        conn.close()
 
@app.route('/api/bins/register', methods=['POST'])
def api_register_bin():
    data = request.json
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor()
    try:
        cursor.callproc("Register_Bin", [data['area'], data['address'], data['capacity']])
        conn.commit()
        return jsonify({"message": "Bin registered successfully."})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        conn.close()
 
# ==========================================
# WORKFLOW STEP 2: ROUTES
# script.js (renderRoutesTable, populateRouteSelect) reads r.id, r.name,
# r.area, r.bin_count, r.status directly off each object in the array
# returned by GET /api/routes.
# ==========================================
@app.route('/api/routes', methods=['GET', 'POST'])
def api_routes():
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor()
 
    if request.method == 'POST':
        data = request.json
        try:
            cursor.callproc("Create_Route", [data['name'], data['area']])
            conn.commit()
            return jsonify({"message": "Route created successfully."})
        except Exception as e:
            return jsonify({"error": str(e)}), 400
        finally:
            conn.close()
 
    # GET Request
    try:
        cursor.execute("""
            SELECT r.route_id                                             AS "id",
                   r.route_name                                           AS "name",
                   r.area_name                                            AS "area",
                   r.status                                               AS "status",
                   (SELECT COUNT(*) FROM Route_Bins rb
                     WHERE rb.route_id = r.route_id)                      AS "bin_count"
            FROM Routes r
        """)
        routes = rows_to_dict(cursor)
        return jsonify(routes)
    except Exception as e:
        return jsonify([])
    finally:
        conn.close()
 
@app.route('/api/routes/assign', methods=['POST'])
def api_assign_bin():
    data = request.json
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor()
    try:
        cursor.callproc("Assign_Bin_To_Route", [data['route_id'], data['bin_id'], data['stop_order']])
        conn.commit()
        return jsonify({"message": "Bin assigned to route sequence."})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        conn.close()
 
# ==========================================
# WORKFLOW STEP 3: SCHEDULING
# script.js (renderSchedulesTable) reads s.id, s.route, s.driver,
# s.vehicle, s.date, s.status directly off each object.
# ==========================================
@app.route('/api/schedules', methods=['GET', 'POST'])
def api_schedules():
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor()
 
    if request.method == 'POST':
        data = request.json
        try:
            cursor.callproc("Create_Collection_Schedule",
                            [data['route_id'], data['driver_id'], data['vehicle_id'], data['date'], data['time']])
            conn.commit()
            return jsonify({"message": "Schedule created successfully."})
        except oracledb.DatabaseError as e:
            error_obj, = e.args
            return jsonify({"error": error_obj.message}), 400
        finally:
            conn.close()
 
    # GET Request
    try:
        cursor.execute("""
            SELECT schedule_id   AS "id",
                   route_name    AS "route",
                   driver_name   AS "driver",
                   registration  AS "vehicle",
                   schedule_date AS "date",
                   status        AS "status"
            FROM V_Schedules
        """)
        schedules = rows_to_dict(cursor)
        return jsonify(schedules)
    except Exception:
        return jsonify([])
    finally:
        conn.close()
 
# ==========================================
# WORKFLOW STEP 4: RESOURCES (DRIVERS & VEHICLES)
# script.js (renderFleetList) reads v.reg, v.type, v.capacity, v.status.
# script.js (renderDriverList) reads d.name, d.license, d.status.
# populateResourceSelects also reads v.id/v.reg and d.id/d.name.
# ==========================================
@app.route('/api/register/vehicle', methods=['POST'])
def api_register_vehicle():
    data = request.json
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor()
    try:
        cursor.callproc("Register_Vehicle", [data['registration'], data['type'], data['capacity']])
        conn.commit()
        return jsonify({"message": "Vehicle registered successfully."})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        conn.close()
 
@app.route('/api/register/driver', methods=['POST'])
def api_register_driver():
    data = request.json
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor()
    try:
        cursor.callproc("Register_Driver", [data['name'], data['license']])
        conn.commit()
        return jsonify({"message": "Driver registered successfully."})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        conn.close()
 
@app.route('/api/resources/vehicles', methods=['GET'])
def api_get_vehicles():
    conn = get_db_connection()
    if not conn: return jsonify([])
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT vehicle_id   AS "id",
                   registration AS "reg",
                   vehicle_type AS "type",
                   capacity     AS "capacity",
                   status       AS "status"
            FROM Vehicles
        """)
        return jsonify(rows_to_dict(cursor))
    except Exception:
        return jsonify([])
    finally:
        conn.close()
 
@app.route('/api/resources/drivers', methods=['GET'])
def api_get_drivers():
    conn = get_db_connection()
    if not conn: return jsonify([])
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT driver_id      AS "id",
                   name           AS "name",
                   license_number AS "license",
                   status         AS "status"
            FROM Drivers
        """)
        return jsonify(rows_to_dict(cursor))
    except Exception:
        return jsonify([])
    finally:
        conn.close()
 
# ==========================================
# WORKFLOW STEP 5: PICKUP TRACKING & ALERTS
# script.js (renderTrackingTable) reads p.schedule, p.bin_id, p.address,
# p.fill, p.status, p.pickup_id.
# script.js (fetchAlerts) reads a.level, a.title, a.detail, a.time.
#
# NOTE: V_Today_Pickups is queried with SELECT * here, so its real column
# names/case depend on how that view was created in your schema. If the
# tracking table still renders "undefined", either recreate the view with
# quoted lowercase aliases, or replace the SELECT * below with an explicit
# column list aliased the same way as the queries above.
# ==========================================
@app.route('/api/pickups/today', methods=['GET'])
def api_pickups_today():
    conn = get_db_connection()
    if not conn: return jsonify([])
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM V_Today_Pickups")
        return jsonify(rows_to_dict(cursor))
    except Exception:
        return jsonify([])
    finally:
        conn.close()
 
@app.route('/api/pickup/status', methods=['PUT'])
def api_update_pickup():
    data = request.json
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor()
    try:
        cursor.callproc("Update_Pickup_Status", [data['pickup_id'], data['status'], data.get('reason')])
        conn.commit()
        return jsonify({"message": f"Pickup status updated to {data['status']}."})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        conn.close()
 
@app.route('/api/alerts', methods=['GET'])
def api_get_alerts():
    conn = get_db_connection()
    if not conn: return jsonify([])
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT alert_level  AS "level",
                   alert_title  AS "title",
                   alert_detail AS "detail",
                   alert_time   AS "time"
            FROM V_Active_Alerts
        """)
        return jsonify(rows_to_dict(cursor))
    except Exception:
        return jsonify([])
    finally:
        conn.close()
 
# ==========================================
# WORKFLOW STEP 6: REPORTS & ANALYTICS
# script.js reads these in UPPERCASE (e.g. b.BIN_ID, e.SCHEDULE_ID),
# matching Oracle's default unquoted-uppercase behavior — left as-is.
# ==========================================
@app.route('/api/reports/efficiency', methods=['GET'])
def report_efficiency():
    return query_view("SELECT * FROM V_Collection_Efficiency")
 
@app.route('/api/reports/needs-collection', methods=['GET'])
def report_needs_collection():
    return query_view("SELECT * FROM V_Bins_To_Collect")
 
@app.route('/api/reports/problematic-bins', methods=['GET'])
def report_problematic():
    return query_view("SELECT * FROM V_Problematic_Bins")
 
@app.route('/api/reports/route-bin-count', methods=['GET'])
def report_route_bin_count():
    return query_view("SELECT * FROM V_Route_Bin_Count")
 
@app.route('/api/reports/vehicle-utilization', methods=['GET'])
def report_vehicle_utilization():
    return query_view("SELECT * FROM V_Vehicle_Utilization")
 
@app.route('/api/reports/driver-workload', methods=['GET'])
def report_driver_workload():
    return query_view("SELECT * FROM V_Driver_Workload")
 
@app.route('/api/reports/missed-collections', methods=['GET'])
def report_missed_collections():
    return query_view("SELECT * FROM V_Missed_Collections")
 
@app.route('/api/reports/area-waste-generation', methods=['GET'])
def report_area_waste():
    return query_view("SELECT * FROM V_Area_Waste_Generation")
 
def query_view(sql):
    conn = get_db_connection()
    if not conn: return jsonify([])
    cursor = conn.cursor()
    try:
        cursor.execute(sql)
        data = rows_to_dict(cursor)
        return jsonify(data)
    except Exception:
        return jsonify([])
    finally:
        conn.close()
 
# ==========================================
# MAIN EXECUTION
# ==========================================
if __name__ == '__main__':
    app.run(debug=True, port=5000)
 
