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
# FEATURE 0: DASHBOARD
# ============================================================

@app.route('/api/dashboard', methods=['GET'])
def get_dashboard():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        # ----------------------------------------------------
        # TOTAL BINS
        # ----------------------------------------------------

        cursor.execute("""
            SELECT COUNT(*)
            FROM Bins
        """)

        total_bins = cursor.fetchone()[0]

        # ----------------------------------------------------
        # TOTAL ROUTES
        # ----------------------------------------------------

        cursor.execute("""
            SELECT COUNT(*)
            FROM Routes
        """)

        total_routes = cursor.fetchone()[0]

        # ----------------------------------------------------
        # CRITICAL BINS
        # Critical threshold: 80%
        # ----------------------------------------------------

        cursor.execute("""
            SELECT COUNT(*)
            FROM Bins
            WHERE fill_level_percent >= 80
        """)

        critical_bins = cursor.fetchone()[0]

        # ----------------------------------------------------
        # AVERAGE BIN FILL
        # ----------------------------------------------------

        cursor.execute("""
            SELECT AVG(fill_level_percent)
            FROM Bins
        """)

        average_fill = cursor.fetchone()[0]

        return jsonify({
            "total_bins": total_bins,
            "total_routes": total_routes,
            "critical_bins": critical_bins,
            "average_fill": (
                float(average_fill)
                if average_fill is not None
                else 0
            )
        }), 200

    except oracledb.Error as e:

        print("Dashboard error:", e)

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
# FEATURE 1: BIN MONITORING
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
                b.fill_level_percent,

                CASE
                    WHEN b.fill_level_percent >= 80
                        THEN 'Critical'
                    WHEN b.fill_level_percent >= 50
                        THEN 'Warning'
                    ELSE 'Normal'
                END AS bin_status

            FROM Bins b

            JOIN Locations l
                ON b.location_id = l.location_id

            JOIN Zones z
                ON l.zone_id = z.zone_id

            ORDER BY b.bin_id
        """)

        columns = [
            col[0].lower()
            for col in cursor.description
        ]

        data = [
            dict(zip(columns, row))
            for row in cursor.fetchall()
        ]

        return jsonify(data), 200

    except oracledb.Error as e:

        print("Bin Monitoring error:", e)

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
# FEATURE 2: ZONE ANALYSIS
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

                AVG(b.fill_level_percent)
                    AS average_fill_level,

                SUM(
                    CASE
                        WHEN b.fill_level_percent >= 80
                            THEN 1
                        ELSE 0
                    END
                ) AS critical_bins,

                CASE
                    WHEN AVG(b.fill_level_percent) >= 90
                        THEN 5
                    WHEN AVG(b.fill_level_percent) >= 70
                        THEN 4
                    WHEN AVG(b.fill_level_percent) >= 50
                        THEN 3
                    WHEN AVG(b.fill_level_percent) >= 25
                        THEN 2
                    ELSE 1
                END AS waste_priority

            FROM Zones z

            LEFT JOIN Locations l
                ON z.zone_id = l.zone_id

            LEFT JOIN Bins b
                ON l.location_id = b.location_id

            GROUP BY
                z.zone_id,
                z.zone_name,
                z.city

            ORDER BY average_fill_level DESC
        """)

        columns = [
            col[0].lower()
            for col in cursor.description
        ]

        data = [
            dict(zip(columns, row))
            for row in cursor.fetchall()
        ]

        return jsonify(data), 200

    except oracledb.Error as e:

        print("Zone analysis error:", e)

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
# ZONE COLLECTION RECOMMENDATION
# ============================================================

@app.route('/api/zones/recommendation', methods=['GET'])
def get_zone_recommendation():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                z.zone_id,
                z.zone_name,
                z.priority_level,

                AVG(b.fill_level_percent)
                    AS average_fill_level,

                CASE
                    WHEN AVG(b.fill_level_percent) >= 80
                        THEN 'Collection Required'
                    WHEN AVG(b.fill_level_percent) >= 50
                        THEN 'Monitor'
                    ELSE 'No Immediate Action'
                END AS collection_recommendation

            FROM Zones z

            JOIN Locations l
                ON z.zone_id = l.zone_id

            JOIN Bins b
                ON l.location_id = b.location_id

            GROUP BY
                z.zone_id,
                z.zone_name,
                z.priority_level

            ORDER BY AVG(b.fill_level_percent) DESC
        """)

        columns = [
            col[0].lower()
            for col in cursor.description
        ]

        data = [
            dict(zip(columns, row))
            for row in cursor.fetchall()
        ]

        return jsonify(data), 200

    except oracledb.Error as e:

        print("Zone recommendation error:", e)

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
# FEATURE 2: ROUTE MANAGEMENT
# ============================================================


# ============================================================
# ROUTE OVERVIEW
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

                CASE
                    WHEN d.driver_id IS NULL
                        THEN 'Unassigned'
                    ELSE d.first_name || ' ' || d.last_name
                END AS driver_name,

                CASE
                    WHEN v.vehicle_id IS NULL
                        THEN 'Unassigned'
                    ELSE v.registration_number
                END AS vehicle,

                COUNT(rb.bin_id) AS stop_count

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
                d.driver_id,
                d.first_name,
                d.last_name,
                v.vehicle_id,
                v.registration_number

            ORDER BY r.route_id
        """)

        rows = cursor.fetchall()

        routes = []

        for row in rows:

            routes.append({
                "route_id": row[0],
                "route_name": row[1],
                "zone_name": row[2],
                "driver_name": row[3] or "Unassigned",
                "vehicle": row[4] or "Unassigned",
                "stop_count": row[5]
            })

        return jsonify(routes), 200

    except oracledb.Error as e:

        print("Route overview error:", e)

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
# GET AVAILABLE DRIVERS
# ============================================================
@app.route('/api/drivers', methods=['GET'])
def get_drivers():
    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                driver_id,
                first_name,
                last_name,
                status
            FROM Drivers
            WHERE UPPER(TRIM(status)) = 'AVAILABLE'
            ORDER BY driver_id
        """)

        drivers = []

        for row in cursor.fetchall():
            drivers.append({
                "driver_id": row[0],
                "first_name": row[1],
                "last_name": row[2],
                "status": row[3]
            })

        return jsonify(drivers)

    except oracledb.Error as e:
        print("Drivers API Error:", e)

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
# GET AVAILABLE VEHICLES
# ============================================================
@app.route('/api/vehicles', methods=['GET'])
def get_vehicles():
    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                vehicle_id,
                registration_number,
                capacity_kg,
                status
            FROM Vehicles
            WHERE UPPER(TRIM(status)) = 'AVAILABLE'
            ORDER BY registration_number
        """)

        vehicles = []

        for row in cursor.fetchall():
            vehicles.append({
                "vehicle_id": row[0],
                "registration_number": row[1],
                "capacity_kg": row[2],
                "status": row[3]
            })

        return jsonify(vehicles)

    except oracledb.Error as e:
        print("Vehicles API Error:", e)

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
# GET ROUTE STOPS
# ============================================================

@app.route('/api/routes/<int:route_id>/stops', methods=['GET'])
def get_route_stops(route_id):

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                rb.stop_sequence,
                b.bin_id,
                l.street_address,
                z.zone_name,
                b.fill_level_percent,
                rb.collection_status

            FROM Route_Bins rb

            JOIN Bins b
                ON rb.bin_id = b.bin_id

            JOIN Locations l
                ON b.location_id = l.location_id

            JOIN Zones z
                ON l.zone_id = z.zone_id

            WHERE rb.route_id = :route_id

            ORDER BY rb.stop_sequence
        """, {
            "route_id": route_id
        })

        rows = cursor.fetchall()

        stops = []

        for row in rows:

            fill_level = (
                float(row[4])
                if row[4] is not None
                else 0
            )

            # Same thresholds used in Bin Monitoring
            if fill_level >= 80:
                priority = "Critical"

            elif fill_level >= 50:
                priority = "Warning"

            else:
                priority = "Normal"

            stops.append({
                "stop_sequence": row[0],
                "bin_id": row[1],
                "street_address": row[2],
                "zone_name": row[3],
                "fill_level_percent": fill_level,
                "priority": priority,
                "collection_status": row[5]
            })

        return jsonify(stops), 200

    except oracledb.Error as e:

        print("Route stops error:", e)

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
# ASSIGN DRIVER TO ROUTE
# ============================================================

@app.route('/api/routes/driver', methods=['PUT'])
def assign_driver():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        body = request.get_json()

        if not body:
            return jsonify({
                "status": "error",
                "message": "Request body is required."
            }), 400

        route_id = body.get('route_id')
        driver_id = body.get('driver_id')

        if route_id is None or driver_id is None:
            return jsonify({
                "status": "error",
                "message": "Route and driver are required."
            }), 400

        # ----------------------------------------------------
        # CHECK ROUTE
        # ----------------------------------------------------

        cursor.execute("""
            SELECT route_id
            FROM Routes
            WHERE route_id = :route_id
        """, {
            "route_id": route_id
        })

        if not cursor.fetchone():
            return jsonify({
                "status": "error",
                "message": "Route not found."
            }), 404

        # ----------------------------------------------------
        # CHECK DRIVER
        # ----------------------------------------------------

        cursor.execute("""
            SELECT driver_id
            FROM Drivers
            WHERE driver_id = :driver_id
        """, {
            "driver_id": driver_id
        })

        if not cursor.fetchone():
            return jsonify({
                "status": "error",
                "message": "Driver not found."
            }), 404

        # ----------------------------------------------------
        # ASSIGN DRIVER
        # ----------------------------------------------------

        cursor.execute("""
            UPDATE Routes
            SET driver_id = :driver_id
            WHERE route_id = :route_id
        """, {
            "driver_id": driver_id,
            "route_id": route_id
        })

        conn.commit()

        return jsonify({
            "status": "success",
            "message": "Driver assigned successfully."
        }), 200

    except oracledb.Error as e:

        if conn:
            conn.rollback()

        print("Driver assignment error:", e)

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
# ASSIGN VEHICLE TO ROUTE
# ============================================================

@app.route('/api/routes/vehicle', methods=['PUT'])
def assign_vehicle():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        body = request.get_json()

        if not body:
            return jsonify({
                "status": "error",
                "message": "Request body is required."
            }), 400

        route_id = body.get('route_id')
        vehicle_id = body.get('vehicle_id')

        if route_id is None or vehicle_id is None:
            return jsonify({
                "status": "error",
                "message": "Route and vehicle are required."
            }), 400

        # ----------------------------------------------------
        # CHECK ROUTE
        # ----------------------------------------------------

        cursor.execute("""
            SELECT route_id
            FROM Routes
            WHERE route_id = :route_id
        """, {
            "route_id": route_id
        })

        if not cursor.fetchone():
            return jsonify({
                "status": "error",
                "message": "Route not found."
            }), 404

        # ----------------------------------------------------
        # CHECK VEHICLE
        # ----------------------------------------------------

        cursor.execute("""
            SELECT status
            FROM Vehicles
            WHERE vehicle_id = :vehicle_id
        """, {
            "vehicle_id": vehicle_id
        })

        vehicle = cursor.fetchone()

        if not vehicle:
            return jsonify({
                "status": "error",
                "message": "Vehicle not found."
            }), 404

        if vehicle[0] != 'Available':
            return jsonify({
                "status": "error",
                "message": "Vehicle is not operational."
            }), 400

        # ----------------------------------------------------
        # CHECK VEHICLE AVAILABILITY
        # ----------------------------------------------------

        cursor.execute("""
            SELECT COUNT(*)

            FROM Routes r

            JOIN Schedules s
                ON r.route_id = s.route_id

            WHERE r.vehicle_id = :vehicle_id

            AND s.status IN (
                'Scheduled',
                'In Progress'
            )

            AND r.route_id <> :route_id
        """, {
            "vehicle_id": vehicle_id,
            "route_id": route_id
        })

        vehicle_in_use = cursor.fetchone()[0]

        if vehicle_in_use > 0:
            return jsonify({
                "status": "error",
                "message":
                    "Vehicle is already assigned to another active route."
            }), 400

        # ----------------------------------------------------
        # ASSIGN VEHICLE
        # ----------------------------------------------------

        cursor.execute("""
            UPDATE Routes
            SET vehicle_id = :vehicle_id
            WHERE route_id = :route_id
        """, {
            "vehicle_id": vehicle_id,
            "route_id": route_id
        })

        conn.commit()

        return jsonify({
            "status": "success",
            "message": "Vehicle assigned successfully."
        }), 200

    except oracledb.Error as e:

        if conn:
            conn.rollback()

        print("Vehicle assignment error:", e)

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
# FEATURE 3: TODAY'S COLLECTION SCHEDULE
# Shows only today's collection schedules
# ============================================================

@app.route('/api/schedules', methods=['GET'])
def get_collection_schedule():

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                s.schedule_id,

                TO_CHAR(s.scheduled_date, 'DD-MM-YYYY')
                    AS scheduled_date,

                r.route_id,
                r.route_name,

                s.start_time,
                s.end_time,
                s.status

            FROM Schedules s

            JOIN Routes r
                ON s.route_id = r.route_id

            WHERE TRUNC(s.scheduled_date) = TRUNC(SYSDATE)

            ORDER BY
                s.start_time
        """)

        rows = cursor.fetchall()

        schedules = []

        for row in rows:

            start_time = row[4]
            end_time = row[5]

            schedules.append({
                "schedule_id": row[0],
                "scheduled_date": row[1] or "N/A",
                "route_id": row[2],
                "route_name": row[3] or "N/A",

                "start_time": (
                    str(start_time)
                    if start_time else "N/A"
                ),

                "end_time": (
                    str(end_time)
                    if end_time else "N/A"
                ),

                "status": row[6] or "Scheduled"
            })

        return jsonify(schedules), 200

    except oracledb.Error as e:

        print("Collection schedule error:", e)

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
# FEATURE 4: PICKUP MANAGEMENT
# ============================================================


# ============================================================
# COLLECTION VIEW
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
                s.schedule_id,
                b.bin_id,
                l.street_address,
                z.zone_name,
                b.fill_level_percent,

                r.route_id,
                r.route_name,

                d.first_name || ' ' || d.last_name
                    AS driver_name,

                v.registration_number
                    AS vehicle,

                rb.stop_sequence,
                rb.collection_status

            FROM Schedules s

            JOIN Routes r
                ON s.route_id = r.route_id

            JOIN Route_Bins rb
                ON r.route_id = rb.route_id

            JOIN Bins b
                ON rb.bin_id = b.bin_id

            JOIN Locations l
                ON b.location_id = l.location_id

            JOIN Zones z
                ON l.zone_id = z.zone_id

            LEFT JOIN Drivers d
                ON r.driver_id = d.driver_id

            LEFT JOIN Vehicles v
                ON r.vehicle_id = v.vehicle_id

            WHERE TRUNC(s.scheduled_date) = TRUNC(CURRENT_DATE)

            AND s.status IN (
                'Scheduled',
                'In Progress'
            )

            AND NVL(rb.collection_status, 'Pending') <> 'Completed'

            AND b.fill_level_percent >= 75

            ORDER BY
                s.start_time,
                rb.stop_sequence
        """)

        rows = cursor.fetchall()

        collections = []

        for row in rows:

            collections.append({
                "schedule_id": row[0],
                "bin_id": row[1],
                "street_address": row[2],
                "zone_name": row[3],
                "fill_level_percent": (
                    float(row[4])
                    if row[4] is not None
                    else 0
                ),
                "route_id": row[5],
                "route_name": row[6],
                "driver_name": row[7] or "Unassigned",
                "vehicle": row[8] or "Unassigned",
                "stop_sequence": row[9],
                "collection_status": row[10]
            })

        return jsonify(collections), 200

    except oracledb.Error as e:

        print("Pickup Management error:", e)

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
# 7. COMPLETE BIN PICKUP
# ============================================================
@app.route('/api/pickup', methods=['POST'])
def complete_pickup():
    data = request.get_json() or {}

    print("Pickup request data:", data)

    schedule_id = data.get('schedule_id')
    route_id = data.get('route_id')
    bin_id = data.get('bin_id')

    if not schedule_id or not route_id or not bin_id:
        return jsonify({
            "error": "Schedule ID, Route ID and Bin ID are required"
        }), 400

    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.callproc(
            "COMPLETE_BIN_PICKUP",
            [
                int(schedule_id),
                int(route_id),
                int(bin_id)
            ]
        )

        conn.commit()

        return jsonify({
            "message": "Selected bin pickup completed successfully.",
            "schedule_id": schedule_id,
            "route_id": route_id,
            "bin_id": bin_id
        }), 200

    except Exception as e:
        conn.rollback()

        error_message = str(e)
        print("Pickup procedure error:", error_message)

        return jsonify({
            "error": error_message
        }), 400

    finally:
        cursor.close()
        conn.close()
# ============================================================
# CANCEL PICKUP
# ============================================================

@app.route('/api/schedules/<int:schedule_id>/cancel', methods=['PUT'])
def cancel_schedule(schedule_id):
    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        # ----------------------------------------------------
        # Check whether the schedule exists
        # ----------------------------------------------------
        cursor.execute("""
            SELECT status
            FROM Schedules
            WHERE schedule_id = :schedule_id
        """, {
            "schedule_id": schedule_id
        })

        schedule = cursor.fetchone()

        if not schedule:
            return jsonify({
                "status": "error",
                "message": "Schedule not found"
            }), 404

        current_status = schedule[0]

        normalized_status = (
            current_status.strip().upper()
            if current_status
            else ""
        )

        # ----------------------------------------------------
        # Prevent cancelling completed/cancelled schedules
        # ----------------------------------------------------
        if normalized_status in ("COMPLETED", "CANCELLED"):
            return jsonify({
                "status": "error",
                "message": "This schedule cannot be cancelled"
            }), 400

        # ----------------------------------------------------
        # Mark schedule as cancelled
        # Driver and vehicle assignments are preserved
        # ----------------------------------------------------
        cursor.execute("""
            UPDATE Schedules
            SET status = 'Cancelled'
            WHERE schedule_id = :schedule_id
        """, {
            "schedule_id": schedule_id
        })

        # ----------------------------------------------------
        # Do NOT clear driver_id or vehicle_id from Routes.
        # Their assignments must remain visible in
        # Today's Driver Schedule.
        # ----------------------------------------------------

        conn.commit()

        return jsonify({
            "status": "success",
            "message": "Schedule cancelled successfully."
        })

    except oracledb.Error as e:
        if conn:
            conn.rollback()

        print("Cancel Schedule Error:", e)

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
# START FLASK SERVER
# ============================================================

if __name__ == '__main__':
    app.run(debug=True)
