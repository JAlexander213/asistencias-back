import express from "express";
const router = express.Router();
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../lib/db.js"; 
import moment from "moment-timezone";

moment.tz.setDefault('America/Mexico_City');
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

const uploadToCloudinary = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "sistemaesc_perfiles" },
      (error, result) => {
        if (result) resolve(result.secure_url);
        else reject(error);
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

router.post('/register', upload.single('photo'), async (req, res) => {
  const { name, username, password } = req.body;
  let photoUrl = null;

  // Validación de campos obligatorios
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Por favor, completa todos los campos.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'La foto de perfil es obligatoria.' });
  }

  try {
    const userCheck = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'El nombre de usuario ya está en uso, por favor elige otro.' });
    }

    // Verificar si el nombre ya existe (opcional)
    const nameCheck = await db.query('SELECT * FROM users WHERE name = $1', [name]);
    if (nameCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe un usuario con ese nombre.' });
    }

    // Subir foto a Cloudinary
    photoUrl = await uploadToCloudinary(req.file.buffer);

    // Hash de la contraseña
    const hashPassword = await bcrypt.hash(password, 10);

    // Registrar el nuevo usuario
    await db.query(
      'INSERT INTO users (name, username, password, photo) VALUES ($1, $2, $3, $4)',
      [name, username, hashPassword, photoUrl]
    );

    res.status(201).json({ 
      success: true,
      message: 'Usuario registrado exitosamente',
      user: { name, username, photo: photoUrl }
    });

  } catch (err) {
    console.error('Error en /register:', err);
    
    // Manejo específico para errores de Cloudinary
    if (err.message.includes('Cloudinary')) {
      return res.status(500).json({ error: 'Error al subir la imagen de perfil' });
    }
    
    res.status(500).json({ error: 'Error en el proceso de registro' });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Credenciales incorrectas" });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
    res.json({ "Login exitoso": token });

  } catch (err) {
    console.error('Error en /login:', err);
    res.status(500).json({ error: 'Error en la autenticación' });
  }
});

function cleanKeys(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.trim(), v])
  );
}

function convertirFecha(fechaOriginal) {
  if (!fechaOriginal) return null;
  const [fechaParte, horaParte] = fechaOriginal.split(" ");
  const [dia, mes, anio] = fechaParte.split("/");
  const hora = horaParte.length === 5 ? horaParte + ":00" : horaParte;
  const fechaISO = `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}T${hora}`;
  const fechaMoment = moment(fechaISO);
  return fechaMoment.format('YYYY-MM-DD HH:mm:ss');
}

router.post('/uploadAsistencias', async (req, res) => {
    const { registros, nombreArchivo } = req.body; 
  const encabezadoIdx = req.body.registros.findIndex(r =>
    Object.values(r).some(v =>
      typeof v === "string" &&
      v.trim().toUpperCase() === "CVE DE EMPLEADO"
    )
  );

  if (encabezadoIdx === -1) {
    return res.status(400).json({ error: 'No se encontró el encabezado correcto en el archivo.' });
  }

  const encabezadoRow = req.body.registros[encabezadoIdx];
  const columnas = Object.values(encabezadoRow).map(c => c && c.trim());

  const datos = req.body.registros.slice(encabezadoIdx + 1)
    .map(row => {
      const obj = {};
      Object.keys(row).forEach((key, idx) => {
        const colName = columnas[idx];
        if (colName) obj[colName] = row[key];
      });
      return obj;
    })
    .filter(r =>
      r["CVE DE EMPLEADO"] && r["Nombre"] && r["Fecha / Hora"]
    );

  if (!Array.isArray(datos) || datos.length === 0) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  // Construir query para inserción masiva
  // Ejemplo: INSERT INTO asistencias (cve_empleado, nombre, fecha_hora, observaciones) VALUES
  // ($1, $2, $3, $4), ($5, $6, $7, $8), ...
   const values = [];
  const placeholders = datos.map((r, i) => {
    const idx = i * 5; // Ahora son 5 campos por registro
    values.push(
      r["CVE DE EMPLEADO"],
      r["Nombre"],
      convertirFecha(r["Fecha / Hora"]),
      r["OBSERVACIONES"] || null,
      nombreArchivo // Añade el nombre del archivo
    );
    return `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`;
  }).join(',');

  try {
    await db.query(
      `INSERT INTO asistencias (cve_empleado, nombre, fecha_hora, observaciones, archivo) VALUES ${placeholders}`,
      values
    );
    res.json({ success: true, cantidad: datos.length });
  } catch (err) {
    console.error("Error SQL:", err);
    res.status(500).json({ error: 'Error al guardar registros' });
  }
});

router.get('/asistencias/archivos', async (req, res) => {
  try {
    const result = await db.query('SELECT DISTINCT archivo FROM asistencias');
    res.json(result.rows.map(r => r.archivo));
  } catch (err) {
    console.error('Error en /asistencias/archivos:', err);
    res.status(500).json({ error: 'Error al obtener archivos' });
  }
});

router.get('/asistencias', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM asistencias');
    const datosFormateados = result.rows.map(row => ({
      ...row,
      fecha_hora_formateada: convertirFechaBD(row.fecha_hora),
    }));
    res.json(datosFormateados);
  } catch (err) {
    console.error('Error en /asistencias:', err);
    res.status(500).json({ error: 'Error al obtener registros' });
  }
});

router.delete('/asistencias/delete', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM asistencias');
    // En pg, result.rowCount es el número de filas afectadas
    res.json({ success: true, message: `Registros eliminados: ${result.rowCount}` });
  } catch (err) {
    console.error('Error en DELETE /asistencias/delete:', err);
    res.status(500).json({ error: 'Error al eliminar registros' });
  }
});

function convertirFechaBD(fechaBD) {
  if (!fechaBD) return null;
  const fechaMoment = moment(fechaBD);
  return fechaMoment.format('YYYY-MM-DD HH:mm:ss');
}

router.get('/asistencias/por-archivo/:nombreArchivo', async (req, res) => {
  try {
    const { nombreArchivo } = req.params;
    const result = await db.query(
      'SELECT * FROM asistencias WHERE archivo = $1',
      [nombreArchivo]
    );
    
    const datosFormateados = result.rows.map(row => ({
      ...row,
      fecha_hora_formateada: convertirFechaBD(row.fecha_hora),
    }));
    
    res.json(datosFormateados);
  } catch (err) {
    console.error('Error en /asistencias/por-archivo:', err);
    res.status(500).json({ error: 'Error al obtener registros' });
  }
});

router.get('/archivos', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT DISTINCT archivo FROM asistencias');
    const archivos = rows.map(r => r.archivo);
    res.json(archivos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener archivos' });
  }
});


export default router;