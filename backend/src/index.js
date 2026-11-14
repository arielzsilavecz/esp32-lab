import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { sessionMiddleware } from './auth.js';
import { authRouter } from './routes/auth.js';
import { dispositivosRouter } from './routes/dispositivos.js';
import { deviceRouter } from './routes/device.js';
import { notificationsRouter } from './routes/notifications.js';
import { webauthnRouter } from './routes/webauthn.js';
import { iniciarRetencion } from './retencion.js';
import { leerCaptura } from './vigilancia.js';
import { iniciarVigilanteServidor } from './serverAlerts.js';

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
app.use('/api/notificaciones', notificationsRouter);
app.use('/api/webauthn', webauthnRouter);

// Fotos de los avisos de vigilancia, sin sesion: el telefono las baja para
// mostrarlas en la notificacion. El id es aleatorio (128 bits) y vence a las 24 h
// (ADR-0015).
app.get('/capturas/:id.jpg', (req, res) => {
  const captura = /^[0-9a-f]{32}$/.test(req.params.id) ? leerCaptura(req.params.id) : null;
  if (!captura) return res.status(404).end();
  res.set('Cache-Control', 'private, no-store').type('image/jpeg').send(captura.imagen);
});

// Un solo proceso sirve API + frontend estatico -- ver ADR-0006 por que no
// hay un Vercel aparte.
app.use(express.static(path.join(__dirname, '..', 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`esp32-lab backend escuchando en :${port}`);
  iniciarRetencion();
  iniciarVigilanteServidor();
});
