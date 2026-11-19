'use strict';
// Opzioni → Controllo dal telefono
(function remoteInit() {
  let pinTimer = null;
  function draw(i) {
    if (!i) return;
    $('#rm-on').checked = !!i.enabled;
    $('#rm-body').style.display = i.enabled ? '' : 'none';
    $('#rm-addr').textContent = i.addresses && i.addresses.length ? i.addresses.join('  oppure  ') : 'il PC non è collegato a una rete locale';
    const n = (i.devices || []).length;
    $('#rm-devs').textContent = n ? `Telefoni abbinati: ${i.devices.map((d) => d.name).join(', ')}` : 'Nessun telefono abbinato.';
    $('#rm-forget').style.display = n ? '' : 'none';
    if (i.error) toast(`Controllo dal telefono: ${i.error}`, 'bad');
    showPin(i.pin);
  }
  function showPin(p) {
    clearInterval(pinTimer);
    if (!p) { $('#rm-code').textContent = ''; $('#rm-left').textContent = ''; return; }
    $('#rm-code').textContent = p.code.replace(/(\d{3})(\d{3})/, '$1 $2');
    const tick = () => {
      const s = Math.round((p.until - Date.now()) / 1000);
      if (s <= 0) { showPin(null); return; }
      $('#rm-left').textContent = `vale ancora ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    tick(); pinTimer = setInterval(tick, 1000);
  }
  $('#rm-on').addEventListener('change', async () => draw(await api.remoteSet({ enabled: $('#rm-on').checked })));
  $('#rm-pin').onclick = async () => { const r = await api.remotePin(); if (r && r.ok) { showPin(r); setTimeout(async () => draw(await api.remoteInfo()), 0); } else toast((r && r.error) || 'Non riuscito', 'bad'); };
  $('#rm-forget').onclick = async () => { if (await confirmBox('Scollegare tutti i telefoni?', 'Dovrai abbinarli di nuovo con un codice.', { yes: 'Scollega' })) draw(await api.remoteForget()); };
  api.on('remote', draw);
  api.remoteInfo().then(draw);
  // aggiorna la lista dei telefoni dopo l'abbinamento
  setInterval(async () => { if ($('#rm-code').textContent) draw(await api.remoteInfo()); }, 3000);
})();
