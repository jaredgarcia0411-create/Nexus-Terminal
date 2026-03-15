import { createSchwabAuth } from '@sudowealth/schwab-api';
import type { SchwabTokenPayload } from '@/lib/schwab/crypto';

type SchwabAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getSchwabAuthConfig(): SchwabAuthConfig {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Schwab OAuth environment is not configured');
  }

  return { clientId, clientSecret, redirectUri };
}

function createAuthClient() {
  return createSchwabAuth({ oauthConfig: getSchwabAuthConfig() });
}

function toPayload(
  accessToken: string,
  refreshToken: string,
  nowMs = Date.now(),
): SchwabTokenPayload {
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(nowMs + ACCESS_TOKEN_TTL_MS).toISOString(),
    refreshExpiresAt: new Date(nowMs + REFRESH_TOKEN_TTL_MS).toISOString(),
  };
}

export async function getSchwabAuthUrl(): Promise<{ authUrl: string; state: string }> {
  const auth = createAuthClient();
  const { authUrl, generatedState } = await auth.getAuthorizationUrl();
  if (!generatedState) {
    throw new Error('Failed to generate Schwab OAuth state');
  }
  return { authUrl, state: generatedState };
}

export async function exchangeSchwabCode(code: string): Promise<SchwabTokenPayload> {
  const auth = createAuthClient();
  const tokens = await auth.exchangeCode(code);

  if (!tokens.accessToken || !tokens.refreshToken) {
    throw new Error('Schwab token exchange returned incomplete token set');
  }

  return toPayload(tokens.accessToken, tokens.refreshToken);
}

export async function refreshSchwabToken(refreshToken: string): Promise<SchwabTokenPayload> {
  const auth = createAuthClient();
  const tokens = await auth.refresh(refreshToken);

  if (!tokens.accessToken) {
    throw new Error('Schwab token refresh returned no access token');
  }

  return toPayload(tokens.accessToken, tokens.refreshToken ?? refreshToken);
}
