const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
        || 'postgres://sofie:sofie@localhost:5432/sofie_portfolio',
});

async function migrate() {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    const seed = fs.readFileSync(path.join(__dirname, '..', 'sql', 'seed.sql'), 'utf8');
    await pool.query(schema);
    await pool.query(seed);
}

module.exports = { pool, migrate };
