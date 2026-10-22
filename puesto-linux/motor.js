// Puesto · motor: el estado de la plataforma, el reloj simulado y la shell.
//
// Todo es determinista: el mismo escenario y los mismos comandos dan siempre
// la misma salida. Eso es lo que permite comprobarlo en Node sin navegador
// (puesto-test.js).
//
// Una sola fuente de verdad. Lo que enseña `ceph -s`, lo que pinta el panel y
// lo que dispara una alerta salen del mismo estado, así que arreglar algo con
// un comando lo arregla en todas partes a la vez. Nada de respuestas enlatadas.
//
// Los demás ficheros (cmd-ceph.js, cmd-openstack.js, cmd-auto.js) se enganchan
// a los registros de abajo: comandos, ficheros, reglas de arranque, ticks...
(function (P) {
'use strict';

const U = P.u = P.u || {};

// ------------------------------------------------------------------ idioma
// Se decide una vez, al cargar: ?lang= en la URL, lo guardado, el navegador.
// Cambiarlo recarga la página, así que T(es, en) puede usarse en cualquier
// sitio, también en los datos que se construyen al cargar (tickets, catálogo,
// glosario). La salida de los comandos va en inglés en los dos idiomas, como
// la imprimen las herramientas de verdad. Los tests fijan P.idioma antes de
// cargar motor.js.
if (P.idioma !== 'es' && P.idioma !== 'en') P.idioma = (function () {
  try {
    const q = /[?&]lang=(es|en)\b/.exec(location.search);
    if (q) { localStorage.setItem('puesto-idioma', q[1]); return q[1]; }
    const g = localStorage.getItem('puesto-idioma');
    if (g === 'es' || g === 'en') return g;
    return /^es\b/i.test(navigator.language || 'es') ? 'es' : 'en';
  } catch (e) { return 'es'; }
})();
const T = P.T = (es, en) => (P.idioma === 'en' ? en : es);
P.cambiarIdioma = () => {
  try { localStorage.setItem('puesto-idioma', P.idioma === 'en' ? 'es' : 'en'); } catch (e) { /* sin almacenamiento */ }
  location.href = location.href.replace(/([?&])lang=(es|en)&?/, '$1').replace(/[?&]$/, '');
};
// Lo fijo del HTML (cabecera, título) lleva su inglés en data-en.
if (typeof document !== 'undefined') {
  const traducirHtml = () => {
    document.documentElement.lang = P.idioma;
    if (P.idioma !== 'en') return;
    document.querySelectorAll('[data-en]').forEach(e => { e.textContent = e.dataset.en; });
    document.querySelectorAll('[data-en-title]').forEach(e => { e.title = e.dataset.enTitle; e.setAttribute('aria-label', e.dataset.enTitle); });
    const t = document.querySelector('meta[name=titulo-en]'); if (t) document.title = t.content;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', traducirHtml); else traducirHtml();
  document.addEventListener('click', ev => { if (ev.target.closest && ev.target.closest('[data-act=idioma]')) P.cambiarIdioma(); });
}
P.comandos = P.comandos || {};     // nombre -> { fn, donde, fuera, ayuda, grupo, completar }
P.ficheros = P.ficheros || [];     // (st, h) -> { ruta: { lineas(), mb } }
P.reglas = P.reglas || [];         // (st, h, unidad) -> motivo que impide arrancar | null
P.motivos = P.motivos || {};       // motivo -> { journal(), result, proceso, limite, alFallar() }
P.ticks = P.ticks || [];           // (st) -> lo que avanza cada minuto simulado
P.detectores = P.detectores || []; // (st, add) -> alertas
P.alCrear = P.alCrear || [];       // (st) -> cada módulo añade su parte del estado
P.alArrancar = P.alArrancar || [];
P.alParar = P.alParar || [];
P.alApagar = P.alApagar || [];
P.alVolver = P.alVolver || [];
P.generadoresLog = P.generadoresLog || [];

// ------------------------------------------------------------------ utilidades
const p2 = n => String(n).padStart(2, '0');
const T0 = Date.UTC(2026, 8, 23, 9, 12, 0);          // arranque del turno
const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fecha = (min, seg) => new Date(T0 + Math.round(min * 60000) + (seg || 0) * 1000);
U.p2 = p2;
U.seg = min => ((Math.round(min) * 37) % 60 + 60) % 60;
U.hora = min => { const d = fecha(min); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); };
U.sello = (min, seg) => { const d = fecha(min, seg == null ? U.seg(min) : seg); return MESES[d.getUTCMonth()] + ' ' + p2(d.getUTCDate()) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()); };
U.larga = (min, seg) => { const d = fecha(min, seg == null ? U.seg(min) : seg); return DIAS[d.getUTCDay()] + ' ' + d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()) + ' UTC'; };
U.iso = (min, seg) => fecha(min, seg == null ? U.seg(min) : seg).toISOString().slice(0, 19);
U.fechaCorta = min => { const d = fecha(min); return DIAS[d.getUTCDay()] + ' ' + MESES[d.getUTCMonth()] + ' ' + p2(d.getUTCDate()) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(U.seg(min)) + ' ' + d.getUTCFullYear(); };
U.hace = m => {
  m = Math.max(0, Math.round(m));
  if (m < 1) return '30s ago';
  if (m < 60) return m + 'min ago';
  if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return h + 'h ' + (r ? r + 'min ' : '') + 'ago'; }
  const d = Math.floor(m / 1440);
  if (d < 7) return d + ' day' + (d > 1 ? 's' : '') + ' ago';
  const w = Math.floor(d / 7);
  return w + ' week' + (w > 1 ? 's' : '') + ' ' + (d % 7) + ' days ago';
};
U.edad = m => { m = Math.max(0, Math.round(m)); return m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h' : Math.floor(m / 1440) + 'd'; };

// Hexadecimal determinista a partir de una semilla (FNV + LCG).
U.hex = (sem, n) => {
  let x = 2166136261; const s = String(sem);
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  let out = '';
  while (out.length < n) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out += (x >>> 4).toString(16).padStart(7, '0').slice(-6); }
  return out.slice(0, n);
};
U.uuid = sem => { const h = U.hex(sem, 32); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20); };
U.pid = sem => 1000 + (parseInt(U.hex(sem, 6), 16) % 60000);

const L = (t, c) => ({ t: String(t), c: c || 'out' });
U.L = L;
U.ls = (arr, c) => arr.map(t => L(t, c));

// Tabla con bordes, como la pinta el cliente de OpenStack.
U.tabla = (cab, filas) => {
  const w = cab.map((c, i) => Math.max(String(c).length, ...filas.map(f => String(f[i] == null ? '' : f[i]).length)));
  const sep = '+' + w.map(x => '-'.repeat(x + 2)).join('+') + '+';
  const fila = f => '| ' + f.map((c, i) => String(c == null ? '' : c).padEnd(w[i])).join(' | ') + ' |';
  return [sep, fila(cab), sep].concat(filas.map(fila), filas.length ? [sep] : []);
};
U.campos = pares => U.tabla(['Field', 'Value'], pares);

// Tamaños como los dan ls -h / du -h / df -h (base 1024). Entrada en MB.
U.tam = mb => {
  if (mb <= 0) return '0';
  let v = mb, u = 'M';
  if (v >= 1024) { v /= 1024; u = 'G'; } else if (v < 1) { v *= 1024; u = 'K'; }
  return (v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1) : String(Math.ceil(v))) + u;
};

// ------------------------------------------------------------------ topología
// Otra app (puesto-cloud) trae su propia plataforma: fija P.topologiaInicial
// antes de cargar este fichero. El primer nodo es el punto de entrada: donde
// empieza cada sesión y adonde vuelve cuando el nodo en el que estabas cae.
const TOPO = P.topologiaInicial || [
  { n: 'bastion', rol: 'bastion', ip: '10.10.0.5' },
  { n: 'ctl01', rol: 'ctl', ip: '10.10.1.11' },
  { n: 'ctl02', rol: 'ctl', ip: '10.10.1.12' },
  { n: 'ctl03', rol: 'ctl', ip: '10.10.1.13' },
  { n: 'cmp01', rol: 'cmp', ip: '10.10.2.21' },
  { n: 'cmp02', rol: 'cmp', ip: '10.10.2.22' },
  { n: 'cmp03', rol: 'cmp', ip: '10.10.2.23' },
  { n: 'cmp04', rol: 'cmp', ip: '10.10.2.24', nuevo: true },
  { n: 'ceph01', rol: 'ceph', ip: '10.10.3.31', osds: [0, 1, 2] },
  { n: 'ceph02', rol: 'ceph', ip: '10.10.3.32', osds: [3, 4, 5] },
  { n: 'ceph03', rol: 'ceph', ip: '10.10.3.33', osds: [6, 7, 8] },
  { n: 'mon01', rol: 'mon', ip: '10.10.4.41' },
];
P.topologia = TOPO;
P.entrada = TOPO[0].n;
P.roles = {
  bastion: T('Bastión: Ansible, Terraform y CLI de OpenStack', 'Bastion: Ansible, Terraform and the OpenStack CLI'),
  ctl: T('Controlador OpenStack (API, scheduler, RabbitMQ, Galera)', 'OpenStack controller (API, scheduler, RabbitMQ, Galera)'),
  cmp: T('Hipervisor KVM (nova-compute + libvirt)', 'KVM hypervisor (nova-compute + libvirt)'),
  ceph: T('Nodo Ceph: 1 mon, 1 mgr, 3 OSD', 'Ceph node: 1 mon, 1 mgr, 3 OSDs'),
  mon: T('Monitorización: Prometheus, Alertmanager, Grafana', 'Monitoring: Prometheus, Alertmanager, Grafana'),
};

const DESC = {
  ssh: 'OpenBSD Secure Shell server', chrony: 'chrony, an NTP client/server',
  haproxy: 'HAProxy Load Balancer', keepalived: 'Keepalive Daemon (LVS and VRRP)',
  mariadb: 'MariaDB 10.6.18 database server', 'rabbitmq-server': 'RabbitMQ Messaging Server',
  memcached: 'memcached daemon', apache2: 'The Apache HTTP Server',
  'nova-api': 'OpenStack Compute API', 'nova-scheduler': 'OpenStack Compute Scheduler',
  'nova-conductor': 'OpenStack Compute Conductor', 'neutron-server': 'OpenStack Neutron Server',
  'neutron-l3-agent': 'OpenStack Neutron L3 agent', 'neutron-dhcp-agent': 'OpenStack Neutron DHCP agent',
  'glance-api': 'OpenStack Image Service API', 'cinder-api': 'OpenStack Block Storage API',
  'cinder-scheduler': 'OpenStack Block Storage Scheduler', 'cinder-volume': 'OpenStack Block Storage Volume',
  libvirtd: 'Virtualization daemon', 'nova-compute': 'OpenStack Compute',
  'neutron-openvswitch-agent': 'OpenStack Neutron Open vSwitch agent', 'openvswitch-switch': 'Open vSwitch',
  prometheus: 'Monitoring system and time series database', alertmanager: 'Prometheus Alertmanager',
  'grafana-server': 'Grafana instance',
};
U.DESC = DESC;   // otra plataforma añade aquí sus servicios
U.desc = u => {
  if (DESC[u]) return DESC[u];
  const m = /^ceph-(osd|mon|mgr)@(.+)$/.exec(u);
  if (m) return m[1] === 'osd' ? 'Ceph object storage daemon osd.' + m[2] : m[1] === 'mon' ? 'Ceph cluster monitor daemon' : 'Ceph cluster manager daemon';
  return u;
};
U.binario = u => ({ 'openvswitch-switch': 'ovs-vswitchd', ssh: 'sshd', chrony: 'chronyd', 'rabbitmq-server': 'rabbitmq-server', mariadb: 'mariadbd', 'grafana-server': 'grafana' })[u] || u.split('@')[0];
const ALIAS = { chronyd: 'chrony', sshd: 'ssh', rabbitmq: 'rabbitmq-server', mysql: 'mariadb', mysqld: 'mariadb', grafana: 'grafana-server', httpd: 'apache2', libvirt: 'libvirtd' };
U.unidad = (h, nombre) => {
  let n = String(nombre || '').replace(/\.service$/, '');
  n = ALIAS[n] || n;
  const m = /^ceph-osd@osd\.(\d+)$/.exec(n); if (m) n = 'ceph-osd@' + m[1];
  return h.svcs[n] ? n : null;
};

function unidadesDe(d, provisionado) {
  const base = ['ssh', 'chrony'];
  if (d.unidades) return base.concat(d.unidades);
  if (d.rol === 'ctl') return base.concat(['haproxy', 'keepalived', 'mariadb', 'rabbitmq-server', 'memcached', 'apache2', 'nova-api', 'nova-scheduler', 'nova-conductor', 'neutron-server', 'neutron-l3-agent', 'neutron-dhcp-agent', 'glance-api', 'cinder-api', 'cinder-scheduler', 'cinder-volume']);
  if (d.rol === 'cmp') return provisionado ? base.concat(['libvirtd', 'nova-compute', 'openvswitch-switch', 'neutron-openvswitch-agent']) : base;
  if (d.rol === 'ceph') return base.concat(['ceph-mon@' + d.n, 'ceph-mgr@' + d.n]).concat(d.osds.map(i => 'ceph-osd@' + i));
  if (d.rol === 'mon') return base.concat(['prometheus', 'alertmanager', 'grafana-server']);
  return base;
}
U.nuevoSvc = (u, min) => {
  const m = min == null ? -17280 : min;
  return { estado: 'active', enabled: true, desde: m, motivo: null, limite: false, log: [{ min: m, src: 'systemd[1]', t: 'Started ' + U.desc(u) + '.' }] };
};

function logsBase(h, d) {
  const g = h.logs, n = h.nombre;
  g['/var/log/syslog'] = 38; g['/var/log/syslog.1'] = 52; g['/var/log/auth.log'] = 3; g['/var/log/kern.log'] = 6;
  g['/var/log/journal/' + U.hex(n, 32) + '/system.journal'] = 1180;
  if (d.rol === 'ctl') {
    g['/var/log/rabbitmq/rabbit@' + n + '.log'] = 96; g['/var/log/rabbitmq/rabbit@' + n + '.log.1'] = 210;
    g['/var/log/rabbitmq/rabbit@' + n + '.log.2.gz'] = 31;
    g['/var/log/nova/nova-api.log'] = 380; g['/var/log/nova/nova-scheduler.log'] = 120; g['/var/log/nova/nova-conductor.log'] = 140;
    g['/var/log/neutron/neutron-server.log'] = 290; g['/var/log/apache2/keystone.log'] = 85;
    g['/var/log/glance/glance-api.log'] = 44; g['/var/log/cinder/cinder-volume.log'] = 61;
  }
  if (d.rol === 'cmp' && h.provisionado) U.logsCompute(h);
  if (d.rol === 'ceph') {
    g['/var/log/ceph/ceph.log'] = 160; g['/var/log/ceph/ceph-mon.' + n + '.log'] = 55;
    d.osds.forEach(i => { g['/var/log/ceph/ceph-osd.' + i + '.log'] = 70 + i; });
  }
  if (d.rol === 'mon') g['/var/log/grafana/grafana.log'] = 24;
  if (d.logs) Object.assign(g, d.logs);
}
U.logsCompute = h => { h.logs['/var/log/nova/nova-compute.log'] = 210; h.logs['/var/log/libvirt/libvirtd.log'] = 12; h.logs['/var/log/neutron/neutron-openvswitch-agent.log'] = 95; };

// ------------------------------------------------------------------ estado
// Un nodo a partir de su descripción. P.crear monta así la plataforma entera;
// la nube lo usa también en mitad de la partida, al lanzar una instancia.
// d.unidades, d.discos, d.logs y d.ram sustituyen a lo que da el rol.
U.crearHost = (d, min) => {
  const prov = !d.nuevo, m = min == null ? -17280 : min;
  const h = {
    nombre: d.n, rol: d.rol, ip: d.ip, osds: d.osds || [], up: true, vuelveEn: null, arrancado: m,
    provisionado: prov, kernel: d.kernel || '5.15.0-119-generic', kernelNuevo: null, kernelDisponible: null,
    svcs: {}, discos: {}, logs: {}, ntp: { sync: true, offset: 0.000014, deriva: 0 }, dmesg: [], extra: {},
  };
  if (d.ram) h.ram = d.ram;
  if (d.ramBase != null) h.ramBase = d.ramBase;
  unidadesDe(d, prov).forEach(u => { h.svcs[u] = U.nuevoSvc(u, min); });
  if (d.discos) Object.keys(d.discos).forEach(k => { h.discos[k] = Object.assign({}, d.discos[k]); });
  else {
    h.discos['/'] = { dev: '/dev/mapper/vg0-root', tamG: 48, baseG: 11.6 };
    if (d.rol === 'ctl') h.discos['/var'] = { dev: '/dev/mapper/vg0-var', tamG: 40, baseG: 8.4 };
    if (d.rol === 'cmp') h.discos['/var/lib/nova'] = { dev: '/dev/mapper/vg0-nova', tamG: 800, baseG: prov ? 214 : 0.1 };
    if (d.rol === 'mon') h.discos['/var/lib/prometheus'] = { dev: '/dev/mapper/vg0-prom', tamG: 200, baseG: 91 };
  }
  logsBase(h, d);
  return h;
};
P.crear = function () {
  const st = { reloj: 0, hosts: {}, registro: [], hechos: { reinicios: [], playbooks: [], tf: [] }, alertasDesde: {}, inicioFallo: 0 };
  TOPO.forEach(d => { st.hosts[d.n] = U.crearHost(d); });
  P.alCrear.forEach(f => f(st));
  P.refrescarAlertas(st);
  return st;
};

// ------------------------------------------------------------------ discos
U.montaje = (h, ruta) => {
  let mejor = '/';
  Object.keys(h.discos).forEach(m => { if (m !== '/' && (ruta === m || ruta.indexOf(m + '/') === 0) && m.length > mejor.length) mejor = m; });
  return mejor;
};
U.usadoG = (h, m) => {
  let mb = 0;
  Object.keys(h.logs).forEach(p => { if (U.montaje(h, p) === m) mb += h.logs[p]; });
  return Math.min(h.discos[m].tamG, h.discos[m].baseG + mb / 1024);
};
U.pctDisco = (h, m) => Math.min(100, Math.ceil(U.usadoG(h, m) / h.discos[m].tamG * 100));
U.libreG = (h, m) => Math.max(0, h.discos[m].tamG - U.usadoG(h, m));

// ------------------------------------------------------------------ unidades
U.logSvc = (h, u, min, src, t) => { const s = h.svcs[u]; s.log.push({ min, src, t }); if (s.log.length > 80) s.log.shift(); };
U.srcDe = (h, u) => U.binario(u) + '[' + U.pid(h.nombre + u + h.svcs[u].desde) + ']';

// Deja una unidad caída con su rastro en el journal. La usan los escenarios y
// también arrancar() cuando algo le impide levantar.
P.fallar = function (st, host, u, motivo, min) {
  const h = typeof host === 'string' ? st.hosts[host] : host, s = h.svcs[u];
  const m = P.motivos[motivo] || {};
  s.estado = 'failed'; s.motivo = motivo; s.desde = min == null ? st.reloj : min;
  (m.journal ? m.journal(st, h, u, s.desde) : []).forEach(x => U.logSvc(h, u, x.min != null ? x.min : s.desde, x.src || U.srcDe(h, u), x.t));
  if (m.limite) {
    U.logSvc(h, u, s.desde, 'systemd[1]', u + '.service: Start request repeated too quickly.');
    s.limite = true;
  }
  U.logSvc(h, u, s.desde, 'systemd[1]', u + ".service: Failed with result '" + (m.result || 'exit-code') + "'.");
  U.logSvc(h, u, s.desde, 'systemd[1]', 'Failed to start ' + U.desc(u) + '.');
  if (m.alFallar) m.alFallar(st, h, u);
};
// Parada limpia: un admin, un paquete que se actualiza...
P.parado = function (st, host, u, min, deshabilitar) {
  const h = typeof host === 'string' ? st.hosts[host] : host, s = h.svcs[u];
  s.estado = 'inactive'; s.motivo = null; s.desde = min == null ? st.reloj : min;
  U.logSvc(h, u, s.desde, 'systemd[1]', 'Stopping ' + U.desc(u) + '...');
  U.logSvc(h, u, s.desde, 'systemd[1]', u + '.service: Deactivated successfully.');
  U.logSvc(h, u, s.desde, 'systemd[1]', 'Stopped ' + U.desc(u) + '.');
  if (deshabilitar) s.enabled = false;
};
P.impedimento = (st, h, u) => { for (const r of P.reglas) { const m = r(st, h, u); if (m) return m; } return null; };
P.arrancar = function (st, h, u) {
  const s = h.svcs[u];
  const m = P.impedimento(st, h, u);
  if (m) { P.fallar(st, h, u, m, st.reloj); return m; }
  s.estado = 'active'; s.motivo = null; s.limite = false; s.desde = st.reloj;
  U.logSvc(h, u, st.reloj, 'systemd[1]', 'Started ' + U.desc(u) + '.');
  P.alArrancar.forEach(f => f(st, h, u));
  return null;
};
P.parar = function (st, h, u) {
  const s = h.svcs[u];
  if (s.estado === 'active') {
    U.logSvc(h, u, st.reloj, 'systemd[1]', 'Stopping ' + U.desc(u) + '...');
    U.logSvc(h, u, st.reloj, 'systemd[1]', u + '.service: Deactivated successfully.');
    U.logSvc(h, u, st.reloj, 'systemd[1]', 'Stopped ' + U.desc(u) + '.');
  }
  s.estado = 'inactive'; s.motivo = null; s.desde = st.reloj;
  P.alParar.forEach(f => f(st, h, u));
};
// restart: si la unidad está bloqueada por el límite de arranques, ni lo intenta.
P.reiniciarUnidad = function (st, h, u) {
  const s = h.svcs[u];
  if (s.limite) return 'limite';
  if (s.estado === 'active') P.parar(st, h, u);
  return P.arrancar(st, h, u);
};

// ------------------------------------------------------------------ reinicios
P.reiniciar = function (st, h) {
  const dur = h.rol === 'ceph' ? 12 : 4;   // los nodos Ceph tardan: POST de la controladora
  P.alApagar.forEach(f => f(st, h));
  h.up = false; h.vuelveEn = st.reloj + dur;
  return dur;
};
function volver(st, h) {
  h.up = true; h.vuelveEn = null; h.arrancado = st.reloj;
  if (h.kernelNuevo) { h.kernel = h.kernelNuevo; h.kernelNuevo = null; }
  h.dmesg = [];
  Object.keys(h.svcs).forEach(u => {
    const s = h.svcs[u]; s.limite = false;
    if (s.enabled) P.arrancar(st, h, u);
    else if (s.estado !== 'inactive') { s.estado = 'inactive'; s.motivo = null; s.desde = st.reloj; }
  });
  P.alVolver.forEach(f => f(st, h));
}

// ------------------------------------------------------------------ reloj
U.ntpOk = h => !!(h.svcs.chrony && h.svcs.chrony.estado === 'active' && Math.abs(h.ntp.offset) < 0.05);
P.alArrancar.push((st, h, u) => { if (u === 'chrony') h.ntp.sync = true; });
P.alParar.push((st, h, u) => { if (u === 'chrony') h.ntp.sync = false; });

function tick(st) {
  st.reloj++;
  Object.values(st.hosts).forEach(h => { if (!h.up && h.vuelveEn != null && st.reloj >= h.vuelveEn) volver(st, h); });
  Object.values(st.hosts).forEach(h => {
    if (!h.up) return;
    const c = h.svcs.chrony;
    if (c && c.estado === 'active') {
      h.ntp.sync = true;
      // chrony corrige poco a poco (slew): ~30 ms por minuto, no de golpe.
      const a = Math.abs(h.ntp.offset);
      if (a > 0.00002) h.ntp.offset = Math.sign(h.ntp.offset) * Math.max(0.000012, a - 0.03);
    } else { h.ntp.sync = false; h.ntp.offset += (h.ntp.deriva || 0); }
  });
  P.ticks.forEach(f => f(st));
  // Lo que un escenario deja programado para un minuto concreto (una VM que
  // crea un pipeline mientras trabajas, por ejemplo).
  (st.programados || []).forEach(e => { if (e.min === st.reloj) e.fn(st, P); });
  P.refrescarAlertas(st);
}
P.avanzar = (st, n) => { for (let i = 0; i < n; i++) tick(st); };
U.hasta = (st, cond, max) => { let i = 0; while (!cond() && i < max) { tick(st); i++; } return i; };

// ------------------------------------------------------------------ alertas
const RANGO = { critical: 0, warning: 1, info: 2 };
P.alertas = st => {
  const out = [];
  const add = (nombre, sev, host, res, clave) => out.push({ clave: clave || (nombre + '|' + (host || '')), nombre, sev, host: host || null, res });
  P.detectores.forEach(f => f(st, add));
  return out;
};
P.refrescarAlertas = st => {
  const act = P.alertas(st), vistos = {};
  act.forEach(a => {
    vistos[a.clave] = 1;
    if (st.alertasDesde[a.clave] == null) st.alertasDesde[a.clave] = (st.reloj === 0 && st.inicioFallo) ? st.inicioFallo : st.reloj;
  });
  Object.keys(st.alertasDesde).forEach(k => { if (!vistos[k]) delete st.alertasDesde[k]; });
  return act;
};
P.alertasActivas = st => P.alertas(st)
  .map(a => Object.assign(a, { desde: st.alertasDesde[a.clave] != null ? st.alertasDesde[a.clave] : st.reloj }))
  .sort((a, b) => RANGO[a.sev] - RANGO[b.sev] || a.desde - b.desde || (a.clave < b.clave ? -1 : 1));

P.detectores.push((st, add) => {
  Object.values(st.hosts).forEach(h => {
    if (!h.up) { add('NodeDown', 'critical', h.nombre, h.nombre + T(' no responde (node_exporter sin datos)', ' is not responding (no node_exporter data)')); return; }
    Object.keys(h.svcs).forEach(u => { if (h.svcs[u].estado === 'failed') add('SystemdUnitFailed', 'warning', h.nombre, u + T('.service en estado failed', '.service is in failed state'), 'SystemdUnitFailed|' + h.nombre + '|' + u); });
    Object.keys(h.discos).forEach(m => {
      const p = U.pctDisco(h, m);
      if (p >= 90) add('NodeFilesystemAlmostFull', 'critical', h.nombre, m + T(' al ', ' at ') + p + ' %', 'NodeFilesystemAlmostFull|' + h.nombre + '|' + m);
      else if (p >= 80) add('NodeFilesystemAlmostFull', 'warning', h.nombre, m + T(' al ', ' at ') + p + ' %', 'NodeFilesystemAlmostFull|' + h.nombre + '|' + m);
    });
    if (!U.ntpOk(h)) add('NodeClockNotSynchronising', 'warning', h.nombre, T('reloj sin sincronizar (desfase ', 'clock not synchronized (offset ') + Math.abs(h.ntp.offset).toFixed(3) + ' s)');
    if (h.kernelNuevo) add('NodeRebootRequired', 'info', h.nombre, 'kernel ' + h.kernelNuevo + T(' instalado, falta reiniciar', ' installed, reboot pending'));
  });
});

// Estado de un nodo para el panel: caido > fallo > aviso > reserva > ok.
P.estadoHost = (st, h) => {
  if (!h.up) return 'caido';
  const al = P.alertas(st).filter(a => a.host === h.nombre && a.sev !== 'info');
  if (al.some(a => a.sev === 'critical')) return 'fallo';
  if (al.length) return 'aviso';
  if (!h.provisionado) return 'reserva';
  return 'ok';
};

// ------------------------------------------------------------------ ficheros
const HOME = '/home/admin';
U.HOME = HOME;
U.home = ses => ses.root ? '/root' : HOME;
U.ruta = (cwd, p, ses) => {
  if (!p) return cwd;
  if (p === '~') p = U.home(ses || {});
  else if (p.indexOf('~/') === 0) p = U.home(ses || {}) + p.slice(1);
  const partes = (p[0] === '/' ? p : cwd + '/' + p).split('/');
  const out = [];
  partes.forEach(x => { if (!x || x === '.') return; if (x === '..') out.pop(); else out.push(x); });
  return '/' + out.join('/');
};

const OS_RELEASE = ['PRETTY_NAME="Ubuntu 22.04.4 LTS"', 'NAME="Ubuntu"', 'VERSION_ID="22.04"', 'VERSION="22.04.4 LTS (Jammy Jellyfish)"', 'VERSION_CODENAME=jammy', 'ID=ubuntu', 'ID_LIKE=debian', 'HOME_URL="https://www.ubuntu.com/"', 'UBUNTU_CODENAME=jammy'];
P.ficheros.push((st, h) => {
  const f = {};
  f['/etc/hostname'] = { lineas: () => [h.nombre] };
  f['/etc/os-release'] = { lineas: () => OS_RELEASE };
  f['/etc/hosts'] = { lineas: () => ['127.0.0.1 localhost', '10.10.1.10 api.retail.local vip-api'].concat(TOPO.map(d => d.ip + ' ' + d.n + '.retail.local ' + d.n)) };
  f['/etc/chrony/chrony.conf'] = { lineas: () => [T('# Gestionado por Ansible (playbooks/chrony.yml). No editar a mano.', '# Managed by Ansible (playbooks/chrony.yml). Do not edit by hand.'),'server ntp1.retail.local iburst', 'server ntp2.retail.local iburst', 'driftfile /var/lib/chrony/chrony.drift', 'makestep 1 3', 'rtcsync', 'logdir /var/log/chrony'] };
  if (h.kernelNuevo) f['/var/run/reboot-required'] = { lineas: () => ['*** System restart required ***'] };
  Object.keys(h.logs).forEach(p => { f[p] = { mb: h.logs[p], lineas: () => P.contenidoLog(st, h, p) }; });
  return f;
});
P.contenidoLog = (st, h, p) => {
  for (const g of P.generadoresLog) { const r = g(st, h, p); if (r) return r; }
  if (/\/journal\//.test(p) || /\.gz$/.test(p)) return null;   // binario o comprimido
  if (/\/kern\.log$/.test(p)) return U.syslog(st, h, 40, true);
  if (/\/syslog$/.test(p)) return U.syslog(st, h, 40);
  if (/auth\.log$/.test(p)) return [U.sello(st.reloj - 3) + ' ' + h.nombre + ' sshd[' + U.pid(h.nombre + 'ssh') + ']: Accepted publickey for admin from 10.10.0.5 port 51822 ssh2: ED25519 SHA256:q1c9Jk2Qx0p7', U.sello(st.reloj - 3) + ' ' + h.nombre + ' sshd[' + U.pid(h.nombre + 'ssh') + ']: pam_unix(sshd:session): session opened for user admin(uid=1000) by (uid=0)'];
  return [U.sello(st.reloj - 30) + ' ' + h.nombre + T(' (sin novedades)', ' (nothing new)')];
};
// syslog = el journal de todas las unidades, mezclado por hora.
U.syslog = (st, h, n, soloKernel) => {
  if (soloKernel) return h.dmesg.length ? h.dmesg.map(d => U.sello(st.reloj - 2) + ' ' + h.nombre + ' kernel: ' + d.replace(/^\[[^\]]+\]\s*/, '')) : [U.sello(h.arrancado) + ' ' + h.nombre + ' kernel: Linux version ' + h.kernel + ' (buildd@lcy02-amd64-051)'];
  const todo = [];
  Object.keys(h.svcs).forEach(u => h.svcs[u].log.forEach(x => todo.push(x)));
  todo.sort((a, b) => a.min - b.min);
  return todo.slice(-n).map(x => U.sello(x.min) + ' ' + h.nombre + ' ' + x.src + ': ' + x.t);
};

P.vfs = (st, h) => {
  const f = {};
  P.ficheros.forEach(g => Object.assign(f, g(st, h) || {}));
  const dirs = { '/': true };
  Object.keys(f).forEach(p => { let d = p.slice(0, p.lastIndexOf('/')); while (d) { dirs[d] = true; d = d.slice(0, d.lastIndexOf('/')); } });
  ['/home', HOME, '/root', '/tmp', '/etc', '/var', '/var/log', '/usr', '/opt'].forEach(d => { dirs[d] = true; });
  return { f, dirs };
};
U.hijos = (fs, dir) => {
  const pref = dir === '/' ? '/' : dir + '/', out = {};
  Object.keys(fs.f).concat(Object.keys(fs.dirs)).forEach(p => {
    if (p.indexOf(pref) !== 0 || p === dir) return;
    const resto = p.slice(pref.length); if (!resto) return;
    const nombre = resto.split('/')[0];
    out[nombre] = fs.dirs[pref + nombre] ? 'd' : 'f';
  });
  return out;
};
U.tamRuta = (fs, p) => {
  if (fs.f[p]) return fs.f[p].mb || 0.004;
  let mb = 0; Object.keys(fs.f).forEach(x => { if (p === '/' || x.indexOf(p + '/') === 0) mb += fs.f[x].mb || 0.004; });
  return mb;
};
// Expande un * en el último tramo: /var/log/* , rabbit@ctl02.log*
U.glob = (fs, cwd, arg, ses) => {
  if (arg.indexOf('*') < 0) return [U.ruta(cwd, arg, ses)];
  const abs = U.ruta(cwd, arg, ses), dir = abs.slice(0, abs.lastIndexOf('/')) || '/', pat = abs.slice(abs.lastIndexOf('/') + 1);
  const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const hijos = Object.keys(U.hijos(fs, dir)).filter(n => re.test(n)).sort();
  return hijos.length ? hijos.map(n => (dir === '/' ? '' : dir) + '/' + n) : [abs];
};

// ------------------------------------------------------------------ sesión
P.nuevaSesion = () => ({ host: P.entrada, cwd: HOME, env: {}, root: false, pila: [], pendiente: null, hist: [] });
P.prompt = ses => {
  if (ses.pendiente) return ses.pendiente.prompt || '> ';
  const hm = U.home(ses); let c = ses.cwd;
  if (c === hm) c = '~'; else if (c.indexOf(hm + '/') === 0) c = '~' + c.slice(hm.length);
  return (ses.root ? 'root' : ses.usuario || 'admin') + '@' + ses.host + ':' + c + (ses.root ? '# ' : '$ ');
};
U.entrar = (ses, host, cwd, root, usuario) => { ses.pila.push({ host: ses.host, cwd: ses.cwd, env: ses.env, root: ses.root, usuario: ses.usuario }); ses.host = host; ses.cwd = cwd; ses.env = {}; ses.root = !!root; if (usuario !== undefined) ses.usuario = usuario; };
U.salir = ses => { const f = ses.pila.pop(); if (!f) return false; ses.host = f.host; ses.cwd = f.cwd; ses.env = f.env; ses.root = f.root; ses.usuario = f.usuario; return true; };

// Si el equipo en el que estás se ha reiniciado, te echa como haría ssh.
P.expulsar = function (st, ses) {
  const out = [];
  while (ses.host !== P.entrada && !(st.hosts[ses.host] && st.hosts[ses.host].up)) {
    out.push(L('Connection to ' + ses.host + ' closed by remote host.', 'dim'));
    out.push(L('Connection to ' + ses.host + ' closed.', 'dim'));
    const caido = ses.host;
    while (ses.host === caido) { if (!U.salir(ses)) { Object.assign(ses, { host: P.entrada, cwd: HOME, env: {}, root: false }); break; } }
  }
  return out;
};

// ------------------------------------------------------------------ parser
U.args = s => {
  const out = []; let cur = '', q = null, hay = false;
  for (const ch of s) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; hay = true; continue; }
    if (/\s/.test(ch)) { if (cur || hay) { out.push(cur); cur = ''; hay = false; } continue; }
    cur += ch;
  }
  if (cur || hay) out.push(cur);
  return out;
};
function partir(s, modo) {
  const out = []; let cur = '', q = null, op = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (modo === 'cadena') {
      if (ch === '&' && s[i + 1] === '&') { out.push({ txt: cur, op }); op = '&&'; cur = ''; i++; continue; }
      if (ch === ';') { out.push({ txt: cur, op }); op = ';'; cur = ''; continue; }
    } else if (ch === '|' && s[i + 1] !== '|' && s[i - 1] !== '|') { out.push({ txt: cur }); cur = ''; continue; }
    cur += ch;
  }
  out.push({ txt: cur, op });
  return out.filter(x => x.txt.trim());
}
U.num = (a, def) => {
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === '-n' || a[i] === '--lines') && a[i + 1]) return parseInt(a[i + 1], 10) || def;
    const m = /^-n?(\d+)$/.exec(a[i]); if (m) return parseInt(m[1], 10);
  }
  return def;
};
function filtrar(lineas, txt) {
  const a = U.args(txt), cmd = a[0];
  const err = lineas.filter(l => l.c === 'err'), sal = lineas.filter(l => l.c !== 'err');
  let r;
  if (cmd === 'grep' || cmd === 'egrep') {
    let inv = false, ic = false, cnt = false, pat = null;
    a.slice(1).forEach(x => {
      if (/^-[a-zA-Z]+$/.test(x)) { if (x.indexOf('v') >= 0) inv = true; if (x.indexOf('i') >= 0) ic = true; if (x.indexOf('c') >= 0) cnt = true; }
      else if (pat == null) pat = x;
    });
    if (pat == null) return [L('Usage: grep [OPTION]... PATTERNS [FILE]...', 'err')];
    let re; try { re = new RegExp(pat, ic ? 'i' : ''); } catch (e) { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ic ? 'i' : ''); }
    r = sal.filter(l => re.test(l.t) !== inv);
    if (cnt) r = [L(String(r.length))];
  } else if (cmd === 'head') r = sal.slice(0, U.num(a, 10));
  else if (cmd === 'tail') r = sal.slice(-U.num(a, 10));
  else if (cmd === 'wc') r = [L(String(sal.length))];
  else if (['less', 'more', 'cat', 'column'].indexOf(cmd) >= 0) r = sal;
  else if (cmd === 'sort') r = sal.slice().sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
  else return err.concat([L(cmd + ': command not found', 'err')]);
  return err.concat(r);
}
U.filtrar = filtrar;

// ------------------------------------------------------------------ ejecutar
function correr(st, ses, txt) {
  let a = U.args(txt);
  if (!a.length) return { lineas: [], minutos: 0 };
  let sudo = false;
  if (a[0] === 'sudo') {
    a = a.slice(1); sudo = true;
    if (!a.length || a[0] === '-h') return { lineas: [L('usage: sudo -h | -K | -k | -V', 'err'), L('usage: sudo [-u user] command', 'err')], minutos: 0 };
    if (a[0] === '-i' || a[0] === '-s' || (a[0] === 'su' && (a.length === 1 || a[1] === '-'))) { U.entrar(ses, ses.host, '/root', true); return { lineas: [], minutos: 0 }; }
  }
  while (a.length && /^[A-Z_]+=/.test(a[0])) a = a.slice(1);   // VAR=valor comando
  if (!a.length) return { lineas: [], minutos: 0 };
  const nombre = a[0], h = st.hosts[ses.host], c = P.comandos[nombre];
  if (!c) return { lineas: [L((sudo ? 'sudo: ' : '') + nombre + ': command not found', 'err')], minutos: 0 };
  if (c.donde && c.donde.indexOf(h.rol) < 0 && c.donde.indexOf(h.nombre) < 0) {
    return { lineas: [L(nombre + ': command not found', 'err')].concat(c.fuera ? [L(c.fuera, 'dim')] : []), minutos: 0 };
  }
  if (c.provisionado && !h.provisionado) return { lineas: [L(nombre + ': command not found', 'err'), L(T('(' + h.nombre + ' aún no tiene OpenStack instalado)', '(' + h.nombre + ' does not have OpenStack installed yet)'), 'dim')], minutos: 0 };
  const ctx = { st, ses, h, sudo: sudo || ses.root, args: a.slice(1), txt, nombre };
  const r = c.fn(ctx);
  if (!r) return { lineas: [] };
  if (Array.isArray(r)) return { lineas: r };
  return r;
}
function correrTuberia(st, ses, txt) {
  const tramos = partir(txt, 'tuberia');
  const r = correr(st, ses, tramos[0].txt.trim());
  for (const t of tramos.slice(1)) r.lineas = filtrar(r.lineas || [], t.txt.trim());
  return r;
}
function correrCadena(st, ses, lin) {
  const out = []; let limpiar = false, minutos = 0, fallo = false;
  for (const seg of partir(lin, 'cadena')) {
    if (seg.op === '&&' && fallo) break;
    const r = correrTuberia(st, ses, seg.txt.trim());
    if (r.limpiar) { limpiar = true; out.length = 0; }
    (r.lineas || []).forEach(l => out.push(l));
    fallo = !!r.fallo || (r.lineas || []).some(l => l.c === 'err');
    minutos += r.minutos != null ? r.minutos : 1;
    if (ses.pendiente) break;
  }
  return { lineas: out, limpiar, minutos, fallo };
}
// Para Ansible: ejecuta en otro equipo sin tocar el reloj ni el registro.
P.correrEn = (st, host, txt, o) => {
  const ses = { host, cwd: HOME, env: {}, root: !!(o && o.sudo), pila: [], hist: [], pendiente: null };
  return correrCadena(st, ses, txt);
};

P.ejecutar = function (st, ses, linea) {
  const raw = String(linea == null ? '' : linea);
  if (ses.pendiente) {
    const p = ses.pendiente; ses.pendiente = null;
    // Una contraseña no se apunta en el registro ni en el informe.
    st.registro.push({ min: st.reloj, host: ses.host, cmd: p.oculto ? '********' : raw.trim(), respuesta: true });
    const r = p.responder(st, ses, raw.trim()) || { lineas: [] };
    P.avanzar(st, r.minutos != null ? r.minutos : 1);
    return { lineas: r.lineas || [] };
  }
  const lin = raw.trim();
  if (!lin) return { lineas: [] };
  ses.hist.push(lin);
  st.registro.push({ min: st.reloj, host: ses.host, cmd: lin });
  const r = correrCadena(st, ses, lin);
  if (r.minutos) P.avanzar(st, r.minutos);
  return { lineas: r.lineas, limpiar: r.limpiar };
};

// ------------------------------------------------------------------ helpers de comando
U.SUDO = T('(necesitas privilegios: repite el comando con sudo delante)', '(you need privileges: run the command again with sudo in front)');
U.sinRoot = (ctx, lineas) => ctx.sudo ? null : lineas.map(x => typeof x === 'string' ? L(x, 'err') : x).concat([L(U.SUDO, 'dim')]);
U.cmd = (nombre, def) => { P.comandos[nombre] = def; };

// ------------------------------------------------------------------ comandos básicos
U.cmd('help', { fn: ctx => {
  const h = ctx.h, grupos = {};
  Object.keys(P.comandos).forEach(n => {
    const c = P.comandos[n];
    if (!c.ayuda) return;
    if (c.donde && c.donde.indexOf(h.rol) < 0 && c.donde.indexOf(h.nombre) < 0) return;
    const g = c.grupo || T('Sistema', 'System'); (grupos[g] = grupos[g] || []).push(n);
  });
  const out = [L(T('Comandos disponibles en ', 'Commands available on ') + h.nombre + ':', 'verde')];
  Object.keys(grupos).forEach(g => { out.push(L('')); out.push(L(g, 'ambar')); grupos[g].sort().forEach(n => out.push(L('  ' + n.padEnd(18) + P.comandos[n].ayuda))); });
  out.push(L('')); out.push(L(T('Encadena con && o ;  ·  filtra con | grep, | tail, | head  ·  Tab completa  ·  ↑/↓ historial', 'Chain with && or ;  ·  filter with | grep, | tail, | head  ·  Tab completes  ·  ↑/↓ history'), 'dim'));
  return { lineas: out, minutos: 0 };
} });
U.cmd('clear', { fn: () => ({ lineas: [], limpiar: true, minutos: 0 }) });
U.cmd('history', { fn: ctx => ({ lineas: ctx.ses.hist.map((c, i) => L(String(i + 1).padStart(5) + '  ' + c)), minutos: 0 }) });
U.cmd('pwd', { fn: ctx => ({ lineas: [L(ctx.ses.cwd)], minutos: 0 }) });
U.cmd('whoami', { fn: ctx => ({ lineas: [L(ctx.ses.root ? 'root' : 'admin')], minutos: 0 }) });
U.cmd('id', { fn: ctx => ({ lineas: [L(ctx.ses.root ? 'uid=0(root) gid=0(root) groups=0(root)' : 'uid=1000(admin) gid=1000(admin) groups=1000(admin),4(adm),27(sudo),110(libvirt),64045(ceph)')], minutos: 0 }) });
U.cmd('hostname', { fn: ctx => ({ lineas: [L(ctx.h.nombre)], minutos: 0 }) });
U.cmd('echo', { fn: ctx => ({ lineas: [L(ctx.args.join(' ').replace(/\$\{?([A-Z_]+)\}?/g, (m, v) => ctx.ses.env[v] || (v === 'HOSTNAME' ? ctx.h.nombre : v === 'USER' ? 'admin' : '')))], minutos: 0 }) });
U.cmd('date', { fn: ctx => [L(U.fechaCorta(ctx.st.reloj).replace(/ (\d{4})$/, ' UTC $1'))] });
['vim', 'vi', 'nano', 'emacs'].forEach(n => U.cmd(n, { fn: () => ({ lineas: [L(T('(no hay editor en el simulador: los cambios de configuración van por Ansible o Terraform, como pide el RUNBOOK)', '(no editor in the simulator: configuration changes go through Ansible or Terraform, as the RUNBOOK requires)'), 'dim')], minutos: 0 }) }));
U.cmd('man', { fn: ctx => ({ lineas: [L('No manual entry for ' + (ctx.args[0] || ''), 'err'), L(T('(en el simulador: help lista lo que hay en este equipo)', '(in the simulator: help lists what is available on this host)'), 'dim')], minutos: 0 }) });

U.cmd('cd', { fn: ctx => {
  const fs = P.vfs(ctx.st, ctx.h), dest = U.ruta(ctx.ses.cwd, ctx.args[0] || '~', ctx.ses);
  if (fs.f[dest]) return { lineas: [L('bash: cd: ' + ctx.args[0] + ': Not a directory', 'err')], minutos: 0 };
  if (!fs.dirs[dest]) return { lineas: [L('bash: cd: ' + ctx.args[0] + ': No such file or directory', 'err')], minutos: 0 };
  ctx.ses.cwd = dest; return { lineas: [], minutos: 0 };
} });
U.cmd('ls', { ayuda: T('lista ficheros (ls -lh con tamaños)', 'list files (ls -lh with sizes)'), fn: ctx => {
  const fs = P.vfs(ctx.st, ctx.h), ops = ctx.args.filter(x => x[0] === '-').join(''), rutas = ctx.args.filter(x => x[0] !== '-');
  const largo = ops.indexOf('l') >= 0, humano = ops.indexOf('h') >= 0;
  const out = [], objetivos = rutas.length ? [].concat(...rutas.map(r => U.glob(fs, ctx.ses.cwd, r, ctx.ses))) : [ctx.ses.cwd];
  const linea = (p, nombre) => {
    if (!largo) return nombre;
    const dir = !!fs.dirs[p], mb = dir ? 0.004 : (fs.f[p].mb || 0.004);
    const dueno = /rabbitmq/.test(p) ? 'rabbitmq rabbitmq' : /\/ceph\//.test(p) ? 'ceph     ceph    ' : /\/nova\//.test(p) ? 'nova     nova    ' : p.indexOf(HOME) === 0 ? 'admin    admin   ' : 'root     root    ';
    const t = humano ? U.tam(mb) : String(Math.round(mb * 1048576));
    return (dir ? 'drwxr-xr-x' : '-rw-r-----') + ' 1 ' + dueno + ' ' + t.padStart(humano ? 5 : 11) + ' ' + U.sello(ctx.st.reloj - 5).slice(0, 12) + ' ' + nombre;
  };
  objetivos.forEach(p => {
    if (fs.f[p]) { out.push(L(linea(p, p), U.tamRuta(fs, p) > 10240 ? 'rojo' : 'out')); return; }
    if (!fs.dirs[p]) { out.push(L("ls: cannot access '" + p + "': No such file or directory", 'err')); return; }
    const hijos = U.hijos(fs, p), nombres = Object.keys(hijos).sort();
    if (objetivos.length > 1) out.push(L(p + ':'));
    if (largo) out.push(L('total ' + (humano ? U.tam(U.tamRuta(fs, p)) : Math.round(U.tamRuta(fs, p) * 1024))));
    if (largo) nombres.forEach(n => { const q = (p === '/' ? '' : p) + '/' + n; out.push(L(linea(q, n), hijos[n] === 'd' ? 'azul' : U.tamRuta(fs, q) > 10240 ? 'rojo' : 'out')); });
    else if (nombres.length) out.push(L(nombres.map(n => hijos[n] === 'd' ? n + '/' : n).join('   ')));
  });
  return { lineas: out, minutos: 0 };
} });
function leer(ctx, cmd) {
  const fs = P.vfs(ctx.st, ctx.h), rutas = ctx.args.filter((x, i) => x[0] !== '-' && !(ctx.args[i - 1] === '-n'));
  if (!rutas.length) return { err: [L(cmd + T(': falta el fichero', ': missing file operand'), 'err')] };
  const out = [];
  for (const r of rutas) {
    const p = U.ruta(ctx.ses.cwd, r, ctx.ses);
    if (fs.dirs[p]) { out.push(L(cmd + ': ' + r + ': Is a directory', 'err')); continue; }
    if (!fs.f[p]) { out.push(L(cmd + ': ' + r + ': No such file or directory', 'err')); continue; }
    const c = fs.f[p].lineas();
    if (!c) { out.push(L(T('(' + r + ' es binario o está comprimido: ' + (/journal/.test(p) ? 'léelo con journalctl' : 'es un log rotado, anterior al incidente') + ')', '(' + r + ' is binary or compressed: ' + (/journal/.test(p) ? 'read it with journalctl' : 'it is a rotated log, older than the incident') + ')'), 'dim')); continue; }
    c.forEach(t => out.push(typeof t === 'string' ? L(t, /\b(ERROR|CRITICAL|error|FAILED|Input\/output error|enospc)\b/.test(t) ? 'rojo' : /\b(WARNING|WARN|warning)\b/.test(t) ? 'ambar' : 'out') : t));
  }
  return { out };
}
U.cmd('cat', { ayuda: T('muestra un fichero', 'print a file'), fn: ctx => { const r = leer(ctx, 'cat'); return r.err || r.out; } });
U.cmd('less', { fn: ctx => { const r = leer(ctx, 'less'); return r.err || r.out; } });
U.cmd('more', { fn: ctx => { const r = leer(ctx, 'more'); return r.err || r.out; } });
U.cmd('head', { fn: ctx => { const r = leer(ctx, 'head'); return r.err || r.out.slice(0, U.num(ctx.args, 10)); } });
U.cmd('tail', { ayuda: T('final de un fichero (tail -n 50 fichero)', 'end of a file (tail -n 50 file)'), fn: ctx => {
  const r = leer(ctx, 'tail'); if (r.err) return r.err;
  const out = r.out.slice(-U.num(ctx.args, 10));
  if (ctx.args.indexOf('-f') >= 0 || ctx.args.indexOf('-F') >= 0) out.push(L(T('(tail -f se quedaría escuchando; el simulador muestra lo último y vuelve)', '(tail -f would keep following; the simulator shows the latest lines and returns)'), 'dim'));
  return out;
} });
U.cmd('zcat', { fn: () => [L(T('(log rotado: su contenido es anterior al incidente)', '(rotated log: its contents predate the incident)'), 'dim')] });
U.cmd('grep', { ayuda: T('busca texto en un fichero', 'search for text in a file'), fn: ctx => {
  const a = ctx.args.slice(), ops = a.filter(x => /^-/.test(x)), resto = a.filter(x => !/^-/.test(x));
  if (resto.length < 2) return [L('Usage: grep [OPTION]... PATTERNS [FILE]...', 'err')];
  const r = leer(Object.assign({}, ctx, { args: resto.slice(1) }), 'grep'); if (r.err) return r.err;
  return filtrar(r.out, 'grep ' + ops.join(' ') + ' "' + resto[0].replace(/"/g, '') + '"');
} });

U.cmd('df', { ayuda: T('espacio en disco (df -h)', 'disk space (df -h)'), fn: ctx => {
  const h = ctx.h, hum = ctx.args.some(x => /h/.test(x));
  const f = g => hum ? U.tam(g * 1024) : String(Math.round(g * 1048576));
  const out = [L('Filesystem                 ' + (hum ? ' Size  Used Avail Use% Mounted on' : '  1K-blocks      Used Available Use% Mounted on'))];
  out.push(L('tmpfs                      ' + (hum ? '  13G  2.1M   13G   1% /run' : '   13174532      2152  13172380   1% /run')));
  Object.keys(h.discos).forEach(m => {
    const d = h.discos[m], u = U.usadoG(h, m), p = U.pctDisco(h, m), libre = p >= 100 ? 0 : Math.max(0, d.tamG - u);
    const lin = d.dev.padEnd(27) + (hum ? f(d.tamG).padStart(5) + ' ' + f(u).padStart(5) + ' ' + f(libre).padStart(5) + ' ' + (p + '%').padStart(4) + ' ' + m
      : f(d.tamG).padStart(11) + ' ' + f(u).padStart(9) + ' ' + f(libre).padStart(9) + ' ' + (p + '%').padStart(4) + ' ' + m);
    out.push(L(lin, p >= 90 ? 'rojo' : p >= 80 ? 'ambar' : 'out'));
  });
  out.push(L('/dev/sda1                  ' + (hum ? ' 1.1G  6.1M  1.1G   1% /boot/efi' : '    1098632      6220   1092412   1% /boot/efi')));
  return out;
} });
U.cmd('du', { ayuda: T('qué ocupa espacio (du -sh /var/log/*)', 'what is using the space (du -sh /var/log/*)'), fn: ctx => {
  const fs = P.vfs(ctx.st, ctx.h), rutas = ctx.args.filter(x => x[0] !== '-');
  const prof = ctx.args.find(x => /^--max-depth=\d$/.test(x) || /^-d\d?$/.test(x));
  let objetivos = [].concat(...(rutas.length ? rutas : ['.']).map(r => U.glob(fs, ctx.ses.cwd, r, ctx.ses)));
  if (prof && objetivos.length === 1 && fs.dirs[objetivos[0]]) { const d = objetivos[0]; objetivos = Object.keys(U.hijos(fs, d)).sort().map(n => (d === '/' ? '' : d) + '/' + n).concat([d]); }
  return objetivos.map(p => (fs.f[p] || fs.dirs[p]) ? L(U.tam(U.tamRuta(fs, p)) + '\t' + p, U.tamRuta(fs, p) > 10240 ? 'rojo' : 'out') : L("du: cannot access '" + p + "': No such file or directory", 'err'));
} });
U.cmd('rm', { ayuda: T('borra ficheros (sólo logs)', 'delete files (logs only)'), fn: ctx => {
  const h = ctx.h, fs = P.vfs(ctx.st, h), rutas = ctx.args.filter(x => x[0] !== '-');
  if (ctx.args.some(x => /^-[a-z]*r/.test(x))) return [L(T('(rm -r está desactivado en el simulador: borra ficheros concretos)', '(rm -r is disabled in the simulator: delete specific files)'), 'dim')];
  if (!rutas.length) return [L('rm: missing operand', 'err')];
  const out = [];
  [].concat(...rutas.map(r => U.glob(fs, ctx.ses.cwd, r, ctx.ses))).forEach(p => {
    if (fs.dirs[p]) { out.push(L("rm: cannot remove '" + p + "': Is a directory", 'err')); return; }
    if (!fs.f[p]) { out.push(L("rm: cannot remove '" + p + "': No such file or directory", 'err')); return; }
    if (h.logs[p] == null) { out.push(L("rm: cannot remove '" + p + "': Operation not permitted", 'err')); out.push(L(T('(el simulador sólo deja borrar logs)', '(the simulator only lets you delete logs)'), 'dim')); return; }
    if (!ctx.sudo) { out.push(L("rm: cannot remove '" + p + "': Permission denied", 'err')); return; }
    delete h.logs[p]; ctx.st.hechos['limpieza:' + h.nombre] = true;
  });
  if (!ctx.sudo && out.some(l => /Permission denied/.test(l.t))) out.push(L(U.SUDO, 'dim'));
  return out;
} });
U.cmd('truncate', { fn: ctx => {
  const h = ctx.h, fs = P.vfs(ctx.st, h), i = ctx.args.indexOf('-s'), rutas = ctx.args.filter((x, j) => x[0] !== '-' && j !== i + 1 && !/^--size/.test(x));
  if ((i < 0 && !ctx.args.some(x => /^--size=/.test(x))) || !rutas.length) return [L("truncate: you must specify either '--size' or '--reference'", 'err')];
  const out = [];
  [].concat(...rutas.map(r => U.glob(fs, ctx.ses.cwd, r, ctx.ses))).forEach(p => {
    if (h.logs[p] == null) { out.push(L("truncate: cannot open '" + p + "' for writing: " + (fs.f[p] ? 'Operation not permitted' : 'No such file or directory'), 'err')); return; }
    if (!ctx.sudo) { out.push(L("truncate: cannot open '" + p + "' for writing: Permission denied", 'err')); out.push(L(U.SUDO, 'dim')); return; }
    h.logs[p] = 0; ctx.st.hechos['limpieza:' + h.nombre] = true;
  });
  return out;
} });

U.cmd('ssh', { ayuda: T('entra en otro equipo (ssh ceph02)', 'log in to another host (ssh ceph02)'), grupo: T('Acceso', 'Access'), fn: ctx => {
  const dest = (ctx.args.filter(x => x[0] !== '-').pop() || '').replace(/^.*@/, '').replace(/\.retail\.local$/, '');
  if (!dest) return [L('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] destination [command]', 'err')];
  const h = ctx.st.hosts[dest];
  if (!h) return [L('ssh: Could not resolve hostname ' + dest + ': Temporary failure in name resolution', 'err')];
  if (!h.up) return [L('ssh: connect to host ' + dest + ' port 22: No route to host', 'err')];
  U.entrar(ctx.ses, dest, HOME, false);
  const out = [L('Welcome to Ubuntu 22.04.4 LTS (GNU/Linux ' + h.kernel + ' x86_64)'), L(''), L(' * ' + P.roles[h.rol], 'dim')];
  if (!h.provisionado) out.push(L(T(' * Nodo nuevo: sólo sistema base, sin OpenStack', ' * New node: base system only, no OpenStack'), 'dim'));
  if (h.kernelNuevo) { out.push(L('')); out.push(L('*** System restart required ***', 'ambar')); }
  out.push(L('Last login: ' + U.fechaCorta(ctx.st.reloj - 71) + ' from 10.10.0.5'));
  return { lineas: out, minutos: 0 };
} });
function salir(ctx) {
  const antes = ctx.ses.host;
  if (U.salir(ctx.ses)) { const out = [L('logout')]; if (ctx.ses.host !== antes) out.push(L('Connection to ' + antes + ' closed.', 'dim')); return { lineas: out, minutos: 0 }; }
  return { lineas: [L('logout'), L(P.entrada === 'bastion' ? T('(esta pestaña es tu sesión del bastión y no se cierra: abre otra con +)', '(this tab is your bastion session and does not close: open another one with +)') : T('(esta pestaña es tu sesión de partida y no se cierra: abre otra con +)', '(this tab is your starting session and does not close: open another one with +)'), 'dim')], minutos: 0 };
}
U.cmd('exit', { ayuda: T('vuelve al equipo anterior', 'go back to the previous host'), grupo: T('Acceso', 'Access'), fn: salir });
U.cmd('logout', { fn: salir });

function fuente(ctx) {
  const fs = P.vfs(ctx.st, ctx.h), a = ctx.args[0];
  if (!a) return [L('bash: source: filename argument required', 'err')];
  const p = U.ruta(ctx.ses.cwd, a, ctx.ses), f = fs.f[p];
  if (!f) return [L('bash: ' + a + ': No such file or directory', 'err')];
  (f.lineas() || []).forEach(l => { const m = /^export ([A-Z_]+)=(.*)$/.exec(l); if (m) ctx.ses.env[m[1]] = m[2]; });
  return { lineas: [], minutos: 0 };
}
U.cmd('source', { ayuda: T('carga variables (source ~/admin-openrc)', 'load variables (source ~/admin-openrc)'), grupo: T('Acceso', 'Access'), fn: fuente });
U.cmd('.', { fn: fuente });
U.cmd('env', { fn: ctx => ['SHELL=/bin/bash', 'USER=' + (ctx.ses.root ? 'root' : 'admin'), 'HOME=' + U.home(ctx.ses), 'PWD=' + ctx.ses.cwd, 'HOSTNAME=' + ctx.h.nombre].concat(Object.keys(ctx.ses.env).map(k => k + '=' + (k === 'OS_PASSWORD' ? '********' : ctx.ses.env[k]))).map(t => L(t)) });
P.comandos.printenv = P.comandos.env;
U.cmd('export', { fn: ctx => { ctx.args.forEach(x => { const i = x.indexOf('='); if (i > 0) ctx.ses.env[x.slice(0, i)] = x.slice(i + 1); }); return { lineas: [], minutos: 0 }; } });

function carga(h, f) { const b = { ctl: 1.8, cmp: 9.4, ceph: 2.6, mon: 0.9, bastion: 0.1 }[h.rol] || 0.3; return (b * (f || 1) + (h.nombre.length % 3) * 0.07).toFixed(2); }
U.cmd('uptime', { ayuda: T('cuánto lleva encendido y la carga', 'how long it has been up, and the load'), fn: ctx => {
  const h = ctx.h, m = ctx.st.reloj - h.arrancado;
  const up = m >= 1440 ? Math.floor(m / 1440) + ' days, ' + Math.floor((m % 1440) / 60) + ':' + p2(m % 60) : m >= 60 ? Math.floor(m / 60) + ':' + p2(m % 60) : m + ' min';
  return [L(' ' + U.hora(ctx.st.reloj) + ':' + p2(U.seg(ctx.st.reloj)) + ' up ' + up + ',  1 user,  load average: ' + carga(h) + ', ' + carga(h, 0.9) + ', ' + carga(h, 0.8))];
} });
U.cmd('uname', { ayuda: T('versión del kernel (uname -r)', 'kernel version (uname -r)'), fn: ctx => ctx.args.indexOf('-r') >= 0 ? [L(ctx.h.kernel)] : ctx.args.indexOf('-a') >= 0 ? [L('Linux ' + ctx.h.nombre + ' ' + ctx.h.kernel + ' #' + (ctx.h.kernel.indexOf('122') >= 0 ? '132' : '129') + '-Ubuntu SMP x86_64 x86_64 x86_64 GNU/Linux')] : [L('Linux')] });
const RAM = { ctl: 128, cmp: 256, ceph: 128, mon: 32, bastion: 8 };
// Memoria usada (GB). Cada proceso aporta su RSS: si uno crece, crece el nodo.
U.rss = (st, h, u) => { const r = P.rssUnidad && P.rssUnidad(st, h, u); return r != null ? r : /osd/.test(u) ? 3.9 : /rabbit|mariadb|nova|neutron|cinder|glance/.test(u) ? 1.1 : 0.04; };
U.ramUsada = (st, h) => {
  if (h.rol === 'cmp' && P.ramUsadaHost) return Math.round(P.ramUsadaHost(st, h.nombre) / 1024 + 6);
  const base = h.ramBase != null ? h.ramBase : { ctl: 44, ceph: 40, mon: 11, bastion: 1.6 }[h.rol] || 2;
  return Math.round(base + Object.keys(h.svcs).filter(u => h.svcs[u].estado === 'active').reduce((a, u) => a + U.rss(st, h, u), 0));
};
U.ramTotal = h => h.ram || RAM[h.rol] || 8;
U.cmd('free', { ayuda: T('memoria (free -h)', 'memory (free -h)'), fn: ctx => {
  const h = ctx.h, t = U.ramTotal(h);
  const usada = Math.min(t - 1, U.ramUsada(ctx.st, h));
  const libre = Math.max(1, t - usada - 3);
  return [L('               total        used        free      shared  buff/cache   available'), L('Mem:           ' + (t + 'Gi').padEnd(13) + (usada + 'Gi').padEnd(12) + (libre + 'Gi').padEnd(10) + '1.2Gi       3.0Gi' + ('      ' + (libre + 3) + 'Gi')), L('Swap:             0B          0B          0B')];
} });
U.cmd('top', { ayuda: T('foto de procesos y carga', 'snapshot of processes and load'), fn: ctx => {
  const h = ctx.h, act = Object.keys(h.svcs).filter(u => h.svcs[u].estado === 'active');
  const out = [L('top - ' + U.hora(ctx.st.reloj) + ':' + p2(U.seg(ctx.st.reloj)) + ' up, 1 user,  load average: ' + carga(h) + ', ' + carga(h, 0.9) + ', ' + carga(h, 0.8)),
    L('Tasks: ' + (180 + act.length * 3) + ' total,   1 running, ' + (179 + act.length * 3) + ' sleeping,   0 stopped,   0 zombie'),
    L('%Cpu(s):  ' + (h.rol === 'cmp' ? '38.2' : '6.1') + ' us,  2.0 sy,  0.0 ni, ' + (h.rol === 'cmp' ? '58.9' : '91.2') + ' id,  0.4 wa,  0.0 hi,  0.1 si,  0.0 st'), L(''),
    L('    PID USER      PR  NI    VIRT    RES  %CPU  %MEM     TIME+ COMMAND')];
  out.splice(3, 0, L('GiB Mem :  ' + U.ramTotal(h).toFixed(1) + ' total,  ' + Math.max(1, U.ramTotal(h) - U.ramUsada(ctx.st, h) - 3).toFixed(1) + ' free,  ' + Math.min(U.ramTotal(h) - 1, U.ramUsada(ctx.st, h)).toFixed(1) + ' used,    3.0 buff/cache', U.ramUsada(ctx.st, h) / U.ramTotal(h) >= 0.9 ? 'rojo' : 'out'));
  act.slice().sort((a, b) => U.rss(ctx.st, h, b) - U.rss(ctx.st, h, a)).slice(0, 12).forEach((u, i) => { const r = U.rss(ctx.st, h, u); out.push(L(String(U.pid(h.nombre + u + h.svcs[u].desde)).padStart(7) + ' ' + (/ceph/.test(u) ? 'ceph    ' : /rabbit/.test(u) ? 'rabbitmq' : /nova|neutron|cinder|glance/.test(u) ? 'nova    ' : 'root    ') + '  20   0  ' + (r + 1.2).toFixed(1).padStart(5) + 'g ' + (r >= 1 ? r.toFixed(1) + 'g' : Math.round(r * 1024) + 'm').padStart(6) + '  ' + (8 - i * 0.5).toFixed(1).padStart(4) + '  ' + (r / U.ramTotal(h) * 100).toFixed(1).padStart(4) + '  ' + (100 + i * 17) + ':12.44 ' + U.binario(u), r / U.ramTotal(h) > 0.2 ? 'rojo' : 'out')); });
  out.push(L(T('(foto fija: el simulador no refresca top)', '(static snapshot: the simulator does not refresh top)'), 'dim'));
  return out;
} });
U.cmd('ps', { ayuda: T('procesos (ps aux --sort=-rss: los que más memoria usan)', 'processes (ps aux --sort=-rss: biggest memory users first)'), fn: ctx => {
  const h = ctx.h, st = ctx.st, t = U.ramTotal(h);
  let us = Object.keys(h.svcs).filter(u => h.svcs[u].estado === 'active');
  if (ctx.args.some(x => /^--sort=-(rss|%mem|pmem)$/.test(x))) us = us.sort((a, b) => U.rss(st, h, b) - U.rss(st, h, a));
  return [L('USER         PID %CPU %MEM      VSZ      RSS TTY  STAT START   TIME COMMAND')].concat(us.map(u => { const r = U.rss(st, h, u); return L((/ceph/.test(u) ? 'ceph' : /rabbit/.test(u) ? 'rabbitmq' : /nova|neutron|cinder|glance/.test(u) ? 'nova' : /mariadb/.test(u) ? 'mysql' : 'root').padEnd(8) + String(U.pid(h.nombre + u + h.svcs[u].desde)).padStart(8) + '  1.2 ' + (r / t * 100).toFixed(1).padStart(4) + ' ' + String(Math.round((r + 1.2) * 1048576)).padStart(8) + ' ' + String(Math.round(r * 1048576)).padStart(8) + ' ?    Ssl  Sep11 102:44 /usr/bin/' + U.binario(u), r / t > 0.2 ? 'rojo' : 'out'); }));
} });
U.cmd('ip', { ayuda: T('direcciones de red (ip a)', 'network addresses (ip a)'), grupo: T('Red', 'Network'), fn: ctx => {
  const h = ctx.h;
  if (ctx.args.indexOf('-br') >= 0) return [L('lo               UNKNOWN        127.0.0.1/8 ::1/128'), L('eno1             UP             ' + h.ip + '/16')];
  return [L('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000'), L('    inet 127.0.0.1/8 scope host lo'),
    L('2: eno1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9000 qdisc mq state UP group default qlen 1000'), L('    link/ether 3c:ec:ef:' + U.hex(h.nombre, 6).match(/../g).join(':') + ' brd ff:ff:ff:ff:ff:ff'), L('    inet ' + h.ip + '/16 brd 10.10.255.255 scope global eno1')];
} });
U.cmd('ping', { ayuda: T('comprueba si otro equipo responde', 'check whether another host responds'), grupo: T('Red', 'Network'), fn: ctx => {
  const dest = (ctx.args.filter(x => x[0] !== '-' && !/^\d+$/.test(x)).pop() || '').replace(/\.retail\.local$/, '');
  if (!dest) return [L('ping: usage error: Destination address required', 'err')];
  const h = ctx.st.hosts[dest];
  // Una IP de VM: responde si la VM corre y su hipervisor tiene la red viva.
  const vm = !h && P.buscarIp ? P.buscarIp(ctx.st, dest) : null;
  if (vm) {
    if (!vm.ok) return [L('PING ' + dest + ' (' + dest + ') 56(84) bytes of data.'), L('From ' + ctx.h.ip + ' icmp_seq=1 Destination Host Unreachable', 'rojo'), L('From ' + ctx.h.ip + ' icmp_seq=2 Destination Host Unreachable', 'rojo'), L(''), L('--- ' + dest + ' ping statistics ---'), L('2 packets transmitted, 0 received, +2 errors, 100% packet loss, time 1011ms', 'err')];
    return [L('PING ' + dest + ' (' + dest + ') 56(84) bytes of data.'), L('64 bytes from ' + dest + ': icmp_seq=1 ttl=63 time=0.612 ms'), L('64 bytes from ' + dest + ': icmp_seq=2 ttl=63 time=0.588 ms'), L(''), L('--- ' + dest + ' ping statistics ---'), L('2 packets transmitted, 2 received, 0% packet loss, time 1001ms')];
  }
  if (!h) return [L('ping: ' + dest + ': Name or service not known', 'err')];
  if (!h.up) return [L('PING ' + dest + ' (' + h.ip + ') 56(84) bytes of data.'), L('From ' + ctx.h.ip + ' icmp_seq=1 Destination Host Unreachable', 'rojo'), L('From ' + ctx.h.ip + ' icmp_seq=2 Destination Host Unreachable', 'rojo'), L('From ' + ctx.h.ip + ' icmp_seq=3 Destination Host Unreachable', 'rojo'), L(''), L('--- ' + dest + ' ping statistics ---'), L('3 packets transmitted, 0 received, +3 errors, 100% packet loss, time 2031ms', 'err')];
  const out = [L('PING ' + dest + ' (' + h.ip + ') 56(84) bytes of data.')];
  for (let i = 1; i <= 3; i++) out.push(L('64 bytes from ' + dest + ' (' + h.ip + '): icmp_seq=' + i + ' ttl=64 time=0.' + (180 + i * 23) + ' ms'));
  return out.concat([L(''), L('--- ' + dest + ' ping statistics ---'), L('3 packets transmitted, 3 received, 0% packet loss, time 2003ms'), L('rtt min/avg/max/mdev = 0.203/0.226/0.249/0.019 ms')]);
} });
U.cmd('sleep', { ayuda: T('deja pasar el tiempo (sleep 300 = 5 min)', 'let time pass (sleep 300 = 5 min)'), fn: ctx => {
  const m = /^(\d+)(s|m)?$/.exec(ctx.args[0] || '');
  if (!m) return [L('sleep: missing operand', 'err')];
  const seg = parseInt(m[1], 10) * (m[2] === 'm' ? 60 : 1);
  return { lineas: [], minutos: Math.min(60, Math.max(1, Math.ceil(seg / 60))) };
} });

// systemctl -------------------------------------------------------------------
function estadoTexto(st, h, u) {
  const s = h.svcs[u];
  if (s.estado === 'active') return { t: 'active (running) since ' + U.larga(s.desde) + '; ' + U.hace(st.reloj - s.desde), c: 'verde' };
  if (s.estado === 'failed') { const m = P.motivos[s.motivo] || {}; return { t: 'failed (Result: ' + (m.result || 'exit-code') + ') since ' + U.larga(s.desde) + '; ' + U.hace(st.reloj - s.desde), c: 'rojo' }; }
  return { t: 'inactive (dead)' + (s.desde > -17280 ? ' since ' + U.larga(s.desde) + '; ' + U.hace(st.reloj - s.desde) : ''), c: 'out' };
}
U.journalLineas = (h, u, n) => h.svcs[u].log.slice(-n).map(x => L(U.sello(x.min) + ' ' + h.nombre + ' ' + x.src + ': ' + x.t, /(Failed|failed|ERROR|error|Aborted|Input\/output|enospc|killed|repeated too quickly|suicide)/.test(x.t) ? 'rojo' : 'out'));
function statusBloque(st, h, u) {
  const s = h.svcs[u], e = estadoTexto(st, h, u), m = P.motivos[s.motivo] || {};
  const plantilla = u.indexOf('@') > 0 ? u.split('@')[0] + '@.service' : u + '.service';
  const pid = U.pid(h.nombre + u + s.desde);
  const out = [L('● ' + u + '.service - ' + U.desc(u), s.estado === 'active' ? 'verde' : s.estado === 'failed' ? 'rojo' : 'out'),
    L('     Loaded: loaded (/lib/systemd/system/' + plantilla + '; ' + (s.enabled ? 'enabled' : 'disabled') + '; vendor preset: enabled)', s.enabled ? 'out' : 'ambar'),
    L('     Active: ' + e.t, e.c)];
  if (s.estado === 'active') {
    out.push(L('   Main PID: ' + pid + ' (' + U.binario(u) + ')'));
    out.push(L('      Tasks: ' + (20 + (pid % 60)) + ' (limit: 154382)'));
    const r = U.rss(st, h, u);
    out.push(L('     Memory: ' + (r >= 1 ? r.toFixed(1) + 'G' : Math.round(r * 1024) + '.3M'), r / U.ramTotal(h) > 0.2 ? 'rojo' : 'out'));
  } else if (s.estado === 'failed') {
    out.push(L('    Process: ' + pid + ' ExecStart=/usr/bin/' + U.binario(u) + ' ' + (m.proceso || '(code=exited, status=1/FAILURE)')));
    out.push(L('   Main PID: ' + pid + ' ' + (m.proceso || '(code=exited, status=1/FAILURE)')));
  }
  out.push(L(''));
  return out.concat(U.journalLineas(h, u, 8));
}
U.cmd('systemctl', { ayuda: T('servicios: status, restart, enable --now...', 'services: status, restart, enable --now...'), grupo: T('Servicios', 'Services'), fn: ctx => {
  const st = ctx.st, h = ctx.h;
  const a = ctx.args.filter(x => ['--no-pager', '-l', '--full', '-q', '--quiet'].indexOf(x) < 0);
  const verbo = a[0] && a[0][0] !== '-' ? a[0] : (a.indexOf('--failed') >= 0 ? '--failed' : 'list-units');
  const ahora = a.indexOf('--now') >= 0;
  const nombres = a.slice(1).filter(x => x[0] !== '-');
  if (verbo === '--failed' || (verbo === 'list-units' && a.indexOf('--failed') >= 0)) {
    const f = Object.keys(h.svcs).filter(u => h.svcs[u].estado === 'failed');
    const out = [L('  UNIT' + ' '.repeat(28) + 'LOAD   ACTIVE SUB    DESCRIPTION')];
    f.forEach(u => out.push(L('● ' + (u + '.service').padEnd(32) + 'loaded failed failed ' + U.desc(u), 'rojo')));
    out.push(L('')); out.push(L(f.length + ' loaded units listed.'));
    return out;
  }
  if (verbo === 'list-units') {
    const out = [L('  UNIT' + ' '.repeat(38) + 'LOAD   ACTIVE   SUB     DESCRIPTION')];
    Object.keys(h.svcs).forEach(u => { const s = h.svcs[u]; out.push(L((s.estado === 'failed' ? '● ' : '  ') + (u + '.service').padEnd(42) + 'loaded ' + s.estado.padEnd(8) + ' ' + (s.estado === 'active' ? 'running' : s.estado === 'failed' ? 'failed ' : 'dead   ') + ' ' + U.desc(u), s.estado === 'failed' ? 'rojo' : 'out')); });
    return out;
  }
  const noEsta = n => L('Unit ' + n.replace(/\.service$/, '') + '.service could not be found.', 'err');
  if (verbo === 'status') {
    if (!nombres.length) {
      const f = Object.keys(h.svcs).filter(u => h.svcs[u].estado === 'failed').length;
      return [L('● ' + h.nombre), L('    State: ' + (f ? 'degraded' : 'running'), f ? 'rojo' : 'verde'), L('     Jobs: 0 queued'), L('   Failed: ' + f + ' units', f ? 'rojo' : 'out'), L('    Since: ' + U.larga(h.arrancado) + '; ' + U.hace(st.reloj - h.arrancado))];
    }
    let out = [];
    nombres.forEach((n, i) => { const u = U.unidad(h, n); if (i) out.push(L('')); out = out.concat(u ? statusBloque(st, h, u) : [noEsta(n)]); });
    return out;
  }
  if (['is-active', 'is-enabled', 'is-failed'].indexOf(verbo) >= 0) {
    return nombres.map(n => { const u = U.unidad(h, n); if (!u) return L(verbo === 'is-enabled' ? 'Failed to get unit file state for ' + n + '.service: No such file or directory' : 'inactive', verbo === 'is-enabled' ? 'err' : 'out'); const s = h.svcs[u]; return L(verbo === 'is-enabled' ? (s.enabled ? 'enabled' : 'disabled') : s.estado); });
  }
  if (verbo === 'daemon-reload') return U.sinRoot(ctx, ['Failed to reload daemon: Access denied']) || [];
  if (['start', 'stop', 'restart', 'reload', 'try-restart', 'enable', 'disable', 'reset-failed', 'mask', 'unmask'].indexOf(verbo) < 0) return [L('Unknown command verb ' + verbo + '.', 'err')];
  if (!nombres.length) return [L('Too few arguments.', 'err')];
  const deneg = U.sinRoot(ctx, nombres.map(n => 'Failed to ' + verbo + ' ' + n.replace(/\.service$/, '') + '.service: Access denied'));
  if (deneg) return deneg;
  if (verbo === 'mask' || verbo === 'unmask') return [L(T('(mask/unmask no hacen falta en ningún escenario: usa disable/enable)', '(mask/unmask are not needed in any scenario: use disable/enable)'), 'dim')];
  const out = [];
  nombres.forEach(n => {
    const u = U.unidad(h, n);
    if (!u) { out.push(L('Failed to ' + verbo + ' ' + n.replace(/\.service$/, '') + '.service: Unit ' + n.replace(/\.service$/, '') + '.service not found.', 'err')); return; }
    const s = h.svcs[u], nombreU = u + '.service', wants = /^ceph-osd@/.test(u) ? 'ceph-osd.target.wants' : /^ceph-mon@/.test(u) ? 'ceph-mon.target.wants' : /^ceph-mgr@/.test(u) ? 'ceph-mgr.target.wants' : 'multi-user.target.wants';
    const plantilla = u.indexOf('@') > 0 ? u.split('@')[0] + '@.service' : nombreU;
    const fallo = () => {
      if (s.limite) { out.push(L('Job for ' + nombreU + ' failed because start of the service was attempted too often.', 'err')); out.push(L('See "systemctl status ' + nombreU + '" and "journalctl -xeu ' + nombreU + '" for details.', 'err')); out.push(L('To force a start use "systemctl reset-failed ' + nombreU + '"', 'err')); out.push(L('followed by "systemctl start ' + nombreU + '" again.', 'err')); }
      else { out.push(L('Job for ' + nombreU + ' failed because the control process exited with error code.', 'err')); out.push(L('See "systemctl status ' + nombreU + '" and "journalctl -xeu ' + nombreU + '" for details.', 'err')); }
    };
    const arrancarla = () => { if (s.estado === 'active') return; if (s.limite) { fallo(); return; } if (P.arrancar(st, h, u)) fallo(); };
    if (verbo === 'enable' || verbo === 'disable') {
      const antes = s.enabled; s.enabled = verbo === 'enable';
      if (antes !== s.enabled) out.push(L(s.enabled ? 'Created symlink /etc/systemd/system/' + wants + '/' + nombreU + ' → /lib/systemd/system/' + plantilla + '.' : 'Removed /etc/systemd/system/' + wants + '/' + nombreU + '.'));
      if (ahora) { if (verbo === 'enable') arrancarla(); else if (s.estado === 'active') P.parar(st, h, u); }
    } else if (verbo === 'start') arrancarla();
    else if (verbo === 'stop') P.parar(st, h, u);
    else if (verbo === 'restart' || verbo === 'reload' || verbo === 'try-restart') {
      if (verbo === 'try-restart' && s.estado !== 'active') return;
      if (s.limite) { fallo(); return; }
      if (s.estado === 'active') P.parar(st, h, u);
      if (P.arrancar(st, h, u)) fallo();
    } else if (verbo === 'reset-failed') { s.limite = false; if (s.estado === 'failed') s.estado = 'inactive'; }
  });
  return out;
} });

U.cmd('journalctl', { ayuda: T('log de un servicio (journalctl -u X -n 30)', 'log of a service (journalctl -u X -n 30)'), grupo: T('Servicios', 'Services'), fn: ctx => {
  const st = ctx.st, h = ctx.h, a = ctx.args;
  const vac = a.find(x => /^--vacuum-(size|time)=/.test(x));
  if (vac) {
    const d = U.sinRoot(ctx, ['Failed to open journal directory: Permission denied']); if (d) return d;
    const k = Object.keys(h.logs).find(p => /\/journal\//.test(p));
    if (!k) return [L('Vacuuming done, freed 0B of archived journals from /var/log/journal.')];
    const antes = h.logs[k], m = /size=(\d+)([MG])/.exec(vac), obj = m ? parseInt(m[1], 10) * (m[2] === 'G' ? 1024 : 1) : antes * 0.3;
    const libre = Math.max(0, antes - Math.min(antes, obj)); h.logs[k] = antes - libre;
    ctx.st.hechos['limpieza:' + h.nombre] = true;
    return [L('Deleted archived journal ' + k.replace('system.journal', 'system@0005f1c2a9e0d3b1-7c2a1f09e1b3d4a2.journal~') + ' (' + U.tam(libre) + ').'), L('Vacuuming done, freed ' + U.tam(libre) + ' of archived journals from ' + k.slice(0, k.lastIndexOf('/')) + '.')];
  }
  let u = null, n = 30;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-u' || x === '--unit') u = a[i + 1];
    else if (/^--unit=/.test(x)) u = x.slice(7);
    else if (/^-[a-z]+u$/.test(x)) u = a[i + 1];
    else if (/^-u.+/.test(x)) u = x.slice(2);
    if (x === '-n' || x === '--lines') n = parseInt(a[i + 1], 10) || n;
    else if (/^-n\d+$/.test(x)) n = parseInt(x.slice(2), 10);
    else if (/^--lines=\d+$/.test(x)) n = parseInt(x.slice(8), 10);
  }
  if (u) {
    const un = U.unidad(h, u);
    if (!un) return [L('-- No entries --')];
    return U.journalLineas(h, un, n);
  }
  if (a.indexOf('-k') >= 0 || a.indexOf('--dmesg') >= 0) return (h.dmesg.length ? h.dmesg : [T('(sin mensajes del kernel desde el arranque)', '(no kernel messages since boot)')]).map(t => L(t, /error|fail/i.test(t) ? 'rojo' : 'out'));
  const soloErr = a.some((x, i) => (x === '-p' && /^(err|3|crit|2|0|1)/.test(a[i + 1] || '')) || /^--priority=(err|3)/.test(x));
  let lin = U.syslog(st, h, 400);
  if (soloErr) lin = lin.filter(t => /(Failed|failed|ERROR|error|Aborted|Input\/output|enospc|killed|repeated)/.test(t));
  return lin.slice(-n).map(t => L(t, /(Failed|failed|ERROR|error|Aborted|Input\/output|enospc|killed)/.test(t) ? 'rojo' : 'out'));
} });
U.cmd('dmesg', { ayuda: T('mensajes del kernel: discos, memoria', 'kernel messages: disks, memory'), fn: ctx => {
  const d = U.sinRoot(ctx, ['dmesg: read kernel buffer failed: Operation not permitted']); if (d) return d;
  const h = ctx.h, base = ['[    0.000000] Linux version ' + h.kernel + ' (buildd@lcy02-amd64-051) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0)', '[    2.412233] EXT4-fs (dm-0): mounted filesystem with ordered data mode. Quota mode: none.', '[    4.101922] bond0: (slave eno1): Enslaving as an active interface with an up link'];
  return base.concat(h.dmesg).map(t => L(t, /(error|I\/O|fail|critical)/i.test(t) ? 'rojo' : 'out'));
} });

// reloj: chrony y timedatectl --------------------------------------------------
U.cmd('timedatectl', { ayuda: T('estado de la hora y de NTP', 'time and NTP status'), fn: ctx => {
  const h = ctx.h, act = !!(h.svcs.chrony && h.svcs.chrony.estado === 'active'), sync = act && Math.abs(h.ntp.offset) < 0.05;
  return [L('               Local time: ' + U.larga(ctx.st.reloj)), L('           Universal time: ' + U.larga(ctx.st.reloj)), L('                 RTC time: ' + U.larga(ctx.st.reloj).replace(/^\w+ /, '').replace(' UTC', '')), L('                Time zone: Etc/UTC (UTC, +0000)'),
    L('System clock synchronized: ' + (sync ? 'yes' : 'no'), sync ? 'verde' : 'rojo'), L('              NTP service: ' + (act ? 'active' : 'inactive'), act ? 'out' : 'rojo'), L('          RTC in local TZ: no')];
} });
U.cmd('chronyc', { ayuda: 'NTP: chronyc tracking / sources / makestep', fn: ctx => {
  const h = ctx.h, sub = ctx.args[0] || 'tracking';
  if (!(h.svcs.chrony && h.svcs.chrony.estado === 'active')) return [L('506 Cannot talk to daemon', 'err')];
  const off = h.ntp.offset, ab = Math.abs(off).toFixed(9);
  if (sub === 'makestep') { const d = U.sinRoot(ctx, ['501 Not authorised']); if (d) return d; h.ntp.offset = 0.000011; return [L('200 OK')]; }
  const us = (off >= 0 ? '+' : '-') + Math.round(Math.abs(off) * 1e6) + 'us';
  if (sub === 'sources') return [L('MS Name/IP address         Stratum Poll Reach LastRx Last sample'), L('==============================================================================='), L('^* ntp1.retail.local             2   6   377    23   ' + us + '[' + us + '] +/-  812us', Math.abs(off) >= 0.05 ? 'rojo' : 'out'), L('^- ntp2.retail.local             2   6   377    41   +121us[ +124us] +/- 1203us')];
  if (sub === 'tracking') return [L('Reference ID    : 0A0A0003 (ntp1.retail.local)'), L('Stratum         : 3'), L('Ref time (UTC)  : ' + U.fechaCorta(ctx.st.reloj)),
    L('System time     : ' + ab + ' seconds ' + (off >= 0 ? 'fast' : 'slow') + ' of NTP time', Math.abs(off) >= 0.05 ? 'rojo' : 'verde'), L('Last offset     : +0.000003112 seconds'), L('RMS offset      : 0.000021552 seconds'), L('Frequency       : 12.231 ppm slow'), L('Residual freq   : +0.001 ppm'), L('Skew            : 0.020 ppm'), L('Root delay      : 0.001204112 seconds'), L('Root dispersion : 0.000380226 seconds'), L('Update interval : 64.2 seconds'), L('Leap status     : Normal')];
  return [L('Unrecognized command', 'err')];
} });

// reinicio y paquetes -----------------------------------------------------------
function reboot(ctx) {
  const h = ctx.h;
  if (h.nombre === P.entrada) return [L(T('(el bastión no se reinicia en el simulador: es tu puesto)', '(the bastion does not reboot in the simulator: it is your workstation)'), 'dim')];
  const d = U.sinRoot(ctx, ['Failed to set wall message, ignoring: Interactive authentication required.', 'Failed to reboot system via logind: Interactive authentication required.']); if (d) return d;
  P.reiniciar(ctx.st, h);
  return { lineas: [], minutos: 1 };
}
U.cmd('reboot', { ayuda: T('reinicia el equipo', 'reboot the host'), grupo: T('Servicios', 'Services'), fn: reboot });
U.cmd('shutdown', { fn: ctx => ctx.args.indexOf('-r') >= 0 ? reboot(ctx) : [L(T('(apagar un nodo no está en ningún guion: nadie bajaría al CPD a encenderlo)', '(powering off a node is not in any script: nobody would go down to the datacenter to turn it back on)'), 'dim')] });
U.cmd('poweroff', { fn: () => [L(T('(apagar un nodo no está en ningún guion: nadie bajaría al CPD a encenderlo)', '(powering off a node is not in any script: nobody would go down to the datacenter to turn it back on)'), 'dim')] });
function apt(ctx) {
  const h = ctx.h, a = ctx.args, sub = a.find(x => x[0] !== '-') || '';
  const kd = h.kernelDisponible, vk = kd ? kd.replace('-generic', '').replace(/^5\.15\.0-/, '5.15.0.') : '';
  // nova: paquete de OpenStack con una versión corregida en el repositorio
  const novaPend = h.extra.novaInstalada === '29.2.0';
  const NOVA = ['nova-api', 'nova-common', 'python3-nova'].map(p => L(p + '/jammy-updates 3:29.2.1-0ubuntu1~cloud0 all [upgradable from: 3:29.2.0-0ubuntu1~cloud0]', 'verde'));
  if (sub === 'changelog') {
    if (a.indexOf('nova-api') < 0 && a.indexOf('nova-common') < 0) return [L(T('(en el simulador: apt changelog nova-api)', '(in the simulator: apt changelog nova-api)'), 'dim')];
    return U.ls(['nova (3:29.2.1-0ubuntu1~cloud0) jammy-caracal; urgency=medium', '', '  * New stable point release for OpenStack Caracal.', '  * d/p/fix-servers-detail-port-leak.patch: Fix memory leak in nova-api', '    when listing servers with many ports; objects were cached per request', '    and never released (LP: #2071234).', '', ' -- Ubuntu OpenStack <openstack@ubuntu.com>  Thu, 10 Sep 2026 11:02:33 +0000', '', 'nova (3:29.2.0-0ubuntu1~cloud0) jammy-caracal; urgency=medium', '  * New stable point release for OpenStack Caracal.']);
  }
  if (sub === 'list') {
    if (a.indexOf('--upgradable') < 0 || (!kd && !novaPend)) return [L('Listing... Done')];
    const v = vk + '.' + vk.split('.').pop(), out = [L('Listing... Done')];
    if (kd) ['linux-generic', 'linux-headers-generic', 'linux-image-generic'].forEach(p => out.push(L(p + '/jammy-updates,jammy-security ' + v + ' amd64 [upgradable from: 5.15.0.119.119]', 'verde')));
    return novaPend ? out.concat(NOVA) : out;
  }
  const d = U.sinRoot(ctx, ['E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)', 'E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?']);
  if (sub === 'update') { if (d) return d; return [L('Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease'), L('Get:2 http://archive.ubuntu.com/ubuntu jammy-updates InRelease [128 kB]'), L('Get:3 http://security.ubuntu.com/ubuntu jammy-security InRelease [129 kB]'), L('Hit:4 http://ubuntu-cloud.archive.canonical.com/ubuntu jammy-updates/caracal InRelease'), L('Fetched 257 kB in 1s (312 kB/s)'), L('Reading package lists... Done'), L('Building dependency tree... Done'), L(kd || novaPend ? ((kd ? 3 : 0) + (novaPend ? 3 : 0)) + " packages can be upgraded. Run 'apt list --upgradable' to see them." : 'All packages are up to date.')]; }
  if (['upgrade', 'full-upgrade', 'dist-upgrade'].indexOf(sub) >= 0) {
    if (d) return d;
    if (!kd && novaPend) {
      h.extra.novaInstalada = '29.2.1';
      return { lineas: [L('Reading package lists... Done'), L('Building dependency tree... Done'), L('Calculating upgrade... Done'), L('The following packages will be upgraded:'), L('  nova-api nova-common python3-nova'), L('3 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.'), L('Setting up python3-nova (3:29.2.1-0ubuntu1~cloud0) ...'), L('Setting up nova-api (3:29.2.1-0ubuntu1~cloud0) ...'), L(''), L('Daemons using outdated libraries', 'ambar'), L('------------------------------', 'ambar'), L('Service restarts being deferred:', 'ambar'), L(' systemctl restart nova-api.service', 'ambar'), L(''), L('No containers need to be restarted.')], minutos: 2 };
    }
    if (!kd) return [L('Reading package lists... Done'), L('Building dependency tree... Done'), L('Calculating upgrade... Done'), L('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.')];
    const cab = [L('Reading package lists... Done'), L('Building dependency tree... Done'), L('Calculating upgrade... Done'), L('The following NEW packages will be installed:'), L('  linux-headers-' + kd + ' linux-image-' + kd + ' linux-modules-' + kd), L('The following packages will be upgraded:'), L('  linux-generic linux-headers-generic linux-image-generic'), L('3 upgraded, 3 newly installed, 0 to remove and 0 not upgraded.'), L('Need to get 71.4 MB of archives.'), L('After this operation, 402 MB of additional disk space will be used.')];
    const instalar = () => { h.kernelNuevo = kd; h.kernelDisponible = null; return [L('Setting up linux-image-' + kd + ' ...'), L('Processing triggers for linux-image-' + kd + ' ...'), L('/etc/kernel/postinst.d/initramfs-tools:'), L('update-initramfs: Generating /boot/initrd.img-' + kd), L('/etc/kernel/postinst.d/zz-update-grub:'), L('Generating grub configuration file ...'), L('done'), L('*** System restart required ***', 'ambar')]; };
    if (a.indexOf('-y') >= 0 || a.indexOf('--yes') >= 0) return { lineas: cab.concat(instalar()), minutos: 2 };
    ctx.ses.pendiente = { prompt: 'Do you want to continue? [Y/n] ', responder: (st, ses, r) => (r === '' || /^y(es)?$/i.test(r)) ? { lineas: instalar(), minutos: 2 } : { lineas: [L('Abort.')] } };
    return { lineas: cab, minutos: 0 };
  }
  if (sub === 'install' || sub === 'remove' || sub === 'purge') return [L(T('(el simulador no instala paquetes sueltos: el software de la plataforma se despliega con Ansible)', '(the simulator does not install individual packages: platform software is deployed with Ansible)'), 'dim')];
  return [L('apt 2.4.12 (amd64)'), L('Usage: apt [options] command')];
}
U.cmd('apt', { ayuda: T('paquetes: update / list --upgradable / upgrade', 'packages: update / list --upgradable / upgrade'), grupo: T('Servicios', 'Services'), fn: apt });
U.cmd('apt-get', { fn: apt });

// ------------------------------------------------------------------ Tab
P.completar = function (st, ses, texto) {
  const h = st.hosts[ses.host];
  const partes = texto.split(/\s+/);
  let pal = partes.slice(0, -1), ult = partes[partes.length - 1] || '';
  const base = texto.slice(0, texto.length - ult.length);
  if (pal[0] === 'sudo') pal = pal.slice(1);
  let cands = [];
  const disponibles = () => Object.keys(P.comandos).filter(n => { const c = P.comandos[n]; return n !== '.' && (!c.donde || c.donde.indexOf(h.rol) >= 0 || c.donde.indexOf(h.nombre) >= 0); }).concat(['sudo']);
  const rutas = () => {
    const fs = P.vfs(st, h), i = ult.lastIndexOf('/'), dirTxt = i >= 0 ? ult.slice(0, i + 1) : '', dir = U.ruta(ses.cwd, dirTxt || '.', ses);
    const hijos = U.hijos(fs, dir);
    return Object.keys(hijos).map(n => dirTxt + n + (hijos[n] === 'd' ? '/' : ''));
  };
  if (!pal.length) cands = disponibles();
  else {
    const cmd = pal[0], c = P.comandos[cmd];
    if (c && c.completar) cands = c.completar(st, ses, pal.slice(1), ult, rutas) || [];
    else if (['ssh', 'ping'].indexOf(cmd) >= 0) cands = Object.keys(st.hosts);
    else cands = rutas();
  }
  cands = cands.filter((x, i, arr) => x.indexOf(ult) === 0 && arr.indexOf(x) === i);
  if (!cands.length) return { texto, opciones: [] };
  if (cands.length === 1) return { texto: base + cands[0] + (/\/$/.test(cands[0]) ? '' : ' '), opciones: [] };
  let pref = cands[0];
  cands.forEach(x => { while (x.indexOf(pref) !== 0) pref = pref.slice(0, -1); });
  return { texto: base + pref, opciones: pref.length > ult.length ? [] : cands.sort() };
};
P.comandos.systemctl.completar = (st, ses, pal) => {
  if (!pal.length) return ['status', 'start', 'stop', 'restart', 'enable', 'disable', 'is-active', 'is-enabled', 'reset-failed', 'list-units', 'daemon-reload', '--failed'];
  return Object.keys(st.hosts[ses.host].svcs).concat(['--now']);
};
P.comandos.journalctl.completar = (st, ses, pal) => {
  const ant = pal[pal.length - 1] || '';
  if (ant === '-u' || /^-[a-z]+u$/.test(ant)) return Object.keys(st.hosts[ses.host].svcs);
  return ['-u', '-n', '-xeu', '--vacuum-size=200M', '-p'];
};
P.comandos.chronyc.completar = () => ['tracking', 'sources', 'makestep'];
P.comandos.apt.completar = () => ['update', 'upgrade', 'full-upgrade', 'list', '--upgradable', '-y', 'changelog', 'nova-api'];

})(window.PUESTO = window.PUESTO || {});
