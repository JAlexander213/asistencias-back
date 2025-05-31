import express from "express";
import db from "../lib/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });
dotenv.config();

router.get("/profile", (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: "Falta el username" });
  }

  db.query(
    "SELECT name, username, photo FROM users WHERE username = ?",
    [username],
    (err, results) => {
      if (err) return res.status(500).json({ error: "Error en la base de datos" });
      if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
      res.json(results[0]);
    }
  );
});
router.post("/profile/verify-password", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Faltan datos" });

  db.query("SELECT password FROM users WHERE username = ?", [username], async (err, results) => {
    if (err || results.length === 0) return res.status(401).json({ error: "Usuario no encontrado" });
    const match = await bcrypt.compare(password, results[0].password);
    if (match) {
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  });
});

const uploadToCloudinary= (fileBuffer) =>{
    return new Promise ((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {folder:"sistemaesc_perfiles"},
            (error,result) => {
                if(result){
                    resolve(result.secure_url)
                }else{
                    reject(error)
                }
            }
        )
        streamifier.createReadStream(fileBuffer).pipe(stream)
    })
};

router.put("/profile/update", upload.single("photo"), async (req, res) => {
  const { name, username, password } = req.body;
  const usernameLS = req.query.username;
  let photoUrl = null;

  if (!name || !username) return res.status(400).json({ error: "Faltan datos" });

  // Si hay nueva foto, súbela a Cloudinary
  if (req.file) {
    try {
      photoUrl = await uploadToCloudinary(req.file.buffer);
    } catch (err) {
      return res.status(500).json({ error: "Error al subir la imagen" });
    }
  }

  let updateFields = { name, username };
  if (photoUrl) updateFields.photo = photoUrl;
  if (password) updateFields.password = await bcrypt.hash(password, 10);
  let sql = "UPDATE users SET ";
  const params = []; //guarda los valores que se pasan a la consulta sql
  
  Object.keys(updateFields).forEach((key, idx) => { //obtiene arreglo con nombres de las propiedades
// Si no es el último campo, agrega una coma
    sql += `${key} = ?${idx < Object.keys(updateFields).length - 1 ? "," : ""} `; 
    params.push(updateFields[key]);
  });

  // Por cada campo a actualizar, agrega 'campo = ?' a la consulta SQL y su valor al arreglo de parámetros.
  sql += "WHERE username = ?";
  params.push(usernameLS);

  db.query(sql, params, (err) => {
    if (err) return res.status(500).json({ error: "Error al actualizar" });

    // Devuelve los nuevos datos
    db.query(
      "SELECT name, username, photo FROM users WHERE username = ?",
      [username],
      (err, results) => {
        if (err || results.length === 0) return res.status(500).json({ error: "Error al obtener datos" });
        res.json(results[0]); //devuelve datos si fue exitosa
      }
    );
  });
});
router.delete("/profile/delete", (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Falta el username" });

  db.query("DELETE FROM users WHERE username = ?", [username], (err) => {
    if (err) return res.status(500).json({ error: "Error al eliminar cuenta" });
    res.json({ success: true });
  });
});




export default router;