'use strict';
// Opzioni delle batterie (pannello dall'icona, anelli sul bordo, avviso di accensione).
(async function batteriesInit() {
  const map = { '#bat-click': 'trayClick', '#bat-edge': 'edge', '#bat-side': 'edgeSide', '#bat-pos': 'edgePos', '#bat-notice': 'notice' };
  const checks = { '#bat-sound': 'sound', '#bat-bt': 'bluetooth', '#bat-phone': 'phone' };
  const fill = (b) => {
    for (const [id, k] of Object.entries(map)) $(id).value = b[k];
    for (const [id, k] of Object.entries(checks)) $(id).checked = !!b[k];
  };
  const save = async (patch) => {
    const r = await api.batteriesSettings(patch);
    if (r && r.ok) { fill(r.settings); toast('Salvato'); }
  };
  for (const [id, k] of Object.entries(map)) $(id).addEventListener('change', () => save({ [k]: $(id).value }));
  for (const [id, k] of Object.entries(checks)) $(id).addEventListener('change', () => save({ [k]: $(id).checked }));
  $('#bat-test').onclick = () => api.batteriesTestEdge();
  $('#bat-panel').onclick = () => api.batteriesPanel();
  const p = await api.batteriesGet();
  fill(p.settings);
})();
