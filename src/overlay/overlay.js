'use strict';
const $ = (s) => document.querySelector(s);
const heat = (el, t, warm, hot) => { el.classList.toggle('hot', t != null && t >= hot); el.classList.toggle('warm', t != null && t >= warm && t < hot); };
window.unico.onStats((s) => {
  if (!s) return;
  $('#cpu').textContent = `${s.cpu.total}%`;
  $('#cpuT').textContent = s.cpuTemp != null ? `${Math.round(s.cpuTemp)}°` : '';
  heat($('#cpuT'), s.cpuTemp, 80, 90);
  if (s.gpu) {
    $('#gpu').textContent = `${Math.round(s.gpu.util)}%`;
    $('#gpuT').textContent = s.gpu.temp != null ? `${Math.round(s.gpu.temp)}°` : '';
    heat($('#gpuT'), s.gpu.temp, 78, 86);
    $('#vram').textContent = s.gpu.memTotal ? `${(s.gpu.memUsed / 1024).toFixed(1)} / ${(s.gpu.memTotal / 1024).toFixed(0)} GB` : '—';
    $('#power').textContent = s.gpu.power != null ? `${Math.round(s.gpu.power)} W` : '';
  }
  $('#ram').textContent = `${s.ram.pct}%  ${(s.ram.used / 1073741824).toFixed(1)} GB`;
  const d = s.devices || {};
  const parts = [d.mouse != null ? `🖱 ${d.mouse}%` : null, d.headset != null ? `🎧 ${d.headset}%` : null].filter(Boolean);
  $('#batRow').hidden = !parts.length;
  $('#bat').textContent = parts.join('  ');
  heat($('#bat'), Math.min(d.mouse ?? 100, d.headset ?? 100) <= 15 ? 99 : null, 80, 90);
  $('#clock').textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
});
