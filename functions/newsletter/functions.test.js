const test = require('node:test');
const assert = require('node:assert/strict');
const { createNewsletterFunctions, createNewsletterBroadcastBody } = require('./functions');

class TestHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function makeFunctions({ fetchImpl, grant: grantOverride, logs = [] }) {
  const campaigns = new Map();
  const grant = grantOverride === undefined
    ? { accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 300_000 }
    : grantOverride;
  const db = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              if (name === 'newsletter_private' && id === 'resend_grant') return { exists: true, data: () => grant };
              if (name === 'newsletter_campaigns' && campaigns.has(id)) return { exists: true, id, data: () => campaigns.get(id) };
              return { exists: false, data: () => null };
            },
            async set(value, options = {}) { if (name === 'newsletter_campaigns') campaigns.set(id, { ...(options.merge ? campaigns.get(id) : {}), ...value }); },
            async update(value) { if (name === 'newsletter_campaigns') campaigns.set(id, { ...campaigns.get(id), ...value }); },
            async delete() {},
          };
        },
        orderBy() { return { desc() { return this; }, limit() { return this; }, async get() { return { docs: [...campaigns.entries()].map(([id, data]) => ({ id, data: () => data })) }; } }; },
      };
    },
    async runTransaction(callback) {
      return callback({
        async get(ref) { return campaigns.has(ref.id) ? { exists: true, id: ref.id, data: () => campaigns.get(ref.id) } : { exists: false }; },
        update(ref, value) { campaigns.set(ref.id, { ...campaigns.get(ref.id), ...value }); },
        set(ref, value, options = {}) { campaigns.set(ref.id, { ...(options.merge ? campaigns.get(ref.id) : {}), ...value }); },
        delete() {},
      });
    },
  };
  return createNewsletterFunctions({
    onCall: (handler) => handler,
    onRequest: (handler) => handler,
    HttpsError: TestHttpsError,
    db,
    FieldValue: { delete: () => 'DELETE', serverTimestamp: () => 'TIMESTAMP' },
    verificarAdmin: async () => {},
    fetchImpl,
    log: (entry) => logs.push(entry),
  });
}

const resend503 = async () => ({ ok: false, status: 503, json: async () => ({ message: 'provider internal detail' }) });

test('domain listing reports a Resend 503 as a temporary provider outage', async () => {
  const functions = makeFunctions({ fetchImpl: resend503 });
  await assert.rejects(
    functions.listarRemetentesResendNewsletter({ auth: { uid: 'admin' }, data: {} }),
    (error) => error.code === 'unavailable' && /Resend.*HTTP 503/.test(error.message) && !error.message.includes('provider internal detail'),
  );
});

test('saving a draft reports a Resend 503 as a temporary provider outage', async () => {
  const logs = [];
  const functions = makeFunctions({ fetchImpl: resend503, logs });
  await assert.rejects(
    functions.salvarRascunhoNewsletter({
      auth: { uid: 'admin' },
      data: {
        subject: 'Novidades',
        from: 'Cor <newsletter@example.com>',
        html: '<p>Oi</p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Cancelar inscrição</a>',
      },
    }),
    (error) => error.code === 'unavailable' && /Resend.*HTTP 503/.test(error.message),
  );
  assert.ok(logs.some((entry) => entry.event === 'newsletter_resend_http_error' && entry.status === 503 && entry.path === '/domains'));
  assert.equal(JSON.stringify(logs).includes('access-token'), false);
});

test('saving a draft without an OAuth grant asks for reconnection instead of returning 503', async () => {
  const functions = makeFunctions({ fetchImpl: resend503, grant: null });
  await assert.rejects(
    functions.salvarRascunhoNewsletter({
      auth: { uid: 'admin' },
      data: {
        subject: 'Novidades',
        from: 'Cor <newsletter@example.com>',
        html: '<p>Oi</p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Cancelar inscrição</a>',
      },
    }),
    (error) => error.code === 'failed-precondition' && /Conecte novamente o Resend/.test(error.message),
  );
});

test('saving a draft with a missing unsubscribe link returns a validation error', async () => {
  const functions = makeFunctions({ fetchImpl: async () => { throw new Error('Resend should not be called'); } });
  await assert.rejects(
    functions.salvarRascunhoNewsletter({
      auth: { uid: 'admin' },
      data: { subject: 'Novidades', from: 'Cor <newsletter@example.com>', html: '<p>Oi</p>' },
    }),
    (error) => error.code === 'invalid-argument' && /link visível de cancelamento/.test(error.message),
  );
});

test('sending a campaign uses Resend REST segment_id field', async () => {
  const body = createNewsletterBroadcastBody({ from: 'Cor <newsletter@example.com>', subject: 'Novidades', html: '<p>Oi</p>', segmentId: 'segment-1', send: true });
  assert.equal(body.segment_id, 'segment-1');
  assert.equal(Object.hasOwn(body, 'segmentId'), false);
});

test('campaign callable forwards the expected REST body', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/domains')) return { ok: true, status: 200, json: async () => ({ data: [{ name: 'example.com', status: 'verified', capabilities: { sending: 'enabled' } }] }) };
    if (url.endsWith('/segments?limit=100')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'segment-1', name: 'Newsletter' }], has_more: false }) };
    if (url.includes('/segments/segment-1/contacts?limit=100')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'contact-1', unsubscribed: false }], has_more: false }) };
    if (url.endsWith('/broadcasts')) return { ok: true, status: 201, json: async () => ({ id: 'broadcast-1', status: 'queued' }) };
    throw new Error(`Unexpected Resend URL: ${url}`);
  };
  const functions = makeFunctions({ fetchImpl });
  const draft = await functions.salvarRascunhoNewsletter({ auth: { uid: 'admin' }, data: {
    subject: 'Novidades', from: 'Cor <newsletter@example.com>',
    html: '<p>Oi</p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Cancelar inscrição</a>',
  } });
  try {
    await functions.enviarCampanhaNewsletter({ auth: { uid: 'admin' }, data: { campaignId: draft.campaignId, audienceId: 'segment-1' } });
  } catch (error) {
    assert.fail(`Campaign send failed: ${error.message}`);
  }

  const broadcastRequest = requests.find((request) => request.url.endsWith('/broadcasts'));
  const body = JSON.parse(broadcastRequest.options.body);
  assert.equal(body.segment_id, 'segment-1');
  assert.equal(Object.hasOwn(body, 'segmentId'), false);
});
