'use strict';
const api = window.unico;
const $ = (s) => document.querySelector(s);
const U = window.BatUI;

function render(p) {
  const el = $('#list');
  if (!p.list.length) {
    el.innerHTML = '<div class="empty">Nessun dispositivo collegato.<br><small>Accendi mouse, cuffie o tastiera, oppure collega il telefono.</small></div>';
  } else {
    el.innerHTML = p.list.map((e) => `
      <div class="row lv-${U.level(e.percent, p.low)}${e.stale ? ' stale' : ''}">
        ${U.ring(e, p.low, 42)}
        <div class="txt"><b>${U.esc(e.name)}</b><span>${U.esc(U.detail(e, p.now))}</span></div>
        <div class="pct">${U.label(e)}</div>
      </div>`).join('');
  }
  const low = p.list.filter((e) => e.percent != null && e.percent <= p.low && !e.charging).length;
  $('#foot').textContent = low ? `${low} da ricaricare` : p.list.length ? 'Tutto a posto' : '';
}

api.batteriesGet().then(render);
api.on('batteries', render);
$('#open').onclick = () => api.batteriesOpenMain();
$('#refresh').onclick = async () => {
  $('#refresh').classList.add('spin');
  try { render(await api.batteriesRefresh()); } finally { $('#refresh').classList.remove('spin'); }
};
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
