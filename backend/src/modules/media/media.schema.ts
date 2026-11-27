import { z } from 'zod';

export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export const presignRequestSchema = z
  .object({
    contentType: z.enum(ALLOWED_IMAGE_MIMES, {
      errorMap: () => ({ message: 'Solo se permiten imágenes JPEG, PNG o WebP' }),
    }),
    sizeBytes: z
      .number()
      .int()
      .positive('El tamaño de la imagen debe ser mayor que 0')
      .max(MAX_IMAGE_BYTES, 'La imagen no puede superar los 5 MB'),
  })
  .strict();

export const uploadTokenParamSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, 'Token de subida inválido'),
});

export type PresignRequestInput = z.infer<typeof presignRequestSchema>;