// Puesto · compositor de incidencias.
//
// Un formulario sobre el catálogo de averías. Cada campo sale de
// P.camposAveria, así que un tipo de avería nuevo aparece aquí sin tocar
// esta página. Mientras se edita, la incidencia se valida y se ENSAYA con el
// mismo cargador que usa «Importar» (incidencias.js): lo que aquí sale jugable
// es exactamente lo que el puesto aceptará.
(function () {
'use strict';
const P = window.PUESTO, U = P.u;
const T = P.T;
const $ = s => document.querySelector(s);
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Otro puesto (puesto-cloud) declara P.compositorCfg con sus claves de almacenamiento.
const CFG = Object.assign({ claveImp: 'puesto-linux-importadas', claveBorrador: 'puesto-linux-borrador', nuevoTipo: 'servicio-caido' }, P.compositorCfg || {});
const CLAVE_IMP = CFG.claveImp, CLAVE_BORRADOR = CFG.claveBorrador;
const MAX_HACE = (P.incidenciasCfg && P.incidenciasCfg.maxHace) || 10080;
const leer = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } };
const escribir = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
const copia = o => JSON.parse(JSON.stringify(o));

// La plataforma de partida, para ofrecer nodos, servicios, ficheros y VMs reales.
const BASE = P.crear();
const NODOS = P.topologia.filter(d => d.n !== 'bastion');
const ROL = { ctl: T('controlador', 'controller'), cmp: T('hipervisor', 'hypervisor'), ceph: 'Ceph', mon: T('monitorización', 'monitoring') };
const VMS_COPIA = !BASE.os ? [] : BASE.os.imagenesExtra.filter(i => /-20260923$/.test(i.nombre)).map(i => i.nombre.replace(/^backup-/, '').replace(/-20260923$/, ''));

const nueva = () => ({ formato: P.FORMATO_INCIDENCIA, asunto: '', de: '', cuerpo: [''], impacto: 'medio', urgencia: 'alta', tipo: 'incidente', nivel: 2, hace: 30, abiertoHace: 10, autor: '', averias: [] });
const est = { def: leer(CLAVE_BORRADOR, null) || nueva(), res: null, vista: null, msg: null, errAv: [] };
if (!Array.isArray(est.def.averias)) est.def.averias = [];
if (!Array.isArray(est.def.cuerpo)) est.def.cuerpo = [''];

// Lo que se valida y se guarda: sin campos vacíos opcionales.
function limpio(def) {
  const d = copia(def);
  ['id', 'de', 'autor', 'area', 'causa', 'solucion', 'leccion'].forEach(k => { if (d[k] == null || !String(d[k]).trim()) delete d[k]; });
  d.cuerpo = (d.cuerpo || []).map(x => String(x).trim()).filter(Boolean);
  if (Array.isArray(d.pistas) && d.pistas.every(x => !String(x || '').trim())) delete d.pistas;
  d.averias = (d.averias || []).map(a => { const x = Object.assign({}, a); Object.keys(x).forEach(k => { if (x[k] === '' || x[k] == null) delete x[k]; }); return x; });
  return d;
}

// ------------------------------------------------------------------ campos
function opciones(lista, valor, vacio) {
  return (vacio != null ? `<option value="">${h(vacio)}</option>` : '') + lista.map(o => { const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return `<option value="${h(v)}"${String(valor) === String(v) ? ' selected' : ''}>${h(t)}</option>`; }).join('');
}
function campo(a, i, c) {
  const v = a[c.k], id = 'f' + i + '-' + c.k, base = `data-i="${i}" data-k="${c.k}" data-t="${c.t}" id="${id}"`;
  const etiqueta = `<span>${h(c.etiqueta || c.k)}${c.opcional ? ' <em>' + T('opcional', 'optional') + '</em>' : ''}</span>`;
  let ctl;
  switch (c.t) {
    case 'nodo': ctl = `<select ${base}>${opciones(NODOS.filter(d => !c.roles || c.roles.indexOf(d.rol) >= 0).map(d => [d.n, d.n + ' · ' + ROL[d.rol]]), v, v ? null : T('elige un nodo', 'choose a node'))}</select>`; break;
    case 'servicio': { const hs = BASE.hosts[a.nodo]; ctl = `<select ${base}${hs ? '' : ' disabled'}>${opciones(hs ? Object.keys(hs.svcs) : [], v, hs ? (v ? null : T('elige un servicio', 'choose a service')) : T('primero el nodo', 'pick the node first'))}</select>`; break; }
    case 'motivo': ctl = `<select ${base}>${opciones(Object.keys(P.motivos).sort(), v, T('(genérico)', '(generic)'))}</select>`; break;
    case 'opciones': ctl = `<select ${base}>${opciones(c.opciones, v)}</select>`; break;
    case 'osd': ctl = `<select ${base}>${opciones([0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => [n, 'osd.' + n + ' · ceph0' + (Math.floor(n / 3) + 1)]), v)}</select>`; break;
    case 'proyecto': ctl = `<select ${base}>${opciones(Object.keys(BASE.os.proyectos), v)}</select>`; break;
    case 'flavor': ctl = `<select ${base}>${opciones(Object.keys(P.FLAVORS), v)}</select>`; break;
    case 'vm': ctl = `<select ${base}>${opciones(VMS_COPIA, v, v ? null : T('elige una VM con copia', 'choose a VM with a backup'))}</select>`; break;
    case 'bool': return `<label class="cf cf-bool"><input type="checkbox" ${base}${v ? ' checked' : ''}> ${etiqueta}</label>`;
    case 'num': ctl = `<input type="number" ${base} value="${v == null ? '' : h(v)}"${c.min != null ? ' min="' + c.min + '"' : ''}${c.max != null ? ' max="' + c.max + '"' : ''} step="${c.paso || 1}">`; break;
    case 'fichero': { const hs = BASE.hosts[a.nodo], dl = 'dl' + i; ctl = `<input type="text" ${base} list="${dl}" value="${h(v || '')}" placeholder="/var/log/…"><datalist id="${dl}">${hs ? Object.keys(hs.logs).filter(p => !/journal|\.gz$|\.\d$/.test(p)).map(p => '<option value="' + h(p) + '">').join('') : ''}</datalist>`; break; }
    case 'minutos': ctl = `<input type="text" ${base} value="${h((v || []).join(', '))}" placeholder="6, 5, 3">`; break;
    case 'lista': ctl = `<input type="text" ${base} value="${h((v || []).join(', '))}">`; break;
    case 'nodos': return `<div class="cf cf-ancho">${etiqueta}<div class="cf-checks">${NODOS.filter(d => !d.nuevo && (!c.roles || c.roles.indexOf(d.rol) >= 0)).map(d => `<label><input type="checkbox" data-i="${i}" data-k="${c.k}" data-t="nodos" data-sub="${d.n}"${(v || []).indexOf(d.n) >= 0 ? ' checked' : ''}> ${d.n}</label>`).join('')}</div></div>`;
    case 'memoria': return `<div class="cf cf-ancho">${etiqueta}<div class="cf-checks">${['ctl01', 'ctl02', 'ctl03'].map(n => `<label>${n} <input type="number" min="0" max="64" data-i="${i}" data-k="${c.k}" data-t="memoria" data-sub="${n}" value="${v && v[n] != null ? v[n] : ''}"></label>`).join('')}</div></div>`;
    case 'lineas': return `<label class="cf cf-ancho">${etiqueta}<textarea ${base} rows="3" placeholder="7 | 2.7f deep-scrub starts">${h((v || []).map(l => l.hace + ' | ' + l.t).join('\n'))}</textarea></label>`;
    default: ctl = `<input type="text" ${base} value="${h(v || '')}">`;
  }
  return `<label class="cf" for="${id}">${etiqueta}${ctl}</label>`;
}
function leerCampo(el) {
  const t = el.dataset.t, v = el.value;
  if (t === 'bool') return el.checked ? true : undefined;
  if (t === 'num' || t === 'osd') return v === '' ? undefined : Number(v);
  if (t === 'minutos') return v.split(/[,\s]+/).filter(Boolean).map(Number).filter(n => !isNaN(n));
  if (t === 'lista') return v.split(',').map(x => x.trim()).filter(Boolean);
  if (t === 'lineas') return v.split('\n').map(l => { const m = /^\s*(\d+)\s*\|\s*(.+)$/.exec(l); return m ? { hace: +m[1], t: m[2].trim() } : null; }).filter(Boolean);
  return v === '' ? undefined : v;
}

// ------------------------------------------------------------------ vista
const TIPOS = Object.keys(P.averias);
const tipoOpciones = sel => `<optgroup label="${T('Rompen algo', 'Break something')}">${opciones(TIPOS.filter(t => !P.averias[t].condicion).map(t => [t, P.averias[t].titulo]), sel)}</optgroup><optgroup label="${T('Condiciones (preparan, no rompen)', 'Conditions (set the scene, break nothing)')}">${opciones(TIPOS.filter(t => P.averias[t].condicion).map(t => [t, P.averias[t].titulo]), sel)}</optgroup>`;
function tarjetaAveria(a, i) {
  const t = P.averias[a.tipo], n = est.def.averias.length;
  if (!t) return `<div class="av-card av-mala"><b>${T(`Avería ${i + 1}: tipo desconocido «${h(a.tipo)}»`, `Fault ${i + 1}: unknown type “${h(a.tipo)}”`)}</b><button class="btn" data-act="quitar" data-i="${i}">${T('Quitar', 'Remove')}</button></div>`;
  return `<div class="av-card${t.condicion ? ' av-cond' : ''}">
    <div class="av-cab">
      <span class="av-n">${i + 1}</span>
      <select class="av-tipo" data-i="${i}" data-act-cambio="tipo" aria-label="${T(`Tipo de la avería ${i + 1}`, `Type of fault ${i + 1}`)}">${tipoOpciones(a.tipo)}</select>
      <span class="av-acc">
        <button data-act="subir" data-i="${i}" title="${T('Subir', 'Move up')}"${i === 0 ? ' disabled' : ''} aria-label="${T('Subir', 'Move up')}">↑</button>
        <button data-act="bajar" data-i="${i}" title="${T('Bajar', 'Move down')}"${i === n - 1 ? ' disabled' : ''} aria-label="${T('Bajar', 'Move down')}">↓</button>
        <button data-act="quitar" data-i="${i}" title="${T('Quitar', 'Remove')}" aria-label="${T('Quitar', 'Remove')}">×</button>
      </span>
    </div>
    ${t.descripcion ? '<p class="av-desc">' + h(t.descripcion) + '</p>' : ''}
    <p class="av-err" role="status"></p>
    <div class="av-campos">${(P.camposAveria[a.tipo] || []).map(c => campo(a, i, c)).join('') || '<p class="av-desc">' + T('No tiene parámetros.', 'It has no parameters.') + '</p>'}</div>
    ${a.soloPractica ? '<p class="av-desc">' + T('Marcada como «sólo práctica»: se aplica y cuenta como buena práctica arreglarla, pero no impide cerrar.', 'Marked as “practice only”: it is applied and fixing it counts as a good practice, but it does not block closing.') + '</p>' : ''}
  </div>`;
}
function origenes() {
  const imp = leer(CLAVE_IMP, []).filter(x => x && x.id);
  return `<option value="">${T('Empezar desde…', 'Start from…')}</option><option value="blanco">${T('Una incidencia en blanco', 'A blank incident')}</option>
    <optgroup label="${T('Un ticket del puesto', 'One of the desk\'s tickets')}">${P.exportables().map(e => `<option value="t:${e.id}">${e.id} · ${h(e.asunto)}</option>`).join('')}</optgroup>
    ${imp.length ? `<optgroup label="${T('Una incidencia importada', 'An imported incident')}">${imp.map(x => `<option value="i:${h(x.id)}">${h(x.id)} · ${h(x.asunto || '')}</option>`).join('')}</optgroup>` : ''}
    <optgroup label="${T('Una guardia generada al azar', 'A randomly generated on-call shift')}">${[1, 2, 3].map(n => `<option value="g:${n}">${T(`Guardia ${P.nivelesGuardia[n].toLowerCase()}`, `A ${P.nivelesGuardia[n].toLowerCase()} shift`)}</option>`).join('')}</optgroup>`;
}
function pintar() {
  const d = est.def;
  $('#vista').innerHTML = `<div class="comp">
    <div class="comp-form">
      <section class="comp-cab">
        <h1>${T('Compositor de incidencias', 'Incident composer')}</h1>
        <p>${T('Combina averías del catálogo y escribe el ticket. A la derecha, el puesto la ensaya mientras escribes: lo que verá quien la juegue, lo que tendrá que arreglar y si tiene arreglo.', 'Combine faults from the catalog and write the ticket. On the right, the desk rehearses it as you type: what the player will see, what they will have to fix, and whether it can be fixed at all.')}</p>
        <div class="comp-origen">
          <select id="origen" aria-label="${T('Punto de partida', 'Starting point')}">${origenes()}</select>
          <button class="btn" data-act="cargar">${T('Cargar', 'Load')}</button>
          <button class="btn" data-act="fichero">${T('Abrir .json', 'Open .json')}</button>
          <input type="file" id="fichero" accept=".json,application/json" hidden>
        </div>
      </section>

      <section class="card comp-sec">
        <h2>${T('El ticket', 'The ticket')}</h2>
        <div class="comp-grid">
          <label class="cf cf-ancho"><span>${T('asunto', 'subject')}</span><input type="text" data-top="asunto" maxlength="160" value="${h(d.asunto)}" placeholder="${T('Lo que pone el ticket, en una línea', 'What the ticket says, in one line')}"></label>
          <label class="cf cf-ancho"><span>${T('cuerpo <em>párrafos separados por una línea en blanco</em>', 'body <em>paragraphs separated by a blank line</em>')}</span><textarea data-top="cuerpo" rows="4" placeholder="${T('Lo que cuenta quien abre el ticket. Sin dar la causa.', 'What the person opening the ticket reports. Without giving away the cause.')}">${h((d.cuerpo || []).join('\n\n'))}</textarea></label>
          <label class="cf"><span>${T('de <em>opcional</em>', 'from <em>optional</em>')}</span><input type="text" data-top="de" value="${h(d.de || '')}" placeholder="${T('Monitorización, un equipo…', 'Monitoring, a team…')}"></label>
          <label class="cf"><span>${T('tipo', 'type')}</span><select data-top="tipo">${opciones([['incidente', T('Incidente', 'Incident')], ['peticion', T('Petición', 'Request')], ['cambio', T('Cambio', 'Change')]], d.tipo)}</select></label>
          <label class="cf"><span>${T('impacto', 'impact')}</span><select data-top="impacto">${opciones([['alto', T('alto', 'high')], ['medio', T('medio', 'medium')], ['bajo', T('bajo', 'low')]], d.impacto)}</select></label>
          <label class="cf"><span>${T('urgencia', 'urgency')}</span><select data-top="urgencia">${opciones([['alta', T('alta', 'high')], ['media', T('media', 'medium')], ['baja', T('baja', 'low')]], d.urgencia)}</select></label>
          <label class="cf"><span>${T('nivel', 'level')}</span><select data-top="nivel" data-num="1">${opciones([[1, T('1 · fácil', '1 · easy')], [2, T('2 · medio', '2 · medium')], [3, T('3 · difícil', '3 · hard')]], d.nivel)}</select></label>
          <label class="cf"><span>${T('la avería empezó hace (min)', 'fault started (min ago)')}</span><input type="number" min="0" max="${MAX_HACE}" data-top="hace" data-num="1" value="${d.hace == null ? '' : d.hace}"></label>
          <label class="cf"><span>${T('el ticket se abrió hace (min)', 'ticket opened (min ago)')}</span><input type="number" min="0" max="${MAX_HACE}" data-top="abiertoHace" data-num="1" value="${d.abiertoHace == null ? '' : d.abiertoHace}"></label>
          <label class="cf"><span>${T('id <em>opcional</em>', 'id <em>optional</em>')}</span><input type="text" data-top="id" value="${h(d.id || '')}" placeholder="EXT-001"></label>
          <label class="cf"><span>${T('autor <em>opcional</em>', 'author <em>optional</em>')}</span><input type="text" data-top="autor" value="${h(d.autor || '')}"></label>
        </div>
      </section>

      <section class="card comp-sec">
        <h2>${T('Las averías', 'The faults')} <span class="der-n">${T(`${d.averias.length} de 12`, `${d.averias.length} of 12`)}</span></h2>
        <div class="av-lista">${d.averias.map(tarjetaAveria).join('') || '<p class="vacio">' + T('Todavía ninguna. Añade una avería suelta o una familia entera (averías que tienen sentido juntas).', 'None yet. Add a single fault or a whole family (faults that make sense together).') + '</p>'}</div>
        <div class="av-nueva">
          <select id="nuevoTipo" aria-label="${T('Tipo de avería que añadir', 'Type of fault to add')}">${tipoOpciones(CFG.nuevoTipo)}</select>
          <button class="btn" data-act="anadir"${d.averias.length >= 12 ? ' disabled' : ''}>${T('+ Añadir avería', '+ Add fault')}</button>
          <select id="nuevaFamilia" aria-label="${T('Familia que añadir', 'Family to add')}">${P.familias.map(f => `<option value="${f.id}">${h(f.titulo)} · ${T('nivel', 'level')} ${f.nivel}</option>`).join('')}</select>
          <button class="btn" data-act="familia"${d.averias.length >= 12 ? ' disabled' : ''}>${T('+ Añadir familia', '+ Add family')}</button>
        </div>
      </section>

      <details class="card comp-sec"${d.pistas || d.causa || d.leccion || d.solucion ? ' open' : ''}>
        <summary><h2>${T('Textos didácticos <em>opcionales: si se dejan vacíos, se generan</em>', 'Teaching texts <em>optional: generated if left empty</em>')}</h2></summary>
        <div class="comp-grid">
          ${[0, 1, 2].map(n => `<label class="cf cf-ancho"><span>${T(`pista ${n + 1}`, `hint ${n + 1}`)}</span><textarea rows="2" data-top="pista" data-n="${n}" maxlength="400">${h((d.pistas || [])[n] || '')}</textarea></label>`).join('')}
          <label class="cf cf-ancho"><span>${T('causa', 'cause')}</span><textarea rows="2" data-top="causa" maxlength="1500">${h(d.causa || '')}</textarea></label>
          <label class="cf cf-ancho"><span>${T('solución', 'fix')}</span><textarea rows="2" data-top="solucion" maxlength="1500">${h(d.solucion || '')}</textarea></label>
          <label class="cf cf-ancho"><span>${T('lo que se lleva quien la resuelva', 'what the solver takes away')}</span><textarea rows="2" data-top="leccion" maxlength="1500">${h(d.leccion || '')}</textarea></label>
        </div>
      </details>
    </div>
    <aside class="comp-ensayo" id="ensayo" aria-live="polite"></aside>
  </div>`;
  pintarEnsayo();
}
function pintarEnsayo() {
  const r = est.res, v = est.vista;
  const estado = !r ? '' : r.ok
    ? `<div class="imp-res ok"><b>${T('✓ Jugable', '✓ Playable')}</b><span>${T('Se ha aplicado sobre una plataforma nueva y su solución de referencia la resuelve.', 'It was applied to a fresh platform and its reference fix resolves it.')}</span>${r.avisos.map(a => '<span class="imp-aviso">! ' + h(a) + '</span>').join('')}</div>`
    : `<div class="imp-res mal"><b>${T('Todavía no se puede jugar', 'Not playable yet')}</b><ul>${r.errores.map(e => '<li>' + h(e) + '</li>').join('')}</ul>${(r.avisos || []).map(a => '<span class="imp-aviso">! ' + h(a) + '</span>').join('')}</div>`;
  const e = v && v.e, p = e && P.prioridad(e);
  const cifras = v ? `<div class="cifras"><div><b>${p && p.p ? p.p : '—'}</b><span>${p && p.sla ? 'SLA ' + (p.sla >= 60 ? p.sla / 60 + ' h' : p.sla + ' min') : T('prioridad', 'priority')}</span></div><div><b>${v.alertas.length}</b><span>${T('alertas', 'alerts')}</span></div><div><b>${r && r.ensayo ? r.ensayo.comandos : v.guion.length}</b><span>${T('comandos de solución', 'fix commands')}</span></div></div>` : '';
  const bloque = (t, cont) => `<div class="bloque"><h4>${t}</h4>${cont}</div>`;
  $('#ensayo').innerHTML = `<section class="panel">
    <h3>${T('Ensayo', 'Rehearsal')}</h3>
    ${estado}${cifras}
    ${v ? bloque(T('Lo que verá quien juegue (alertas)', 'What the player will see (alerts)'), v.alertas.length ? v.alertas.map(a => `<div class="alerta al-${a.sev}"><i></i><div><b>${h(a.nombre)}</b><span>${h((a.host ? a.host + ' · ' : '') + a.res)}</span></div><small></small></div>`).join('') : '<p class="vacio">' + T('Ninguna: en guardia nadie la encontraría.', 'None: on call, nobody would ever find it.') + '</p>')
      + bloque(T('Lo que tendrá que dejar arreglado', 'What they will have to leave fixed'), v.pendientes.length ? '<ul class="lista-p">' + v.pendientes.map(x => '<li>' + h(x) + '</li>').join('') + '</ul>' : '<p class="vacio">' + T('Nada: así la plataforma nace sana.', 'Nothing: as it stands, the platform starts out healthy.') + '</p>')
      + bloque(T('Pistas', 'Hints'), '<ol class="lista-p">' + e.pistas.map(x => '<li>' + h(x) + '</li>').join('') + '</ol>')
      + bloque(T('Solución de referencia', 'Reference fix'), '<div class="sol-ref">' + v.guion.map(c => '<code>' + h(c) + '</code>').join('') + '</div>')
      : '<p class="vacio">' + T('Añade al menos una avería válida para ver el ensayo.', 'Add at least one valid fault to see the rehearsal.') + '</p>'}
    <div class="acciones">
      <button class="btn primario" data-act="probar"${r && r.ok ? '' : ' disabled'}>${T('Probarla en el puesto', 'Try it on the desk')}</button>
      <button class="btn" data-act="guardar"${r && r.ok ? '' : ' disabled'}>${T('Guardar en la cola', 'Save to the queue')}</button>
      <button class="btn" data-act="descargar"${r && r.ok ? '' : ' disabled'}>${T('Descargar .json', 'Download .json')}</button>
    </div>
    ${est.msg ? '<p class="comp-msg">' + est.msg + '</p>' : ''}
  </section>`;
}

// ------------------------------------------------------------------ ensayo
let espera = null;
function ensayar() {
  const d = limpio(est.def);
  escribir(CLAVE_BORRADOR, est.def);
  est.res = P.cargarIncidencia(d);
  est.vista = null;
  // El cargador se para en los errores de estructura; las averías se validan
  // siempre, para señalar cada una en su tarjeta mientras se rellena el ticket.
  est.errAv = d.averias.length && d.averias.every(a => P.averias[a.tipo]) ? P.validarAverias(d.averias) : [];
  if (!est.res.ok) est.errAv.forEach(x => { if (est.res.errores.indexOf(x) < 0) est.res.errores.push(x); });
  document.querySelectorAll('.av-card').forEach((c, i) => {
    // Los mensajes del validador llegan en el idioma de la página: «avería 2 (tipo): …»
    // o «fault 2 (tipo): …», y «las averías 1 y 2 tocan…» o «faults 1 and 2 touch…».
    const m = est.errAv.filter(x => new RegExp('^(avería|fault) ' + (i + 1) + ' ').test(x) || new RegExp('^(las averías|faults) (\\d+ (y|and) )?' + (i + 1) + '\\b').test(x));
    c.classList.toggle('av-error', m.length > 0);
    const p = c.querySelector('.av-err'); if (p) p.textContent = m.map(x => x.replace(/^(avería|fault) \d+ \([^)]*\): /, '')).join(' · ');
  });
  if (d.averias.length && !est.errAv.length) {
    try {
      const e = P.construirIncidencia(Object.assign({}, d, { asunto: d.asunto || T('(sin asunto)', '(no subject)'), cuerpo: d.cuerpo.length ? d.cuerpo : [T('(sin cuerpo)', '(no body)')] }));
      const st = P.preparar(e);
      est.vista = { e, alertas: P.alertasActivas(st), pendientes: e.resuelto(st, P), guion: P.guionDe(e, st) };
    } catch (x) { est.vista = null; }
  }
  pintarEnsayo();
}
const pronto = () => { clearTimeout(espera); espera = setTimeout(ensayar, 220); };

function guardarEnCola() {
  const r = est.res; if (!r || !r.ok) return null;
  const id = r.escenario.id, d = Object.assign(limpio(est.def), { id });
  const lista = leer(CLAVE_IMP, []).filter(x => x && x.id !== id);
  lista.push(d); escribir(CLAVE_IMP, lista);
  est.def.id = id;
  return id;
}
function descargar(nombre, texto) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function cargar(def, origen) {
  est.def = Object.assign(nueva(), copia(def));
  if (!Array.isArray(est.def.cuerpo)) est.def.cuerpo = [''];
  est.msg = T('Cargado: ', 'Loaded: ') + h(origen) + '.';
  pintar(); ensayar();
}

// ------------------------------------------------------------------ eventos
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.dataset.top) {
    const k = el.dataset.top, d = est.def;
    if (k === 'cuerpo') d.cuerpo = el.value.split(/\n\s*\n/);
    else if (k === 'pista') { d.pistas = d.pistas || ['', '', '']; d.pistas[+el.dataset.n] = el.value; }
    else if (el.dataset.num) d[k] = el.value === '' ? undefined : Number(el.value);
    else d[k] = el.value;
    pronto(); return;
  }
  if (el.dataset.k != null && el.dataset.i != null && el.dataset.t) {
    const a = est.def.averias[+el.dataset.i], k = el.dataset.k, t = el.dataset.t;
    if (t === 'nodos') { const s = new Set(a[k] || []); if (el.checked) s.add(el.dataset.sub); else s.delete(el.dataset.sub); a[k] = NODOS.map(n => n.n).filter(n => s.has(n)); }
    else if (t === 'memoria') { a[k] = Object.assign({}, a[k]); if (el.value === '') delete a[k][el.dataset.sub]; else a[k][el.dataset.sub] = Number(el.value); }
    else { const v = leerCampo(el); if (v === undefined) delete a[k]; else a[k] = v; }
    // cambiar de nodo cambia los servicios y ficheros que tiene sentido ofrecer
    if (t === 'nodo') {
      const hs = BASE.hosts[a.nodo];
      if (a.servicio && !(hs && hs.svcs[a.servicio])) delete a.servicio;
      pintar();
    }
    pronto();
  }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset.actCambio === 'tipo') {
    const i = +el.dataset.i, t = el.value;
    est.def.averias[i] = Object.assign({ tipo: t }, copia(P.averias[t].ejemplo));
    pintar(); ensayar(); return;
  }
  if (el.id === 'fichero' && el.files && el.files[0]) {
    const f = el.files[0], rd = new FileReader();
    rd.onload = () => { let d; try { d = JSON.parse(String(rd.result)); } catch (e) { est.msg = T('No es un JSON válido: ', 'Not valid JSON: ') + h(e.message); pintarEnsayo(); return; } if (!d || typeof d !== 'object' || Array.isArray(d)) { est.msg = T('El fichero no contiene una incidencia.', 'The file does not contain an incident.'); pintarEnsayo(); return; } cargar(d, f.name); };
    rd.readAsText(f);
  }
});
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, av = est.def.averias, i = +b.dataset.i;
  if (act === 'tema') { const o = document.body.classList.toggle('oscuro'); try { localStorage.setItem('puesto-tema', o ? 'oscuro' : 'claro'); } catch (e) { /* nada */ } return; }
  if (act === 'anadir') { const t = $('#nuevoTipo').value; av.push(Object.assign({ tipo: t }, copia(P.averias[t].ejemplo))); est.msg = null; pintar(); ensayar(); return; }
  if (act === 'familia') {
    const f = P.familias.find(x => x.id === $('#nuevaFamilia').value);
    f.crear(P.azar(1 + Math.floor(Math.random() * 1e9))).forEach(a => { if (av.length < 12) av.push(a); });
    est.msg = null; pintar(); ensayar(); return;
  }
  if (act === 'quitar') { av.splice(i, 1); pintar(); ensayar(); return; }
  if (act === 'subir' && i > 0) { [av[i - 1], av[i]] = [av[i], av[i - 1]]; pintar(); ensayar(); return; }
  if (act === 'bajar' && i < av.length - 1) { [av[i + 1], av[i]] = [av[i], av[i + 1]]; pintar(); ensayar(); return; }
  if (act === 'fichero') { const f = $('#fichero'); f.value = ''; f.click(); return; }
  if (act === 'cargar') {
    const v = $('#origen').value;
    if (v === 'blanco') { est.def = nueva(); est.msg = T('Incidencia en blanco.', 'Blank incident.'); pintar(); ensayar(); return; }
    if (v.indexOf('t:') === 0) { cargar(P.exportarIncidencia(P.escenario(v.slice(2))), T('el ticket ', 'ticket ') + v.slice(2)); return; }
    if (v.indexOf('i:') === 0) { const d = leer(CLAVE_IMP, []).find(x => x.id === v.slice(2)); if (d) cargar(d, T('la incidencia ', 'incident ') + v.slice(2)); return; }
    if (v.indexOf('g:') === 0) { const g = P.generarGuardia(+v.slice(2), 1 + Math.floor(Math.random() * 999999)); if (g.ok) { const d = copia(g.def); delete d.id; d.asunto = d.asunto.replace(/^Guardia/, 'Noche').replace(/ on-call shift/, ' night'); cargar(d, T('una guardia ' + P.nivelesGuardia[+v.slice(2)].toLowerCase(), 'a ' + P.nivelesGuardia[+v.slice(2)].toLowerCase() + ' shift')); } return; }
    return;
  }
  if (act === 'guardar') { const id = guardarEnCola(); if (id) { est.msg = T('✓ Guardada en la cola como <b>' + h(id) + '</b>. La verás en «Incidencias importadas».', '✓ Saved to the queue as <b>' + h(id) + '</b>. You will find it under “Imported incidents”.'); pintar(); ensayar(); } return; }
  if (act === 'probar') { const id = guardarEnCola(); if (id) location.href = './index.html#' + encodeURIComponent(id); return; }
  if (act === 'descargar') { const r = est.res; if (r && r.ok) descargar(r.escenario.id.toLowerCase() + '.json', JSON.stringify(Object.assign(limpio(est.def), { id: r.escenario.id }), null, 2)); return; }
});

try { const t = localStorage.getItem('puesto-tema'); if (t === 'oscuro' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.body.classList.add('oscuro'); } catch (e) { /* nada */ }
pintar(); ensayar();
P.compositor = { est, pintar, ensayar, cargar, limpio, guardarEnCola };   // para puesto-test.js
})();
