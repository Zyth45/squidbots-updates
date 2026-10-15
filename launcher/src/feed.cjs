'use strict';
// The news feed: one small signed JSON on the download server, read at start and every 30 minutes. It holds
// what changes without a new launcher: where to download the repack and the base client (Proton links),
// the sha256 of the known repack releases, and the news shown on the home page.
const HTTPS = /^https:\/\/[\w.-]+(?::\d+)?(\/[\w\-./?=&#%~+:@!$'()*,;]*)?$/;
const text = (value, max) => String(value ?? '').slice(0, max);
const url = value => (typeof value === 'string' && HTTPS.test(value) ? value : '');

function cleanLink(value) {
  if (!value || typeof value !== 'object' || !url(value.url)) return null;
  return { name: text(value.name, 80), release: text(value.release, 80), url: url(value.url), notes: text(value.notes, 400), size: text(value.size, 20) };
}

// The community server shown beside the news: its id (for the live widget) and an invite link.
function cleanDiscord(value) {
  if (!value || typeof value !== 'object') return null;
  const id = /^\d{17,20}$/.test(String(value.id || '')) ? String(value.id) : '';
  const invite = url(value.invite);
  return id || invite ? { id, invite, name: text(value.name, 80), text: text(value.text, 300) } : null;
}

function cleanFeed(data) {
  if (!data || typeof data !== 'object') throw new Error('The news feed is malformed.');
  return {
    repack: cleanLink(data.repack),
    // The game client patch for the added races (Multirace module).
    clientRaces: cleanLink(data.clientRaces),
    client: cleanLink(data.client),
    repacks: (Array.isArray(data.repacks) ? data.repacks : []).filter(item => /^[0-9a-f]{64}$/i.test(item?.sha256 || '')).slice(0, 50)
      .map(item => ({ sha256: item.sha256.toLowerCase(), name: text(item.name, 80), release: text(item.release, 80), notes: text(item.notes, 300) })),
    news: (Array.isArray(data.news) ? data.news : []).slice(0, 12)
      .map(item => ({ date: text(item?.date, 20), title: text(item?.title, 120), summary: text(item?.summary, 300), text: text(item?.text, 60000), url: url(item?.url) }))
      .filter(item => item.title),
    discord: cleanDiscord(data.discord),
    publishedAt: text(data.publishedAt, 40),
  };
}

module.exports = { cleanFeed };
