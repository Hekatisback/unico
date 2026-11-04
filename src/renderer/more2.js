'use strict';
// Sezioni 2.6: luci di tutte le periferiche, luci automatiche, avviso a schermo, FPS, cache shader,
// chiamate e cartella condivisa del telefono, profili per gioco, finestra compatta.

// --- Luci di tutte le periferiche ---------------------------------------------------------
const lsEffect = chips($('#ls-effect'), () => {});
$('#ls-apply').onclick = (e) => {
  const effect = lsEffect.get() || 'static';
  const color = $('#ls-color').value;
  act(e.target, async () => {
    const r = await api.lightsSync({ effect, color });
    if (r && r.ok && r.partial && r.partial.length) toast(`Fatto, ma non su: ${r.partial.map((x) => x.split(':')[0]).join(', ')}`);
    else if (r && r.ok) toast('Luci aggiornate su tutte le periferiche');
    return r && r.ok ? { ok: true } : r;
  });
};

// --- Opzioni: luci automatiche, avviso, Wallpaper Engine -------------------------------------
function saveLightsAuto() {
  saveSetting({ lightsAuto: { idle: $('#la-idle').checked, idleMin: +$('#la-min').value, night: $('#la-night').checked, from: $('#la-from').value || '23:00', to: $('#la-to').value || '07:00' } }, 'lights-auto');
}
['#la-idle', '#la-min', '#la-night', '#la-from', '#la-to'].forEach((id) => $(id).addEventListener('change', saveLightsAuto));
$('#osd-on').addEventListener('change', () => saveSetting({ osd: { enabled: $('#osd-on').checked } }, 'osd'));
$('#we-pause').addEventListener('change', () => saveSetting({ wallpaperPause: $('#we-pause').checked }, 'we'));
$('#osd-test').onclick = () => api.osdTest();

// --- FPS nell'overlay ---------------------------------------------------------------------
async function fpsNote() {
  const st = await api.fpsStatus().catch(() => null);
  if (!st) return;
  const on = $('#ov-fps').checked;
  $('#ov-fps-note').textContent = !on ? 'Gli FPS compaiono nell\'overlay quando apri un gioco riconosciuto.'
    : !st.available ? 'PresentMon non è incluso in questa versione.'
      : st.status === 'admin' ? 'Windows non permette di leggere gli FPS senza permessi: aggiungi il tuo utente al gruppo "Performance Log Users" (Gestione computer → Utenti e gruppi locali → Gruppi) e riavvia il PC. Oppure avvia Unico come amministratore.'
        : st.status === 'on' ? `In funzione su ${st.game}.`
          : st.status === 'error' ? `Non riuscito: ${st.error}` : 'Pronto: si attiva quando apri un gioco riconosciuto.';
}
$('#ov-fps').addEventListener('change', async () => { await act(null, () => api.overlaySet({ fps: $('#ov-fps').checked })); CFG.overlay.fps = $('#ov-fps').checked; fpsNote(); });

// --- Cache shader ----------------------------------------------------------------------------
async function shaderScan() {
  const r = await api.shaderScan().catch(() => null);
  if (!r) return;
  $('#c-shader').textContent = fmtBytes(r.total);
  $('#c-shader').dataset.items = JSON.stringify(r.items.map((x) => `${x.label}: ${fmtBytes(x.size)}`));
}
$('#c-shader-btn').onclick = async (e) => {
  const items = JSON.parse($('#c-shader').dataset.items || '[]');
  if (!(await confirmBox('Pulire la cache shader?', `${items.join(' · ') || 'Niente da pulire'}. I giochi la ricreano da soli: al primo avvio possono caricare un po' di più. I file in uso da un gioco aperto restano.`, { yes: 'Pulisci' }))) return;
  const r = await act(e.target, () => api.shaderClean());
  if (r && r.ok) { toast(`Liberati ${fmtBytes(r.freed)}${r.skipped ? ` (${r.skipped} file in uso lasciati)` : ''}`); shaderScan(); }
};
tabHooks.system = ((base) => (t) => { base(t); if (t === 'clean') shaderScan(); })(tabHooks.system);

// --- Telefono: chiamate e cartella condivisa ---------------------------------------------------
$('#pn-calls').addEventListener('change', () => { CFG.phoneNotif = { ...(CFG.phoneNotif || {}), calls: $('#pn-calls').checked }; saveSetting({ phoneNotif: CFG.phoneNotif }, 'pn'); });
function renderSync(st) {
  if (!st) return;
  $('#ps-state').textContent = st.error ? `Ultimo tentativo: ${st.error}` : st.last ? `Ultima sincronizzazione ${ago(st.last)}: ${st.pushed} inviati, ${st.pulled} ricevuti.` : '';
}
$('#ps-on').addEventListener('change', () => saveSetting({ phoneSync: { ...(CFG.phoneSync || {}), enabled: $('#ps-on').checked } }, 'ps'));
$('#ps-now').onclick = async (e) => renderSync(await act(e.target, () => api.phoneSyncNow()));
$('#ps-open').onclick = () => api.phoneSyncOpen();
api.on('phoneSync', renderSync);
tabHooks.phone = ((base) => async (t) => { await base(t); if (t === 'notif') renderSync(await api.phoneSyncState()); })(tabHooks.phone);

// --- Profili: nuovo profilo, nome, elimina, profilo per gioco -----------------------------------
const BUILTIN = ['gioco', 'lavoro', 'notte'];
function renderGameMap() {
  const games = CFG.autoProfile.games || [];
  const map = CFG.autoProfile.map || {};
  const opts = (sel) => Object.entries(CFG.profiles).map(([id, p]) => `<option value="${id}" ${sel === id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#game-map').innerHTML = games.length ? games.map((g) => `<label><span>${esc(g)}</span><select data-game="${esc(g)}"><option value="">Gioco</option>${opts(map[g])}</select></label>`).join('')
    : '<p class="muted">Aggiungi i giochi nel campo qui sopra.</p>';
}
$('#game-map').addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-game]');
  if (!sel) return;
  const map = { ...(CFG.autoProfile.map || {}) };
  if (sel.value) map[sel.dataset.game] = sel.value; else delete map[sel.dataset.game];
  CFG.autoProfile.map = map;
  autosave('map', async () => { const r = await api.setKey({ key: 'autoProfile.map', value: map }); if (r.settings) CFG = r.settings; return r; }, 150);
});
$('#profile-new').onclick = async () => {
  const id = `p${Date.now().toString(36)}`;
  const base = CFG.profiles.gioco || Object.values(CFG.profiles)[0];
  await api.saveSettings({ profiles: { [id]: { ...base, name: 'Nuovo profilo' } } });
  const r = await api.getState();
  CFG = r.settings;
  fillProfiles();
  extraRender();
  toast('Profilo creato: dagli un nome e scegli le impostazioni');
  const input = $(`[data-profile="${id}"] .profile-name`);
  if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.select(); }
};
// Nome modificabile ed eliminazione per i profili creati da te
const fillProfilesBase = fillProfiles;
fillProfiles = function fillProfilesPlus() {
  fillProfilesBase();
  $$('[data-profile]').forEach((card) => {
    const id = card.dataset.profile;
    if (BUILTIN.includes(id)) return;
    const h = $('h3', card);
    h.innerHTML = `<input class="profile-name" value="${esc(CFG.profiles[id].name)}"><button class="btn ghost small profile-del">Elimina</button>`;
    $('.profile-name', card).addEventListener('change', (e) => saveSetting({ profiles: { [id]: { ...CFG.profiles[id], name: e.target.value.trim() || 'Profilo' } } }, `profile-${id}`));
    $('.profile-del', card).onclick = async () => {
      if (!(await confirmBox(`Eliminare "${CFG.profiles[id].name}"?`, 'I giochi che lo usavano torneranno al profilo Gioco.', { yes: 'Elimina' }))) return;
      const profiles = { ...CFG.profiles };
      delete profiles[id];
      const map = Object.fromEntries(Object.entries(CFG.autoProfile.map || {}).filter(([, v]) => v !== id));
      await api.setKey({ key: 'autoProfile.map', value: map });
      await api.setKey({ key: 'profiles', value: profiles });
      if (CFG.activeProfile === id) await api.saveSettings({ activeProfile: null });
      const r = await api.getState();
      CFG = r.settings;
      fillProfiles();
      extraRender();
    };
  });
  renderGameMap();
};
$('#auto-games').addEventListener('change', () => setTimeout(renderGameMap, 400));

$('#app-quit').onclick = async () => { if (await confirmBox('Chiudere Unico?', 'Si chiude del tutto (anche dall\'icona vicino all\'orologio). Lo riapri dal menu Start.', { yes: 'Esci' })) api.quitApp(); };

// --- Finestra compatta -------------------------------------------------------------------------
$('#qa-mini').onclick = () => api.miniToggle();

// --- Avvio ---------------------------------------------------------------------------------------
function more2Init() {
  if (!CFG || !extraStarted) return setTimeout(more2Init, 150);
  const L = CFG.syncLights || {};
  lsEffect.set(L.effect || 'static');
  $('#ls-color').value = L.color || '#7c5cff';
  const A = CFG.lightsAuto || {};
  $('#la-idle').checked = !!A.idle;
  $('#la-min').value = String(A.idleMin || 10);
  $('#la-night').checked = !!A.night;
  $('#la-from').value = A.from || '23:00';
  $('#la-to').value = A.to || '07:00';
  $('#osd-on').checked = !(CFG.osd && CFG.osd.enabled === false);
  $('#we-pause').checked = CFG.wallpaperPause !== false;
  $('#ov-fps').checked = !!(CFG.overlay && CFG.overlay.fps);
  $('#pn-calls').checked = !(CFG.phoneNotif && CFG.phoneNotif.calls === false);
  $('#ps-on').checked = !!(CFG.phoneSync && CFG.phoneSync.enabled);
  fillProfiles();
  fpsNote();
}
more2Init();
