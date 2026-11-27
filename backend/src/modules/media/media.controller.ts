import { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { presignRequestSchema, uploadTokenParamSchema } from './media.schema';
import { mediaService } from './media.service';

export const mediaController = {
  presign(req: Request, res: Response, next: NextFunction): void {
    try {
      if (!req.user) throw new AppError('No autenticado', 401);
      const input = presignRequestSchema.parse(req.body);
      const apiBaseUrl = `${req.protocol}://${req.get('host')}`;

      const result = mediaService.createPresignedUpload(req.user.id, input, apiBaseUrl);
      res.status(200).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  },

  async upload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = uploadTokenParamSchema.parse(req.params);
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError('Cuerpo binario de imagen requerido', 400);
      }

      const result = await mediaService.consumeAndSaveUpload(
        token,
        req.headers['content-type'],
        req.body
      );

      res.status(201).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  },
};