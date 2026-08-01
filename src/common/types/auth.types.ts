export type UserRole = 'user' | 'seller' | 'admin';

export interface JwtAccessPayload {
  sub: number;
  role: UserRole;
  type: 'access';
}

export interface JwtRefreshPayload {
  sub: number;
  role: UserRole;
  type: 'refresh';
}

export interface AuthenticatedUser {
  id: number;
  role: UserRole;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
