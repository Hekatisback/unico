'use strict';
const api = window.unico;
const U = window.BatUI;
const pill = document.getElementById('pill');

function render(p) {
  document.body.classList.toggle('left', p.side === 'left');
  pill.innerHTML = p.list.map((e) => `
    <div class="cell lv-${U.level(e.percent, p.low)}${p.highlight && p.highlight.includes(e.id) ? ' hi' : ''}" title="${U.esc(e.name)}">
      ${U.ring(e, p.low, 44)}
      <small>${e.percent == null ? '—' : e.percent + '%'}</small>
    </div>`).join('');
  requestAnimationFrame(() => pill.classList.add('show'));
}

api.batteriesGet().then(render);
api.on('batteries', render);
api.on('batteries:hide', () => pill.classList.remove('show'));
// il mouse sopra gli anelli: si fanno quasi trasparenti per non coprire quello che c'è sotto
api.on('batteries:away', (on) => pill.classList.toggle('away', !!on));
