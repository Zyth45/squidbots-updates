'use strict';
// Banner pictures of the Modules page: drawn inline (no image file), one per module.
const MODULE_ART = {
  // The octopus of the launcher logo under the sea, each arm holding a bot.
  squidbots: (() => {
    const bot = (x, y) => `<g transform="translate(${x} ${y})"><rect x="-13" y="-11" width="26" height="21" rx="7" fill="#0d3640" stroke="#5fd3c8" stroke-width="2"/><circle cx="-5" cy="-1" r="2.8" fill="#9ff5ea"/><circle cx="5" cy="-1" r="2.8" fill="#9ff5ea"/><line x1="0" y1="-11" x2="0" y2="-16" stroke="#5fd3c8" stroke-width="2"/><circle cx="0" cy="-18" r="2" fill="#f2c46b"/></g>`;
    const arm = d => `<path d="${d}" fill="none" stroke="#3a1d06" stroke-width="11" stroke-linecap="round"/><path d="${d}" fill="none" stroke="url(#ma-sqarm)" stroke-width="7" stroke-linecap="round"/>`;
    const arms = ['M166 62 C150 78 128 84 104 82', 'M162 54 C140 60 112 48 82 58 C66 64 60 74 62 80', 'M172 66 C168 82 158 94 144 96'];
    const suckers = [[140, 80], [124, 82], [108, 80], [130, 53], [110, 51], [92, 54], [156, 90]];
    const side = `${arms.map(arm).join('')}${suckers.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#fff0c8" opacity=".75"/>`).join('')}`;
    const rays = Array.from({ length: 11 }, (_, i) => { const a = Math.PI * (1.1 + 0.8 * i / 10); const l = i % 2 ? 40 : 52; const p = (r, d) => `${(180 + Math.cos(a + d) * r).toFixed(1)} ${(40 + Math.sin(a + d) * r).toFixed(1)}`; return `M${p(26, -.12)} L${p(l, 0)} L${p(26, .12)} Z`; }).join(' ');
    return `<defs><linearGradient id="ma-sq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d6a7a"/><stop offset="1" stop-color="#04121a"/></linearGradient>
      <linearGradient id="ma-sqarm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe09a"/><stop offset=".6" stop-color="#d69a3e"/><stop offset="1" stop-color="#9a5a18"/></linearGradient>
      <linearGradient id="ma-sqgold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0c2"/><stop offset=".35" stop-color="#f2c264"/><stop offset=".7" stop-color="#b87a26"/><stop offset="1" stop-color="#7a4a12"/></linearGradient>
      <radialGradient id="ma-sqhead" cx=".38" cy=".28" r=".85"><stop offset="0" stop-color="#fff0c4"/><stop offset=".4" stop-color="#e9ae4e"/><stop offset=".8" stop-color="#a86522"/><stop offset="1" stop-color="#6e3d10"/></radialGradient>
      <radialGradient id="ma-sqiris" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff3a8"/><stop offset=".6" stop-color="#ffb02e"/><stop offset="1" stop-color="#c2410c"/></radialGradient></defs>
      <rect width="360" height="110" fill="url(#ma-sq)"/>
      ${[40, 110, 210, 280].map((x, i) => `<path d="M${x} 0 L${x + 28} 0 L${x + 64} 110 L${x + 30} 110 Z" fill="#bff6ff" opacity="${.04 + (i % 2) * .03}"/>`).join('')}
      ${[[34, 88, 3], [332, 18, 2], [312, 96, 2.5], [60, 20, 2], [250, 12, 1.6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#bff6ff" opacity=".5"/>`).join('')}
      <path d="${rays}" fill="url(#ma-sqgold)" opacity=".55"/>
      ${side}<g transform="translate(360 0) scale(-1 1)">${side}</g>
      ${bot(98, 82)}${bot(56, 82)}${bot(262, 82)}${bot(304, 82)}
      <g transform="translate(180 4) scale(.8) translate(-180 0)">
        <path d="M180 0 C149 1 133 27 136 53 C138 68 151 78 166 80 L194 80 C209 78 222 68 224 53 C227 27 211 1 180 0 Z" fill="url(#ma-sqhead)" stroke="#5a3208" stroke-width="2.2"/>
        <path d="M158 16 C166 9 179 7 188 10" fill="none" stroke="#fff6da" stroke-width="3" stroke-linecap="round" opacity=".7"/>
        <g fill="#9a5a1c" opacity=".55"><ellipse cx="170" cy="24" rx="3.2" ry="2.4"/><ellipse cx="193" cy="20" rx="2.6" ry="2"/><ellipse cx="203" cy="33" rx="2.2" ry="1.8"/><ellipse cx="157" cy="36" rx="2.4" ry="1.9"/><ellipse cx="184" cy="31" rx="1.8" ry="1.4"/></g>
        <path d="M153 43 Q164 37 174 45 M207 43 Q196 37 186 45" fill="none" stroke="#4a2606" stroke-width="3" stroke-linecap="round"/>
        ${[165, 195].map(x => `<ellipse cx="${x}" cy="54" rx="9" ry="8.5" fill="#1b0c04" stroke="#5a3208" stroke-width="1.2"/><circle cx="${x}" cy="54" r="6.5" fill="url(#ma-sqiris)"/><ellipse cx="${x}" cy="54" rx="5.2" ry="1.7" fill="#170802"/><circle cx="${x - 2.5}" cy="51.5" r="1.4" fill="#fffbe8"/>`).join('')}
      </g>`;
  })(),
  ahbot: `<defs><linearGradient id="ma-ah" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a2410"/><stop offset="1" stop-color="#120a04"/></linearGradient><radialGradient id="ma-ahg" cx="50%" cy="55%" r="45%"><stop offset="0" stop-color="#f2c46b" stop-opacity=".35"/><stop offset="1" stop-color="#f2c46b" stop-opacity="0"/></radialGradient></defs>
    <rect width="360" height="110" fill="url(#ma-ah)"/><rect width="360" height="110" fill="url(#ma-ahg)"/>
    ${[[70, 92, 5], [96, 92, 3], [268, 92, 4], [292, 92, 6]].map(([x, y, n]) => Array.from({ length: n }, (_, i) => `<ellipse cx="${x}" cy="${y - i * 6}" rx="13" ry="4.5" fill="#d9a441" stroke="#7a5418" stroke-width="1.5"/>`).join('')).join('')}
    <rect x="148" y="86" width="64" height="12" rx="3" fill="#6b3f1a" stroke="#2c1608" stroke-width="2"/>
    <g transform="rotate(-32 180 60)"><rect x="176" y="40" width="9" height="62" rx="4" fill="#8a5a2b" stroke="#2c1608" stroke-width="2"/><rect x="152" y="26" width="58" height="24" rx="6" fill="#a8743a" stroke="#2c1608" stroke-width="2"/><rect x="160" y="26" width="6" height="24" fill="#f2c46b"/><rect x="196" y="26" width="6" height="24" fill="#f2c46b"/></g>
    ${[[214, 74], [226, 60], [140, 70]].map(([x, y]) => `<path d="M${x} ${y - 6} l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2z" fill="#ffe2a0"/>`).join('')}`,
  manastorm: `<defs><radialGradient id="ma-ms" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#7d3cc4"/><stop offset=".45" stop-color="#2a1250"/><stop offset="1" stop-color="#090414"/></radialGradient></defs>
    <rect width="360" height="110" fill="url(#ma-ms)"/>
    ${[46, 36, 26, 16].map((r, i) => `<path d="M${180 - r * 1.6} 55 A${r * 1.6} ${r} 0 1 1 ${180 + r * 1.2} ${55 + r * .7}" fill="none" stroke="${['#b98cff', '#d9b8ff', '#8fd0ff', '#fff'][i]}" stroke-width="${2 + i * .6}" stroke-linecap="round" opacity="${.5 + i * .15}" transform="rotate(${i * 40} 180 55)"/>`).join('')}
    <circle cx="180" cy="55" r="7" fill="#fff" opacity=".9"/>
    ${[[70, 30], [300, 28], [92, 86], [282, 84], [40, 60], [326, 58]].map(([x, y]) => `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="none" stroke="#c9a5ff" stroke-width="1.5" transform="rotate(45 ${x} ${y})" opacity=".7"/>`).join('')}`,
  rotation: `<defs><linearGradient id="ma-rt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b2a2c"/><stop offset="1" stop-color="#06161b"/></linearGradient></defs>
    <rect width="360" height="110" fill="url(#ma-rt)"/>
    <path d="M110 55 A70 34 0 1 1 250 55" fill="none" stroke="#5fd3c8" stroke-width="2.5" stroke-dasharray="6 6" opacity=".6"/><path d="M250 55 l-8 -6 m8 6 l2 -10" stroke="#5fd3c8" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    ${[[120, '#c0563b', .55], [180, '#f2c46b', 1], [240, '#4f8fd6', .55]].map(([x, c, o]) => `<g opacity="${o}"><rect x="${x - 20}" y="35" width="40" height="40" rx="7" fill="#102c33" stroke="${c}" stroke-width="${o === 1 ? 3 : 2}"/><path d="M${x - 9} 63 L${x} 45 L${x + 9} 63 Z" fill="${c}"/></g>`).join('')}
    <circle cx="180" cy="55" r="30" fill="none" stroke="#f2c46b" stroke-width="1.5" opacity=".35"/>`,
  // A dwarf among the chat lines of the realm, the way players talk.
  squidchat: (() => {
    const rivets = (pts, c = '#f2d7a0') => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${c}" stroke="#3a2a14" stroke-width=".6"/>`).join('');
    const pauldrons = `<path d="M-52 30 C-54 16 -40 8 -26 12 C-22 22 -30 32 -44 36 Z M52 30 C54 16 40 8 26 12 C22 22 30 32 44 36 Z" fill="url(#ma-scsteel)" stroke="#2c3338" stroke-width="1.8"/>`;
    const dwarf = `<g transform="translate(56 66)">
      <path d="M-48 46 C-46 22 -28 12 0 12 C28 12 46 22 48 46 Z" fill="url(#ma-sctabard)" stroke="#0c1828" stroke-width="2"/>
      ${pauldrons}
      ${rivets([[-44, 26], [-34, 18], [-40, 32], [44, 26], [34, 18], [40, 32]])}
      <path d="M-22 -12 C-22 -40 22 -40 22 -12 Z" fill="url(#ma-scsteel)" stroke="#2c3338" stroke-width="2"/>
      <path d="M-12 -34 C-6 -38 4 -38 10 -35" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>
      <path d="M0 -40 L0 -14" stroke="#5c666d" stroke-width="2"/>
      <path d="M-20 -24 C-34 -26 -42 -38 -40 -52 C-36 -42 -30 -36 -20 -32 Z M20 -24 C34 -26 42 -38 40 -52 C36 -42 30 -36 20 -32 Z" fill="url(#ma-scbone)" stroke="#5a4a2e" stroke-width="1.5"/>
      <path d="M-30 -30 l3 -4 M-35 -37 l4 -3 M30 -30 l-3 -4 M35 -37 l-4 -3" stroke="#8a7a58" stroke-width="1.2"/>
      <rect x="-25" y="-16" width="50" height="7" rx="2.5" fill="url(#ma-scbronze)" stroke="#3a2410" stroke-width="1.2"/>
      ${rivets([[-18, -12.5], [-6, -12.5], [6, -12.5], [18, -12.5]], '#ffe7b0')}
      <ellipse cx="0" cy="0" rx="20" ry="13" fill="url(#ma-scdw)" stroke="#7a4a2a" stroke-width="1.6"/>
      <path d="M-3 -10 L3 -10 L2 2 L-2 2 Z" fill="url(#ma-scsteel)" stroke="#2c3338" stroke-width="1"/>
      <ellipse cx="-12" cy="5" rx="4" ry="2.5" fill="#e88a7a" opacity=".55"/><ellipse cx="12" cy="5" rx="4" ry="2.5" fill="#e88a7a" opacity=".55"/>
      <path d="M-17 -4 C-12 -9 -6 -7 -3 -3 M17 -4 C12 -9 6 -7 3 -3" fill="none" stroke="#c4561c" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="-8" cy="1" rx="2.6" ry="2.2" fill="#fff"/><ellipse cx="8" cy="1" rx="2.6" ry="2.2" fill="#fff"/><circle cx="-7.5" cy="1.2" r="1.4" fill="#1a0c04"/><circle cx="8.5" cy="1.2" r="1.4" fill="#1a0c04"/>
      <path d="M-4 2 C-6 10 -3 13 0 13 C3 13 6 10 4 2 Z" fill="#e3936f" stroke="#9a5a3a" stroke-width="1"/><circle cx="-1.5" cy="5" r="1.2" fill="#fff" opacity=".6"/>
      <path d="M-24 6 C-30 30 -14 50 0 52 C14 50 30 30 24 6 C16 14 -16 14 -24 6 Z" fill="url(#ma-scbeard)" stroke="#6e2a0a" stroke-width="1.6"/>
      <path d="M-14 20 C-12 30 -12 38 -8 46 M-5 22 C-4 32 -2 40 0 50 M5 22 C4 32 4 40 6 46 M14 20 C12 30 12 36 10 42" fill="none" stroke="#a8451a" stroke-width="1.4"/>
      <path d="M-18 24 C-20 34 -18 42 -14 50 M18 24 C20 34 18 42 14 50" fill="none" stroke="#e07030" stroke-width="5" stroke-linecap="round"/>
      <rect x="-19" y="40" width="7" height="4" rx="1.5" fill="url(#ma-scbronze)"/><rect x="12" y="40" width="7" height="4" rx="1.5" fill="url(#ma-scbronze)"/>
      <path d="M-2 13 C-10 12 -16 16 -20 12 C-16 20 -6 18 -1 16 Z M2 13 C10 12 16 16 20 12 C16 20 6 18 1 16 Z" fill="#e4752f" stroke="#7a2f0c" stroke-width="1"/>
      <ellipse cx="0" cy="20" rx="6" ry="3.4" fill="#3a1206"/><ellipse cx="0" cy="21.5" rx="3" ry="1.4" fill="#c4434a"/>
    </g>`;
    const bubble = (x, y, w, lines, [fill, line, ink], tail, size = 11) => {
      const h = lines.length * 14 + 10;
      const tails = { left: `M12 ${h} l-8 9 18 -9z`, right: `M${w - 14} ${h} l8 9 -18 -9z`, none: '' };
      return `<g transform="translate(${x} ${y})"><rect width="${w}" height="${h}" rx="11" fill="${fill}" stroke="${line}" stroke-width="2"/>${tails[tail] ? `<path d="${tails[tail]}" fill="${fill}" stroke="${line}" stroke-width="2" stroke-linejoin="round"/>` : ''}${lines.map((l, i) => `<text x="${w / 2}" y="${18 + i * 14 - (lines.length > 1 ? 3 : 0)}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${ink}">${l}</text>`).join('')}</g>`;
    };
    const blue = ['#1f3a66', '#8fb4ff', '#e6ecff'], red = ['#5a1a1a', '#ff8a7a', '#ffe1dc'], green = ['#16402a', '#7dd36b', '#e3ffe0'], purple = ['#3a1f5a', '#c9a5ff', '#f1e6ff'];
    return `<defs><linearGradient id="ma-sc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2350"/><stop offset="1" stop-color="#080b1c"/></linearGradient>
      <radialGradient id="ma-scorc" cx=".4" cy=".3" r=".85"><stop offset="0" stop-color="#a8de6e"/><stop offset=".5" stop-color="#6aa23f"/><stop offset="1" stop-color="#2f5414"/></radialGradient>
      <radialGradient id="ma-scdw" cx=".4" cy=".3" r=".85"><stop offset="0" stop-color="#ffe0c0"/><stop offset=".6" stop-color="#e8a878"/><stop offset="1" stop-color="#a86a42"/></radialGradient>
      <linearGradient id="ma-scsteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0f4f6"/><stop offset=".45" stop-color="#a9b4bc"/><stop offset="1" stop-color="#5c666d"/></linearGradient>
      <linearGradient id="ma-scbone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffbea"/><stop offset="1" stop-color="#c8b88a"/></linearGradient>
      <linearGradient id="ma-scbronze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2c46b"/><stop offset="1" stop-color="#8a5418"/></linearGradient>
      <linearGradient id="ma-scleather" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4f2a"/><stop offset="1" stop-color="#3a2210"/></linearGradient>
      <linearGradient id="ma-sctabard" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f78b4"/><stop offset="1" stop-color="#1e3458"/></linearGradient>
      <linearGradient id="ma-scbeard" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f08a3e"/><stop offset=".6" stop-color="#d0601f"/><stop offset="1" stop-color="#9a3e10"/></linearGradient></defs>
      <rect width="360" height="110" fill="url(#ma-sc)"/>
      ${[[150, 98, 1.6], [210, 100, 1.2], [26, 18, 1.4], [334, 14, 1.2]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#8fa8ff" opacity=".5"/>`).join('')}
      ${dwarf}
      ${bubble(102, 14, 112, ['you need this?'], blue, 'left', 12.5)}
      ${bubble(222, 12, 128, ['you know the strat?', 'really?'], purple, 'right', 10.5)}
      ${bubble(170, 62, 124, ['can i have 5 gold', 'for respec?'], red, 'right', 10.5)}`;
  })(),
};
function moduleArt(kind) {
  const art = MODULE_ART[kind];
  return art ? `<div class="module-art" aria-hidden="true"><svg viewBox="0 0 360 110" preserveAspectRatio="xMidYMid slice">${art}</svg></div>` : '';
}
