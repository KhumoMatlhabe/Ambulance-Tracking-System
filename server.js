const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');

const pool = require('./db'); // Connect to Neon DB

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Configure EJS view engine
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.render('about'); // Loads the about page by default at http://localhost:3000
});

app.get('/driver', (req, res) => {
    res.render('driver'); // Loads the driver map dashboard
});



app.get('/patient', (req, res) => {
    res.render('patient'); // Looks for views/patient.ejs automatically
});
///Adding the routes we can see for the patient and the driver
app.get('/', (req, res) => res.render('index'));
app.get('/patient', (req, res) => res.render('patient'));
app.get('/driver', (req, res) => res.render('driver'));

// Store connected ambulance locations in memory (or connect DB here)
const activeVehicles = {};

io.on('connection', (socket) => {
    console.log(`Vehicle/User connected: ${socket.id}`);

    // Receive live coordinates from a device
    socket.on('send-location', (data) => {
        activeVehicles[socket.id] = { latitude: data.latitude, longitude: data.longitude };
        io.emit('receive-location', { id: socket.id, ...data });
    });
    

    // Handle vehicle disconnection
    socket.on('disconnect', () => {
        delete activeVehicles[socket.id];
        io.emit('user-disconnected', socket.id);
        console.log(`Vehicle/User disconnected: ${socket.id}`);
    });
});



app.get('/', (req, res) => {
    res.render('about'); // Make sure you have views/about.ejs created
});
// ==========================================
// Authentication Middleware & Routes
// ==========================================

// Middleware to protect routes and ensure the user is logged in
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login');
}

// Serve the Login Page
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Patient Login</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f8f9fa; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .login-box { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); width: 100%; max-width: 400px; text-align: center; }
                input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
                button { background: #dc3545; color: white; border: none; padding: 10px; width: 100%; border-radius: 4px; font-weight: bold; cursor: pointer; }
                button:hover { background: #c82333; }
            </style>
        </head>
        <body>
            <div class="login-box">
                <h2>Patient Login</h2>
                <form action="/login" method="POST">
                    <input type="email" name="email" placeholder="Enter your email" required />
                    <input type="password" name="password" placeholder="Enter your password" required />
                    <button type="submit">Log In</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// Handle Login Form Submission
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (email && password) {
        req.session = req.session || {};
        req.session.user = { email }; // Save user session
        return res.redirect('/patient');
    }
    res.redirect('/login');

    const session = require('express-session');

app.use(session({
    secret: 'your_secret_key_here',
    resave: false,
    saveUninitialized: true
}));
app.use(express.urlencoded({ extended: true }));
});

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/driver', (req, res) => {
    res.render('driver');
});



io.on('connection', (socket) => {
    // Existing location handler...
    
    // Handle patient emergency requests
    socket.on('emergency-request', (data) => {
        console.log('Emergency requested:', data);
        // Broadcast the incident to all connected dispatchers/ambulances
        io.emit('new-incident', {
            id: socket.id,
            description: data.description,
            latitude: data.latitude,
            longitude: data.longitude,
            timestamp: new Date()
        });
    });
});
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // 1. REGISTER PATIENT EMERGENCY REQUEST IN DATABASE
    socket.on('emergency-request', async (data) => {
        const { description, latitude, longitude } = data;

        try {
            // Save incident to PostgreSQL database
            const query = `
                INSERT INTO incidents (description, latitude, longitude, status)
                VALUES ($1, $2, $3, 'open')
                RETURNING id, created_at;
            `;
            const result = await pool.query(query, [description, latitude, longitude]);
            const savedIncident = result.rows[0];

            console.log(`Emergency registered in DB with ID: ${savedIncident.id}`);

            // Broadcast the saved incident with its DB ID to all drivers/dispatchers
            io.emit('new-incident', {
                id: savedIncident.id,
                description,
                latitude,
                longitude,
                timestamp: savedIncident.created_at
            });
        } catch (err) {
            console.error('Failed to save emergency request to database:', err.message);
        }
    });

    // 2. REGISTER AMBULANCE GPS TELEMETRY IN DATABASE
    socket.on('send-location', async (data) => {
        const { vehicleId, latitude, longitude } = data;

        // Broadcast live movement to map
        io.emit('receive-location', { id: socket.id, latitude, longitude });

        // Save telemetry log to PostgreSQL if a vehicle ID is provided
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

    socket.on('disconnect', () => {
        io.emit('user-disconnected', socket.id);
        console.log(`Client disconnected: ${socket.id}`);
    });
});

// 2. Listen for incoming patient requests
io.on('connection', (socket) => {
    console.log('⚡ A user connected:', socket.id);

    // 1. Listen for incoming emergencies sent FROM the patient portal
    socket.on('emergency-request', async (data) => {
        try {
            const query = `
                INSERT INTO incidents (description, latitude, longitude, status)
                VALUES ($1, $2, $3, 'open')
                RETURNING *;
            `;
            const values = [data.description || 'Medical Emergency', data.latitude, data.longitude];
            const result = await pool.query(query, values);
            const savedIncident = result.rows[0];

            console.log('🚨 Emergency saved & broadcasting to drivers:', savedIncident);

            // 2. EMIT the new incident TO the driver dashboards
            io.emit('new-incident', savedIncident);

        } catch (err) {
            console.error('❌ Error handling emergency request:', err.message);
        }
    });

    socket.on('disconnect', () => {
        console.log('🔌 User disconnected:', socket.id);
    });
});



// ==========================================
// Socket.IO Connection Handler
// ==========================================
io.on('connection', (socket) => {
    console.log('⚡ A user connected:', socket.id);

    // 1. Listen for emergency requests from the Patient page
    socket.on('emergency-request', async (data) => {
        try {
            const query = `
                INSERT INTO incidents (description, latitude, longitude, status)
                VALUES ($1, $2, $3, 'open')
                RETURNING *;
            `;
            const values = [data.description || 'Medical Emergency', data.latitude, data.longitude];
            const result = await pool.query(query, values);
            const savedIncident = result.rows[0];

            console.log('🚨 Emergency saved & broadcasting to drivers:', savedIncident);

            // Broadcast the new incident to ALL connected clients (Driver dashboards)
            io.emit('new-incident', savedIncident);

        } catch (err) {
            console.error('❌ Error handling emergency request:', err.message);
        }
    });

    // 2. Listen for driver location updates
    socket.on('send-location', (data) => {
        // Broadcast location to other clients if needed
        socket.broadcast.emit('update-vehicle-location', data);
    });

    socket.on('disconnect', () => {
        console.log('🔌 User disconnected:', socket.id);
    });
});
io.on('connection', (socket) => {
    console.log('A user connected');

    // Place your socket events INSIDE here:
    socket.on('emergency-request', async (data) => {
        // Your logic for saving and broadcasting emergencies...
    });

    socket.on('send-location', (data) => {
        // Your logic for driver location tracking...
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});