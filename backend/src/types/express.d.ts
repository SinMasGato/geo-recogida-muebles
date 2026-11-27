export type UserRole = 'user' | 'admin';

export interface AuthUserPayload {
  id: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}