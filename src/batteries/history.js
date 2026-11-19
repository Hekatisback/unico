'use strict';
// Storico delle batterie: un punto ogni tanto per dispositivo, solo da letture vere (mai valori vecchi).
// Serve per il grafico e per stimare quante ore restano. Resta sul PC, in un file a parte.

const KEEP_MS = 14 * 86400e3;
const MIN_GAP_MS = 10 * 60e3;

// Aggiunge un punto se è passato abbastanza tempo o se il valore/la carica è cambiato.
function record(hist, entry, now = Date.now()) {
  if (!entry || entry.percent == null || entry.stale) return false;
  const list = hist[entry.id] || (hist[entry.id] = []);
  const last = list[list.length - 1];
  const charging = !!entry.charging;
  if (last && now - last.t < MIN_GAP_MS && Math.abs(last.p - entry.percent) < 2 && last.c === charging) return false;
  list.push({ t: now, p: entry.percent, c: charging });
  while (list.length && now - list[0].t > KEEP_MS) list.shift();
  return true;
}

// Punti dell'ultima scarica: dall'ultimo momento in cui era in carica (o risaliva) fino ad ora.
function dischargeRun(list) {
  const run = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i];
    if (x.c) break;
    if (run.length && x.p < run[0].p - 1) break; // prima era più scarico: lì è stato ricaricato
    if (run.length && run[0].t - x.t > 12 * 3600e3) break; // buco lungo (spento): non è la stessa scarica
    run.unshift(x);
  }
  return run;
}

// Ore rimaste con una retta sui punti della scarica in corso. Serve almeno mezz'ora e 3 punti persi.
function estimate(list, now = Date.now()) {
  if (!list || list.length < 2) return null;
  const last = list[list.length - 1];
  if (last.c) return null;
  const run = dischargeRun(list);
  if (run.length < 2) return null;
  const span = run[run.length - 1].t - run[0].t;
  const drop = run[0].p - run[run.length - 1].p;
  if (span < 30 * 60e3 || drop < 3) return null;
  // minimi quadrati: percentuale in funzione del tempo
  const n = run.length;
  const mt = run.reduce((a, x) => a + x.t, 0) / n;
  const mp = run.reduce((a, x) => a + x.p, 0) / n;
  let num = 0, den = 0;
  for (const x of run) { num += (x.t - mt) * (x.p - mp); den += (x.t - mt) ** 2; }
  const slope = den ? num / den : 0; // % per ms (negativo)
  if (slope >= 0) return null;
  const hours = last.p / -slope / 3600e3 - (now - last.t) / 3600e3;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return { hours, perHour: -slope * 3600e3 };
}

function formatHours(h) {
  if (h == null) return '';
  if (h < 1) return `circa ${Math.max(5, Math.round(h * 60 / 5) * 5)} min`;
  if (h < 48) return `circa ${Math.round(h)} h`;
  return `circa ${Math.round(h / 24)} giorni`;
}

module.exports = { record, dischargeRun, estimate, formatHours, KEEP_MS, MIN_GAP_MS };
