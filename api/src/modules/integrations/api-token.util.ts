import { createHash, randomBytes } from 'crypto';

// Integration tokens live 60 days; the integration is expected to rotate its
// own token well before then (POST /integrations/token/rotate).
export const API_TOKEN_TTL_DAYS = 60;
export const API_TOKEN_PREFIX = 'cet_';

export function generateApiToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function apiTokenExpiry(from = new Date()): Date {
  return new Date(from.getTime() + API_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
