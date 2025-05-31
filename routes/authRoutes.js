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
// Configuración de Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer en memoria (no en disco)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Función para subir a Cloudinary usando un stream
const uploadToCloudinary = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "sistemaesc_perfiles" }, // Puedes cambiar el folder
      (error, result) => {
        if (result) {
          resolve(result.secure_url);
        } else {
          reject(error);
        }
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

router.post('/register', upload.single('photo'), async (req, res) => {
  const { name, username, password } = req.body;
  let photoUrl = null;

  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Por favor, completa todos los campos.' });
  }

  // Foto obligatoria
  if (!req.file) {
    return res.status(400).json({ error: 'La foto de perfil es obligatoria.' });
  }

  // Subir imagen a Cloudinary
  try {
    photoUrl = await uploadToCloudinary(req.file.buffer);
  } catch (err) {
    return res.status(500).json({ error: 'Error al subir la imagen' });
  }

  db.query('SELECT * FROM users WHERE name = ?', [name], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Error en la base de datos' });
    if (results.length > 0) {
      return res.status(400).json({ error: 'Ya existe un usuario con ese nombre' });
    }

    const hashPassword = await bcrypt.hash(password, 10);
    db.query(
      'INSERT INTO users (name, username, password, photo) VALUES (?, ?, ?, ?)',
      [name, username, hashPassword, photoUrl],
      (err) => {
        if (err) {
          console.error('Error SQL:', err);
          return res.status(500).json({ error: 'Error al registrar' });
        }
        // Devuelve los datos del usuario recién creado
        res.json({ name, username, photo: photoUrl });
      }
    );
  });
});
router.post("/login", async (req, res) => {
    const {username, password} = req.body;
    db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
        if(err|| results.length === 0) return res.status(401).json({error: 'Credenciales incorrectas'});
        const user= results[0];
        const match= await bcrypt.compare(password, user.password);
        if(!match) return res.status(401).json({error: "Credenciales incorrectas"});
        const token= jwt.sign({id: user.id}, process.env.JWT_SECRET);
        res.json({"Login exitoso": token});
    })
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
  const encabezadoIdx = req.body.registros.findIndex(r =>
    Object.values(r).some(v =>
      typeof v === "string" &&
      v.trim().toUpperCase() === "CVE DE EMPLEADO"
    )
  );

  if (encabezadoIdx === -1) {
    return res.status(400).json({ error: 'No se encontró el encabezado correcto en el archivo.' });
  }

  // 2. Obtén los nombres de las columnas reales
  const encabezadoRow = req.body.registros[encabezadoIdx];
  const columnas = Object.values(encabezadoRow).map(c => c && c.trim());

  // 3. Reconstruye los registros a partir de la siguiente fila
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

  // DEBUG: Muestra el primer registro válido en consola
  console.log("Primer registro válido:", datos[0]);

  if (!Array.isArray(datos) || datos.length === 0) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  const sql = 'INSERT INTO asistencias (cve_empleado, nombre, fecha_hora, observaciones) VALUES ?';
  const values = datos.map(r => [
    r["CVE DE EMPLEADO"],
    r["Nombre"],
    convertirFecha(r["Fecha / Hora"]),
    r["OBSERVACIONES"] || null
  ]);
  db.query(sql, [values], (err) => {
    if (err) {
      console.error("Error SQL:", err);
      return res.status(500).json({ error: 'Error al guardar registros' });
    }
    res.json({ success: true, cantidad: values.length });
  });
});

router.get('/asistencias/archivos', (req, res) => {
  db.query('SELECT DISTINCT archivo FROM asistencias', (err, results) => {
    if (err) return res.status(500).json({ error: 'Error al obtener archivos' });
    res.json(results.map(r => r.archivo));
  });
});

router.get('/asistencias', (req, res) => {
  db.query('SELECT * FROM asistencias', (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Error al obtener registros' });
    }

    const datosFormateados = results.map(row => ({
      ...row,
      fecha_hora_formateada: convertirFechaBD(row.fecha_hora),
    }));

    res.json(datosFormateados);
  });
});




router.delete('/asistencias/delete', (req, res) => {
  console.log('⚠️ Petición DELETE recibida');
  db.query('DELETE FROM asistencias', (err, result) => {
    if (err) {
      console.error('❌ Error al eliminar registros:', err);
      return res.status(500).json({ error: 'Error al eliminar registros' });
    }
    console.log(`✅ ${result.affectedRows} registros eliminados`);
    res.json({ success: true, message: 'Registros eliminados correctamente' });
  });
});



function convertirFechaBD(fechaBD) {
  if (!fechaBD) return null;

  const fechaMoment = moment(fechaBD);

  return fechaMoment.format('YYYY-MM-DD HH:mm:ss');
}


export default router;