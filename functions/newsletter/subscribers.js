function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function createNewsletterSubscribers({ repository, api }) {
  async function syncNewsletterSubscriber({ uid, explicitOptIn = false }) {
    const profile = await repository.getProfile(uid);
    if (!profile || profile.newsletter !== true) return { skipped: true, reason: 'not_subscribed' };
    const email = normalizeEmail(profile.email);
    if (!email) return { skipped: true, reason: 'invalid_email' };
    const config = await repository.getConfig();
    if (!config?.audienceId) throw new Error('Newsletter audience is not configured.');
    const existing = await api.findContact(config.audienceId, email);
    const input = { audienceId: config.audienceId, email, firstName: profile.nome || undefined };
    if (existing) {
      if (existing.unsubscribed && !explicitOptIn) {
        await api.updateContact(email, input);
      } else {
        await api.updateContact(email, { ...input, ...(explicitOptIn ? { unsubscribed: false } : {}) });
      }
      if (api.contactInSegment && !await api.contactInSegment(email, config.audienceId)) {
        await api.addContactToSegment(email, config.audienceId);
      }
    } else {
      await api.createContact({ ...input, ...(explicitOptIn ? { unsubscribed: false } : {}) });
    }
    return { synced: true };
  }

  async function syncNewsletterSubscribers() {
    const profiles = await repository.getProfiles();
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    for (const profile of profiles) {
      if (profile.newsletter !== true || !normalizeEmail(profile.email)) { skipped += 1; continue; }
      try {
        const result = await syncNewsletterSubscriber({ uid: profile.uid });
        if (result.synced) synced += 1; else skipped += 1;
      } catch { failed += 1; }
    }
    return { total: profiles.length, synced, skipped, failed };
  }
  return { syncNewsletterSubscriber, syncNewsletterSubscribers };
}

module.exports = { createNewsletterSubscribers, normalizeEmail };
