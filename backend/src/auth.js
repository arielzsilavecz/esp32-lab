import session from 'express-session';

export function sessionMiddleware() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('Falta SESSION_SECRET en el entorno (ver .env.example).');
  }

  // MemoryStore (el default): las sesiones no sobreviven un redeploy/restart
  // de Railway -- todos vuelven a loguearse. Aceptable para un puñado de
  // usuarios de confianza; si molesta, la salida es connect-redis (ya usado
  // en bot-backend), no algo para agregar de entrada sin necesidad probada.
  return session({
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
