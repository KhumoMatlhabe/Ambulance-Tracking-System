// setup-db.js
const { Pool } = require('pg');
require('dotenv').config();

// 1. Connect to default 'postgres' database to create 'ambulance_db' if missing
const adminPool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:your_password@localhost:5432/postgres',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initializeDatabase() {
    try {
        console.log('Checking if database "ambulance_db" exists...');
        const dbCheck = await adminPool.query("SELECT datname FROM pg_database WHERE datname = 'ambulance_db';");
        
        if (dbCheck.rows.length === 0) {
            console.log('Database "ambulance_db" not found. Creating it now...');
            await adminPool.query('CREATE DATABASE ambulance_db;');
            console.log('Database "ambulance_db" created successfully!');
        } else {
            console.log('Database "ambulance_db" already exists.');
        }
        await adminPool.end();

        // 2. Connect directly to 'ambulance_db' to create tables
        const appPool = new Pool({
            connectionString: process.env.DATABASE_URL || 'postgresql://postgres:your_password@localhost:5432/ambulance_db',
            ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
        });

        console.log('Setting up tables and schemas...');

        const schemaQuery = `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(150) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS incidents (
                id SERIAL PRIMARY KEY,
                description TEXT,
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                status VARCHAR(50) DEFAULT 'open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS location_logs (
                id SERIAL PRIMARY KEY,
                vehicle_id VARCHAR(100) NOT NULL,
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS appointments (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR(150) NOT NULL,
                hospital_name VARCHAR(150) NOT NULL,
                department VARCHAR(100) NOT NULL,
                appointment_date TIMESTAMP NOT NULL,
                status VARCHAR(50) DEFAULT 'confirmed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS hospitals (
                id SERIAL PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL
            );

            -- Insert sample Cape Town hospital for nearest matching
            INSERT INTO hospitals (name, latitude, longitude) 
            VALUES ('Groote Schuur Hospital', -33.9435, 18.4636)
            ON CONFLICT DO NOTHING;
        `;

        await appPool.query(schemaQuery);
        console.log('All database tables and sample data created successfully!');
        await appPool.end();
        process.exit(0);
    } catch (err) {
        console.error('Error during database initialization:', err.message);
        process.exit(1);
    }
}

initializeDatabase();