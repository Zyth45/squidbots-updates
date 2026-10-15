'use strict';
// The SquidBots emblem: a golden octopus rising behind an engraved plate, rays behind its head, tentacles
// curling out on both sides. Inline SVG so the page's Cinzel font draws the name. Original artwork.

const LOGO = (() => {
  // Arms of the left side; the right side is the same, mirrored. Each arm is drawn twice: a dark rim, then gold.
  const backArms = [
    'M160 64 C136 76 110 70 90 58 C70 46 50 52 48 66 C46 79 59 87 69 81 C77 76 74 66 66 68',
    'M164 72 C144 90 116 97 94 93 C78 90 68 99 72 109 C76 117 89 115 89 106',
  ];
  const frontArms = ['M170 110 C166 124 156 133 145 133 C135 133 131 123 139 119 C144 117 148 122 144 125'];
  const suckers = [[117, 70, 2.3], [99, 62, 2.1], [80, 54, 1.9], [62, 58, 1.6], [120, 94, 2.1], [104, 94, 1.9], [86, 96, 1.6]];
  const arms = list => list.map(d => `<path class="lg-rim" d="${d}" /><path class="lg-arm" d="${d}" />`).join('');
  const side = (list, dots) => `${arms(list)}${dots ? suckers.map(([x, y, r]) => `<circle class="lg-sucker" cx="${x}" cy="${y}" r="${r}" />`).join('') : ''}`;
  const mirrored = content => `${content}<g transform="translate(360 0) scale(-1 1)">${content}</g>`;
  // Rays behind the head: thin gold spikes on a half circle.
  const rays = Array.from({ length: 13 }, (_, i) => {
    const angle = Math.PI * (1.08 + (0.84 * i) / 12);
    const long = i % 2 ? 48 : 64;
    const at = (radius, spread) => `${(180 + Math.cos(angle + spread) * radius).toFixed(1)} ${(46 + Math.sin(angle + spread) * radius).toFixed(1)}`;
    return `M${at(30, -0.11)} L${at(long, 0)} L${at(30, 0.11)} Z`;
  }).join(' ');
  return `<svg class="logo" viewBox="0 -8 360 148" role="img" aria-label="SquidBots">
    <defs>
      <linearGradient id="lg-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff0c2" /><stop offset=".35" stop-color="#f2c264" /><stop offset=".7" stop-color="#b87a26" /><stop offset="1" stop-color="#7a4a12" />
      </linearGradient>
      <linearGradient id="lg-arm" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffe09a" /><stop offset=".6" stop-color="#d69a3e" /><stop offset="1" stop-color="#9a5a18" />
      </linearGradient>
      <linearGradient id="lg-plate" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5a2410" /><stop offset=".55" stop-color="#2c1006" /><stop offset="1" stop-color="#160702" />
      </linearGradient>
      <radialGradient id="lg-head" cx=".38" cy=".28" r=".85">
        <stop offset="0" stop-color="#fff0c4" /><stop offset=".4" stop-color="#e9ae4e" /><stop offset=".8" stop-color="#a86522" /><stop offset="1" stop-color="#6e3d10" />
      </radialGradient>
      <radialGradient id="lg-iris" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#fff3a8" /><stop offset=".6" stop-color="#ffb02e" /><stop offset="1" stop-color="#c2410c" />
      </radialGradient>
    </defs>
    <path class="lg-rays" d="${rays}" />
    <g class="lg-back">${mirrored(side(backArms, true))}</g>
    <path class="lg-plate" d="M40 78 L320 78 L346 96 L320 114 L40 114 L14 96 Z" />
    <path class="lg-plate-line" d="M46 83 L316 83 L336 96 L316 109 L46 109 L26 96 Z" />
    <path class="lg-gem" d="M14 96 L22 89 L30 96 L22 103 Z" /><path class="lg-gem" d="M346 96 L338 89 L330 96 L338 103 Z" />
    <path class="lg-head" d="M180 0 C149 1 133 27 136 53 C138 68 151 78 166 80 L194 80 C209 78 222 68 224 53 C227 27 211 1 180 0 Z" />
    <path class="lg-shine" d="M158 16 C166 9 179 7 188 10" />
    <g class="lg-spots"><ellipse cx="170" cy="24" rx="3.2" ry="2.4" /><ellipse cx="193" cy="20" rx="2.6" ry="2" /><ellipse cx="203" cy="33" rx="2.2" ry="1.8" /><ellipse cx="157" cy="36" rx="2.4" ry="1.9" /><ellipse cx="184" cy="31" rx="1.8" ry="1.4" /></g>
    <path class="lg-brow" d="M153 43 Q164 37 174 45" /><path class="lg-brow" d="M207 43 Q196 37 186 45" />
    <g class="lg-eye"><ellipse class="lg-socket" cx="165" cy="54" rx="9" ry="8.5" /><ellipse class="lg-iris" cx="165" cy="54" rx="6.5" ry="6.5" /><ellipse class="lg-pupil" cx="165" cy="54" rx="5.2" ry="1.7" /><circle class="lg-glint" cx="162.5" cy="51.5" r="1.4" /></g>
    <g class="lg-eye"><ellipse class="lg-socket" cx="195" cy="54" rx="9" ry="8.5" /><ellipse class="lg-iris" cx="195" cy="54" rx="6.5" ry="6.5" /><ellipse class="lg-pupil" cx="195" cy="54" rx="5.2" ry="1.7" /><circle class="lg-glint" cx="192.5" cy="51.5" r="1.4" /></g>
    <text class="lg-name" x="180" y="106" text-anchor="middle">SQUIDBOTS</text>
    <g class="lg-front">${mirrored(side(frontArms, false))}</g>
  </svg>`;
})();
