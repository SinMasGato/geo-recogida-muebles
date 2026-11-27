import { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { createPinSchema, pinIdParamSchema, searchPinsSchema } from './pins.schema';
import { pinsService } from './pins.service';

export const pinsController = {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('No autenticado', 401);
      const input = createPinSchema.parse(req.body);
      const pin = await pinsService.createQuickPin(req.user, input, req.ip);
      res.status(201).json({ status: 'success', data: { pin } });
    } catch (error) {
      next(error);
    }
  },

  async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = searchPinsSchema.parse(req.query);
      const pins = await pinsService.searchPins(input);
      res.status(200).json({
        status: 'success',
        results: pins.length,
        data: { pins },
      });
    } catch (error) {
      next(error);
    }
  },

  async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = pinIdParamSchema.parse(req.params);
      const pin = await pinsService.getPinDetail(id);
      res.status(200).json({ status: 'success', data: { pin } });
    } catch (error) {
      next(error);
    }
  },

  async reserve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('No autenticado', 401);
      const { id } = pinIdParamSchema.parse(req.params);
      const pin = await pinsService.reservePin(req.user, id, req.ip);
      res.status(200).json({ status: 'success', data: { pin } });
    } catch (error) {
      next(error);
    }
  },

  async release(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('No autenticado', 401);
      const { id } = pinIdParamSchema.parse(req.params);
      const pin = await pinsService.releaseReservation(req.user, id, req.ip);
      res.status(200).json({ status: 'success', data: { pin } });
    } catch (error) {
      next(error);
    }
  },

  async collect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('No autenticado', 401);
      const { id } = pinIdParamSchema.parse(req.params);
      const pin = await pinsService.markCollected(req.user, id, req.ip);
      res.status(200).json({ status: 'success', data: { pin } });
    } catch (error) {
      next(error);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('No autenticado', 401);
      const { id } = pinIdParamSchema.parse(req.params);
      await pinsService.deletePin(req.user, id, req.ip);
      res.status(200).json({ status: 'success', message: 'Objeto eliminado correctamente' });
    } catch (error) {
      next(error);
    }
  },
};