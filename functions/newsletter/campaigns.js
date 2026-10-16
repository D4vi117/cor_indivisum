const crypto = require('node:crypto');
const UNSUBSCRIBE = '{{{RESEND_UNSUBSCRIBE_URL}}}';
const HTML_LIMIT = 200 * 1024;

function draftValidationError(message) {
  const error = new Error(message);
  error.code = 'INVALID_NEWSLETTER_DRAFT';
  return error;
}

function validateDraft(input) {
  const subject = String(input?.subject || '').trim();
  const from = String(input?.from || '').trim();
  const html = String(input?.html || '');
  if (!subject || subject.length > 200) throw draftValidationError('O assunto deve ter entre 1 e 200 caracteres.');
  if (!from || !/^[^<>]+<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(from)) throw draftValidationError('Informe um remetente válido.');
  if (!html || Buffer.byteLength(html, 'utf8') > HTML_LIMIT) throw draftValidationError('O HTML excede o limite de 200 KiB ou está vazio.');
  const visibleUnsubscribeLink = /<a\b[^>]*\bhref\s*=\s*(["'])[^"']*\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}[^"']*\1[^>]*>\s*[^<\s][\s\S]*?<\/a\s*>/i.test(html);
  if (!visibleUnsubscribeLink) throw draftValidationError('Inclua um link visível de cancelamento de inscrição do Resend no conteúdo.');
  return { subject, from, html };
}

function createNewsletterCampaigns({ repository, provider, getAudience, now = Date.now }) {
  async function saveDraft({ uid, campaignId, ...fields }) {
    const draft = validateDraft(fields);
    if (!await provider.isVerifiedSender(draft.from)) {
      const error = new Error('O domínio do remetente não está verificado no Resend.');
      error.code = 'UNVERIFIED_SENDER';
      throw error;
    }
    const id = campaignId || crypto.randomUUID();
    const existing = campaignId ? await repository.getCampaign(campaignId) : null;
    if (existing && existing.status !== 'draft') {
      const error = new Error('Somente rascunhos podem ser editados.');
      error.code = 'NEWSLETTER_CAMPAIGN_NOT_EDITABLE';
      throw error;
    }
    const campaign = { ...draft, authorUid: uid, status: 'draft', updatedAt: now(), createdAt: existing?.createdAt || now() };
    if (existing?.audienceId) campaign.audienceId = existing.audienceId;
    await repository.saveCampaign(id, campaign);
    return { campaignId: id };
  }

  async function listCampaigns({ limit = 50 } = {}) {
    return repository.listCampaigns(Math.min(50, Math.max(1, Number(limit) || 50)));
  }

  async function getAudienceForConfirmation() {
    return getAudience();
  }

  async function send({ campaignId, confirmedAudienceId, uid }) {
    const campaign = await repository.getCampaign(campaignId);
    if (!campaign) throw new Error('Campanha não encontrada.');
    if (campaign.status !== 'draft') throw new Error('Campanha já enviada ou em reconciliação.');
    const audience = await getAudience();
    if (!confirmedAudienceId || confirmedAudienceId !== audience.id) {
      throw new Error('A audiência mudou. Confira a audiência e a contagem antes de confirmar novamente.');
    }
    if (!await repository.reserveSend(campaignId, uid)) throw new Error('Campanha já está sendo processada.');
    try {
      const result = await provider.createAndSend({
        from: campaign.from, subject: campaign.subject,
        html: campaign.html, segmentId: audience.id, send: true,
      });
      await repository.saveCampaign(campaignId, { status: result.status === 'sent' ? 'sent' : 'queued', providerId: result.id, audienceId: audience.id, audienceName: audience.name, recipientCount: audience.activeCount, resultCounts: result.counts || {}, sentAt: now(), updatedAt: now() });
      return { campaignId, status: result.status === 'sent' ? 'sent' : 'queued', recipientCount: audience.activeCount };
    } catch (error) {
      await repository.saveCampaign(campaignId, { status: error?.uncertain ? 'needs_reconciliation' : 'failed', updatedAt: now() });
      const sendError = new Error(error?.uncertain ? 'Resultado do envio incerto; reconciliação necessária.' : 'O Resend não aceitou a campanha.');
      sendError.code = error?.uncertain ? 'RESEND_SEND_UNCERTAIN' : error?.code || 'RESEND_SEND_FAILED';
      sendError.status = error?.status;
      sendError.providerMessage = error?.providerMessage;
      sendError.uncertain = Boolean(error?.uncertain);
      throw sendError;
    }
  }
  return { saveDraft, listCampaigns, getAudienceForConfirmation, send };
}

module.exports = { createNewsletterCampaigns, validateDraft, UNSUBSCRIBE };
