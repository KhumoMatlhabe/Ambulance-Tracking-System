// server.js
const express = require('express');
const http = require('http');
require('dotenv').config();
console.log("Database URL loaded:", process.env.DATABASE_URL ? "Yes (Length: " + process.env.DATABASE_URL.length + ")" : "NO - MISSING!");
const socketio = require('socket.io');
const session = require('express-session');
const path = require('path');
const pool = require('./db');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// App Configurations
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'ambulance-tracking-secret-key',
    resave: false,
    saveUninitialized: false
}));

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destruction error:', err);
        }
        res.redirect('/login');
    });
});

// --- Authentication Middleware ---
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    return res.redirect('/login');
}

function ensureAdmin(req, res, next) {
    if (req.session && req.session.user && (req.session.user.role === 'Administrator' || req.session.user.role === 'admin')) {
        return next();
    }
    return res.redirect('/admin-login');
}

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// --- Public Views ---
app.get('/', (req, res) => res.render('about'));

// --- Patient Authentication & Portal Routes ---
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const query = `
            INSERT INTO patients (username, email, password, wallet_balance)
            VALUES ($1, $2, $3, 0.00)
            RETURNING id, username, email, wallet_balance;
        `;
        const result = await pool.query(query, [username || email.split('@')[0], email, password]);
        req.session.user = { ...result.rows[0], userType: 'patient' };
        res.redirect('/patient');
    } catch (err) {
        console.error('Patient registration error:', err.message);
        res.status(400).render('register', { error: 'Registration failed. Email or username may already be in use.' });
    }
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.render('login', { error: 'Please fill in all fields.' });
    }
    try {
        const result = await pool.query(`SELECT * FROM patients WHERE email = $1 AND password = $2`, [email, password]);
        if (result.rows.length === 0) {
            return res.render('login', { error: 'Invalid patient credentials.' });
        }
        req.session.user = { ...result.rows[0], userType: 'patient' };
        return res.redirect('/patient');
    } catch (err) {
        console.error('Patient login error:', err.message);
        res.status(500).render('login', { error: 'An error occurred during login.' });
    }
});

app.get('/patient', ensureAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, wallet_balance FROM patients WHERE id = $1', [req.session.user.id]);
        const currentUser = result.rows[0] || req.session.user;
        res.render('patient', { user: currentUser });
    } catch (err) {
        console.error('Error fetching patient details:', err.message);
        res.render('patient', { user: req.session.user });
    }
});

app.get('/consultation', ensureAuthenticated, (req, res) => {
    res.render('consultation', { user: req.session.user });
});

// --- Driver Authentication & Portal Routes ---
app.get('/driver-login', (req, res) => res.render('driver-login', { error: null }));

app.post('/driver-login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.render('driver-login', { error: 'Please fill in all fields.' });
    }
    try {
        const result = await pool.query(`SELECT * FROM drivers WHERE email = $1 AND password = $2`, [email, password]);
        if (result.rows.length === 0) {
            return res.render('driver-login', { error: 'Invalid driver credentials.' });
        }
        req.session.user = { ...result.rows[0], userType: 'driver' };
        return res.redirect('/driver');
    } catch (err) {
        console.error('Driver login error:', err.message);
        res.status(500).render('driver-login', { error: 'An error occurred during login.' });
    }
});

app.get('/driver-register', (req, res) => res.render('driver-register', { error: null }));

app.post('/driver-register', async (req, res) => {
    const { username, email, password, vehicle_id } = req.body;
    try {
        const query = `
            INSERT INTO drivers (username, email, password, availability_status, vehicle_id)
            VALUES ($1, $2, $3, 'Online', $4)
            RETURNING id, username, email, availability_status;
        `;
        const result = await pool.query(query, [username, email, password, vehicle_id || 'Ambulance-101']);
        req.session.user = { ...result.rows[0], userType: 'driver' };
        res.redirect('/driver');
    } catch (err) {
        console.error('Driver registration error:', err.message);
        res.status(400).render('driver-register', { error: 'Registration failed. Email or username may already be in use.' });
    }
});

app.get('/driver', ensureAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, availability_status FROM drivers WHERE id = $1', [req.session.user.id]);
        const currentDriver = result.rows[0] || req.session.user;
        res.render('driver', { user: currentDriver });
    } catch (err) {
        console.error('Error fetching driver details:', err.message);
        res.render('driver', { user: req.session.user });
    }
});

// --- Admin / Staff Authentication & Dashboard Routes ---
app.get('/admin-register', (req, res) => res.render('admin-register', { error: null }));

app.post('/admin-register', async (req, res) => {
    const { name, email, password, role } = req.body;
    try {
        const query = `
            INSERT INTO staff (name, email, password, role, status)
            VALUES ($1, $2, $3, $4, 'Active')
            RETURNING *;
        `;
        const result = await pool.query(query, [name, email, password, role || 'Administrator']);
        req.session.user = { ...result.rows[0], userType: 'staff' };
        res.redirect('/admin');
    } catch (err) {
        console.error('Staff registration error:', err.message);
        res.status(400).render('admin-register', { error: 'Registration failed. Email may already be in use.' });
    }
});

app.get('/admin-login', (req, res) => res.render('admin-login', { error: null }));

app.post('/admin-login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.render('admin-login', { error: 'Please fill in all fields.' });
    }
    try {
        const result = await pool.query(`SELECT * FROM staff WHERE email = $1 AND password = $2`, [email, password]);
        if (result.rows.length === 0) {
            return res.render('admin-login', { error: 'Invalid staff email or password.' });
        }
        req.session.user = { ...result.rows[0], userType: 'staff' };
        return res.redirect('/admin');
    } catch (err) {
        console.error('Staff login error:', err.message);
        res.status(500).render('admin-login', { error: 'An error occurred during login.' });
    }
});

app.get('/admin', ensureAdmin, async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) AS total_incidents,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_incidents,
                SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS assigned_incidents
            FROM incidents;
        `;
        const statsResult = await pool.query(statsQuery);
        const incidents = await pool.query('SELECT * FROM incidents ORDER BY created_at DESC');
        const drivers = await pool.query('SELECT * FROM drivers');
        const appointments = await pool.query('SELECT * FROM appointments ORDER BY appointment_date ASC');
        const staffResult = await pool.query('SELECT * FROM staff ORDER BY created_at DESC;');
        
        res.render('admin', { 
            user: { username: req.session.user.name || req.session.user.username }, 
            stats: statsResult.rows[0] || { total_incidents: 0, open_incidents: 0, assigned_incidents: 0 },
            incidents: incidents.rows,
            drivers: drivers.rows,
            appointments: appointments.rows,
            staff: staffResult.rows 
        });
    } catch (err) {
        console.error('Admin dashboard error:', err.message);
        res.status(500).send('Server Error');
    }
});

app.post('/admin/appointments/:id/confirm', ensureAdmin, async (req, res) => {
    const appointmentId = req.params.id;
    try {
        await pool.query("UPDATE appointments SET status = 'Confirmed' WHERE id = $1", [appointmentId]);
        res.redirect('/admin');
    } catch (err) {
        console.error('Error confirming appointment:', err.message);
        res.status(500).send('Error updating appointment status');
    }
});

// --- API Endpoints ---
app.post('/api/staff/add', ensureAdmin, async (req, res) => {
    const { name, email, role, password } = req.body;
    if (!name || !email || !role) {
        return res.status(400).json({ success: false, error: 'Please provide name, email, and role.' });
    }
    try {
        const query = `
            INSERT INTO staff (name, email, password, role, status)
            VALUES ($1, $2, $3, $4, 'Active')
            RETURNING id, name, email, role;
        `;
        const result = await pool.query(query, [name, email, password || 'defaultpassword123', role]);
        res.status(200).json({ success: true, staff: result.rows[0] });
    } catch (err) {
        console.error('Error adding staff member:', err.message);
        if (err.code === '23505') {
            return res.status(400).json({ success: false, error: 'A staff member with this email already exists.' });
        }
        res.status(500).json({ success: false, error: 'Failed to add staff member. Email may already exist.' });
    }
});

app.post('/api/book-appointment', ensureAuthenticated, async (req, res) => {
    const { appointment_date, symptoms, hospital_name } = req.body;
    const patientId = req.session.user.id;
    const patientEmail = req.session.user.email;

    try {
        const query = `
            INSERT INTO appointments (patient_id, patient_email, appointment_date, symptoms, hospital_name, status)
            VALUES ($1, $2, $3, $4, $5, 'Pending')
            RETURNING id, appointment_date, hospital_name, status;
        `;
        const result = await pool.query(query, [patientId, patientEmail, appointment_date, symptoms, hospital_name || 'General Facility']);
        res.json({ success: true, appointment: result.rows[0] });
    } catch (err) {
        console.error('Appointment booking error:', err.message);
        res.status(500).json({ success: false, error: 'Database error while booking.' });
    }
});

app.post('/api/wallet/topup', ensureAuthenticated, async (req, res) => {
    const { amount } = req.body;
    const userId = req.session.user.id;

    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid top-up amount.' });
    }

    try {
        const query = `
            UPDATE patients 
            SET wallet_balance = COALESCE(wallet_balance, 0) + $1 
            WHERE id = $2 
            RETURNING wallet_balance;
        `;
        const result = await pool.query(query, [amount, userId]);
        req.session.user.wallet_balance = result.rows[0].wallet_balance;

        res.status(200).json({ 
            success: true, 
            newBalance: result.rows[0].wallet_balance 
        });
    } catch (err) {
        console.error('Wallet top-up error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to update wallet balance.' });
    }
});

app.get('/api/incidents/history', ensureAuthenticated, async (req, res) => {
    try {
        const query = `
            SELECT id, description, latitude, longitude, status, claimed_by, created_at, completed_at
            FROM incidents
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query);
        res.status(200).json({ success: true, incidents: result.rows });
    } catch (err) {
        console.error('Error fetching incident history:', err.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve incident audit log.' });
    }
});

app.get('/api/admin/drivers', ensureAdmin, async (req, res) => {
    try {
        const query = `SELECT id, username, email, COALESCE(availability_status, 'Online') AS availability_status FROM drivers ORDER BY id DESC;`;
        const result = await pool.query(query);
        res.status(200).json({ success: true, drivers: result.rows });
    } catch (err) {
        console.error('Error fetching drivers:', err.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve fleet drivers.' });
    }
});

app.post('/api/admin/driver/status', ensureAdmin, async (req, res) => {
    const { driverId, status } = req.body;
    try {
        const query = `UPDATE drivers SET availability_status = $1 WHERE id = $2 RETURNING id, username, availability_status;`;
        const result = await pool.query(query, [status, driverId]);
        res.status(200).json({ success: true, driver: result.rows[0] });
    } catch (err) {
        console.error('Error updating driver status:', err.message);
        res.status(500).json({ success: false, error: 'Failed to update status.' });
    }
});

app.post('/api/admin/assign-incident', ensureAdmin, async (req, res) => {
    const { incidentId, driverId } = req.body;
    if (!incidentId || !driverId) {
        return res.status(400).json({ success: false, error: 'Incident ID and Driver ID are required.' });
    }
    try {
        const query = `
            UPDATE incidents 
            SET status = 'assigned', claimed_by = $1 
            WHERE id = $2 
            RETURNING *;
        `;
        const result = await pool.query(query, [driverId, incidentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Incident not found.' });
        }
        const updatedIncident = result.rows[0];
        io.emit('incident-assigned', {
            incidentId: updatedIncident.id,
            driverId: driverId,
            status: updatedIncident.status
        });
        res.status(200).json({ success: true, incident: updatedIncident });
    } catch (err) {
        console.error('Error assigning ambulance:', err.message);
        res.status(500).json({ success: false, error: 'Failed to assign ambulance to incident.' });
    }
});

// --- Socket.io Real-time Logic ---
const activeVehicles = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('emergency-request', async function (data = {}) {
        try {
            const { description, latitude, longitude } = data;

            // 1. Check for an available online driver to auto-assign
            const driverQuery = `
                SELECT id FROM drivers 
                WHERE availability_status = 'Online' 
                ORDER BY id ASC 
                LIMIT 1;
            `;
            const driverResult = await pool.query(driverQuery);
            const assignedDriver = driverResult.rows[0] || null;

            const incidentStatus = assignedDriver ? 'assigned' : 'open';
            const claimedBy = assignedDriver ? assignedDriver.id : null;

            // 2. Insert incident into database with auto-assigned status
            const incidentQuery = `
                INSERT INTO incidents (description, latitude, longitude, status, claimed_by)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
            `;
            const incidentResult = await pool.query(incidentQuery, [
                description || 'Medical Emergency',
                latitude,
                longitude,
                incidentStatus,
                claimedBy
            ]);
            const newIncident = incidentResult.rows[0];

            // 3. Find the nearest hospital
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
                WHERE emergency_services = TRUE
                ORDER BY distance_km ASC
                LIMIT 1;
            `;
            const hospitalResult = await pool.query(hospitalQuery, [latitude, longitude]);
            const nearestHospital = hospitalResult.rows[0] || null;

            // 4. Broadcast the incident to all connected clients
            io.emit('new-incident', {
                ...newIncident,
                nearestHospital
            });

            // 5. If auto-assigned, notify the specific driver immediately
            if (assignedDriver) {
                io.emit('incident-assigned', {
                    incidentId: newIncident.id,
                    driverId: assignedDriver.id,
                    status: 'assigned'
                });
                console.log(`⚡ Auto-assigned Incident #${newIncident.id} to Driver #${assignedDriver.id}`);
            }
        } catch (err) {
            console.error('Error handling emergency request:', err.message);
        }
    });

    socket.on('accept-incident', async (data) => {
        const { incidentId, driverId } = data;
        try {
            const query = `
                UPDATE incidents 
                SET status = 'assigned', claimed_by = $1 
                WHERE id = $2 
                RETURNING *;
            `;
            const result = await pool.query(query, [driverId, incidentId]);
            
            if (result.rows.length > 0) {
                const updatedIncident = result.rows[0];
                
                io.emit('incident-accepted', {
                    incidentId: updatedIncident.id,
                    driverId: driverId || socket.id
                });
                
                console.log(`Incident #${incidentId} assigned to driver.`);
            }
        } catch (err) {
            console.error('Error accepting incident:', err.message);
        }
    });

    socket.on('decline-incident', async (data) => {
        const { incidentId, driverId } = data;
        try {
            const query = `
                UPDATE incidents 
                SET status = 'open', claimed_by = NULL 
                WHERE id = $1 
                RETURNING *;
            `;
            const result = await pool.query(query, [incidentId]);
            
            if (result.rows.length > 0) {
                io.emit('incident-declined', {
                    incidentId: incidentId,
                    driverId: driverId
                });
                
                console.log(`Incident #${incidentId} was declined by Driver #${driverId} and returned to open queue.`);
            }
        } catch (err) {
            console.error('Error declining incident:', err.message);
        }
    });

    socket.on('send-location', async (data = {}) => {
    const { vehicleId, latitude, longitude } = data;
    activeVehicles[socket.id] = { latitude, longitude };
    io.emit('receive-location', { id: socket.id, ...data });

    if (vehicleId) {
        try {
            // Verify that the driver ID actually exists in the drivers table first
            const driverCheck = await pool.query('SELECT id FROM drivers WHERE id = $1', [vehicleId]);
            if (driverCheck.rows.length > 0) {
                await pool.query(
                    'INSERT INTO location_logs (driver_id, latitude, longitude) VALUES ($1, $2, $3)',
                    [vehicleId, latitude, longitude]
                );
            }
        } catch (err) {
            console.error('Failed to log vehicle location:', err.message);
        }
    }
});

   

    socket.on('ambulance-status-update', (data) => {
        let alertMessage = `Ambulance ${data.ambulanceId} status: ${data.status}`;
        if (data.sirenActive) {
            alertMessage = `🚨 EMERGENCY: Ambulance ${data.ambulanceId} has ACTIVATED SIRENS!`;
        }
        io.emit('broadcast-alert', {
            ambulanceId: data.ambulanceId,
            message: alertMessage,
            timestamp: new Date().toLocaleTimeString(),
            status: data.status
        });
    });

    socket.on('disconnect', () => {
        delete activeVehicles[socket.id];
        io.emit('user-disconnected', socket.id);
    });
});


app.post('/api/book-appointment', ensureAuthenticated, async (req, res) => {
    const { appointment_date, symptoms, hospital_name } = req.body;
    const patientId = req.session.user.id;
    const patientEmail = req.session.user.email;

    try {
        // Verify patient exists in the database
        const patientCheck = await pool.query('SELECT id, email FROM patients WHERE id = $1', [patientId]);
        if (patientCheck.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Session expired or patient record not found. Please log in again.' });
        }

        const query = `
            INSERT INTO appointments (patient_id, patient_email, appointment_date, symptoms, hospital_name, status)
            VALUES ($1, $2, $3, $4, $5, 'Pending')
            RETURNING id, appointment_date, hospital_name, status;
        `;
        const result = await pool.query(query, [patientId, patientEmail, appointment_date, symptoms, hospital_name || 'General Facility']);
        res.json({ success: true, appointment: result.rows[0] });
    } catch (err) {
        console.error('Appointment booking error:', err.message);
        res.status(500).json({ success: false, error: 'Database error while booking.' });
    }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});