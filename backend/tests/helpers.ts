import request from 'supertest';
import app from '../src/app';
import { pool } from '../src/config/database';

export const api = () => request(app);

export async function resetTestData(emailPrefix = 'vitest-'): Promise<void> {
  await pool.query(
    `DELETE FROM pins WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)
        OR reserved_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${emailPrefix}%`]
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${emailPrefix}%`]);
}

export async function closeTestPool(): Promise<void> {
  await pool.end();
}