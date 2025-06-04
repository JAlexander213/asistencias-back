import dns from 'dns';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import authProfile from './routes/authProfile.js';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
const { Pool } = pkg;

app.listen(process.env.PORT || 8000, () => {
  console.log(`Servidor backend escuchando en http://localhost:${process.env.PORT || 8000}`);
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URI,
  ssl: {
    rejectUnauthorized: false 
  }
});


app.use("/auth", authRoutes);
app.use("/auth", authProfile);

pool.connect((err) => {
  if (err) {
    console.error('Error de conexión a la base de datos:', err);
    return;
  }
  console.log('Conexión exitosa a la base de datos PostgreSQL');
});

export default app;