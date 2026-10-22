// Puesto DevOps · lo que cambia en la interfaz del Puesto (../puesto-linux/app.js).
//
// La interfaz es la misma: cola, terminal, ticket, ITSM, pistas, cierre e
// informe. Aquí sólo se declara lo propio de Kubernetes: la oferta, la
// bienvenida, los paneles de la izquierda (nodos, cargas, Services) y los
// experimentos. Se carga antes que app.js.
(function (P) {
'use strict';
const T = P.T, K = P.k8s;

function panelNodos({ st, h }) {
  const filas = Object.values(st.k8s.nodos).map(n => {
    const listo = K.nodoListo(st, n), l = K.libre(st, n), pc = Math.round((n.cpu - l.cpu) / n.cpu * 100);
    const e = !listo ? 'caido' : n.cordon ? 'aviso' : 'ok';
    const nota = (listo ? 'Ready' : 'NotReady') + (n.cordon ? ' · cordon' : ' · ' + pc + ' %');
    return `<button class="host ancho e-${e}" data-act="ssh" data-host="${h(n.nombre)}" title="${T('Abrir una sesión en ', 'Open a session on ') + h(n.nombre) + ' · ' + T('CPU pedida ', 'CPU requested ') + pc + ' %'}"><i class="punto"></i><b>${h(n.nombre)}</b><span>${h(nota)}</span></button>`;
  }).join('');
  const barras = Object.values(st.k8s.nodos).filter(n => n.rol === 'worker').map(n => {
    const l = K.libre(st, n), pc = Math.round((n.cpu - l.cpu) / n.cpu * 100);
    return `<div class="osd ${pc >= 90 ? 'caido' : pc >= 75 ? 'lleno' : ''}" title="${T('requests de CPU sobre lo asignable', 'CPU requests over allocatable')}"><b>${h(n.nombre.replace('worker-', 'w'))}</b><span class="osd-bar"><i style="width:${Math.min(100, pc)}%"></i></span><em>${pc} %</em></div>`;
  }).join('');
  const listos = Object.values(st.k8s.nodos).filter(n => K.nodoListo(st, n)).length;
  return `<section class="panel"><h3>${T('Nodos', 'Nodes')} <span class="der-n">${listos}/${Object.keys(st.k8s.nodos).length} Ready</span></h3>${filas}<p class="grupo-t" style="margin-top:8px">${T('Capacidad (requests de CPU)', 'Capacity (CPU requests)')}</p>${barras}</section>`;
}
function panelCargas({ st, h }) {
  const filas = Object.values(st.k8s.deps).filter(d => d.ns === 'pagos').map(d => {
    const r = K.resumenDep(st, d), ps = K.podsDe(st, d);
    const crash = ps.some(p => p.c.razon === 'CrashLoopBackOff'), espera = ps.find(p => K.estadoPod(st, p) !== 'Running');
    const e = r.listos === 0 ? 'fallo' : r.listos < d.replicas || crash ? 'aviso' : !r.completo ? 'reserva' : 'ok';
    const est = espera ? K.estadoPod(st, espera).replace('CrashLoopBackOff', 'CrashLoop').replace('ImagePullBackOff', 'ImagePull').replace('ContainerCreating', 'Creating') : !r.completo ? 'rollout' : K.partesImagen(d.tpl.imagen).tag;
    const nota = r.listos + '/' + d.replicas + ' · ' + est;
    return `<div class="host ancho e-${e}" title="${h(d.tpl.imagen)}"><i class="punto"></i><b>${h(d.nombre)}</b><span>${h(nota)}</span></div>`;
  }).join('');
  return `<section class="panel"><h3>${T('Cargas', 'Workloads')} <span class="der-n">ns pagos</span></h3>${filas}</section>`;
}
function panelServicios({ st, h }) {
  const filas = Object.values(st.k8s.svcs).filter(s => s.ns === 'pagos').map(s => {
    const n = K.endpoints(st, s).length;
    return `<div class="host ancho e-${n ? 'ok' : 'fallo'}" title="selector ${h(K.sel(s.selector))}"><i class="punto"></i><b>${h(s.nombre)}</b><span>${n} endpoint${n === 1 ? '' : 's'}</span></div>`;
  }).join('');
  const sonda = K.sonda(st);
  return `<section class="panel"><h3>Services <span class="der-n">${T('checkout', 'checkout')} ${sonda.ok ? '200' : sonda.codigo}</span></h3>${filas}</section>`;
}

P.ui = {
  clave: 'puesto-devops-v1',
  claveImp: 'puesto-devops-importadas',
  oferta: {
    tag: T('📌 Puesto', '📌 Job opening'),
    titulo: T('Ingeniero/a DevOps (Kubernetes)', 'DevOps Engineer (Kubernetes)'),
    sub: T('Plataforma de pagos · remoto · contrato indefinido', 'Payments platform · remote · permanent, full-time'),
    txt: T('Operar y mantener clústeres de Kubernetes en producción, desplegar y versionar aplicaciones sin cortes, mantener los pipelines de CI/CD, observabilidad con Prometheus y Alertmanager con guardias, y seguridad de la plataforma (RBAC, Secrets, NetworkPolicies). Cada función del puesto tiene sus tickets:', 'Operate and maintain production Kubernetes clusters, deploy and version applications without downtime, maintain the CI/CD pipelines, observability with Prometheus and Alertmanager with on-call duty, and platform security (RBAC, Secrets, NetworkPolicies). Each duty of the role has its own tickets:'),
  },
  como: [
    T('<b>Un clúster de Kubernetes simulado</b>: un control plane y tres workers, la plataforma de pagos (api-pagos, web-checkout, antifraude, liquidaciones), su monitorización y el repositorio de manifiestos en ~/k8s.', '<b>A simulated Kubernetes cluster</b>: one control plane and three workers, the payments platform (api-pagos, web-checkout, antifraude, liquidaciones), its monitoring and the manifests repository in ~/k8s.'),
    T('<b>Arreglas con comandos reales</b>: kubectl get, describe, logs --previous, rollout, set, apply, diff, uncordon… El clúster reconcilia de verdad: rolling updates, scheduler, backoff, OOMKilled.', '<b>You fix things with real commands</b>: kubectl get, describe, logs --previous, rollout, set, apply, diff, uncordon… The cluster really reconciles: rolling updates, the scheduler, backoff, OOMKilled.'),
    T('<b>Se comprueba el estado</b>, no el camino. Luego se valora cómo llegaste: las buenas prácticas del oficio.', '<b>The end state is checked</b>, not the path. Then how you got there is scored: the good practices of the trade.'),
  ],
  guardia: false, importar: false, caos: false,
  bienvenida: modo => modo === 'libre'
    ? [T('Laboratorio libre: el clúster está sano y no hay ticket.', 'Free lab: the cluster is healthy and there is no ticket.'), T('Estás en tu equipo, con kubectl apuntando a producción. Empieza por cat ~/LEEME.md', 'You are on your workstation, with kubectl pointing at production. Start with cat ~/LEEME.md')]
    : [T('Estás en tu equipo (ops), con kubectl ya configurado contra el clúster pagos-prod.', 'You are on your workstation (ops), with kubectl already configured for the pagos-prod cluster.'), T('Para orientarte: cat ~/LEEME.md · kubectl get pods -n pagos · amtool alert', 'To get your bearings: cat ~/LEEME.md · kubectl get pods -n pagos · amtool alert')],
  sesionNueva: T('Nueva sesión en tu equipo', 'New session on your workstation'),
  alertas: T('Alertas (Alertmanager)', 'Alerts (Alertmanager)'),
  paneles: ctx => panelCargas(ctx) + panelServicios(ctx) + panelNodos(ctx),
  experimentos: [
    ['kubectl get pods -n pagos -o wide', T('Qué corre, en qué nodo y con qué IP.', 'What is running, on which node and with which IP.')],
    ['kubectl get pods', T('Sin -n: el namespace por defecto está vacío. El error más común del oficio.', 'Without -n: the default namespace is empty. The most common mistake in the trade.')],
    ['kubectl set image deployment/web-checkout web-checkout=registry.pagos.internal/web-checkout:1.8.2 -n pagos', T('Despliega otra versión y mira el rolling update con kubectl rollout status. Luego kubectl rollout undo.', 'Deploy another version and watch the rolling update with kubectl rollout status. Then kubectl rollout undo.')],
    ['kubectl delete pod -l app=api-pagos -n pagos', T('Borra los pods de api-pagos: el ReplicaSet los repone en un minuto.', 'Delete the api-pagos pods: the ReplicaSet replaces them within a minute.')],
    ['kubectl drain worker-01 --ignore-daemonsets', T('Vacía un nodo: mira dónde acaban sus pods. No te olvides de kubectl uncordon worker-01.', 'Empty a node: see where its pods end up. Do not forget kubectl uncordon worker-01.')],
    ['kubectl set resources deployment/antifraude -n pagos --limits=memory=512Mi', T('Baja el límite de memoria de antifraude y espera unos minutos: describe pod te dirá qué pasa.', 'Lower antifraude\'s memory limit and wait a few minutes: describe pod will tell you what happens.')],
    ['kubectl diff -f ~/k8s/', T('Compara el clúster con el repositorio de manifiestos. Si no sale nada, no hay deriva.', 'Compare the cluster with the manifests repository. If nothing comes out, there is no drift.')],
    ['kubectl top pod -n pagos', T('Cuánto consume cada pod de verdad, frente a lo que pide.', 'How much each pod really uses, against what it requests.')],
    ['ssh worker-02', T('Entra en un nodo: systemctl status kubelet, sudo crictl ps.', 'Log into a node: systemctl status kubelet, sudo crictl ps.')],
    ['cat ~/LEEME.md', T('Las normas del equipo de plataforma.', 'The platform team\'s rules.')],
  ],
};
})(window.PUESTO = window.PUESTO || {});
