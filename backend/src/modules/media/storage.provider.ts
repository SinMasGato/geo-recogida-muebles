import fs from 'fs/promises';
import path from 'path';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';

export interface StorageProvider {
  save(relativePath: string, buffer: Buffer, contentType: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  delete(relativePath: string): Promise<void>;
}

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

class LocalStorageProvider implements StorageProvider {
  private resolveSafePath(relativePath: string): string {
    const absolutePath = path.resolve(UPLOADS_ROOT, relativePath);
    // Protección contra Path Traversal
    if (!absolutePath.startsWith(UPLOADS_ROOT + path.sep)) {
      throw new AppError('Ruta de destino no permitida', 403);
    }
    return absolutePath;
  }

  async save(relativePath: string, buffer: Buffer): Promise<void> {
    const absolutePath = this.resolveSafePath(relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);
  }

  async exists(relativePath: string): Promise<boolean> {
    const absolutePath = this.resolveSafePath(relativePath);
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(relativePath: string): Promise<void> {
    const absolutePath = this.resolveSafePath(relativePath);
    try {
      await fs.unlink(absolutePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = env.S3_BUCKET!;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }

  async save(relativePath: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: relativePath,
        Body: buffer,
        ContentType: contentType,
        // Los nombres usan UUID: nunca cambian, así que navegadores y CDN pueden cachearlos 1 año
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      // HeadObject solo pide metadatos (sin descargar la imagen), ahorrando ancho de banda y latencia
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: relativePath,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(relativePath: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: relativePath,
      })
    );
  }
}

export const storageProvider: StorageProvider =
  env.STORAGE_DRIVER === 's3' ? new S3StorageProvider() : new LocalStorageProvider();