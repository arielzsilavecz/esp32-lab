import { Router } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

import { requireAuth } from '../auth.js';
import { pool } from '../db.js';

export const webauthnRouter = Router();

webauthnRouter.use(requireAuth);

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTHORIZATION_TTL_MS = 30 * 1000;

function relyingParty(req) {
  const rpID = process.env.WEBAUTHN_RP_ID || req.hostname;
  const origin = process.env.WEBAUTHN_ORIGIN || `${req.protocol}://${req.get('host')}`;
  return { rpID, origin: origin.replace(/\/$/, '') };
}

function challengeValido(ceremony, dispositivoId) {
  return ceremony
    && ceremony.dispositivoId === String(dispositivoId)
    && ceremony.expiresAt >= Date.now();
}

async function buscarPorton(dispositivoId) {
  const result = await pool.query(
    'SELECT id FROM dispositivos WHERE id = $1 AND tipo = $2',
    [dispositivoId, 'porton']
  );
  return result.rows[0];
}

webauthnRouter.post('/registro/opciones', async (req, res) => {
  const { dispositivoId } = req.body ?? {};
  if (!dispositivoId || !await buscarPorton(dispositivoId)) {
    return res.status(404).json({ error: 'Porton no encontrado' });
  }

  const [usuarioResult, credencialesResult] = await Promise.all([
    pool.query('SELECT id, email, nombre FROM usuarios WHERE id = $1', [req.session.userId]),
    pool.query(
      'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1',
      [req.session.userId]
    ),
  ]);
  const usuario = usuarioResult.rows[0];
  if (!usuario) return res.status(401).json({ error: 'Usuario no encontrado' });

  const { rpID } = relyingParty(req);
  const options = await generateRegistrationOptions({
    rpName: 'Casa Piotti',
    rpID,
    userID: new TextEncoder().encode(String(usuario.id)),
    userName: usuario.email,
    userDisplayName: usuario.nombre,
    attestationType: 'none',
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: credencialesResult.rows.map((credencial) => ({
      id: credencial.credential_id,
      transports: credencial.transports,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });

  req.session.webAuthnRegistration = {
    challenge: options.challenge,
    dispositivoId: String(dispositivoId),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  res.json(options);
});

webauthnRouter.post('/registro/verificar', async (req, res) => {
  const { dispositivoId, credential: response } = req.body ?? {};
  const ceremony = req.session.webAuthnRegistration;
  delete req.session.webAuthnRegistration;

  if (!response || !challengeValido(ceremony, dispositivoId)) {
    return res.status(400).json({ error: 'Registro vencido o invalido' });
  }

  try {
    const { rpID, origin } = relyingParty(req);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'No se pudo verificar el dispositivo' });
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    const insert = await pool.query(
      `INSERT INTO webauthn_credentials
         (user_id, credential_id, public_key, counter, transports,
          credential_device_type, backed_up)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (credential_id) DO NOTHING
       RETURNING id`,
      [
        req.session.userId,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports ?? response.response?.transports ?? []),
        credentialDeviceType,
        credentialBackedUp,
      ]
    );
    if (insert.rowCount === 0) {
      return res.status(409).json({ error: 'Esta credencial ya estaba registrada' });
    }

    req.session.portonAuthorization = {
      dispositivoId: String(dispositivoId),
      expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
    };
    res.json({ verified: true });
  } catch (error) {
    console.error('Fallo verificando registro WebAuthn:', error);
    res.status(400).json({ error: 'No se pudo verificar la credencial' });
  }
});

webauthnRouter.post('/autenticacion/opciones', async (req, res) => {
  const { dispositivoId } = req.body ?? {};
  if (!dispositivoId || !await buscarPorton(dispositivoId)) {
    return res.status(404).json({ error: 'Porton no encontrado' });
  }

  const credenciales = await pool.query(
    'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1',
    [req.session.userId]
  );
  if (credenciales.rowCount === 0) {
    return res.status(409).json({ error: 'webauthn_no_configurado' });
  }

  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: credenciales.rows.map((credencial) => ({
      id: credencial.credential_id,
      transports: credencial.transports,
    })),
  });

  req.session.webAuthnAuthentication = {
    challenge: options.challenge,
    dispositivoId: String(dispositivoId),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  res.json(options);
});

webauthnRouter.post('/autenticacion/verificar', async (req, res) => {
  const { dispositivoId, credential: response } = req.body ?? {};
  const ceremony = req.session.webAuthnAuthentication;
  delete req.session.webAuthnAuthentication;

  if (!response || !challengeValido(ceremony, dispositivoId)) {
    return res.status(400).json({ error: 'Verificacion vencida o invalida' });
  }

  const credencialResult = await pool.query(
    `SELECT credential_id, public_key, counter, transports
     FROM webauthn_credentials
     WHERE user_id = $1 AND credential_id = $2`,
    [req.session.userId, response.id]
  );
  const credencial = credencialResult.rows[0];
  if (!credencial) return res.status(400).json({ error: 'Credencial desconocida' });

  try {
    const { rpID, origin } = relyingParty(req);
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: credencial.credential_id,
        publicKey: new Uint8Array(credencial.public_key),
        counter: Number(credencial.counter),
        transports: credencial.transports,
      },
    });
    if (!verification.verified) {
      return res.status(400).json({ error: 'No se pudo verificar la identidad' });
    }

    await pool.query(
      'UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2',
      [verification.authenticationInfo.newCounter, credencial.credential_id]
    );
    req.session.portonAuthorization = {
      dispositivoId: String(dispositivoId),
      expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
    };
    res.json({ verified: true });
  } catch (error) {
    console.error('Fallo verificando autenticacion WebAuthn:', error);
    res.status(400).json({ error: 'No se pudo verificar la identidad' });
  }
});
