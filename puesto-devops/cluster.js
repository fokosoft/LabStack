// Puesto DevOps · el clúster de Kubernetes, sobre el motor del Puesto.
//
// Los nodos son nodos del motor (Ubuntu con kubelet y containerd). Lo demás
// vive en st.k8s: Deployments, ReplicaSets, pods, Services, ConfigMaps, eventos.
// Una sola fuente de verdad, como en los otros puestos: lo que contesta
// `kubectl get pods`, lo que pinta el panel y las alertas salen de este estado.
//
// Cada minuto simulado corre un bucle de reconciliación con el mismo orden que
// los controladores de verdad: el de Deployments decide cuántas réplicas quiere
// cada ReplicaSet (rolling update con maxSurge y maxUnavailable del 25 %), el
// de ReplicaSets crea o borra pods, el scheduler coloca los pendientes según
// sus requests, y el kubelet de cada nodo arranca contenedores: descarga la
// imagen, lee el ConfigMap AL ARRANCAR, los mata si pasan del límite de
// memoria, los reinicia con backoff y mira la readiness probe.
//
// Un escenario rompe algo en el pasado (minuto -50, por ejemplo) y K.simular
// corre el bucle hasta ahora: los reinicios, los eventos y la edad de cada pod
// salen solos, no se escriben a mano.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, HOME = U.HOME;
const K = P.k8s = {};

// ------------------------------------------------------------------ utilidades
const ALFA = 'bcdfghjklmnpqrstvwxz2456789';
K.id = (sem, n) => U.hex('k8s:' + sem, n * 2).match(/../g).map(x => ALFA[parseInt(x, 16) % ALFA.length]).join('').slice(0, n);
K.cpu = m => m >= 1000 && m % 1000 === 0 ? String(m / 1000) : m + 'm';
K.mem = mi => mi >= 1024 && mi % 1024 === 0 ? (mi / 1024) + 'Gi' : mi + 'Mi';
K.leerCpu = s => { s = String(s); if (/^\d+m$/.test(s)) return parseInt(s, 10); if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000); return null; };
K.leerMem = s => { const m = /^(\d+(?:\.\d+)?)(Mi|Gi|M|G|Ki)?$/.exec(String(s)); if (!m) return null; const v = parseFloat(m[1]); return Math.round(({ Mi: v, Gi: v * 1024, M: v * 0.9537, G: v * 953.7, Ki: v / 1024 })[m[2] || 'Mi'] || v / 1048576); };
// La edad como la escribe kubectl: 45s, 7m, 3h12m, 5d.
K.edad = m => {
  m = Math.max(0, Math.round(m));
  if (m < 2) return (m * 60 + 45) + 's';
  if (m < 180) return m + 'm';
  if (m < 480) return Math.floor(m / 60) + 'h' + (m % 60) + 'm';
  if (m < 2880) return Math.floor(m / 60) + 'h';
  if (m < 11520) return Math.floor(m / 1440) + 'd' + (Math.floor(m / 60) % 24) + 'h';
  return Math.floor(m / 1440) + 'd';
};
K.fecha = min => { const d = new Date(U.iso(min) + 'Z'); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ', ' + U.p2(d.getUTCDate()) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + U.iso(min).slice(11) + ' +0000'; };
const copia = o => JSON.parse(JSON.stringify(o));
K.copia = copia;
// Tabla sin bordes, como la pinta kubectl: tres espacios entre columnas.
K.tabla = (cab, filas) => {
  const w = cab.map((c, i) => Math.max(c.length, ...filas.map(f => String(f[i]).length)));
  const fila = f => f.map((c, i) => i === f.length - 1 ? String(c) : String(c).padEnd(w[i] + 3)).join('');
  return [fila(cab)].concat(filas.map(fila)).map(x => L(x.replace(/\s+$/, '')));
};

// ------------------------------------------------------------------ registro de imágenes y aplicaciones
K.REGISTRO = 'registry.pagos.internal';
K.ETIQUETAS = {
  'api-pagos': ['2.13.2', '2.14.0', '2.14.1', 'v2.15.0', '2.16.0'],
  'web-checkout': ['1.8.2', '1.8.3', '1.9.0', '1.9.1'],
  antifraude: ['3.2.0', '3.3.1'],
  liquidaciones: ['1.4.0', '1.4.1'],
};
K.partesImagen = img => { const m = /^(?:([^/]+\.[^/]+)\/)?(.+?)(?::([^:/]+))?$/.exec(img); return { registro: m[1] || 'docker.io', repo: m[2], tag: m[3] || 'latest' }; };
K.imagenExiste = img => { const p = K.partesImagen(img); return p.registro !== K.REGISTRO || ((K.ETIQUETAS[p.repo] || []).indexOf(p.tag) >= 0); };
const vmayor = (a, b) => { const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return true; };

// Cómo se comporta cada aplicación: memoria, CPU, rutas que sirve, qué
// configuración exige y qué escribe en su log. De aquí salen los fallos: nada
// de «este pod falla porque lo dice el ticket».
const APPS = {
  'api-pagos': { mem: 310, cpu: 140, rutas: () => ['/healthz', '/api/v1/pagos'], requiere: tag => ['DB_HOST', 'PASARELA_URL'].concat(vmayor(tag, '2.16.0') ? ['PASARELA_TIMEOUT_MS'] : []) },
  'web-checkout': { mem: 38, cpu: 22, rutas: tag => vmayor(tag, '1.9.0') ? ['/', '/ready', '/checkout'] : ['/', '/health', '/checkout'] },
  antifraude: { mem: 300, memCaliente: 720, caliente: 3, cpu: 380, rutas: () => ['/actuator/health', '/score'] },
  liquidaciones: { mem: 610, cpu: 1210, rutas: () => ['/health'] },
  coredns: { mem: 24, cpu: 6, rutas: () => ['/ready', '/health'] },
  prometheus: { mem: 1640, cpu: 260, rutas: () => ['/-/ready', '/-/healthy'] },
  alertmanager: { mem: 42, cpu: 4, rutas: () => ['/-/ready'] },
  grafana: { mem: 118, cpu: 12, rutas: () => ['/api/health'] },
  'blackbox-exporter': { mem: 18, cpu: 3, rutas: () => ['/-/healthy'] },
  controller: { mem: 140, cpu: 35, rutas: () => ['/healthz'] },
  'cert-manager-controller': { mem: 46, cpu: 4, rutas: () => ['/livez'] },
};
K.APPS = APPS;
K.appDe = pod => { const p = K.partesImagen(pod.tpl.imagen), nombre = p.repo.split('/').pop(); return { nombre, tag: p.tag, def: APPS[nombre] || { mem: 32, cpu: 5, rutas: () => ['/'] } }; };
K.sirve = (pod, ruta) => { const a = K.appDe(pod); return a.def.rutas(a.tag).indexOf(ruta) >= 0; };
// Memoria que usaría el proceso ahora (sin contar el límite).
// La CPU puede depender de la carga (fase 2: la HPA de api-pagos).
K.cpuApp = (st, pod) => { const c = K.appDe(pod).def.cpu; return typeof c === 'function' ? c(st, pod) : c; };
K.memApp = (pod, t) => { const a = K.appDe(pod).def, c = pod.c; return a.memCaliente && c.arranque != null && t - c.arranque >= a.caliente ? a.memCaliente : a.mem; };

// ------------------------------------------------------------------ la plataforma de partida
const ALLOC = { worker: { cpu: 3900, mem: 15400 }, cp: { cpu: 1900, mem: 7400 } };
const CREADO = -11520;    // el último despliegue (los pods y sus ReplicaSets): hace 8 días
const ANTIGUO = -172800;  // el clúster y sus objetos de larga vida: hace 120 días
K.ANTIGUO = ANTIGUO;
// Un Deployment: imagen, réplicas, requests y límites, sonda y ConfigMap.
const dep = (ns, nombre, replicas, imagen, o) => ({
  ns, nombre, replicas, labels: { app: nombre },
  tpl: Object.assign({ contenedor: nombre, imagen, puerto: 8080, envFrom: null, env: {}, req: { cpu: 100, mem: 128 }, lim: {}, ready: null, labels: { app: nombre }, anot: {} }, o),
});
const BASE_DEPS = [
  dep('kube-system', 'coredns', 2, 'registry.k8s.io/coredns/coredns:v1.11.1', { puerto: 53, req: { cpu: 100, mem: 70 }, lim: { mem: 170 }, ready: { path: '/ready', port: 8181 }, labels: { 'k8s-app': 'kube-dns' } }),
  dep('monitoring', 'prometheus', 1, 'quay.io/prometheus/prometheus:v2.53.0', { puerto: 9090, req: { cpu: 500, mem: 2048 }, lim: { mem: 4096 }, ready: { path: '/-/ready', port: 9090 }, pvc: { nombre: 'prometheus-data', ruta: '/prometheus' } }),
  dep('ingress-nginx', 'ingress-nginx-controller', 2, 'registry.k8s.io/ingress-nginx/controller:v1.10.1', { contenedor: 'controller', puerto: 443, req: { cpu: 100, mem: 90 }, lim: { mem: 512 }, ready: { path: '/healthz', port: 10254 } }),
  dep('cert-manager', 'cert-manager', 1, 'quay.io/jetstack/cert-manager-controller:v1.15.1', { contenedor: 'cert-manager-controller', puerto: 9402, req: { cpu: 50, mem: 64 }, lim: { mem: 256 } }),
  dep('monitoring', 'alertmanager', 1, 'quay.io/prometheus/alertmanager:v0.27.0', { puerto: 9093, req: { cpu: 100, mem: 128 }, lim: { mem: 256 }, ready: { path: '/-/ready', port: 9093 } }),
  dep('monitoring', 'grafana', 1, 'docker.io/grafana/grafana:11.1.0', { puerto: 3000, req: { cpu: 100, mem: 256 }, lim: { mem: 512 }, ready: { path: '/api/health', port: 3000 } }),
  dep('monitoring', 'blackbox-exporter', 1, 'quay.io/prometheus/blackbox-exporter:v0.25.0', { puerto: 9115, req: { cpu: 50, mem: 64 }, lim: { mem: 128 } }),
  dep('pagos', 'api-pagos', 3, K.REGISTRO + '/api-pagos:2.14.1', { envFrom: 'api-pagos-config', req: { cpu: 250, mem: 256 }, lim: { mem: 512 }, ready: { path: '/healthz', port: 8080 } }),
  dep('pagos', 'web-checkout', 2, K.REGISTRO + '/web-checkout:1.8.3', { puerto: 80, req: { cpu: 100, mem: 128 }, lim: { mem: 256 }, ready: { path: '/health', port: 80 } }),
  dep('pagos', 'antifraude', 2, K.REGISTRO + '/antifraude:3.3.1', { envFrom: 'antifraude-config', req: { cpu: 500, mem: 768 }, lim: { mem: 1024 }, ready: { path: '/actuator/health', port: 8080 } }),
  dep('pagos', 'liquidaciones', 2, K.REGISTRO + '/liquidaciones:1.4.1', { req: { cpu: 1500, mem: 1024 }, lim: { mem: 2048 }, ready: { path: '/health', port: 8080 } }),
];
// Los nombres de los Deployments, por si un ticket o un test los quiere recorrer.
K.DEPLOYMENTS = BASE_DEPS.map(d => d.ns + '/' + d.nombre);
const BASE_CMS = [
  { ns: 'pagos', nombre: 'api-pagos-config', data: { DB_HOST: 'pagos-db.pagos.internal', DB_NAME: 'pagos', LOG_LEVEL: 'info', PASARELA_URL: 'https://api.pasarela-pagos.example/v3' } },
  { ns: 'pagos', nombre: 'antifraude-config', data: { MODELO: 'gbm-2026-09', UMBRAL_BLOQUEO: '0.92' } },
];
const BASE_SVCS = [
  { ns: 'kube-system', nombre: 'kube-dns', selector: { 'k8s-app': 'kube-dns' }, puerto: 53, targetPort: 53, proto: 'UDP', ip: '10.96.0.10' },
  { ns: 'monitoring', nombre: 'prometheus', selector: { app: 'prometheus' }, puerto: 9090, targetPort: 9090, ip: '10.96.41.12' },
  { ns: 'monitoring', nombre: 'alertmanager', selector: { app: 'alertmanager' }, puerto: 9093, targetPort: 9093, ip: '10.96.41.30' },
  { ns: 'monitoring', nombre: 'grafana', selector: { app: 'grafana' }, puerto: 3000, targetPort: 3000, ip: '10.96.41.51' },
  { ns: 'pagos', nombre: 'api-pagos', selector: { app: 'api-pagos' }, puerto: 8080, targetPort: 8080, ip: '10.96.120.14' },
  { ns: 'pagos', nombre: 'web-checkout', selector: { app: 'web-checkout' }, puerto: 80, targetPort: 80, ip: '10.96.120.40' },
  { ns: 'pagos', nombre: 'antifraude', selector: { app: 'antifraude' }, puerto: 8080, targetPort: 8080, ip: '10.96.120.77' },
  { ns: 'ingress-nginx', nombre: 'ingress-nginx-controller', selector: { app: 'ingress-nginx-controller' }, puerto: 443, targetPort: 443, ip: '10.96.8.15' },
  { ns: 'cert-manager', nombre: 'cert-manager', selector: { app: 'cert-manager' }, puerto: 9402, targetPort: 9402, ip: '10.96.9.40' },
];
K.NAMESPACES = ['cert-manager', 'ci', 'default', 'ingress-nginx', 'kube-node-lease', 'kube-public', 'kube-system', 'monitoring', 'pagos'];
// El repositorio de manifiestos (~/k8s): lo que DEBERÍA haber en el clúster.
const RUTAS_REPO = { 'pagos/api-pagos': 'api-pagos/deployment.yaml', 'pagos/web-checkout': 'web-checkout/deployment.yaml', 'pagos/antifraude': 'antifraude/deployment.yaml', 'pagos/liquidaciones': 'liquidaciones/deployment.yaml' };
const RUTAS_CM = { 'pagos/api-pagos-config': 'api-pagos/configmap.yaml', 'pagos/antifraude-config': 'antifraude/configmap.yaml' };
const RUTAS_SVC = { 'pagos/api-pagos': 'api-pagos/service.yaml', 'pagos/web-checkout': 'web-checkout/service.yaml', 'pagos/antifraude': 'antifraude/service.yaml' };
K.REPO = HOME + '/k8s';

P.alCrear.push(st => {
  const k = st.k8s = { nodos: {}, deps: {}, rss: [], pods: [], svcs: {}, cms: {}, eventos: [], repo: {}, podN: 0, ipN: {} };
  P.topologia.filter(d => d.rol === 'cp' || d.rol === 'worker').forEach((d, i) => {
    k.nodos[d.n] = { nombre: d.n, rol: d.rol, ip: d.ip, idx: i, cpu: ALLOC[d.rol].cpu, mem: ALLOC[d.rol].mem, cordon: false, creado: ANTIGUO, caidoHasta: null };
    k.ipN[d.n] = 10;
  });
  BASE_CMS.forEach(c => { k.cms[c.ns + '/' + c.nombre] = Object.assign(copia(c), { creado: ANTIGUO, rv: 1 }); });
  BASE_SVCS.forEach(s => { k.svcs[s.ns + '/' + s.nombre] = Object.assign(copia(s), { creado: ANTIGUO }); });
  // Los pods de sistema: DaemonSets en cada nodo y los estáticos del control plane.
  Object.values(k.nodos).forEach(n => {
    const dsPod = (nombre, img, cpu, mem) => fijo(k, 'kube-system', nombre + '-' + K.id(nombre + n.nombre, 5), img, n.nombre, cpu, mem, 'DaemonSet/' + nombre);
    dsPod('kube-proxy', 'registry.k8s.io/kube-proxy:v1.29.8', 0, 0);
    dsPod('calico-node', 'docker.io/calico/node:v3.28.1', 250, 0);
    if (n.rol === 'cp') ['etcd', 'kube-apiserver', 'kube-controller-manager', 'kube-scheduler'].forEach((c, i) => fijo(k, 'kube-system', c + '-' + n.nombre, 'registry.k8s.io/' + (c === 'etcd' ? 'etcd:3.5.15-0' : c + ':v1.29.8'), n.nombre, [100, 250, 200, 100][i], [100, 0, 0, 0][i], 'Node/' + n.nombre));
  });
  BASE_DEPS.forEach(d => {
    const x = k.deps[d.ns + '/' + d.nombre] = Object.assign(copia(d), { creado: ANTIGUO, rev: 1, causa: '<none>', progreso: CREADO, atascado: false, faltaDesde: null, historia: [] });
    nuevaRs(st, x, CREADO, true);
  });
  // Colocación inicial: los pods llevan días corriendo.
  programar(st, CREADO);
  k.pods.forEach(p => { if (p.nodo) Object.assign(p.c, { estado: 'corriendo', arranque: CREADO + 1, env: envDe(st, p), listoDesde: CREADO + 2 }); });
  // El repositorio refleja el clúster sano.
  Object.keys(RUTAS_REPO).forEach(key => { k.repo[RUTAS_REPO[key]] = K.manifiesto(st, 'Deployment', key); });
  Object.keys(RUTAS_CM).forEach(key => { k.repo[RUTAS_CM[key]] = K.manifiesto(st, 'ConfigMap', key); });
  Object.keys(RUTAS_SVC).forEach(key => { k.repo[RUTAS_SVC[key]] = K.manifiesto(st, 'Service', key); });
  k.eventos = [];
});
function fijo(k, ns, nombre, imagen, nodo, cpu, mem, dueno) {
  k.pods.push({ ns, nombre, dueno, rs: null, dep: null, tpl: { contenedor: nombre.replace(/-[a-z0-9]{5}$/, '').replace(/-cp-01$/, ''), imagen, puerto: 0, env: {}, envFrom: null, req: { cpu, mem }, lim: {}, ready: null, labels: { component: nombre.replace(/-[a-z0-9]{5}$/, '').replace(/-cp-01$/, '') } },
    labels: {}, creado: CREADO, nodo, ip: nodo === 'cp-01' || /calico|proxy/.test(nombre) ? '10.30.0.' + ({ 'cp-01': 10, 'worker-01': 21, 'worker-02': 22, 'worker-03': 23 })[nodo] : null, sistema: true,
    c: { estado: 'corriendo', razon: null, arranque: CREADO + 1, reinicios: 0, ultimo: null, proximo: null, env: {}, listoDesde: CREADO + 2, pulls: 0 } });
}

// ------------------------------------------------------------------ objetos
K.dep = (st, key) => st.k8s.deps[key];
K.rssDe = (st, d) => st.k8s.rss.filter(r => r.dep === d.ns + '/' + d.nombre);
K.podsDeRs = (st, r) => st.k8s.pods.filter(p => p.rs === r.nombre && p.ns === r.ns);
K.podsDe = (st, d) => st.k8s.pods.filter(p => p.dep === d.ns + '/' + d.nombre);
K.nodoListo = (st, n, t) => { const h = st.hosts[n.nombre]; return !!(h && h.up && h.svcs.kubelet.estado === 'active' && h.svcs.containerd.estado === 'active' && !(n.caidoHasta != null && (t == null ? st.reloj : t) < n.caidoHasta)); };
K.listo = (st, p) => !!(p.nodo && p.c.listoDesde != null && K.nodoListo(st, st.k8s.nodos[p.nodo]));
// La misma plantilla da siempre el mismo hash: se calcula una vez (es lo más caro del bucle).
const HASHES = new Map();
const hashTpl = (d, tpl) => {
  const j = JSON.stringify(tpl), k = d.ns + d.nombre + j;
  let h = HASHES.get(k);
  if (!h) { h = K.id(k, 10).replace(/^(.{9}).*/, '$1') + K.id('x' + j, 1); HASHES.set(k, h); }
  return h;
};
function nuevaRs(st, d, t, inicial) {
  const k = st.k8s, h = hashTpl(d, d.tpl);
  let r = k.rss.find(x => x.dep === d.ns + '/' + d.nombre && x.hash === h);
  if (r) { r.rev = d.rev; return r; }
  r = { ns: d.ns, nombre: d.nombre + '-' + h, hash: h, dep: d.ns + '/' + d.nombre, rev: d.rev, tpl: copia(d.tpl), deseado: inicial ? d.replicas : 0, creado: t, causa: d.causa };
  k.rss.push(r);
  if (inicial) for (let i = 0; i < d.replicas; i++) crearPod(st, r, t);
  return r;
}
function crearPod(st, r, t) {
  const k = st.k8s, n = K.id(r.nombre + ':' + (k.podN++), 5);
  const p = { ns: r.ns, nombre: r.nombre + '-' + n, rs: r.nombre, dep: r.dep, tpl: r.tpl, labels: Object.assign({}, r.tpl.labels, { 'pod-template-hash': r.hash }), creado: t, nodo: null, ip: null,
    c: { estado: 'creando', razon: null, arranque: null, reinicios: 0, ultimo: null, proximo: null, env: null, listoDesde: null, pulls: 0 }, programadoEn: null };
  k.pods.push(p);
  K.evento(st, t, r.ns, 'Normal', 'SuccessfulCreate', 'replicaset/' + r.nombre, 'Created pod: ' + p.nombre, 'replicaset-controller');
  return p;
}
function borrarPod(st, p, t) {
  const k = st.k8s;
  k.pods = k.pods.filter(x => x !== p);
  if (p.rs) K.evento(st, t, p.ns, 'Normal', 'SuccessfulDelete', 'replicaset/' + p.rs, 'Deleted pod: ' + p.nombre, 'replicaset-controller');
  if (p.nodo && p.c.estado === 'corriendo') K.evento(st, t, p.ns, 'Normal', 'Killing', 'pod/' + p.nombre, 'Stopping container ' + p.tpl.contenedor, 'kubelet');
}
K.borrarPod = borrarPod;

// Eventos con su contador, como los agrega el apiserver: «(x14 over 32m)».
K.evento = (st, t, ns, tipo, razon, obj, msg, de) => {
  const ev = st.k8s.eventos, e = ev.find(x => x.obj === obj && x.razon === razon && x.msg === msg);
  if (e) { e.n++; e.min = t; return; }
  ev.push({ ns, tipo, razon, obj, msg, de: de || 'kubelet', n: 1, primero: t, min: t });
  if (ev.length > 600) ev.splice(0, ev.length - 600);
};

// ------------------------------------------------------------------ cambios en un Deployment
// Cambiar la plantilla crea una revisión nueva (o reutiliza el ReplicaSet que ya
// tenía esa plantilla: así funciona rollout undo).
K.cambiarPlantilla = (st, d, tpl, causa, t) => {
  if (JSON.stringify(tpl) === JSON.stringify(d.tpl)) return false;
  d.historia.push({ rev: d.rev, causa: d.causa });
  d.tpl = copia(tpl); d.rev = Math.max(d.rev, ...K.rssDe(st, d).map(r => r.rev)) + 1; d.causa = causa || '<none>';
  const r = nuevaRs(st, d, t);
  r.causa = d.causa;
  d.progreso = t; d.atascado = false; d.enRollout = true;
  K.evento(st, t, d.ns, 'Normal', 'ScalingReplicaSet', 'deployment/' + d.nombre, 'Scaled up replica set ' + r.nombre + ' to ' + Math.max(1, r.deseado), 'deployment-controller');
  return true;
};
K.rsActual = (st, d) => { const h = hashTpl(d, d.tpl); return K.rssDe(st, d).find(r => r.hash === h); };

// ------------------------------------------------------------------ reconciliación
function controladorDeployments(st, t) {
  Object.values(st.k8s.deps).forEach(d => {
    const nuevo = K.rsActual(st, d) || nuevaRs(st, d, t), viejos = K.rssDe(st, d).filter(r => r !== nuevo && (r.deseado > 0 || K.podsDeRs(st, r).length));
    const D = d.replicas, surge = Math.ceil(D * 0.25), unav = Math.floor(D * 0.25) || (surge ? 0 : 1);
    const listos = r => K.podsDeRs(st, r).filter(p => K.listo(st, p)).length;
    const antes = nuevo.deseado + ':' + viejos.map(r => r.deseado).join(',');
    if (!viejos.length) nuevo.deseado = D;
    else {
      let quitar = K.podsDe(st, d).filter(p => K.listo(st, p)).length - (D - unav);
      viejos.sort((a, b) => a.creado - b.creado).forEach(r => {
        const malos = Math.max(0, r.deseado - listos(r)), buenos = Math.min(Math.max(0, quitar), r.deseado - malos);
        const n = Math.min(r.deseado, malos + buenos);
        if (n > 0) { r.deseado -= n; quitar -= buenos; K.evento(st, t, d.ns, 'Normal', 'ScalingReplicaSet', 'deployment/' + d.nombre, 'Scaled down replica set ' + r.nombre + ' to ' + r.deseado + ' from ' + (r.deseado + n), 'deployment-controller'); }
      });
      const sumaViejos = viejos.reduce((s, r) => s + r.deseado, 0), objetivo = Math.min(D, Math.max(nuevo.deseado, D + surge - sumaViejos));
      if (objetivo > nuevo.deseado) { K.evento(st, t, d.ns, 'Normal', 'ScalingReplicaSet', 'deployment/' + d.nombre, 'Scaled up replica set ' + nuevo.nombre + ' to ' + objetivo + ' from ' + nuevo.deseado, 'deployment-controller'); nuevo.deseado = objetivo; }
    }
    // Progreso: cualquier cambio de escala o un pod nuevo listo.
    const ahora = nuevo.deseado + ':' + viejos.map(r => r.deseado).join(','), ln = listos(nuevo);
    if (ahora !== antes || ln > (d.listosNuevo || 0)) d.progreso = t;
    d.listosNuevo = ln;
    const completo = K.completo(st, d);
    // El plazo de progreso sólo corre durante un rollout (un cambio de plantilla):
    // como en el controlador de verdad, un pod que cae después o un scale no lo activan.
    if (completo) { d.atascado = false; d.enRollout = false; }
    else if (d.enRollout && t - d.progreso >= 10) d.atascado = true;
    const disp = K.podsDe(st, d).filter(p => K.listo(st, p)).length;
    if (disp < D) { if (d.faltaDesde == null) d.faltaDesde = t; } else d.faltaDesde = null;
  });
}
K.completo = (st, d) => { const n = K.rsActual(st, d); return !!n && n.deseado === d.replicas && K.podsDeRs(st, n).filter(p => K.listo(st, p)).length === d.replicas && K.rssDe(st, d).every(r => r === n || (!r.deseado && !K.podsDeRs(st, r).length)); };
function controladorReplicaSets(st, t) {
  st.k8s.rss.forEach(r => {
    const ps = K.podsDeRs(st, r);
    for (let i = ps.length; i < r.deseado; i++) crearPod(st, r, t);
    if (ps.length > r.deseado) {
      // Se borran antes los que no están colocados, luego los que no están listos, luego los más nuevos.
      ps.slice().sort((a, b) => (!!a.nodo - !!b.nodo) || (K.listo(st, a) - K.listo(st, b)) || (b.creado - a.creado)).slice(0, ps.length - r.deseado).forEach(p => borrarPod(st, p, t));
    }
  });
}
// El scheduler: nodos listos, sin cordon, sin taint del control plane, con
// requests libres. Entre los que valen, el que tenga menos pods de la misma
// aplicación y luego más CPU libre (reparte las réplicas, como el de verdad).
K.libre = (st, n) => {
  const ps = st.k8s.pods.filter(p => p.nodo === n.nombre);
  return { cpu: n.cpu - ps.reduce((s, p) => s + (p.tpl.req.cpu || 0), 0), mem: n.mem - ps.reduce((s, p) => s + (p.tpl.req.mem || 0), 0) };
};
function programar(st, t) {
  const k = st.k8s, nodos = Object.values(k.nodos).sort((a, b) => (a.nombre < b.nombre ? -1 : 1));
  k.pods.filter(p => !p.nodo).sort((a, b) => a.creado - b.creado || (a.nombre < b.nombre ? -1 : 1)).forEach(p => {
    const motivos = {}, valen = [];
    nodos.forEach(n => {
      if (n.rol === 'cp') { motivos['1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }'] = 1; return; }
      if (!K.nodoListo(st, n, t)) { motivos.notReady = (motivos.notReady || 0) + 1; return; }
      if (n.cordon) { motivos.unsched = (motivos.unsched || 0) + 1; return; }
      const l = K.libre(st, n);
      if (l.cpu < (p.tpl.req.cpu || 0)) { motivos.cpu = (motivos.cpu || 0) + 1; return; }
      if (l.mem < (p.tpl.req.mem || 0)) { motivos.mem = (motivos.mem || 0) + 1; return; }
      valen.push({ n, mismos: k.pods.filter(x => x.nodo === n.nombre && x.dep && x.dep === p.dep).length, cpu: l.cpu });
    });
    if (!valen.length) {
      const partes = [];
      Object.keys(motivos).filter(x => /taint/.test(x)).forEach(x => partes.push(x));
      if (motivos.notReady) partes.push(motivos.notReady + ' node(s) had untolerated taint {node.kubernetes.io/not-ready: }');
      if (motivos.unsched) partes.push(motivos.unsched + ' node(s) were unschedulable');
      if (motivos.cpu) partes.push(motivos.cpu + ' Insufficient cpu');
      if (motivos.mem) partes.push(motivos.mem + ' Insufficient memory');
      const pre = (motivos.cpu || 0) + (motivos.mem || 0), resto = nodos.length - pre;
      p.motivoPending = '0/' + nodos.length + ' nodes are available: ' + partes.join(', ') + '. preemption: 0/' + nodos.length + ' nodes are available: ' + (pre ? pre + ' No preemption victims found for incoming pod, ' : '') + resto + ' Preemption is not helpful for scheduling.';
      K.evento(st, t, p.ns, 'Warning', 'FailedScheduling', 'pod/' + p.nombre, p.motivoPending, 'default-scheduler');
      return;
    }
    valen.sort((a, b) => a.mismos - b.mismos || b.cpu - a.cpu || (a.n.nombre < b.n.nombre ? -1 : 1));
    const n = valen[0].n;
    p.nodo = n.nombre; p.programadoEn = t; p.motivoPending = null;
    p.ip = '10.244.' + (n.idx + 1) + '.' + (k.ipN[n.nombre]++ % 250 + 2);
    K.evento(st, t, p.ns, 'Normal', 'Scheduled', 'pod/' + p.nombre, 'Successfully assigned ' + p.ns + '/' + p.nombre + ' to ' + n.nombre, 'default-scheduler');
  });
}
// El entorno del contenedor se lee AL ARRANCAR: cambiar el ConfigMap no cambia
// lo que ven los pods que ya corren. Ésa es media lección del primer ticket.
function envDe(st, p) {
  const env = {};
  if (p.tpl.envFrom) { const cm = st.k8s.cms[p.ns + '/' + p.tpl.envFrom]; if (!cm) return null; Object.assign(env, cm.data); }
  return Object.assign(env, p.tpl.env);
}
K.envDe = envDe;
// Por qué se muere un contenedor que ha arrancado: configuración que falta o memoria.
K.fallosExtra = [];   // (st, pod) -> fallo | null: lo que añaden otros ficheros (un volumen lleno)
K.fallo = (st, p) => {
  for (const g of K.fallosExtra) { const r = g(st, p); if (r) return r; }
  const a = K.appDe(p), c = p.c;
  if (a.def.requiere) { const falta = (typeof a.def.requiere === 'function' ? a.def.requiere(a.tag) : a.def.requiere).filter(x => !(c.env || {})[x]); if (falta.length) return { tras: 0, razon: 'Error', codigo: 1, falta }; }
  const lim = p.tpl.lim.mem;
  if (lim) {
    if (a.def.mem > lim) return { tras: 0, razon: 'OOMKilled', codigo: 137 };
    if (a.def.memCaliente && a.def.memCaliente > lim) return { tras: a.def.caliente, razon: 'OOMKilled', codigo: 137 };
  }
  return null;
};
const BACKOFF = [1, 1, 1, 2, 3, 5];
function kubelet(st, t) {
  st.k8s.pods.filter(p => p.nodo && !p.sistema).forEach(p => {
    const n = st.k8s.nodos[p.nodo], c = p.c, obj = 'pod/' + p.nombre, img = p.tpl.imagen;
    if (!K.nodoListo(st, n, t)) {
      if (c.estado === 'corriendo') { c.reinicios++; c.ultimo = { razon: 'Unknown', codigo: 255, inicio: c.arranque, fin: t, nodo: true }; }
      if (c.estado !== 'espera' || c.razon !== 'CrashLoopBackOff') { c.estado = 'creando'; c.razon = null; }
      c.listoDesde = null; return;
    }
    if (c.estado === 'creando' || (c.estado === 'espera' && t >= c.proximo)) {
      if (!K.imagenExiste(img)) {
        c.pulls++;
        K.evento(st, t, p.ns, 'Normal', 'Pulling', obj, 'Pulling image "' + img + '"');
        K.evento(st, t, p.ns, 'Warning', 'Failed', obj, 'Failed to pull image "' + img + '": rpc error: code = NotFound desc = failed to pull and unpack image "' + img + '": failed to resolve reference "' + img + '": ' + img + ': not found');
        K.evento(st, t, p.ns, 'Warning', 'Failed', obj, 'Error: ErrImagePull');
        K.evento(st, t, p.ns, 'Normal', 'BackOff', obj, 'Back-off pulling image "' + img + '"');
        K.evento(st, t, p.ns, 'Warning', 'Failed', obj, 'Error: ImagePullBackOff');
        c.estado = 'espera'; c.razon = c.pulls === 1 ? 'ErrImagePull' : 'ImagePullBackOff'; c.proximo = t + BACKOFF[Math.min(c.pulls, BACKOFF.length) - 1];
        c.listoDesde = null; return;
      }
      const env = envDe(st, p);
      if (!env) {
        c.estado = 'espera'; c.razon = 'CreateContainerConfigError'; c.proximo = t + 1; c.listoDesde = null;
        K.evento(st, t, p.ns, 'Warning', 'Failed', obj, 'Error: configmap "' + p.tpl.envFrom + '" not found');
        return;
      }
      if (c.arranque == null) K.evento(st, t, p.ns, 'Normal', 'Pulled', obj, 'Container image "' + img + '" already present on machine');
      K.evento(st, t, p.ns, 'Normal', 'Created', obj, 'Created container ' + p.tpl.contenedor);
      K.evento(st, t, p.ns, 'Normal', 'Started', obj, 'Started container ' + p.tpl.contenedor);
      c.estado = 'corriendo'; c.razon = null; c.arranque = t; c.env = env;
    }
    if (c.estado !== 'corriendo') { c.listoDesde = null; return; }
    const f = K.fallo(st, p);
    if (f && t >= c.arranque + f.tras) {
      c.reinicios++;
      c.ultimo = Object.assign({}, f, { inicio: c.arranque, fin: t, env: c.env });
      c.estado = 'espera'; c.razon = 'CrashLoopBackOff'; c.proximo = t + BACKOFF[Math.min(c.reinicios, BACKOFF.length) - 1]; c.listoDesde = null;
      K.evento(st, t, p.ns, 'Warning', 'BackOff', obj, 'Back-off restarting failed container ' + p.tpl.contenedor + ' in pod ' + p.nombre + '_' + p.ns + '(' + U.uuid(p.nombre).slice(0, 36) + ')');
      return;
    }
    const sonda = p.tpl.ready, ok = !sonda || K.sirve(p, sonda.path);
    if (sonda && !ok && t >= c.arranque + 1) K.evento(st, t, p.ns, 'Warning', 'Unhealthy', obj, 'Readiness probe failed: HTTP probe failed with statuscode: 404');
    if (ok && t >= c.arranque + 1) { if (c.listoDesde == null) c.listoDesde = t; } else c.listoDesde = null;
  });
}
// Dos vueltas por minuto: crear un pod, programarlo y arrancarlo lleva segundos
// en un clúster de verdad, así que el que crea la segunda pasada del controlador
// también arranca en este minuto.
K.controladoresExtra = [];   // (st, t): cert-manager, la HPA... (fase 2)
// El ciclo de vida de los nodos: un nodo NotReady durante 5 minutos pierde sus
// pods (los desaloja el taint node.kubernetes.io/unreachable, tolerationSeconds
// 300) y sus ReplicaSets los recrean en otro sitio. Los de sistema se quedan.
function cicloNodos(st, t) {
  Object.values(st.k8s.nodos).forEach(n => {
    if (K.nodoListo(st, n, t)) { n.noListoDesde = null; return; }
    if (n.noListoDesde == null) { n.noListoDesde = t; K.evento(st, t, '', 'Normal', 'NodeNotReady', 'node/' + n.nombre, 'Node ' + n.nombre + ' status is now: NodeNotReady', 'node-controller'); }
    if (t - n.noListoDesde < 5) return;
    st.k8s.pods.filter(p => p.nodo === n.nombre && p.rs).forEach(p => {
      K.evento(st, t, p.ns, 'Normal', 'TaintManagerEviction', 'pod/' + p.nombre, 'Marking for deletion Pod ' + p.ns + '/' + p.nombre, 'taint-eviction-controller');
      borrarPod(st, p, t);
    });
  });
}
K.reconciliar = (st, t) => {
  cicloNodos(st, t);
  K.controladoresExtra.forEach(f => f(st, t));
  for (let v = 0; v < 2; v++) {
    controladorDeployments(st, t);
    controladorReplicaSets(st, t);
    programar(st, t);
    kubelet(st, t);
  }
  controladorDeployments(st, t);
  controladorReplicaSets(st, t);
};
// Corre el bucle desde un minuto del pasado hasta ahora (escenarios).
// Lo programado para un minuto del pasado (un rollout undo a mitad de la historia) corre en su minuto.
K.simular = (st, desde, hasta) => { for (let t = desde; t <= (hasta == null ? 0 : hasta); t++) { K.reconciliar(st, t); (st.programados || []).forEach(e => { if (e.min === t) e.fn(st, P); }); } };
P.ticks.push(st => { if (st.k8s) K.reconciliar(st, st.reloj); });
// Un nodo que se reinicia: sus contenedores mueren y vuelven a arrancar.
K.reinicioNodo = (st, nombre, t, dur) => {
  const n = st.k8s.nodos[nombre]; n.caidoHasta = t + (dur || 3);
  K.evento(st, t, '', 'Normal', 'Rebooted', 'node/' + nombre, 'Node ' + nombre + ' has been rebooted, boot id: ' + U.uuid(nombre + t), 'kubelet');
  K.evento(st, t, '', 'Normal', 'NodeNotReady', 'node/' + nombre, 'Node ' + nombre + ' status is now: NodeNotReady', 'node-controller');
  K.evento(st, t + (dur || 3), '', 'Normal', 'NodeReady', 'node/' + nombre, 'Node ' + nombre + ' status is now: NodeReady', 'kubelet');
};
K.drenar = (st, nombre, t) => {
  const n = st.k8s.nodos[nombre]; n.cordon = true;
  st.k8s.pods.filter(p => p.nodo === nombre && p.rs).forEach(p => { K.evento(st, t, p.ns, 'Normal', 'Evicted', 'pod/' + p.nombre, 'Pod evicted by drain', 'kubectl'); borrarPod(st, p, t); });
};

// ------------------------------------------------------------------ vistas para kubectl, paneles y alertas
K.estadoPod = (st, p) => {
  const c = p.c;
  if (!p.nodo) return 'Pending';
  if (!K.nodoListo(st, st.k8s.nodos[p.nodo])) return c.estado === 'corriendo' ? 'Unknown' : 'ContainerCreating';
  if (c.estado === 'espera') return c.razon;
  if (c.estado === 'creando') return 'ContainerCreating';
  return 'Running';
};
K.endpoints = (st, svc) => st.k8s.pods.filter(p => p.ns === svc.ns && Object.keys(svc.selector).every(k => p.labels[k] === svc.selector[k]) && K.listo(st, p));
// ¿Deja pasar la red un paquete de un pod a otro? Sin NetworkPolicies, sí (fase 2 la sustituye).
K.permiteRed = () => true;
K.alcanza = (st, origen, svcKey) => { const s = st.k8s.svcs[svcKey]; return !!s && K.endpoints(st, s).some(d => K.permiteRed(st, origen, d, s.targetPort)); };
K.resumenDep = (st, d) => {
  const ps = K.podsDe(st, d), n = K.rsActual(st, d);
  return { listos: ps.filter(p => K.listo(st, p)).length, total: ps.length, actualizados: n ? K.podsDeRs(st, n).length : 0, completo: K.completo(st, d) };
};

// ------------------------------------------------------------------ manifiestos
// El mismo objeto sirve para ~/k8s/*.yaml, para kubectl get -o yaml y para
// kubectl apply/diff: si el YAML del repositorio y el del clúster coinciden,
// no hay deriva.
// Otros ficheros registran sus kinds aquí: { prefijo, grupo, manifiesto(st, key), yaml(m), aplicar(st, m, t, vivo) }.
K.kinds = {};
K.manifiesto = (st, kind, key) => {
  if (K.kinds[kind]) return K.kinds[kind].manifiesto(st, key);
  const k = st.k8s;
  if (kind === 'Deployment') { const d = k.deps[key]; return d && { kind, ns: d.ns, nombre: d.nombre, replicas: d.replicas, labels: copia(d.labels), tpl: copia(d.tpl) }; }
  if (kind === 'ConfigMap') { const c = k.cms[key]; return c && { kind, ns: c.ns, nombre: c.nombre, data: copia(c.data) }; }
  if (kind === 'Service') { const s = k.svcs[key]; return s && { kind, ns: s.ns, nombre: s.nombre, selector: copia(s.selector), puerto: s.puerto, targetPort: s.targetPort, proto: s.proto }; }
  return null;
};
const sel = o => Object.keys(o).map(k => k + '=' + o[k]).join(',');
K.sel = sel;
// Un YAML mínimo pero válido, con el orden de campos que escribe la gente.
K.yaml = (v, ind) => {
  ind = ind || '';
  const esc = s => (typeof s === 'string' && (/^[\d.]+$/.test(s) || /[:#{}[\],&*?|<>=!%@`'"]/.test(s) || s === '' || /^(true|false|null|yes|no)$/i.test(s)) ? '"' + s.replace(/"/g, '\\"') + '"' : String(s));
  const out = [];
  Object.keys(v).forEach(k => {
    const x = v[k];
    if (x == null) return;
    if (Array.isArray(x)) {
      out.push(ind + k + ':');
      x.forEach(e => {
        if (e && typeof e === 'object') { const sub = K.yaml(e, ind + '  '); sub[0] = ind + '- ' + sub[0].slice(ind.length + 2); out.push(...sub); }
        else out.push(ind + '- ' + esc(e));
      });
    } else if (typeof x === 'object') { if (!Object.keys(x).length) out.push(ind + k + ': {}'); else { out.push(ind + k + ':'); out.push(...K.yaml(x, ind + '  ')); } }
    else out.push(ind + k + ': ' + esc(x));
  });
  return out;
};
K.contenedor = tpl => {
  const c = { name: tpl.contenedor, image: tpl.imagen };
  if (tpl.puerto) c.ports = [{ containerPort: tpl.puerto }];
  if (tpl.envFrom) c.envFrom = [{ configMapRef: { name: tpl.envFrom } }];
  if (Object.keys(tpl.env).length) c.env = Object.keys(tpl.env).map(k => ({ name: k, value: tpl.env[k] }));
  const req = {}, lim = {};
  if (tpl.req.cpu) req.cpu = K.cpu(tpl.req.cpu); if (tpl.req.mem) req.memory = K.mem(tpl.req.mem);
  if (tpl.lim.cpu) lim.cpu = K.cpu(tpl.lim.cpu); if (tpl.lim.mem) lim.memory = K.mem(tpl.lim.mem);
  c.resources = {}; if (Object.keys(req).length) c.resources.requests = req; if (Object.keys(lim).length) c.resources.limits = lim;
  if (tpl.ready) c.readinessProbe = { httpGet: { path: tpl.ready.path, port: tpl.ready.port }, initialDelaySeconds: 5, periodSeconds: 10 };
  if (tpl.pvc) c.volumeMounts = [{ name: 'datos', mountPath: tpl.pvc.ruta }];
  return c;
};
K.yamlDe = m => {
  if (K.kinds[m.kind]) return K.kinds[m.kind].yaml(m);
  if (m.kind === 'Deployment') {
    const anot = Object.keys(m.tpl.anot || {}).length ? { annotations: copia(m.tpl.anot) } : {};
    return K.yaml({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: m.nombre, namespace: m.ns, labels: m.labels },
      spec: { replicas: m.replicas, selector: { matchLabels: { app: m.labels.app } }, strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' } },
        template: { metadata: Object.assign({ labels: m.tpl.labels }, anot), spec: Object.assign({ containers: [K.contenedor(m.tpl)] }, m.tpl.pvc ? { volumes: [{ name: 'datos', persistentVolumeClaim: { claimName: m.tpl.pvc.nombre } }] } : {}) } } });
  }
  if (m.kind === 'ConfigMap') return K.yaml({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: m.nombre, namespace: m.ns }, data: m.data });
  if (m.kind === 'Service') return K.yaml({ apiVersion: 'v1', kind: 'Service', metadata: { name: m.nombre, namespace: m.ns }, spec: { type: 'ClusterIP', selector: m.selector, ports: [Object.assign({ port: m.puerto, targetPort: m.targetPort }, m.proto ? { protocol: m.proto } : {})] } });
  return [];
};
// Leer un manifiesto del repositorio (sólo los nuestros: no hay editor en el simulador).
K.desdeRepo = (st, ruta) => {
  const rel = ruta.indexOf(K.REPO + '/') === 0 ? ruta.slice(K.REPO.length + 1) : null;
  return rel && st.k8s.repo[rel] ? copia(st.k8s.repo[rel]) : null;
};
K.rutasRepo = st => Object.keys(st.k8s.repo).map(r => K.REPO + '/' + r);
// apply: deja el objeto como dice el manifiesto.
K.aplicar = (st, m, t) => {
  const k = st.k8s, key = (m.ns ? m.ns + '/' : '') + m.nombre, tipo = K.kinds[m.kind] ? K.kinds[m.kind].prefijo : { Deployment: 'deployment.apps', ConfigMap: 'configmap', Service: 'service' }[m.kind];
  const vivo = K.manifiesto(st, m.kind, key);
  if (vivo && JSON.stringify(vivo) === JSON.stringify(m)) return tipo + '/' + m.nombre + ' unchanged';
  if (K.kinds[m.kind]) { const e = K.kinds[m.kind].aplicar(st, copia(m), t, vivo); if (e) return e; return tipo + '/' + m.nombre + (vivo ? ' configured' : ' created'); }
  if (m.kind === 'ConfigMap') { if (vivo) { k.cms[key].data = copia(m.data); k.cms[key].rv++; } else k.cms[key] = { ns: m.ns, nombre: m.nombre, data: copia(m.data), creado: t, rv: 1 }; }
  if (m.kind === 'Service') { const s = k.svcs[key]; s.selector = copia(m.selector); s.puerto = m.puerto; s.targetPort = m.targetPort; }
  if (m.kind === 'Deployment') { const d = k.deps[key]; d.replicas = m.replicas; d.labels = copia(m.labels); K.cambiarPlantilla(st, d, m.tpl, '<none>', t); }
  return tipo + '/' + m.nombre + (vivo ? ' configured' : ' created');
};

// ------------------------------------------------------------------ alertas (kube-prometheus)
// Las mismas reglas que trae kube-prometheus, con sus nombres y sus textos.
P.detectores.push((st, add) => {
  const k = st.k8s; if (!k) return;
  k.pods.forEach(p => {
    const e = K.estadoPod(st, p), dueno = p.dep ? p.dep.split('/')[1] : p.nombre;
    if (e === 'CrashLoopBackOff') add('KubePodCrashLooping', 'warning', null, T('Pod ' + p.ns + '/' + p.nombre + ' (' + p.tpl.contenedor + ') en CrashLoopBackOff', 'Pod ' + p.ns + '/' + p.nombre + ' (' + p.tpl.contenedor + ') is in waiting state (reason: "CrashLoopBackOff")'), 'KubePodCrashLooping|' + p.nombre);
    if (e === 'Pending' && st.reloj - p.creado >= 15) add('KubePodNotReady', 'warning', null, T('Pod ' + p.ns + '/' + p.nombre + ' lleva más de 15 min sin estar listo (Pending)', 'Pod ' + p.ns + '/' + p.nombre + ' has been in a non-ready state for longer than 15 minutes'), 'KubePodNotReady|' + p.nombre);
    if ((e === 'ImagePullBackOff' || e === 'ErrImagePull') && st.reloj - p.creado >= 15) add('KubeContainerWaiting', 'warning', null, T('Contenedor ' + p.tpl.contenedor + ' de ' + p.ns + '/' + p.nombre + ' esperando (' + e + ')', 'Pod container waiting: ' + p.ns + '/' + p.nombre + ' container ' + p.tpl.contenedor + ' (' + e + ')'), 'KubeContainerWaiting|' + p.nombre);
    void dueno;
  });
  Object.values(k.deps).forEach(d => {
    const r = K.resumenDep(st, d);
    if (d.atascado) add('KubeDeploymentRolloutStuck', 'warning', null, T('El rollout del deployment ' + d.ns + '/' + d.nombre + ' no avanza', 'Rollout of deployment ' + d.ns + '/' + d.nombre + ' is not progressing'), 'KubeDeploymentRolloutStuck|' + d.nombre);
    if (d.faltaDesde != null && st.reloj - d.faltaDesde >= 15 && r.listos < d.replicas) add('KubeDeploymentReplicasMismatch', 'warning', null, T('El deployment ' + d.ns + '/' + d.nombre + ' no tiene las réplicas que pide (' + r.listos + '/' + d.replicas + ')', 'Deployment ' + d.ns + '/' + d.nombre + ' has not matched the expected number of replicas (' + r.listos + '/' + d.replicas + ')'), 'KubeDeploymentReplicasMismatch|' + d.nombre);
  });
  Object.values(k.nodos).forEach(n => { if (!K.nodoListo(st, n) && st.hosts[n.nombre].up) add('KubeNodeNotReady', 'warning', n.nombre, T(n.nombre + ' lleva tiempo NotReady', n.nombre + ' has been unready for more than 15 minutes'), 'KubeNodeNotReady|' + n.nombre); });
  // La sonda externa: el pago de prueba entra por web-checkout y llega a api-pagos.
  const sonda = K.sonda(st);
  if (!sonda.ok) add('BlackboxProbeFailed', 'critical', null, T('La sonda de ' + K.URL_PAGO + ' falla: ' + sonda.porque, 'Probe ' + K.URL_PAGO + ' is failing: ' + sonda.porque), 'BlackboxProbeFailed');
});
K.URL_PAGO = 'https://checkout.pagos.example/api/v1/salud';
// El camino del pago de prueba, paso a paso: cada uno devuelve null si pasa o
// { codigo, porque } si se corta ahí. Otros ficheros añaden los suyos (TLS, ingress).
K.pasosSonda = [
  st => K.endpoints(st, st.k8s.svcs['pagos/web-checkout']).length ? null : { codigo: 503, porque: T('web-checkout no tiene endpoints', 'web-checkout has no endpoints') },
  st => K.endpoints(st, st.k8s.svcs['pagos/api-pagos']).length ? null : { codigo: 502, porque: T('api-pagos no tiene endpoints', 'api-pagos has no endpoints') },
];
K.sonda = (st, o) => {
  for (const f of K.pasosSonda) { const r = f(st, o || {}); if (r) return Object.assign({ ok: false }, r); }
  return { ok: true, codigo: 200 };
};

// ------------------------------------------------------------------ servicios de los nodos
Object.assign(U.DESC, { kubelet: 'kubelet: The Kubernetes Node Agent', containerd: 'containerd container runtime' });
U.binario = (orig => u => ({ kubelet: 'kubelet', containerd: 'containerd' })[u] || orig(u))(U.binario);
Object.assign(P.roles, {
  ops: T('Tu equipo: kubectl configurado contra el clúster de producción', 'Your workstation: kubectl configured for the production cluster'),
  cp: T('Control plane de Kubernetes (apiserver, scheduler, controller-manager, etcd)', 'Kubernetes control plane (apiserver, scheduler, controller-manager, etcd)'),
  worker: T('Nodo worker de Kubernetes (kubelet + containerd)', 'Kubernetes worker node (kubelet + containerd)'),
});

// ------------------------------------------------------------------ ficheros de tu equipo
const fijoF = arr => ({ lineas: () => arr, mb: arr.join('\n').length / 1048576 });
const LEEME = T([
  '# Plataforma de pagos — normas del equipo de plataforma', '',
  '1. Producción es el clúster pagos-prod (kubectl ya apunta a él: kubectl config current-context).',
  '2. Lo que hay en el clúster lo dice ~/k8s (el repositorio de manifiestos). Un cambio hecho a mano con kubectl',
  '   (edit, patch, set...) es deriva: si arreglas algo así, que el repositorio diga lo mismo.',
  '3. Antes de aplicar, kubectl diff -f. Después, kubectl rollout status.',
  '4. Un pod que se reinicia te cuenta por qué: kubectl describe pod (Last State) y kubectl logs --previous.',
  '5. Nada de borrar límites de memoria ni bajar requests para que «quepa»: los límites protegen al resto del nodo.', '',
  '## Para empezar',
  '- kubectl get nodes',
  '- kubectl get pods -n pagos -o wide',
  '- kubectl get events -n pagos --sort-by=.lastTimestamp',
  '- amtool alert',
], [
  '# Payments platform — platform team rules', '',
  '1. Production is the pagos-prod cluster (kubectl already points at it: kubectl config current-context).',
  '2. What runs in the cluster is defined by ~/k8s (the manifests repository). A change made by hand with kubectl',
  '   (edit, patch, set...) is drift: if you fix something that way, make the repository say the same.',
  '3. Before applying, kubectl diff -f. Afterwards, kubectl rollout status.',
  '4. A restarting pod tells you why: kubectl describe pod (Last State) and kubectl logs --previous.',
  '5. Never remove memory limits or lower requests to make something "fit": limits protect the rest of the node.', '',
  '## Getting started',
  '- kubectl get nodes',
  '- kubectl get pods -n pagos -o wide',
  '- kubectl get events -n pagos --sort-by=.lastTimestamp',
  '- amtool alert',
]);
const KUBECONFIG = ['apiVersion: v1', 'kind: Config', 'clusters:', '- cluster:', '    certificate-authority-data: LS0tLS1CRUdJTi' + U.hex('ca', 24), '    server: https://10.30.0.10:6443', '  name: pagos-prod', 'contexts:', '- context:', '    cluster: pagos-prod', '    user: sre-admin', '  name: pagos-prod', 'current-context: pagos-prod', 'users:', '- name: sre-admin', '  user:', '    client-certificate-data: LS0tLS1CRUdJTi' + U.hex('cert', 24), '    client-key-data: LS0tLS1CRUdJTi' + U.hex('key', 24)];
K.notasRepo = st => st.k8s.notas || {};
P.ficheros.push((st, h) => {
  if (!st.k8s || h.rol !== 'ops') return {};
  const f = {};
  f[HOME + '/LEEME.md'] = fijoF(LEEME);
  f[HOME + '/.kube/config'] = fijoF(KUBECONFIG);
  f[K.REPO + '/README.md'] = fijoF(T(['# k8s — manifiestos de producción (pagos-prod)', '', 'Cada carpeta es una aplicación del namespace pagos.', 'Se aplica con: kubectl apply -f <carpeta>/', 'CI cambia aquí la imagen de cada versión; lo que no esté aquí no debería estar en el clúster.'],
    ['# k8s — production manifests (pagos-prod)', '', 'Each folder is an application in the pagos namespace.', 'Apply with: kubectl apply -f <folder>/', 'CI updates each release\'s image here; anything not in here should not be in the cluster.']));
  Object.keys(st.k8s.repo).forEach(r => { const m = st.k8s.repo[r]; f[K.REPO + '/' + r] = { lineas: () => K.yamlDe(m), mb: 0.002 }; });
  const notas = K.notasRepo(st);
  Object.keys(notas).forEach(r => { f[K.REPO + '/' + r] = fijoF(notas[r]); });
  return f;
});

// ------------------------------------------------------------------ amtool
U.cmd('amtool', { ayuda: T('alertas activas en Alertmanager (amtool alert)', 'active alerts in Alertmanager (amtool alert)'), grupo: T('Monitorización', 'Monitoring'), donde: ['ops'], fn: ctx => {
  const st = ctx.st, a = ctx.args;
  if (a[0] !== 'alert') return [L('usage: amtool [<flags>] <command> [<args> ...]', 'err'), L(T('(en el simulador: amtool alert)', '(in the simulator: amtool alert)'), 'dim')];
  const filtro = a.slice(a[1] === 'query' ? 2 : 1).find(x => x[0] !== '-');
  const al = P.alertasActivas(st).filter(x => !filtro || x.nombre.indexOf(filtro.replace(/^alertname=/, '')) >= 0);
  if (!al.length) return [L('Alertname  Starts At  Summary  State')];
  return [L('Alertname'.padEnd(34) + 'Starts At'.padEnd(26) + 'Summary'.padEnd(72) + 'State')].concat(al.map(x => L(x.nombre.padEnd(34) + (U.iso(x.desde).replace('T', ' ') + ' UTC').padEnd(26) + ((x.host ? x.host + ': ' : '') + x.res).padEnd(72) + 'active', x.sev === 'critical' ? 'rojo' : 'ambar')));
}, completar: (st, ses, pal) => !pal.length ? ['alert'] : ['query'] });

// ------------------------------------------------------------------ curl (tu equipo)
// La sonda vista por un cliente, y el registro de imágenes (qué etiquetas hay de verdad).
U.cmd('curl', { ayuda: T('peticiones HTTP: curl -s ' + K.URL_PAGO + ', curl -s https://' + K.REGISTRO + '/v2/api-pagos/tags/list', 'HTTP requests: curl -s ' + K.URL_PAGO + ', curl -s https://' + K.REGISTRO + '/v2/api-pagos/tags/list'), grupo: T('Red', 'Network'), donde: ['ops'], fn: ctx => {
  const st = ctx.st, a = ctx.args, url = a.filter(x => !/^-/.test(x)).pop(), cab = a.some(x => x === '-I' || x === '-i' || x === '--head');
  if (!url) return [L("curl: try 'curl --help' or 'curl --manual' for more information", 'err')];
  const m = /^https?:\/\/([^/]+)(\/.*)?$/.exec(url);
  if (!m) return [L('curl: (3) URL using bad/illegal format or missing URL', 'err')];
  const host = m[1], ruta = m[2] || '/';
  if (host === K.REGISTRO) {
    const t = /^\/v2\/([a-z0-9-]+)\/tags\/list$/.exec(ruta);
    if (!t || !K.ETIQUETAS[t[1]]) return [L('{"errors":[{"code":"NAME_UNKNOWN","message":"repository name not known to registry"}]}')];
    return [L(JSON.stringify({ name: t[1], tags: K.ETIQUETAS[t[1]] }))];
  }
  if (host === 'checkout.pagos.example') {
    const inseguro = a.some(x => x === '-k' || x === '--insecure' || /^-[a-z]*k[a-z]*$/.test(x)), v = a.some(x => x === '-v' || x === '--verbose' || /^-[a-z]*v[a-z]*$/.test(x));
    const s = K.sonda(st, { sinTls: inseguro }), pre = v && K.curlVerbose ? K.curlVerbose(st) : [];
    if (s.tls) return { lineas: pre.concat(s.tls.map(x => L(x, 'err'))), fallo: true };
    if (s.codigo === 0) return { lineas: pre.concat([L(s.curl || 'curl: (7) Failed to connect to checkout.pagos.example port 443 after 4 ms: Couldn\'t connect to server', 'err')]), fallo: true };
    const h = s.ok ? ['HTTP/2 200', 'content-type: application/json'] : ['HTTP/2 ' + s.codigo, 'content-type: text/html'];
    if (cab) return pre.map(x => x).concat(h.map(x => L(x)));
    return pre.concat([L(s.ok ? '{"estado":"ok","version":"' + K.partesImagen(st.k8s.deps['pagos/api-pagos'].tpl.imagen).tag + '"}' : '<html><body><h1>' + s.codigo + ' ' + ({ 503: 'Service Temporarily Unavailable', 504: 'Gateway Time-out', 404: 'Not Found' }[s.codigo] || 'Bad Gateway') + '</h1></body></html>')]);
  }
  return { lineas: [L('curl: (6) Could not resolve host: ' + host, 'err')], minutos: 1 };
} });

// ------------------------------------------------------------------ crictl (en los nodos)
U.cmd('crictl', { ayuda: T('contenedores del nodo (sudo crictl ps)', 'containers on this node (sudo crictl ps)'), grupo: T('Servicios', 'Services'), donde: ['cp', 'worker'], fn: ctx => {
  if (!ctx.sudo) return [L('time="' + U.iso(ctx.st.reloj) + 'Z" level=fatal msg="validate service connection: validate CRI v1 runtime API for endpoint \\"unix:///run/containerd/containerd.sock\\": rpc error: code = Unavailable desc = connection error: desc = \\"transport: Error while dialing: dial unix /run/containerd/containerd.sock: connect: permission denied\\""', 'err'), L(U.SUDO, 'dim')];
  if (ctx.args[0] !== 'ps') return [L(T('(en el simulador: sudo crictl ps [-a])', '(in the simulator: sudo crictl ps [-a])'), 'dim')];
  const st = ctx.st, todos = ctx.args.indexOf('-a') >= 0;
  const ps = st.k8s.pods.filter(p => p.nodo === ctx.h.nombre && (todos || p.c.estado === 'corriendo'));
  return K.tabla(['CONTAINER', 'IMAGE', 'CREATED', 'STATE', 'NAME', 'ATTEMPT', 'POD ID', 'POD'], ps.map(p => [U.hex('c' + p.nombre + p.c.reinicios, 13), U.hex('img' + p.tpl.imagen, 13), K.edad(st.reloj - (p.c.arranque == null ? p.creado : p.c.arranque)) + ' ago', p.c.estado === 'corriendo' ? 'Running' : 'Exited', p.tpl.contenedor, p.c.reinicios, U.hex('pod' + p.nombre, 13), p.nombre]));
} });
})(window.PUESTO = window.PUESTO || {});
