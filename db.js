// db.js
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_9tuTbjE4qykJ@ep-sweet-paper-b557garp-pooler.c-7.us-east-2.aws.neon.tech/ambulance_db?sslmode=require&channel_binding=require',
    ssl: {
        rejectUnauthorized: false
    }
});

module.exports = pool;