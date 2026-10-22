// Puesto · interfaz. Pinta la cola y el puesto de trabajo a partir del motor.
//
// La interfaz no guarda estado de la plataforma: todo lo que enseña (nodos,
// OSD, alertas, reloj, SLA) se vuelve a leer del motor tras cada comando. Así
// el panel nunca puede contradecir a la terminal.
(function () {
'use strict';
const P = window.PUESTO, U = P.u;
const T = P.T;
const $ = s => document.querySelector(s);
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Otra app (puesto-cloud) reutiliza esta interfaz con su propia plataforma:
// declara P.ui antes de cargar este fichero y sólo cambia lo que dice aquí.
// Sin P.ui, todo es el Puesto Linux.
const UI = Object.assign({
  clave: 'puesto-linux-v1',
  claveImp: 'puesto-linux-importadas',   // la misma que escribe el compositor
  oferta: {
    tag: T('📌 Puesto', '📌 Job opening'),
    titulo: T('Administrador/a de Sistemas Linux', 'Linux Systems Administrator'),
    sub: T('Proyecto retail · remoto · contrato indefinido', 'Retail project · remote · permanent, full-time'),
    txt: T('Despliegue y mantenimiento de la plataforma OpenStack, administración y monitorización del almacenamiento Ceph, automatización con Ansible y Terraform, y monitorización y resolución de incidencias. Cada función del puesto tiene sus tickets:', 'Deploy and maintain the OpenStack platform, administer and monitor Ceph storage, automate with Ansible and Terraform, and monitor and resolve incidents. Each duty of the role has its own tickets:'),
  },
  como: [
    T('<b>Doce nodos simulados</b>: bastión, 3 controladores OpenStack, 4 hipervisores, 3 nodos Ceph y monitorización.', '<b>Twelve simulated nodes</b>: a bastion, 3 OpenStack controllers, 4 hypervisors, 3 Ceph nodes and monitoring.'),
    T('<b>Arreglas con comandos reales</b>: ssh, systemctl, ceph, openstack, ansible-playbook, terraform… Nada de elegir respuestas.', '<b>You fix things with real commands</b>: ssh, systemctl, ceph, openstack, ansible-playbook, terraform… No multiple choice.'),
    T('<b>Se comprueba el estado</b>, no el camino. Luego se valora cómo llegaste: las buenas prácticas del oficio.', '<b>The end state is checked</b>, not the path. Then how you got there is scored: the good practices of the trade.'),
  ],
  guardia: true, importar: true, caos: true,
  bienvenida: null,     // modo -> líneas de bienvenida de la terminal
  sesionNueva: T('Nueva sesión en el bastión', 'New session on the bastion'),
  paneles: null,        // ({ st, h, alertas, app }) -> html de la columna izquierda, bajo las alertas
  experimentos: null,   // [[comando, explicación]] del laboratorio libre
  alertas: T('Alertas', 'Alerts'),
}, P.ui || {});
const CLAVE = UI.clave;
const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}') || {}; } catch (e) { return {}; } };
const guardar = d => { try { localStorage.setItem(CLAVE, JSON.stringify(d)); } catch (e) { /* sin almacenamiento: se juega igual */ } };

const TIPOS = { incidente: T('Incidente', 'Incident'), peticion: T('Petición', 'Request'), cambio: T('Cambio', 'Change') };
// Impacto y urgencia se guardan en castellano; sólo se traducen al enseñarlos.
const NIVEL_ITSM = { alto: T('alto', 'high'), medio: T('medio', 'medium'), bajo: T('bajo', 'low'), alta: T('alta', 'high'), media: T('media', 'medium'), baja: T('baja', 'low') };
const nv = x => NIVEL_ITSM[x] || x;
const MAX_LINEAS = 1500, MAX_TABS = 6;
// Incidencias importadas: se guarda el fichero tal cual y se vuelve a validar
// (y a ensayar) en cada arranque. Si una deja de ser válida, se ve y se puede borrar.
const CLAVE_IMP = UI.claveImp;
const leerImp = () => { try { const v = JSON.parse(localStorage.getItem(CLAVE_IMP) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const guardarImp = l => { try { localStorage.setItem(CLAVE_IMP, JSON.stringify(l)); } catch (e) { /* sin almacenamiento: vive hasta recargar */ } };
let importadas = [];   // [{ fuente, r }]
function recargarImportadas(fuentes) {
  importadas = fuentes.map(fuente => ({ fuente, r: P.cargarIncidencia(fuente) }));
  P.importadas.length = 0;
  importadas.forEach(x => { if (x.r.ok) P.importadas.push(x.r.escenario); });
}
const app = { vista: 'cola', modo: null, esc: null, st: null, tabs: [], activa: 0, pistas: 0, intentos: 0, pendientes: null, cierre: null, filtro: null, progreso: leer().resueltos || {}, guardias: leer().guardias || {}, guardiaPanel: false, caos: [], caosMsg: null };

// ------------------------------------------------------------------ cola
function vistaCola() {
  const res = app.progreso;
  const funcs = P.funciones.map(f => { const es = P.escenarios.filter(e => e.funciones.indexOf(f.id) >= 0); return { f, total: es.length, n: es.filter(e => res[e.id]).length }; }).filter(x => x.total);
  const lista = P.escenarios.filter(e => !app.filtro || e.funciones.indexOf(app.filtro) >= 0);
  const hechos = P.escenarios.filter(e => res[e.id]).length;
  $('#vista').innerHTML = `
  <div class="cola-wrap">
    <section class="hero">
      <div class="card oferta">
        <span class="oferta-tag">${UI.oferta.tag}</span>
        <h1>${UI.oferta.titulo}</h1>
        <p class="oferta-sub">${UI.oferta.sub}</p>
        <p class="oferta-txt">${UI.oferta.txt}</p>
        <div class="funcs">
          ${funcs.map(x => `<button class="func ${app.filtro === x.f.id ? 'on' : ''}" data-act="filtro" data-id="${x.f.id}" aria-pressed="${app.filtro === x.f.id}">
            <span class="func-t">${h(x.f.titulo)}</span><span class="func-bar"><i style="width:${x.total ? x.n / x.total * 100 : 0}%"></i></span><span class="func-n">${x.n}/${x.total}</span></button>`).join('')}
        </div>
      </div>
      <div class="lado">
        ${UI.guardia ? `<button class="modo" data-act="guardia" aria-expanded="${app.guardiaPanel}"><span class="modo-ic" style="background:var(--bad-tint)">🔔</span><span class="modo-tx"><b>${T('Guardia', 'On call')}</b><small>${T('Averías al azar, sin ticket: sólo las alertas. Como a las tres de la mañana.', 'Random faults, no ticket: just the alerts. Like at three in the morning.')}</small></span></button>
        ${app.guardiaPanel ? panelGuardia() : ''}` : ''}
        <button class="modo" data-act="libre"><span class="modo-ic" style="background:var(--accent-tint)">🧪</span><span class="modo-tx"><b>${T('Laboratorio libre', 'Free lab')}</b><small>${T('La plataforma sana, sin ticket. Rompe cosas a propósito y mira qué pasa.', 'A healthy platform, no ticket. Break things on purpose and see what happens.')}</small></span></button>
        <div class="card como">
          <h3>${T('Cómo funciona', 'How it works')}</h3>
          <ol>
            ${UI.como.map(x => '<li>' + x + '</li>').join('')}
          </ol>
        </div>
      </div>
    </section>
    <section>
      <div class="cola-cab"><h2>${T('Cola de trabajo', 'Work queue')}</h2><span>${T(`${hechos} de ${P.escenarios.length} resueltos`, `${hechos} of ${P.escenarios.length} resolved`)}</span>${app.filtro ? '<button data-act="filtro" data-id="">' + T('Ver todos', 'Show all') + '</button>' : ''}</div>
      <div class="lista">${lista.map(filaTicket).join('')}</div>
    </section>
    ${UI.importar ? seccionImportadas() : ''}
  </div>`;
}
function seccionImportadas() {
  const res = app.impResultado || [];
  const aviso = res.map(x => x.r.ok
    ? `<div class="imp-res ok"><b>✓ ${T(`${h(x.nombre)}: ${h(x.r.escenario.id)} aceptada`, `${h(x.nombre)}: ${h(x.r.escenario.id)} accepted`)}</b><span>${T(`${x.r.ensayo.averias} averías${x.r.ensayo.condiciones ? ' y ' + x.r.ensayo.condiciones + ' condiciones' : ''} · ${x.r.ensayo.alertas} alertas · su solución de referencia la resuelve en ${x.r.ensayo.comandos} comandos`, `${x.r.ensayo.averias} faults${x.r.ensayo.condiciones ? ' and ' + x.r.ensayo.condiciones + ' conditions' : ''} · ${x.r.ensayo.alertas} alerts · its reference fix resolves it in ${x.r.ensayo.comandos} commands`)}</span>${x.r.avisos.map(a => '<span class="imp-aviso">! ' + h(a) + '</span>').join('')}</div>`
    : `<div class="imp-res mal"><b>✕ ${T(`${h(x.nombre)} no se acepta`, `${h(x.nombre)} was rejected`)}</b><ul>${x.r.errores.map(e => '<li>' + h(e) + '</li>').join('')}</ul></div>`).join('');
  const cat = P.catalogoLegible();
  return `<section class="importar">
    <div class="cola-cab"><h2>${T('Incidencias importadas', 'Imported incidents')}</h2><span>${P.importadas.length ? P.importadas.length + T(' en la cola', ' in the queue') : T('ninguna todavía', 'none yet')}</span></div>
    <div class="card imp" id="zonaImp">
      <div class="imp-txt"><b>${T('Trae tus propias incidencias', 'Bring your own incidents')}</b><p>${T('Compónlas en el formulario, o trae un fichero <code>.json</code> que combina averías del catálogo. Antes de aceptarlo, el puesto lo aplica sobre una plataforma nueva y ensaya su solución: si nadie podría cerrarlo, no entra. Puedes arrastrarlo aquí.', 'Compose them in the form, or bring a <code>.json</code> file that combines faults from the catalog. Before accepting it, the desk applies it to a fresh platform and rehearses its fix: if nobody could close it, it is rejected. You can drag it here.')}</p></div>
      <div class="imp-acc">
        <a class="btn primario-in" href="./compositor.html">${T('Componer una incidencia', 'Compose an incident')}</a>
        <button class="btn" data-act="importar">${T('Importar .json', 'Import .json')}</button>
        ${P.exportables().length ? `<span class="imp-sep">${T('o parte de un ticket del puesto:', 'or start from one of the desk\'s tickets:')}</span>
        <select id="plantilla" aria-label="${T('Ticket que usar como plantilla', 'Ticket to use as a template')}">${P.exportables().map(e => `<option value="${e.id}">${e.id} · ${h(e.asunto)}</option>`).join('')}</select>
        <button class="btn" data-act="exportar">${T('Descargar como plantilla', 'Download as template')}</button>` : ''}
      </div>
      <input type="file" id="fichero" accept=".json,application/json" multiple hidden>
      ${aviso}
      <details class="catalogo"><summary>${T(`Catálogo de averías · ${cat.length} tipos para combinar`, `Fault catalog · ${cat.length} types to combine`)}</summary>
        ${cat.map(c => `<div class="cat-item"><div class="cat-cab"><code>${c.tipo}</code><b>${h(c.titulo)}</b>${c.condicion ? '<span class="chip t-cambio">' + T('condición', 'condition') + '</span>' : ''}</div>${c.descripcion ? '<p>' + h(c.descripcion) + '</p>' : ''}<dl>${Object.keys(c.params).map(k => '<dt>' + h(k) + '</dt><dd>' + h(c.params[k]) + '</dd>').join('')}</dl><pre>${h(JSON.stringify(c.ejemplo))}</pre></div>`).join('')}
      </details>
    </div>
    <div class="lista">${importadas.map(x => x.r.ok
      ? `<div class="tk-imp">${filaTicket(x.r.escenario)}<button class="tk-borrar" data-act="borrarImp" data-id="${h(x.r.escenario.id)}" title="${T('Quitar de la cola', 'Remove from the queue')}" aria-label="${T(`Quitar ${h(x.r.escenario.id)} de la cola`, `Remove ${h(x.r.escenario.id)} from the queue`)}">×</button></div>`
      : `<div class="tk-imp"><div class="tk tk-rota"><span class="tk-id">${h(x.fuente.id || T('¿?', '?'))}</span><span class="chip t-incidente">${T('no válida', 'invalid')}</span><span></span><span class="tk-main"><span class="tk-asunto">${h(x.fuente.asunto || T('sin asunto', 'no subject'))}</span><span class="tk-de">${h(x.r.errores[0] || '')}</span></span></div><button class="tk-borrar" data-act="borrarImp" data-id="${h(x.fuente.id || '')}" title="${T('Quitar', 'Remove')}" aria-label="${T('Quitar', 'Remove')}">×</button></div>`).join('')}</div>
  </section>`;
}
function importarFicheros(files) {
  const lista = Array.from(files || []).slice(0, 20);
  if (!lista.length) return;
  const res = []; let pendientes = lista.length;
  lista.forEach(f => {
    const rd = new FileReader();
    rd.onload = () => {
      const r = P.cargarIncidencia(String(rd.result));
      res.push({ nombre: f.name, r });
      if (r.ok) {
        const fuentes = importadas.map(x => x.fuente).filter(x => x.id !== r.escenario.id && (x.id || r.escenario.id !== 'EXT-?'));
        fuentes.push(Object.assign({}, r.escenario.fuente, { id: r.escenario.id }));
        guardarImp(fuentes); recargarImportadas(fuentes);
      }
      if (--pendientes === 0) { app.impResultado = res; vistaCola(); const z = $('#zonaImp'); if (z) z.scrollIntoView({ block: 'center' }); }
    };
    rd.onerror = () => { res.push({ nombre: f.name, r: { ok: false, errores: [T('No se ha podido leer el fichero', 'Could not read the file')], avisos: [] } }); if (--pendientes === 0) { app.impResultado = res; vistaCola(); } };
    rd.readAsText(f);
  });
}
function descargar(nombre, texto, tipo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
  a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function panelGuardia() {
  const g = app.guardias, n = k => g[k] || 0;
  return `<div class="card gd">
    <p class="gd-t">${T('¿Cómo de mala viene la noche?', 'How bad is tonight going to be?')}</p>
    <div class="gd-niveles">${[1, 2, 3].map(k => `<button data-act="guardiaNivel" data-n="${k}"><b>${P.nivelesGuardia[k]}</b><span>${k === 1 ? T('una avería', 'one fault') : k === 2 ? T('dos a la vez', 'two at once') : T('tres a la vez, alguna de las gordas', 'three at once, some of them big ones')}</span><em>${T(`${n(k)} resueltas`, `${n(k)} solved`)}</em></button>`).join('')}</div>
    <div class="gd-pie">
      <label>${T('Semilla', 'Seed')} <input id="semilla" inputmode="numeric" placeholder="${T('al azar', 'random')}" aria-label="${T('Semilla para repetir una guardia', 'Seed to replay an on-call shift')}"></label>
      <button class="gd-ticket" data-act="guardiaTicket">${T('o un ticket del puesto al azar, sin su texto', 'or a random ticket from the desk, without its text')}${P.importadas.length ? T(' (incluidas las importadas)', ' (imported ones included)') : ''}</button>
    </div>
    <p class="gd-nota">${T('Cada guardia sale de una semilla: con el mismo número, la misma noche. Pásasela a un compañero y comparad.', 'Every shift comes from a seed: same number, same night. Pass it to a colleague and compare.')}</p>
  </div>`;
}
function filaTicket(e) {
  const p = P.prioridad(e), r = app.progreso[e.id];
  return `<button class="tk" data-act="abrir" data-id="${e.id}">
    <span class="tk-id">${e.id}</span>
    <span class="chip t-${e.tipo}">${TIPOS[e.tipo]}</span>
    <span class="chip p-${p.p}" title="${T(`Impacto ${e.impacto} × urgencia ${e.urgencia}`, `Impact ${nv(e.impacto)} × urgency ${nv(e.urgencia)}`)}">${p.p}</span>
    <span class="tk-main"><span class="tk-asunto">${h(e.asunto)}</span><span class="tk-de">${h(e.de)} · ${h(e.area)}${e.importada ? T(' · importada', ' · imported') + (e.autor ? ' · ' + h(e.autor) : '') : ''}</span></span>
    <span class="tk-nivel" title="${T(`Nivel ${e.nivel} de 3`, `Level ${e.nivel} of 3`)}">${'●'.repeat(e.nivel)}${'○'.repeat(3 - e.nivel)}</span>
    <span class="tk-estado ${r ? 'ok' : ''}">${r ? '✓ ' + r.min + ' min' : T('Nuevo', 'New')}</span>
  </button>`;
}

// ------------------------------------------------------------------ puesto
function nuevaTab(host) {
  const t = { ses: P.nuevaSesion(), lineas: [], hIdx: -1 };
  app.tabs.push(t); app.activa = app.tabs.length - 1;
  if (host) correrEn(t, 'ssh ' + host);
  return t;
}
function abrir(modo, esc) {
  app.vista = 'puesto'; app.modo = modo; app.esc = esc || null;
  app.st = P.preparar(app.esc);
  app.tabs = []; app.pistas = 0; app.intentos = 0; app.pendientes = null; app.cierre = null; app.caos = []; app.caosMsg = null;
  const t = nuevaTab();
  const bienvenida = UI.bienvenida ? UI.bienvenida(modo) : modo === 'guardia'
    ? [T('Te ha saltado la guardia. No hay ticket: sólo lo que ven las alertas.', 'You have been paged. There is no ticket: only what the alerts see.'), T('Estás en el bastión. Para orientarte: amtool alert · ceph -s · help', 'You are on the bastion. To get your bearings: amtool alert · ceph -s · help')]
    : modo === 'libre'
      ? [T('Laboratorio libre: la plataforma está sana y no hay ticket.', 'Free lab: the platform is healthy and there is no ticket.'), T('Estás en el bastión. Empieza por help o por cat RUNBOOK.md', 'You are on the bastion. Start with help or cat RUNBOOK.md')]
      : [T('Estás en el bastión, el punto de entrada a la plataforma.', 'You are on the bastion, the entry point to the platform.'), T('Para orientarte: help · cat RUNBOOK.md · amtool alert', 'To get your bearings: help · cat RUNBOOK.md · amtool alert')];
  bienvenida.forEach(x => t.lineas.push({ t: x, c: 'dim' }));
  t.lineas.push({ t: '', c: 'out' });
  pintarPuesto();
}
function pintarPuesto() {
  const e = app.esc;
  const titulo = app.modo === 'libre' ? T('Laboratorio libre', 'Free lab') : app.modo === 'guardia' && !app.cierre ? (e.guardia ? e.asunto : T('Guardia', 'On call')) : e.asunto;
  $('#vista').innerHTML = `
  <div class="puesto">
    <div class="barra">
      <button class="volver" data-act="cola">${T('← Cola', '← Queue')}</button>
      <div class="barra-t">${e && (app.modo !== 'guardia' || app.cierre) ? '<span class="mono">' + e.id + '</span>' : ''}<b>${h(titulo)}</b></div>
      <div class="reloj"><b id="hora"></b><span id="tmas"></span></div>
      <div class="sla" id="sla"></div>
    </div>
    <aside class="col izq" id="izq"></aside>
    <main class="centro">
      <div class="term">
        <div class="tabs" id="tabs" role="tablist"></div>
        <div class="term-body" id="termBody">
          <div id="termOut" aria-live="polite"></div>
          <div class="term-in"><span id="termPrompt"></span><input id="termIn" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${T('Línea de comandos', 'Command line')}"></div>
        </div>
      </div>
    </main>
    <aside class="col der" id="der"></aside>
  </div>`;
  const inp = $('#termIn');
  inp.addEventListener('keydown', teclaTerminal);
  $('#termBody').addEventListener('mouseup', () => { if (!String(window.getSelection() || '')) inp.focus(); });
  pintarTerminal(); pintarPaneles();
  inp.focus();
}
const tab = () => app.tabs[app.activa];

// ------------------------------------------------------------------ terminal
function correrEn(t, txt) {
  const pr = P.prompt(t.ses), oculto = !!(t.ses.pendiente && t.ses.pendiente.oculto);
  const r = P.ejecutar(app.st, t.ses, txt);
  if (r.limpiar) t.lineas = [];
  else t.lineas.push({ t: oculto ? '' : txt, c: 'in', pr });   // una contraseña no se ve al escribirla
  r.lineas.forEach(l => t.lineas.push(l));
  app.tabs.forEach(x => P.expulsar(app.st, x.ses).forEach(l => x.lineas.push(l)));
  app.tabs.forEach(x => { if (x.lineas.length > MAX_LINEAS) x.lineas = x.lineas.slice(-MAX_LINEAS); });
}
function ejecutar(txt) {
  const t = tab(); t.hIdx = -1;
  correrEn(t, txt);
  app.pendientes = null;
  pintarTerminal(); pintarPaneles();
}
function pintarTerminal() {
  const t = tab();
  $('#tabs').innerHTML = app.tabs.map((x, i) => `<button class="tab ${i === app.activa ? 'on' : ''}" role="tab" aria-selected="${i === app.activa}" data-act="tab" data-i="${i}">${i + 1} · ${h(x.ses.host)}${app.tabs.length > 1 ? `<span class="x" data-act="cerrarTab" data-i="${i}" title="${T('Cerrar pestaña', 'Close tab')}" aria-label="${T('Cerrar pestaña', 'Close tab')}">×</span>` : ''}</button>`).join('')
    + (app.tabs.length < MAX_TABS ? '<button class="tab-mas" data-act="nuevaTab" title="' + UI.sesionNueva + '" aria-label="' + T('Nueva pestaña', 'New tab') + '">+</button>' : '');
  $('#termOut').innerHTML = t.lineas.map(l => l.c === 'in'
    ? `<div class="ln in"><span class="pr">${h(l.pr)}</span>${h(l.t)}</div>`
    : `<div class="ln ${l.c}">${h(l.t) || '&nbsp;'}</div>`).join('');
  $('#termPrompt').textContent = P.prompt(t.ses);
  $('#termIn').type = t.ses.pendiente && t.ses.pendiente.oculto ? 'password' : 'text';
  const b = $('#termBody'); b.scrollTop = b.scrollHeight;
}
function teclaTerminal(ev) {
  const inp = ev.target, t = tab();
  if (ev.key === 'Enter') { ev.preventDefault(); const v = inp.value; inp.value = ''; ejecutar(v); return; }
  if (ev.key === 'Tab') {
    ev.preventDefault();
    if (t.ses.pendiente) return;
    const r = P.completar(app.st, t.ses, inp.value);
    inp.value = r.texto;
    if (r.opciones.length) { t.lineas.push({ t: inp.value, c: 'in', pr: P.prompt(t.ses) }); t.lineas.push({ t: r.opciones.join('   '), c: 'dim' }); pintarTerminal(); }
    return;
  }
  if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    ev.preventDefault();
    const hi = t.ses.hist; if (!hi.length) return;
    let i = t.hIdx === -1 ? hi.length : t.hIdx;
    i += ev.key === 'ArrowUp' ? -1 : 1;
    if (i < 0) i = 0;
    if (i >= hi.length) { t.hIdx = -1; inp.value = ''; return; }
    t.hIdx = i; inp.value = hi[i];
    setTimeout(() => inp.setSelectionRange(inp.value.length, inp.value.length), 0);
    return;
  }
  if (ev.ctrlKey && (ev.key === 'l' || ev.key === 'L')) { ev.preventDefault(); t.lineas = []; pintarTerminal(); return; }
  if (ev.ctrlKey && (ev.key === 'c' || ev.key === 'C') && !String(window.getSelection() || '')) {
    ev.preventDefault();
    t.lineas.push({ t: inp.value + '^C', c: 'in', pr: P.prompt(t.ses) });
    if (t.ses.pendiente) { t.ses.pendiente = null; t.lineas.push({ t: T('Cancelado.', 'Cancelled.'), c: 'ambar' }); }
    inp.value = ''; pintarTerminal();
  }
}

// ------------------------------------------------------------------ paneles
const GRUPOS = [[T('Bastión', 'Bastion'), ['bastion']], [T('Controladores', 'Controllers'), ['ctl01', 'ctl02', 'ctl03']], [T('Cómputo', 'Compute'), ['cmp01', 'cmp02', 'cmp03', 'cmp04']], ['Ceph', ['ceph01', 'ceph02', 'ceph03']], [T('Monitorización', 'Monitoring'), ['mon01']]];
const ROL_CORTO = { bastion: 'Ansible · Terraform · CLI', ctl: 'API · RabbitMQ · Galera', cmp: 'KVM · nova-compute', ceph: 'mon · mgr · 3 OSD', mon: 'Prometheus · Grafana' };
function pintarPaneles() {
  const st = app.st;
  $('#hora').textContent = U.hora(st.reloj);
  $('#tmas').textContent = 'T+' + st.reloj + ' min';
  const e = app.esc;
  if (e && app.modo === 'ticket') {
    const p = P.prioridad(e), pasado = st.reloj - (e.abierto || 0), f = Math.min(1, pasado / p.sla);
    const col = f < 0.5 ? 'var(--ok)' : f < 0.85 ? 'var(--warn)' : 'var(--bad)';
    $('#sla').innerHTML = `<span><b>SLA ${p.p}</b><em style="font-style:normal">${Math.max(0, p.sla - pasado)} min</em></span><span class="sla-bar"><i style="width:${f * 100}%;background:${col}"></i></span>`;
  } else $('#sla').innerHTML = '';
  $('#izq').innerHTML = panelAlertas() + (UI.paneles ? UI.paneles({ st, h, alertas: P.alertasActivas(st), app }) : panelNodos() + panelCeph());
  $('#der').innerHTML = app.modo === 'libre' ? panelLibre() : app.cierre ? panelCierre() : panelTicket() + panelResolver() + panelPistas() + panelRegistro();
}
function panelNodos() {
  const st = app.st, al = P.alertasActivas(st);
  const nota = hn => {
    const x = st.hosts[hn];
    if (!x.up) return T('reiniciando… vuelve ', 'rebooting… back at ') + U.hora(x.vuelveEn);
    const a = al.find(y => y.host === hn && y.sev !== 'info');
    if (a) return a.res;
    if (!x.provisionado) return T('sin OpenStack: pendiente de alta', 'not in OpenStack yet');
    if (x.kernelNuevo) return T('reinicio pendiente (kernel)', 'reboot pending (kernel)');
    return ROL_CORTO[x.rol];
  };
  return `<section class="panel"><h3>${T('Plataforma', 'Platform')}</h3>${GRUPOS.map(([t, hs]) => `<div class="grupo"><p class="grupo-t">${t}</p>${hs.map(n => {
    const e = P.estadoHost(st, st.hosts[n]);
    return `<button class="host e-${e}" data-act="ssh" data-host="${n}" title="${T(`Abrir una sesión en ${n}`, `Open a session on ${n}`)}"><i class="punto"></i><b>${n}</b><span>${h(nota(n))}</span></button>`;
  }).join('')}</div>`).join('')}</section>`;
}
function panelCeph() {
  const st = app.st, c = st.ceph, s = P.saludCeph(st), usos = U.usos(st);
  const hosts = ['ceph01', 'ceph02', 'ceph03'].map(n => `<div class="osd-host"><p class="grupo-t">${n}</p>${c.osds.filter(o => o.host === n).map(o => {
    const up = U.osdUp(st, o), u = usos[o.id], clase = !up && o.in ? 'caido' : !o.in ? 'fuera' : u >= c.nearfull * 100 ? 'lleno' : '';
    const txt = !up && o.in ? 'down' : !o.in ? 'out' : u.toFixed(0) + ' %';
    return `<div class="osd ${clase}"><b>osd.${o.id}</b><span class="osd-bar"><i style="width:${o.in ? u : 0}%"></i></span><em>${txt}</em></div>`;
  }).join('')}</div>`).join('');
  const flags = Object.keys(c.flags).filter(k => c.flags[k]);
  const rec = c.rec ? `<div class="rec">${c.rec.tipo === 'reparto' ? T('Rebalanceando', 'Rebalancing') : c.rec.tipo === 'log' ? T('Poniéndose al día', 'Catching up') : T('Reconstruyendo réplicas', 'Rebuilding replicas')} · ${T(`quedan ${c.rec.restante} min`, `${c.rec.restante} min left`)}<span class="sla-bar"><i style="width:${(1 - c.rec.restante / c.rec.total) * 100}%"></i></span></div>` : '';
  return `<section class="panel"><h3>Ceph <span class="salud s-${s.estado} der-n">${s.estado}</span></h3>${hosts}${flags.length ? '<div class="flags">' + flags.map(f => '<span class="flag">' + f + '</span>').join('') + '</div>' : ''}${rec}</section>`;
}
// Cuánto lleva una alerta: minutos, y horas o días cuando es vieja.
const hace = m => { m = Math.max(0, m); return m < 120 ? m + ' min' : m < 2880 ? Math.floor(m / 60) + ' h' : Math.floor(m / 1440) + T(' días', ' days'); };
function panelAlertas() {
  const al = P.alertasActivas(app.st);
  return `<section class="panel"><h3>${UI.alertas} <span class="der-n">${al.length}</span></h3>${al.length ? al.map(a => `<div class="alerta al-${a.sev}"><i></i><div><b>${h(a.nombre)}</b><span>${h((a.host ? a.host + ' · ' : '') + a.res)}</span></div><small>${hace(app.st.reloj - a.desde)}</small></div>`).join('') : '<p class="vacio">' + T('Sin alertas activas.', 'No active alerts.') + '</p>'}</section>`;
}
function panelTicket() {
  const e = app.esc, st = app.st, p = P.prioridad(e);
  const fase = app.cierre ? 3 : st.registro.length ? 1 : 0;
  const estados = [T('Nuevo', 'New'), T('En curso', 'In progress'), T('Resuelto', 'Resolved'), T('Cerrado', 'Closed')].map((x, i) => `<span class="${i === fase ? 'on' : i < fase ? 'hecho' : ''}">${x}</span>`).join('');
  if (app.modo === 'guardia') return `<section class="panel ticket"><div class="tk-cab"><span class="chip t-incidente">${T('Guardia', 'On call')}</span></div><h2>${T('Te ha saltado el busca', 'Your pager just went off')}</h2><p>${T('No hay ticket: nadie te dice qué pasa. Mira las alertas, averigua qué está roto y arréglalo.', 'There is no ticket: nobody tells you what is going on. Check the alerts, find out what is broken and fix it.')}</p><p class="de">${T('Cuando creas que está resuelto, compruébalo abajo. Sabrás qué incidente era al cerrarlo.', 'When you think it is resolved, check it below. You will find out which incident it was when you close it.')}</p><div class="estado-itsm">${estados}</div></section>`;
  return `<section class="panel ticket">
    <div class="tk-cab"><span class="mono">${e.id}</span><span class="chip t-${e.tipo}">${TIPOS[e.tipo]}</span><span class="chip p-${p.p}">${p.p}</span></div>
    <h2>${h(e.asunto)}</h2>
    <p class="de">${T(`De: ${h(e.de)} · abierto a las ${U.hora(e.abierto || 0)}`, `From: ${h(e.de)} · opened at ${U.hora(e.abierto || 0)}`)}</p>
    ${e.cuerpo.map(x => '<p>' + h(x) + '</p>').join('')}
    <dl class="itsm"><dt>${T('Impacto', 'Impact')}</dt><dd>${nv(e.impacto)}</dd><dt>${T('Urgencia', 'Urgency')}</dt><dd>${nv(e.urgencia)}</dd><dt>${T('Prioridad', 'Priority')}</dt><dd>${p.p} · ${T('resolver en', 'resolve within')} ${p.sla >= 60 ? p.sla / 60 + ' h' : p.sla + ' min'}</dd><dt>${T('Área', 'Area')}</dt><dd>${h(e.area)}</dd></dl>
    <div class="estado-itsm">${estados}</div>
  </section>`;
}
function panelPistas() {
  const e = app.esc, quedan = e.pistas.length - app.pistas;
  return `<section class="panel"><h3>${T('Pistas', 'Hints')} <span class="der-n">${T(`${app.pistas} de ${e.pistas.length}`, `${app.pistas} of ${e.pistas.length}`)}</span></h3>
    ${e.pistas.slice(0, app.pistas).map((x, i) => `<p class="pista"><b>${i + 1}</b>${h(x)}</p>`).join('')}
    ${quedan ? `<button class="btn suave" data-act="pista">${app.pistas ? T('Otra pista', 'Another hint') : T('Pedir una pista', 'Ask for a hint')} <span style="color:var(--faint);font-weight:500">${T(`(quedan ${quedan})`, `(${quedan} left)`)}</span></button>` : '<p class="vacio">' + T('No quedan más pistas.', 'No hints left.') + '</p>'}
  </section>`;
}
function panelRegistro() {
  const r = app.st.registro.slice(-40);
  return `<section class="panel"><h3>${T('Registro de trabajo', 'Work log')} <span class="der-n">${app.st.registro.length}</span></h3>${r.length ? '<div class="registro" id="registro">' + r.map(x => `<div><span>${U.hora(x.min)}</span><span>${x.host}</span><span title="${h(x.cmd)}">${h(x.cmd)}</span></div>`).join('') + '</div>' : '<p class="vacio">' + T('Cada comando que lances queda anotado aquí, con el equipo y la hora. Es la cronología del informe.', 'Every command you run is logged here, with the host and the time. It becomes the timeline of the report.') + '</p>'}</section>`;
}
function panelResolver() {
  const aun = app.pendientes ? `<div class="aun"><b>${T('Todavía no está resuelto', 'Not resolved yet')}</b><ul>${app.pendientes.map(x => '<li>' + h(x) + '</li>').join('')}</ul></div>` : '';
  return `<section class="panel"><button class="btn primario" data-act="comprobar">${T('Comprobar y resolver', 'Check and resolve')}</button>${aun}</section>`;
}
function panelCierre() {
  const e = app.esc, c = app.cierre, p = P.prioridad(e);
  const ok = c.practicas.filter(x => x.ok).length;
  return `<section class="panel cierre">
    <div class="cierre-top"><span class="cierre-ok">✓</span><div><b>${T(`${e.id} resuelto`, `${e.id} resolved`)}</b><span>${h(e.asunto)}</span></div></div>
    <div class="cifras">
      <div><b>${c.trabajo} min</b><span>${T('de trabajo', 'of work')}</span></div>
      <div><b style="color:${c.total <= p.sla ? 'var(--ok)' : 'var(--bad)'}">${c.total <= p.sla ? T('Dentro', 'Within') : T('Fuera', 'Breached')}</b><span>SLA ${p.p} (${c.total} min)</span></div>
      <div><b>${c.pistas}/3</b><span>${T('pistas', 'hints')}</span></div>
    </div>
    <h3 style="margin:0 0 8px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)">${T(`Buenas prácticas · ${ok} de ${c.practicas.length}`, `Good practices · ${ok} of ${c.practicas.length}`)}</h3>
    ${c.practicas.map(x => `<p class="practica ${x.ok ? 'si' : 'no'}"><i>${x.ok ? '✓' : '○'}</i><span>${h(x.t)}</span></p>`).join('')}
    <div class="bloque"><h4>${T('Qué pasaba', 'What was going on')}</h4><p>${h(e.causa)}</p></div>
    <div class="bloque"><h4>${T('Lo que te llevas', 'What you take away')}</h4><p>${h(e.leccion)}</p></div>
    <div class="acciones">
      <button class="btn primario" data-act="informe">${T('Descargar el informe (.md)', 'Download the report (.md)')}</button>
      ${e.guardia ? `<button class="btn" data-act="guardiaNivel" data-n="${e.guardia.nivel}">${T(`Otra guardia ${P.nivelesGuardia[e.guardia.nivel].toLowerCase()}`, `Another ${P.nivelesGuardia[e.guardia.nivel].toLowerCase()} shift`)}</button>${e.fuente ? `<button class="btn" data-act="guardiaJson">${T('Descargar como incidencia (.json)', 'Download as an incident (.json)')}</button>` : ''}` : ''}
      <button class="btn" data-act="repetir">${e.guardia ? T('Repetir esta misma guardia (semilla ' + e.guardia.semilla + ')', 'Replay this same shift (seed ' + e.guardia.semilla + ')') : T('Repetir desde cero', 'Start over')}</button>
      <button class="btn" data-act="cola">${T('Volver a la cola', 'Back to the queue')}</button>
    </div>
  </section>`;
}
const EXPERIMENTOS = [
  ['ceph osd out 3', T('Saca un OSD sano del clúster y mira cómo se reparten los datos (ceph -s, ceph osd df).', 'Take a healthy OSD out of the cluster and watch how the data gets redistributed (ceph -s, ceph osd df).')],
  ['ssh ceph01', T('Entra en un nodo Ceph y reinícialo sin noout (sudo reboot). Mira qué hace Ceph a los 10 minutos.', 'Log into a Ceph node and reboot it without noout (sudo reboot). See what Ceph does after 10 minutes.')],
  ['cd infra', T('Ve a la carpeta de automatización y ensaya un playbook sin tocar nada: ansible-playbook playbooks/chrony.yml --check', 'Go to the automation folder and dry-run a playbook without changing anything: ansible-playbook playbooks/chrony.yml --check')],
  ['source ~/admin-openrc', T('Carga las credenciales y mira cuánta RAM le queda a cada hipervisor: openstack hypervisor list --long', 'Load the credentials and check how much RAM each hypervisor has left: openstack hypervisor list --long')],
  ['cat ~/RUNBOOK.md', T('Lee las normas de la casa: qué se hace a mano y qué no.', 'Read the house rules: what is done by hand and what is not.')],
];
function panelLibre() {
  return `<section class="panel"><h3>${T('Laboratorio libre', 'Free lab')}</h3><p style="margin:0 0 10px;font-size:12px;color:var(--muted)">${T('No hay ticket ni reloj de SLA. Pulsa un experimento para escribirlo en la terminal.', 'No ticket, no SLA clock. Click an experiment to type it into the terminal.')}</p>
    ${(UI.experimentos || EXPERIMENTOS).map(([c, t]) => `<button class="experimento" data-act="escribir" data-cmd="${h(c)}"><code>${h(c)}</code><span>${h(t)}</span></button>`).join('')}
    <button class="btn" style="width:100%;margin-top:6px" data-act="repetir">${T('Dejar la plataforma como nueva', 'Reset the platform')}</button></section>` + (UI.caos ? panelCaos() : '') + panelRegistro();
}
function panelCaos() {
  const c = app.caos, msg = app.caosMsg;
  return `<section class="panel caos"><h3>${T('Caos', 'Chaos')} <span class="der-n">${c.length ? c.length + T(' provocada' + (c.length > 1 ? 's' : ''), ' triggered') : ''}</span></h3>
    <p class="caos-t">${T('Rompe algo al azar sin decirte qué. Pasará en los próximos minutos, como en la vida real: te enterarás por las alertas, si las miras.', 'Breaks something at random without telling you what. It will happen in the next few minutes, just like in real life: you will find out from the alerts, if you watch them.')}</p>
    <button class="btn caos-btn" data-act="caos">${T('Provocar una avería', 'Trigger a fault')}</button>
    ${c.length ? `<div class="caos-acc"><button class="btn" data-act="caosComprobar">${T('¿Está todo arreglado?', 'Is everything fixed?')}</button><button class="btn" data-act="caosRevelar">${T('Revelar qué era', 'Reveal what it was')}</button></div>` : ''}
    ${msg ? `<div class="caos-msg ${msg.tipo}">${msg.html}</div>` : ''}
  </section>`;
}

// ------------------------------------------------------------------ cierre
function comprobar() {
  const e = app.esc, ev = P.evaluar(app.st, e);
  app.intentos++;
  if (ev.pendientes.length) { app.pendientes = ev.pendientes; pintarPaneles(); return; }
  app.cierre = { trabajo: app.st.reloj, total: app.st.reloj - (e.abierto || 0), pistas: app.pistas, practicas: ev.practicas, intentos: app.intentos };
  const ant = app.progreso[e.id], nuevo = { min: app.st.reloj, pistas: app.pistas, practicas: ev.practicas.filter(x => x.ok).length + '/' + ev.practicas.length };
  if (e.guardia) app.guardias[e.guardia.nivel] = (app.guardias[e.guardia.nivel] || 0) + 1;
  else if (!ant || nuevo.pistas < ant.pistas || (nuevo.pistas === ant.pistas && nuevo.min < ant.min)) app.progreso[e.id] = nuevo;
  guardar({ resueltos: app.progreso, guardias: app.guardias });
  pintarPuesto();
}
function informe() {
  const e = app.esc, st = app.st, p = P.prioridad(e), c = app.cierre;
  const L = [];
  L.push('# ' + e.id + ' · ' + e.asunto, '');
  L.push('| | |', '|---|---|');
  L.push(T('| Tipo | ', '| Type | ') + TIPOS[e.tipo] + (app.modo === 'guardia' ? T(' (detectado en guardia)', ' (detected on call)') : '') + ' |');
  L.push(T('| Origen | ', '| Source | ') + e.de + ' |');
  L.push(T('| Prioridad | ' + p.p + ' (impacto ' + e.impacto + ' × urgencia ' + e.urgencia + '), resolver en ', '| Priority | ' + p.p + ' (impact ' + nv(e.impacto) + ' × urgency ' + nv(e.urgencia) + '), resolve within ') + (p.sla >= 60 ? p.sla / 60 + ' h' : p.sla + ' min') + ' |');
  L.push(T('| Inicio de la avería | ', '| Fault started | ') + U.hora(e.inicio || 0) + ' |');
  L.push(T('| Ticket abierto | ', '| Ticket opened | ') + U.hora(e.abierto || 0) + ' |');
  L.push(T('| Resuelto | ' + U.hora(st.reloj) + ' (' + c.total + ' min desde la apertura, ' + (c.total <= p.sla ? 'dentro' : 'fuera') + ' de SLA) |', '| Resolved | ' + U.hora(st.reloj) + ' (' + c.total + ' min after opening, ' + (c.total <= p.sla ? 'within' : 'outside') + ' SLA) |'));
  L.push(T('| Pistas usadas | ' + c.pistas + ' de 3 |', '| Hints used | ' + c.pistas + ' of 3 |'), '');
  L.push(T('## Descripción', '## Description'), '', e.cuerpo.join('\n\n'), '');
  L.push(T('## Cronología', '## Timeline'), '');
  st.registro.forEach(x => L.push('- `' + U.hora(x.min) + '` **' + x.host + '** `' + x.cmd.replace(/`/g, "'") + '`'));
  L.push('', T('## Causa raíz', '## Root cause'), '', e.causa, '', T('## Solución aplicada', '## Fix applied'), '', e.solucion, '');
  L.push(T('## Buenas prácticas', '## Good practices'), '');
  c.practicas.forEach(x => L.push('- [' + (x.ok ? 'x' : ' ') + '] ' + x.t));
  L.push('', T('## Lección aprendida', '## Lesson learned'), '', e.leccion, '');
  descargar(e.id + T('-informe.md', '-report.md'), L.join('\n'), 'text/markdown;charset=utf-8');
}

// ------------------------------------------------------------------ eventos
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'cola') { app.vista = 'cola'; vistaCola(); window.scrollTo(0, 0); return; }
  if (act === 'tema') { const o = document.body.classList.toggle('oscuro'); try { localStorage.setItem('puesto-tema', o ? 'oscuro' : 'claro'); } catch (e) { /* nada */ } return; }
  if (act === 'filtro') { app.filtro = b.dataset.id || null; vistaCola(); return; }
  if (act === 'abrir') { abrir('ticket', P.escenario(b.dataset.id)); return; }
  if (act === 'guardia') { app.guardiaPanel = !app.guardiaPanel; vistaCola(); return; }
  if (act === 'guardiaNivel') {
    const campo = $('#semilla'), v = campo && parseInt(campo.value, 10);
    const semilla = v > 0 ? v : 100000 + Math.floor(Math.random() * 900000);
    const g = P.generarGuardia(+b.dataset.n, semilla);
    if (g.ok) abrir('guardia', g.escenario); else alert(T('No ha salido una guardia jugable con esa semilla. Prueba otra.', 'That seed did not produce a playable shift. Try another one.'));
    return;
  }
  if (act === 'guardiaTicket') {
    const pool = P.escenarios.concat(P.importadas).filter(e => e.tipo === 'incidente' && P.alertasActivas(P.preparar(e)).length);
    abrir('guardia', pool[Math.floor(Math.random() * pool.length)]); return;
  }
  if (act === 'guardiaJson') { const d = app.esc.fuente; descargar(d.id.toLowerCase() + '.json', JSON.stringify(d, null, 2), 'application/json'); return; }
  if (act === 'caos') {
    const c = P.provocarCaos(app.st, 1 + Math.floor(Math.random() * 1e9), [].concat(...app.caos.map(x => x.averias)));
    if (c) { app.caos.push(c); app.caosMsg = { tipo: 'aviso', html: T('Hecho. Algo se romperá en los próximos minutos. Los comandos hacen pasar el tiempo; <code>sleep 60</code> también.', 'Done. Something will break in the next few minutes. Commands make time pass; so does <code>sleep 60</code>.') }; }
    else app.caosMsg = { tipo: 'aviso', html: T('Ya hay demasiadas cosas rotas a la vez: arregla algo antes de pedir más.', 'Too many things are already broken at once: fix something before asking for more.') };
    pintarPaneles(); return;
  }
  if (act === 'caosComprobar') {
    const futuras = app.caos.filter(c => c.cuando > app.st.reloj).length, p = P.pendientesCaos(app.st, app.caos);
    app.caosMsg = futuras ? { tipo: 'aviso', html: T('Todavía no ha pasado todo lo que provocaste. Deja correr el tiempo (<code>sleep 60</code>) y mira las alertas.', 'Not everything you triggered has happened yet. Let time pass (<code>sleep 60</code>) and watch the alerts.') }
      : p.length ? { tipo: 'mal', html: T('Aún queda algo roto: <b>' + p.length + '</b> cosa' + (p.length > 1 ? 's' : '') + ' sin arreglar. Las alertas y <code>systemctl --failed</code> te dicen dónde.', 'Something is still broken: <b>' + p.length + '</b> thing' + (p.length > 1 ? 's' : '') + ' not fixed. The alerts and <code>systemctl --failed</code> tell you where.') }
      : { tipo: 'ok', html: T('✓ Todo arreglado: lo que rompiste, y lo que arrastró, está sano.', '✓ All fixed: what you broke, and whatever it dragged down, is healthy.') };
    pintarPaneles(); return;
  }
  if (act === 'caosRevelar') {
    app.caosMsg = { tipo: 'aviso', html: T('Lo que provocaste:', 'What you triggered:') + '<ul>' + app.caos.map(c => '<li><b>' + h(c.familia.titulo) + '</b>' + T(' a las ', ' at ') + U.hora(c.cuando) + ' · ' + c.averias.map(a => h(a.tipo) + (a.nodo ? T(' en ', ' on ') + h(a.nodo) : a.osd != null ? ' (osd.' + a.osd + ')' : '')).join(', ') + '<br><span>' + h(c.familia.leccion.charAt(0).toUpperCase() + c.familia.leccion.slice(1)) + '.</span></li>').join('') + '</ul>' };
    pintarPaneles(); return;
  }
  if (act === 'libre') { abrir('libre', null); return; }
  if (act === 'repetir') { abrir(app.modo, app.esc); return; }
  if (act === 'cerrarTab') { ev.stopPropagation(); app.tabs.splice(+b.dataset.i, 1); app.activa = Math.min(app.activa, app.tabs.length - 1); pintarTerminal(); $('#termIn').focus(); return; }
  if (act === 'tab') { app.activa = +b.dataset.i; pintarTerminal(); $('#termIn').focus(); return; }
  if (act === 'nuevaTab') { nuevaTab(); tab().lineas.push({ t: UI.sesionNueva + '.', c: 'dim' }); pintarTerminal(); pintarPaneles(); $('#termIn').focus(); return; }
  if (act === 'ssh') {
    const n = b.dataset.host;
    if (app.tabs.length < MAX_TABS) nuevaTab(n); else { app.activa = app.tabs.length - 1; correrEn(tab(), 'ssh ' + n); }
    pintarTerminal(); pintarPaneles(); $('#termIn').focus(); return;
  }
  if (act === 'pista') { app.pistas = Math.min(app.esc.pistas.length, app.pistas + 1); pintarPaneles(); return; }
  if (act === 'comprobar') { comprobar(); return; }
  if (act === 'informe') { informe(); return; }
  if (act === 'importar') { const f = $('#fichero'); if (f) { f.value = ''; f.click(); } return; }
  if (act === 'exportar') { const s = $('#plantilla'), e = s && P.escenario(s.value); if (e) descargar(P.exportarIncidencia(e).id.toLowerCase() + '.json', JSON.stringify(P.exportarIncidencia(e), null, 2), 'application/json'); return; }
  if (act === 'borrarImp') { const fuentes = importadas.map(x => x.fuente).filter(x => (x.id || '') !== b.dataset.id); guardarImp(fuentes); recargarImportadas(fuentes); app.impResultado = null; vistaCola(); return; }
  if (act === 'escribir') { const i = $('#termIn'); i.value = b.dataset.cmd; i.focus(); return; }
});
// Escribir en cualquier parte del puesto va a la terminal.
document.addEventListener('keydown', ev => {
  if (app.vista !== 'puesto' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.key.length !== 1) return;
  const a = document.activeElement;
  if (a && (a.id === 'termIn' || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  const i = $('#termIn'); if (i) i.focus();
});

// Importar: el selector de ficheros y arrastrar sobre la tarjeta.
document.addEventListener('change', ev => { if (ev.target && ev.target.id === 'fichero') importarFicheros(ev.target.files); });
document.addEventListener('dragover', ev => { const z = ev.target.closest && ev.target.closest('#zonaImp'); if (z) { ev.preventDefault(); z.classList.add('encima'); } });
document.addEventListener('dragleave', ev => { const z = ev.target.closest && ev.target.closest('#zonaImp'); if (z) z.classList.remove('encima'); });
document.addEventListener('drop', ev => { const z = ev.target.closest && ev.target.closest('#zonaImp'); if (!z) return; ev.preventDefault(); z.classList.remove('encima'); importarFicheros(ev.dataTransfer && ev.dataTransfer.files); });

if (UI.importar) recargarImportadas(leerImp());
try { const t = localStorage.getItem('puesto-tema'); if (t === 'oscuro' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.body.classList.add('oscuro'); } catch (e) { /* nada */ }
// index.html#INC-4821 abre ese ticket directamente (lo usa el solucionario).
const deHash = P.escenario(decodeURIComponent((location.hash || '').slice(1)));
if (deHash) { history.replaceState(null, '', location.pathname); abrir('ticket', deHash); } else vistaCola();
})();
