'use strict';
// Cuffie HS80: controllo e riparazione di audio e microfono (solo impostazioni di Windows).
(function headsetAudio() {
  const ok = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const bad = '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/></svg>';
  function render(r) {
    if (!r || !r.items) { $('#ha-list').innerHTML = `<li class="muted">${esc((r && r.error) || 'Controllo non riuscito')}</li>`; return; }
    $('#ha-list').innerHTML = r.items.map((i) => `<li class="${i.ok ? 'ok' : 'bad'}"><i>${i.ok ? ok : bad}</i><span><b>${esc(i.title)}</b><small>${esc(i.detail)}</small></span>${i.fix === 'privacy' ? '<button class="btn ghost small" data-privacy>Apri</button>' : ''}</li>`).join('');
    $('#ha-fix').disabled = !r.fixable;
    $('#ha-fix').textContent = r.ok ? 'Tutto a posto' : 'Sistema';
    const tab = document.querySelector('[data-tabs="audio"] button[data-tab="mic"]');
    if (tab) tab.classList.toggle('alert', !r.ok);
  }
  async function check() { render(await api.headsetAudioCheck().catch((e) => ({ error: e.message }))); }
  $('#ha-check').onclick = (e) => act(e.target, async () => { await check(); return { ok: true }; });
  $('#ha-fix').onclick = (e) => act(e.target, async () => {
    const r = await api.headsetAudioFix();
    render(r);
    const el = $('#au-mic'); if (el) el.dataset.ids = '';
    if (typeof loadAudio === 'function') loadAudio();
    return r && r.ok !== false ? { ok: true } : r;
  }, 'Sistemato');
  $('#ha-list').addEventListener('click', (e) => { if (e.target.closest('[data-privacy]')) api.headsetAudioPrivacy(); });
  // sidetone
  async function stLoad() {
    const r = await api.sidetoneGet().catch(() => null);
    if (!r) return;
    $('#st-on').checked = !!r.settings.enabled;
    $('#st-vol').value = r.settings.volume; $('#st-pct').textContent = `${r.settings.volume}%`;
    if (typeof paintRange === 'function') paintRange($('#st-vol'));
    stNote(r.state, r.settings.enabled, r.headsetOn);
  }
  function stNote(st, on, headsetOn) {
    $('#st-note').textContent = !on ? '' : headsetOn === false ? 'Si accende quando le cuffie sono accese e gestite da Unico (iCUE chiuso).'
      : st && st.on ? `Attivo${st.latencyMs ? ` · ritardo circa ${st.latencyMs} ms` : ''}.` : st && st.error ? `Non partito: ${st.error}` : 'Avvio…';
  }
  $('#st-on').addEventListener('change', async () => { const r = await api.sidetoneSet({ enabled: $('#st-on').checked }); stNote(r.state, r.settings.enabled); setTimeout(stLoad, 1500); });
  let stT = null;
  $('#st-vol').addEventListener('input', () => { $('#st-pct').textContent = `${$('#st-vol').value}%`; clearTimeout(stT); stT = setTimeout(() => api.sidetoneSet({ volume: +$('#st-vol').value }), 120); });
  api.on('sidetoneState', (st) => stNote(st, $('#st-on').checked));
  const prevPage = pageHooks.audio;
  pageHooks.audio = (on, ...a) => { if (prevPage) prevPage(on, ...a); if (on) { check(); stLoad(); } };
  const prev = tabHooks.audio;
  tabHooks.audio = (...a) => { if (prev) prev(...a); check(); };
  api.on('goto', (where) => {
    const [page, tab] = String(where).split(':');
    go(page);
    if (tab) setTimeout(() => { const b = document.querySelector(`[data-tabs="${page}"] button[data-tab="${tab}"]`); if (b) b.click(); }, 200);
  });
})();
