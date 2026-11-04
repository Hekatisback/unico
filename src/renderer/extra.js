'use strict';
// Sezioni aggiunte nella 2.0: home (profili, azioni rapide, musica, luminosità), Sistema, profili e avvisi.
// Usa le funzioni comuni definite in app.js ($, api, chips, autosave, toast, act...).

// =============================================================================
// Finestra di conferma
// =============================================================================
function confirmBox(title, text, { yes = 'Conferma', extra = '' } = {}) {
  return new Promise((resolve) => {
    const m = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    $('#modal-extra').innerHTML = extra;
    $('#modal-yes').textContent = yes;
    m.classList.add('show');
    const done = (v) => { m.classList.remove('show'); $('#modal-yes').onclick = $('#modal-no').onclick = null; resolve(v); };
    $('#modal-yes').onclick = () => done(true);
    $('#modal-no').onclick = () => done(false);
    m.onclick = (e) => { if (e.target === m) done(false); };
  });
}

const fmtBytes = (b) => {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};
const fmtRate = (b) => (b == null ? '—' : `${fmtBytes(b)}/s`);
const fmtUptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} g ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };

// =============================================================================
// Home: profili, azioni rapide, musica, luminosità
// =============================================================================
const profileChips = chips($('#profiles'), (id) => act(null, () => api.profileActivate(id), `Profilo ${CFG.profiles[id].name} attivo`));

function extraRender() {
  if (!CFG) return;
  const ids = Object.keys(CFG.profiles);
  if ($('#profiles').children.length !== ids.length) $('#profiles').innerHTML = ids.map((id) => `<button data-v="${id}">${esc(CFG.profiles[id].name)}</button>`).join('');
  profileChips.set(S.activeProfile || '');
  const auto = CFG.autoProfile && CFG.autoProfile.enabled;
  $('#profile-note').textContent = auto ? 'Un clic cambia energia, EQ, luci e overlay. "Gioco" parte da solo quando apri un gioco.' : 'Un clic cambia energia, EQ, luci e overlay insieme.';
  $('#qa-overlay').classList.toggle('on', !!S.overlay);
  $('#ov-on').checked = !!S.overlay;
  const sd = S.shutdownAt;
  $('#qa-shutdown').classList.toggle('on', !!sd);
  $('#qa-shutdown-label').textContent = sd ? `Spegnimento ${new Date(sd).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : 'Spegni tra…';
}

$('#qa-lock').onclick = () => act(null, () => api.sysLock());
$('#qa-sleep').onclick = async () => { if (await confirmBox('Sospendere il PC?', 'Il PC va in sospensione adesso. Si riattiva premendo un tasto o il pulsante di accensione.', { yes: 'Sospendi' })) act(null, () => api.sysSuspend()); };
$('#qa-overlay').onclick = () => act(null, () => api.overlaySet({ enabled: !S.overlay }), S.overlay ? 'Overlay nascosto' : 'Overlay attivo: Ctrl+Maiusc+O per nasconderlo');
$('#qa-shutdown').onclick = async () => {
  if (S.shutdownAt) {
    if (await confirmBox('Annullare lo spegnimento?', `È programmato per le ${new Date(S.shutdownAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.`, { yes: 'Annulla spegnimento' })) act(null, () => api.sysShutdownCancel(), 'Spegnimento annullato');
    return;
  }
  let pick = 60;
  const extra = '<div class="chips" id="sd-chips"><button data-v="15">15 min</button><button data-v="30">30 min</button><button data-v="60" class="on">1 ora</button><button data-v="120">2 ore</button><button data-v="180">3 ore</button></div>';
  const p = confirmBox('Spegnere il PC più tardi?', 'Windows ti avviserà prima di spegnersi. Puoi annullare quando vuoi da qui.', { yes: 'Programma', extra });
  chips($('#sd-chips'), (v) => { pick = +v; });
  if (await p) act(null, () => api.sysShutdownIn(pick), `Il PC si spegnerà tra ${pick >= 60 ? pick / 60 + (pick === 60 ? ' ora' : ' ore') : pick + ' minuti'}`);
};

// musica
let mediaTimer = null;
async function loadMedia() {
  if (document.hidden) return;
  const m = await api.sysMedia().catch(() => null);
  const card = $('#media-card');
  card.classList.toggle('idle', !m || !m.title);
  $('#media-title').textContent = m && m.title ? m.title : 'Niente in riproduzione';
  $('#media-artist').textContent = m ? [m.artist, m.album].filter(Boolean).join(' · ') : 'Avvia Spotify, YouTube o un altro lettore';
  $('#media-app').textContent = m && m.app ? m.app.replace(/\.exe$/i, '').replace(/^.*[!\\]/, '') : 'Musica';
  $('#media-cover').style.backgroundImage = m && m.thumb ? `url("${m.thumb}")` : '';
  $('#media-play').innerHTML = m && m.playing
    ? '<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>';
}
$$('[data-media]').forEach((b) => b.onclick = async () => { await api.sysMediaKey(b.dataset.media); setTimeout(loadMedia, 400); });

// luminosità
async function loadBrightness() {
  const list = await api.sysBrightness().catch(() => []);
  const box = $('#brightness');
  if (!Array.isArray(list) || !list.length) { box.innerHTML = '<p class="muted">Nessuno schermo regolabile. Alcuni monitor esterni hanno il DDC/CI spento nel loro menu: attivalo e premi Aggiorna.</p>'; return; }
  box.innerHTML = list.map((m, i) => `<div class="bright-row"><span>${esc(m.name)}</span><input type="range" min="0" max="${m.max || 100}" value="${m.value}" data-i="${i}"><b>${m.value}%</b></div>`).join('');
  $$('input', box).forEach((r) => {
    paintRange(r);
    r.oninput = () => { r.nextElementSibling.textContent = `${r.value}%`; autosave(`br-${r.dataset.i}`, () => api.sysSetBrightness({ id: list[+r.dataset.i].id, value: +r.value }), 120); };
  });
}
$('#bright-reload').onclick = loadBrightness;

pageHooks.home = (on) => {
  clearInterval(mediaTimer);
  if (on) { loadMedia(); mediaTimer = setInterval(loadMedia, 3000); }
};

// =============================================================================
// Sistema
// =============================================================================
let sysTab = 'res', procTimer = null, procSort = 'cpu', procs = [], startupLoaded = false, cleanLoaded = false;

function spark(canvas, series, { max = 100, color = '#6d4dff', color2 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  const draw = (vals, col, fill) => {
    const pts = vals.map((v, i) => [i * (w / Math.max(1, 119)), h - 2 - (Math.min(max, Math.max(0, v || 0)) / max) * (h - 6)]);
    if (pts.length < 2) return;
    const off = w - pts[pts.length - 1][0];
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x + off, y) : c.moveTo(x + off, y)));
    c.strokeStyle = col; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
    if (fill) {
      c.lineTo(w, h); c.lineTo(pts[0][0] + off, h); c.closePath();
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
      c.fillStyle = g; c.fill();
    }
  };
  draw(series[0], color, true);
  if (series[1]) draw(series[1], color2 || '#19b6ff', false);
}

function renderStats(s) {
  if (!s || currentPage !== 'system') return;
  const h = s.history || [];
  const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#6d4dff';
  if (sysTab === 'res') {
    $('#r-cpu').textContent = `${s.cpu.total}%`;
    $('#r-cpu-sub').textContent = [s.cpu.model, s.cpuTemp != null ? `${Math.round(s.cpuTemp)} °C (sensore ACPI)` : 'Temperatura CPU: Windows la mostra solo come amministratore'].filter(Boolean).join(' · ');
    const cores = $('#r-cores');
    if (cores.children.length !== s.cpu.cores.length) { cores.style.gridTemplateColumns = `repeat(${s.cpu.cores.length}, 1fr)`; cores.innerHTML = s.cpu.cores.map(() => '<i></i>').join(''); }
    s.cpu.cores.forEach((v, i) => { cores.children[i].style.height = `${Math.max(6, v)}%`; });
    spark($('#sp-cpu'), [h.map((x) => x.cpu)], { color: accent });

    if (s.gpu) {
      $('#r-gpu').textContent = `${Math.round(s.gpu.util)}%`;
      $('#r-gpu-facts').innerHTML = `<dt>Temperatura</dt><dd>${s.gpu.temp != null ? Math.round(s.gpu.temp) + ' °C' : '—'}</dd><dt>VRAM</dt><dd>${s.gpu.memUsed != null ? (s.gpu.memUsed / 1024).toFixed(1) + ' / ' + (s.gpu.memTotal / 1024).toFixed(0) + ' GB' : '—'}</dd><dt>Consumo</dt><dd>${s.gpu.power != null ? Math.round(s.gpu.power) + ' W' : '—'}</dd><dt>Frequenza</dt><dd>${s.gpu.clock != null ? s.gpu.clock + ' MHz' : '—'}</dd>`;
      spark($('#sp-gpu'), [h.map((x) => x.gpu), h.map((x) => x.gpuTemp)], { color: '#19b867', color2: '#ff8a5c' });
    } else { $('#r-gpu').textContent = '—'; $('#r-gpu-facts').innerHTML = '<dt>GPU</dt><dd>NVIDIA non rilevata (o GPU in risparmio)</dd>'; }

    $('#r-ram').textContent = `${s.ram.pct}%`;
    $('#r-ram-sub').textContent = `${fmtBytes(s.ram.used)} usati su ${fmtBytes(s.ram.total)}`;
    spark($('#sp-ram'), [h.map((x) => x.ram)], { color: '#19b6ff' });

    if (s.net) {
      $('#r-net').textContent = `↓ ${fmtRate(s.net.rx)}`;
      $('#r-net-sub').textContent = `↑ ${fmtRate(s.net.tx)} in upload`;
      const peak = Math.max(1, ...h.map((x) => Math.max(x.rx || 0, x.tx || 0)));
      spark($('#sp-net'), [h.map((x) => x.rx), h.map((x) => x.tx)], { max: peak * 1.1, color: '#e8458b', color2: '#19b6ff' });
    }
    if (s.disk) {
      const used = 1 - s.disk.free / s.disk.total;
      $('#r-disk').textContent = `${fmtBytes(s.disk.free)} liberi`;
      $('#r-disk-bar').style.width = `${Math.round(used * 100)}%`;
      $('#r-disk-bar').classList.toggle('warn', s.disk.free < 20 * 1073741824);
      $('#r-disk-sub').textContent = `${fmtBytes(s.disk.total - s.disk.free)} usati su ${fmtBytes(s.disk.total)}${s.diskIo ? ` · lettura ${fmtRate(s.diskIo.read)}, scrittura ${fmtRate(s.diskIo.write)}` : ''}`;
    }
    $('#r-up').textContent = `Acceso da ${fmtUptime(s.uptime)}`;
    $('#r-pc-facts').innerHTML = `<dt>Batteria</dt><dd>${s.battery ? s.battery.percent + '%' + (s.battery.status === 2 ? ' · in carica' : '') : '—'}</dd><dt>Processore</dt><dd>${s.cpu.cores.length} thread${s.cpu.mhz ? ' · ' + s.cpu.mhz + ' MHz' : ''}</dd>`;
  }
}
api.onStats(renderStats);

async function loadProcs() {
  const r = await api.sysProcs().catch(() => null);
  if (Array.isArray(r)) procs = r;
  drawProcs();
}
function drawProcs() {
  const q = $('#proc-search').value.trim().toLowerCase();
  const list = procs.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q))
    .sort((a, b) => (procSort === 'name' ? a.name.localeCompare(b.name) : (b[procSort] || 0) - (a[procSort] || 0))).slice(0, 80);
  $$('table.procs th').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === procSort));
  const heat = (v, a, b) => (v >= b ? 'heat-2' : v >= a ? 'heat-1' : '');
  $('#proc-body').innerHTML = list.map((p) => `<tr>
    <td><div class="pn"><span>${esc(p.desc || p.name)}</span><small>${esc(p.name)}${p.pids.length > 1 ? ` · ${p.pids.length} processi` : ''}</small></div></td>
    <td class="num ${heat(p.cpu, 10, 30)}">${p.cpu.toFixed(1)}%</td>
    <td class="num ${heat(p.mem / 1048576, 800, 2000)}">${fmtBytes(p.mem)}</td>
    <td class="num">${p.io ? fmtRate(p.io) : '—'}</td>
    <td class="num">${p.protected ? '<span class="muted">protetto</span>' : `<button class="btn ghost small" data-kill="${esc(p.name)}">Chiudi</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nessun processo</td></tr>';
  $$('[data-kill]').forEach((b) => b.onclick = async () => {
    const p = procs.find((x) => x.name === b.dataset.kill);
    if (!p) return;
    if (await confirmBox(`Chiudere ${p.desc || p.name}?`, `Verranno chiusi ${p.pids.length} processi. Il lavoro non salvato in quell'app andrà perso.`, { yes: 'Chiudi' })) {
      await act(null, () => api.sysKill({ pids: p.pids, name: p.name }), `${p.desc || p.name} chiuso`);
      setTimeout(loadProcs, 800);
    }
  });
}
$('#proc-search').oninput = drawProcs;
$$('table.procs th[data-sort]').forEach((th) => th.onclick = () => { procSort = th.dataset.sort; drawProcs(); });

async function loadStartup() {
  const list = await api.sysStartup().catch(() => []);
  const box = $('#startup-list');
  if (!Array.isArray(list) || !list.length) { box.innerHTML = '<p class="muted">Nessuna app all\'avvio trovata.</p>'; return; }
  box.innerHTML = list.map((it, i) => `<div class="startup-item"><div class="si"><b>${esc(it.name)}</b><small>${esc(it.command)}</small></div><span class="chip">${it.scope}</span>
    <label class="switch" title="${it.editable ? '' : 'Serve l\'amministratore'}"><input type="checkbox" data-st="${i}" ${it.enabled ? 'checked' : ''} ${it.editable ? '' : 'disabled'}><span></span></label></div>`).join('');
  $$('[data-st]', box).forEach((c) => c.onchange = async () => {
    const it = list[+c.dataset.st];
    const r = await act(null, () => api.sysStartupSet({ item: it, enabled: c.checked }), `${it.name}: ${c.checked ? 'parte con Windows' : 'non parte più all\'avvio'}`);
    if (!r || r.ok === false) c.checked = !c.checked;
  });
}

async function loadClean() {
  ['#c-temp', '#c-bin', '#c-dl'].forEach((id) => { $(id).textContent = 'Analisi…'; });
  $('#c-big').innerHTML = '<p class="muted">Analisi della cartella Download…</p>';
  const r = await api.sysCleanupScan().catch((e) => ({ error: e.message }));
  if (!r || r.error || r.ok === false) { $('#c-big').innerHTML = `<p class="muted">Analisi non riuscita${r && r.error ? ': ' + esc(r.error) : ''}</p>`; return; }
  $('#c-temp').textContent = fmtBytes((r.temp || 0) + (r.crash || 0));
  $('#c-bin').textContent = fmtBytes(r.recycle ? r.recycle.bytes : 0);
  $('#c-bin-sub').textContent = r.recycle ? `${r.recycle.count} elementi. Svuotarlo li elimina per sempre.` : '';
  $('#c-dl').textContent = fmtBytes(r.downloads);
  const big = r.big || [];
  $('#c-big').innerHTML = big.length ? big.map((f, i) => `<div class="bf"><div class="bn"><b>${esc(f.name)}</b><small>${new Date(f.modified).toLocaleDateString('it-IT')}</small></div><span class="size">${fmtBytes(f.bytes)}</span>
    <div class="row"><button class="btn ghost small" data-show="${i}">Apri cartella</button><button class="btn ghost small" data-trash="${i}">Sposta nel Cestino</button></div></div>`).join('') : '<p class="muted">Nessun file sopra i 100 MB nei Download.</p>';
  $$('[data-show]', $('#c-big')).forEach((b) => b.onclick = () => api.sysShowFile(big[+b.dataset.show].path));
  $$('[data-trash]', $('#c-big')).forEach((b) => b.onclick = async () => {
    const f = big[+b.dataset.trash];
    const res = await act(b, () => api.sysTrash(f.path), `${f.name} spostato nel Cestino`);
    if (res && res.ok) b.closest('.bf').remove();
  });
  cleanLoaded = true;
}
$('#c-scan').onclick = loadClean;
$('#c-temp-btn').onclick = async (e) => {
  if (!(await confirmBox('Pulire i file temporanei?', 'Vengono eliminati i file temporanei e i crash dump più vecchi di 2 giorni. Windows e i programmi li ricreano se servono.', { yes: 'Pulisci' }))) return;
  const r = await act(e.target, () => api.sysClearTemp());
  if (r && r.freed != null) toast(`Liberati ${fmtBytes(r.freed)}`);
  loadClean();
};
$('#c-bin-btn').onclick = async (e) => {
  if (!(await confirmBox('Svuotare il Cestino?', 'I file nel Cestino verranno eliminati definitivamente e non si potranno più recuperare.', { yes: 'Svuota' }))) return;
  await act(e.target, () => api.sysEmptyRecycle(), 'Cestino svuotato');
  loadClean();
};

$('#net-run').onclick = async (e) => {
  $('#net-results').innerHTML = ['Router di casa', 'Internet', 'Server di gioco'].map((l) => `<div class="net-item"><span class="muted">${l}</span><b>…</b><span class="muted">misurazione</span></div>`).join('');
  $('#net-verdict').textContent = '';
  const r = await act(e.target, () => api.sysNetwork($('#net-game').value));
  if (!r || !r.results) return;
  $('#net-results').innerHTML = r.results.map((x) => {
    const cls = x.avg == null ? 'bad' : x.avg < 30 ? 'good' : x.avg < 80 ? 'mid' : 'bad';
    return `<div class="net-item ${cls}"><span class="muted">${esc(x.label)}</span><b>${x.avg == null ? 'Nessuna risposta' : x.avg + ' ms'}</b><span class="muted">${esc(x.host)} · picco ${x.max ?? '—'} ms · persi ${x.loss ?? 100}%</span></div>`;
  }).join('');
  $('#net-verdict').textContent = r.verdict;
};

const ovCorner = chips($('#ov-corner'), (v) => act(null, () => api.overlaySet({ corner: v }), 'Overlay spostato'));
$('#ov-on').onchange = () => act(null, () => api.overlaySet({ enabled: $('#ov-on').checked }));
api.onOverlay((o) => { S.overlay = o.enabled; ovCorner.set(o.corner); extraRender(); });

function enterSystemTab(tab) {
  sysTab = tab;
  clearInterval(procTimer);
  if (tab === 'procs') { loadProcs(); procTimer = setInterval(loadProcs, 3000); }
  if (tab === 'startup' && !startupLoaded) { startupLoaded = true; loadStartup(); }
  if (tab === 'clean' && !cleanLoaded) loadClean();
}
tabHooks.system = enterSystemTab;
pageHooks.system = async (on) => {
  if (!on) { clearInterval(procTimer); api.sysWatch(false); return; }
  const r = await api.sysWatch(true);
  enterSystemTab(tabs.system.get() || 'res');
  if (r && r.last) renderStats({ ...r.last, history: r.history });
};

// =============================================================================
// Impostazioni: avvisi e profili
// =============================================================================
tabHooks.settings = (t) => { if (t === 'diag') loadDiag(); };
$$('[data-settings-tab]').forEach((a) => a.onclick = (e) => {
  e.preventDefault(); e.stopPropagation();
  go('settings');
  setTimeout(() => $(`[data-tabs="settings"] button[data-tab="${a.dataset.settingsTab}"]`).click(), 50);
});

function saveSetting(patch, key = 'settings') {
  autosave(key, async () => { const r = await api.saveSettings(patch); CFG = r.settings; extraRender(); return r; }, 250);
}

function fillAlerts() {
  const A = CFG.alerts;
  $('#al-on').checked = !!A.enabled;
  $('#al-gpu').value = String(A.gpuTemp);
  $('#al-ram').value = String(A.ram);
  $('#al-disk').value = String(A.diskGB);
}
['#al-on', '#al-gpu', '#al-ram', '#al-disk'].forEach((id) => $(id).addEventListener('change', () => saveSetting({ alerts: { enabled: $('#al-on').checked, gpuTemp: +$('#al-gpu').value, ram: +$('#al-ram').value, diskGB: +$('#al-disk').value } }, 'alerts')));

function fillProfiles() {
  $('#auto-on').checked = !!CFG.autoProfile.enabled;
  $('#auto-games').value = CFG.autoProfile.games.join(', ');
  const opt = (pairs, v) => pairs.map(([val, label]) => `<option value="${val}" ${String(v) === String(val) ? 'selected' : ''}>${label}</option>`).join('');
  const keep = ['', 'Non cambiare'];
  const stages = (S.mouse && S.mouse.stages) || [800, 1600, 3200];
  $('#profile-editor').innerHTML = Object.entries(CFG.profiles).map(([id, p]) => `<div class="card glass" data-profile="${id}">
    <h3>${esc(p.name)}</h3>
    <label class="field">Modalità energia <select data-k="power">${opt([keep, ['best', 'Prestazioni ottimali'], ['balanced', 'Bilanciata'], ['efficiency', 'Risparmio energia']], p.power || '')}</select></label>
    <label class="field">DPI del mouse <select data-k="dpi">${opt([keep, ...stages.map((d) => [d, d + ' DPI'])], p.dpi || '')}</select></label>
    <label class="field">Equalizzatore <select data-k="eqPreset">${opt([keep, ...Object.keys(META.eqPresets).map((n) => [n, n])], p.eqPreset || '')}</select></label>
    <label class="field">Luci tastiera <select data-k="kbMode">${opt([keep, ...META.modes.map((m, i) => [i, m])], p.kbMode == null ? '' : p.kbMode)}</select></label>
    <label class="field">Luminosità tastiera <select data-k="kbBrightness">${opt([keep, [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], p.kbBrightness == null ? '' : p.kbBrightness)}</select></label>
    <label class="field">Luci cuffie <select data-k="headsetLight">${opt([keep, ['unico', 'Effetto di Unico'], ['off', 'Spente'], ['factory', 'Arcobaleno di fabbrica']], p.headsetLight === 'on' ? 'unico' : (p.headsetLight || ''))}</select></label>
    <label class="field">Chiudi queste app (processi, separati da virgola) <input type="text" data-k="closeApps" value="${esc((p.closeApps || []).join(', '))}" placeholder="es. Discord, chrome"></label>
    <label class="switch inline"><input type="checkbox" data-k="overlay" ${p.overlay ? 'checked' : ''}><span></span>Mostra l'overlay</label>
  </div>`).join('');
  $$('[data-profile]').forEach((card) => $$('[data-k]', card).forEach((el) => el.addEventListener('change', () => {
    const id = card.dataset.profile;
    const val = {};
    $$('[data-k]', card).forEach((f) => {
      const k = f.dataset.k;
      if (k === 'overlay') val[k] = f.checked;
      else if (k === 'closeApps') val[k] = f.value.split(',').map((x) => x.trim()).filter(Boolean);
      else if (['dpi', 'kbMode', 'kbBrightness'].includes(k)) val[k] = f.value === '' ? null : +f.value;
      else val[k] = f.value || null;
    });
    if (val.headsetLight === 'unico') val.headsetLight = 'on';
    saveSetting({ profiles: { [id]: { ...CFG.profiles[id], ...val } } }, `profile-${id}`);
  })));
}
['#auto-on', '#auto-games'].forEach((id) => $(id).addEventListener('change', () => saveSetting({ autoProfile: { enabled: $('#auto-on').checked, games: $('#auto-games').value.split(',').map((x) => x.trim()).filter(Boolean) } }, 'auto')));

// =============================================================================
// Avvio
// =============================================================================
let extraStarted = false;
function extraInit() {
  if (extraStarted) return;
  extraStarted = true;
  fillAlerts();
  fillProfiles();
  ovCorner.set(CFG.overlay.corner);
  $('#system-sub').textContent = META.platform === 'win32' ? 'Risorse, processi, avvio, pulizia e rete' : 'Anteprima';
  extraRender();
  loadBrightness();
  pageHooks.home(true);
}

// se i dati sono arrivati prima che questo file fosse caricato
if (window.__unicoReady) extraInit();
