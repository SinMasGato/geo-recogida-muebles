import { CookieOptions, NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { loginSchema, registerSchema } from './auth.schema';
import { authService } from './auth.service';

const REFRESH_COOKIE_NAME = 'geo_refresh_token';

function getBaseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
  };
}

function getRefreshCookieOptions(): CookieOptions {
  return {
    ...getBaseCookieOptions(),
    maxAge: env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
  };
}

export const authController = {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = registerSchema.parse(req.body);
      const result = await authService.register(input, req.ip);

      res.cookie(REFRESH_COOKIE_NAME, result.rawRefreshToken, getRefreshCookieOptions());
      res.status(201).json({
        status: 'success',
        data: {
          user: result.user,
          accessToken: result.accessToken,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginSchema.parse(req.body);
      const result = await authService.login(input, req.ip);

      res.cookie(REFRESH_COOKIE_NAME, result.rawRefreshToken, getRefreshCookieOptions());
      res.status(200).json({
        status: 'success',
        data: {
          user: result.user,
          accessToken: result.accessToken,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (!rawToken) {
        throw new AppError('Cookie de sesión no encontrada', 401);
      }

      const result = await authService.refresh(rawToken, req.ip);

      res.cookie(REFRESH_COOKIE_NAME, result.rawRefreshToken, getRefreshCookieOptions());
      res.status(200).json({
        status: 'success',
        data: {
          accessToken: result.accessToken,
        },
      });
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE_NAME, getBaseCookieOptions());
      next(error);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      await authService.logout(rawToken);

      res.clearCookie(REFRESH_COOKIE_NAME, getBaseCookieOptions());
      res.status(200).json({
        status: 'success',
        message: 'Sesión cerrada correctamente',
      });
    } catch (error) {
      next(error);
    }
  },

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError('No autenticado', 401);
      }
      const profile = await authService.getProfile(req.user.id);
      res.status(200).json({
        status: 'success',
        data: { user: profile },
      });
    } catch (error) {
      next(error);
    }
  },
};