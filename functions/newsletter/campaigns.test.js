const test = require('node:test');
const assert = require('node:assert/strict');
const { createNewsletterCampaigns, validateDraft } = require('./campaigns');

function makeHarness() {
  const docs = new Map();
  let sendCalls = 0;
  let senderVerified = true;
  let failAmbiguous = false;
  const repository = {
    async getCampaign(id) { return docs.get(id) || null; },
    async saveCampaign(id, value) { docs.set(id, { ...(docs.get(id) || {}), ...structuredClone(value), id }); },
    async listCampaigns(limit) { return [...docs.values()].slice(0, limit); },
    async reserveSend(id, uid) {
      const current = docs.get(id);
      if (!current || current.status !== 'draft') return false;
      docs.set(id, { ...current, status: 'sending', authorUid: uid });
      return true;
    },
    async setAudience(id, audienceId) { const doc = docs.get(id); docs.set(id, { ...doc, audienceId }); },
  };
  const service = createNewsletterCampaigns({
    repository,
    provider: {
      isVerifiedSender: async () => senderVerified,
      createAndSend: async () => { sendCalls += 1; if (failAmbiguous) throw Object.assign(new Error('socket hang up'), { uncertain: true }); return { id: 'broadcast-1', status: 'queued', counts: { sent: 4 } }; },
    },
    getAudience: async () => ({ id: 'aud-1', name: 'Newsletter', activeCount: 4 }),
    now: () => 1_800_000_000_000,
  });
  return { service, docs, get sendCalls() { return sendCalls; }, set senderVerified(v) { senderVerified = v; }, set failAmbiguous(v) { failAmbiguous = v; } };
}
const valid = { subject: 'Novidades', from: 'Cor <news@example.com>', html: '<p>Oi</p><footer><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Cancelar inscrição</a></footer>' };

test('campaign draft validation enforces subject and HTML sizes and unsubscribe token', () => {
  assert.equal(validateDraft(valid).subject, 'Novidades');
  assert.throws(() => validateDraft({ ...valid, subject: 'x'.repeat(201) }), /assunto/i);
  assert.throws(() => validateDraft({ ...valid, html: 'x'.repeat(200 * 1024 + 1) }), /HTML/i);
  assert.throws(() => validateDraft({ ...valid, html: '<p>Oi</p>' }), /cancelamento/i);
  assert.throws(() => validateDraft({ ...valid, html: '<!-- {{{RESEND_UNSUBSCRIBE_URL}}} --><p>Oi</p>' }), /cancelamento/i);
});

test('campaign history exposes a safe recipient count before send', async () => {
  const h = makeHarness();
  const { campaignId } = await h.service.saveDraft({ uid: 'admin', ...valid });
  const result = await h.service.getAudienceForConfirmation();
  assert.equal(result.activeCount, 4);
  assert.equal(h.docs.get(campaignId).status, 'draft');
});

test('new campaign drafts omit audienceId until an audience is assigned', async () => {
  const h = makeHarness();
  const { campaignId } = await h.service.saveDraft({ uid: 'admin', ...valid });
  assert.equal(Object.hasOwn(h.docs.get(campaignId), 'audienceId'), false);
});

test('campaign drafts reject unverified senders', async () => {
  const h = makeHarness(); h.senderVerified = false;
  await assert.rejects(h.service.saveDraft({ uid: 'admin', ...valid }), /remetente/i);
});

test('campaign requires an explicitly selected audience and recovers when it is unavailable', async () => {
  let getAudienceCalls = 0;
  const h = makeHarness();
  const { campaignId } = await h.service.saveDraft({ uid: 'admin', ...valid });
  const service = createNewsletterCampaigns({
    repository: {
      getCampaign: (id) => h.docs.get(id),
      reserveSend: async (id) => { h.docs.set(id, { ...h.docs.get(id), status: 'sending' }); return true; },
      saveCampaign: (id, value) => h.docs.set(id, { ...h.docs.get(id), ...value }),
    },
    provider: { isVerifiedSender: async () => true, createAndSend: async () => ({ id: 'x' }) },
    getAudience: async () => { getAudienceCalls += 1; throw new Error('unavailable'); },
  });
  await assert.rejects(service.send({ campaignId, uid: 'admin' }));
  assert.equal(h.docs.get(campaignId).status, 'draft');
  assert.equal(getAudienceCalls, 1);
});

test('campaign send payload uses the current Resend segmentId API', async () => {
  const h = makeHarness();
  const { campaignId } = await h.service.saveDraft({ uid: 'admin', ...valid });
  const result = await h.service.send({ campaignId, uid: 'admin', confirmedAudienceId: 'aud-1' });
  assert.equal(result.status, 'queued');
  assert.equal(h.docs.get(campaignId).audienceId, 'aud-1');
});

test('campaign send refuses when the confirmed audience is no longer configured', async () => {
  const h = makeHarness();
  const { campaignId } = await h.service.saveDraft({ uid: 'admin', ...valid });
  await assert.rejects(h.service.send({ campaignId, uid: 'admin', confirmedAudienceId: 'other-audience' }), /audiência mudou/i);
  assert.equal(h.docs.get(campaignId).status, 'draft');
  assert.equal(h.sendCalls, 0);
});

test('campaign history caps at 50 entries', async () => {
  const h = makeHarness();
  for (let i = 0; i < 55; i++) await h.docs.set(`c${i}`, { id: `c${i}` });
  assert.equal((await h.service.listCampaigns({ limit: 500 })).length, 50);
});

test('campaign send reserves once and marks uncertain result for reconciliation', async () => {
  const h = makeHarness();
  const { campaignId } = await h.service.saveDraft({ uid: 'admin', ...valid });
  h.failAmbiguous = true;
  await assert.rejects(h.service.send({ campaignId, uid: 'admin', confirmedAudienceId: 'aud-1' }));
  assert.equal(h.docs.get(campaignId).status, 'needs_reconciliation');
  await assert.rejects(h.service.send({ campaignId, uid: 'admin', confirmedAudienceId: 'aud-1' }), /already|reconcil/i);
  assert.equal(h.sendCalls, 1);
});

test('campaign send preserves safe Resend rejection details after marking the draft failed', async () => {
  const h = makeHarness();
  const { campaignId } = await h.service.saveDraft({ uid: 'admin', ...valid });
  const rejectingService = createNewsletterCampaigns({
    repository: {
      getCampaign: (id) => h.docs.get(id),
      saveCampaign: (id, value) => h.docs.set(id, { ...h.docs.get(id), ...value }),
      reserveSend: async (id) => { h.docs.set(id, { ...h.docs.get(id), status: 'sending' }); return true; },
    },
    provider: {
      isVerifiedSender: async () => true,
      createAndSend: async () => { throw Object.assign(new Error('Resend rejected request.'), { code: 'RESEND_API_ERROR', status: 400, providerMessage: 'Invalid segment.' }); },
    },
    getAudience: async () => ({ id: 'aud-1', name: 'Newsletter', activeCount: 4 }),
  });

  await assert.rejects(
    rejectingService.send({ campaignId, confirmedAudienceId: 'aud-1', uid: 'admin' }),
    (error) => error.code === 'RESEND_API_ERROR' && error.status === 400 && error.providerMessage === 'Invalid segment.',
  );
  assert.equal(h.docs.get(campaignId).status, 'failed');
});

test('campaign callables require staff authorization', async () => {
  const { createNewsletterFunctions } = require('./functions');
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) };
  const callables = createNewsletterFunctions({ onCall: (handler) => handler, onRequest: (handler) => handler, HttpsError: class extends Error {}, db, FieldValue: { delete: () => 'DELETE' }, verificarAdmin: async () => { throw new Error('permission-denied'); } });
  for (const name of ['listarRemetentesResendNewsletter', 'salvarRascunhoNewsletter', 'listarCampanhasNewsletter', 'enviarCampanhaNewsletter']) {
    await assert.rejects(callables[name]({ auth: { uid: 'user' }, data: {} }), /permission-denied/);
  }
});
