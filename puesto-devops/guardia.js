// Puesto DevOps · guardias y caos (fase 3).
//
// Familias de averías del clúster. Cada una sabe romperlo (con parámetros al
// azar: qué aplicación, qué nodo...), decir qué queda roto y arreglarse con
// comandos de verdad. Con eso:
//   - una guardia combina familias que no se pisan, a partir de una semilla
//     (la misma semilla, la misma noche), sin ticket: sólo las alertas;
//   - el caos programa una avería unos minutos más tarde, en el laboratorio libre.
// Como en los tickets, se rompe en el pasado y K.simular corre el clúster hasta
// ahora: los desalojos, los reinicios y las alertas salen del modelo.
(function (P) {
'use strict';
const U = P.u, T = P.T, K = P.k8s;
P.azar = P.azar || (semilla => { let a = semilla >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
const uno = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];
P.nivelesGuardia = { 1: T('Tranquila', 'Quiet'), 2: T('Movida', 'Busy'), 3: T('Infierno', 'Hellish') };
const WORKERS = ['worker-01', 'worker-02', 'worker-03'];
const dep = (st, n) => st.k8s.deps['pagos/' + n];
const deriva = (st, ruta) => K.deriva(st, [ruta]).length > 0;
const crash = (st, n) => K.podsDe(st, dep(st, n)).find(p => p.c.razon === 'CrashLoopBackOff');

// ------------------------------------------------------------------ familias
// aplicar(st, p, min): rompe en el minuto min · pendientes(st, p): lo que falta · arreglo(st, p): comandos
P.familias = [
  { id: 'imagen-mala', nivel: 1, orden: 2, titulo: T('Un despliegue con una imagen que no existe', 'A rollout with an image that does not exist'), leccion: T('el rolling update protegió a los pods viejos: kubectl rollout undo vuelve a la revisión buena', 'the rolling update protected the old pods: kubectl rollout undo goes back to the good revision'),
    params: rnd => ({ app: uno(rnd, ['api-pagos', 'web-checkout', 'antifraude']), tag: uno(rnd, ['9.9.9', 'latest-rc', '2026.09']) }), toca: p => ['dep:' + p.app],
    aplicar: (st, p, min) => { const d = dep(st, p.app), tpl = K.copia(d.tpl); tpl.imagen = K.REGISTRO + '/' + p.app + ':' + p.tag; K.cambiarPlantilla(st, d, tpl, '<none>', min); },
    pendientes: (st, p) => { const d = dep(st, p.app); return !K.imagenExiste(d.tpl.imagen) || !K.completo(st, d) ? [T(p.app + ': el despliegue no ha terminado con una imagen que exista', p.app + ': the rollout has not finished with an image that exists')] : []; },
    arreglo: (st, p) => ['kubectl rollout undo deployment/' + p.app + ' -n pagos', 'kubectl rollout status deployment/' + p.app + ' -n pagos'] },
  { id: 'kubelet-parado', nivel: 1, orden: 1, titulo: T('El kubelet parado en un worker', 'The kubelet stopped on a worker'), leccion: T('un nodo NotReady se arregla dentro del nodo: systemctl start kubelet; a los 5 minutos Kubernetes ya había movido sus pods', 'a NotReady node is fixed inside the node: systemctl start kubelet; after 5 minutes Kubernetes had already moved its pods'),
    params: rnd => ({ nodo: uno(rnd, WORKERS) }), toca: p => ['nodo:' + p.nodo],
    aplicar: (st, p, min) => P.parado(st, p.nodo, 'kubelet', min, false),
    pendientes: (st, p) => K.nodoListo(st, st.k8s.nodos[p.nodo]) ? [] : [T(p.nodo + ' sigue NotReady', p.nodo + ' is still NotReady')],
    arreglo: (st, p) => ['ssh ' + p.nodo, 'sudo systemctl start kubelet', 'exit', 'kubectl get nodes'] },
  { id: 'cordon-olvidado', nivel: 1, orden: 1, titulo: T('Un nodo que se quedó en cordon tras un mantenimiento', 'A node left cordoned after maintenance'), leccion: T('el cordon se queda hasta que alguien hace uncordon, y no avisa hasta que falta sitio', 'a cordon stays until someone runs uncordon, and gives no warning until room runs out'),
    params: rnd => ({ nodo: uno(rnd, WORKERS) }), toca: p => ['nodo:' + p.nodo, 'dep:liquidaciones'],
    aplicar: (st, p, min) => { K.drenar(st, p.nodo, min - 600); dep(st, 'liquidaciones').replicas = 4; },
    pendientes: (st, p) => st.k8s.nodos[p.nodo].cordon || !K.completo(st, dep(st, 'liquidaciones')) ? [T(p.nodo + ' sigue en cordon o liquidaciones no tiene sus 4 réplicas', p.nodo + ' is still cordoned or liquidaciones does not have its 4 replicas')] : [],
    arreglo: (st, p) => ['kubectl uncordon ' + p.nodo, 'kubectl rollout status deployment/liquidaciones -n pagos'] },
  { id: 'selector-roto', nivel: 2, orden: 2, titulo: T('Un Service cuyo selector no casa con ningún pod', 'A Service whose selector matches no pod'), leccion: T('pods sanos y cero endpoints: el selector pide una etiqueta que nadie tiene; el Service bueno está en el repositorio', 'healthy pods and zero endpoints: the selector asks for a label nobody has; the right Service is in the repository'),
    params: rnd => ({ svc: uno(rnd, ['api-pagos', 'web-checkout', 'antifraude']) }), toca: p => ['svc:' + p.svc],
    aplicar: (st, p) => { st.k8s.svcs['pagos/' + p.svc].selector = { app: p.svc, tier: 'backend' }; },
    pendientes: (st, p) => deriva(st, p.svc + '/service.yaml') ? [T('El Service ' + p.svc + ' no coincide con el repositorio', 'The ' + p.svc + ' Service does not match the repository')] : [],
    arreglo: (st, p) => ['kubectl apply -f ~/k8s/' + p.svc + '/service.yaml'] },
  { id: 'oom-antifraude', nivel: 2, orden: 2, titulo: T('antifraude con el límite de memoria por debajo de lo que usa', 'antifraude with its memory limit below what it uses'), leccion: T('OOMKilled no deja error en el log: lo dice describe pod; el límite bueno está en el repositorio', 'OOMKilled leaves no error in the log: describe pod says it; the right limit is in the repository'),
    params: () => ({}), toca: () => ['dep:antifraude'],
    aplicar: (st, p, min) => { const d = dep(st, 'antifraude'), tpl = K.copia(d.tpl); tpl.lim.mem = 512; tpl.req.mem = 384; K.cambiarPlantilla(st, d, tpl, 'finops: rightsizing', min); },
    pendientes: st => { const d = dep(st, 'antifraude'); return !K.completo(st, d) || d.tpl.lim.mem < 768 ? [T('antifraude sigue sin la memoria que necesita', 'antifraude still does not have the memory it needs')] : []; },
    arreglo: () => ['kubectl apply -f ~/k8s/antifraude/deployment.yaml', 'kubectl rollout status deployment/antifraude -n pagos'] },
  { id: 'configmap-clave', nivel: 2, orden: 2, titulo: T('Una clave renombrada en el ConfigMap de api-pagos', 'A renamed key in api-pagos\' ConfigMap'), leccion: T('el entorno se lee al arrancar: el ConfigMap roto sólo se nota en el siguiente pod que arranca', 'the environment is read at startup: the broken ConfigMap only shows in the next pod that starts'),
    params: () => ({}), toca: () => ['cm:api-pagos', 'dep:api-pagos'],
    aplicar: (st, p, min) => { const cm = st.k8s.cms['pagos/api-pagos-config']; cm.data.PAYMENT_GATEWAY_URL = cm.data.PASARELA_URL; delete cm.data.PASARELA_URL; K.borrarPod(st, K.podsDe(st, dep(st, 'api-pagos'))[0], min); },
    pendientes: st => crash(st, 'api-pagos') || deriva(st, 'api-pagos/configmap.yaml') ? [T('api-pagos sigue con el ConfigMap roto o un pod en CrashLoopBackOff', 'api-pagos still has the broken ConfigMap or a pod in CrashLoopBackOff')] : [],
    arreglo: st => { const p = crash(st, 'api-pagos'); return ['kubectl apply -f ~/k8s/api-pagos/configmap.yaml'].concat(p ? ['kubectl delete pod ' + p.nombre + ' -n pagos'] : [], ['kubectl rollout status deployment/api-pagos -n pagos']); } },
  { id: 'netpol-puerto', nivel: 3, orden: 2, titulo: T('Una NetworkPolicy que abre el puerto equivocado', 'A NetworkPolicy that opens the wrong port'), leccion: T('una NetworkPolicy descarta: timeout, no refused; las buenas están en el repositorio', 'a NetworkPolicy drops: timeout, not refused; the right ones are in the repository'),
    params: rnd => ({ pol: uno(rnd, ['permitir-api-a-antifraude', 'permitir-ingress-a-web']) }), toca: () => ['netpol'],
    aplicar: (st, p) => { st.k8s.netpols['pagos/' + p.pol].ingress[0].puertos = [p.pol === 'permitir-ingress-a-web' ? 8080 : 8443]; },
    pendientes: (st, p) => deriva(st, 'netpol/' + p.pol + '.yaml') ? [T('La NetworkPolicy ' + p.pol + ' no coincide con el repositorio', 'The ' + p.pol + ' NetworkPolicy does not match the repository')] : [],
    arreglo: () => ['kubectl apply -f ~/k8s/netpol/'] },
  { id: 'hpa-techo', nivel: 3, orden: 2, titulo: T('La HPA de api-pagos con el máximo en 3 y mucha carga', 'api-pagos\' HPA capped at 3 under heavy load'), leccion: T('una HPA no pasa de su máximo, y kubectl scale no sirve: se corrige la HPA', 'an HPA does not go past its maximum, and kubectl scale does not help: you fix the HPA'),
    params: () => ({}), toca: () => ['hpa', 'dep:api-pagos'],
    aplicar: st => { st.k8s.hpas['pagos/api-pagos'].max = 3; st.k8s.carga['api-pagos'] = 650; },
    pendientes: st => deriva(st, 'api-pagos/hpa.yaml') ? [T('La HPA de api-pagos sigue con su máximo bajado', 'api-pagos\' HPA still has its maximum lowered')] : [],
    arreglo: () => ['kubectl apply -f ~/k8s/api-pagos/hpa.yaml', 'kubectl rollout status deployment/api-pagos -n pagos'] },
  { id: 'cert-emisor', nivel: 3, orden: 2, titulo: T('El certificado del checkout caducado y sin renovar', 'The checkout certificate expired and not renewed'), leccion: T('cert-manager no encontraba el emisor: el Certificate del repositorio apunta al que existe', 'cert-manager could not find the issuer: the repository\'s Certificate points at the one that exists'),
    params: () => ({}), toca: () => ['cert'],
    aplicar: (st, p, min) => { const c = st.k8s.certs['pagos/checkout-tls'], s = st.k8s.secrets['pagos/checkout-tls']; c.issuer = 'letsencrypt-production'; s.hasta = min; s.desde = min - 90 * 1440; },
    pendientes: st => { const s = st.k8s.secrets['pagos/checkout-tls']; return !K.secretoValido(st, s) || deriva(st, 'web-checkout/certificate.yaml') ? [T('checkout-tls sigue sin un certificado válido', 'checkout-tls still has no valid certificate')] : []; },
    arreglo: () => ['kubectl apply -f ~/k8s/web-checkout/certificate.yaml', 'kubectl get certificate -n pagos'] },
  { id: 'swap-kubelet', nivel: 3, orden: 1, titulo: T('Un worker que vuelve de un reinicio con swap y sin kubelet', 'A worker back from a reboot with swap on and no kubelet'), leccion: T('el kubelet no arranca con swap: swapoff para ahora y /etc/fstab para siempre', 'the kubelet does not start with swap on: swapoff for now and /etc/fstab for good'),
    params: rnd => ({ nodo: uno(rnd, WORKERS) }), toca: p => ['nodo:' + p.nodo],
    aplicar: (st, p, min) => { const h = st.hosts[p.nodo]; Object.assign(h.extra, { swap: true, fstabSwap: true }); h.arrancado = min - 1; P.fallar(st, h, 'kubelet', 'kubelet-swap', min); },
    pendientes: (st, p) => { const h = st.hosts[p.nodo]; return !K.nodoListo(st, st.k8s.nodos[p.nodo]) || h.extra.swap || h.extra.fstabSwap ? [T(p.nodo + ' sigue NotReady o con el swap activo al arrancar', p.nodo + ' is still NotReady or turns swap on at boot')] : []; },
    arreglo: (st, p) => ['ssh ' + p.nodo, 'sudo swapoff -a', "sudo sed -i '/swap/ s/^/#/' /etc/fstab", 'sudo systemctl restart kubelet', 'exit', 'kubectl get nodes'] },
];

// La misma familia dicha con el catálogo (averias.js): es lo que añade el compositor
// con «+ Añadir familia» y lo que lleva una guardia cuando se abre como fichero.
const COMO = {
  'imagen-mala': p => [{ tipo: 'imagen-inexistente', app: p.app, tag: p.tag }],
  'kubelet-parado': p => [{ tipo: 'kubelet-parado', nodo: p.nodo }],
  'cordon-olvidado': p => [{ tipo: 'cordon-olvidado', nodo: p.nodo, antes: 600 }, { tipo: 'escalado', app: 'liquidaciones', replicas: 4 }],
  'selector-roto': p => [{ tipo: 'selector-roto', svc: p.svc, etiqueta: 'tier=backend' }],
  'oom-antifraude': () => [{ tipo: 'limite-memoria', app: 'antifraude', limite: 512 }],
  'configmap-clave': () => [{ tipo: 'configmap-clave', clave: 'PASARELA_URL', nueva: 'PAYMENT_GATEWAY_URL', reiniciar: true }],
  'netpol-puerto': p => [{ tipo: 'netpol-puerto', pol: p.pol, puerto: p.pol === 'permitir-ingress-a-web' ? 8080 : 8443 }],
  'hpa-techo': () => [{ tipo: 'hpa-techo', max: 3, carga: 650 }],
  'cert-emisor': () => [{ tipo: 'cert-emisor', viejo: 'letsencrypt-production' }],
  'swap-kubelet': p => [{ tipo: 'swap-kubelet', nodo: p.nodo }],
};
const conHace = (xs, hace) => xs.map(a => { const r = Object.assign({}, a, { hace: hace + (a.antes || 0) }); delete r.antes; return r; });
P.familias.forEach(f => { f.averias = p => conHace(COMO[f.id](p), 30); f.crear = rnd => f.averias(f.params(rnd)); });

// ------------------------------------------------------------------ guardia
const choca = (a, b) => a.some(x => b.indexOf(x) >= 0);
const { usado, antes, despues } = P.ayudasEscenario;
const MUTA = /kubectl (apply|patch|set|delete|create|rollout (undo|restart)|scale|uncordon|cordon|drain)|helm (upgrade|rollback)|systemctl (start|restart)|swapoff|sed -i|git (revert|push)|argocd app (sync|set)/;
function guardiaDe(nivel, semilla, intento) {
  const rnd = P.azar(semilla * 31 + intento), elegidas = [];
  const exactas = P.familias.filter(f => f.nivel === nivel), pool = P.familias.filter(f => f.nivel <= nivel);
  const primera = uno(rnd, exactas), p0 = primera.params(rnd);
  elegidas.push({ f: primera, p: p0, toca: primera.toca(p0) });
  for (let k = 0; elegidas.length < nivel && k < 30; k++) {
    const f = uno(rnd, pool), p = f.params(rnd), t = f.toca(p);
    // Dos nodos fuera a la vez no caben en tres workers: una noche así no se arregla, se reconstruye.
    const nodos = [].concat(...elegidas.map(x => x.toca), t).filter(x => /^nodo:/.test(x)).length;
    if (elegidas.some(x => x.f.id === f.id || choca(x.toca, t)) || nodos > 1) continue;
    elegidas.push({ f, p, toca: t });
  }
  elegidas.sort((a, b) => a.f.orden - b.f.orden);
  const id = 'GRD-' + (semilla % 1000000).toString(36).toUpperCase().padStart(4, '0');
  const hace = 20 + Math.floor(rnd() * 60);
  const e = {
    id, clave: id, tipo: 'incidente', nivel, area: T('Guardia', 'On call'), funciones: ['incid'], impacto: nivel === 1 ? 'medio' : 'alto', urgencia: 'alta',
    de: T('Busca de guardia', 'On-call pager'), asunto: T('Guardia ' + P.nivelesGuardia[nivel].toLowerCase() + ' · semilla ' + semilla, P.nivelesGuardia[nivel] + ' on-call shift · seed ' + semilla),
    cuerpo: [T('Te ha saltado la guardia. No hay ticket: sólo lo que dicen las alertas.', 'You have been paged. There is no ticket: only what the alerts say.')],
    inicio: -hace, abierto: -Math.min(10, hace),
    aplicar: st => { elegidas.forEach(x => x.f.aplicar(st, x.p, -hace)); K.simular(st, -hace, 0); },
    objetivo: st => [].concat(...elegidas.map(x => x.f.pendientes(st, x.p))),
    practicas: [
      { t: T('Miraste las alertas antes de tocar nada', 'You looked at the alerts before touching anything'), ok: st => { const i = st.registro.findIndex(r => /amtool/.test(r.cmd)), j = st.registro.findIndex(r => MUTA.test(r.cmd)); return i >= 0 && (j < 0 || i < j); } },
      { t: T('Comprobaste las alertas al terminar', 'You checked the alerts when you finished'), ok: st => { let j = -1; st.registro.forEach((r, k) => { if (MUTA.test(r.cmd)) j = k; }); return st.registro.some((r, k) => k > j && /amtool/.test(r.cmd)); } },
      { t: T('No reiniciaste nodos para «ver si se arreglaba»', 'You did not reboot nodes to "see if it fixed itself"'), ok: st => !st.hechos.reinicios.length && !usado(st, /kubectl drain/) },
    ],
    pistas: [
      T('Empieza por las alertas: amtool alert. Luego kubectl get nodes y kubectl get pods -A: lo que no esté Running y listo es por donde se tira.', 'Start with the alerts: amtool alert. Then kubectl get nodes and kubectl get pods -A: whatever is not Running and ready is the thread to pull.'),
      T('Esta noche hay ' + elegidas.length + ' cosa' + (elegidas.length > 1 ? 's' : '') + ' rota' + (elegidas.length > 1 ? 's' : '') + ': ' + elegidas.map(x => x.f.titulo.toLowerCase()).join('; ') + '.', 'Tonight ' + elegidas.length + ' thing' + (elegidas.length > 1 ? 's are' : ' is') + ' broken: ' + elegidas.map(x => x.f.titulo.toLowerCase()).join('; ') + '.'),
      T('Por dónde va el arreglo: ' + elegidas.map(x => x.f.leccion).join('; ') + '.', 'Where the fix lies: ' + elegidas.map(x => x.f.leccion).join('; ') + '.'),
    ],
    causa: T('Pasaban ' + (elegidas.length === 1 ? 'una cosa' : elegidas.length + ' cosas a la vez') + ': ', elegidas.length === 1 ? 'One thing was going on: ' : elegidas.length + ' things were going on at once: ') + elegidas.map(x => x.f.titulo.toLowerCase()).join('; ') + '.',
    solucion: elegidas.map(x => x.f.leccion.charAt(0).toUpperCase() + x.f.leccion.slice(1) + '.').join(' '),
    leccion: elegidas.map(x => x.f.leccion.charAt(0).toUpperCase() + x.f.leccion.slice(1) + '.').join(' '),
    guion: st => ['amtool alert'].concat(...elegidas.map(x => x.f.arreglo(st, x.p)), ['amtool alert']),
    trampas: [],
    guardia: { nivel, semilla, familias: elegidas.map(x => x.f.id) },
    // La misma noche como incidencia en fichero (el compositor parte de aquí).
    def: { formato: P.FORMATO_INCIDENCIA || 'puesto-incidencia/1', tipo: 'incidente', nivel, impacto: nivel === 1 ? 'medio' : 'alto', urgencia: 'alta', hace, abiertoHace: Math.min(10, hace),
      asunto: T('Guardia ' + P.nivelesGuardia[nivel].toLowerCase() + ' · semilla ' + semilla, P.nivelesGuardia[nivel] + ' on-call shift · seed ' + semilla), de: T('Busca de guardia', 'On-call pager'),
      cuerpo: [T('Te ha saltado la guardia. No hay ticket: sólo lo que dicen las alertas.', 'You have been paged. There is no ticket: only what the alerts say.')],
      averias: [].concat(...elegidas.map(x => conHace(COMO[x.f.id](x.p), hace))) },
  };
  return P.normalizarEscenario(e);
}
// Una guardia sólo sale si su propio arreglo la cierra; si no, se prueba otra combinación.
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
P.provocarCaos = (st, semilla, previas) => {
  const rnd = P.azar(semilla), tocadas = [].concat(...(previas || []).map(a => a.toca || []));
  const pool = P.familias.filter(f => f.nivel <= 2 && f.id !== 'cordon-olvidado');
  for (let k = 0; k < 20; k++) {
    const f = uno(rnd, pool), p = f.params(rnd), t = f.toca(p);
    if (choca(t, tocadas) || (t.some(x => /^nodo:/.test(x)) && tocadas.some(x => /^nodo:/.test(x))) || f.pendientes(st, p).length) continue;
    const cuando = st.reloj + 2 + Math.floor(rnd() * 4);
    (st.programados = st.programados || []).push({ min: cuando, fn: s => f.aplicar(s, p, cuando) });
    return { familia: f, averias: [Object.assign({ tipo: f.id, toca: t }, p.nodo ? { nodo: p.nodo } : {})], cuando, params: p };
  }
  return null;
};
P.pendientesCaos = (st, provocadas) => [].concat(...provocadas.filter(c => c.cuando <= st.reloj).map(c => c.familia.pendientes(st, c.params)));
void U;
})(window.PUESTO = window.PUESTO || {});
