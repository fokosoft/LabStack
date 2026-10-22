// Puesto · solucionario: pinta soluciones.js junto a los escenarios.
//
// La salida de cada paso no está escrita a mano: se obtiene ejecutando el
// guion de referencia en el simulador al abrir la página. Si el motor cambia,
// el solucionario cambia con él y nunca enseña algo que la terminal no diría.
(function () {
'use strict';
const P = window.PUESTO, U = P.u;
const T = P.T;
const $ = s => document.querySelector(s);
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TIPOS = { incidente: T('Incidente', 'Incident'), peticion: T('Petición', 'Request'), cambio: T('Cambio', 'Change') };
const FASES = { diag: T('Diagnóstico', 'Diagnosis'), arreglo: T('Arreglo', 'Fix'), comprobar: T('Comprobación', 'Verification'), '': T('Paso', 'Step') };
const MAX = 40;
// Lo que cambia de una app a otra (puesto-cloud declara P.solucionarioCfg antes de cargar este fichero).
const CFG = Object.assign({
  buscar: T('Buscar un término: noout, cuota, idempotencia…', 'Search for a term: noout, quota, idempotence…'),
  silencio: T('(no devuelve nada: en Linux, el silencio suele significar que ha ido bien)', '(no output: in Linux, silence usually means it worked)'),
}, P.solucionarioCfg || {});

// Ejecuta el guion y devuelve la salida de cada paso.
function salidas(e) {
  const st = P.preparar(e), ses = P.nuevaSesion(), guion = P.guionDe(e, st);
  return guion.map(cmd => {
    const host = ses.host, prompt = P.prompt(ses);
    const r = P.ejecutar(st, ses, cmd);
    const lineas = r.lineas.concat(P.expulsar(st, ses));
    return { cmd, host, prompt, lineas };
  });
}
const usos = {};
P.escenarios.forEach(e => (P.soluciones[e.id].terminos || []).forEach(t => { (usos[t] = usos[t] || []).push(e.id); }));

function ticket(e) {
  const s = P.soluciones[e.id], p = P.prioridad(e), sal = salidas(e);
  const pasos = s.pasos.map((x, i) => {
    const o = sal[i], extra = Math.max(0, o.lineas.length - MAX);
    const cuerpo = o.lineas.length
      ? o.lineas.slice(0, MAX).map(l => `<div class="ln ${l.c}">${h(l.t) || '&nbsp;'}</div>`).join('') + (extra ? `<div class="ln dim">${T(`… ${extra} líneas más`, `… ${extra} more lines`)}</div>` : '')
      : `<div class="ln dim">${CFG.silencio}</div>`;
    return `<li class="paso f-${x[1] || 'mov'}">
      <span class="paso-n">${i + 1}</span>
      <div class="paso-c">
        <div class="paso-cab"><span class="fase">${FASES[x[1]]}</span><code><span class="paso-host">${h(o.prompt)}</span>${h(o.cmd)}</code></div>
        <p>${h(x[2])}</p>
        ${x[1] ? `<details class="salida"><summary>${T('Ver lo que devuelve', 'Show the output')}</summary><div class="salida-t">${cuerpo}</div></details>` : ''}
      </div>
    </li>`;
  }).join('');
  const nPasos = s.pasos.filter(x => x[1] === 'arreglo').length;
  return `<details class="card sol" id="${e.id}">
    <summary>
      <span class="tk-id">${e.id}</span><span class="chip t-${e.tipo}">${TIPOS[e.tipo]}</span><span class="chip p-${p.p}">${p.p}</span>
      <span class="sol-t">${h(e.asunto)}</span><span class="sol-n">${e.area} · ${T(`${s.pasos.length} pasos`, `${s.pasos.length} steps`)}</span>
    </summary>
    <div class="sol-cuerpo">
      <div class="sol-dos">
        <div><h4>${T('El síntoma', 'The symptom')}</h4>${e.cuerpo.map(x => '<p>' + h(x) + '</p>').join('')}</div>
        <div><h4>${T('Qué pasaba', 'What was going on')}</h4><p>${h(e.causa)}</p></div>
      </div>
      <h4>${T('Cómo se resuelve', 'How to solve it')} <span class="sol-leyenda">${T(`diagnóstico → arreglo (${nPasos}) → comprobación`, `diagnosis → fix (${nPasos}) → verification`)}</span></h4>
      <ol class="pasos">${pasos}</ol>
      <div class="sol-dos">
        <div><h4>${T('Lo que no lo arregla', 'What does not fix it')}</h4><ul class="trampas">${(e.trampas || []).map(t => `<li><code>${h(t.cmds.filter(c => !/^(ssh|exit|cd|source|sleep)\b/.test(c)).join(' · '))}</code><span>${h(t.porque.charAt(0).toUpperCase() + t.porque.slice(1))}.</span></li>`).join('')}</ul></div>
        <div><h4>${T('Buenas prácticas que se valoran', 'Good practices that earn credit')}</h4><ul class="valoran">${e.practicas.map(x => '<li>' + h(x.t) + '</li>').join('')}</ul></div>
      </div>
      <div class="sol-leccion"><h4>${T('Lo que te llevas', 'The takeaway')}</h4><p>${h(e.leccion)}</p></div>
      <div class="sol-pie">
        <span>${(s.terminos || []).map(t => { const g = P.glosario.find(x => x.id === t); return `<a class="termino" href="#g-${t}">${h(g.t)}</a>`; }).join('')}</span>
        <a class="btn" href="./index.html#${e.id}">${T('Practicarlo →', 'Practice it →')}</a>
      </div>
    </div>
  </details>`;
}
function glosario() {
  return P.glosario.slice().sort((a, b) => a.t.localeCompare(b.t, P.idioma)).map(g => `<div class="gl" id="g-${g.id}" data-txt="${h((g.t + ' ' + g.d).toLowerCase())}">
    <b>${h(g.t)}</b><p>${h(g.d)}</p>
    ${usos[g.id] ? `<span class="gl-usos">${T('Aparece en', 'Appears in')} ${usos[g.id].map(id => `<a href="#${id}">${id}</a>`).join(' · ')}</span>` : ''}
  </div>`).join('');
}

$('#vista').innerHTML = `<div class="cola-wrap sol-wrap">
  <section class="sol-hero">
    <span class="oferta-tag">📘 ${T('Solucionario', 'Answer book')}</span>
    <h1>${T('Cómo se resuelve cada ticket', 'How each ticket is solved')}</h1>
    <p>${T('Paso a paso, con lo que te dice cada comando y la salida real que verás en la terminal. Úsalo <b>después</b> de intentarlo: el oficio se aprende buscando, y cada ticket admite más de un camino. Este es uno bueno.', 'Step by step, with what each command tells you and the real output you will see in the terminal. Use it <b>after</b> you have tried: the craft is learned by searching, and every ticket has more than one path. This is a good one.')}</p>
    <nav class="sol-nav"><a href="#tickets">Tickets (${P.escenarios.length})</a><a href="#glosario">${T('Glosario', 'Glossary')} (${P.glosario.length})</a><button data-act="todos">${T('Abrir todos', 'Expand all')}</button><button data-act="imprimir">${T('Imprimir', 'Print')}</button></nav>
  </section>
  <section id="tickets">
    <div class="cola-cab"><h2>Tickets</h2><span>${T('de nivel 1 a nivel 3', 'from level 1 to level 3')}</span></div>
    <div class="lista">${P.escenarios.map(ticket).join('')}</div>
  </section>
  <section id="glosario" style="margin-top:34px">
    <div class="cola-cab"><h2>${T('Glosario', 'Glossary')}</h2><span>${T(`${P.glosario.length} términos`, `${P.glosario.length} terms`)}</span></div>
    <input id="buscar" class="buscar" type="search" placeholder="${CFG.buscar}" aria-label="${T('Buscar en el glosario', 'Search the glossary')}">
    <div class="glosario">${glosario()}</div>
  </section>
</div>`;

// Un enlace a #INC-4821 abre ese ticket; a #g-noout resalta el término.
function irA() {
  const id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
  const el = document.getElementById(id); if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  if (el.classList.contains('gl')) { el.classList.remove('marca-gl'); void el.offsetWidth; el.classList.add('marca-gl'); }
  el.scrollIntoView({ block: 'start' });
}
window.addEventListener('hashchange', irA);
irA();
$('#buscar').addEventListener('input', ev => {
  const q = ev.target.value.trim().toLowerCase();
  document.querySelectorAll('.gl').forEach(g => { g.style.display = !q || g.dataset.txt.indexOf(q) >= 0 ? '' : 'none'; });
});
const abrirTodos = v => document.querySelectorAll('details').forEach(d => { d.open = v; });
window.addEventListener('beforeprint', () => abrirTodos(true));
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'todos') { const abrir = !document.querySelector('details.sol[open]'); document.querySelectorAll('details.sol').forEach(d => { d.open = abrir; }); b.textContent = abrir ? T('Cerrar todos', 'Collapse all') : T('Abrir todos', 'Expand all'); }
  if (b.dataset.act === 'imprimir') window.print();
  if (b.dataset.act === 'tema') { const o = document.body.classList.toggle('oscuro'); try { localStorage.setItem('puesto-tema', o ? 'oscuro' : 'claro'); } catch (e) { /* nada */ } }
});
try { const t = localStorage.getItem('puesto-tema'); if (t === 'oscuro' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.body.classList.add('oscuro'); } catch (e) { /* nada */ }
})();
