import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { sessionMiddleware } from './auth.js';
import { authRouter } from './routes/auth.js';
import { dispositivosRouter } from './routes/dispositivos.js';
import { deviceRouter } from './routes/device.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Railway termina TLS antes de que el proceso vea la conexion: sin esto,
// Express no sabe que la request original era HTTPS y las cookies "secure"
// nunca se mandan.
app.set('trust proxy', 1);

app.use(express.json());
app.use(sessionMiddleware());

app.use('/api/auth', authRouter);
app.use('/api/dispositivos', dispositivosRouter);
app.use('/api/device', deviceRouter);

// Un solo proceso sirve API + frontend estatico -- ver ADR-0006 por que no
// hay un Vercel aparte.
app.use(express.static(path.join(__dirname, '..', 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`esp32-lab backend escuchando en :${port}`);
});
