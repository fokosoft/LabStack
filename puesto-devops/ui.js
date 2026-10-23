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
  return `<section class="panel"><h3>Services <span class="der-n">checkout ${sonda.ok ? '200' : sonda.codigo || (sonda.tls ? 'TLS' : 'error')}</span></h3>${filas}</section>`;
}

// Fase 2: lo que hay alrededor de las cargas. El certificado, la HPA, el volumen de Prometheus y Helm.
function panelPlataforma({ st, h }) {
  const fila = (e, nombre, nota, titulo) => `<div class="host ancho e-${e}"${titulo ? ' title="' + h(titulo) + '"' : ''}><i class="punto"></i><b>${h(nombre)}</b><span>${h(nota)}</span></div>`;
  const out = [];
  const c = st.k8s.certs && st.k8s.certs['pagos/checkout-tls'], s = c && st.k8s.secrets['pagos/' + c.secret];
  if (c) { const dias = s ? Math.floor((s.hasta - st.reloj) / 1440) : null; out.push(fila(!s || dias < 0 ? 'fallo' : dias < 21 ? 'aviso' : 'ok', 'checkout-tls', !s ? T('sin certificado', 'no certificate') : dias < 0 ? T('caducado', 'expired') : dias + T(' días', ' days'), c.issuer)); }
  const hp = st.k8s.hpas && st.k8s.hpas['pagos/api-pagos'];
  if (hp) { const u = K.utilHpa(st, hp), d = st.k8s.deps['pagos/api-pagos']; out.push(fila(u.error ? 'fallo' : hp.limitado === 'max' ? 'aviso' : 'ok', 'hpa api-pagos', d.replicas + '/' + hp.max + ' · cpu ' + (u.error ? '?' : u.util + ' %'), u.error || '')); }
  const v = st.k8s.pvcs && st.k8s.pvcs['monitoring/prometheus-data'];
  if (v) { const pc = Math.round(v.usado / v.tam * 100); out.push(`<div class="osd ${pc >= 97 ? 'caido' : pc >= 85 ? 'lleno' : ''}" title="monitoring/prometheus-data · ${v.tam}Gi"><b>prom</b><span class="osd-bar"><i style="width:${pc}%"></i></span><em>${pc} %</em></div>`); }
  const r = K.helm && K.helm.release(st, 'ingress-nginx', 'ingress-nginx');
  if (r) { const x = r.historia[r.historia.length - 1]; out.push(fila(x.estado === 'deployed' ? 'ok' : 'aviso', 'ingress-nginx', x.estado === 'deployed' ? x.chartV : x.estado.replace('pending-', 'pending '), 'helm · rev ' + x.rev + ' · ' + x.chartV + ' · ' + x.estado)); }
  if (st.k8s.argo) { const apps = Object.values(st.k8s.argo).map(a => K.argoEstado(st, a)), fuera = apps.filter(x => x.sync === 'OutOfSync').length, mal = apps.filter(x => x.salud === 'Degraded').length; out.push(fila(mal ? 'fallo' : fuera ? 'aviso' : 'ok', 'argo cd', mal ? mal + ' Degraded' : fuera ? fuera + ' OutOfSync' : apps.length + T(' apps al día', ' apps in sync'), fuera ? fuera + ' OutOfSync' : '')); }
  return out.length ? `<section class="panel"><h3>${T('Plataforma', 'Platform')}</h3>${out.join('')}</section>` : '';
}

P.ui = {
  clave: 'puesto-devops-v1',
  claveImp: P.compositorCfg.claveImp,
  oferta: {
    tag: T('📌 Puesto', '📌 Job opening'),
    titulo: T('Ingeniero/a DevOps (Kubernetes)', 'DevOps Engineer (Kubernetes)'),
    sub: T('Plataforma de pagos · remoto · contrato indefinido', 'Payments platform · remote · permanent, full-time'),
    txt: T('Operar y mantener clústeres de Kubernetes en producción, desplegar y versionar aplicaciones sin cortes, mantener los pipelines de CI/CD, observabilidad con Prometheus y Alertmanager con guardias, y seguridad de la plataforma (RBAC, Secrets, NetworkPolicies). Cada función del puesto tiene sus tickets:', 'Operate and maintain production Kubernetes clusters, deploy and version applications without downtime, maintain the CI/CD pipelines, observability with Prometheus and Alertmanager with on-call duty, and platform security (RBAC, Secrets, NetworkPolicies). Each duty of the role has its own tickets:'),
  },
  como: [
    T('<b>Un clúster de Kubernetes simulado</b>: un control plane y tres workers, la plataforma de pagos (api-pagos, web-checkout, antifraude, liquidaciones), su monitorización, ingress-nginx y cert-manager instalados con Helm, una HPA, volúmenes, RBAC, NetworkPolicies, el repositorio de manifiestos en ~/k8s desplegado con Argo CD y los pipelines de CI.', '<b>A simulated Kubernetes cluster</b>: one control plane and three workers, the payments platform (api-pagos, web-checkout, antifraude, liquidaciones), its monitoring, ingress-nginx and cert-manager installed with Helm, an HPA, volumes, RBAC, NetworkPolicies, the manifests repository in ~/k8s deployed with Argo CD, and the CI pipelines.'),
    T('<b>Arreglas con comandos reales</b>: kubectl get, describe, logs --previous, rollout, apply, diff, exec, auth can-i, helm history, helm rollback… El clúster reconcilia de verdad: rolling updates, scheduler, backoff, OOMKilled, la HPA, cert-manager.', '<b>You fix things with real commands</b>: kubectl get, describe, logs --previous, rollout, apply, diff, exec, auth can-i, helm history, helm rollback… The cluster really reconciles: rolling updates, the scheduler, backoff, OOMKilled, the HPA, cert-manager.'),
    T('<b>Se comprueba el estado</b>, no el camino. Luego se valora cómo llegaste: las buenas prácticas del oficio.', '<b>The end state is checked</b>, not the path. Then how you got there is scored: the good practices of the trade.'),
  ],
  guardia: true, importar: true, caos: true,
  bienvenida: modo => modo === 'guardia'
    ? [T('Te ha saltado la guardia. No hay ticket: sólo lo que ven las alertas.', 'You have been paged. There is no ticket: only what the alerts see.'), T('Estás en tu equipo. Para orientarte: amtool alert · kubectl get nodes · kubectl get pods -A', 'You are on your workstation. To get your bearings: amtool alert · kubectl get nodes · kubectl get pods -A')]
    : modo === 'libre'
    ? [T('Laboratorio libre: el clúster está sano y no hay ticket.', 'Free lab: the cluster is healthy and there is no ticket.'), T('Estás en tu equipo, con kubectl apuntando a producción. Empieza por cat ~/LEEME.md', 'You are on your workstation, with kubectl pointing at production. Start with cat ~/LEEME.md')]
    : [T('Estás en tu equipo (ops), con kubectl ya configurado contra el clúster pagos-prod.', 'You are on your workstation (ops), with kubectl already configured for the pagos-prod cluster.'), T('Para orientarte: cat ~/LEEME.md · kubectl get pods -n pagos · amtool alert', 'To get your bearings: cat ~/LEEME.md · kubectl get pods -n pagos · amtool alert')],
  sesionNueva: T('Nueva sesión en tu equipo', 'New session on your workstation'),
  alertas: T('Alertas (Alertmanager)', 'Alerts (Alertmanager)'),
  paneles: ctx => panelCargas(ctx) + panelServicios(ctx) + panelPlataforma(ctx) + panelNodos(ctx),
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
    ['kubectl get hpa -n pagos', T('La HPA de api-pagos. Prueba kubectl scale y mira cuánto dura.', 'api-pagos\' HPA. Try kubectl scale and see how long it lasts.')],
    ['kubectl auth can-i get secrets -n pagos --as=system:serviceaccount:ci:deployer', T('Qué puede hacer el pipeline de CI. Cambia el verbo y el recurso.', 'What the CI pipeline can do. Change the verb and the resource.')],
    ['kubectl get netpol -n pagos', T('pagos está cerrado por defecto. Desde un pod de web-checkout, prueba a llamar a antifraude con kubectl exec ... -- wget -qO- antifraude:8080/actuator/health.', 'pagos is closed by default. From a web-checkout pod, try calling antifraude with kubectl exec ... -- wget -qO- antifraude:8080/actuator/health.')],
    ['helm history ingress-nginx -n ingress-nginx', T('Las revisiones del controlador de entrada. Cada una es también un Secret: kubectl get secrets -n ingress-nginx.', 'The ingress controller\'s revisions. Each one is also a Secret: kubectl get secrets -n ingress-nginx.')],
    ['curl -sv https://checkout.pagos.example/api/v1/salud', T('El checkout visto desde fuera, con su certificado.', 'The checkout seen from outside, with its certificate.')],
    ['argocd app list', T('Las aplicaciones de Argo CD: qué está Synced y qué no. Cambia algo a mano y vuelve a mirar.', 'The Argo CD applications: what is Synced and what is not. Change something by hand and look again.')],
    ['ssh worker-03', T('Entra en un nodo y para el kubelet (sudo systemctl stop kubelet): a los 5 minutos Kubernetes se lleva sus pods.', 'Log into a node and stop the kubelet (sudo systemctl stop kubelet): after 5 minutes Kubernetes takes its pods away.')],
    ['cat ~/LEEME.md', T('Las normas del equipo de plataforma.', 'The platform team\'s rules.')],
  ],
};
})(window.PUESTO = window.PUESTO || {});
