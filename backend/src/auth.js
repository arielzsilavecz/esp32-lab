import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from './db.js';

const PgSession = connectPgSimple(session);

export function sessionMiddleware() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('Falta SESSION_SECRET en el entorno (ver .env.example).');
  }

  // Antes usaba el MemoryStore default de express-session: las sesiones no
  // sobrevivian un redeploy/restart de Railway (se perdian todas, habia que
  // volver a loguearse). connect-pg-simple las persiste en el Postgres que
  // ya existe -- se prefirio sobre connect-redis (que es lo que usa
  // bot-backend) porque no hace falta provisionar ni pagar un servicio
  // nuevo para el volumen de esta app (un puñado de usuarios de confianza).
  // Tabla creada por backend/migrations/003_session_store.sql.
  return session({
    store: new PgSession({ pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
    },
  });
}

export function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}
