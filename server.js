// server.js
const express = require('express');
const http = require('http');
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

// Authentication Middleware
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    return res.redirect('/login');
}

// --- Express Views & Authentication Routes ---
app.get('/', (req, res) => res.render('about'));

app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const query = `
            INSERT INTO users (username, email, password, wallet_balance)
            VALUES ($1, $2, $3, 0.00)
            RETURNING id, username, email, wallet_balance;
        `;
        const values = [username || email.split('@')[0], email, password];
        const result = await pool.query(query, values);
        req.session.user = result.rows[0];
        res.redirect('/patient');
    } catch (err) {
        console.error('Registration error:', err.message);
        res.status(400).render('register', { error: 'Registration failed. Email or username may already be in use.' });
    }
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.render('login', { error: 'Please fill in all fields.' });
    }
    try {
        const query = `SELECT * FROM users WHERE email = $1 AND password = $2`;
        const result = await pool.query(query, [email, password]);
        if (result.rows.length === 0) {
            return res.render('login', { error: 'Invalid email or password.' });
        }
        req.session.user = result.rows[0];
        return res.redirect('/patient');
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).render('login', { error: 'An error occurred during login.' });
    }
});

// Driver Login Routes
app.get('/driver-login', (req, res) => {
    res.render('driver-login', { error: null });
});

app.post('/driver-login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.render('driver-login', { error: 'Please fill in all fields.' });
    }
    try {
        const query = `SELECT * FROM users WHERE email = $1 AND password = $2`;
        const result = await pool.query(query, [email, password]);
        
        if (result.rows.length === 0) {
            return res.render('driver-login', { error: 'Invalid driver email or password.' });
        }
        
        req.session.user = result.rows[0];
        return res.redirect('/driver');
    } catch (err) {
        console.error('Driver login error:', err.message);
        res.status(500).render('driver-login', { error: 'An error occurred during login.' });
    }
});

// Protected Driver Dashboard Route
app.get('/driver', ensureAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [req.session.user.id]);
        const currentDriver = result.rows[0] || req.session.user;
        res.render('driver', { user: currentDriver });
    } catch (err) {
        console.error('Error fetching driver details:', err.message);
        res.render('driver', { user: req.session.user });
    }
});

app.get('/patient', ensureAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, wallet_balance FROM users WHERE id = $1', [req.session.user.id]);
        const currentUser = result.rows[0] || req.session.user;
        res.render('patient', { user: currentUser });
    } catch (err) {
        console.error('Error fetching wallet balance:', err.message);
        res.render('patient', { user: req.session.user });
    }
});

app.get('/consultation', ensureAuthenticated, (req, res) => {
    res.render('consultation', { user: req.session.user });
});

// Handle Appointment Booking (Nearest Hospital)
app.post('/api/book-appointment', ensureAuthenticated, async (req, res) => {
    const { hospitalName, department, appointmentDate } = req.body;
    const userEmail = req.session.user.email || req.session.user.username;

    try {
        const query = `
            INSERT INTO appointments (user_email, hospital_name, department, appointment_date, status)
            VALUES ($1, $2, $3, $4, 'confirmed')
            RETURNING *;
        `;
        const result = await pool.query(query, [userEmail, hospitalName, department, appointmentDate]);
        res.status(200).json({ success: true, appointment: result.rows[0] });
    } catch (err) {
        console.error('Appointment booking error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to book appointment.' });
    }
});

// Handle adding funds to the wallet
app.post('/api/wallet/topup', ensureAuthenticated, async (req, res) => {
    const { amount } = req.body;
    const userId = req.session.user.id;

    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid top-up amount.' });
    }

    try {
        const query = `
            UPDATE users 
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

// --- Socket.io Real-time Logic ---
const activeVehicles = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 1. Emergency Requests & Nearest Hospital Matching
    socket.on('emergency-request', async function (data = {}) {
        try {
            const { description, latitude, longitude } = data;

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

            io.emit('new-incident', {
                ...newIncident,
                nearestHospital
            });
        } catch (err) {
            console.error('Error handling emergency request:', err.message);
        }
    });

    // 2. Handle Driver Accepting an Incident
    socket.on('accept-incident', async (data) => {
        const { incidentId, driverId } = data;
        try {
            const query = `
                UPDATE incidents 
                SET status = 'assigned' 
                WHERE id = $1 
                RETURNING *;
            `;
            const result = await pool.query(query, [incidentId]);
            
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

    // 3. Location Tracking & Logging
    socket.on('send-location', async (data = {}) => {
        const { vehicleId, latitude, longitude } = data;
        activeVehicles[socket.id] = { latitude, longitude };
        io.emit('receive-location', { id: socket.id, ...data });

        if (vehicleId) {
            try {
                await pool.query(
                    'INSERT INTO location_logs (vehicle_id, latitude, longitude) VALUES ($1, $2, $3)',
                    [vehicleId, latitude, longitude]
                );
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

// Fetch all past and active incidents for the audit trail log
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

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});