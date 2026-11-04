'use strict';
// Equalizzatore per le HS80 tramite Equalizer APO (gratuito): l'EQ di iCUE è elaborazione audio
// sul PC, non un comando alle cuffie, quindi lo si sostituisce con un filtro di sistema.
const fs = require('fs');
const path = require('path');

const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const INCLUDE_FILE = 'unico-eq.txt';
const INCLUDE_LINE = `Include: ${INCLUDE_FILE}`;

const PRESETS = {
  Piatto: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Bassi: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'FPS (passi)': [-4, -3, -2, 0, 1, 3, 5, 5, 3, 0],
  Voce: [-3, -2, 0, 2, 4, 4, 3, 1, 0, -1],
  Musica: [3, 2, 1, 0, -1, 0, 1, 2, 3, 3],
};

function configDir() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  return path.join(pf, 'EqualizerAPO', 'config');
}

function buildConfig(gains, deviceFilter) {
  const g = BANDS.map((f, i) => Math.max(-12, Math.min(12, Number(gains[i]) || 0)));
  const preamp = -Math.max(0, ...g);
  return [
    '# Generato da Unico: non modificare a mano, viene riscritto.',
    `Device: ${deviceFilter}`,
    `Preamp: ${preamp.toFixed(1)} dB`,
    `GraphicEQ: ${BANDS.map((f, i) => `${f} ${g[i].toFixed(1)}`).join('; ')}`,
    'Device: all',
    '',
  ].join('\r\n');
}

function status() {
  const dir = configDir();
  const installed = fs.existsSync(path.join(dir, 'config.txt'));
  if (!installed) return { installed: false };
  const cfg = fs.readFileSync(path.join(dir, 'config.txt'), 'utf8');
  return { installed: true, linked: cfg.split(/\r?\n/).some((l) => l.trim() === INCLUDE_LINE) };
}

// deviceFilter: il GUID dell'uscita audio delle cuffie ({...}). Mai un nome generico come "HS80",
// che in Equalizer APO vale anche per il microfono.
function apply(gains, enabled = true, deviceFilter = null) {
  const dir = configDir();
  const main = path.join(dir, 'config.txt');
  if (!fs.existsSync(main)) return { ok: false, error: 'Equalizer APO non è installato' };
  if (enabled && !/^\{[0-9a-f-]{36}\}$/i.test(String(deviceFilter || ''))) return { ok: false, error: 'Uscita audio delle cuffie non trovata: accendi le cuffie e riprova' };
  try {
    const cfg = fs.readFileSync(main, 'utf8');
    const lines = cfg.split(/\r?\n/);
    const linked = lines.some((l) => l.trim() === INCLUDE_LINE);
    if (enabled) {
      fs.writeFileSync(path.join(dir, INCLUDE_FILE), buildConfig(gains, deviceFilter));
      if (!linked) fs.writeFileSync(main, cfg.replace(/\s*$/, '') + `\r\n${INCLUDE_LINE}\r\n`);
    } else {
      // EQ spento: Unico si toglie del tutto dalla configurazione di Equalizer APO
      if (linked) fs.writeFileSync(main, lines.filter((l) => l.trim() !== INCLUDE_LINE).join('\r\n'));
      try { fs.unlinkSync(path.join(dir, INCLUDE_FILE)); } catch (e) {}
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.code === 'EPERM' || e.code === 'EACCES' ? 'Permessi insufficienti sulla cartella di Equalizer APO' : e.message };
  }
}

module.exports = { BANDS, PRESETS, buildConfig, status, apply, configDir };
