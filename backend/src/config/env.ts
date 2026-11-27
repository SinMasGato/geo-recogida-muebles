import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Carga .env desde la raíz (E:\Proyectos\geo-recogida-muebles\.env)
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),

  DEFAULT_SEARCH_RADIUS_METERS: z.coerce.number().int().positive().default(5000),
  MAX_SEARCH_RADIUS_METERS: z.coerce.number().int().positive().default(10000),
  PIN_TTL_HOURS: z.coerce.number().int().positive().default(24),
  RESERVATION_TTL_HOURS: z.coerce.number().int().positive().default(2),
  MAX_ACTIVE_RESERVATIONS_PER_USER: z.coerce.number().int().positive().default(2),
  MEDIA_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000/uploads'),
  CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(60),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Error en variables de entorno:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;