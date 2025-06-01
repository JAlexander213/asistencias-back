import express from "express";
import db from "../lib/db.js"; // db debe exportar un Pool de pg
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });
dotenv.config();

router.get("/profile", async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: "Falta el username" });
  }

  try {
    const result = await db.query(
      "SELECT name, username, photo FROM users WHERE username = $1",
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: "Error en la base de datos" });
  }
});

router.post("/profile/verify-password", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Faltan datos" });

  try {
    const result = await db.query("SELECT password FROM users WHERE username = $1", [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Usuario no encontrado" });

    const match = await bcrypt.compare(password, result.rows[0].password);
    res.json({ success: match });
  } catch (err) {
    return res.status(500).json({ error: "Error en la base de datos" });
  }
});

const uploadToCloudinary = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "sistemaesc_perfiles" },
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

router.put("/profile/update", upload.single("photo"), async (req, res) => {
  const { name, username, password } = req.body;
  const usernameLS = req.query.username;
  let photoUrl = null;

  if (!name || !username) return res.status(400).json({ error: "Faltan datos" });

  if (req.file) {
    try {
      photoUrl = await uploadToCloudinary(req.file.buffer);
    } catch (err) {
      return res.status(500).json({ error: "Error al subir la imagen" });
    }
  }

  const updateFields = { name, username };
  if (photoUrl) updateFields.photo = photoUrl;
  if (password) updateFields.password = await bcrypt.hash(password, 10);

  // Construir query dinámico para PostgreSQL
  const setClauses = [];
  const params = [];
  let i = 1;
  for (const key in updateFields) {
    setClauses.push(`${key} = $${i}`);
    params.push(updateFields[key]);
    i++;
  }

  params.push(usernameLS); // Para WHERE

  const sql = `UPDATE users SET ${setClauses.join(", ")} WHERE username = $${i}`;

  try {
    const result = await db.query(sql, params);

    // Traer datos actualizados
    const updated = await db.query(
      "SELECT name, username, photo FROM users WHERE username = $1",
      [username]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado tras actualizar" });
    }
    res.json(updated.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: "Error al actualizar" });
  }
});

router.delete("/profile/delete", async (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: "Falta el username" });
  }

  try {
    // Primero verifica si el usuario existe
    const userCheck = await db.query("SELECT id FROM users WHERE username = $1", [username]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Elimina al usuario
    await db.query("DELETE FROM users WHERE username = $1", [username]);

    res.json({ success: true, message: "Usuario eliminado correctamente" });
  } catch (err) {
    console.error("Error al eliminar usuario:", err);
    return res.status(500).json({ error: "Error al eliminar el usuario en la base de datos" });
  }
});



export default router;
