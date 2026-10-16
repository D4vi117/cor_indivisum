(function () {
  let started = false;
  let campaigns = [];
  let selectedCampaignId = null;
  let activeAudience = null;
  let publishedImages = [];
  let editorMode = 'visual';
  let selectedNewsletterImage = null;
  const $ = (id) => document.getElementById(id);
  const feedback = (message) => { $('newsletter-feedback').textContent = message; };
  const call = async (name, data = {}) => {
    const fn = functions.httpsCallable(name);
    const result = await fn(data);
    return result.data;
  };

  async function loadCampaigns() {
    const result = await call('listarCampanhasNewsletter', { limit: 50 });
    campaigns = result.campaigns || [];
    const host = $('newsletter-history');
    host.replaceChildren();
    if (!campaigns.length) { host.textContent = 'Ainda não há campanhas.'; return; }
    for (const campaign of campaigns) {
      const row = document.createElement('div');
      row.className = 'newsletter-history-row';
      const title = document.createElement('strong'); title.textContent = campaign.subject || 'Sem assunto';
      const status = document.createElement('span'); status.textContent = campaign.status || '';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn-outline'; edit.textContent = 'Abrir';
      edit.addEventListener('click', () => {
        selectedCampaignId = campaign.status === 'draft' ? campaign.id : null;
        $('newsletter-subject').value = campaign.subject || '';
        $('newsletter-sender').value = campaign.from || '';
        $('newsletter-html').value = campaign.html || '';
        $('newsletter-visual-editor').innerHTML = campaign.html || '';
        updatePreview();
        setEditorMode('visual');
        updatePreview();
      });
      row.append(title, status, edit); host.append(row);
    }
  }

  function updatePreview() {
    syncEditorHtml();
    $('newsletter-preview-frame').srcdoc = $('newsletter-html').value;
  }

  function syncEditorHtml() {
    if (editorMode === 'visual') $('newsletter-html').value = $('newsletter-visual-editor').innerHTML;
    else $('newsletter-visual-editor').innerHTML = $('newsletter-html').value;
  }

  function setEditorMode(mode) {
    syncEditorHtml();
    editorMode = mode;
    const visual = mode === 'visual';
    $('newsletter-visual-panel').hidden = !visual;
    $('newsletter-html-panel').hidden = visual;
    $('newsletter-mode-visual').classList.toggle('is-active', visual);
    $('newsletter-mode-html').classList.toggle('is-active', !visual);
    $('newsletter-mode-visual').setAttribute('aria-selected', String(visual));
    $('newsletter-mode-html').setAttribute('aria-selected', String(!visual));
    if (visual) {
      $('newsletter-visual-editor').innerHTML = $('newsletter-html').value;
      selectedNewsletterImage = null;
      $('newsletter-image-width').disabled = true;
      $('newsletter-image-width-value').textContent = 'Selecione uma imagem';
    }
  }

  function imageUrl(path) {
    try {
      const url = new URL(path, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/loja/p/')) return null;
      return `${window.location.origin}${url.pathname}`;
    } catch { return null; }
  }

  function renderImagePicker(query = '') {
    const host = $('newsletter-image-results');
    host.replaceChildren();
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    const matches = publishedImages.filter((item) => `${item.product} ${item.name}`.toLocaleLowerCase('pt-BR').includes(normalized));
    $('newsletter-image-count').textContent = `${matches.length} ${matches.length === 1 ? 'imagem' : 'imagens'}`;
    if (!matches.length) { host.textContent = publishedImages.length ? 'Nenhuma imagem corresponde à busca.' : 'Não há imagens publicadas disponíveis.'; return; }
    for (const item of matches) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'newsletter-image-option'; button.setAttribute('role', 'option');
      const image = document.createElement('img'); image.src = item.url; image.alt = ''; image.loading = 'lazy';
      const label = document.createElement('span'); label.textContent = `${item.product} · ${item.name}`;
      button.title = item.path;
      button.append(image, label);
      button.addEventListener('click', () => {
        const alt = window.prompt('Descrição da imagem para acessibilidade', item.name) || '';
        $('newsletter-visual-editor').focus();
        const imageNode = document.createElement('img');
        imageNode.src = item.url;
        imageNode.alt = alt;
        imageNode.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;margin:16px auto;';
        const selection = window.getSelection();
        if (selection?.rangeCount && $('newsletter-visual-editor').contains(selection.anchorNode)) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(imageNode);
          range.setStartAfter(imageNode);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          $('newsletter-visual-editor').append(imageNode);
        }
        selectNewsletterImage(imageNode);
        $('newsletter-image-picker').hidden = true;
        syncEditorHtml(); updatePreview();
      });
      host.append(button);
    }
  }

  function selectNewsletterImage(image) {
    if (!(image instanceof HTMLImageElement) || !$('newsletter-visual-editor').contains(image)) return;
    if (selectedNewsletterImage && selectedNewsletterImage !== image) selectedNewsletterImage.classList.remove('newsletter-image-selected');
    selectedNewsletterImage = image;
    image.classList.add('newsletter-image-selected');
    const parsed = Number.parseFloat(image.style.width || image.getAttribute('width') || '100');
    const percentage = image.style.width?.includes('%') ? parsed : Math.min(100, Math.round((image.getBoundingClientRect().width / $('newsletter-visual-editor').clientWidth) * 100));
    $('newsletter-image-width').disabled = false;
    $('newsletter-image-width').value = String(Math.max(10, Math.min(100, percentage || 100)));
    $('newsletter-image-width-value').textContent = `${$('newsletter-image-width').value}%`;
  }

  function updateSelectedImageWidth(value) {
    const width = Math.max(10, Math.min(100, Number(value) || 100));
    $('newsletter-image-width-value').textContent = `${width}%`;
    if (!selectedNewsletterImage || !$('newsletter-visual-editor').contains(selectedNewsletterImage)) {
      $('newsletter-image-width').disabled = true;
      $('newsletter-image-width-value').textContent = 'Selecione uma imagem';
      return;
    }
    selectedNewsletterImage.style.width = `${width}%`;
    selectedNewsletterImage.style.maxWidth = '100%';
    selectedNewsletterImage.style.height = 'auto';
    syncEditorHtml();
    updatePreview();
  }

  async function loadPublishedImages() {
    try {
      const response = await fetch('/image-manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Image manifest unavailable.');
      const manifest = await response.json();
      publishedImages = (manifest.images || []).flatMap((entry) => {
        const url = imageUrl(entry.path);
        if (!url || !/\.(avif|gif|jpe?g|png|svg|webp)$/i.test(url)) return [];
        let name = entry.name || url.split('/').pop();
        try { name = decodeURIComponent(name); } catch {}
        return [{ product: entry.directory || 'Site', name, path: entry.path, url }];
      });
      $('newsletter-image-count').textContent = `${publishedImages.length} imagens`;
      renderImagePicker($('newsletter-image-search').value);
    } catch {
      publishedImages = [];
      $('newsletter-image-count').textContent = '';
      $('newsletter-image-results').textContent = 'Não foi possível carregar as imagens publicadas.';
    }
  }

  async function loadAudiences() {
    const { audiences } = await call('listarAudienciasResendNewsletter');
    const select = $('newsletter-audience');
    select.replaceChildren();
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Selecione uma audiência'; select.append(placeholder);
    for (const audience of audiences || []) {
      const option = document.createElement('option'); option.value = audience.id; option.textContent = audience.name; select.append(option);
    }
    if (activeAudience) select.value = activeAudience;
    else select.value = '';
    if (activeAudience && select.value === activeAudience) await loadAudienceCount();
    else $('newsletter-recipient-count').textContent = 'Confirme a audiência para consultar os inscritos ativos.';
  }

  async function loadAudienceCount() {
    const audienceId = $('newsletter-audience').value;
    if (!audienceId) { $('newsletter-recipient-count').textContent = 'Selecione uma audiência para ver inscritos ativos.'; return; }
    try {
      const result = await call('obterContagemInscritosNewsletter', { audienceId });
      $('newsletter-recipient-count').textContent = `${result.activeCount} inscritos ativos nesta audiência.`;
    } catch { $('newsletter-recipient-count').textContent = 'Não foi possível consultar a contagem atual.'; }
  }

  async function loadSenders() {
    const { senders } = await call('listarRemetentesResendNewsletter');
    const select = $('newsletter-sender'); select.replaceChildren();
    if (!senders?.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Nenhum domínio verificado no Resend'; select.append(option);
      return;
    }
    for (const sender of senders || []) {
      const option = document.createElement('option'); option.value = `Cor Indivisum <newsletter@${sender.domain}>`; option.textContent = `newsletter@${sender.domain}`; select.append(option);
    }
  }

  async function initialize() {
    if (started) { await loadCampaigns().catch(() => {}); return; }
    started = true;
    try {
      const status = await call('obterStatusResendNewsletter');
      $('newsletter-status').textContent = status.needsReconnect
        ? 'A conexão com o Resend precisa ser refeita.'
        : status.connected ? 'Resend conectado.' : 'Resend desconectado.';
      $('newsletter-connect').hidden = Boolean(status.connected);
      $('newsletter-disconnect').hidden = !status.connected;
      $('newsletter-workspace').hidden = !status.connected;
      const params = new URLSearchParams(window.location.search);
      if (params.has('resend')) {
        feedback(params.get('resend') === 'connected' ? 'Resend conectado.' : 'A conexão não foi concluída. Você pode tentar novamente.');
        window.history.replaceState({}, '', `${window.location.pathname}?tab=newsletter`);
      }
      if (status.connected) {
        const result = await call('obterStatusResendNewsletter');
        activeAudience = result.audienceId || activeAudience;
        const results = await Promise.allSettled([loadAudiences(), loadSenders(), loadCampaigns(), loadPublishedImages()]);
        const senderResult = results[1];
        if (senderResult.status === 'rejected') {
          const error = senderResult.reason;
          const message = error?.message || error?.details?.message || '';
          feedback(error?.code?.includes('unavailable') && message.includes('Resend')
            ? message
            : 'Não foi possível consultar os domínios do Resend. Verifique a conexão da conta e tente novamente.');
        } else if (!activeAudience) feedback('Selecione e confirme a audiência antes de sincronizar ou enviar.');
      }
    } catch (error) {
      $('newsletter-status').textContent = 'Não foi possível carregar o status do Resend.';
      feedback('Atualize a página e tente novamente.');
    }
  }
  window.iniciarNewsletterAdmin = initialize;

  $('newsletter-connect').addEventListener('click', async () => {
    try {
      feedback('Iniciando conexão segura com o Resend...');
      const { authorizationUrl } = await call('iniciarOAuthResendNewsletter');
      window.location.assign(authorizationUrl);
    } catch (error) {
      const code = error?.code || '';
      if (code.includes('not-found')) feedback('A função de conexão ainda não está publicada no Firebase. Publique as Cloud Functions do projeto e tente novamente.');
      else if (code.includes('unauthenticated') || code.includes('permission-denied')) feedback('Sua sessão administrativa expirou ou não tem permissão. Entre novamente no painel.');
      else feedback(`Não foi possível iniciar a conexão com o Resend${code ? ` (${code})` : ''}. Verifique o log das Cloud Functions.`);
      console.error('Falha ao iniciar OAuth do Resend:', code || 'erro sem código', error?.message || '');
    }
  });
  $('newsletter-disconnect').addEventListener('click', async () => {
    try { await call('desconectarResendNewsletter'); $('newsletter-status').textContent = 'Resend desconectado.'; $('newsletter-workspace').hidden = true; $('newsletter-connect').hidden = false; $('newsletter-disconnect').hidden = true; feedback('Conexão removida. Rascunhos e inscrições foram preservados.'); }
    catch { feedback('Não foi possível desconectar o Resend.'); }
  });
  $('newsletter-preview').addEventListener('click', updatePreview);
  $('newsletter-mode-visual').addEventListener('click', () => setEditorMode('visual'));
  $('newsletter-mode-html').addEventListener('click', () => setEditorMode('html'));
  $('newsletter-visual-editor').addEventListener('input', () => { syncEditorHtml(); updatePreview(); });
  $('newsletter-visual-editor').addEventListener('click', (event) => {
    const image = event.target.closest('img');
    if (image) selectNewsletterImage(image);
  });
  $('newsletter-visual-editor').addEventListener('input', () => {
    if (selectedNewsletterImage && !$('newsletter-visual-editor').contains(selectedNewsletterImage)) {
      selectedNewsletterImage = null;
      $('newsletter-image-width').disabled = true;
      $('newsletter-image-width-value').textContent = 'Selecione uma imagem';
    }
  });
  $('newsletter-image-width').addEventListener('input', (event) => updateSelectedImageWidth(event.currentTarget.value));
  $('newsletter-image-search').addEventListener('input', (event) => renderImagePicker(event.currentTarget.value));
  $('newsletter-insert-image').addEventListener('click', () => {
    const picker = $('newsletter-image-picker'); picker.hidden = !picker.hidden;
    if (!picker.hidden) { renderImagePicker($('newsletter-image-search').value); $('newsletter-image-search').focus(); }
  });
  $('newsletter-insert-link').addEventListener('click', () => {
    const url = window.prompt('Endereço do link (https://...)');
    if (!url || !/^https:\/\//i.test(url)) return;
    $('newsletter-visual-editor').focus(); document.execCommand('createLink', false, url); syncEditorHtml(); updatePreview();
  });
  document.querySelector('.newsletter-toolbar').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-cmd]'); if (!button) return;
    $('newsletter-visual-editor').focus(); document.execCommand(button.dataset.cmd, false, button.dataset.param || null); syncEditorHtml(); updatePreview();
  });
  $('newsletter-audience').addEventListener('change', async () => {
    if (activeAudience && $('newsletter-audience').value === activeAudience) await loadAudienceCount();
    else $('newsletter-recipient-count').textContent = 'Confirme a audiência para consultar os inscritos ativos.';
  });
  $('newsletter-html').addEventListener('input', () => { $('newsletter-preview-frame').srcdoc = $('newsletter-html').value; });
  $('newsletter-create-audience').addEventListener('click', async () => {
    const name = window.prompt('Nome da audiência'); if (!name) return;
    try { const result = await call('criarAudienciaResendNewsletter', { name }); await loadAudiences(); $('newsletter-audience').value = result.id; $('newsletter-recipient-count').textContent = 'Confirme esta audiência para consultar os inscritos ativos.'; feedback('Audiência criada. Confirme em “Usar audiência” para selecioná-la.'); }
    catch { feedback('Não foi possível criar a audiência.'); }
  });
  $('newsletter-save-audience').addEventListener('click', async () => {
    try { const result = await call('configurarAudienciaNewsletter', { audienceId: $('newsletter-audience').value }); activeAudience = result.audienceId; await loadAudienceCount(); feedback('Audiência configurada.'); }
    catch { feedback('Selecione uma audiência válida.'); }
  });
  $('newsletter-sync').addEventListener('click', async () => {
    if (!activeAudience || $('newsletter-audience').value !== activeAudience) { feedback('Confirme a audiência selecionada antes de sincronizar.'); return; }
    try { const result = await call('sincronizarInscritosNewsletter'); feedback(`Sincronização: ${result.synced} enviados, ${result.skipped} ignorados, ${result.failed} falhas.`); }
    catch { feedback('Não foi possível sincronizar os inscritos.'); }
  });
  $('newsletter-save').addEventListener('click', async () => {
    try {
      syncEditorHtml();
      const result = await call('salvarRascunhoNewsletter', { campaignId: selectedCampaignId || undefined, subject: $('newsletter-subject').value, from: $('newsletter-sender').value, html: $('newsletter-html').value });
      selectedCampaignId = result.campaignId; feedback('Rascunho salvo. Nenhum e-mail foi enviado.'); await loadCampaigns();
    } catch (error) {
      const message = error?.message || error?.details?.message || '';
      const code = error?.code || '';
      feedback(message && (code.includes('invalid-argument') || code.includes('failed-precondition') || code.includes('unavailable') || /assunto|remetente|domínio|HTML|cancelamento|inscrição/i.test(message))
        ? message
        : 'Não foi possível salvar. Confira o assunto, o remetente e o link de cancelamento da inscrição.');
    }
  });
  $('newsletter-send').addEventListener('click', async (event) => {
    if (!activeAudience || $('newsletter-audience').value !== activeAudience) { feedback('Confirme a audiência selecionada antes de enviar.'); return; }
    if (!selectedCampaignId) { feedback('Salve o rascunho antes de enviar.'); return; }
    const campaign = campaigns.find((item) => item.id === selectedCampaignId);
    if (campaign && campaign.status !== 'draft') { feedback('Este rascunho já foi encerrado. Salve um novo rascunho antes de enviar.'); return; }
    const audience = $('newsletter-audience').selectedOptions[0]?.textContent || 'audiência selecionada';
    const count = $('newsletter-recipient-count').textContent;
    if (!window.confirm(`Enviar “${campaign?.subject || $('newsletter-subject').value}” para ${audience} (${count})?`)) return;
    const button = event.currentTarget; button.disabled = true;
    try { const result = await call('enviarCampanhaNewsletter', { campaignId: selectedCampaignId, audienceId: activeAudience }); feedback(`Campanha ${result.status === 'queued' ? 'enfileirada' : 'enviada'} para ${result.recipientCount} inscritos ativos.`); selectedCampaignId = null; await loadCampaigns(); }
    catch (error) {
      const message = error?.message || error?.details?.message || '';
      const code = error?.code || '';
      feedback(message && (code.includes('failed-precondition') || code.includes('unavailable'))
        ? message
        : 'O envio não foi confirmado. Verifique o histórico antes de tentar novamente.');
      await loadCampaigns();
      if (campaigns.find((item) => item.id === selectedCampaignId)?.status === 'failed') selectedCampaignId = null;
    }
    finally { button.disabled = false; }
  });
})();
