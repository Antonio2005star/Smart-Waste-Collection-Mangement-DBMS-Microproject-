from flask import Flask, jsonify, request, render_template
import oracledb
from flask_cors import CORS
import os
from dotenv import load_dotenv

# ============================================================
# FLASK SETUP
# ============================================================

app = Flask(__name__)
CORS(app)

# Load .env file
load_dotenv()


# ============================================================
# ORACLE DATABASE CONFIGURATION
# ============================================================

DB_CONFIG = {
    "user": os.getenv("ORACLE_USER"),
    "password": os.getenv("ORACLE_PASSWORD"),
    "dsn": os.getenv("ORACLE_DSN")
}


# ============================================================
# DATABASE CONNECTION
# ============================================================

def get_connection():
    return oracledb.connect(**DB_CONFIG)


# ============================================================
# HOME
# ============================================================

@app.route('/')
def home():
    return render_template('index.html')


# ============================================================
# 1. DASHBOARD
# Get basic system statistics
# ============================================================

@app.route('/api/dashboard', methods=['GET'])
def get_dashboard():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT COUNT(*) FROM Bins
        """)
        total_bins = cursor.fetchone()[0]

        cursor.execute("""
            SELECT COUNT(*)
            FROM Bins
            WHERE fill_level_percent >= 80
        """)
        critical_bins = cursor.fetchone()[0]

        cursor.execute("""
            SELECT COUNT(*) FROM Routes
        """)
        total_routes = cursor.fetchone()[0]

        cursor.execute("""
            SELECT COUNT(*) FROM Schedules
        """)
        total_schedules = cursor.fetchone()[0]

        return jsonify({
            "total_bins": total_bins,
            "critical_bins": critical_bins,
            "total_routes": total_routes,
            "total_schedules": total_schedules
        }), 200

    except oracledb.Error as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ============================================================
# 2. BIN MONITORING
# Get all bins with location and zone
# ============================================================

@app.route('/api/bins', methods=['GET'])
def get_bins():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                b.bin_id,
                l.street_address,
                z.zone_name,
                b.capacity_liters,
                b.fill_level_percent,
                b.status
            FROM Bins b
            JOIN Locations l
                ON b.location_id = l.location_id
            JOIN Zones z
                ON l.zone_id = z.zone_id
            ORDER BY b.bin_id
        """)

        columns = [col[0].lower() for col in cursor.description]

        data = [
            dict(zip(columns, row))
            for row in cursor.fetchall()
        ]

        return jsonify(data), 200

    except oracledb.Error as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ============================================================
# 3. CRITICAL BINS
# Uses the database view
# ============================================================

@app.route('/api/bins/critical', methods=['GET'])
def get_critical_bins():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT *
            FROM vw_critical_bins
            ORDER BY fill_level_percent DESC
        """)

        columns = [col[0].lower() for col in cursor.description]

        data = [
            dict(zip(columns, row))
            for row in cursor.fetchall()
        ]

        return jsonify(data), 200

    except oracledb.Error as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ============================================================
# 4. UPDATE BIN FILL LEVEL
# User can enter a new fill percentage
# Trigger automatically handles the alert
# ============================================================

@app.route('/api/bins/<int:bin_id>/fill', methods=['PUT'])
def update_bin_fill(bin_id):

    conn = None
    cursor = None

    try:
        body = request.get_json()

        if not body or "fill_level" not in body:
            return jsonify({
                "status": "error",
                "message": "fill_level is required."
            }), 400

        fill_level = body["fill_level"]

        # Basic validation
        if not isinstance(fill_level, (int, float)):
            return jsonify({
                "status": "error",
                "message": "fill_level must be a number."
            }), 400

        if fill_level < 0 or fill_level > 100:
            return jsonify({
                "status": "error",
                "message": "fill_level must be between 0 and 100."
            }), 400

        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE Bins
            SET fill_level_percent = :fill_level
            WHERE bin_id = :bin_id
        """, {
            "fill_level": fill_level,
            "bin_id": bin_id
        })

        if cursor.rowcount == 0:
            conn.rollback()

            return jsonify({
                "status": "error",
                "message": "Bin not found."
            }), 404

        conn.commit()

        return jsonify({
            "status": "success",
            "message": f"Bin {bin_id} fill level updated.",
            "fill_level": fill_level
        }), 200

    except oracledb.Error as e:

        if conn:
            conn.rollback()

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ============================================================
# 5. ZONE OVERVIEW
# Show bins and average fill level for each zone
# ============================================================

@app.route('/api/zones', methods=['GET'])
def get_zones():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                z.zone_id,
                z.zone_name,
                z.city,
                COUNT(b.bin_id) AS total_bins,
                ROUND(AVG(b.fill_level_percent), 2) AS average_fill
            FROM Zones z
            LEFT JOIN Locations l
                ON z.zone_id = l.zone_id
            LEFT JOIN Bins b
                ON l.location_id = b.location_id
            GROUP BY
                z.zone_id,
                z.zone_name,
                z.city
            ORDER BY z.zone_id
        """)

        columns = [col[0].lower() for col in cursor.description]

        data = [
            dict(zip(columns, row))
            for row in cursor.fetchall()
        ]

        return jsonify(data), 200

    except oracledb.Error as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ============================================================
# 6. ROUTE MANAGEMENT
# Show route, driver, vehicle and number of stops
# ============================================================

@app.route('/api/routes', methods=['GET'])
def get_routes():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                r.route_id,
                r.route_name,
                z.zone_name,
                d.first_name || ' ' || d.last_name AS driver_name,
                v.registration_number AS vehicle,
                COUNT(rb.bin_id) AS total_stops
            FROM Routes r
            JOIN Zones z
                ON r.zone_id = z.zone_id
            LEFT JOIN Drivers d
                ON r.driver_id = d.driver_id
            LEFT JOIN Vehicles v
                ON r.vehicle_id = v.vehicle_id
            LEFT JOIN Route_Bins rb
                ON r.route_id = rb.route_id
            GROUP BY
                r.route_id,
                r.route_name,
                z.zone_name,
                d.first_name,
                d.last_name,
                v.registration_number
            ORDER BY r.route_id
        """)

        columns = [col[0].lower() for col in cursor.description]

        data = [
            dict(zip(columns, row))
            for row in cursor.fetchall()
        ]

        return jsonify(data), 200

    except oracledb.Error as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ============================================================
# 7. SCHEDULE MANAGEMENT
# Show schedules with route and driver
# ============================================================

@app.route('/api/schedules', methods=['GET'])
def get_schedules():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                s.schedule_id,
                TO_CHAR(s.scheduled_date, 'DD-MM-YYYY') AS scheduled_date,
                s.start_time,
                s.end_time,
                r.route_name,
                d.first_name || ' ' || d.last_name AS driver_name,
                s.status
            FROM Schedules s
            JOIN Routes r
                ON s.route_id = r.route_id
            LEFT JOIN Drivers d
                ON r.driver_id = d.driver_id
            ORDER BY s.scheduled_date DESC
        """)

        columns = [col[0].lower() for col in cursor.description]

        data = [
            dict(zip(columns, row))
            for row in cursor.fetchall()
        ]

        return jsonify(data), 200

    except oracledb.Error as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ============================================================
# 8. COLLECTION VIEW
# Show bins that need collection
# ============================================================

@app.route('/api/collections', methods=['GET'])
def get_collections():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                b.bin_id,
                l.street_address,
                z.zone_name,
                b.fill_level_percent,
                r.route_name,
                d.first_name || ' ' || d.last_name AS driver_name,
                v.registration_number AS vehicle
            FROM Bins b
            JOIN Locations l
                ON b.location_id = l.location_id
            JOIN Zones z
                ON l.zone_id = z.zone_id
            LEFT JOIN Route_Bins rb
                ON b.bin_id = rb.bin_id
            LEFT JOIN Routes r
                ON rb.route_id = r.route_id
            LEFT JOIN Drivers d
                ON r.driver_id = d.driver_id
            LEFT JOIN Vehicles v
                ON r.vehicle_id = v.vehicle_id
            WHERE b.fill_level_percent >= 80
            ORDER BY b.fill_level_percent DESC
        """)

        columns = [col[0].lower() for col in cursor.description]

        data = [
            dict(zip(columns, row))
            for row in cursor.fetchall()
        ]

        return jsonify(data), 200

    except oracledb.Error as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ============================================================
# 9. COMPLETE BIN PICKUP
# Calls PL/SQL procedure
# ============================================================

@app.route('/api/pickup', methods=['POST'])
def complete_pickup():

    conn = None
    cursor = None

    try:

        body = request.get_json()

        if not body:
            return jsonify({
                "status": "error",
                "message": "Request body is required."
            }), 400

        bin_id = body.get('bin_id')
        driver_id = body.get('driver_id')

        if bin_id is None or driver_id is None:
            return jsonify({
                "status": "error",
                "message": "bin_id and driver_id are required."
            }), 400

        conn = get_connection()
        cursor = conn.cursor()

        # Call PL/SQL procedure
        cursor.callproc(
            'prc_complete_bin_pickup',
            [bin_id, driver_id]
        )

        return jsonify({
            "status": "success",
            "message": f"Bin {bin_id} pickup completed."
        }), 200

    except oracledb.Error as e:

        if conn:
            conn.rollback()

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 400

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# ============================================================
# START FLASK SERVER
# ============================================================

if __name__ == '__main__':
    app.run(
        debug=True,
        port=5000
    )