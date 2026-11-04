'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const api = window.unico;

let S = null;     // stato dei dispositivi
let CFG = null;   // impostazioni salvate
let META = null;
const filled = {};

// =============================================================================
// Componenti
// =============================================================================

const allLiquid = [];
// Schede con "goccia" che scivola e si schiaccia mentre si sposta.
function liquid(container, onSelect, attr = 'data-tab') {
  const blob = $('.blob', container);
  const buttons = $$(`button[${attr}]`, container);
  const place = (btn, animate = true) => {
    if (!btn || !blob || !btn.offsetWidth) return;
    if (animate) { blob.classList.add('moving'); setTimeout(() => blob.classList.remove('moving'), 260); }
    else blob.style.transition = 'none';
    blob.style.left = `${btn.offsetLeft}px`;
    blob.style.width = `${btn.offsetWidth}px`;
    if (!animate) { void blob.offsetWidth; blob.style.transition = ''; }
  };
  buttons.forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('on')) return;
    buttons.forEach((x) => x.classList.toggle('on', x === b));
    place(b);
    onSelect(b.getAttribute(attr));
  }));
  const api2 = {
    set(v, animate = false) { const b = buttons.find((x) => x.getAttribute(attr) === String(v)); if (b) { buttons.forEach((x) => x.classList.toggle('on', x === b)); place(b, animate); } },
    get() { const b = buttons.find((x) => x.classList.contains('on')); return b ? b.getAttribute(attr) : null; },
    relayout() { place(buttons.find((x) => x.classList.contains('on')), false); },
  };
  new ResizeObserver(() => api2.relayout()).observe(container);
  requestAnimationFrame(() => api2.relayout());
  allLiquid.push(api2);
  return api2;
}

// Gruppo di chip a scelta singola.
function chips(el, onPick) {
  const set = (v) => $$('button', el).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    e.stopPropagation();
    set(b.dataset.v);
    onPick && onPick(b.dataset.v);
  });
  return { set, get: () => { const b = $('button.on', el); return b ? b.dataset.v : null; } };
}

// Riempimento colorato dei cursori.
function paintRange(r) { const min = +r.min || 0, max = +r.max || 100; r.style.setProperty('--fill', `${((r.value - min) / (max - min)) * 100}%`); }
document.addEventListener('input', (e) => { if (e.target.type === 'range') paintRange(e.target); });

// Mostra i campi pertinenti all'effetto scelto.
function showFor(scope, value) {
  $$('[data-show]', scope).forEach((f) => { f.hidden = !f.dataset.show.split(' ').includes(value); });
}
function showWhen(scope) {
  $$('[data-when]', scope).forEach((f) => { const [id, v] = f.dataset.when.split('='); f.hidden = $(`#${id}`).value !== v; });
}

// Salvataggio automatico con attesa: le modifiche vanno al dispositivo poco dopo l'ultimo tocco.
const timers = {};
function autosave(key, fn, delay = 450) {
  clearTimeout(timers[key]);
  status('saving');
  timers[key] = setTimeout(async () => {
    try {
      const r = await fn();
      if (r && r.ok === false) { status(); toast(r.error || 'Non riuscito', 'bad'); }
      else status('saved');
    } catch (e) { status(); toast(e.message, 'bad'); }
  }, delay);
}
function status(kind) {
  const el = $('#sync');
  clearTimeout(status.t);
  el.className = `titlebar-status ${kind || ''}`;
  el.textContent = kind === 'saving' ? 'Salvataggio…' : kind === 'saved' ? 'Salvato' : lastUpdated();
  if (kind === 'saved') status.t = setTimeout(() => status(), 2200);
}
const lastUpdated = () => (S && S.updated ? `Aggiornato alle ${new Date(S.updated).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : '');

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `glass show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = 'glass'; }, 3600);
}

async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const r = await fn();
    if (r && r.ok === false) toast(r.error || 'Non riuscito', 'bad'); else if (okMsg) toast(okMsg);
    return r;
  } catch (e) { toast(e.message, 'bad'); } finally { if (btn) btn.disabled = false; }
}

// =============================================================================
// Navigazione
// =============================================================================
const dock = liquid($('#dock'), (page) => go(page), 'data-page');
function go(page) {
  if (pageHooks[currentPage] && currentPage !== page) pageHooks[currentPage](false);
  currentPage = page;
  if (pageHooks[page]) pageHooks[page](true);
  dock.set(page, true);
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  $('#view').scrollTop = 0;
  if (page === 'settings' && tabs.settings && tabs.settings.get() === 'diag') loadDiag();
  phoneWatch(page === 'phone');
  requestAnimationFrame(() => allLiquid.forEach((t) => t.relayout()));
}
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g && !e.target.closest('.quick')) { e.preventDefault(); go(g.dataset.go); }
});

const tabs = {};
const tabHooks = {};
const pageHooks = {};
let currentPage = 'home';
$$('[data-tabs]').forEach((c) => {
  const name = c.dataset.tabs;
  tabs[name] = liquid(c, (tab) => {
    if (tabHooks[name]) tabHooks[name](tab);
    $$(`#${name}-body .tab`).forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
    $$(`#${name}-body input[type=range]`).forEach(paintRange);
    requestAnimationFrame(() => allLiquid.forEach((t) => t.relayout()));
  });
});

$('#refresh').onclick = async () => {
  const b = $('#refresh');
  b.classList.add('spin');
  Object.keys(filled).forEach((k) => { filled[k] = false; });
  try { await api.refresh(); } finally { b.classList.remove('spin'); }
};

// =============================================================================
// Rendering
// =============================================================================
const batteryColor = (p) => (p > 50 ? 'var(--ok)' : p > 15 ? 'var(--warn)' : 'var(--bad)');
const online = (s) => s && s.connected && !s.asleep && !s.off;

const OFFLINE = {
  mouse: (s) => s && s.asleep
    ? ['Il mouse è in standby', ['Muovi il mouse o premi un tasto', 'Poi tocca Riprova']]
    : ['Mouse non trovato', ['Collega il ricevitore HyperSpeed a una porta USB (meglio senza hub)', 'Sotto il mouse, sposta l\'interruttore su 2.4 GHz (non Bluetooth)', 'Chiudi Razer Synapse se è aperto', 'Se continua, Impostazioni → Copia diagnostica e incollala a Claude']],
  headset: (s) => s && s.off
    ? ['Le cuffie sono spente', ['Il ricevitore è collegato: accendi le cuffie tenendo premuto il tasto di accensione']]
    : s && s.cableOff ? ['Cavo collegato, cuffie spente', ['Accendi le cuffie']]
      : ['Cuffie non trovate', ['Collega il ricevitore wireless o il cavo USB', 'Accendi le cuffie', 'Chiudi completamente iCUE (anche da Gestione attività)']],
  keyboard: () => ['Tastiera non trovata', ['Collega il cavo USB-C oppure il ricevitore 2.4 GHz', 'Con il selettore della tastiera scegli USB o 2.4G (non Bluetooth)', 'Chiudi il driver AULA se è aperto']],
};

function renderEmpty(k, s) {
  const el = $(`#${k}-offline`);
  const show = !online(s);
  el.classList.toggle('show', show);
  $(`#${k}-body`).style.display = show ? 'none' : '';
  if (!show) return;
  const [title, steps] = OFFLINE[k](s);
  el.innerHTML = `<h3>${title}</h3><ol>${steps.map((x) => `<li>${x}</li>`).join('')}</ol><div><button class="btn primary" data-retry>Riprova</button></div>`;
  $('[data-retry]', el).onclick = () => $('#refresh').click();
}

function summary(k, s) {
  if (!s || !s.connected) return k === 'headset' && s && s.cableOff ? 'Cavo collegato, cuffie spente' : 'Non collegato';
  if (s.asleep) return 'In standby';
  if (s.off) return 'Cuffie spente';
  const p = [];
  if (k === 'mouse') { if (s.dpi) p.push(`${s.dpi} DPI`); if (s.pollRate) p.push(`${s.pollRate} Hz`); }
  if (k === 'headset') { p.push(s.charging === 'charging' ? 'In carica' : s.charging === 'full' ? 'Carica completa' : 'A batteria'); if (s.micMuted) p.push('microfono off'); }
  if (k === 'keyboard') p.push(s.wired ? 'Cavo USB-C' : '2.4 GHz');
  return p.join(' · ');
}

function render() {
  for (const k of ['mouse', 'headset', 'keyboard']) {
    const s = S[k];
    const ring = $(`#ring-${k}`);
    const has = s && typeof s.battery === 'number';
    ring.style.setProperty('--p', has ? s.battery : 0);
    ring.style.setProperty('--c', has ? batteryColor(s.battery) : 'transparent');
    $('span', ring).textContent = has ? `${s.battery}%` : '—';
    $(`#sum-${k}`).textContent = summary(k, s);
    const chip = $(`#chip-${k}`);
    chip.className = `chip ${online(s) ? 'on' : s && s.connected ? 'sleep' : ''}`;
    chip.textContent = online(s) ? 'Collegato' : s && s.connected ? (s.asleep ? 'Standby' : 'Spento') : 'Assente';
    $(`#dot-${k}`).className = `dot ${online(s) ? 'on' : s && s.connected ? 'sleep' : ''}`;
    renderEmpty(k, s);
  }
  const sc = $('#sync').classList;
  if (!sc.contains('saving') && !sc.contains('saved')) status();
  renderHome();
  renderMouse(S.mouse);
  renderHeadset(S.headset);
  renderKeyboard(S.keyboard);
  renderEq(S.eq || {});
  if (typeof extraRender === 'function') extraRender();
}

// ----- home ------------------------------------------------------------------
function renderHome() {
  const n = ['mouse', 'headset', 'keyboard'].filter((k) => online(S[k])).length;
  const h = new Date().getHours();
  $('#greeting').textContent = h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  $('#home-sub').textContent = n === 3 ? 'Tutte e tre le periferiche sono collegate.' : `${n} periferiche su 3 collegate.`;

  // controlli rapidi
  const qm = $('#quick-mouse');
  qm.innerHTML = online(S.mouse) && S.mouse.stages ? S.mouse.stages.map((d, i) => `<button class="btn ghost small ${i + 1 === S.mouse.active ? 'on-q' : ''}" data-stage="${i + 1}">${d}</button>`).join('') : '';
  $$('button', qm).forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const active = +b.dataset.stage;
    act(null, () => api.mouseApply({ stages: S.mouse.stages, active, dpi: S.mouse.stages[active - 1] }), `DPI: ${S.mouse.stages[active - 1]}`);
  });
  const qh = $('#quick-headset');
  qh.innerHTML = online(S.headset) && S.eq && S.eq.installed ? Object.keys(META.eqPresets).map((p) => `<button class="btn ghost small ${S.eq.enabled && S.eq.preset === p ? 'on-q' : ''}">${p}</button>`).join('') : '';
  $$('button', qh).forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const p = b.textContent;
    act(null, () => api.eqApply({ enabled: true, preset: p, gains: META.eqPresets[p] }), `EQ: ${p}`).then(() => { filled.eq = false; });
  });
  const qk = $('#quick-keyboard');
  const quickModes = [[0, 'Spento'], [1, 'Statico'], [8, 'Spettro'], [10, 'Onda']];
  qk.innerHTML = online(S.keyboard) ? quickModes.map(([m, l]) => `<button class="btn ghost small ${CFG.keyboard.lighting.mode === m ? 'on-q' : ''}" data-mode="${m}">${l}</button>`).join('') : '';
  $$('button', qk).forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const cfg = { ...CFG.keyboard.lighting, mode: +b.dataset.mode };
    act(null, () => api.keyboardLighting(cfg), `Tastiera: ${b.textContent}`).then((r) => { if (r && r.ok) { CFG.keyboard.lighting = cfg; filled.keyboard = false; render(); } });
  });

  // suggerimenti
  const tips = [];
  if (S.headset && S.headset.connected && S.eq && !S.eq.installed) tips.push(['Equalizzatore non attivo', 'Installa Equalizer APO per avere l\'EQ delle cuffie senza iCUE.', 'Come fare', () => { go('headset'); }]);
  if (S.mouse && S.mouse.error && !online(S.mouse)) tips.push(['Il mouse non risponde', 'Copia la diagnostica dalle Impostazioni: mostra cosa ha risposto il ricevitore.', 'Diagnostica', () => go('settings')]);
  if (online(S.mouse) && typeof S.mouse.battery === 'number' && S.mouse.battery <= 20) tips.push([`Pile del mouse al ${S.mouse.battery}%`, 'Il Basilisk V3 X usa una pila AA: tienine una di scorta.']);
  $('#tips').innerHTML = tips.map(([t, d, b], i) => `<div class="tip glass"><span class="tip-ico">!</span><div><b>${t}</b><span class="muted">${d}</span></div>${b ? `<button class="btn ghost small" data-tip="${i}">${b}</button>` : ''}</div>`).join('');
  $$('[data-tip]').forEach((b) => b.onclick = () => tips[+b.dataset.tip][3]());
}

// ----- mouse -----------------------------------------------------------------
let stages = [], activeStage = 1;
const poll = liquid($('#poll'), (v) => autosave('poll', () => api.mouseApply({ pollRate: +v })), 'data-v');
const scrollEffect = chips($('#scroll-effect'), (v) => { showFor($('#mouse-body [data-tab=light]'), v); saveScroll(); });

function renderMouse(s) {
  if (!online(s)) return;
  $('#mouse-sub').textContent = [typeof s.battery === 'number' ? `Pila ${s.battery}%` : null, s.firmware ? `firmware ${s.firmware}` : null, 'HyperSpeed 2.4 GHz'].filter(Boolean).join(' · ');
  if (filled.mouse) return;
  filled.mouse = true;
  stages = s.stages && s.stages.length ? s.stages.slice() : [800, 1600, 3200];
  activeStage = s.active || 1;
  drawStages();
  poll.set(s.pollRate || 1000);
  $('#idle').value = s.idle || 300;
  $('#idle-out').textContent = fmtIdle($('#idle').value);
  $('#lowbat').value = nearest([5, 10, 15, 20, 25], s.lowBattery || 10);
  const sc = CFG.mouse.scroll;
  scrollEffect.set(sc.effect);
  showFor($('#mouse-body [data-tab=light]'), sc.effect);
  $('#scroll-color').value = sc.color;
  $('#scroll-color2').value = sc.color2 || '#0066ff';
  $('#scroll-speed').value = sc.speed || 2;
  $('#scroll-bright').value = typeof s.scrollBrightness === 'number' ? s.scrollBrightness : sc.brightness;
  $$('#mouse-body input[type=range]').forEach(paintRange);
}

function drawStages() {
  const box = $('#stages');
  box.innerHTML = '';
  stages.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = `stage ${i + 1 === activeStage ? 'active' : ''}`;
    el.innerHTML = `<div class="top"><span>Stadio ${i + 1}</span><span class="pick"></span></div><input type="number" min="100" max="18000" step="50" value="${d}">`;
    el.onclick = (e) => { if (e.target.tagName !== 'INPUT') { activeStage = i + 1; drawStages(); } };
    $('input', el).onchange = (e) => { stages[i] = clampN(e.target.value, 100, 18000); e.target.value = stages[i]; };
    box.appendChild(el);
  });
  $('#stage-add').disabled = stages.length >= 5;
  $('#stage-remove').disabled = stages.length <= 1;
}
$('#stage-add').onclick = () => { if (stages.length < 5) { stages.push(Math.min(18000, (stages[stages.length - 1] || 800) * 2)); drawStages(); } };
$('#stage-remove').onclick = () => { if (stages.length > 1) { stages.pop(); activeStage = Math.min(activeStage, stages.length); drawStages(); } };
$('#stages-save').onclick = (e) => act(e.target, () => api.mouseApply({ stages, active: activeStage, dpi: stages[activeStage - 1] }), 'Stadi DPI salvati sul mouse');

function saveScroll() {
  autosave('scroll', () => api.mouseApply({ scroll: { effect: scrollEffect.get() || 'static', color: $('#scroll-color').value, color2: $('#scroll-color2').value, speed: +$('#scroll-speed').value, brightness: +$('#scroll-bright').value } }));
}
['#scroll-color', '#scroll-color2', '#scroll-speed', '#scroll-bright'].forEach((id) => $(id).addEventListener('change', saveScroll));
$('#idle').oninput = () => { $('#idle-out').textContent = fmtIdle($('#idle').value); };
$('#idle').onchange = () => autosave('idle', () => api.mouseApply({ idle: +$('#idle').value }));
$('#lowbat').onchange = () => autosave('lowbat', () => api.mouseApply({ lowBattery: +$('#lowbat').value }));

// ----- cuffie ----------------------------------------------------------------
const hsEffect = chips($('#hs-effect'), (v) => { showFor($('#hs-light-controls'), v); saveHsLight(true); });
const hsSleep = chips($('#hs-sleep'), (v) => autosave('hs-sleep', () => api.headsetSleep(+v), 100));

function renderHeadset(s) {
  if (!online(s)) return;
  $('#headset-sub').textContent = [s.wired ? 'Via cavo' : 'Via ricevitore wireless', typeof s.battery === 'number' ? `batteria ${s.battery}%` : null].filter(Boolean).join(' · ');
  const charging = { charging: 'In carica', discharging: 'A batteria', full: 'Carica completa' }[s.charging] || '—';
  $('#headset-facts').innerHTML = `
    <dt>Batteria</dt><dd>${typeof s.battery === 'number' ? s.battery + '%' : '—'}</dd>
    <dt>Alimentazione</dt><dd>${charging}</dd>
    <dt>Microfono</dt><dd>${s.micMuted === undefined ? '—' : s.micMuted ? 'Disattivato (asta alzata)' : 'Attivo'}</dd>
    <dt>Firmware</dt><dd>${s.firmware || '—'}</dd>`;
  if (filled.headset) return;
  filled.headset = true;
  hsSleep.set(s.sleepMinutes !== undefined ? nearest([0, 5, 10, 15, 30, 60], s.sleepMinutes) : 10);
  const L = CFG.headset.lighting;
  $('#hs-leds').checked = !!CFG.headset.customLeds;
  hsEffect.set(L.effect);
  showFor($('#hs-light-controls'), L.effect);
  $('#hs-color').value = L.color;
  $('#hs-color2').value = L.color2;
  $('#hs-speed').value = L.speed;
  $('#hs-bright').value = L.brightness;
  $('#hs-status').value = L.status;
  $('#hs-status-color').value = L.statusColor;
  $('#hs-mic').value = L.mic;
  $('#hs-mic-color').value = L.micColor;
  $('#hs-wheel').checked = !!CFG.headset.wheelEq;
  showWhen($('#hs-light-controls'));
  dimLight();
  $$('#headset-body input[type=range]').forEach(paintRange);
}

function hsLighting() {
  return {
    effect: hsEffect.get() || 'static', color: $('#hs-color').value, color2: $('#hs-color2').value,
    speed: +$('#hs-speed').value, brightness: +$('#hs-bright').value,
    status: $('#hs-status').value, statusColor: $('#hs-status-color').value,
    mic: $('#hs-mic').value, micColor: $('#hs-mic-color').value,
  };
}
function dimLight() { $('#hs-light-controls').style.opacity = $('#hs-leds').checked ? '1' : '.45'; }
function saveHsLight(turnOn = false) {
  if (turnOn && !$('#hs-leds').checked) { $('#hs-leds').checked = true; dimLight(); }
  autosave('hs-light', () => api.headsetLighting({ enabled: $('#hs-leds').checked, lighting: hsLighting() }), 250);
}
$('#hs-leds').onchange = () => { dimLight(); saveHsLight(); };
['#hs-color', '#hs-color2', '#hs-speed', '#hs-bright', '#hs-status', '#hs-status-color', '#hs-mic', '#hs-mic-color'].forEach((id) => $(id).addEventListener('change', () => { showWhen($('#hs-light-controls')); saveHsLight(true); }));
$('#hs-wheel').onchange = () => autosave('hs-wheel', () => api.headsetLighting({ enabled: $('#hs-leds').checked, wheelEq: $('#hs-wheel').checked }), 100);

// ----- equalizzatore -----------------------------------------------------------
let eqGains = [], eqPreset = 'Piatto';
function renderEq(e) {
  $('#eq-missing').style.display = e.installed ? 'none' : '';
  $('#eq-panel').style.display = e.installed ? '' : 'none';
  $('#eq-on').disabled = !e.installed;
  if (!e.installed || filled.eq) return;
  filled.eq = true;
  eqGains = (e.gains || CFG.eq.gains || META.eqPresets.Piatto).slice();
  eqPreset = e.preset || CFG.eq.preset || 'Piatto';
  $('#eq-on').checked = !!e.enabled;
  drawEq();
}
function drawEq() {
  $('#eq-presets').innerHTML = Object.keys(META.eqPresets).map((p) => `<button data-v="${p}" class="${p === eqPreset ? 'on' : ''}">${p}</button>`).join('');
  const box = $('#eq-bands');
  box.innerHTML = '';
  META.eqBands.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'band';
    el.innerHTML = `<b>${fmtGain(eqGains[i])}</b><input type="range" min="-12" max="12" step="0.5" value="${eqGains[i]}"><span>${f >= 1000 ? f / 1000 + 'k' : f}</span>`;
    const r = $('input', el);
    paintRange(r);
    r.oninput = () => { eqGains[i] = +r.value; $('b', el).textContent = fmtGain(eqGains[i]); eqPreset = 'Personalizzato'; $$('#eq-presets button').forEach((x) => x.classList.remove('on')); };
    r.onchange = saveEq;
    box.appendChild(el);
  });
}
$('#eq-presets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  eqPreset = b.dataset.v; eqGains = META.eqPresets[eqPreset].slice();
  if (!$('#eq-on').checked) $('#eq-on').checked = true;
  drawEq(); saveEq();
});
function saveEq() { autosave('eq', () => api.eqApply({ enabled: $('#eq-on').checked, preset: eqPreset, gains: eqGains }), 200); }
$('#eq-on').onchange = saveEq;
$('#eq-download').onclick = (e) => { e.preventDefault(); api.openLink('https://sourceforge.net/projects/equalizerapo/'); };

// ----- tastiera --------------------------------------------------------------
let kbMode = null;
function renderKeyboard(s) {
  if (!online(s)) return;
  $('#keyboard-sub').textContent = [s.wired ? 'Via cavo USB-C' : 'Via ricevitore 2.4 GHz', typeof s.battery === 'number' ? `batteria ${s.battery}%` : null].filter(Boolean).join(' · ');
  $('#kb-clock').disabled = !s.wired;
  $('#kb-locks').style.display = s.wired ? '' : 'none';
  $('#kb-screen-apply').disabled = !s.wired || !screenFrames.length;
  if (!s.wired) $('#kb-file-info').textContent = 'Per lo schermo collega il cavo USB-C.';
  if (filled.keyboard) return;
  filled.keyboard = true;
  const L = CFG.keyboard.lighting;
  $('#kb-mode').innerHTML = META.modes.map((m, i) => `<button data-v="${i}">${m}</button>`).join('');
  kbMode = chips($('#kb-mode'), () => saveKbLight());
  kbMode.set(L.mode);
  $('#kb-color').value = L.color;
  $('#kb-multi').checked = !!L.multicolor;
  $('#kb-bright').value = L.brightness;
  $('#kb-speed').value = L.speed;
  $('#kb-dir').value = L.direction;
  const K = CFG.keyboard.settings;
  $('#kb-sleep').value = K.sleep;
  $('#kb-resp').value = K.responseLevel;
  $('#kb-game').checked = !!K.gameMode;
  $('#kb-win').checked = !!K.disableWin;
  $('#kb-alttab').checked = !!K.disableAltTab;
  $('#kb-altf4').checked = !!K.disableAltF4;
  $('#kb-fn').checked = !!K.fnSwitch;
  $$('#keyboard-body input[type=range]').forEach(paintRange);
}
function saveKbLight() {
  const cfg = { mode: +(kbMode.get() || 0), color: $('#kb-color').value, multicolor: $('#kb-multi').checked, brightness: +$('#kb-bright').value, speed: +$('#kb-speed').value, direction: +$('#kb-dir').value };
  autosave('kb-light', async () => { const r = await api.keyboardLighting(cfg); if (r && r.ok) CFG.keyboard.lighting = cfg; return r; });
}
['#kb-color', '#kb-multi', '#kb-bright', '#kb-speed', '#kb-dir'].forEach((id) => $(id).addEventListener('change', saveKbLight));
function saveKbSettings() {
  const cfg = { sleep: +$('#kb-sleep').value, responseLevel: +$('#kb-resp').value, gameMode: $('#kb-game').checked, fnSwitch: $('#kb-fn').checked, disableWin: $('#kb-win').checked, disableAltTab: $('#kb-alttab').checked, disableAltF4: $('#kb-altf4').checked };
  autosave('kb-set', async () => { const r = await api.keyboardSettings(cfg); if (r && r.ok) CFG.keyboard.settings = cfg; return r; });
}
['#kb-sleep', '#kb-resp', '#kb-game', '#kb-fn', '#kb-win', '#kb-alttab', '#kb-altf4'].forEach((id) => $(id).addEventListener('change', saveKbSettings));
$('#kb-clock').onclick = (e) => act(e.target, () => api.keyboardClock(), 'Ora sincronizzata');

// schermo
let screenFrames = [], screenAnim = null, screenFile = null;
async function decodeImage(file, fit) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const frames = [];
  const drawFit = (src, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 128, 128);
    let dw = 128, dh = 128;
    if (fit !== 'stretch') { const k = fit === 'fit' ? Math.min(128 / w, 128 / h) : Math.max(128 / w, 128 / h); dw = w * k; dh = h * k; }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, (128 - dw) / 2, (128 - dh) / 2, dw, dh);
    const rgba = ctx.getImageData(0, 0, 128, 128);
    return { rgba, rgb565: toRgb565(rgba.data) };
  };
  if ('ImageDecoder' in window && (file.type === 'image/gif' || file.type === 'image/webp')) {
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
    await dec.tracks.ready;
    const count = Math.min(255, dec.tracks.selectedTrack.frameCount || 1);
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      frames.push({ ...drawFit(image, image.displayWidth, image.displayHeight), delay: Math.round((image.duration || 100000) / 1000) });
      image.close();
    }
    dec.close();
  } else {
    const bmp = await createImageBitmap(file);
    frames.push({ ...drawFit(bmp, bmp.width, bmp.height), delay: 100 });
    bmp.close();
  }
  return frames;
}
function toRgb565(d) {
  const out = new Uint8Array(128 * 128 * 2);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 2) { const v = ((d[i] >> 3) << 11) | ((d[i + 1] >> 2) << 5) | (d[i + 2] >> 3); out[j] = v & 0xff; out[j + 1] = v >> 8; }
  return out;
}
function playPreview() {
  clearTimeout(screenAnim);
  const ctx = $('#kb-preview').getContext('2d');
  let i = 0;
  const step = () => {
    if (!screenFrames.length) return;
    ctx.putImageData(screenFrames[i].rgba, 0, 0);
    const d = Math.min(500, Math.max(30, screenFrames[i].delay));
    i = (i + 1) % screenFrames.length;
    if (screenFrames.length > 1) screenAnim = setTimeout(step, d);
  };
  step();
}
async function loadScreenFile() {
  if (!screenFile) return;
  try {
    $('#kb-file-info').textContent = 'Elaborazione…';
    screenFrames = await decodeImage(screenFile, $('#kb-fit').value);
    $('#kb-file-info').textContent = `${screenFile.name} · ${screenFrames.length} frame`;
    playPreview();
    $('#kb-screen-apply').disabled = !(S.keyboard && S.keyboard.wired);
  } catch (e) { screenFrames = []; $('#kb-file-info').textContent = ''; toast(`Immagine non leggibile: ${e.message}`, 'bad'); }
}
$('#kb-file').onchange = (e) => { screenFile = e.target.files[0]; loadScreenFile(); };
$('#kb-fit').onchange = loadScreenFile;
$('#kb-screen-apply').onclick = (e) => act(e.target, async () => {
  $('#kb-progress').style.width = '0%';
  const r = await api.keyboardScreen(screenFrames.map((f) => ({ rgb565: f.rgb565, delay: f.delay })));
  $('#kb-progress').style.width = r && r.ok ? '100%' : '0%';
  return r;
}, 'Immagine caricata sullo schermo');
api.onProgress((p) => { if (p.what === 'screen') $('#kb-progress').style.width = `${Math.round(p.p * 100)}%`; });

// ----- telefono ----------------------------------------------------------------
let phoneDevices = [], phoneTimer = null, phoneBusy = {}, phoneBattery = {}, phoneBatAt = 0;
async function loadPhones() {
  const r = await api.phoneList();
  phoneDevices = (r && r.devices) || [];
  if (Date.now() - phoneBatAt > 30000) {
    phoneBatAt = Date.now();
    for (const d of phoneDevices.filter((x) => x.state === 'device')) { const b = await api.phoneBattery(d.serial).catch(() => null); if (b) phoneBattery[d.serial] = b; }
  }
  const ready = phoneDevices.filter((d) => d.state === 'device');
  $('#dot-phone').className = `dot ${phoneDevices.some((d) => d.mirroring) ? 'on' : ready.length ? 'sleep' : ''}`;
  if (r && r.available === false) $('#phone-sub').textContent = 'scrcpy manca dalla cartella di Unico: riestrai lo zip completo.';
  renderPhones();
}
function phoneWatch(on) {
  clearInterval(phoneTimer);
  if (on) { loadPhones(); phoneTimer = setInterval(loadPhones, 3000); }
}
function renderPhones() {
  const box = $('#phone-list');
  $('#phone-empty').classList.toggle('show', !phoneDevices.length);
  box.innerHTML = phoneDevices.map((d, i) => {
    const conn = d.wifi ? 'Wi-Fi' : 'USB';
    let status, buttons = '';
    if (d.state === 'unauthorized') status = 'Sul telefono conferma <b>Consenti debug USB</b>';
    else if (d.state !== 'device') status = 'Non disponibile, riprova tra poco';
    else {
      status = d.mirroring ? 'Mirroring attivo: la finestra del telefono è aperta' : `Pronto · ${conn}`;
      buttons = d.mirroring
        ? `<button class="btn ghost" data-act="stop" data-i="${i}">Ferma</button>`
        : `<button class="btn primary" data-act="start" data-i="${i}">Avvia mirroring</button>`;
      if (!d.wifi) buttons += `<button class="btn ghost" data-act="wifi" data-i="${i}">Passa a Wi-Fi</button>`;
      else buttons += `<button class="btn ghost" data-act="disc" data-i="${i}">Scollega</button>`;
      buttons += `</div><div class="phone-extra"><button class="btn ghost small" data-act="push" data-i="${i}">Invia file</button><button class="btn ghost small" data-act="photos" data-i="${i}">Importa ultime foto</button>`;
      const b = phoneBattery[d.serial];
      if (b) status += ` · <span class="phone-bat">batteria ${b.percent}%${b.charging ? ' in carica' : ''}${b.temp ? ` · ${Math.round(b.temp)} °C` : ''}</span>`;
    }
    return `<div class="phone glass refract ${d.mirroring ? 'live' : ''}" data-drop="${i}"><div class="phone-art"></div><div class="phone-info"><h3>${esc(d.model)}</h3><span class="muted">${status}</span><div class="row">${buttons}</div></div></div>`;
  }).join('');
  $$('[data-drop]', box).forEach((card) => {
    const d = phoneDevices[+card.dataset.drop];
    card.ondragover = (e) => { e.preventDefault(); card.classList.add('drop'); };
    card.ondragleave = () => card.classList.remove('drop');
    card.ondrop = (e) => {
      e.preventDefault(); card.classList.remove('drop');
      const files = Array.from(e.dataTransfer.files).map((f) => api.filePath(f)).filter(Boolean);
      if (files.length) act(null, () => api.phonePush({ serial: d.serial, files }), `${files.length} file inviati al telefono`);
    };
  });
  $$('[data-act]', box).forEach((b) => b.onclick = async () => {
    const d = phoneDevices[+b.dataset.i];
    if (!d || phoneBusy[d.serial]) return;
    phoneBusy[d.serial] = true;
    b.disabled = true;
    try {
      if (b.dataset.act === 'start') { const r = await act(null, () => api.phoneStart({ serial: d.serial, model: d.model, opts: phoneOpts() }), 'Mirroring avviato'); if (r && r.recording) toast('Registrazione in corso nella cartella Video'); }
      if (b.dataset.act === 'stop') await api.phoneStop(d.serial);
      if (b.dataset.act === 'wifi') { toast('Passaggio al Wi-Fi…'); await act(null, () => api.phoneWifi(d.serial), 'Collegato in Wi-Fi: ora puoi staccare il cavo'); }
      if (b.dataset.act === 'disc') await api.phoneDisconnect(d.serial);
      if (b.dataset.act === 'push') await act(null, () => api.phonePush({ serial: d.serial }).then((r) => { if (r && r.sent) toast(`${r.sent} file inviati nella cartella Download del telefono`); return r; }));
      if (b.dataset.act === 'photos') await act(null, () => api.phoneImport({ serial: d.serial, count: 30 }).then((r) => { if (r && r.ok) toast(`${r.copied} foto copiate in Immagini\\Telefono`); return r; }));
    } finally { phoneBusy[d.serial] = false; loadPhones(); }
  });
}
api.onPhone((e) => { if (e.error) toast(e.error, 'bad'); loadPhones(); });

const phSize = chips($('#ph-size'), () => savePhone());
const phBitrate = chips($('#ph-bitrate'), () => savePhone());
const phFps = chips($('#ph-fps'), () => savePhone());
const PH_SWITCHES = { audio: '#ph-audio', control: '#ph-control', realKeyboard: '#ph-keyboard', turnScreenOff: '#ph-screenoff', stayAwake: '#ph-awake', alwaysOnTop: '#ph-top', fullscreen: '#ph-full', record: '#ph-record' };
function phoneOpts() {
  const o = { maxSize: +phSize.get(), bitrate: +phBitrate.get(), maxFps: +phFps.get() };
  for (const [k, id] of Object.entries(PH_SWITCHES)) o[k] = $(id).checked;
  return o;
}
function fillPhone() {
  const P = CFG.phone;
  phSize.set(P.maxSize); phBitrate.set(P.bitrate); phFps.set(P.maxFps);
  for (const [k, id] of Object.entries(PH_SWITCHES)) $(id).checked = !!P[k];
  syncPhoneSwitches();
}
function syncPhoneSwitches() {
  const ctl = $('#ph-control').checked;
  ['#ph-keyboard', '#ph-screenoff', '#ph-awake'].forEach((id) => { $(id).closest('label').style.opacity = ctl ? '1' : '.45'; $(id).disabled = !ctl; });
}
function savePhone() {
  syncPhoneSwitches();
  autosave('phone', async () => { const r = await api.saveSettings({ phone: phoneOpts() }); CFG = r.settings; return r; }, 150);
}
Object.values(PH_SWITCHES).forEach((id) => $(id).addEventListener('change', savePhone));
$$('[data-phone-tab]').forEach((a) => a.onclick = (e) => { e.preventDefault(); $(`[data-tabs="phone"] button[data-tab="${a.dataset.phoneTab}"]`).click(); });
$('#ph-pair').onclick = (e) => act(e.target, () => api.phonePair({ address: $('#ph-pair-addr').value.trim(), code: $('#ph-pair-code').value.trim() }), 'Associato: ora inserisci l\'indirizzo del telefono e premi Connetti');
$('#ph-connect').onclick = (e) => act(e.target, async () => { const r = await api.phoneConnect($('#ph-conn-addr').value.trim()); if (r && r.ok) { $('[data-tabs="phone"] button[data-tab="mirror"]').click(); loadPhones(); } return r; }, 'Telefono collegato in Wi-Fi');

// ----- impostazioni ------------------------------------------------------------
function applyLook() {
  document.body.classList.toggle('mica', CFG.appearance.background === 'mica' && META.micaSupported);
}
$('#set-bg').onchange = async () => { const r = await api.saveSettings({ appearance: { background: $('#set-bg').value } }); CFG = r.settings; applyLook(); status('saved'); };
$('#set-theme').onchange = async () => { const r = await api.saveSettings({ appearance: { theme: $('#set-theme').value } }); CFG = r.settings; status('saved'); };
$('#set-start').onchange = async () => { const r = await api.saveSettings({ startWithWindows: $('#set-start').checked }); CFG = r.settings; status('saved'); };
$('#set-notify').onchange = async () => { const r = await api.saveSettings({ notifyBelow: +$('#set-notify').value }); CFG = r.settings; status('saved'); };
$('#diag-copy').onclick = (e) => act(e.target, () => api.diagCopy(), 'Diagnostica copiata: incollala a Claude');
$('#diag-log').onclick = () => api.openLog();
async function loadDiag() {
  const list = await api.diagDevices();
  const rows = Array.isArray(list) ? list : [];
  $('#diag tbody').innerHTML = rows.length
    ? rows.map((d) => `<tr><td>${d.id}</td><td>${esc(d.product)}</td><td>${d.usage}</td><td>${d.interface}</td></tr>`).join('')
    : '<tr><td colspan="4">Nessun dispositivo Razer, Corsair o AULA trovato</td></tr>';
}

// ----- utilità -----------------------------------------------------------------
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) / 50) * 50 || lo));
const nearest = (list, v) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const fmtIdle = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ' ' + (s % 60) + ' s' : ''}`);
const fmtGain = (g) => `${g > 0 ? '+' : ''}${g}`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ----- avvio -------------------------------------------------------------------
(async () => {
  const r = await api.getState();
  S = r.state; CFG = r.settings; META = r.meta;
  $('#version').textContent = `Versione ${META.version}`;
  $('#set-start').checked = !!CFG.startWithWindows;
  $('#set-notify').value = String(CFG.notifyBelow);
  $('#set-bg').value = CFG.appearance.background;
  $('#set-theme').value = CFG.appearance.theme;
  if (!META.micaSupported) $('#set-bg option[value=mica]').textContent = 'Mica (richiede Windows 11)';
  applyLook();
  fillPhone();
  loadPhones();
  render();
  window.__unicoReady = true;
  if (typeof extraInit === 'function') extraInit();
  api.onState((s) => { S = s; render(); });
})();
