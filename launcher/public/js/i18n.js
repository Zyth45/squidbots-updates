'use strict';
// t(key, englishText, vars) - English lives in the code, other languages in locales/<lang>.json.
// Adding a language = adding one JSON file with the keys you want to translate.
const I18N = { lang: 'en', dict: {} };

async function loadLocale(lang) {
  I18N.lang = lang;
  I18N.dict = {};
  document.documentElement.lang = lang;
  if (lang === 'en') return;
  try {
    const response = await fetch(`locales/${lang}.json`);
    if (response.ok) I18N.dict = await response.json();
  } catch {}
  document.documentElement.lang = lang;
}

function t(key, fallback, vars) {
  let text = Object.hasOwn(I18N.dict, key) ? I18N.dict[key] : fallback;
  if (vars) text = text.replace(/\{(\w+)\}/g, (_m, name) => (vars[name] ?? `{${name}}`));
  return text;
}

// Errors come in English from the realm service and the launcher engine; a locale translates
// them with "err:<English message>" keys, anything unknown is shown as is.
function translateError(message) {
  const key = `err:${message}`;
  return Object.hasOwn(I18N.dict, key) ? I18N.dict[key] : message;
}

function formatNumber(value) { return Number.isFinite(Number(value)) ? new Intl.NumberFormat(I18N.lang).format(Number(value)) : '—'; }
function formatBytes(value) {
  if (!Number.isFinite(value)) return '—';
  // French says octets (o, Ko, Mo…), Russian байты (Б, КБ, МБ…).
  const units = { fr: ['o', 'Ko', 'Mo', 'Go', 'To'], ru: ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'] }[I18N.lang] || ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${new Intl.NumberFormat(I18N.lang, { maximumFractionDigits: i >= 2 ? 1 : 0, minimumFractionDigits: i >= 2 ? 1 : 0 }).format(value)} ${units[i]}`;
}
function formatDate(value, withTime = false) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(I18N.lang, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return t('time.days', '{d} d {h} h', { d: Math.floor(h / 24), h: h % 24 });
  if (h) return t('time.hours', '{h} h {m} min', { h, m });
  if (m) return t('time.minutes', '{m} min', { m });
  return t('time.seconds', '{s} s', { s: Math.max(1, Math.round(seconds)) });
}
// Short form for small tiles: "1 h 17", "3 d 4 h", "42 min".
function formatCompactDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return t('time.compactDays', '{d} d {h} h', { d: Math.floor(h / 24), h: h % 24 });
  if (h) return t('time.compactHours', '{h} h {m}', { h, m: String(m).padStart(2, '0') });
  return t('time.minutes', '{m} min', { m: Math.max(1, m) });
}
function timeAgo(value) {
  const seconds = (Date.now() - new Date(value).getTime()) / 1000;
  return Number.isFinite(seconds) ? formatDuration(seconds) : '—';
}
