import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const { Pool } = pkg;

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
});


const pool = new Pool({
  connectionString: process.env.DATABASE_URI,
  ssl: {
    rejectUnauthorized: false 
  }
});

pool.connect((err) => {
  if (err) {
    console.error('Error de conexión a la base de datos:', err);
    return;
  }
  console.log('Conexión exitosa a la base de datos PostgreSQL');
});

export default pool;