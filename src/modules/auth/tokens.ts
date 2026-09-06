import jwt from 'jsonwebtoken';
import { loadConfig } from '../../config.js';

const cfg = loadConfig();

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, cfg.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${cfg.ACCESS_TTL_MIN}m`,
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'refresh' }, cfg.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${cfg.REFRESH_TTL_DAYS}d`,
  });
}

export function verifyAccessToken(token: string): { sub: string } {
  const decoded = jwt.verify(token, cfg.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
    throw new Error('invalid token');
  }
  return { sub: decoded.sub };
}
