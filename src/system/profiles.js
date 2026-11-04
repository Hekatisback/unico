'use strict';
// Profili: un clic cambia insieme energia, DPI, EQ, luci e app in background.
// null = "non cambiare".
const DEFAULT_PROFILES = {
  gioco: { name: 'Gioco', power: 'best', dpi: null, eqPreset: 'FPS (passi)', kbMode: null, kbBrightness: 5, headsetLight: null, closeApps: [], overlay: true },
  lavoro: { name: 'Lavoro', power: 'balanced', dpi: null, eqPreset: 'Voce', kbMode: null, kbBrightness: 3, headsetLight: null, closeApps: [], overlay: false },
  notte: { name: 'Notte', power: 'efficiency', dpi: null, eqPreset: 'Piatto', kbMode: 0, kbBrightness: null, headsetLight: 'off', closeApps: [], overlay: false },
};
const DEFAULT_AUTO = { enabled: true, map: {}, games: ['League of Legends', 'VALORANT-Win64-Shipping', 'RobloxPlayerBeta', 'cs2', 'FortniteClient-Win64-Shipping', 'javaw'] };

// Applica un profilo: ogni passo è indipendente, gli errori vengono raccolti senza fermare gli altri.
async function applyProfile(p, deps) {
  const errors = [];
  const step = async (label, fn) => {
    try {
      const r = await fn();
      if (r && r.ok === false) errors.push(`${label}: ${r.error || 'non riuscito'}`);
    } catch (e) { errors.push(`${label}: ${e.message}`); }
  };
  if (p.power) await step('energia', () => deps.power(p.power));
  if (p.dpi) await step('mouse', () => deps.mouseDpi(p.dpi));
  if (p.eqPreset) await step('equalizzatore', () => deps.eq(p.eqPreset));
  if (p.kbMode != null || p.kbBrightness != null) await step('tastiera', () => deps.keyboard({ mode: p.kbMode, brightness: p.kbBrightness }));
  if (p.headsetLight) await step('cuffie', () => deps.headset(p.headsetLight));
  if (p.closeApps && p.closeApps.length) await step('app', () => deps.closeApps(p.closeApps));
  if (p.overlay != null) await step('overlay', () => deps.overlay(!!p.overlay));
  return { ok: errors.length === 0, errors };
}

// Riconosce un gioco aperto tra i nomi dei processi (senza .exe, senza distinzione maiuscole).
function detectGame(procNames, games) {
  const set = new Set(procNames.map((n) => String(n).toLowerCase().replace(/\.exe$/, '')));
  return games.find((g) => set.has(String(g).toLowerCase().replace(/\.exe$/, ''))) || null;
}

module.exports = { DEFAULT_PROFILES, DEFAULT_AUTO, applyProfile, detectGame };
