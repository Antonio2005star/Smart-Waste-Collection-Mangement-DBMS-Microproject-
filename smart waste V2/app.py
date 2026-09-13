import os
from flask import Flask, jsonify, request, render_template
import oracledb

app = Flask(__name__)

DB_USER = os.getenv("DB_USER", "SYSTEM")
DB_PASSWORD = os.getenv("DB_PASSWORD", "your_password")
DB_DSN = os.getenv("DB_DSN", "localhost:1521/XE")

pool = None

def init_db_pool():
    global pool
    try:
        pool = oracledb.create_pool(
            user=DB_USER, password=DB_PASSWORD, dsn=DB_DSN, min=2, max=5, increment=1
        )
        print("Oracle Database connection pool established successfully.")
    except Exception as e:
        print(f"Error creating Oracle pool: {e}")

def dict_factory(cursor, row):
    column_names = [col[0].lower() for col in cursor.description]
    return dict(zip(column_names, row))

@app.route('/')
def home():
    return render_template('index.html')

# 1. BINS TABLE
@app.route('/api/bins', methods=['GET'])
def get_bins():
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT bin_id, location_name, latitude, longitude, current_fill_level, capacity_liters,
                           ROUND((current_fill_level / NVL(capacity_liters, 100)) * 100, 2) AS fill_percentage
                    FROM bins ORDER BY bin_id
                """)
                cursor.rowfactory = lambda *args: dict_factory(cursor, args)
                return jsonify({"status": "success", "data": cursor.fetchall()}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# 2. VEHICLES TABLE
@app.route('/api/vehicles', methods=['GET'])
def get_vehicles():
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT vehicle_id, registration_number, capacity_liters, status
                    FROM vehicles ORDER BY vehicle_id
                """)
                cursor.rowfactory = lambda *args: dict_factory(cursor, args)
                return jsonify({"status": "success", "data": cursor.fetchall()}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# 3. ROUTES TABLE
@app.route('/api/routes/active', methods=['GET'])
def get_active_routes():
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT r.route_id, r.vehicle_id, v.registration_number, r.status, 
                           TO_CHAR(r.scheduled_date, 'YYYY-MM-DD') AS created_at
                    FROM routes r
                    JOIN vehicles v ON r.vehicle_id = v.vehicle_id
                    ORDER BY r.route_id DESC
                """)
                cursor.rowfactory = lambda *args: dict_factory(cursor, args)
                return jsonify({"status": "success", "data": cursor.fetchall()}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    
# 4. ROUTE_STOPS TABLE (Route Mapping)
@app.route('/api/route-bins', methods=['GET'])
def get_route_bins():
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT rs.route_id, rs.bin_id, rs.stop_sequence AS collection_order, b.location_name
                    FROM route_stops rs
                    JOIN bins b ON rs.bin_id = b.bin_id
                    ORDER BY rs.route_id DESC, rs.stop_sequence ASC
                """)
                cursor.rowfactory = lambda *args: dict_factory(cursor, args)
                return jsonify({"status": "success", "data": cursor.fetchall()}), 200
    except Exception as e:
        print(f"Route stops error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500
    
# 5. COLLECTION_LOGS TABLE
@app.route('/api/logs', methods=['GET'])
def get_logs():
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT cl.log_id, cl.bin_id, b.location_name, v.registration_number,
                           TO_CHAR(cl.collected_at, 'YYYY-MM-DD HH24:MI:SS') AS collected_at, 
                           cl.fill_level_before_collection
                    FROM collection_logs cl
                    JOIN bins b ON cl.bin_id = b.bin_id
                    JOIN vehicles v ON cl.vehicle_id = v.vehicle_id
                    ORDER BY cl.log_id DESC
                """)
                cursor.rowfactory = lambda *args: dict_factory(cursor, args)
                return jsonify({"status": "success", "data": cursor.fetchall()}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    
@app.route('/api/dispatch', methods=['POST'])
def dispatch_route():
    data = request.get_json()
    vehicle_id = data.get('vehicle_id')
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                route_id_var = cursor.var(int)
                cursor.callproc('sp_run_dispatch', [vehicle_id, route_id_var])
                connection.commit()
                return jsonify({"status": "success", "message": f"Route #{route_id_var.getvalue()} successfully dispatched!"}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 400

@app.route('/api/routes/<int:route_id>/complete', methods=['POST'])
def complete_route(route_id):
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                cursor.callproc('sp_complete_route', [route_id])
                connection.commit()
                return jsonify({"status": "success", "message": f"Route #{route_id} completed via database procedure!"}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 400

@app.route('/api/simulate-sensors', methods=['POST'])
def simulate_sensors():
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                cursor.callproc('sp_simulate_sensor_spike')
                connection.commit()
                return jsonify({"status": "success", "message": "IoT sensor data simulated! Bin fill levels updated."}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 400

@app.route('/api/vehicles/<int:vehicle_id>/toggle-maintenance', methods=['POST'])
def toggle_maintenance(vehicle_id):
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                # Toggle status between Available and Maintenance
                cursor.execute("""
                    UPDATE vehicles 
                    SET status = CASE WHEN status = 'Maintenance' THEN 'Available' ELSE 'Maintenance' END 
                    WHERE vehicle_id = :v_id AND status != 'In Use'
                """, {"v_id": vehicle_id})
                connection.commit()
                return jsonify({"status": "success", "message": f"Vehicle #{vehicle_id} status updated."}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 400

@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    try:
        with pool.acquire() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM vw_collection_analytics")
                cursor.rowfactory = lambda *args: dict_factory(cursor, args)
                return jsonify({"status": "success", "data": cursor.fetchall()}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    
if __name__ == '__main__':
    init_db_pool()
    app.run(host='0.0.0.0', port=5000, debug=True)