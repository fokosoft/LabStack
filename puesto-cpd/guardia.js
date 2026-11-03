// Puesto CPD · guardias y caos (fase 3).
//
// Una familia es un grupo coherente de averías del catálogo (averias.js), con
// sus parámetros al azar: qué servicio cae, en qué servidor se llena el disco,
// qué heap trae el despliegue... Con eso:
//   - una guardia combina familias que no se pisan, a partir de una semilla
//     (la misma semilla, la misma noche), sin ticket: sólo lo que ve Prometheus;
//   - el caos programa una avería unos minutos más tarde, en el laboratorio libre.
// Como cada familia se dice con el catálogo, una guardia es también una
// incidencia en fichero (def), que es lo que usará el compositor.
(function (P) {
'use strict';
const T = P.T, C = P.cpd;
P.azar = P.azar || (semilla => { let a = semilla >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
const uno = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];
P.nivelesGuardia = { 1: T('Tranquila', 'Quiet'), 2: T('Movida', 'Busy'), 3: T('Infierno', 'Hellish') };
const CON_FW = ['web01', 'web02', 'web03', 'db02'];

// ------------------------------------------------------------------ familias
// params(rnd) -> parámetros · averias(p) -> las averías del catálogo que la forman.
P.familias = [
  { id: 'servicio-caido', nivel: 1, titulo: T('Un servicio caído', 'A service down'), leccion: T('systemctl --failed y el journal dicen qué murió y por qué; después se mira qué arrastró', 'systemctl --failed and the journal say what died and why; then check what it dragged down'),
    params: rnd => { const x = uno(rnd, C.SERVICIOS_CAIBLES); return { host: x[0], servicio: x[1] }; }, averias: p => [{ tipo: 'servicio-caido', host: p.host, servicio: p.servicio }] },
  { id: 'disco-log', nivel: 1, titulo: T('Un disco lleno por un log olvidado', 'A disk filled by a forgotten log'), leccion: T('du -xh --max-depth=1 encuentra dónde está el espacio; un log que nadie escribe se vacía con truncate', 'du -xh --max-depth=1 finds where the space is; a log nobody writes to is emptied with truncate'),
    params: rnd => ({ host: uno(rnd, Object.keys(C.LOGS_GIGANTES)) }), averias: p => [{ tipo: 'log-gigante', host: p.host }] },
  { id: 'reloj', nivel: 1, titulo: T('Un reloj sin sincronizar', 'A clock out of sync'), leccion: T('chrony en marcha y chronyc makestep para corregir de golpe; después, chronyc tracking', 'chrony running and chronyc makestep to correct at once; then chronyc tracking'),
    params: rnd => ({ host: uno(rnd, ['web01', 'web02', 'web03', 'app01', 'db01', 'db02']) }), averias: p => [{ tipo: 'reloj-parado', host: p.host }] },
  { id: 'puerto-9100', nivel: 1, titulo: T('Prometheus no llega a un servidor', 'Prometheus cannot reach a server'), leccion: T('en local responde y desde fuera hay timeout: firewall-cmd --permanent y --reload', 'it answers locally and times out from outside: firewall-cmd --permanent and --reload'),
    params: rnd => ({ host: uno(rnd, CON_FW) }), averias: p => [{ tipo: 'firewall-sin-puerto', host: p.host }] },
  { id: 'facturacion-oom', nivel: 1, titulo: T('Un despliegue que no cabe en su contenedor', 'A deployment that does not fit its container'), leccion: T('137 y OOMKilled: el heap no cabe en mem_limit. Se cambia el compose y se recrea con docker compose up -d', '137 and OOMKilled: the heap does not fit in mem_limit. Change the compose file and recreate with docker compose up -d'),
    params: rnd => ({ version: uno(rnd, ['4.2.1', '4.2.2', '4.3.0']), xmx: uno(rnd, ['384m', '512m', '768m']) }), averias: p => [{ tipo: 'contenedor-oom', version: p.version, xmx: p.xmx }] },
  { id: 'tienda-selinux', nivel: 2, titulo: T('La tienda en 502 por SELinux', 'The store on 502 because of SELinux'), leccion: T('un Permission denied entre nginx y Tomcat es SELinux: ausearch, y setsebool -P con el booleano justo', 'a Permission denied between nginx and Tomcat is SELinux: ausearch, then setsebool -P with the right boolean'),
    params: () => ({}), averias: () => [{ tipo: 'selinux-booleano' }] },
  { id: 'log-abierto', nivel: 2, titulo: T('Un disco lleno que no se vacía al borrar', 'A full disk that does not empty when you delete'), leccion: T('si df y du no cuadran, lsof +L1: un fichero borrado que un proceso aún tiene abierto', 'if df and du disagree, lsof +L1: a deleted file a process still holds open'),
    params: () => ({}), averias: () => [{ tipo: 'log-borrado-abierto' }] },
  { id: 'certificado', nivel: 2, titulo: T('Un certificado caducado', 'An expired certificate'), leccion: T('la clave buena es la del mismo módulo; certificado más intermedia, nginx -t y reload', 'the right key has the same modulus; certificate plus intermediate, nginx -t and reload'),
    params: () => ({}), averias: () => [{ tipo: 'cert-caducado' }] },
  { id: 'pg-hba', nivel: 2, titulo: T('Una aplicación rechazada por pg_hba.conf', 'An application rejected by pg_hba.conf'), leccion: T('pg_hba.conf se lee de arriba abajo: la regla va encima del reject, y luego reload', 'pg_hba.conf is read top to bottom: the rule goes above the reject, then reload'),
    params: () => ({}), averias: () => [{ tipo: 'pg-hba-sin-regla' }] },
  { id: 'intranet-etiqueta', nivel: 2, titulo: T('La intranet en 403 por una etiqueta', 'The intranet on 403 because of a label'), leccion: T('un 403 con los permisos bien es SELinux: semanage fcontext y restorecon', 'a 403 with fine permissions is SELinux: semanage fcontext and restorecon'),
    params: () => ({}), averias: () => [{ tipo: 'selinux-etiqueta' }] },
  { id: 'copias', nivel: 2, titulo: T('Copias vacías que dicen OK', 'Empty backups that say OK'), leccion: T('se mira el tamaño, se prueban las credenciales con mysql y se comprueba la copia con gzip -t', 'check the size, test the credentials with mysql and verify the copy with gzip -t'),
    params: rnd => ({ clave: uno(rnd, ['Bk-Nov2026#', 'Copias#2026', 'Rot4cion#9']), noches: 1 + Math.floor(rnd() * 3) }), averias: p => [{ tipo: 'backup-credenciales', clave: p.clave, noches: p.noches }] },
  { id: 'plantilla-rocky', nivel: 3, titulo: T('La plantilla nueva de Rocky, en producción', 'The new Rocky template, in production'), leccion: T('una plantilla con SELinux y firewalld por defecto rompe dos cosas a la vez: el booleano de nginx y el puerto de Prometheus', 'a template with default SELinux and firewalld breaks two things at once: nginx\'s boolean and Prometheus\' port'),
    params: () => ({}), averias: () => [{ tipo: 'selinux-booleano' }, { tipo: 'firewall-sin-puerto', host: 'web01' }] },
  { id: 'bastionado', nivel: 3, titulo: T('La noche del bastionado', 'Hardening night'), leccion: T('Seguridad endureció db01 y rotó credenciales en db02: dos aplicaciones caen por lo mismo, y ninguna rotación se deshace', 'Security hardened db01 and rotated credentials on db02: two applications fall for the same reason, and no rotation gets undone'),
    params: rnd => ({ clave: uno(rnd, ['Bk-Nov2026#', 'Seg#Rot2026']) }), averias: p => [{ tipo: 'pg-hba-sin-regla' }, { tipo: 'backup-credenciales', clave: p.clave, noches: 1 }] },
  { id: 'acme-mal-dia', nivel: 3, titulo: T('Mal día para ACME', 'A bad day for ACME'), leccion: T('el despliegue de facturación no cabe en su contenedor y reportd llena /var de db01: dos causas distintas, dos arreglos distintos', 'the billing deployment does not fit its container and reportd fills db01\'s /var: two different causes, two different fixes'),
    params: rnd => ({ xmx: uno(rnd, ['512m', '768m']) }), averias: p => [{ tipo: 'contenedor-oom', version: '4.2.1', xmx: p.xmx }, { tipo: 'log-borrado-abierto' }] },
];
P.familias.forEach(f => {
  f.crear = rnd => f.averias(f.params(rnd));
  f.toca = p => [].concat(...f.averias(p).map(a => P.averias[a.tipo].toca(a)));
  f.aplicar = (st, p, min) => P.aplicarAverias(st, f.averias(p).map(a => Object.assign(a, { hace: -min })));
  f.pendientes = (st, p) => P.pendientesAverias(st, f.averias(p));
  f.arreglo = (st, p) => P.arregloAverias(st, f.averias(p));
});

// ------------------------------------------------------------------ guardia
const choca = (a, b) => a.some(x => b.indexOf(x) >= 0);
const { usado } = P.ayudasEscenario;
const MUTA = /systemctl (start|restart|reload|stop|enable)|setsebool|semanage|restorecon|chcon|firewall-cmd .*--(add|remove|reload)|sed -i|\btee\b|^(sudo )?cp |docker (compose|restart)|truncate|^(sudo )?rm |chronyc makestep|ssh-copy-id|backup-mariadb\.sh|lvextend/;
function guardiaDe(nivel, semilla, intento) {
  const rnd = P.azar(semilla * 31 + intento), elegidas = [];
  const exactas = P.familias.filter(f => f.nivel === nivel), pool = P.familias.filter(f => f.nivel <= nivel);
  const primera = uno(rnd, exactas), p0 = primera.params(rnd);
  elegidas.push({ f: primera, p: p0, toca: primera.toca(p0) });
  for (let k = 0; elegidas.length < nivel && k < 30; k++) {
    const f = uno(rnd, pool), p = f.params(rnd), t = f.toca(p);
    if (elegidas.some(x => x.f.id === f.id || choca(x.toca, t))) continue;
    elegidas.push({ f, p, toca: t });
  }
  const id = 'GRD-' + (semilla % 1000000).toString(36).toUpperCase().padStart(4, '0');
  const hace = 20 + Math.floor(rnd() * 60);
  const averias = () => [].concat(...elegidas.map(x => x.f.averias(x.p))).map(a => Object.assign(a, { hace }));
  const titulos = elegidas.map(x => x.f.titulo.toLowerCase()), lecciones = elegidas.map(x => x.f.leccion.charAt(0).toUpperCase() + x.f.leccion.slice(1) + '.');
  const asunto = T('Guardia ' + P.nivelesGuardia[nivel].toLowerCase() + ' · semilla ' + semilla, P.nivelesGuardia[nivel] + ' on-call shift · seed ' + semilla);
  const cuerpo = [T('Te ha saltado la guardia. No hay ticket: sólo lo que ve Prometheus.', 'You have been paged. There is no ticket: only what Prometheus sees.')];
  const e = {
    id, clave: id, tipo: 'incidente', nivel, area: T('Guardia', 'On call'), funciones: ['incid'], impacto: nivel === 1 ? 'medio' : 'alto', urgencia: 'alta',
    de: T('Busca de guardia', 'On-call pager'), asunto, cuerpo,
    inicio: -hace, abierto: -Math.min(10, hace),
    averias: averias(),
    practicas: [
      { t: T('Miraste las alertas antes de tocar nada', 'You looked at the alerts before touching anything'), ok: st => { const i = st.registro.findIndex(r => /amtool alert/.test(r.cmd)), j = st.registro.findIndex(r => MUTA.test(r.cmd)); return i >= 0 && (j < 0 || i < j); } },
      { t: T('Comprobaste las alertas al terminar', 'You checked the alerts when you finished'), ok: st => { let j = -1; st.registro.forEach((r, k) => { if (MUTA.test(r.cmd)) j = k; }); return st.registro.some((r, k) => k > j && /amtool alert/.test(r.cmd)); } },
      { t: T('No reiniciaste servidores para «ver si se arreglaba»', 'You did not reboot servers to "see if it fixed itself"'), ok: st => !usado(st, /\breboot\b|shutdown -r/) },
      { t: T('No quitaste protecciones (setenforce 0, parar firewalld)', 'You did not remove protections (setenforce 0, stopping firewalld)'), ok: st => !usado(st, /setenforce (0|[Pp]ermissive)|systemctl (stop|disable) firewalld/) },
    ],
    pistas: [
      T('Empieza por las alertas: amtool alert. Cada una dice en qué servidor mirar; la sala del CPD también.', 'Start with the alerts: amtool alert. Each one tells you which server to look at; so does the datacenter room.'),
      T('Esta noche hay ' + elegidas.length + ' cosa' + (elegidas.length > 1 ? 's' : '') + ' rota' + (elegidas.length > 1 ? 's' : '') + ': ' + titulos.join('; ') + '.', 'Tonight ' + elegidas.length + ' thing' + (elegidas.length > 1 ? 's are' : ' is') + ' broken: ' + titulos.join('; ') + '.'),
      T('Por dónde va el arreglo: ' + elegidas.map(x => x.f.leccion).join('; ') + '.', 'Where the fix lies: ' + elegidas.map(x => x.f.leccion).join('; ') + '.'),
    ],
    causa: T('Pasaban ' + (elegidas.length === 1 ? 'una cosa' : elegidas.length + ' cosas a la vez') + ': ', elegidas.length === 1 ? 'One thing was going on: ' : elegidas.length + ' things were going on at once: ') + titulos.join('; ') + '.',
    solucion: lecciones.join(' '), leccion: lecciones.join(' '),
    guion: st => ['amtool alert'].concat(P.arregloAverias(st, averias()), ['amtool alert']),
    trampas: [],
    guardia: { nivel, semilla, familias: elegidas.map(x => x.f.id) },
    def: { formato: P.FORMATO_INCIDENCIA || 'puesto-incidencia/1', tipo: 'incidente', nivel, impacto: nivel === 1 ? 'medio' : 'alto', urgencia: 'alta', hace, abiertoHace: Math.min(10, hace), asunto, de: T('Busca de guardia', 'On-call pager'), cuerpo, averias: averias() },
  };
  return P.normalizarEscenario(e);
}
// Una guardia sólo sale si avisa y si su propio arreglo la cierra; si no, se prueba otra combinación.
P.generarGuardia = (nivel, semilla) => {
  for (let k = 0; k < 8; k++) {
    const e = guardiaDe(nivel, semilla, k), st = P.preparar(e);
    if (!e.resuelto(st, P).length || !P.alertasActivas(st).length) continue;
    const ses = P.nuevaSesion();
    P.guionDe(e, st).forEach(c => { P.ejecutar(st, ses, c); P.expulsar(st, ses); });
    if (!e.resuelto(st, P).length) return { ok: true, escenario: e, def: e.def, intentos: k + 1 };
  }
  return { ok: false };
};

// ------------------------------------------------------------------ caos
// En el laboratorio libre: una avería de nivel 1 o 2 que pasará dentro de unos minutos.
P.provocarCaos = (st, semilla, previas) => {
  const rnd = P.azar(semilla), tocadas = [].concat(...(previas || []).map(a => a.toca || []));
  const pool = P.familias.filter(f => f.nivel <= 2);
  for (let k = 0; k < 30; k++) {
    const f = uno(rnd, pool), p = f.params(rnd), t = f.toca(p);
    if (choca(t, tocadas) || f.pendientes(st, p).length) continue;
    const cuando = st.reloj + 2 + Math.floor(rnd() * 4);
    (st.programados = st.programados || []).push({ min: cuando, fn: s => f.aplicar(s, p, cuando) });
    return { familia: f, averias: f.averias(p).map(a => Object.assign({ toca: P.averias[a.tipo].toca(a) }, a, a.host ? { nodo: a.host } : {})), cuando, params: p };
  }
  return null;
};
P.pendientesCaos = (st, provocadas) => [].concat(...provocadas.filter(c => c.cuando <= st.reloj).map(c => c.familia.pendientes(st, c.params)));
})(window.PUESTO = window.PUESTO || {});
