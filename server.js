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

// --- Express Routes ---
app.get('/', (req, res) => res.render('about'));
app.get('/driver', (req, res) => res.render('driver'));

app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const query = `
            INSERT INTO users (username, email, password)
            VALUES ($1, $2, $3)
            RETURNING id, username, email;
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
        res.status(500).render('login', { error: 'An error occurred.' });
    }
});

app.get('/patient', ensureAuthenticated, (req, res) => {
    res.render('patient', { user: req.session.user });
});

// Consultation Page Route
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

// --- Socket.io Real-time Logic ---
const activeVehicles = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 1. Emergency Requests & Hospital Matching
    socket.on('emergency-request', async function (data = {}) {
        try {
            const query = `
                INSERT INTO incidents (description, latitude, longitude, status)
                VALUES ($1, $2, $3, 'open')
                RETURNING *;
            `;
            const values = [data.description || 'Medical Emergency', data.latitude, data.longitude];
            const result = await pool.query(query, values);
            io.emit('new-incident', result.rows[0]);
        } catch (err) {
            console.error('Error handling emergency request:', err.message);
        }
    });

    // 2. Location Tracking & Logging
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

    // 3. Ambulance Status Updates
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

    // 4. WebRTC Signaling for Video Consultation (Properly Nested)
    socket.on('join-room', (data) => {
        const roomName = data && data.room ? data.room : 'emergency-consultation';
        socket.join(roomName);
        console.log(`User ${socket.id} joined video room: ${roomName}`);
        socket.to(roomName).emit('user-joined', socket.id);
    });

    socket.on('offer', (data) => {
        if (data && data.room) {
            socket.to(data.room).emit('offer', data.offer);
        }
    });

    socket.on('answer', (data) => {
        if (data && data.room) {
            socket.to(data.room).emit('answer', data.answer);
        }
    });

    socket.on('ice-candidate', (data) => {
        if (data && data.room) {
            socket.to(data.room).emit('ice-candidate', data.candidate);
        }
    });

    // 5. Disconnect Handling
    socket.on('disconnect', () => {
        delete activeVehicles[socket.id];
        io.emit('user-disconnected', socket.id);
        console.log(`User disconnected: ${socket.id}`);
    });
});

//6 Adding a  wallet upon request of amabulance driver  
// View user wallet balance on patient profile
app.get('/patient', ensureAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT username, email, wallet_balance FROM users WHERE id = $1', [req.session.user.id]);
        const currentUser = result.rows[0];
        res.render('patient', { user: currentUser });
    } catch (err) {
        console.error('Error fetching wallet balance:', err.message);
        res.render('patient', { user: req.session.user });
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
            SET wallet_balance = wallet_balance + $1 
            WHERE id = $2 
            RETURNING wallet_balance;
        `;
        const result = await pool.query(query, [amount, userId]);
        
        // Update session balance as well
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

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});