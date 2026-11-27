-- Extensiones necesarias: cálculos geográficos y generación segura de UUIDs
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tipos ENUM estrictos para evitar valores inválidos en BD
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE pin_status AS ENUM ('disponible', 'reservado', 'recogido', 'expirado');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Función reutilizable para actualizar automáticamente la columna updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_users_email_lowercase CHECK (email = LOWER(email))
);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Tabla de Refresh Tokens con soporte de rotación y detección de robo
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  replaced_by_token_id UUID NULL REFERENCES refresh_tokens(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- 3. Tabla principal de pines geoespaciales (muebles/objetos)
CREATE TABLE IF NOT EXISTS pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reserved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(120) NOT NULL,
  description TEXT NULL,
  category VARCHAR(50) NOT NULL,
  location GEOGRAPHY(Point, 4326) NOT NULL,
  photo_url TEXT NULL,
  status pin_status NOT NULL DEFAULT 'disponible',
  reserved_at TIMESTAMPTZ NULL,
  reservation_expires_at TIMESTAMPTZ NULL,
  collected_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pins_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT chk_pins_reserved_consistency CHECK (
    (status = 'reservado' AND reserved_by IS NOT NULL AND reserved_at IS NOT NULL AND reservation_expires_at IS NOT NULL)
    OR (status <> 'reservado')
  ),
  CONSTRAINT chk_pins_collected_consistency CHECK (
    (status = 'recogido' AND collected_at IS NOT NULL)
    OR (status <> 'recogido')
  )
);

CREATE TRIGGER trg_pins_updated_at
BEFORE UPDATE ON pins
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Índice espacial GIST: acelera búsquedas por radio (ST_DWithin) en milisegundos
CREATE INDEX IF NOT EXISTS idx_pins_location_gist ON pins USING GIST (location);

-- Índice para filtrar pines visibles y vigentes en tiempo real
CREATE INDEX IF NOT EXISTS idx_pins_status_expires ON pins (status, expires_at);

-- Índice parcial: solo indexa filas reservadas para validar el límite de 2 reservas/usuario
CREATE INDEX IF NOT EXISTS idx_pins_reserved_by_active
  ON pins (reserved_by) WHERE status = 'reservado';

-- Índice anti-spam: agiliza la comprobación de pines recientes del mismo usuario
CREATE INDEX IF NOT EXISTS idx_pins_created_by_recent
  ON pins (created_by, created_at DESC);

-- 4. Tabla inmutable de auditoría de seguridad y moderación
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);