const test = require('node:test');
const assert = require('node:assert/strict');
const { createResendOAuth } = require('./oauth');

function harness() {
  const documents = new Map();
  const calls = [];
  const logs = [];
  let now = 1_800_000_000_000;
  const repository = {
    getConfig: async () => documents.get('config') || null,
    saveConfig: async (value) => documents.set('config', structuredClone(value)),
    saveOAuthState: async (state, value) => documents.set(`state:${state}`, structuredClone(value)),
    consumeOAuthState: async (state) => {
      const key = `state:${state}`;
      const value = documents.get(key) || null;
      documents.delete(key);
      return value;
    },
    getGrant: async () => documents.get('grant') || null,
    saveGrant: async (value) => documents.set('grant', structuredClone(value)),
    withRefreshLock: async (fn) => {
      const previous = repository.lockTail || Promise.resolve();
      let release;
      repository.lockTail = new Promise((resolve) => { release = resolve; });
      await previous;
      try { return await fn(); } finally { release(); }
    },
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const pathname = new URL(url).pathname;
    let payload;
    if (pathname === '/oauth/register') payload = { client_id: 'client-public' };
    else if (pathname === '/oauth/token' && new URLSearchParams(options.body).get('grant_type') === 'authorization_code') payload = { access_token: 'ACCESS_SECRET', refresh_token: 'REFRESH_SECRET', expires_in: 3600 };
    else if (pathname === '/oauth/token') payload = { access_token: 'ACCESS_ROTATED', refresh_token: 'REFRESH_ROTATED', expires_in: 3600 };
    else if (pathname === '/oauth/revoke') payload = {};
    else payload = {};
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  const oauthRepository = {
    ...repository,
    getGrant: async () => documents.get('grant') || null,
    saveGrant: async (value) => documents.set('grant', structuredClone(value)),
  };
  return { service: createResendOAuth({ repository: oauthRepository, fetchImpl, now: () => now, log: (entry) => logs.push(entry), randomBytes: (n) => Buffer.alloc(n, 7) }), documents, calls, logs, setNow: (v) => { now = v; } };
}

test('OAuth start returns PKCE authorization URL and persists admin-bound state', async () => {
  const h = harness();
  const result = await h.service.start({ uid: 'admin-1' });
  const url = new URL(result.authorizationUrl);
  assert.equal(url.origin, 'https://api.resend.com');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), 'full_access');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.equal(h.documents.get(`state:${url.searchParams.get('state')}`).uid, 'admin-1');
});

test('OAuth callback rejects wrong, expired, and replayed state before token exchange', async (t) => {
  for (const mode of ['wrong', 'expired', 'replayed']) await t.test(mode, async () => {
    const h = harness();
    const { state } = await h.service.createStateForTest?.('admin-1') || {};
    if (!state) {
      const started = await h.service.start({ uid: 'admin-1' });
      const url = new URL(started.authorizationUrl);
      const usedState = url.searchParams.get('state');
      if (mode === 'wrong') await assert.rejects(h.service.handleCallback({ state: `${usedState}wrong`, code: 'code' }));
      if (mode === 'expired') { h.setNow(1_800_000_700_000); await assert.rejects(h.service.handleCallback({ state: usedState, code: 'code' })); }
      if (mode === 'replayed') { await h.service.handleCallback({ state: usedState, code: 'code' }); await assert.rejects(h.service.handleCallback({ state: usedState, code: 'code' })); }
      assert.equal(h.calls.filter((c) => new URL(c.url).pathname === '/oauth/token').length, mode === 'replayed' ? 1 : 0);
    }
  });
});

test('OAuth callback persists grant; status never reveals tokens or logs them', async () => {
  const h = harness();
  const started = await h.service.start({ uid: 'admin-1' });
  const state = new URL(started.authorizationUrl).searchParams.get('state');
  const callback = await h.service.handleCallback({ state, code: 'authorization-code' });
  assert.equal(callback.uid, 'admin-1');
  assert.equal(h.documents.get('grant').refreshToken, 'REFRESH_SECRET');
  const status = await h.service.getStatus();
  assert.equal(JSON.stringify(status).includes('ACCESS_SECRET'), false);
  assert.equal(JSON.stringify(status).includes('REFRESH_SECRET'), false);
  assert.equal(JSON.stringify(h.logs).includes('ACCESS_SECRET'), false);
  assert.equal(JSON.stringify(h.logs).includes('REFRESH_SECRET'), false);
});

test('refresh rotates and persists the refresh token before returning access', async () => {
  const h = harness();
  await h.documents.set('grant', { accessToken: 'ACCESS_OLD', refreshToken: 'REFRESH_OLD', expiresAt: 1_800_000_001_000, clientId: 'client-public' });
  const access = await h.service.getAccessToken();
  assert.equal(access, 'ACCESS_ROTATED');
  assert.equal(h.documents.get('grant').refreshToken, 'REFRESH_ROTATED');
});

test('concurrent refreshes submit a rotating refresh token once', async () => {
  const h = harness();
  await h.documents.set('grant', { accessToken: 'ACCESS_OLD', refreshToken: 'REFRESH_OLD', expiresAt: 1_800_000_001_000, clientId: 'client-public' });
  await Promise.all([h.service.getAccessToken(), h.service.getAccessToken()]);
  assert.equal(h.calls.filter((c) => new URL(c.url).pathname === '/oauth/token').length, 1);
  assert.equal(h.documents.get('grant').refreshToken, 'REFRESH_ROTATED');
});
