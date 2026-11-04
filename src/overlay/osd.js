'use strict';
const osd = document.getElementById('osd');
window.unico.on('osd', (d) => {
  if (!d) { osd.classList.remove('show'); return; }
  document.getElementById('t').textContent = d.title || '';
  document.getElementById('s').textContent = d.sub || '';
  osd.classList.remove('show');
  void osd.offsetWidth;
  osd.classList.add('show');
});
