-- Tabla de sesiones para connect-pg-simple (reemplaza el MemoryStore default
-- de express-session, que se borraba en cada redeploy de Railway -- ver
-- backend/src/auth.js). Esquema recomendado por el propio paquete, sin
-- WITH (OIDS=FALSE): esa clausula es de versiones viejas de Postgres.
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar NOT NULL COLLATE "default",
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL
);

ALTER TABLE "session"
  DROP CONSTRAINT IF EXISTS "session_pkey",
  ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
