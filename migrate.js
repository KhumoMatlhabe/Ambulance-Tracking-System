const pool = require('./db');

const createTables = async () => {
  const queryText = `
    -- Vehicles Table
    CREATE TABLE IF NOT EXISTS vehicles (
      id SERIAL PRIMARY KEY,
      vehicle_code VARCHAR(50) UNIQUE NOT NULL,
      driver_name VARCHAR(100) NOT NULL,
      status VARCHAR(20) DEFAULT 'available'
    );

    -- Location Telemetry Logs Table
    CREATE TABLE IF NOT EXISTS location_logs (
      id BIGSERIAL PRIMARY KEY,
      vehicle_id INT REFERENCES vehicles(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Patient Emergency Incidents Table
    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      description TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      status VARCHAR(20) DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(queryText);
    console.log('All tables (vehicles, location_logs, incidents) created successfully in Neon!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await pool.end();
  }
};

createTables();