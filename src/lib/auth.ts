import { createAuthClient } from '@neondatabase/neon-js/auth';

const authBaseUrl = typeof window !== 'undefined'
  ? (window as any).NEON_AUTH_BASE_URL || process.env.NEON_AUTH_BASE_URL
  : process.env.NEON_AUTH_BASE_URL;

export const authClient = createAuthClient(authBaseUrl!);
