import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { apiLimiter, corsPolicy, securityHeaders } from './middlewares/security';
import { errorHandler } from './middlewares/errorHandler';
import { AppError } from './utils/AppError';
import authRoutes from './modules/auth/auth.routes';
import eventsRoutes from './modules/events/events.routes';
import mediaRoutes from './modules/media/media.routes';
import pinsRoutes from './modules/pins/pins.routes';

const app = express();

app.set('trust proxy', env.TRUST_PROXY === 0 ? false : env.TRUST_PROXY);

app.use(securityHeaders);
app.use(corsPolicy);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Sirve las imágenes subidas localmente de forma segura
app.use(
  '/uploads',
  express.static(path.resolve(process.cwd(), 'uploads'), {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    },
  })
);

app.use('/api', apiLimiter);

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/pins', pinsRoutes);

app.use((req, _res, next) => {
  next(new AppError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 404));
});

app.use(errorHandler);

export default app;