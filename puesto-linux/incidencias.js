// Puesto · incidencias en fichero.
//
// Una incidencia es un .json que combina averías del catálogo (averias.js) con
// los textos del ticket. Es sólo datos: no se ejecuta nada que venga del
// fichero. Aun así, no se acepta a ciegas:
//
//   1. estructura, tipos y tamaños (nada de textos de 1 MB ni campos raros)
//   2. el validador del catálogo (tipos que existen, nodos y servicios reales,
//      dos averías que no pisen la misma cosa)
//   3. un ENSAYO: se aplica sobre una plataforma nueva, tiene que romper algo,
//      y su solución de referencia (los arreglos de sus averías, encadenados)
//      tiene que dejarla resuelta. Si nadie podría cerrarla, no entra.
//
// Lo que el fichero no trae (pistas, causa, lección, buenas prácticas) se
// genera a partir de las averías.
(function (P) {
'use strict';
const U = P.u, L = U.L, T = P.T;
P.FORMATO_INCIDENCIA = 'puesto-incidencia/1';
const MAX_AVERIAS = 12;

// ------------------------------------------------------------------ campos derivados
const CEPH = ['disco-muerto', 'flag-ceph', 'balancer-apagado', 'config-ceph'];
const AUTO = ['rabbit-debug', 'fuga-memoria', 'certificado-caducado', 'regla-a-mano'];
const esCeph = a => CEPH.indexOf(a.tipo) >= 0 || /^ceph/.test(a.servicio || '') || /^ceph0/.test(a.nodo || '');
const rompen = lista => lista.filter(a => !P.averias[a.tipo].condicion);
function funcionesDe(lista) {
  const f = ['incid'];
  if (lista.some(esCeph)) f.unshift('ceph');
  if (lista.some(a => !esCeph(a) && a.tipo !== 'reloj-desfasado' && a.tipo !== 'registro-ceph')) f.unshift('openstack');
  if (lista.some(a => AUTO.indexOf(a.tipo) >= 0)) f.push('auto');
  return f;
}
function areaDe(lista) {
  const a = [];
  if (lista.some(esCeph)) a.push('Ceph');
  if (lista.some(x => /^(ctl|cmp)/.test(x.nodo || '') || ['volumen-atascado', 'vm-borrada', 'certificado-caducado', 'fuga-memoria', 'regla-a-mano'].indexOf(x.tipo) >= 0)) a.push('OpenStack');
  if (lista.some(x => ['disco-lleno', 'reloj-desfasado'].indexOf(x.tipo) >= 0)) a.push('Linux');
  return a.join(' · ') || T('Plataforma', 'Platform');
}
// Dónde hay que mirar, sin decir qué: la segunda pista.
function sitios(lista) {
  const s = [];
  rompen(lista).forEach(a => {
    const t = a.nodo ? a.nodo : a.tipo === 'disco-muerto' ? T('el clúster Ceph (y el nodo del osd.' + a.osd + ')', 'the Ceph cluster (and the node of osd.' + a.osd + ')') : CEPH.indexOf(a.tipo) >= 0 ? T('el clúster Ceph', 'the Ceph cluster') : a.tipo === 'certificado-caducado' ? T('la API (los controladores)', 'the API (the controllers)') : a.tipo === 'fuga-memoria' ? T('los controladores', 'the controllers') : a.tipo === 'regla-a-mano' ? T('los grupos de seguridad y Terraform', 'the security groups and Terraform') : 'OpenStack';
    if (s.indexOf(t) < 0) s.push(t);
  });
  return s;
}
// Lo que cambia de un puesto a otro (el Puesto Cloud trae el suyo en P.incidenciasCfg).
const CFG = Object.assign({
  funcionesDe, areaDe, sitios,
  alertas: 'amtool alert',
  pista: T('Empieza por lo que ven las alertas: amtool alert. Si Ceph está implicado, ceph -s y ceph health detail.', 'Start with what the alerts see: amtool alert. If Ceph is involved, ceph -s and ceph health detail.'),
  mirar: /amtool|ceph (-s|status|health|osd (tree|df))|systemctl status|journalctl|\bdf\b|\bdu\b|openstack .*(list|show)|\bfree\b|\btop\b|ps aux|dmesg|timedatectl|chronyc tracking/,
  tocar: /systemctl (start|restart|enable|reset-failed)|truncate|\brm\b|ansible-playbook|terraform apply|ceph osd (out|in|unset|set)|ceph balancer on|ceph config (set|rm)|volume (set|delete)|server create|chronyc makestep/,
  sinReiniciar: { t: T('No reiniciaste nodos enteros para arreglarlo', 'You did not reboot whole nodes to fix it'), ok: st => !st.hechos.reinicios.length },
  maxHace: 10080,   // una semana
  etiqueta: a => a.nodo ? ' (' + (a.servicio ? a.servicio + T(' en ', ' on ') : '') + a.nodo + ')' : a.osd != null ? ' (osd.' + a.osd + ')' : '',
}, P.incidenciasCfg || {});
const PRACTICAS = () => {
  const { antes, despues } = P.ayudasEscenario;
  return [
    { t: T('Miraste antes de tocar: alertas, estado o logs antes del primer cambio', 'You looked before touching: alerts, status or logs before the first change'), ok: st => antes(st, CFG.mirar, CFG.tocar) },
    { t: T('Comprobaste que estaba arreglado después del último cambio', 'You verified it was fixed after the last change'), ok: st => despues(st, CFG.mirar, CFG.tocar) },
    CFG.sinReiniciar,
  ];
};

// ------------------------------------------------------------------ construir
function construir(d) {
  const lista = d.averias;
  const hace = d.hace != null ? d.hace : Math.max(0, ...lista.map(a => a.hace || 0).filter(x => x <= CFG.maxHace));
  const e = {
    id: d.id || ('EXT-' + U.hex(d.asunto + JSON.stringify(lista), 4).toUpperCase()),
    clave: 'importada', importada: true, autor: d.autor || '', fuente: d,
    tipo: d.tipo || 'incidente', nivel: d.nivel || 2, area: d.area || CFG.areaDe(lista), funciones: d.funciones || CFG.funcionesDe(lista),
    impacto: d.impacto, urgencia: d.urgencia, de: d.de || T('Incidencia importada', 'Imported incident'), asunto: d.asunto, cuerpo: d.cuerpo,
    inicio: -hace, abierto: -(d.abiertoHace != null ? d.abiertoHace : Math.min(hace, 10)),
    averias: lista, trampas: [], practicas: PRACTICAS(),
    causa: d.causa || T('Varias cosas a la vez: ', 'Several things at once: ') + rompen(lista).map(a => P.averias[a.tipo].titulo.toLowerCase() + CFG.etiqueta(a)).join('; ') + '.',
    solucion: d.solucion || T('Arreglar cada avería de abajo arriba: primero lo que otros necesitan (servicios base, discos, flags), luego lo que depende de ello y al final los recursos. Y comprobar al terminar.', 'Fix each fault from the bottom up: first what others need (base services, disks, flags), then what depends on it, and resources last. And verify when you finish.'),
    leccion: d.leccion || T('Cuando fallan varias cosas a la vez, el orden importa: lo que otros necesitan va primero. Y una alerta que desaparece no es un arreglo comprobado: se mira el estado al terminar.', 'When several things fail at once, order matters: what others need comes first. And an alert that goes away is not a verified fix: check the state when you finish.'),
  };
  // La solución de referencia: mirar, arreglar cada avería en orden, comprobar.
  e.guion = st => [CFG.alertas].concat(P.arregloAverias(st, e.averias), [CFG.alertas]);
  P.normalizarEscenario(e);
  if (Array.isArray(d.pistas) && d.pistas.length === 3) e.pistas = d.pistas.slice();
  else {
    const st = P.preparar(e), sol = P.arregloAverias(st, lista).filter(c => !/^(exit|cd|sleep)\b/.test(c));
    e.pistas = [
      CFG.pista,
      T('Hay que mirar en: ' + CFG.sitios(lista).join(', ') + '. Antes de arreglar, averigua qué necesita cada cosa para funcionar: lo que otros necesitan va primero.', 'Places to look: ' + CFG.sitios(lista).join(', ') + '. Before fixing, find out what each thing needs in order to work: what others need comes first.'),
      T('Una solución, en orden: ', 'One solution, in order: ') + sol.join(' · '),
    ];
  }
  return e;
}

// ------------------------------------------------------------------ cargar
P.cargarIncidencia = function (entrada) {
  const errores = [], avisos = [];
  let d = entrada;
  if (typeof entrada === 'string') {
    if (entrada.length > 200000) return { ok: false, errores: [T('El fichero es demasiado grande para ser una incidencia', 'The file is too large to be an incident')], avisos };
    try { d = JSON.parse(entrada); } catch (e) { return { ok: false, errores: [T('No es un JSON válido: ', 'Not valid JSON: ') + e.message], avisos }; }
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, errores: [T('El fichero tiene que contener un objeto { … }', 'The file must contain an object { … }')], avisos };

  // 1. estructura
  if (d.formato !== P.FORMATO_INCIDENCIA) errores.push(T('formato: tiene que ser "', 'formato: must be "') + P.FORMATO_INCIDENCIA + '"' + (d.formato ? T(' (pone "', ' (found "') + d.formato + '")' : ''));
  const texto = (k, max, obligatorio) => {
    const v = d[k];
    if (v == null) { if (obligatorio) errores.push(k + T(': falta', ': missing')); return; }
    if (typeof v !== 'string' || !v.trim()) errores.push(k + T(': tiene que ser un texto', ': must be a text'));
    else if (v.length > max) errores.push(k + T(': demasiado largo (' + v.length + ' caracteres, máximo ' + max + ')', ': too long (' + v.length + ' characters, maximum ' + max + ')'));
  };
  texto('asunto', 160, true); texto('de', 120); texto('area', 60); texto('autor', 80);
  texto('causa', 1500); texto('solucion', 1500); texto('leccion', 1500);
  if (d.id != null) {
    if (typeof d.id !== 'string' || !/^[A-Z]{2,5}-[0-9A-Z]{2,8}$/.test(d.id)) errores.push(T('id: con la forma EXT-001 (mayúsculas, guion y números)', 'id: in the form EXT-001 (capital letters, hyphen and digits)'));
    else if (P.escenarios.some(e => e.id === d.id)) errores.push(T('id: ' + d.id + ' ya es un ticket del puesto; usa otro', 'id: ' + d.id + ' is already a built-in ticket; use another one'));
  }
  if (!Array.isArray(d.cuerpo) || !d.cuerpo.length || d.cuerpo.length > 6 || d.cuerpo.some(x => typeof x !== 'string' || !x.trim() || x.length > 1000)) errores.push(T('cuerpo: entre 1 y 6 párrafos de texto (máximo 1000 caracteres cada uno)', 'cuerpo: between 1 and 6 paragraphs of text (maximum 1000 characters each)'));
  if (['alto', 'medio', 'bajo'].indexOf(d.impacto) < 0) errores.push(T('impacto: alto, medio o bajo', 'impacto: alto, medio or bajo'));
  if (['alta', 'media', 'baja'].indexOf(d.urgencia) < 0) errores.push(T('urgencia: alta, media o baja', 'urgencia: alta, media or baja'));
  if (d.tipo != null && ['incidente', 'peticion', 'cambio'].indexOf(d.tipo) < 0) errores.push(T('tipo: incidente, peticion o cambio', 'tipo: incidente, peticion or cambio'));
  if (d.nivel != null && [1, 2, 3].indexOf(d.nivel) < 0) errores.push(T('nivel: 1, 2 o 3', 'nivel: 1, 2 or 3'));
  ['hace', 'abiertoHace'].forEach(k => { if (d[k] != null && !(Number.isInteger(d[k]) && d[k] >= 0 && d[k] <= CFG.maxHace)) errores.push(k + (CFG.maxHace === 10080 ? T(': minutos enteros entre 0 y 10080 (una semana)', ': whole minutes between 0 and 10080 (one week)') : T(': minutos enteros entre 0 y ' + CFG.maxHace, ': whole minutes between 0 and ' + CFG.maxHace))); });
  if (d.hace != null && d.abiertoHace != null && d.abiertoHace > d.hace) errores.push(T('abiertoHace: el ticket no puede abrirse antes de que empiece la avería', 'abiertoHace: the ticket cannot be opened before the fault starts'));
  if (d.pistas != null && (!Array.isArray(d.pistas) || d.pistas.length !== 3 || d.pistas.some(x => typeof x !== 'string' || !x.trim() || x.length > 400))) errores.push(T('pistas: exactamente 3 textos (máximo 400 caracteres cada uno), o ninguna para que se generen', 'pistas: exactly 3 texts (maximum 400 characters each), or none to have them generated'));
  if (d.funciones != null && (!Array.isArray(d.funciones) || d.funciones.some(f => !P.funciones.some(x => x.id === f)))) errores.push(T('funciones: una lista con ', 'funciones: a list of ') + P.funciones.map(f => f.id).join(', '));
  const conocidos = ['formato', 'id', 'tipo', 'asunto', 'de', 'cuerpo', 'impacto', 'urgencia', 'nivel', 'area', 'funciones', 'hace', 'abiertoHace', 'averias', 'pistas', 'causa', 'solucion', 'leccion', 'autor'];
  Object.keys(d).filter(k => conocidos.indexOf(k) < 0).forEach(k => avisos.push(T('campo desconocido «' + k + '»: se ignora', "unknown field '" + k + "': ignored")));
  if (!Array.isArray(d.averias) || !d.averias.length) errores.push(T('averias: hace falta una lista con al menos una avería', 'averias: a list with at least one fault is required'));
  else if (d.averias.length > MAX_AVERIAS) errores.push(T('averias: como mucho ', 'averias: at most ') + MAX_AVERIAS);
  else if (d.averias.some(a => !a || typeof a !== 'object' || Array.isArray(a) || typeof a.tipo !== 'string')) errores.push(T('averias: cada una tiene que ser un objeto con su "tipo"', 'averias: each one must be an object with its "tipo"'));
  if (errores.length) return { ok: false, errores, avisos };

  // 2. el catálogo
  P.validarAverias(d.averias).forEach(x => errores.push(x));
  if (errores.length) return { ok: false, errores, avisos };

  // 3. ensayo
  let e;
  try { e = construir(d); } catch (x) { return { ok: false, errores: [T('No se ha podido montar: ', 'Could not be built: ') + x.message], avisos }; }
  const st = P.preparar(e), antes = e.resuelto(st, P), alertas = P.alertasActivas(st).length;
  if (!antes.length) errores.push(T('No rompe nada: al aplicarla, la plataforma sigue sana (¿sólo tiene condiciones?)', 'It breaks nothing: once applied, the platform is still healthy (does it only have conditions?)'));
  if (e.tipo === 'incidente' && !alertas) avisos.push(T('No dispara ninguna alerta: se puede jugar con el ticket delante, pero en guardia nadie la encontraría', 'It fires no alerts: it can be played with the ticket in front of you, but on call nobody would find it'));
  if (-e.abierto >= P.prioridad(e).sla / 2) errores.push(T('abiertoHace: con prioridad ' + P.prioridad(e).p + ' el ticket nacería con más de medio SLA gastado', 'abiertoHace: with priority ' + P.prioridad(e).p + ' the ticket would open with more than half its SLA already spent'));
  const ses = P.nuevaSesion(), guion = P.guionDe(e, st), raros = [];
  guion.forEach(c => { const r = P.ejecutar(st, ses, c); if (r.lineas.some(l => /: command not found/.test(l.t))) raros.push(c); P.expulsar(st, ses); });
  if (raros.length) errores.push(T('Su solución usa comandos que no existen: ', 'Its solution uses commands that do not exist: ') + raros.join(', '));
  const quedan = e.resuelto(st, P);
  if (quedan.length && antes.length) errores.push(T('Su solución de referencia no la resuelve, así que nadie podría cerrarla: ', 'Its reference solution does not resolve it, so nobody could close it: ') + quedan.join(' · '));
  const ensayo = { averias: rompen(d.averias).length, condiciones: d.averias.length - rompen(d.averias).length, alertas, pendientes: antes.length, comandos: guion.length, minutos: st.reloj };
  return { ok: !errores.length, errores, avisos, escenario: errores.length ? null : e, ensayo };
};

// Un ticket del puesto hecho sólo de averías, como fichero: sirve de plantilla.
P.exportarIncidencia = e => {
  const d = { formato: P.FORMATO_INCIDENCIA, id: e.importada ? e.id : 'EXT-' + e.id.split('-')[1], tipo: e.tipo, asunto: e.asunto, de: e.de, cuerpo: e.cuerpo.slice(), impacto: e.impacto, urgencia: e.urgencia, nivel: e.nivel, area: e.area, hace: -e.inicio, abiertoHace: -e.abierto, averias: JSON.parse(JSON.stringify(e.averias)), pistas: e.pistas.slice(), causa: e.causa, solucion: e.solucion, leccion: e.leccion };
  if (e.autor) d.autor = e.autor;
  return d;
};
P.construirIncidencia = construir;   // para la vista previa del compositor, aunque el ensayo falle
P.exportables = () => P.escenarios.filter(e => !e.objetivo && e.averias && e.averias.some(a => !P.averias[a.tipo].condicion));

// Para quien escribe incidencias: el catálogo, legible.
P.catalogoLegible = () => Object.keys(P.averias).map(t => { const a = P.averias[t]; return { tipo: t, titulo: a.titulo, descripcion: a.descripcion || '', condicion: a.condicion, params: a.params, ejemplo: Object.assign({ tipo: t }, a.ejemplo) }; });

})(window.PUESTO = window.PUESTO || {});
