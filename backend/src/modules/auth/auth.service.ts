import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { UserRole } from '../../types/express';
import { auditRepository } from '../audit/audit.repository';
import { authRepository } from './auth.repository';
import { LoginInput, RegisterInput } from './auth.schema';

const BCRYPT_ROUNDS = 12;
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('dummy_timing_protection_value', BCRYPT_ROUNDS);

function hashToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', env.JWT_REFRESH_SECRET)
    .update(rawToken)
    .digest('hex');
}

function generateRawRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function signAccessToken(userId: string, role: UserRole): string {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function getRefreshExpiryDate(): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + env.JWT_REFRESH_EXPIRES_DAYS);
  return expires;
}

export const authService = {
  async register(input: RegisterInput, ip?: string) {
    const existing = await authRepository.findUserByEmail(input.email);
    if (existing) {
      throw new AppError('El correo electrónico ya está registrado', 409);
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await authRepository.createUser(input.email, passwordHash, input.displayName);

    const familyId = crypto.randomUUID();
    const rawRefreshToken = generateRawRefreshToken();
    await authRepository.createRefreshToken(
      user.id,
      familyId,
      hashToken(rawRefreshToken),
      getRefreshExpiryDate()
    );

    const accessToken = signAccessToken(user.id, user.role);

    await auditRepository.log({
      actorId: user.id,
      action: 'USER_REGISTERED',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
      },
      accessToken,
      rawRefreshToken,
    };
  },

  async login(input: LoginInput, ip?: string) {
    const user = await authRepository.findUserByEmail(input.email);
    const isPasswordValid = await bcrypt.compare(
      input.password,
      user ? user.password_hash : DUMMY_BCRYPT_HASH
    );

    if (!user || !isPasswordValid) {
      throw new AppError('Credenciales incorrectas', 401);
    }

    if (!user.is_active) {
      throw new AppError('Cuenta desactivada. Contacta con soporte.', 403);
    }

    const familyId = crypto.randomUUID();
    const rawRefreshToken = generateRawRefreshToken();
    await authRepository.createRefreshToken(
      user.id,
      familyId,
      hashToken(rawRefreshToken),
      getRefreshExpiryDate()
    );

    const accessToken = signAccessToken(user.id, user.role);

    await auditRepository.log({
      actorId: user.id,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
      },
      accessToken,
      rawRefreshToken,
    };
  },

  async refresh(rawRefreshToken: string, ip?: string) {
    const currentHash = hashToken(rawRefreshToken);
    const nextRawRefreshToken = generateRawRefreshToken();
    const nextHash = hashToken(nextRawRefreshToken);

    const outcome = await authRepository.consumeAndRotateRefreshToken(
      currentHash,
      nextHash,
      getRefreshExpiryDate()
    );

    if (outcome.status === 'not_found') {
      throw new AppError('Sesión inválida', 401);
    }

    if (outcome.status === 'reuse_detected') {
      await auditRepository.log({
        actorId: outcome.userId,
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        entityType: 'refresh_token',
        entityId: outcome.tokenId,
        metadata: { familyId: outcome.familyId },
        ipAddress: ip,
      });
      throw new AppError(
        'Actividad sospechosa detectada. Todas las sesiones han sido cerradas.',
        401
      );
    }

    if (outcome.status === 'expired') {
      throw new AppError('La sesión ha expirado. Inicia sesión de nuevo.', 401);
    }

    if (outcome.status === 'inactive_user') {
      throw new AppError('Usuario inactivo o inexistente', 401);
    }

    const accessToken = signAccessToken(outcome.user.id, outcome.user.role);

    return {
      accessToken,
      rawRefreshToken: nextRawRefreshToken,
    };
  },

  async logout(rawRefreshToken?: string) {
    if (rawRefreshToken) {
      await authRepository.revokeTokenByHash(hashToken(rawRefreshToken));
    }
  },

  async getProfile(userId: string) {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw new AppError('Usuario no encontrado', 404);
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      createdAt: user.created_at,
    };
  },
};