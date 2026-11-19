'use strict';
// Sidetone software: la voce dal microfono delle cuffie torna nelle cuffie, con un ritardo minimo.
// Tutto passa da Windows (registrazione e riproduzione normali): alle cuffie non viene mandato niente.
const api = window.unico;
let ctx = null, gain = null, stream = null, cfg = { volume: 40 };

const isHs80 = (d) => /HS80/i.test(d.label || '');
async function start() {
  stop();
  try {
    // prima una richiesta qualsiasi, così i nomi dei dispositivi diventano leggibili
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    const devs = await navigator.mediaDevices.enumerateDevices();
    const mic = devs.find((d) => d.kind === 'audioinput' && isHs80(d) && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const out = devs.find((d) => d.kind === 'audiooutput' && isHs80(d) && d.deviceId !== 'default' && d.deviceId !== 'communications');
    if (!mic) return report({ ok: false, error: 'Microfono delle cuffie non trovato' });
    // solo nelle cuffie: mai dagli altoparlanti, farebbe fischiare
    if (!out) return report({ ok: false, error: 'Uscita audio delle cuffie non trovata' });
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: mic.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, latency: 0 } });
    ctx = new AudioContext({ latencyHint: 'interactive' });
    if (!ctx.setSinkId) { stop(); return report({ ok: false, error: 'Questa versione non sa scegliere l\'uscita audio' }); }
    await ctx.setSinkId(out.deviceId);
    gain = ctx.createGain();
    gain.gain.value = level(cfg.volume);
    ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);
    report({ ok: true, latencyMs: Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000) || null });
  } catch (e) { report({ ok: false, error: e.message }); }
}
function stop() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (ctx) ctx.close().catch(() => {});
  stream = null; ctx = null; gain = null;
}
// volume percepito: curva quadratica, al massimo come la voce a pieno volume
const level = (v) => Math.pow(Math.max(0, Math.min(100, v)) / 100, 2);
function report(st) { api.sidetoneReport(st); }

api.on('sidetone', (c) => {
  const restart = !ctx;
  cfg = { ...cfg, ...c };
  if (gain) gain.gain.setTargetAtTime(level(cfg.volume), ctx.currentTime, 0.05);
  if (restart) start();
});
navigator.mediaDevices.addEventListener('devicechange', () => { if (ctx) setTimeout(start, 800); });
