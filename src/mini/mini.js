'use strict';
const $ = (s) => document.querySelector(s);
const api = window.unico;
let cfg = null;
const color = (p) => (p > 50 ? 'var(--ok)' : p > 15 ? 'var(--warn)' : 'var(--bad)');
function renderState(st) {
  for (const k of ['mouse', 'headset', 'keyboard']) {
    const d = st[k] || {};
    const el = $(`#b-${k}`);
    const has = typeof d.battery === 'number';
    const p = has ? d.battery : d.lastBattery ? d.lastBattery.percent : null;
    const label = !d.connected ? 'Assente' : d.asleep ? 'Standby' : d.off ? 'Spente' : p == null ? (k === 'keyboard' && d.wired ? 'Cavo' : 'OK') : `${p}%`;
    el.querySelector('b').textContent = label;
    el.classList.toggle('stale', !has && p != null);
    const u = el.querySelector('u');
    u.style.width = `${p == null ? 0 : p}%`;
    u.style.background = p == null ? 'transparent' : color(p);
  }
  if (cfg) drawProfiles(st.activeProfile);
}
function drawProfiles(active) {
  $('#profiles').innerHTML = '';
  for (const [id, p] of Object.entries(cfg.profiles)) {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.className = id === active ? 'on' : '';
    b.onclick = () => api.profileActivate(id);
    $('#profiles').appendChild(b);
  }
}
api.getState().then((r) => { cfg = r.settings; renderState(r.state); });
api.onState(renderState);
api.onStats((s) => {
  $('#s-cpu').textContent = `${s.cpu.total}%`;
  $('#s-gpu').textContent = s.gpu ? `${Math.round(s.gpu.util)}%` : '—';
  const t = s.gpu && s.gpu.temp != null ? Math.round(s.gpu.temp) : null;
  $('#s-temp').textContent = t != null ? `${t} °C` : '—';
  $('#s-temp').className = t >= 85 ? 'hot' : t >= 75 ? 'warm' : '';
  $('#s-ram').textContent = `${s.ram.pct}%`;
});
async function media() {
  const m = await api.sysMedia().catch(() => null);
  $('#m-title').textContent = m && m.title ? m.title : 'Niente in riproduzione';
  $('#m-artist').textContent = m && m.artist ? m.artist : '';
  $('#m-art').style.backgroundImage = m && m.thumb ? `url("${m.thumb}")` : '';
  $('#m-play').textContent = m && m.playing ? '⏸' : '▶';
}
media();
setInterval(media, 3000);
document.querySelectorAll('.ctl button').forEach((b) => { b.onclick = async () => { await api.sysMediaKey(b.dataset.k); setTimeout(media, 400); }; });
$('#close').onclick = () => api.miniClose();
$('#open').onclick = () => api.miniOpenMain();
