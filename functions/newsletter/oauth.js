const crypto = require('node:crypto');

const CALLBACK_URL = 'https://corindivisum.com.br/api/newsletter/resend/callback';
const RESEND = 'https://api.resend.com';
const AUTH = `${RESEND}/oauth/authorize`;
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function createResendOAuth({ repository, fetchImpl = fetch, now = Date.now, randomBytes = crypto.randomBytes, log = () => {} }) {
  async function ensureClient() {
    const existing = await repository.getConfig();
    if (existing?.clientId) return existing.clientId;
    const response = await fetchImpl(`${RESEND}/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Cor Indivisum Newsletter',
        redirect_uris: [CALLBACK_URL],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
        response_types: ['code'],
        scope: 'full_access',
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.client_id) throw new Error('Não foi possível registrar o cliente OAuth do Resend.');
    const config = { ...(existing || {}), clientId: data.client_id };
    await repository.saveConfig(config);
    return config.clientId;
  }

  async function start({ uid }) {
    if (!uid) throw new Error('Autenticação necessária.');
    const clientId = await ensureClient();
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    await repository.saveOAuthState(state, { uid, verifier, expiresAt: now() + STATE_TTL_MS });
    const url = new URL(AUTH);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: CALLBACK_URL,
      scope: 'full_access', state, code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();
    return { authorizationUrl: url.toString() };
  }

  async function exchange(body) {
    const response = await fetchImpl(`${RESEND}/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token || !data.refresh_token) throw new Error('A autorização do Resend não foi concluída.');
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: now() + Number(data.expires_in || 900) * 1000,
      tokenType: data.token_type || 'Bearer',
    };
  }

  async function handleCallback({ state, code, error }) {
    if (error || !state || !code) throw new Error('A autorização do Resend foi cancelada ou está inválida.');
    const pending = await repository.consumeOAuthState(state);
    if (!pending || pending.expiresAt <= now() || !pending.uid || !pending.verifier) {
      throw new Error('Estado OAuth inválido, expirado ou já utilizado.');
    }
    const config = await repository.getConfig();
    if (!config?.clientId) throw new Error('Cliente OAuth não configurado.');
    const grant = await exchange({
      grant_type: 'authorization_code', code, client_id: config.clientId,
      redirect_uri: CALLBACK_URL, code_verifier: pending.verifier,
    });
    await repository.saveGrant({ ...grant, clientId: config.clientId, connectedBy: pending.uid, updatedAt: now() });
    return { uid: pending.uid };
  }

  let needsReconnect = false;
  async function getStatus() {
    const grant = await repository.getGrant();
    return { connected: Boolean(grant?.refreshToken), needsReconnect };
  }

  async function getAccessToken() {
    const current = await repository.getGrant();
    if (!current?.refreshToken) throw new Error('Resend não está conectado.');
    if (current.expiresAt > now() + REFRESH_EARLY_MS) return current.accessToken;
    return repository.withRefreshLock(async () => {
      const latest = await repository.getGrant();
      if (!latest?.refreshToken) throw new Error('Resend não está conectado.');
      if (latest.expiresAt > now() + REFRESH_EARLY_MS) return latest.accessToken;
      try {
        const rotated = await exchange({ grant_type: 'refresh_token', refresh_token: latest.refreshToken, client_id: latest.clientId });
        await repository.saveGrant({ ...latest, ...rotated, updatedAt: now() });
        needsReconnect = false;
        return rotated.accessToken;
      } catch (error) {
        needsReconnect = true;
        throw new Error('A conexão com o Resend precisa ser refeita.');
      }
    });
  }

  async function disconnect() {
    const grant = await repository.getGrant();
    if (grant?.refreshToken) {
      try {
        await fetchImpl(`${RESEND}/oauth/revoke`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: grant.refreshToken, client_id: grant.clientId, token_type_hint: 'refresh_token' }).toString(),
        });
      } catch (error) {
        log({ event: 'resend_oauth_revoke_failed', message: 'Falha ao revogar a conexão Resend.' });
      }
    }
    await repository.deleteGrant();
    needsReconnect = false;
    return { disconnected: true };
  }

  return { start, handleCallback, getStatus, getAccessToken, disconnect };
}

module.exports = { CALLBACK_URL, createResendOAuth };
