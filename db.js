require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for secure cloud database connections like Neon
  }
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ Error acquiring client connection:', err.stack);
    }
    console.log('✅ Connected to cloud PostgreSQL database successfully!');
    release();
});

module.exports = pool;