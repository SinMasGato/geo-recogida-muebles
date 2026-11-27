import { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { sseManager } from './events.manager';

export const eventsController = {
  createTicket(req: Request, res: Response, next: NextFunction): void {
    try {
      if (!req.user) {
        throw new AppError('No autenticado', 401);
      }
      const data = sseManager.issueTicket(req.user.id);
      res.status(200).json({ status: 'success', data });
    } catch (error) {
      next(error);
    }
  },

  stream(req: Request, res: Response, next: NextFunction): void {
    const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
    if (!ticket) {
      return next(new AppError('Ticket SSE requerido', 401));
    }

    const userId = sseManager.consumeTicket(ticket);
    if (!userId) {
      return next(new AppError('Ticket SSE inválido o expirado', 401));
    }

    // Cabeceras estándar SSE (X-Accel-Buffering desactiva el búfer de Nginx en producción)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const clientId = sseManager.addClient(userId, res);

    req.on('close', () => {
      sseManager.removeClient(clientId);
    });
  },
};