import express, { Router } from 'express';
import { authenticate } from '../../middlewares/auth';
import { userWriteLimiter } from '../../middlewares/security';
import { mediaController } from './media.controller';
import { ALLOWED_IMAGE_MIMES, MAX_IMAGE_BYTES } from './media.schema';

const router = Router();

// Paso 1: Solicitar URL prefirmada (requiere sesión iniciada)
router.post('/presign', authenticate, userWriteLimiter, mediaController.presign);

// Paso 2: Subir el archivo binario usando el token firmado de un solo uso
router.put(
  '/upload/:token',
  express.raw({
    type: [...ALLOWED_IMAGE_MIMES],
    limit: MAX_IMAGE_BYTES,
  }),
  mediaController.upload
);

export default router;