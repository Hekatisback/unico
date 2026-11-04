'use strict';
// Sezioni aggiunte nella 2.1: Audio, Giochi, Strumenti, notifiche del telefono, backup e aggiornamenti.
// Usa le funzioni comuni di app.js ed extra.js ($, api, chips, toast, act, confirmBox...).

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'adesso';
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`;
  return new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
};
const whenText = (t) => {
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `oggi alle ${time}`;
  const tom = new Date(now); tom.setDate(now.getDate() + 1);
  if (d.toDateString() === tom.toDateString()) return `domani alle ${time}`;
  return `${d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })} alle ${time}`;
};
const left = (t) => { const s = Math.max(0, Math.round((t - Date.now()) / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const ICON = {
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>',
};
// La CSP non permette stili scritti nell'HTML: li applico dopo, dai data-attributi.
function styled(el) {
  $$('[data-w]', el).forEach((x) => { x.style.width = `${x.dataset.w}%`; });
  $$('[data-h]', el).forEach((x) => { x.style.setProperty('--h', x.dataset.h); });
  return el;
}
const kindOf = (name) => (/cuffi|headset|hs80|headphone/i.test(name) ? 'Cuffie' : /altoparlant|speaker/i.test(name) ? 'Altoparlanti' : /hdmi|display|nvidia|phl|monitor/i.test(name) ? 'Monitor' : /microfon|mic/i.test(name) ? 'Microfono' : 'Audio');

// =============================================================================
// Audio
// =============================================================================
let auTimer = null;
let auDragging = false;
function deviceRow(d, flow) {
  return `<div class="au-row ${d.isDefault ? 'on' : ''}" data-id="${esc(d.id)}" data-flow="${flow}">
    <button class="au-pick" title="Usa questo">${flow === 'capture' ? ICON.mic : ICON.speaker}<span><b>${esc(d.name.replace(/\s*\(.*\)$/, ''))}</b><small>${esc((d.name.match(/\((.*)\)$/) || [])[1] || kindOf(d.name))}${d.isDefault ? ' · in uso' : ''}</small></span></button>
    <button class="icon-btn au-mute ${d.muted ? 'muted' : ''}" title="${d.muted ? 'Riattiva' : 'Silenzia'}">${d.muted ? (flow === 'capture' ? ICON.micOff : ICON.mute) : flow === 'capture' ? ICON.mic : ICON.speaker}</button>
    <input type="range" min="0" max="100" value="${d.volume}" class="au-vol"><b class="au-pct">${d.volume}%</b>
    <div class="meter"><div data-w="${d.peak || 0}"></div></div>
  </div>`;
}
function appRow(a) {
  return `<div class="au-row" data-pids="${a.pids.join(',')}">
    <span class="au-pick static">${ICON.speaker}<span><b>${esc(a.desc || a.name)}</b><small>${a.system ? 'Windows' : esc(a.name)}</small></span></span>
    <button class="icon-btn au-mute ${a.muted ? 'muted' : ''}" title="${a.muted ? 'Riattiva' : 'Silenzia'}">${a.muted ? ICON.mute : ICON.speaker}</button>
    <input type="range" min="0" max="100" value="${a.volume}" class="au-vol"><b class="au-pct">${a.volume}%</b>
    <div class="meter"><div data-w="${a.peak || 0}"></div></div>
  </div>`;
}
// Aggiorna solo i livelli se la lista non è cambiata, così i cursori non saltano mentre li muovi.
function patchList(el, items, key, build) {
  const ids = items.map(key).join('|');
  if (el.dataset.ids !== ids) {
    el.dataset.ids = ids;
    el.innerHTML = items.length ? items.map(build).join('') : '<p class="muted">Nessuna app sta usando l\'audio in questo momento.</p>';
    $$('input[type=range]', el).forEach(paintRange);
    styled(el);
    return;
  }
  const rows = $$('.au-row', el);
  items.forEach((it, i) => {
    const r = rows[i];
    if (!r) return;
    $('.meter div', r).style.width = `${it.peak || 0}%`;
    r.classList.toggle('on', !!it.isDefault);
    const m = $('.au-mute', r);
    if (!auDragging && document.activeElement !== $('.au-vol', r)) {
      $('.au-vol', r).value = it.volume; paintRange($('.au-vol', r)); $('.au-pct', r).textContent = `${it.volume}%`;
    }
    m.classList.toggle('muted', !!it.muted);
  });
}
async function loadAudio() {
  const tab = tabs.audio.get();
  try {
    if (tab === 'out') patchList($('#au-out'), await api.audioDevices('render'), (d) => `${d.id}${d.isDefault}${d.muted}`, (d) => deviceRow(d, 'render'));
    if (tab === 'apps') patchList($('#au-apps'), await api.audioSessions(), (a) => `${a.name}${a.muted}`, appRow);
    if (tab === 'mic') patchList($('#au-mic'), await api.audioDevices('capture'), (d) => `${d.id}${d.isDefault}${d.muted}`, (d) => deviceRow(d, 'capture'));
  } catch (e) { /* il prossimo giro riprova */ }
}
function audioWatch(on) {
  clearInterval(auTimer);
  auTimer = null;
  if (on) { loadAudio(); auTimer = setInterval(loadAudio, 700); }
  if (!on) micStop();
}
pageHooks.audio = audioWatch;
tabHooks.audio = () => setTimeout(loadAudio, 0);
['#au-out', '#au-mic', '#au-apps'].forEach((sel) => {
  const el = $(sel);
  el.addEventListener('click', async (e) => {
    const row = e.target.closest('.au-row');
    if (!row) return;
    if (e.target.closest('.au-pick') && row.dataset.id && !row.classList.contains('on')) {
      await act(null, () => api.audioSetDefault(row.dataset.id), 'Dispositivo cambiato');
      el.dataset.ids = ''; loadAudio();
    }
    if (e.target.closest('.au-mute')) {
      const mute = !$('.au-mute', row).classList.contains('muted');
      $('.au-mute', row).classList.toggle('muted', mute);
      if (row.dataset.id) await act(null, () => api.audioSetDeviceMute({ id: row.dataset.id, mute }));
      else await act(null, () => api.audioSetApp({ pids: row.dataset.pids.split(',').map(Number), mute }));
      el.dataset.ids = ''; loadAudio();
    }
  });
  el.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('au-vol')) auDragging = true; });
  document.addEventListener('pointerup', () => { auDragging = false; });
  el.addEventListener('input', (e) => {
    if (!e.target.classList.contains('au-vol')) return;
    const row = e.target.closest('.au-row');
    const volume = +e.target.value;
    $('.au-pct', row).textContent = `${volume}%`;
    const key = `au-${row.dataset.id || row.dataset.pids}`;
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => (row.dataset.id ? api.audioSetDeviceVolume({ id: row.dataset.id, volume }) : api.audioSetApp({ pids: row.dataset.pids.split(',').map(Number), volume })), 60);
  });
});

// Prova microfono: livello dal vivo e registrazione di 5 secondi da riascoltare.
let micStream = null, micCtx = null, micRaf = null;
async function micStart() {
  if (micStream) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    $('#mic-note').textContent = 'Non riesco ad aprire il microfono: controlla Impostazioni di Windows → Privacy → Microfono.';
    return false;
  }
  micCtx = new AudioContext();
  const an = micCtx.createAnalyser();
  an.fftSize = 1024;
  micCtx.createMediaStreamSource(micStream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const loop = () => {
    an.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    const pct = Math.min(100, Math.round(Math.sqrt(peak) * 110));
    $('#mic-level').style.width = `${pct}%`;
    $('#mic-level').className = pct > 92 ? 'hot' : '';
    micRaf = requestAnimationFrame(loop);
  };
  loop();
  $('#mic-listen').textContent = 'Smetti di ascoltare';
  return true;
}
function micStop() {
  cancelAnimationFrame(micRaf);
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  if (micCtx) micCtx.close().catch(() => {});
  micStream = micCtx = null;
  $('#mic-level').style.width = '0';
  $('#mic-listen').textContent = 'Ascolta il livello';
}
$('#mic-listen').onclick = () => (micStream ? micStop() : micStart());
$('#mic-rec').onclick = async () => {
  if (!(await micStart())) return;
  const b = $('#mic-rec');
  b.disabled = true;
  const rec = new MediaRecorder(micStream);
  const parts = [];
  rec.ondataavailable = (e) => parts.push(e.data);
  rec.onstop = () => {
    const audio = new Audio(URL.createObjectURL(new Blob(parts, { type: rec.mimeType })));
    b.textContent = 'Riascolto…';
    audio.onended = () => { b.textContent = 'Registra 5 secondi'; b.disabled = false; $('#mic-note').textContent = 'Fatto. Se ti senti basso, alza il volume del microfono qui a sinistra.'; };
    audio.play().catch(() => { b.textContent = 'Registra 5 secondi'; b.disabled = false; });
  };
  rec.start();
  let n = 5;
  b.textContent = `Parla… ${n}`;
  const t = setInterval(() => { n--; if (n > 0) b.textContent = `Parla… ${n}`; else { clearInterval(t); rec.stop(); } }, 1000);
};

// =============================================================================
// Giochi
// =============================================================================
let gameList = [];
const SRC_ORDER = ['Steam', 'Epic', 'Riot', 'Minecraft', 'Aggiunto da te'];
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function renderGames() {
  const q = $('#games-search').value.trim().toLowerCase();
  const list = gameList.filter((g) => !q || g.name.toLowerCase().includes(q));
  const played = CFG.lastPlayed || {};
  list.sort((a, b) => (played[b.id] || 0) - (played[a.id] || 0) || a.name.localeCompare(b.name, 'it'));
  $('#games-sub').textContent = gameList.length ? `${gameList.length} giochi trovati · avviandoli si attiva il profilo Gioco` : 'Tutti i tuoi giochi in un posto.';
  if (!list.length) {
    $('#games-grid').innerHTML = `<div class="empty glass show"><h3>${gameList.length ? 'Nessun risultato' : 'Nessun gioco trovato'}</h3><p class="muted">Unico cerca in Steam, Epic Games, Riot Client e Prism Launcher. Per altri giochi usa "Aggiungi gioco" e scegli il file .exe.</p></div>`;
    return;
  }
  $('#games-grid').innerHTML = list.map((g) => `
    <div class="game glass" data-id="${esc(g.id)}">
      <div class="gcover" data-h="${hue(g.name)}">${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : `<span>${esc(initials(g.name))}</span>`}</div>
      <div class="game-info"><b title="${esc(g.name)}">${esc(g.name)}</b><small>${esc(g.source)}${played[g.id] ? ` · ${ago(played[g.id])}` : ''}</small></div>
      <button class="play" title="Gioca">${ICON.play}</button>
      ${g.id.startsWith('custom:') ? `<button class="icon-btn rm" title="Togli dalla libreria">${ICON.x}</button>` : ''}
    </div>`).join('');
  styled($('#games-grid'));
  $$('#games-grid img').forEach((img) => { img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: initials(img.closest('.game').querySelector('b').textContent) })); }; });
}
async function loadGames(force = false) {
  const r = await api.gamesList(force);
  gameList = Array.isArray(r) ? r : [];
  renderGames();
}
$('#games-search').addEventListener('input', renderGames);
$('#games-scan').onclick = (e) => act(e.target, () => loadGames(true), 'Libreria aggiornata');
$('#games-add').onclick = async (e) => { const r = await act(e.target, () => api.gamesAddCustom()); if (r && r.added) { await loadGames(true); toast('Gioco aggiunto'); } };
$('#games-grid').addEventListener('click', async (e) => {
  const card = e.target.closest('.game');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('.rm')) { await api.gamesRemoveCustom(id); return loadGames(true); }
  const g = gameList.find((x) => x.id === id);
  card.classList.add('launching');
  const r = await act(null, () => api.gamesLaunch(id), `Avvio ${g ? g.name : ''}…`);
  setTimeout(() => card.classList.remove('launching'), 2500);
  if (r && r.ok) { CFG.lastPlayed = { ...(CFG.lastPlayed || {}), [id]: Date.now() }; setTimeout(renderGames, 2600); }
});
async function loadSessions() {
  const r = await api.gamesSessions();
  const row = (s) => `<tr><td>${esc(s.game)}</td><td>${esc(whenText(s.start))}</td><td class="num">${s.minutes >= 60 ? `${Math.floor(s.minutes / 60)} h ${s.minutes % 60} min` : `${s.minutes} min`}</td><td class="num">${s.cpuAvg}%</td><td class="num">${s.gpuAvg}%</td><td class="num ${s.gpuTempMax >= 85 ? 'hot' : ''}">${s.gpuTempMax ? `${s.gpuTempMax} °C` : '—'}</td></tr>`;
  $('#sess-now').innerHTML = r.current ? `<div class="sess-live"><i></i>In corso: <b>${esc(r.current.game)}</b> da ${r.current.minutes} min · GPU max ${r.current.gpuTempMax} °C</div>` : '';
  $('#sess-body').innerHTML = r.sessions.length ? r.sessions.map(row).join('') : '<tr><td colspan="6" class="muted">Ancora nessuna sessione: apri un gioco e la vedrai qui quando lo chiudi.</td></tr>';
}
pageHooks.games = (on) => { if (on && !gameList.length) loadGames(); if (on && tabs.games.get() === 'sessions') loadSessions(); };
tabHooks.games = (t) => { if (t === 'sessions') loadSessions(); };

// =============================================================================
// Strumenti: appunti
// =============================================================================
let clipItems = [];
function renderClips() {
  const q = $('#clip-search').value.trim().toLowerCase();
  const list = clipItems.filter((c) => !q || c.text.toLowerCase().includes(q));
  $('#clip-list').innerHTML = list.length ? list.map((c) => `
    <div class="clip ${c.pinned ? 'pinned' : ''}" data-id="${c.id}" title="Clicca per copiare">
      <pre>${esc(c.text.length > 400 ? `${c.text.slice(0, 400)}…` : c.text)}</pre>
      <small>${ago(c.at)}</small>
      <button class="icon-btn pin" title="${c.pinned ? 'Sblocca' : 'Tieni in cima'}">${ICON.pin}</button>
      <button class="icon-btn rm" title="Elimina">${ICON.x}</button>
    </div>`).join('') : `<p class="muted">${clipItems.length ? 'Nessun risultato.' : 'Copia qualcosa (Ctrl+C) e lo trovi qui.'}</p>`;
}
api.on('clips', (c) => { clipItems = c; if (currentPage === 'tools') renderClips(); });
$('#clip-search').addEventListener('input', renderClips);
$('#clip-list').addEventListener('click', async (e) => {
  const el = e.target.closest('.clip');
  if (!el) return;
  const id = +el.dataset.id;
  if (e.target.closest('.pin')) clipItems = await api.clipPin(id);
  else if (e.target.closest('.rm')) clipItems = await api.clipRemove(id);
  else { await api.clipCopy(id); toast('Copiato'); }
  renderClips();
});
$('#clip-clear').onclick = async () => { if (await confirmBox('Svuotare la cronologia?', 'Restano solo gli elementi fissati in cima.', { yes: 'Svuota' })) { clipItems = await api.clipClear(); renderClips(); } };
$('#clip-on').addEventListener('change', () => saveSetting({ clipboard: { enabled: $('#clip-on').checked } }, 'clip'));

// Promemoria e timer
let remItems = [], remTick = null;
function renderReminders() {
  const list = remItems.filter((r) => !r.done).sort((a, b) => a.at - b.at);
  $('#rem-list').innerHTML = list.length ? list.map((r) => `
    <div class="rem" data-id="${r.id}">
      <span class="rem-ico">${r.kind === 'timer' ? '⏱' : ICON.bell}</span>
      <span class="grow"><b>${esc(r.text || (r.kind === 'timer' ? 'Timer' : 'Promemoria'))}</b><small>${r.kind === 'timer' ? `mancano <span class="count" data-at="${r.at}">${left(r.at)}</span>` : `${whenText(r.at)}${r.repeat === 'daily' ? ' · ogni giorno' : ''}`}</small></span>
      <button class="icon-btn rm" title="Annulla">${ICON.x}</button>
    </div>`).join('') : '<p class="muted">Niente in programma.</p>';
}
async function loadReminders() { remItems = await api.remList(); renderReminders(); }
api.on('reminders', (r) => { remItems = r; renderReminders(); });
async function addReminder(payload) {
  const r = await act(null, () => api.remAdd(payload));
  if (r && r.ok) { remItems = r.list; renderReminders(); toast(payload.kind === 'timer' ? 'Timer avviato' : 'Promemoria salvato'); }
  return r;
}
const timerQuick = chips($('#timer-quick'), (v) => { $('#timer-min').value = v; });
$('#timer-add').onclick = () => {
  const m = Math.max(1, Math.min(1440, +$('#timer-min').value || 0));
  addReminder({ kind: 'timer', text: $('#timer-label').value.trim(), at: Date.now() + m * 60000 }).then(() => { $('#timer-label').value = ''; timerQuick.set(null); });
};
$('#rem-add').onclick = () => {
  const at = new Date($('#rem-at').value).getTime();
  if (!$('#rem-text').value.trim()) return toast('Scrivi cosa ricordarti', 'bad');
  addReminder({ kind: 'reminder', text: $('#rem-text').value.trim(), at, repeat: $('#rem-daily').checked ? 'daily' : 'none' }).then((r) => { if (r && r.ok) { $('#rem-text').value = ''; $('#rem-daily').checked = false; } });
};
$('#rem-list').addEventListener('click', async (e) => {
  const el = e.target.closest('.rem');
  if (el && e.target.closest('.rm')) { const r = await api.remRemove(+el.dataset.id); remItems = r.list; renderReminders(); }
});
function defaultRemTime() {
  const d = new Date(Date.now() + 3600000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  $('#rem-at').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Cattura schermo
$('#cap-shot').onclick = (e) => act(e.target, () => api.screenshot(), 'Screenshot salvato e copiato');
$$('[data-open]').forEach((b) => { b.onclick = () => api.openCaptures(b.dataset.open === 'video' ? 'video' : 'shot'); });
$('#cap-audio').addEventListener('change', () => saveSetting({ capture: { audio: $('#cap-audio').checked } }, 'capture'));
let recorder = null, recStart = 0, recTick = null;
async function toggleRecording() {
  if (recorder) { recorder.stop(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: !!(CFG.capture && CFG.capture.audio !== false) });
  } catch (e) { toast('Registrazione non avviata', 'bad'); return; }
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6 });
  await api.recBegin();
  let chain = Promise.resolve();
  recorder.ondataavailable = (e) => { if (e.data.size) chain = chain.then(async () => api.recChunk(new Uint8Array(await e.data.arrayBuffer()))); };
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    await chain;
    await api.recEnd();
    recorder = null;
    clearInterval(recTick);
    $('#cap-rec').textContent = 'Inizia a registrare';
    $('#cap-rec').classList.remove('danger');
    $('#rec-state').textContent = 'Salvato in Video\\Unico';
    document.body.classList.remove('recording');
  };
  stream.getVideoTracks()[0].addEventListener('ended', () => recorder && recorder.state !== 'inactive' && recorder.stop());
  recorder.start(1000);
  recStart = Date.now();
  $('#cap-rec').textContent = 'Ferma';
  $('#cap-rec').classList.add('danger');
  document.body.classList.add('recording');
  recTick = setInterval(() => { $('#rec-state').innerHTML = `<i></i> Registrazione in corso · ${left(Date.now() * 2 - recStart)}`; }, 500);
}
$('#cap-rec').onclick = toggleRecording;
api.on('rec:toggle', () => toggleRecording());

pageHooks.tools = async (on) => {
  clearInterval(remTick);
  if (!on) return;
  clipItems = await api.clipList();
  renderClips();
  loadReminders();
  remTick = setInterval(() => $$('.count').forEach((c) => { c.textContent = left(+c.dataset.at); }), 1000);
};

// =============================================================================
// Notifiche del telefono
// =============================================================================
let pnItems = [];
function renderPhoneNotif() {
  const P = CFG.phoneNotif || {};
  $('#pn-list').innerHTML = !P.enabled ? '<p class="muted">Attiva l\'interruttore per ricevere le notifiche.</p>'
    : pnItems.length ? pnItems.slice(0, 12).map((n) => `<div class="pn ${(P.muted || []).includes(n.pkg) ? 'off' : ''}"><span class="pn-app" data-h="${hue(n.app)}">${esc(initials(n.app))}</span><span class="grow"><b>${esc(n.title)}</b><small>${esc(n.app)}${n.when ? ` · ${ago(n.when)}` : ''}</small><p>${esc(n.text)}</p></span></div>`).join('')
      : '<p class="muted">Nessuna notifica sul telefono (o telefono non collegato).</p>';
  styled($('#pn-list'));
  const apps = [...new Map(pnItems.map((n) => [n.pkg, n.app])).entries()];
  for (const pkg of P.muted || []) if (!apps.some(([p]) => p === pkg)) apps.push([pkg, pkg.split('.').pop()]);
  $('#pn-muted').innerHTML = apps.length ? apps.map(([pkg, app]) => `<button data-pkg="${esc(pkg)}" class="${(P.muted || []).includes(pkg) ? 'off' : 'on'}">${esc(app)}</button>`).join('') : '<p class="muted">Le app compariranno qui quando arriva una notifica.</p>';
}
api.on('phoneNotif', (l) => { pnItems = l; if (currentPage === 'phone') renderPhoneNotif(); });
$('#pn-on').addEventListener('change', () => { CFG.phoneNotif = { ...(CFG.phoneNotif || {}), enabled: $('#pn-on').checked }; saveSetting({ phoneNotif: CFG.phoneNotif }, 'pn'); renderPhoneNotif(); });
$('#pn-muted').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-pkg]');
  if (!b) return;
  const muted = new Set(CFG.phoneNotif.muted || []);
  if (muted.has(b.dataset.pkg)) muted.delete(b.dataset.pkg); else muted.add(b.dataset.pkg);
  CFG.phoneNotif = { ...CFG.phoneNotif, muted: [...muted] };
  saveSetting({ phoneNotif: CFG.phoneNotif }, 'pn');
  renderPhoneNotif();
});
const firstPhone = () => (phoneDevices.find((d) => d.state === 'device') || {}).serial;
$('#pn-send').onclick = async (e) => {
  const serial = firstPhone();
  if (!serial) return toast('Collega prima il telefono', 'bad');
  const r = await act(e.target, () => api.phoneType({ serial, text: $('#pn-text').value }), 'Scritto sul telefono');
  if (r && r.ok) $('#pn-text').value = '';
};
$('#pn-paste').onclick = async () => { try { $('#pn-text').value = await navigator.clipboard.readText(); } catch (e) { toast('Appunti non leggibili', 'bad'); } };
tabHooks.phone = async (t) => { if (t === 'notif') { pnItems = await api.phoneNotifications(); renderPhoneNotif(); } };

// =============================================================================
// Impostazioni: aggiornamenti e backup
// =============================================================================
function renderUpdate(u) {
  const t = $('#upd-text');
  const b = $('#upd-install');
  b.hidden = u.status !== 'ready';
  t.textContent = {
    dev: `Versione ${u.version} (sviluppo): gli aggiornamenti funzionano solo nella versione installata.`,
    idle: `Versione ${u.version}. Unico controlla da solo ogni 6 ore e scarica in silenzio.`,
    checking: 'Controllo in corso…',
    latest: `Versione ${u.version}: sei aggiornato${u.checkedAt ? ` (controllato ${ago(u.checkedAt)})` : ''}.`,
    downloading: `Scarico la versione ${u.next || ''}… ${u.percent != null ? `${u.percent}%` : ''}`,
    ready: `La versione ${u.next} è pronta: si installa quando chiudi Unico, oppure subito.`,
    error: `Non sono riuscito a controllare: ${u.error || 'errore'}`,
  }[u.status] || `Versione ${u.version}`;
}
api.on('update', renderUpdate);
$('#upd-check').onclick = async (e) => renderUpdate(await act(e.target, () => api.updateCheck()));
$('#upd-install').onclick = () => api.updateInstall();
$('#bk-export').onclick = (e) => act(e.target, () => api.backupExport()).then((r) => r && r.saved && toast('Backup salvato'));
$('#bk-import').onclick = async (e) => {
  if (!(await confirmBox('Ripristinare un backup?', 'Le impostazioni attuali vengono sostituite da quelle del file. Unico si ricarica.', { yes: 'Scegli il file' }))) return;
  act(e.target, () => api.backupImport());
};

// =============================================================================
// Avvio
// =============================================================================
function moreInit() {
  if (!CFG || !tabs.audio) return setTimeout(moreInit, 100);
  $('#clip-on').checked = !(CFG.clipboard && CFG.clipboard.enabled === false);
  $('#cap-audio').checked = !(CFG.capture && CFG.capture.audio === false);
  $('#pn-on').checked = !!(CFG.phoneNotif && CFG.phoneNotif.enabled);
  defaultRemTime();
  api.updateGet().then(renderUpdate);
  api.remList().then((r) => { remItems = r; });
}
moreInit();
