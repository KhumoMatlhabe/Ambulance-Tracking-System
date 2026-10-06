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

// Routes
app.get('/', (req, res) => res.render('about'));
app.get('/driver', (req, res) => res.render('driver'));

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    req.session.user = { username };
    res.redirect('/patient');
});

app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><title>Patient Login</title></head>
        <body>
            <h2>Patient Login</h2>
            <form action="/login" method="POST">
                <input type="email" name="email" placeholder="Enter your email" required />
                <input type="password" name="password" placeholder="Enter your password" required />
                <button type="submit">Log In</button>
            </form>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.redirect('/login');
    req.session.user = { email };
    return res.redirect('/patient');
});

app.get('/patient', ensureAuthenticated, (req, res) => {
    res.render('patient', { user: req.session.user });
});

// Socket.io Real-time Logic
const activeVehicles = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 1. Emergency Requests
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

    // 2. Location Tracking
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

    // 3. Ambulance Status Updates (Fixed & Properly Nested)
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

    // 4. Disconnect Handling
    socket.on('disconnect', () => {
        delete activeVehicles[socket.id];
        io.emit('user-disconnected', socket.id);
        console.log(`User disconnected: ${socket.id}`);
    });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});