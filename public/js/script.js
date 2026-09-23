const socket = io();

// Initialize Leaflet Map (Default center, updated on location grab)
const map = L.map('map').setView([0, 0], 15);

// Add OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = {};

// 1. Get current device position using browser Geolocation API
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            // Send coordinates to server via WebSocket
            socket.emit('send-location', { latitude, longitude });
        },
        (error) => {
            console.error('Geolocation Error:', error);
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        }
    );
} else {
    alert('Geolocation is not supported by your browser.');
}

// 2. Receive position updates from server for all active ambulances
socket.on('receive-location', (data) => {
    const { id, latitude, longitude } = data;

    // Center map on local user location initially
    if (id === socket.id) {
        map.setView([latitude, longitude]);
    }

    // Update existing marker or create a new one
    if (markers[id]) {
        markers[id].setLatLng([latitude, longitude]);
    } else {
        markers[id] = L.marker([latitude, longitude])
            .addTo(map)
            .bindPopup(`Ambulance ID: ${id.substring(0, 5)}`)
            .openPopup();
    }
});

// 3. Remove marker on vehicle disconnection
socket.on('user-disconnected', (id) => {
    if (markers[id]) {
        map.removeLayer(markers[id]);
        delete markers[id];
    }
});