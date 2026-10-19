'use strict';
// Line icons drawn for this launcher (24x24, stroke = currentColor).
const ICONS = {
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  news: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  store: '<path d="M5 8h14l-1 12H6Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M9 20h6M10 17h4"/>',
  addons: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M16.5 13v7M13 16.5h7"/>',
  bug: '<rect x="8" y="8" width="8" height="12" rx="4"/><path d="M10 8V6a2 2 0 0 1 4 0v2M12 11v9M4 10l4 2M20 10l-4 2M3 15h5M16 15h5M5 20l3-2M19 20l-3-2"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5M3 12v3M21 12v3"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  book: '<path d="M12 6c-2-1.5-5-2-8-1v14c3-1 6-.5 8 1 2-1.5 5-2 8-1V5c-3-1-6-.5-8 1Z"/><path d="M12 6v14"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.2 3.5 5 3.5 8s-1 5.8-3.5 8c-2.5-2.2-3.5-5-3.5-8s1-5.8 3.5-8Z"/>',
  map: '<path d="m4 6 5-2 6 2 5-2v14l-5 2-6-2-5 2Z"/><path d="M9 4v14M15 6v14"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/>',
  swords: '<path d="m4 4 9 9M4 4h4l9 9M4 4v4l9 9M14 17l3 3M17 14l3 3M15 19l4-4"/>',
  star: '<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5L12 16.6 7 19.2l1-5.5-4-3.9L9.6 9Z"/>',
  play: '<path d="M8 5v14l11-7Z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 19h14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-5l-2 2M4 13a8 8 0 0 0 14 5l2-2"/><path d="M4 4v4h4M20 20v-4h-4"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  folder: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.2 7.5l1.7 1M18.1 15.5l1.7 1M4.2 16.5l1.7-1M18.1 8.5l1.7-1M3 12h2M19 12h2M6.3 5.6l1.4 1.5M16.3 16.9l1.4 1.5M6.3 18.4l1.4-1.5M16.3 7.1l1.4-1.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5H5V6h5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m7 10 3 2.5L7 15M12.5 15H17"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  warning: '<path d="M12 4 3 20h18Z"/><path d="M12 10v4M12 17h.01"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.7 2.5 1.7c0 2.4-5 1.4-5 4 0 1 1 1.8 2.5 1.8s2.5-.6 2.5-1.6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-1.5-3-5-4-5-1.5S10 9 12 9Zm0 0c1.5-3 5-4 5-1.5S14 9 12 9Z"/>',
  mail: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m4 8 8 6 8-6"/>',
  discord: '<path d="M8 7c-2 .5-3 1-3 1-1.5 3-2 6-2 9 1.5 1.5 3.5 2 4.5 2l1-2M16 7c2 .5 3 1 3 1 1.5 3 2 6 2 9-1.5 1.5-3.5 2-4.5 2l-1-2M7 16c3 1.5 7 1.5 10 0M9 7.5c2-.5 4-.5 6 0"/><circle cx="9.5" cy="12.5" r="1.2"/><circle cx="14.5" cy="12.5" r="1.2"/>',
  logout: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
  layers: '<path d="m12 4 8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
  palette: '<path d="M12 4a8 8 0 1 0 0 16c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2.5-1.5H18a2 2 0 0 0 2-2 8 8 0 0 0-8-8Z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="15" cy="8" r="1"/>',
  minimize: '<path d="M6 12h12"/>',
  maximize: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/>',
  cart: '<path d="M4 5h2l2 10h10l2-7H7.5"/><circle cx="10" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
};

ICONS.settings = (() => {
  const points = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    for (const [da, r] of [[-0.3, 7.2], [-0.2, 9.6], [0.2, 9.6], [0.3, 7.2], [0.485, 7.2]]) points.push([12 + r * Math.cos(a + da), 12 + r * Math.sin(a + da)]);
  }
  return `<path d="M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z"/><circle cx="12" cy="12" r="3.2"/>`;
})();

ICONS.chevron = ICONS.chevron || '<path d="m7 10 5 5 5-5"/>';
ICONS.next = ICONS.next || '<path d="m10 7 5 5-5 5"/>';
ICONS.home = ICONS.home || '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>';
ICONS.globe = ICONS.globe || '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.8 5.4 3.8 8.5S14.5 17.9 12 20.5M12 3.5C9.5 6.1 8.2 8.9 8.2 12s1.3 5.9 3.8 8.5"/>';
ICONS.chart = ICONS.chart || '<path d="M4 20V4M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/>';

function icon(name, extra = '') {
  return `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
}

// The SquidBots mark: the squid on a gold tile, coloured by the theme (see .crest in base.css).
const CREST = '<span class="crest" aria-hidden="true"><span>🦑</span></span>';
