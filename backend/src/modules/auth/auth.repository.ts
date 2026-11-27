import { query, withTransaction } from '../../config/database';
import { UserRole } from '../../types/express';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export type RotateTokenResult =
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'inactive_user' }
  | { status: 'reuse_detected'; userId: string; tokenId: string; familyId: string }
  | { status: 'rotated'; user: { id: string; role: UserRole } };

export const authRepository = {
  async findUserByEmail(email: string): Promise<UserRow | null> {
    const res = await query<UserRow>(
      `SELECT id, email, password_hash, display_name, role, is_active, created_at
       FROM users WHERE email = $1`,
      [email]
    );
    return res.rows[0] || null;
  },

  async findUserById(id: string): Promise<Omit<UserRow, 'password_hash'> | null> {
    const res = await query<Omit<UserRow, 'password_hash'>>(
      `SELECT id, email, display_name, role, is_active, created_at
       FROM users WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  },

  async createUser(
    email: string,
    passwordHash: string,
    displayName: string
  ): Promise<Omit<UserRow, 'password_hash'>> {
    const res = await query<Omit<UserRow, 'password_hash'>>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, role, is_active, created_at`,
      [email, passwordHash, displayName]
    );
    return res.rows[0];
  },

  async createRefreshToken(
    userId: string,
    familyId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<string> {
    const res = await query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, familyId, tokenHash, expiresAt]
    );
    return res.rows[0].id;
  },

  async consumeAndRotateRefreshToken(
    currentTokenHash: string,
    newTokenHash: string,
    newExpiresAt: Date
  ): Promise<RotateTokenResult> {
    return withTransaction(async (client) => {
      const tokenRes = await client.query<RefreshTokenRow>(
        `SELECT id, user_id, family_id, expires_at, revoked_at
         FROM refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [currentTokenHash]
      );

      const stored = tokenRes.rows[0];
      if (!stored) {
        return { status: 'not_found' };
      }

      if (stored.revoked_at !== null) {
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = NOW()
           WHERE family_id = $1 AND revoked_at IS NULL`,
          [stored.family_id]
        );
        return {
          status: 'reuse_detected',
          userId: stored.user_id,
          tokenId: stored.id,
          familyId: stored.family_id,
        };
      }

      if (new Date(stored.expires_at) <= new Date()) {
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
          [stored.id]
        );
        return { status: 'expired' };
      }

      const userRes = await client.query<{ id: string; role: UserRole; is_active: boolean }>(
        `SELECT id, role, is_active FROM users WHERE id = $1`,
        [stored.user_id]
      );
      const user = userRes.rows[0];

      if (!user || !user.is_active) {
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = NOW()
           WHERE family_id = $1 AND revoked_at IS NULL`,
          [stored.family_id]
        );
        return { status: 'inactive_user' };
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [user.id, stored.family_id, newTokenHash, newExpiresAt]
      );

      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW(), replaced_by_token_id = $1
         WHERE id = $2`,
        [inserted.rows[0].id, stored.id]
      );

      return {
        status: 'rotated',
        user: { id: user.id, role: user.role },
      };
    });
  },

  async revokeTokenByHash(tokenHash: string): Promise<void> {
    await query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash]
    );
  },
  async purgeExpiredTokens(olderThanDays = 30): Promise<number> {
    const res = await query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < NOW() - ($1 * INTERVAL '1 day')
          OR (revoked_at IS NOT NULL AND revoked_at < NOW() - ($1 * INTERVAL '1 day'))`,
      [olderThanDays]
    );
    return res.rowCount ?? 0;
  },
};
