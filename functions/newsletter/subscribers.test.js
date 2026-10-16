const test = require('node:test');
const assert = require('node:assert/strict');
const { createNewsletterSubscribers } = require('./subscribers');

function setup({ profiles = {}, contacts = {}, existingContactInDifferentSegment = false } = {}) {
  const writes = [];
  const audience = { id: 'aud-1' };
  const service = createNewsletterSubscribers({
    repository: {
      getConfig: async () => ({ audienceId: audience.id }),
      getProfile: async (uid) => profiles[uid] ? { uid, ...profiles[uid] } : null,
      getProfiles: async () => Object.entries(profiles).map(([uid, profile]) => ({ uid, ...profile })),
    },
    api: {
      findContact: async (audienceId, email) => contacts[email] || null,
      contactInSegment: async () => !existingContactInDifferentSegment,
      addContactToSegment: async (email, audienceId) => writes.push({ action: 'add-to-segment', email, audienceId }),
      createContact: async (input) => { writes.push(input); contacts[input.email] = { ...input }; },
      updateContact: async (id, input) => { writes.push(input); contacts[input.email] = { ...contacts[input.email], ...input }; },
    },
  });
  return { service, writes, contacts };
}

test('subscriber sync excludes opted-out profiles and invalid emails', async () => {
  const h = setup({ profiles: {
    yes: { newsletter: true, email: 'Ana@Example.com' },
    no: { newsletter: false, email: 'no@example.com' },
    invalid: { newsletter: true, email: 'bad' },
  } });
  assert.deepEqual(await h.service.syncNewsletterSubscribers(), { total: 3, synced: 1, skipped: 2, failed: 0 });
  assert.equal(h.writes[0].email, 'ana@example.com');
});

test('subscriber sync is idempotent for an existing subscribed contact', async () => {
  const contacts = { 'a@example.com': { id: 'contact-1', email: 'a@example.com', unsubscribed: false } };
  const h = setup({ profiles: { a: { newsletter: true, email: 'a@example.com' } }, contacts });
  assert.deepEqual(await h.service.syncNewsletterSubscriber({ uid: 'a' }), { synced: true });
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].unsubscribed, undefined);
});

test('an existing global contact is added to the selected segment without being recreated', async () => {
  const contacts = { 'a@example.com': { id: 'contact-1', email: 'a@example.com', unsubscribed: false } };
  const h = setup({ profiles: { a: { newsletter: true, email: 'a@example.com' } }, contacts, existingContactInDifferentSegment: true });
  await h.service.syncNewsletterSubscriber({ uid: 'a' });
  assert.equal(h.writes.filter((write) => !write.action).length, 1);
  assert.deepEqual(h.writes.find((write) => write.action), { action: 'add-to-segment', email: 'a@example.com', audienceId: 'aud-1' });
});

test('routine subscriber sync preserves an existing unsubscribe', async () => {
  const contacts = { 'a@example.com': { id: 'contact-1', email: 'a@example.com', unsubscribed: true } };
  const h = setup({ profiles: { a: { newsletter: true, email: 'a@example.com' } }, contacts });
  await h.service.syncNewsletterSubscriber({ uid: 'a' });
  assert.equal(h.writes[0].unsubscribed, undefined);
  assert.equal(contacts['a@example.com'].unsubscribed, true);
});

test('only explicit opt-in may reactivate an unsubscribed contact', async () => {
  const contacts = { 'a@example.com': { id: 'contact-1', email: 'a@example.com', unsubscribed: true } };
  const h = setup({ profiles: { a: { newsletter: true, email: 'a@example.com' } }, contacts });
  await h.service.syncNewsletterSubscriber({ uid: 'a', explicitOptIn: true });
  assert.equal(h.writes[0].unsubscribed, false);
});

test('contact lookup treats provider not-found as absence so a new contact can be created', async () => {
  const writes = [];
  const service = createNewsletterSubscribers({
    repository: { getConfig: async () => ({ audienceId: 'segment-1' }), getProfile: async () => ({ newsletter: true, email: 'new@example.com' }) },
    api: { findContact: async () => null, createContact: async (value) => writes.push(value), updateContact: async () => assert.fail('must not update') },
  });
  assert.deepEqual(await service.syncNewsletterSubscriber({ uid: 'new' }), { synced: true });
  assert.equal(writes.length, 1);
});

test('audience and sync callable operations reject callers without staff role', async () => {
  const { createNewsletterFunctions } = require('./functions');
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) };
  const callables = createNewsletterFunctions({
    onCall: (handler) => handler, onRequest: (handler) => handler,
    HttpsError: class HttpsError extends Error {}, db, FieldValue: { delete: () => 'DELETE' },
    verificarAdmin: async () => { throw new Error('permission-denied'); }, fetchImpl: async () => ({}),
  });
  for (const name of ['listarAudienciasResendNewsletter', 'criarAudienciaResendNewsletter', 'configurarAudienciaNewsletter', 'sincronizarInscritosNewsletter']) {
    await assert.rejects(callables[name]({ auth: { uid: 'user' }, data: {} }), /permission-denied/);
  }
});
