'use strict';
// Disegno condiviso da pannello e anelli sul bordo.
(function () {
  const ICONS = {
    mouse: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 3v6"/>',
    headset: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    controller: '<path d="M7 8h10a4 4 0 0 1 4 4.5l-.6 3.6a2.5 2.5 0 0 1-4.3 1.2L14.5 15h-5l-1.6 2.3a2.5 2.5 0 0 1-4.3-1.2L3 12.5A4 4 0 0 1 7 8z"/><path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>',
    watch: '<rect x="6.5" y="6" width="11" height="12" rx="3"/><path d="M9 6l.6-3h4.8l.6 3M9 18l.6 3h4.8l.6-3"/>',
    bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
  };
  const COLORS = { high: 'var(--ok)', mid: 'var(--warn)', low: 'var(--bad)', none: 'var(--none)' };
  const level = (p, low) => (p == null ? 'none' : p <= low ? 'low' : p <= 40 ? 'mid' : 'high');

  function icon(kind, size = 18) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind] || ICONS.bluetooth}</svg>`;
  }

  // Anello: la parte colorata è la carica. Senza dato l'anello resta vuoto e tratteggiato.
  function ring(e, low, size = 46) {
    const r = size / 2 - 4, c = 2 * Math.PI * r;
    const p = e.percent;
    const col = COLORS[level(p, low)];
    const dash = p == null ? '' : `stroke-dasharray="${(c * p) / 100} ${c}"`;
    const bolt = e.charging ? `<path class="bolt" d="M${size - 13} ${size - 17}l-4 6h4l-2 5 5-7h-4l2-4z"/>` : '';
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="track" ${p == null ? 'stroke-dasharray="3 4"' : ''}/>
      ${p == null ? '' : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fill" stroke="${col}" ${dash} transform="rotate(-90 ${size / 2} ${size / 2})"/>`}
      <svg class="ico" x="${size / 2 - 9}" y="${size / 2 - 9}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[e.kind] || ICONS.bluetooth}</svg>
      ${bolt}
    </svg>`;
  }

  function label(e) {
    if (e.status === 'wired' && e.percent == null) return 'Via cavo';
    return e.percent == null ? 'Nessun dato' : `${e.percent}%`;
  }
  function ago(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'adesso';
    if (m < 60) return `${m} min fa`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} h fa` : `${Math.round(h / 24)} g fa`;
  }
  function detail(e, now) {
    const bits = [];
    if (e.charging) bits.push('In carica');
    if (e.status === 'standby') bits.push('In standby');
    if (e.status === 'off') bits.push('Spente');
    if (e.stale && e.at) bits.push(`letto ${ago(now - e.at)}`);
    if (e.old) bits.push(`ultima lettura ${e.old.percent}%, ${ago(now - e.old.at)}`);
    if (!bits.length) bits.push(e.kind === 'phone' ? 'Telefono' : e.id.startsWith('bt:') ? 'Bluetooth' : 'Collegato');
    return bits.join(' · ');
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  window.BatUI = { icon, ring, label, detail, level, esc, COLORS };
})();
