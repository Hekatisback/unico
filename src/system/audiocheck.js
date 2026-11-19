'use strict';
// Controllo audio e microfono delle HS80 senza iCUE. Tutto avviene in Windows (dispositivo predefinito,
// volume, silenziamento): alle cuffie non viene mandato nessun comando, quindi niente può bloccarle.

const isHs80 = (d) => /HS80/i.test((d && d.name) || '');
const guidOf = (id) => { const m = String(id || '').match(/\{[0-9a-f-]{36}\}$/i); return m ? m[0] : null; };

// render/capture: liste da audioDevices; extra: { apo: { id: bool }, privacy: { user, desktop, machine } }
// hw: stato letto dalle cuffie ({ connected, off, micMuted }); icue: { installed, running }
function analyze({ render = [], capture = [], extra = {}, hw = {}, icue = {} }) {
  const out = render.find(isHs80) || null;
  const mic = capture.find(isHs80) || null;
  const items = [];
  const add = (key, ok, title, detail, fix = null) => items.push({ key, ok: !!ok, title, detail, fix });

  if (!out && !mic) {
    add('found', false, 'Cuffie non viste da Windows', hw.off ? 'Il ricevitore c\'è ma le cuffie sono spente: accendile.' : 'Accendi le cuffie e controlla che il ricevitore sia collegato.');
    return { out, mic, items, ok: false, fixable: false };
  }

  if (out) {
    add('outDefault', out.isDefault && out.isDefaultComm, 'Audio nelle cuffie',
      out.isDefault && out.isDefaultComm ? 'Le cuffie sono l\'uscita audio di Windows, anche per le chiamate.' : out.isDefault ? 'Le chiamate (Discord, Teams) escono da un altro dispositivo.' : 'Windows sta facendo uscire l\'audio da un altro dispositivo.', 'outDefault');
    add('outMuted', !out.muted, 'Audio non silenziato', out.muted ? 'L\'uscita delle cuffie è silenziata in Windows.' : 'Non silenziato.', 'outMuted');
    add('outVolume', out.volume >= 5, 'Volume delle cuffie', out.volume >= 5 ? `${out.volume}%.` : `${out.volume}%: non senti niente.`, 'outVolume');
  } else add('out', false, 'Uscita audio delle cuffie', 'Windows non vede l\'uscita audio delle cuffie.');

  if (mic) {
    add('micDefault', mic.isDefault && mic.isDefaultComm, 'Microfono delle cuffie in uso',
      mic.isDefault && mic.isDefaultComm ? 'È il microfono predefinito di Windows, anche per le chiamate.' : 'Windows sta usando un altro microfono' + (mic.isDefault ? ' per le chiamate.' : '.'), 'micDefault');
    add('micMuted', !mic.muted, 'Microfono attivo in Windows', mic.muted ? 'Il microfono delle cuffie è silenziato in Windows.' : 'Non silenziato.', 'micMuted');
    add('micVolume', mic.volume >= 30, 'Volume del microfono', mic.volume >= 30 ? `${mic.volume}%.` : `Solo ${mic.volume}%: gli altri ti sentono poco o niente.`, 'micVolume');
    const apoOnMic = extra.apo && extra.apo[mic.id];
    add('micApo', !apoOnMic, 'Nessun filtro sul microfono', apoOnMic ? 'Equalizer APO è installato sul microfono e può bloccarlo. Va tolto dal Configurator di Equalizer APO (serve il "Sì" da amministratore).' : 'Equalizer APO non tocca il microfono.');
  } else add('mic', false, 'Microfono delle cuffie', 'Windows non vede il microfono delle cuffie.');

  if (hw.micMuted) add('boom', false, 'Asta del microfono', 'L\'asta è alzata: il microfono è spento dalle cuffie stesse. Abbassala.');
  else if (hw.micMuted === false) add('boom', true, 'Asta del microfono', 'Abbassata, microfono acceso.');

  const p = extra.privacy || {};
  const denied = [p.machine, p.user, p.desktop].some((v) => String(v || '').toLowerCase() === 'deny');
  add('privacy', !denied, 'Permesso microfono di Windows', denied ? 'In Privacy e sicurezza → Microfono l\'accesso è disattivato: le app non possono usarlo.' : 'Le app possono usare il microfono.', denied ? 'privacy' : null);

  if (icue.running) add('icue', false, 'iCUE', 'iCUE è ancora aperto: finché c\'è, Unico lascia le cuffie a lui.');
  else if (icue.installed) add('icue', true, 'iCUE', 'Installato ma chiuso. Puoi disinstallarlo: Unico gestisce le cuffie al suo posto.');

  const bad = items.filter((i) => !i.ok);
  return { out, mic, items, ok: bad.length === 0, fixable: bad.some((i) => i.fix && i.fix !== 'privacy') };
}

// Azioni per sistemare quello che si può sistemare da Windows senza diritti di amministratore.
function fixPlan(result) {
  const steps = [];
  const bad = new Set(result.items.filter((i) => !i.ok && i.fix).map((i) => i.fix));
  if (result.out && bad.has('outDefault')) steps.push({ op: 'default', id: result.out.id });
  if (result.out && bad.has('outMuted')) steps.push({ op: 'mute', id: result.out.id, mute: false });
  if (result.out && bad.has('outVolume')) steps.push({ op: 'volume', id: result.out.id, volume: 40 });
  if (result.mic && bad.has('micDefault')) steps.push({ op: 'default', id: result.mic.id });
  if (result.mic && bad.has('micMuted')) steps.push({ op: 'mute', id: result.mic.id, mute: false });
  if (result.mic && bad.has('micVolume')) steps.push({ op: 'volume', id: result.mic.id, volume: 80 });
  return steps;
}

module.exports = { analyze, fixPlan, isHs80, guidOf };
