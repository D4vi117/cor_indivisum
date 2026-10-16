const { createResendOAuth } = require('./oauth');
const { createNewsletterSubscribers } = require('./subscribers');
const { createNewsletterCampaigns } = require('./campaigns');

function safeResendErrorMessage(value) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[endereço de e-mail]')
    .replace(/\bre_[A-Z0-9_-]+\b/gi, '[credencial]')
    .slice(0, 240) || null;
}

function createNewsletterBroadcastBody(input) {
  const { segmentId, ...rest } = input;
  return { ...rest, ...(segmentId ? { segment_id: segmentId } : {}) };
}

function createNewsletterFunctions({ onCall, onRequest, HttpsError, db, FieldValue, verificarAdmin, fetchImpl, now, log = (entry) => console.error(JSON.stringify(entry)) }) {
  const configRef = db.collection('newsletter_config').doc('resend');
  const grantRef = db.collection('newsletter_private').doc('resend_grant');
  const oauthStates = db.collection('newsletter_oauth_states');
  const privateLockRef = db.collection('newsletter_private').doc('resend_refresh_lock');
  const repository = {
    async getConfig() { const snap = await configRef.get(); return snap.exists ? snap.data() : null; },
    async saveConfig(value) { await configRef.set(value, { merge: true }); },
    async saveOAuthState(state, value) { await oauthStates.doc(state).set(value); },
    async consumeOAuthState(state) {
      const ref = oauthStates.doc(state);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.delete(ref);
        return snap.data();
      });
    },
    async getGrant() {
      const snap = await grantRef.get();
      if (!snap.exists) return null;
      const value = snap.data();
      return value?.refreshToken ? value : null;
    },
    async saveGrant(value) { await grantRef.set(value, { merge: true }); },
    async deleteGrant() { await grantRef.delete(); },
    async withRefreshLock(callback) {
      const owner = require('node:crypto').randomUUID();
      const lockRef = privateLockRef;
      const deadline = Date.now() + 25_000;
      const leaseMs = 10 * 60_000;
      const timeNow = () => now ? now() : Date.now();
      while (Date.now() < deadline) {
        const acquired = await db.runTransaction(async (tx) => {
          const snap = await tx.get(lockRef);
          const lock = snap.data()?.refreshLock;
          const time = timeNow();
          if (lock && lock.expiresAt > time) return false;
          tx.set(lockRef, { refreshLock: { owner, expiresAt: time + leaseMs } }, { merge: true });
          return true;
        });
        if (acquired) {
          const heartbeat = setInterval(() => {
            db.runTransaction(async (tx) => {
              const snap = await tx.get(lockRef);
              if (snap.data()?.refreshLock?.owner === owner) tx.set(lockRef, { refreshLock: { owner, expiresAt: timeNow() + leaseMs } }, { merge: true });
            }).catch(() => {});
          }, 60_000);
          try { return await callback(); }
          finally {
            clearInterval(heartbeat);
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(lockRef);
              if (snap.data()?.refreshLock?.owner === owner) tx.set(lockRef, { refreshLock: FieldValue.delete() }, { merge: true });
            });
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new HttpsError('deadline-exceeded', 'A conexão do Resend está ocupada. Tente novamente.');
    },
  };

  const oauth = createResendOAuth({ repository, fetchImpl, now });
  let oauthNeedsReconnect = false;

  const subscriberService = createNewsletterSubscribers({
    repository: {
      async getProfile(uid) {
        const snap = await db.collection('usuarios').doc(uid).get();
        return snap.exists ? { uid, ...snap.data() } : null;
      },
      async getProfiles() {
        const snap = await db.collection('usuarios').where('newsletter', '==', true).get();
        return snap.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
      },
      getConfig: async () => (await configRef.get()).data() || null,
    },
    api: {
      async request(path, options = {}) {
        const accessToken = await oauth.getAccessToken();
        let response;
        try {
          response = await (fetchImpl || fetch)(`https://api.resend.com${path}`, {
            ...options, headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...(options.headers || {}) },
          });
        } catch {
          throw new Error('Resend contact operation failed.');
        }
        let data = {};
        try { data = await response.json(); } catch {}
        if (response.status === 401 || response.status === 403) oauthNeedsReconnect = true;
        if (!response.ok) {
          if (response.status === 404 && /^\/contacts\/[^/]+$/.test(path)) return null;
          const error = new Error('Resend contact operation failed.');
          error.uncertain = response.status >= 500 || response.status === 429;
          throw error;
        }
        return data;
      },
      async findContact(audienceId, email) {
        const contact = await this.request(`/contacts/${encodeURIComponent(email)}`);
        if (!contact) return null;
        return { ...contact };
      },
      async contactInSegment(email, audienceId) {
        const segments = await this.request(`/contacts/${encodeURIComponent(email)}/segments`);
        return (segments.data || segments.segments || []).some((entry) => entry.id === audienceId);
      },
      async addContactToSegment(email, audienceId) {
        return this.request(`/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(audienceId)}`, { method: 'POST' });
      },
      async createContact(input) {
        const { audienceId, ...body } = input;
        const { firstName, ...rest } = body;
        const created = await this.request('/contacts', { method: 'POST', body: JSON.stringify({ ...rest, ...(firstName ? { first_name: firstName } : {}) }) });
        if (created?.id) await this.request(`/contacts/${encodeURIComponent(created.id)}/segments/${encodeURIComponent(audienceId)}`, { method: 'POST' });
        return created;
      },
      async updateContact(email, input) {
        const { audienceId, ...body } = input;
        const { firstName, ...rest } = body;
        const contact = await this.request(`/contacts/${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify({ ...rest, ...(firstName ? { first_name: firstName } : {}) }) });
        const belongs = await this.contactInSegment(email, audienceId);
        if (!belongs) await this.request(`/contacts/${encodeURIComponent(contact.id || email)}/segments/${encodeURIComponent(audienceId)}`, { method: 'POST' });
        return contact;
      },
    },
  });
  const campaignRepository = {
    async getCampaign(id) {
      const snap = await db.collection('newsletter_campaigns').doc(id).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },
    async saveCampaign(id, value) { await db.collection('newsletter_campaigns').doc(id).set({ ...value, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); },
    async listCampaigns(limit) {
      const snap = await db.collection('newsletter_campaigns').orderBy('updatedAt', 'desc').limit(limit).get();
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    },
    async reserveSend(id, uid) {
      const ref = db.collection('newsletter_campaigns').doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().status !== 'draft') return false;
        tx.update(ref, { status: 'sending', authorUid: uid, sendStartedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        return true;
      });
    },
  };
  const provider = {
    async request(path, options = {}) {
      let accessToken;
      try {
        accessToken = await oauth.getAccessToken();
      } catch (error) {
        log({ event: 'newsletter_resend_auth_error', path, errorCode: error.code || null, errorType: error.name || 'Error' });
        throw error;
      }
      let response;
      try {
        response = await (fetchImpl || fetch)(`https://api.resend.com${path}`, { ...options, headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...(options.headers || {}) } });
      } catch {
        const error = new Error('Resend request failed.');
        error.uncertain = path === '/broadcasts';
        error.code = 'RESEND_NETWORK_ERROR';
        log({ event: 'newsletter_resend_network_error', path, errorCode: error.code });
        throw error;
      }
      let data = {};
      try { data = await response.json(); } catch {}
      if (response.status === 401 || response.status === 403) oauthNeedsReconnect = true;
      if (!response.ok) {
        const error = new Error('Resend request failed.');
        error.uncertain = response.status >= 500 || response.status === 429;
        error.code = response.status === 401 || response.status === 403 ? 'RESEND_AUTH_ERROR' : 'RESEND_API_ERROR';
        error.status = response.status;
        error.providerMessage = safeResendErrorMessage(data.message || data.error?.message);
        log({ event: 'newsletter_resend_http_error', path, errorCode: error.code, status: response.status, providerMessage: error.providerMessage });
        throw error;
      }
      return data;
    },
    async isVerifiedSender(from) {
      const address = from.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>$/)?.[1] || from;
      const domain = address.match(/^[^@\s]+@([^@\s]+)$/)?.[1]?.toLowerCase();
      if (!domain) return false;
      const result = await this.request('/domains');
      return (result.data || []).some((item) => item.name?.toLowerCase() === domain && item.status === 'verified' && item.capabilities?.sending !== 'disabled');
    },
    async createAndSend(input) {
      const { id, ...rest } = await provider.request('/broadcasts', {
        method: 'POST', body: JSON.stringify(createNewsletterBroadcastBody(input)),
      });
      if (!id) {
        const error = new Error('Resend request failed.');
        error.uncertain = true;
        throw error;
      }
      return { id, status: 'queued', ...rest };
    },
  };
  const campaignService = createNewsletterCampaigns({
    repository: campaignRepository, provider,
    getAudience: async () => {
      const config = await repository.getConfig();
      if (!config?.audienceId) throw new Error('Newsletter audience is not configured.');
      let after;
      let audienceName = config.audienceName;
      do {
        const query = new URLSearchParams({ limit: '100' });
        if (after) query.set('after', after);
        const result = await provider.request(`/segments?${query}`);
        const page = result.data || [];
        const selected = page.find((item) => item.id === config.audienceId);
        if (selected) audienceName = selected.name;
        after = result.has_more ? page.at(-1)?.id : null;
      } while (after);
      if (!audienceName) throw new Error('Newsletter audience is not available.');
      let contactAfter;
      let activeCount = 0;
      do {
        const query = new URLSearchParams({ limit: '100' });
        if (contactAfter) query.set('after', contactAfter);
        const result = await provider.request(`/segments/${encodeURIComponent(config.audienceId)}/contacts?${query}`);
        const page = result.data || [];
        activeCount += page.filter((contact) => !contact.unsubscribed).length;
        contactAfter = result.has_more ? page.at(-1)?.id : null;
      } while (contactAfter);
      return { id: config.audienceId, name: audienceName, activeCount };
    },
    now,
  });
  const staffCall = (handler) => onCall(async (request) => {
    await verificarAdmin(request.auth?.uid);
    try { return await handler(request); }
    catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', 'Não foi possível concluir a operação com o Resend.');
    }
  });

  function domainLookupError(error) {
    if (error instanceof HttpsError) return error;
    if (error.code === 'RESEND_AUTH_ERROR') {
      return new HttpsError('failed-precondition', 'O Resend recusou o acesso aos domínios. Reconecte a conta e confirme que ela tem um domínio com envio habilitado.');
    }
    if (error.message?.includes('precisa ser refeita')) {
      return new HttpsError('failed-precondition', 'A conexão com o Resend expirou. Reconecte a conta e tente novamente.');
    }
    if (error.code === 'RESEND_NETWORK_ERROR') {
      return new HttpsError('unavailable', 'O servidor não conseguiu se conectar ao Resend. Tente novamente em alguns minutos.');
    }
    if (error.code === 'RESEND_API_ERROR') {
      const status = Number(error.status);
      if (status === 429 || status >= 500) {
        return new HttpsError('unavailable', `O Resend está temporariamente indisponível (HTTP ${status}). Tente novamente em alguns minutos.`);
      }
      return new HttpsError('failed-precondition', `O Resend recusou a consulta dos domínios (HTTP ${status || 'desconhecido'}). Reconecte a conta e verifique o acesso ao domínio.`);
    }
    return new HttpsError('internal', 'Não foi possível consultar os domínios no Resend.');
  }

  const iniciarOAuthResendNewsletter = staffCall(async (request) => oauth.start({ uid: request.auth.uid }));
  const obterStatusResendNewsletter = staffCall(async () => {
    const [oauthStatus, config] = await Promise.all([oauth.getStatus(), repository.getConfig()]);
    return { ...oauthStatus, needsReconnect: oauthNeedsReconnect || oauthStatus.needsReconnect, audienceId: config?.audienceId || null };
  });
  const desconectarResendNewsletter = staffCall(() => oauth.disconnect());
  const listarAudienciasResendNewsletter = staffCall(async () => {
    const accessToken = await oauth.getAccessToken();
    const audiences = [];
    let after;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (after) query.set('after', after);
      const response = await (fetchImpl || fetch)(`https://api.resend.com/segments?${query}`, { headers: { authorization: `Bearer ${accessToken}` } });
      let result = {};
      try { result = await response.json(); } catch {}
      if (!response.ok) throw new Error('Resend audience listing failed.');
      audiences.push(...(result.data || []).map(({ id, name }) => ({ id, name })));
      after = result.has_more ? result.data?.at(-1)?.id : null;
    } while (after);
    return { audiences };
  });
  const criarAudienciaResendNewsletter = staffCall(async (request) => {
    const name = String(request.data?.name || '').trim().slice(0, 100);
    if (!name) throw new HttpsError('invalid-argument', 'Informe o nome da audiência.');
    const accessToken = await oauth.getAccessToken();
    const response = await (fetchImpl || fetch)('https://api.resend.com/segments', { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok || !result.id) throw new Error('Resend audience creation failed.');
    return { id: result.id, name };
  });
  const configurarAudienciaNewsletter = staffCall(async (request) => {
    const audienceId = String(request.data?.audienceId || '').trim();
    if (!audienceId) throw new HttpsError('invalid-argument', 'Selecione uma audiência.');
    const accessToken = await oauth.getAccessToken();
    let after;
    let match = null;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (after) query.set('after', after);
      const response = await (fetchImpl || fetch)(`https://api.resend.com/segments?${query}`, { headers: { authorization: `Bearer ${accessToken}` } });
      let result = {};
      try { result = await response.json(); } catch {}
      if (!response.ok) throw new HttpsError('unavailable', 'Não foi possível consultar as audiências do Resend.');
      match = (result.data || []).find((item) => item.id === audienceId) || match;
      after = result.has_more ? result.data?.at(-1)?.id : null;
    } while (after && !match);
    if (!match) throw new HttpsError('failed-precondition', 'A audiência selecionada não está disponível.');
    await configRef.set({ audienceId, audienceName: match.name }, { merge: true });
    return { audienceId, audienceName: match.name };
  });
  const sincronizarInscritosNewsletter = staffCall(async () => {
    const config = await repository.getConfig();
    if (!config?.audienceId) throw new HttpsError('failed-precondition', 'Configure uma audiência antes de sincronizar.');
    const result = await subscriberService.syncNewsletterSubscribers();
    return { ...result, failed: result.failed, synced: result.synced, skipped: result.skipped };
  });
  const listarRemetentesResendNewsletter = staffCall(async () => {
    try {
      const result = await provider.request('/domains');
      return { senders: (result.data || []).filter((domain) => domain.status === 'verified' && domain.capabilities?.sending !== 'disabled').map((domain) => ({ domain: domain.name, status: domain.status })) };
    } catch (error) {
      throw domainLookupError(error);
    }
  });
  const obterContagemInscritosNewsletter = staffCall(async (request) => {
    const audienceId = String(request.data?.audienceId || '').trim();
    const configured = await repository.getConfig();
    if (!audienceId || audienceId !== configured?.audienceId) throw new HttpsError('failed-precondition', 'Confirme a audiência antes de consultar a contagem.');
    const audience = await campaignService.getAudienceForConfirmation();
    return { activeCount: audience.activeCount };
  });
  const salvarRascunhoNewsletter = staffCall(async (request) => {
      try { return await campaignService.saveDraft({ ...request.data, uid: request.auth.uid }); }
    catch (error) {
      if (error.code === 'UNVERIFIED_SENDER') throw new HttpsError('failed-precondition', 'O domínio deste remetente não está verificado ou não tem envio habilitado no Resend. Escolha um domínio indicado na lista de remetentes verificados.');
      if (error.code === 'RESEND_AUTH_ERROR') throw new HttpsError('failed-precondition', 'A autorização do Resend expirou ou não permite consultar os domínios. Reconecte a conta do Resend.');
      if (error.message.includes('precisa ser refeita')) throw new HttpsError('failed-precondition', 'A conexão com o Resend expirou. Reconecte a conta e tente novamente.');
      if (error.message === 'Resend não está conectado.') throw new HttpsError('failed-precondition', 'A conta do Resend está desconectada. Conecte novamente o Resend para salvar o rascunho.');
      if (error.code === 'RESEND_NETWORK_ERROR' || error.code === 'RESEND_API_ERROR') throw domainLookupError(error);
      if (error.code === 'INVALID_NEWSLETTER_DRAFT') throw new HttpsError('invalid-argument', error.message);
      if (error.code === 'NEWSLETTER_CAMPAIGN_NOT_EDITABLE') throw new HttpsError('failed-precondition', error.message);
      log({ event: 'newsletter_save_draft_unclassified_error', errorCode: error.code || null, errorType: error.name || 'Error' });
      throw new HttpsError('internal', 'Não foi possível salvar o rascunho. Consulte os logs da função.');
    }
  });
  const listarCampanhasNewsletter = staffCall(async (request) => ({ campaigns: await campaignService.listCampaigns(request.data || {}) }));
  const enviarCampanhaNewsletter = staffCall(async (request) => {
    try { return await campaignService.send({ campaignId: request.data?.campaignId, confirmedAudienceId: request.data?.audienceId, uid: request.auth.uid }); }
    catch (error) {
      let safe = error.message.includes('Resultado do envio incerto') || error.message.includes('Campanha') || error.message.includes('não encontrada') || error.message.includes('audiência mudou')
        ? error.message : 'Não foi possível confirmar o envio. Consulte o histórico antes de tentar novamente.';
      if (error.code === 'RESEND_AUTH_ERROR') safe = 'O Resend recusou a autorização. Reconecte a conta antes de tentar enviar novamente.';
      else if (error.code === 'RESEND_API_ERROR' && error.status >= 400 && error.status < 500) {
        safe = `O Resend recusou a campanha (HTTP ${error.status}).${error.providerMessage ? ` ${error.providerMessage}` : ' Revise o remetente e a audiência.'}`;
      }
      throw new HttpsError('failed-precondition', safe);
    }
  });
  const resendNewsletterOAuthCallback = onRequest(async (req, res) => {
    if (req.method !== 'GET') return res.status(405).send('Método não permitido.');
    try {
      await oauth.handleCallback({ state: req.query.state, code: req.query.code, error: req.query.error });
      return res.redirect(302, '/admin/?tab=newsletter&resend=connected');
    } catch (error) {
      return res.redirect(302, '/admin/?tab=newsletter&resend=error');
    }
  });
  return { iniciarOAuthResendNewsletter, resendNewsletterOAuthCallback, obterStatusResendNewsletter, desconectarResendNewsletter, listarAudienciasResendNewsletter, criarAudienciaResendNewsletter, configurarAudienciaNewsletter, obterContagemInscritosNewsletter, sincronizarInscritosNewsletter, listarRemetentesResendNewsletter, salvarRascunhoNewsletter, listarCampanhasNewsletter, enviarCampanhaNewsletter, newsletterSubscriberService: subscriberService };
}

module.exports = { createNewsletterFunctions, createNewsletterBroadcastBody };
