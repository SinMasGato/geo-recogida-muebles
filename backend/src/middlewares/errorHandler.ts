import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

interface PgError {
  code?: string;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      status: 'error',
      message: 'Datos de entrada inválidos',
      errors: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Captura cuerpos JSON mal escritos enviados por el cliente
  if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400) {
    res.status(400).json({
      status: 'error',
      message: 'El cuerpo de la petición no es un JSON válido',
    });
    return;
  }

  // Violación de restricción UNIQUE en PostgreSQL (ej. carrera simultánea de registro)
  if (typeof err === 'object' && err !== null && (err as PgError).code === '23505') {
    res.status(409).json({
      status: 'error',
      message: 'Ya existe un registro con ese identificador único',
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
    return;
  }

  console.error('🔥 Error no controlado:', err);
  res.status(500).json({
    status: 'error',
    message:
      env.NODE_ENV === 'production'
        ? 'Error interno del servidor'
        : err instanceof Error
        ? err.message
        : 'Error desconocido',
  });
}