const pool = require('./db');

const seedDatabase = async () => {
  try {
    const query = `
      INSERT INTO vehicles (vehicle_code, driver_name, status)
      VALUES ('AMB-01', 'Khumo Driver', 'available')
      ON CONFLICT (vehicle_code) DO NOTHING
      RETURNING *;
    `;
    const result = await pool.query(query);
    if (result.rows.length > 0) {
      console.log('✅ Test vehicle seeded successfully:', result.rows[0]);
    } else {
      console.log('ℹ️ Test vehicle already exists in the database.');
    }
  } catch (err) {
    console.error('❌ Error seeding database:', err.message);
  } finally {
    await pool.end();
  }
};

seedDatabase();