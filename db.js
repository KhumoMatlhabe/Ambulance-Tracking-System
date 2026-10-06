require('dotenv').config();
const { Pool } = require('pg');
const { io, activeVehicles } = require('./server');


const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Optional: Listen for pool errors safely
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
});


module.exports = pool;
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 1. Emergency Requests & Nearest Facility Matching
    socket.on('emergency-request', async function (data = {}) {
        try {
            const { description, latitude, longitude } = data;

            // Save the incident to the PostgreSQL database
            const incidentQuery = `
                INSERT INTO incidents (description, latitude, longitude, status)
                VALUES ($1, $2, $3, 'open')
                RETURNING *;
            `;
            const incidentResult = await pool.query(incidentQuery, [
                description || 'Medical Emergency',
                latitude,
                longitude
            ]);
            const newIncident = incidentResult.rows[0];

            // Find the nearest hospital using the Haversine formula (distance in km)
            const hospitalQuery = `
                SELECT name, latitude, longitude,
                (
                    6371 * acos(
                        cos(radians($1)) * cos(radians(latitude)) *
                        cos(radians(longitude) - radians($2)) +
                        sin(radians($1)) * sin(radians(latitude))
                    )
                ) AS distance_km
                FROM hospitals
                ORDER BY distance_km ASC
                LIMIT 1;
            `;
            const hospitalResult = await pool.query(hospitalQuery, [latitude, longitude]);
            const nearestHospital = hospitalResult.rows[0] || null;

            // Broadcast the new incident along with the nearest hospital details
            io.emit('new-incident', {
                ...newIncident,
                nearestHospital
            });
        } catch (err) {
            console.error('Error handling emergency request and facility matching:', err.message);
        }
    });

    // 2. Location Tracking & Logging
    socket.on('send-location', async (data = {}) => {
        const { vehicleId, latitude, longitude } = data;
        activeVehicles[socket.id] = { latitude, longitude };
        io.emit('receive-location', {
            id: socket.id, ...data


        });
    }); try { } catch (err) {
        console.error('Error handling emergency request:', err.message, err.stack);
    }
}
);
