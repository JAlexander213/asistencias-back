import pkg from 'pg';
import dotenv from 'dotenv';
import dns from 'dns';

dotenv.config();

// Fuerza a Node.js a preferir IPv4
dns.setDefaultResultOrder('ipv4first');

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URI,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.connect((err) => {
  if (err) {
    console.error('Error de conexión a la base de datos:', err);
    return;
  }
  console.log('Conexión exitosa a la base de datos PostgreSQL');
});

export default pool;