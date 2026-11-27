import crypto from 'crypto';
import { storageProvider } from './storage.provider';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import {
  AllowedImageMime,
  MAX_IMAGE_BYTES,
  PresignRequestInput,
} from './media.schema';

interface UploadTicket {
  userId: string;
  contentType: AllowedImageMime;
  maxBytes: number;
  relativePath: string; // ej. pins/<userId>/<uuid>.webp
  expiresAt: number;
}

const TICKET_TTL_MS = 120_000; // 2 minutos para completar la subida


const MIME_TO_EXT: Record<AllowedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Inspecciona la firma binaria real (Magic Bytes) para evitar archivos disfrazados
function detectRealImageMime(buffer: Buffer): AllowedImageMime | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

class MediaService {
  private tickets = new Map<string, UploadTicket>();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [token, ticket] of this.tickets.entries()) {
        if (ticket.expiresAt <= now) {
          this.tickets.delete(token);
        }
      }
    }, 60_000);
    this.cleanupTimer.unref();
  }

  createPresignedUpload(userId: string, input: PresignRequestInput, apiBaseUrl: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const ext = MIME_TO_EXT[input.contentType];
    const fileName = `${crypto.randomUUID()}.${ext}`;
    const relativePath = `pins/${userId}/${fileName}`;

    this.tickets.set(token, {
      userId,
      contentType: input.contentType,
      maxBytes: Math.min(input.sizeBytes, MAX_IMAGE_BYTES),
      relativePath,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });

    const basePublicUrl = env.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, '');

    return {
      uploadUrl: `${apiBaseUrl}/api/media/upload/${token}`,
      photoUrl: `${basePublicUrl}/${relativePath}`,
      method: 'PUT',
      headers: {
        'Content-Type': input.contentType,
      },
      expiresInSeconds: TICKET_TTL_MS / 1000,
    };
  }

  async consumeAndSaveUpload(
    token: string,
    headerContentType: string | undefined,
    buffer: Buffer
  ): Promise<{ photoUrl: string; sizeBytes: number }> {
    const ticket = this.tickets.get(token);
    if (!ticket) {
      throw new AppError('URL de subida inválida o ya utilizada', 401);
    }

    // Se elimina inmediatamente: un solo uso
    this.tickets.delete(token);

    if (ticket.expiresAt <= Date.now()) {
      throw new AppError('La URL de subida ha expirado', 401);
    }

    const normalizedHeader = headerContentType?.split(';')[0].trim().toLowerCase();
    if (normalizedHeader !== ticket.contentType) {
      throw new AppError('El Content-Type no coincide con el firmado', 400);
    }

    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      throw new AppError('Tamaño de imagen inválido (máximo 5 MB)', 400);
    }

    // Verificación criptográfica/binaria del archivo real
    const detectedMime = detectRealImageMime(buffer);
    if (!detectedMime || detectedMime !== ticket.contentType) {
      throw new AppError(
        'El archivo no corresponde a una imagen válida del tipo declarado',
        400
      );
    }

 
    await storageProvider.save(ticket.relativePath, buffer, ticket.contentType);

    const basePublicUrl = env.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, '');
    return {
      photoUrl: `${basePublicUrl}/${ticket.relativePath}`,
      sizeBytes: buffer.length,
    };
  }

  // Verifica que la foto pertenece a nuestro servidor, a este usuario y existe en disco
  async assertValidUserPhotoUrl(userId: string, photoUrl: string): Promise<void> {
    const basePublicUrl = env.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, '');
    const expectedPrefix = `${basePublicUrl}/pins/${userId}/`;

    if (!photoUrl.startsWith(expectedPrefix)) {
      throw new AppError('La URL de la foto no es válida o no pertenece a tu cuenta', 400);
    }

    const fileName = photoUrl.slice(expectedPrefix.length);
    const safeFileRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;
    if (!safeFileRegex.test(fileName)) {
      throw new AppError('Formato de nombre de imagen inválido', 400);
    }

    const relativePath = `pins/${userId}/${fileName}`;
const exists = await storageProvider.exists(relativePath);
if (!exists) {
  throw new AppError('La imagen declarada todavía no se ha subido al servidor', 400);
}
  }
}

export const mediaService = new MediaService();