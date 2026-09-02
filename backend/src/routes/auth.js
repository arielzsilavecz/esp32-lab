import { Router } from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db.js';

export const authRouter = Router();

// Hash valido pero de una password que nadie tiene: se compara contra esto
// cuando el email no existe, para que el tiempo de respuesta no delate si un
// email esta registrado o no.
const HASH_DUMMY = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO4/9tuxTn/6/2FKBnI4mAWG0uu1nqXve';

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Falta email o password' });
  }

  const result = await pool.query(
    'SELECT id, password_hash, nombre FROM usuarios WHERE email = $1',
    [email]
  );
  const usuario = result.rows[0];

  const valido = await bcrypt.compare(password, usuario ? usuario.password_hash : HASH_DUMMY);
  if (!usuario || !valido) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }

  req.session.userId = usuario.id;
  req.session.userNombre = usuario.nombre;
  res.json({ nombre: usuario.nombre });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  res.json({ userId: req.session.userId, nombre: req.session.userNombre });
});
