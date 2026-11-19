'use strict';
const api = window.unico;
const $ = (s) => document.querySelector(s);
const U = window.BatUI;

let open = null, lastP = null;
function render(p) {
  lastP = p;
  const el = $('#list');
  if (!p.list.length) {
    el.innerHTML = '<div class="empty">Nessun dispositivo collegato.<br><small>Accendi mouse, cuffie o tastiera, oppure collega il telefono.</small></div>';
  } else {
    el.innerHTML = p.list.map((e) => `
      <div class="row lv-${U.level(e.percent, p.low)}${e.stale ? ' stale' : ''}${open === e.id ? ' open' : ''}" data-id="${U.esc(e.id)}">
        ${U.ring(e, p.low, 42)}
        <div class="txt"><b>${U.esc(e.name)}</b><span>${U.esc(U.detail(e, p.now))}</span></div>
        <div class="pct">${U.label(e)}</div>
        ${open === e.id ? `<div class="more">${U.chart((p.history || {})[e.id], p.now)}${e.perHour ? `<small>Consumo medio: ${String(e.perHour).replace('.', ',')}% all'ora</small>` : ''}</div>` : ''}
      </div>`).join('');
  }
  const low = p.list.filter((e) => e.percent != null && e.percent <= p.low && !e.charging).length;
  const known = p.list.some((e) => e.percent != null);
  $('#foot').textContent = low ? `${low} da ricaricare` : known ? 'Tutto a posto' : p.list.length ? 'Nessuna lettura recente' : '';
}

api.batteriesGet().then(render);
api.on('batteries', render);
$('#open').onclick = () => api.batteriesOpenMain();
$('#refresh').onclick = async () => {
  $('#refresh').classList.add('spin');
  try { render(await api.batteriesRefresh()); } finally { $('#refresh').classList.remove('spin'); }
};
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

// clic su un dispositivo: grafico delle ultime 48 ore
$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row || !lastP) return;
  open = open === row.dataset.id ? null : row.dataset.id;
  render(lastP);
});
