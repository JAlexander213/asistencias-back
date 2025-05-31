import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import db from "./lib/db.js";
import authProfile from "./routes/authProfile.js";
const PORT = process.env.PORT || 3001;
const app = express();

app.use(cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.get('/', (req, res) => {
  res.send('¡Hola desde el backend!');
});

app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en http://localhost:${PORT}`);
});

app.use("/auth", authRoutes);
app.use("/auth", authProfile);