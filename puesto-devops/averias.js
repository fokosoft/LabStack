// Puesto DevOps · catálogo de averías (fase 4).
//
// Lo mismo que los catálogos del Puesto Linux y del Puesto Cloud: cada tipo sabe
// romper el clúster (aplicar), decir lo que sigue roto (pendientes), arreglarse
// con comandos de verdad (arreglo), comprobar sus parámetros (validar) y qué
// recurso toca (para no combinar dos averías sobre lo mismo). Las condiciones
// (condicion: true) preparan la escena y no tienen arreglo.
//
// Lo propio de Kubernetes es el tiempo: una avería ocurre «hace N minutos» y el
// clúster reacciona (reinicios, desalojos, rollouts). P.aplicarAverias las
// aplica en orden cronológico y corre K.simular entre una y otra, así que una
// clave cambiada hace 8 horas y un nodo reiniciado hace 52 minutos dan lo mismo
// que si hubiera pasado de verdad.
(function (P) {
'use strict';
const U = P.u, T = P.T, K = P.k8s;
P.averias = {};
const def = (id, o) => { P.averias[id] = Object.assign({ id, orden: 2, condicion: false, params: {}, toca: () => [], pendientes: () => [], arreglo: () => [], validar: () => null }, o); };
const hace = a => (a.hace != null ? +a.hace : 30);
const pHace = T('minutos desde que empezó', 'minutes since it started');
const dep = (st, n) => st.k8s.deps['pagos/' + n];
const deriva = (st, rutas) => K.deriva(st, rutas).length > 0;
const crash = (st, n) => K.podsDe(st, dep(st, n)).find(p => p.c.razon === 'CrashLoopBackOff');
const completo = (st, n) => K.completo(st, dep(st, n));
const APPS = ['api-pagos', 'web-checkout', 'antifraude', 'liquidaciones'], SVCS = ['api-pagos', 'web-checkout', 'antifraude'], WORKERS = ['worker-01', 'worker-02', 'worker-03'];
const POLS = ['permitir-api-a-antifraude', 'permitir-ingress-a-web', 'permitir-ingress-a-api'];
const esUno = (v, xs, k) => xs.indexOf(v) < 0 ? T(k + ': ' + xs.join(', '), k + ': ' + xs.join(', ')) : null;
const crashPod = (st, n) => { const p = crash(st, n); return p ? p.nombre : null; };
const imagenDe = (app, tag) => K.REGISTRO + '/' + app + ':' + tag;
// El contrato de una versión: web-checkout 1.9 sirve la salud en /ready.
const contrato = (app, tag, tpl) => { if (app === 'web-checkout' && tpl.ready) tpl.ready.path = K.sirve({ tpl: { imagen: imagenDe(app, tag) } }, '/ready') ? '/ready' : '/health'; return tpl; };

// ------------------------------------------------------------------ despliegues
def('imagen-inexistente', {
  titulo: T('Un despliegue con una imagen que no existe', 'A rollout with an image that does not exist'),
  descripcion: T('Alguien despliega una etiqueta que no está en el registro: el pod nuevo se queda en ImagePullBackOff y el rolling update conserva los viejos.', 'Someone deploys a tag that is not in the registry: the new pod is stuck in ImagePullBackOff and the rolling update keeps the old ones.'),
  params: { app: T('la aplicación', 'the application'), tag: T('la etiqueta equivocada', 'the wrong tag'), hace: pHace }, ejemplo: { app: 'web-checkout', tag: '9.9.9', hace: 40 },
  toca: a => ['dep:' + a.app],
  validar: (st, a) => esUno(a.app, APPS, 'app') || (K.imagenExiste(imagenDe(a.app, a.tag)) ? T('esa etiqueta existe en el registro: no rompería nada', 'that tag exists in the registry: nothing would break') : null),
  aplicar: (st, a, min) => { const d = dep(st, a.app), tpl = K.copia(d.tpl); tpl.imagen = imagenDe(a.app, a.tag); K.cambiarPlantilla(st, d, tpl, '<none>', min); },
  pendientes: (st, a) => !K.imagenExiste(dep(st, a.app).tpl.imagen) || !completo(st, a.app) ? [T(a.app + ': el despliegue no ha terminado con una imagen que exista', a.app + ': the rollout has not finished with an image that exists')] : [],
  arreglo: a => ['kubectl rollout undo deployment/' + a.app + ' -n pagos', 'kubectl rollout status deployment/' + a.app + ' -n pagos'],
});
def('despliegue-a-mano', {
  titulo: T('Una versión desplegada a mano con set image', 'A release deployed by hand with set image'),
  descripcion: T('El repositorio ya tiene el manifiesto de la versión, pero alguien la desplegó con kubectl set image, tecleando la etiqueta y sin el resto del contrato (sondas, recursos).', 'The repository already has the release\'s manifest, but someone deployed it with kubectl set image, typing the tag and without the rest of the contract (probes, resources).'),
  params: { app: T('la aplicación', 'the application'), version: T('la versión del repositorio', 'the repository\'s version'), tecleada: T('la etiqueta que se tecleó', 'the tag that was typed'), hace: pHace }, ejemplo: { app: 'web-checkout', version: '1.9.0', tecleada: '1.9.0', hace: 35 },
  toca: a => ['dep:' + a.app, 'repo:' + a.app],
  validar: (st, a) => esUno(a.app, APPS, 'app') || (!K.imagenExiste(imagenDe(a.app, a.version)) ? T('la versión ' + a.version + ' no está en el registro', 'version ' + a.version + ' is not in the registry') : null) || (a.version === a.tecleada && JSON.stringify(contrato(a.app, a.version, K.copia(dep(st, a.app).tpl)).ready) === JSON.stringify(dep(st, a.app).tpl.ready) ? T('con esa misma etiqueta y el mismo contrato, set image no rompería nada', 'with that same tag and the same contract, set image would break nothing') : null),
  aplicar: (st, a, min) => {
    const repo = st.k8s.repo[a.app + '/deployment.yaml'];
    repo.tpl.imagen = imagenDe(a.app, a.version); contrato(a.app, a.version, repo.tpl);
    if (a.app === 'web-checkout' && repo.tpl.ready.path === '/ready') st.k8s.notas = Object.assign({}, st.k8s.notas, { 'web-checkout/CHANGELOG.md': ['# web-checkout', '', '## ' + a.version, T('- Pago con un clic para clientes recurrentes.', '- One-click payment for returning customers.'), T('- BREAKING: el endpoint de salud pasa de /health a /ready (y /health desaparece). Actualizad la readinessProbe.', '- BREAKING: the health endpoint moves from /health to /ready (and /health is gone). Update the readinessProbe.'), '', '## 1.8.3', T('- Corrige el redondeo del IVA en carritos con descuento.', '- Fixes VAT rounding on discounted carts.')] });
    const d = dep(st, a.app), tpl = K.copia(d.tpl); tpl.imagen = imagenDe(a.app, a.tecleada);
    K.cambiarPlantilla(st, d, tpl, '<none>', min);
  },
  pendientes: (st, a) => deriva(st, [a.app + '/deployment.yaml']) || !completo(st, a.app) ? [T(a.app + ' no corre la versión del repositorio (' + a.version + ') con su rollout terminado', a.app + ' is not running the repository\'s release (' + a.version + ') with its rollout finished')] : [],
  arreglo: a => ['kubectl apply -f ~/k8s/' + a.app + '/deployment.yaml', 'kubectl rollout status deployment/' + a.app + ' -n pagos'],
});
def('limite-memoria', {
  titulo: T('Un límite de memoria por debajo de lo que usa la aplicación', 'A memory limit below what the application uses'),
  descripcion: T('Un «ajuste de recursos» baja el límite de memoria: los pods pasan la sonda y mueren por OOMKilled al cargar lo que necesitan.', 'A "resource tuning" lowers the memory limit: the pods pass the probe and die OOMKilled when they load what they need.'),
  params: { app: T('la aplicación', 'the application'), limite: T('el límite nuevo (MiB)', 'the new limit (MiB)'), hace: pHace }, ejemplo: { app: 'antifraude', limite: 512, hace: 95 },
  toca: a => ['dep:' + a.app],
  validar: (st, a) => esUno(a.app, APPS, 'app') || (!(+a.limite >= 64) ? T('limite: MiB, al menos 64', 'limite: MiB, at least 64') : null) || (K.APPS[a.app] && +a.limite >= (K.APPS[a.app].memCaliente || K.APPS[a.app].mem) ? T('con ese límite la aplicación cabe: no rompería nada', 'with that limit the application fits: nothing would break') : null),
  aplicar: (st, a, min) => { const d = dep(st, a.app), tpl = K.copia(d.tpl); tpl.lim.mem = +a.limite; tpl.req.mem = Math.min(tpl.req.mem, Math.round(+a.limite * 0.75)); K.cambiarPlantilla(st, d, tpl, 'finops: rightsizing CHG-2231', min); },
  pendientes: (st, a) => deriva(st, [a.app + '/deployment.yaml']) || !completo(st, a.app) ? [T(a.app + ' no tiene la memoria del repositorio o sigue sin estar sano', a.app + ' does not have the repository\'s memory or is still not healthy')] : [],
  arreglo: a => ['kubectl apply -f ~/k8s/' + a.app + '/deployment.yaml', 'kubectl rollout status deployment/' + a.app + ' -n pagos'],
});
def('configmap-clave', {
  titulo: T('Una clave renombrada en el ConfigMap de api-pagos', 'A renamed key in api-pagos\' ConfigMap'),
  descripcion: T('Alguien renombra a mano una clave del ConfigMap. Los pods que corren no se enteran: sólo el siguiente que arranque (un reinicio de nodo, un pod nuevo) muere al no encontrarla.', 'Someone renames a ConfigMap key by hand. Running pods never notice: only the next one that starts (a node reboot, a new pod) dies when it cannot find it.'),
  params: { clave: T('la clave que desaparece', 'the key that disappears'), nueva: T('su nombre nuevo', 'its new name'), hace: pHace, reiniciar: T('además, se reinicia un pod en ese momento', 'also, a pod restarts at that moment') }, ejemplo: { clave: 'PASARELA_URL', nueva: 'PAYMENT_GATEWAY_URL', hace: 52, reiniciar: true },
  toca: () => ['cm:api-pagos'],
  validar: (st, a) => esUno(a.clave, ['PASARELA_URL', 'DB_HOST'], 'clave') || (!/^[A-Z][A-Z0-9_]*$/.test(a.nueva || '') ? T('nueva: un nombre de variable en mayúsculas', 'nueva: an upper-case variable name') : null),
  aplicar: (st, a, min) => { const cm = st.k8s.cms['pagos/api-pagos-config']; cm.data[a.nueva] = cm.data[a.clave]; delete cm.data[a.clave]; cm.rv++; if (a.reiniciar) K.borrarPod(st, K.podsDe(st, dep(st, 'api-pagos'))[0], min); },
  pendientes: st => deriva(st, ['api-pagos/configmap.yaml']) || crash(st, 'api-pagos') || !completo(st, 'api-pagos') ? [T('api-pagos sigue con el ConfigMap distinto del repositorio o un pod sin arrancar', 'api-pagos still has the ConfigMap different from the repository or a pod that does not start')] : [],
  arreglo: (a, st) => { const p = crashPod(st, 'api-pagos'); return ['kubectl apply -f ~/k8s/api-pagos/configmap.yaml'].concat(p ? ['kubectl delete pod ' + p + ' -n pagos'] : [], ['kubectl rollout status deployment/api-pagos -n pagos']); },
});
def('selector-roto', {
  titulo: T('Un Service cuyo selector no casa con ningún pod', 'A Service whose selector matches no pod'),
  descripcion: T('Un selector con una etiqueta que ningún pod tiene: cero endpoints con todos los pods en verde.', 'A selector with a label no pod has: zero endpoints with every pod green.'),
  params: { svc: T('el Service', 'the Service'), etiqueta: T('la etiqueta que se añade (clave=valor)', 'the label added (key=value)'), hace: pHace }, ejemplo: { svc: 'api-pagos', etiqueta: 'tier=backend', hace: 18 },
  toca: a => ['svc:' + a.svc],
  validar: (st, a) => esUno(a.svc, SVCS, 'svc') || (!/^[a-z][a-z0-9.-]*=[a-z0-9.-]+$/.test(a.etiqueta || '') ? T('etiqueta: clave=valor', 'etiqueta: key=value') : null) || (a.etiqueta.split('=')[0] === 'app' ? T('cambiar app no es añadir una etiqueta', 'changing app is not adding a label') : null),
  aplicar: (st, a) => { const [k, v] = a.etiqueta.split('='), s = st.k8s.svcs['pagos/' + a.svc]; s.selector = Object.assign({}, s.selector, { [k]: v }); },
  pendientes: (st, a) => deriva(st, [a.svc + '/service.yaml']) || !K.endpoints(st, st.k8s.svcs['pagos/' + a.svc]).length ? [T('El Service ' + a.svc + ' no coincide con el repositorio', 'The ' + a.svc + ' Service does not match the repository')] : [],
  arreglo: a => ['kubectl apply -f ~/k8s/' + a.svc + '/service.yaml', 'kubectl get endpoints ' + a.svc + ' -n pagos'],
});

// ------------------------------------------------------------------ nodos y capacidad
def('cordon-olvidado', {
  orden: 1,
  titulo: T('Un nodo drenado que nadie devolvió', 'A drained node nobody gave back'),
  descripcion: T('Se drenó un worker para un mantenimiento y se quedó en cordon: sano, pero sin aceptar pods. No se nota hasta que falta sitio.', 'A worker was drained for maintenance and left cordoned: healthy, but accepting no pods. It does not show until room runs out.'),
  params: { nodo: T('el worker', 'the worker'), hace: pHace }, ejemplo: { nodo: 'worker-03', hace: 1020 },
  toca: a => ['nodo:' + a.nodo],
  validar: (st, a) => esUno(a.nodo, WORKERS, 'nodo'),
  aplicar: (st, a, min) => { K.drenar(st, a.nodo, min); st.hosts[a.nodo].arrancado = min + 16; },
  pendientes: (st, a) => (st.k8s.nodos[a.nodo].cordon ? [T(a.nodo + ' sigue en cordon', a.nodo + ' is still cordoned')] : []).concat(st.k8s.pods.some(p => !p.nodo && p.ns === 'pagos') ? [T('Hay pods de pagos en Pending', 'There are pagos pods Pending')] : []),
  arreglo: a => ['kubectl uncordon ' + a.nodo, 'sleep 120', 'kubectl get pods -n pagos -o wide'],
});
def('kubelet-parado', {
  orden: 1,
  titulo: T('El kubelet parado en un worker', 'The kubelet stopped on a worker'),
  descripcion: T('El nodo pasa a NotReady y, a los 5 minutos, Kubernetes desaloja sus pods hacia los demás.', 'The node goes NotReady and, after 5 minutes, Kubernetes evicts its pods to the others.'),
  params: { nodo: T('el worker', 'the worker'), hace: pHace }, ejemplo: { nodo: 'worker-01', hace: 40 },
  toca: a => ['nodo:' + a.nodo],
  validar: (st, a) => esUno(a.nodo, WORKERS, 'nodo'),
  aplicar: (st, a, min) => P.parado(st, a.nodo, 'kubelet', min, false),
  pendientes: (st, a) => K.nodoListo(st, st.k8s.nodos[a.nodo]) ? [] : [T(a.nodo + ' sigue NotReady', a.nodo + ' is still NotReady')],
  arreglo: a => ['ssh ' + a.nodo, 'sudo systemctl start kubelet', 'exit', 'kubectl get nodes'],
});
def('swap-kubelet', {
  orden: 1,
  titulo: T('Un worker que vuelve de un reinicio con swap y sin kubelet', 'A worker back from a reboot with swap on and no kubelet'),
  descripcion: T('Un swapfile en /etc/fstab: al reiniciar se activa y el kubelet se niega a arrancar.', 'A swapfile in /etc/fstab: at reboot it turns on and the kubelet refuses to start.'),
  params: { nodo: T('el worker', 'the worker'), hace: pHace }, ejemplo: { nodo: 'worker-02', hace: 75 },
  toca: a => ['nodo:' + a.nodo],
  validar: (st, a) => esUno(a.nodo, WORKERS, 'nodo'),
  aplicar: (st, a, min) => { const h = st.hosts[a.nodo]; Object.assign(h.extra, { swap: true, fstabSwap: true }); h.arrancado = min - 1; P.fallar(st, h, 'kubelet', 'kubelet-swap', min); },
  pendientes: (st, a) => { const h = st.hosts[a.nodo], out = []; if (!K.nodoListo(st, st.k8s.nodos[a.nodo])) out.push(T(a.nodo + ' sigue NotReady', a.nodo + ' is still NotReady')); if (h.extra.swap) out.push(T(a.nodo + ' sigue con swap activo', a.nodo + ' still has swap on')); if (h.extra.fstabSwap) out.push(T('/etc/fstab de ' + a.nodo + ' sigue activando el swap: el nodo volverá a caer en el próximo reinicio', a.nodo + '\'s /etc/fstab still turns swap on: the node will go down again on the next reboot')); return out; },
  arreglo: a => ['ssh ' + a.nodo, 'sudo swapoff -a', "sudo sed -i '/swap/ s/^/#/' /etc/fstab", 'sudo systemctl restart kubelet', 'exit', 'kubectl get nodes'],
});
def('hpa-techo', {
  titulo: T('La HPA de api-pagos con su máximo bajado y mucha carga', 'api-pagos\' HPA with its maximum lowered under heavy load'),
  descripcion: T('Alguien congeló la HPA bajando su máximo; luego llega la carga y no escala.', 'Someone froze the HPA by lowering its maximum; then load arrives and it does not scale.'),
  params: { max: T('el máximo que se dejó', 'the maximum that was left'), carga: T('peticiones por segundo', 'requests per second'), hace: pHace }, ejemplo: { max: 3, carga: 650, hace: 40 },
  toca: () => ['hpa', 'carga'],
  validar: (st, a) => !(+a.max >= 3 && +a.max < 6) ? T('max entre 3 y 5', 'max between 3 and 5') : !(+a.carga >= 400 && +a.carga <= 1200) ? T('carga entre 400 y 1200', 'carga between 400 and 1200') : null,
  aplicar: (st, a) => { st.k8s.hpas['pagos/api-pagos'].max = +a.max; st.k8s.carga['api-pagos'] = +a.carga; },
  pendientes: st => deriva(st, ['api-pagos/hpa.yaml']) || !st.k8s.hpas['pagos/api-pagos'] ? [T('La HPA de api-pagos no es la del repositorio', 'api-pagos\' HPA is not the repository\'s')] : [],
  arreglo: () => ['kubectl apply -f ~/k8s/api-pagos/hpa.yaml', 'kubectl rollout status deployment/api-pagos -n pagos'],
});
def('pvc-lleno', {
  orden: 1,
  titulo: T('El volumen de Prometheus lleno, con la ampliación sin aplicar', 'Prometheus\' volume full, with the expansion not applied'),
  descripcion: T('El volumen de Prometheus se llena y Prometheus no arranca. El PR que lo amplía está fusionado en el repositorio, pero no aplicado.', 'Prometheus\' volume fills up and Prometheus does not start. The PR that grows it is merged in the repository, but not applied.'),
  params: { nuevo: T('el tamaño que dice el repositorio (GiB)', 'the size the repository says (GiB)'), hace: pHace }, ejemplo: { nuevo: 100, hace: 95 },
  toca: () => ['pvc:prometheus'],
  validar: (st, a) => !(+a.nuevo > 50 && +a.nuevo <= 500) ? T('nuevo: más de 50 y hasta 500 GiB', 'nuevo: more than 50 and up to 500 GiB') : null,
  aplicar: (st, a) => { const v = st.k8s.pvcs['monitoring/prometheus-data']; st.k8s.repo['monitoring/prometheus-pvc.yaml'].tam = +a.nuevo; K.commit(st, { h: 'c4e81a9', min: -1300, autor: 'Iván Rubio', msg: T('monitoring: ampliar el volumen de Prometheus a ' + a.nuevo + 'Gi (#212)', 'monitoring: grow Prometheus volume to ' + a.nuevo + 'Gi (#212)') }); v.usado = v.tam; },
  pendientes: (st, a) => { const v = st.k8s.pvcs['monitoring/prometheus-data'], d = st.k8s.deps['monitoring/prometheus']; return (K.resumenDep(st, d).listos < 1 ? [T('Prometheus sigue sin estar listo', 'Prometheus is still not ready')] : []).concat(v.tam < +a.nuevo || deriva(st, ['monitoring/prometheus-pvc.yaml']) ? [T('El volumen de Prometheus no tiene el tamaño del repositorio', 'Prometheus\' volume does not have the repository\'s size')] : []); },
  arreglo: (a, st) => { const p = K.podsDe(st, st.k8s.deps['monitoring/prometheus'])[0]; return ['kubectl apply -f ~/k8s/monitoring/prometheus-pvc.yaml', 'kubectl describe pvc prometheus-data -n monitoring', 'kubectl delete pod ' + p.nombre + ' -n monitoring', 'kubectl rollout status deployment/prometheus -n monitoring']; },
});

// ------------------------------------------------------------------ entrada, permisos y red
def('cert-emisor', {
  titulo: T('El certificado del checkout caducado: su emisor ya no existe', 'The checkout certificate expired: its issuer no longer exists'),
  descripcion: T('El Certificate apunta a un ClusterIssuer que se renombró: cert-manager no pudo renovarlo y caducó.', 'The Certificate points at a ClusterIssuer that was renamed: cert-manager could not renew it and it expired.'),
  params: { viejo: T('el emisor que ya no existe', 'the issuer that no longer exists'), hace: T('minutos desde que caducó', 'minutes since it expired') }, ejemplo: { viejo: 'letsencrypt-production', hace: 95 },
  toca: () => ['cert'],
  validar: (st, a) => !/^[a-z][a-z0-9-]+$/.test(a.viejo || '') ? T('viejo: un nombre de emisor', 'viejo: an issuer name') : st.k8s.issuers[a.viejo] ? T('ese emisor existe: se renovaría sin problema', 'that issuer exists: it would renew without trouble') : null,
  aplicar: (st, a, min) => {
    const c = st.k8s.certs['pagos/checkout-tls'], s = st.k8s.secrets['pagos/checkout-tls'];
    c.issuer = a.viejo; s.hasta = min; s.desde = min - 90 * 1440; c.peticiones = 5; c.fallaDesde = min - 30 * 1440;
    st.k8s.issuers['letsencrypt-prod'].creado = -44000;
    K.commit(st, { h: '7b2d6e4', min: -44100, autor: 'Plataforma', msg: T('cert-manager: un solo ClusterIssuer (letsencrypt-prod) para todo', 'cert-manager: a single ClusterIssuer (letsencrypt-prod) for everything') });
    K.eventoViejo(st, 'pagos', 'Normal', 'Issuing', 'certificate/checkout-tls', 'Renewing certificate as renewal was scheduled at ' + U.iso(c.fallaDesde).replace('T', ' ') + ' +0000 UTC', 'cert-manager-certificates-trigger', c.fallaDesde, 1);
    K.eventoViejo(st, 'pagos', 'Normal', 'Requested', 'certificate/checkout-tls', 'Created new CertificateRequest resource "checkout-tls-5"', 'cert-manager-certificates-request-manager', c.fallaDesde, 1);
    K.eventoViejo(st, 'pagos', 'Warning', 'IssuerNotFound', 'certificaterequest/checkout-tls-5', 'Referenced "ClusterIssuer" not found: clusterissuer.cert-manager.io "' + a.viejo + '" not found', 'cert-manager-certificaterequests-approver', c.fallaDesde, 43105);
  },
  pendientes: st => { const s = st.k8s.secrets['pagos/checkout-tls']; return (!K.secretoValido(st, s) ? [T('checkout-tls no tiene un certificado válido', 'checkout-tls has no valid certificate')] : []).concat(deriva(st, ['web-checkout/certificate.yaml']) || !st.k8s.certs['pagos/checkout-tls'] ? [T('El Certificate no coincide con el repositorio', 'The Certificate does not match the repository')] : []); },
  arreglo: () => ['kubectl apply -f ~/k8s/web-checkout/certificate.yaml', 'kubectl get certificate -n pagos'],
});
def('rbac-sujeto', {
  titulo: T('El permiso de despliegue del pipeline apunta a un namespace viejo', 'The pipeline\'s deploy permission points at an old namespace'),
  descripcion: T('Los runners de CI cambiaron de namespace y el RoleBinding de pagos sigue dando el permiso a la ServiceAccount vieja: Forbidden.', 'The CI runners moved namespace and the RoleBinding in pagos still grants the permission to the old ServiceAccount: Forbidden.'),
  params: { viejo: T('el namespace viejo de los runners', 'the runners\' old namespace'), hace: pHace }, ejemplo: { viejo: 'cicd', hace: 1300 },
  toca: () => ['rbac'],
  validar: (st, a) => !/^[a-z][a-z0-9-]+$/.test(a.viejo || '') ? T('viejo: un nombre de namespace', 'viejo: a namespace name') : a.viejo === 'ci' ? T('ci es el namespace bueno: no rompería nada', 'ci is the right namespace: nothing would break') : null,
  aplicar: (st, a, min) => {
    st.k8s.rbs['pagos/deployer-desplegador'].sujetos[0].ns = a.viejo;
    K.commit(st, { h: 'f13a07c', min: min - 20, autor: 'Plataforma', msg: T('ci: los runners pasan del namespace ' + a.viejo + ' a ci', 'ci: runners move from the ' + a.viejo + ' namespace to ci') });
    st.k8s.ci = Object.assign({}, st.k8s.ci, { 'web-checkout-1.9.0.log': ['Running with gitlab-runner 17.2.1 (b4e3c5d1)', '  on ci-runner-7 (namespace ci, serviceAccount deployer)', '$ kubectl apply -f k8s/web-checkout/deployment.yaml', 'Error from server (Forbidden): error when applying patch:', 'Name: "web-checkout", Namespace: "pagos"', 'for: "k8s/web-checkout/deployment.yaml": error when patching "k8s/web-checkout/deployment.yaml": deployments.apps "web-checkout" is forbidden: User "system:serviceaccount:ci:deployer" cannot patch resource "deployments" in API group "apps" in the namespace "pagos"', 'ERROR: Job failed: exit code 1'] });
  },
  pendientes: st => {
    const sa = { kind: 'ServiceAccount', ns: 'ci', nombre: 'deployer', grupos: [] }, out = [];
    if (!K.puede(st, sa, 'patch', 'deployments', 'pagos')) out.push(T('ci:deployer sigue sin poder hacer patch de deployments en pagos', 'ci:deployer still cannot patch deployments in pagos'));
    const sobran = Object.values(st.k8s.crbs).filter(b => b.sujetos.some(s => s.kind === 'ServiceAccount' && s.nombre === 'deployer')).map(b => 'clusterrolebinding/' + b.nombre)
      .concat(Object.values(st.k8s.rbs).filter(b => b.nombre !== 'deployer-desplegador' && b.sujetos.some(s => s.kind === 'ServiceAccount' && s.nombre === 'deployer')).map(b => 'rolebinding/' + b.nombre));
    if (sobran.length) out.push(T('ci:deployer tiene permisos de más (' + sobran.join(', ') + '): sólo necesita el Role desplegador', 'ci:deployer has extra permissions (' + sobran.join(', ') + '): it only needs the desplegador Role'));
    if (deriva(st, ['rbac/deployer-rolebinding.yaml'])) out.push(T('El RoleBinding no coincide con el repositorio', 'The RoleBinding does not match the repository'));
    return out;
  },
  arreglo: () => ['kubectl apply -f ~/k8s/rbac/deployer-rolebinding.yaml', 'kubectl auth can-i patch deployments -n pagos --as=system:serviceaccount:ci:deployer'],
});
def('netpol-puerto', {
  titulo: T('Una NetworkPolicy que abre el puerto equivocado', 'A NetworkPolicy that opens the wrong port'),
  descripcion: T('Una política de pagos deja pasar otro puerto: el tráfico bueno se descarta en silencio (timeout).', 'A pagos policy lets another port through: the right traffic is silently dropped (timeout).'),
  params: { pol: T('la política', 'the policy'), puerto: T('el puerto equivocado', 'the wrong port'), hace: pHace }, ejemplo: { pol: 'permitir-api-a-antifraude', puerto: 8443, hace: 42 },
  toca: a => ['netpol:' + a.pol],
  validar: (st, a) => esUno(a.pol, POLS, 'pol') || (!(+a.puerto >= 1 && +a.puerto <= 65535) ? T('puerto entre 1 y 65535', 'puerto between 1 and 65535') : st.k8s.netpols['pagos/' + a.pol].ingress[0].puertos.indexOf(+a.puerto) >= 0 ? T('ése es el puerto bueno: no rompería nada', 'that is the right port: nothing would break') : null),
  aplicar: (st, a) => { st.k8s.netpols['pagos/' + a.pol].ingress[0].puertos = [+a.puerto]; },
  pendientes: (st, a) => deriva(st, ['netpol/' + a.pol + '.yaml']) ? [T('La NetworkPolicy ' + a.pol + ' no coincide con el repositorio', 'The ' + a.pol + ' NetworkPolicy does not match the repository')] : [],
  arreglo: () => ['kubectl apply -f ~/k8s/netpol/'],
});

// ------------------------------------------------------------------ Helm, GitOps y CI
def('helm-pendiente', {
  titulo: T('Un release de Helm colgado en pending-upgrade', 'A Helm release stuck in pending-upgrade'),
  descripcion: T('El proceso que hacía el upgrade de ingress-nginx murió a mitad: el release queda en pending-upgrade y cualquier upgrade nuevo falla.', 'The process upgrading ingress-nginx died halfway: the release is left in pending-upgrade and any new upgrade fails.'),
  params: { version: T('la versión del chart que se intentaba', 'the chart version being attempted'), hace: pHace }, ejemplo: { version: '4.11.5', hace: 38 },
  toca: () => ['helm:ingress-nginx'],
  validar: (st, a) => !K.helm.CHARTS['ingress-nginx/ingress-nginx'].versiones.some(v => v[0] === a.version) ? T('version: una versión publicada del chart ingress-nginx', 'version: a published version of the ingress-nginx chart') : null,
  aplicar: (st, a, min) => {
    const r = K.helm.release(st, 'ingress-nginx', 'ingress-nginx'), u = r.historia[r.historia.length - 1], cv = K.helm.CHARTS['ingress-nginx/ingress-nginx'].versiones.find(v => v[0] === a.version);
    r.historia.push({ rev: u.rev + 1, chartV: cv[0], app: cv[1], estado: 'pending-upgrade', min, desc: 'Preparing upgrade', values: K.copia(u.values) });
    st.k8s.ci = Object.assign({}, st.k8s.ci, { 'ingress-nginx-upgrade.log': ['Running with gitlab-runner 17.2.1 (b4e3c5d1)', '  on ci-runner-3 (namespace ci, serviceAccount deployer)', '$ helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version ' + a.version + ' -n ingress-nginx -f helm/ingress-nginx/values.yaml --wait --timeout 10m', 'ERROR: Job failed (system failure): pod "runner-x7k2q" status is "Failed": the runner was OOMKilled', '', '--- retry #1 ---', '$ helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version ' + a.version + ' -n ingress-nginx -f helm/ingress-nginx/values.yaml --wait --timeout 10m', 'Error: UPGRADE FAILED: another operation (install/upgrade/rollback) is in progress', 'ERROR: Job failed: exit code 1'] });
  },
  pendientes: st => { const r = K.helm.release(st, 'ingress-nginx', 'ingress-nginx'), u = r.historia[r.historia.length - 1]; return u.estado !== 'deployed' ? [T('El release ingress-nginx no está en deployed (' + u.estado + ')', 'The ingress-nginx release is not deployed (' + u.estado + ')')] : []; },
  arreglo: (a, st) => { const r = K.helm.release(st, 'ingress-nginx', 'ingress-nginx'), buena = r.historia.slice().reverse().find(v => v.estado === 'deployed'); return ['helm rollback ingress-nginx ' + buena.rev + ' -n ingress-nginx', 'helm list -n ingress-nginx']; },
});
def('gitops-version-rota', {
  orden: 3,
  titulo: T('Una versión rota desplegada por Argo CD con self-heal', 'A broken release deployed by Argo CD with self-heal'),
  descripcion: T('CI empuja una versión que necesita configuración que no existe. La aplicación tiene auto-sync y self-heal: se arregla en git (revert + push), no con kubectl.', 'CI pushes a release that needs configuration that does not exist. The application has auto-sync and self-heal: it is fixed in git (revert + push), not with kubectl.'),
  params: { version: T('la versión rota', 'the broken release'), hace: pHace, undo: T('además, alguien intentó un rollout undo', 'also, someone tried a rollout undo') }, ejemplo: { version: '2.16.0', hace: 35, undo: true },
  toca: () => ['dep:api-pagos', 'argo:api-pagos'],
  validar: (st, a) => a.version !== '2.16.0' ? T('version: en el simulador, la 2.16.0 (la que pide PASARELA_TIMEOUT_MS)', 'version: in the simulator, 2.16.0 (the one requiring PASARELA_TIMEOUT_MS)') : null,
  aplicar: (st, a, min) => {
    const app = K.argoApp(st, 'api-pagos'), nuevo = K.copia(st.k8s.repo['api-pagos/deployment.yaml']);
    Object.assign(app, { auto: true, selfHeal: true, prune: true });
    K.commit(st, { h: '3e9a1d0', min: -10100, autor: 'Plataforma', msg: T('argocd: auto-sync y self-heal para api-pagos', 'argocd: auto-sync and self-heal for api-pagos') });
    nuevo.tpl.imagen = imagenDe('api-pagos', a.version);
    K.commit(st, { h: 'b7c41e8', min, autor: 'ci-bot', msg: 'api-pagos: ' + a.version + ' (pipeline #4870)', cambios: [{ ruta: 'api-pagos/deployment.yaml', despues: nuevo }] });
    if (a.undo) (st.programados = st.programados || []).push({ min: min + 15, fn: s => { const d = dep(s, 'api-pagos'), tpl = K.copia(d.tpl); tpl.imagen = imagenDe('api-pagos', '2.14.1'); K.cambiarPlantilla(s, d, tpl, '<none>', min + 15); } });
  },
  pendientes: st => { const app = K.argoApp(st, 'api-pagos'), e = K.argoEstado(st, app), out = []; if (!app.auto || !app.selfHeal) out.push(T('La aplicación api-pagos de Argo CD ya no tiene auto-sync y self-heal', 'The api-pagos Argo CD application no longer has auto-sync and self-heal')); if (e.sync !== 'Synced') out.push(T('Argo CD ve api-pagos OutOfSync', 'Argo CD sees api-pagos OutOfSync')); if (crash(st, 'api-pagos') || !completo(st, 'api-pagos')) out.push(T('api-pagos no está sano', 'api-pagos is not healthy')); return out; },
  arreglo: () => ['cd ~/k8s', 'git revert b7c41e8 --no-edit', 'git push', 'cd', 'kubectl rollout status deployment/api-pagos -n pagos'],
});
def('ci-sin-sincronizar', {
  titulo: T('Un pipeline en rojo porque nadie sincronizó en Argo CD', 'A red pipeline because nobody synced in Argo CD'),
  descripcion: T('CI publica la versión y actualiza el manifiesto, pero la aplicación se sincroniza a mano y su job de deploy agota el tiempo esperando.', 'CI publishes the release and updates the manifest, but the application is synced by hand and its deploy job times out waiting.'),
  params: { version: T('la versión que publica CI', 'the release CI publishes'), hace: pHace }, ejemplo: { version: '1.9.1', hace: 50 },
  toca: () => ['dep:web-checkout', 'argo:web-checkout'],
  validar: (st, a) => !K.imagenExiste(imagenDe('web-checkout', a.version)) ? T('version: una versión de web-checkout que esté en el registro', 'version: a web-checkout version that is in the registry') : a.version === K.partesImagen(dep(st, 'web-checkout').tpl.imagen).tag ? T('ésa es la versión que ya corre', 'that is the version already running') : null,
  aplicar: (st, a, min) => {
    const nuevo = K.copia(st.k8s.repo['web-checkout/deployment.yaml']); nuevo.tpl.imagen = imagenDe('web-checkout', a.version); contrato('web-checkout', a.version, nuevo.tpl); nuevo.tpl.req.mem = 160;
    K.commit(st, { h: 'd52f8a3', min: min + 2, autor: 'ci-bot', msg: 'web-checkout: ' + a.version + ' (pipeline #4892)', cambios: [{ ruta: 'web-checkout/deployment.yaml', despues: nuevo }] });
    const espera = ['Running with gitlab-runner 17.2.1 (b4e3c5d1)', '  on ci-runner-7 (namespace ci, serviceAccount deployer)', '$ argocd app wait web-checkout --sync --health --timeout 600', 'TIMESTAMP                  GROUP  KIND        NAMESPACE  NAME          STATUS     HEALTH   HOOK  MESSAGE', U.iso(min + 2) + 'Z  apps   Deployment  pagos      web-checkout  OutOfSync  Healthy', 'FATA[0600] Timed out (600s) waiting for app "web-checkout" match desired state', 'ERROR: Job failed: exit code 20'];
    K.pipeline(st, { id: 4892, ref: 'main', titulo: 'Release ' + a.version, estado: 'failed', min: min - 10, jobs: [
      { id: 9301, nombre: 'build', stage: 'build', estado: 'success', log: ['$ docker build -t ' + imagenDe('web-checkout', a.version) + ' .', 'Successfully built 4f1c2a9e7d31', 'Job succeeded'] },
      { id: 9302, nombre: 'test', stage: 'test', estado: 'success', log: ['$ npm test', '  148 passing (9s)', 'Job succeeded'] },
      { id: 9303, nombre: 'push-image', stage: 'publish', estado: 'success', log: ['$ docker push ' + imagenDe('web-checkout', a.version), a.version + ': digest: sha256:' + U.hex('wc' + a.version, 64) + ' size: 1782', 'Job succeeded'] },
      { id: 9304, nombre: 'update-manifest', stage: 'publish', estado: 'success', log: ['$ yq -i \'.spec.template.spec.containers[0].image = "' + imagenDe('web-checkout', a.version) + '"\' web-checkout/deployment.yaml', '$ git commit -am "web-checkout: ' + a.version + ' (pipeline #4892)" && git push origin main', '   a91c3f2..d52f8a3  main -> main', 'Job succeeded'] },
      { id: 9305, nombre: 'deploy', stage: 'deploy', estado: 'failed', log: espera, reintentar: s => K.jobDeploy(s, 'web-checkout')
        ? { ok: true, log: espera.slice(0, 4).concat([U.iso(s.reloj) + 'Z  apps   Deployment  pagos      web-checkout  Synced     Healthy', '', 'Name:               argocd/web-checkout', 'Sync Status:        Synced to main (d52f8a3)', 'Health Status:      Healthy', 'Job succeeded']) }
        : { ok: false, log: espera.map(x => x.replace(U.iso(min + 2), U.iso(s.reloj))) } },
    ] });
  },
  pendientes: (st, a) => {
    const d = dep(st, 'web-checkout'), app = K.argoApp(st, 'web-checkout'), e = K.argoEstado(st, app), p = st.k8s.pipelines.find(x => x.id === 4892), out = [];
    if (K.partesImagen(d.tpl.imagen).tag !== a.version || !K.completo(st, d)) out.push(T('web-checkout no está desplegado en la ' + a.version, 'web-checkout is not deployed on ' + a.version));
    if (e.sync !== 'Synced') out.push(T('Argo CD ve web-checkout OutOfSync', 'Argo CD sees web-checkout OutOfSync'));
    if (app.auto) out.push(T('web-checkout tiene ahora auto-sync: en producción se sincroniza a mano, lo decidió el equipo', 'web-checkout now has auto-sync: production is synced by hand, the team decided so'));
    if (!p || p.estado !== 'success') out.push(T('El pipeline #4892 sigue en rojo', 'Pipeline #4892 is still red'));
    return out;
  },
  arreglo: () => ['argocd app sync web-checkout', 'kubectl rollout status deployment/web-checkout -n pagos', 'glab ci retry 9305'],
});

// ------------------------------------------------------------------ condiciones
def('reinicio-nodo', {
  condicion: true,
  titulo: T('Un worker que se reinicia (un parcheo)', 'A worker that reboots (patching)'),
  descripcion: T('Sus contenedores mueren y vuelven a arrancar con lo que haya en ese momento: lo que cambió sin que nadie lo notara, se nota ahora.', 'Its containers die and start again with whatever is there at that moment: whatever changed unnoticed shows now.'),
  params: { nodo: T('el worker', 'the worker'), hace: pHace }, ejemplo: { nodo: 'worker-02', hace: 52 },
  toca: a => ['reinicio:' + a.nodo],
  validar: (st, a) => esUno(a.nodo, WORKERS, 'nodo'),
  aplicar: (st, a, min) => { K.reinicioNodo(st, a.nodo, min, 3); st.hosts[a.nodo].arrancado = min; },
});
def('escalado', {
  condicion: true,
  titulo: T('Una aplicación escalada a más réplicas', 'An application scaled to more replicas'),
  descripcion: T('Más réplicas piden más sitio: lo que antes cabía puede dejar de caber.', 'More replicas ask for more room: what used to fit may no longer fit.'),
  params: { app: T('la aplicación', 'the application'), replicas: T('las réplicas', 'the replicas'), hace: pHace }, ejemplo: { app: 'liquidaciones', replicas: 3, hace: 30 },
  toca: a => ['escala:' + a.app],
  validar: (st, a) => esUno(a.app, ['liquidaciones', 'antifraude', 'web-checkout'], 'app') || (!(+a.replicas >= 1 && +a.replicas <= 8) ? T('replicas entre 1 y 8', 'replicas between 1 and 8') : null),
  aplicar: (st, a, min) => { const d = dep(st, a.app); d.replicas = +a.replicas; d.progreso = min; },
});

// ------------------------------------------------------------------ campos (el compositor)
const cHace = { k: 'hace', t: 'num', min: 0, max: 2000, def: 30, etiqueta: T('hace (min)', 'ago (min)') };
const opc = (k, xs, etq) => ({ k, t: 'opciones', opciones: xs, etiqueta: etq || k });
P.camposAveria = {
  'imagen-inexistente': [opc('app', APPS, T('aplicación', 'application')), { k: 'tag', t: 'texto', def: '9.9.9', etiqueta: T('etiqueta que no existe', 'tag that does not exist') }, cHace],
  'despliegue-a-mano': [opc('app', ['api-pagos', 'web-checkout'], T('aplicación', 'application')), { k: 'version', t: 'texto', def: '1.9.0', etiqueta: T('versión del repositorio', 'repository version') }, { k: 'tecleada', t: 'texto', def: '1.9.0', etiqueta: T('etiqueta tecleada', 'typed tag') }, cHace],
  'limite-memoria': [opc('app', APPS, T('aplicación', 'application')), { k: 'limite', t: 'num', min: 64, max: 4096, def: 512, etiqueta: T('límite (MiB)', 'limit (MiB)') }, cHace],
  'configmap-clave': [opc('clave', ['PASARELA_URL', 'DB_HOST'], T('clave', 'key')), { k: 'nueva', t: 'texto', def: 'PAYMENT_GATEWAY_URL', etiqueta: T('nombre nuevo', 'new name') }, cHace, { k: 'reiniciar', t: 'bool', etiqueta: T('reiniciar un pod en ese momento', 'restart a pod at that moment') }],
  'selector-roto': [opc('svc', SVCS, 'Service'), { k: 'etiqueta', t: 'texto', def: 'tier=backend', etiqueta: T('etiqueta añadida', 'label added') }, cHace],
  'cordon-olvidado': [opc('nodo', WORKERS, T('nodo', 'node')), cHace],
  'kubelet-parado': [opc('nodo', WORKERS, T('nodo', 'node')), cHace],
  'swap-kubelet': [opc('nodo', WORKERS, T('nodo', 'node')), cHace],
  'hpa-techo': [{ k: 'max', t: 'num', min: 3, max: 5, def: 3, etiqueta: T('máximo', 'maximum') }, { k: 'carga', t: 'num', min: 400, max: 1200, def: 650, etiqueta: T('carga (req/s)', 'load (req/s)') }, cHace],
  'pvc-lleno': [{ k: 'nuevo', t: 'num', min: 60, max: 500, def: 100, etiqueta: T('tamaño en el repositorio (GiB)', 'size in the repository (GiB)') }, cHace],
  'cert-emisor': [{ k: 'viejo', t: 'texto', def: 'letsencrypt-production', etiqueta: T('emisor que ya no existe', 'issuer that no longer exists') }, cHace],
  'rbac-sujeto': [{ k: 'viejo', t: 'texto', def: 'cicd', etiqueta: T('namespace viejo', 'old namespace') }, cHace],
  'netpol-puerto': [opc('pol', POLS, T('política', 'policy')), { k: 'puerto', t: 'num', min: 1, max: 65535, def: 8443, etiqueta: T('puerto equivocado', 'wrong port') }, cHace],
  'helm-pendiente': [opc('version', K.helm.CHARTS['ingress-nginx/ingress-nginx'].versiones.map(v => v[0]), T('versión del chart', 'chart version')), cHace],
  'gitops-version-rota': [opc('version', ['2.16.0'], T('versión rota', 'broken release')), cHace, { k: 'undo', t: 'bool', etiqueta: T('alguien intentó un rollout undo', 'someone tried a rollout undo') }],
  'ci-sin-sincronizar': [opc('version', ['1.9.0', '1.9.1'], T('versión', 'release')), cHace],
  'reinicio-nodo': [opc('nodo', WORKERS, T('nodo', 'node')), cHace],
  escalado: [opc('app', ['liquidaciones', 'antifraude', 'web-checkout'], T('aplicación', 'application')), { k: 'replicas', t: 'num', min: 1, max: 8, def: 4, etiqueta: T('réplicas', 'replicas') }, cHace],
};

// ------------------------------------------------------------------ para las incidencias en fichero
const META = {
  'imagen-inexistente': ['despliegue', T('Despliegues', 'Deployments'), a => a.app], 'despliegue-a-mano': ['despliegue', T('Despliegues', 'Deployments'), a => a.app + T(' y su manifiesto', ' and its manifest')],
  'limite-memoria': ['cluster', T('Recursos', 'Resources'), a => a.app], 'configmap-clave': ['despliegue', 'ConfigMaps', T('api-pagos y su configuración', 'api-pagos and its configuration')],
  'selector-roto': ['despliegue', 'Services', a => T('el Service ' + a.svc, 'the ' + a.svc + ' Service')], 'cordon-olvidado': ['cluster', T('Nodos', 'Nodes'), a => a.nodo],
  'kubelet-parado': ['cluster', T('Nodos', 'Nodes'), a => a.nodo], 'swap-kubelet': ['cluster', T('Nodos', 'Nodes'), a => a.nodo],
  'hpa-techo': ['cluster', 'HPA', T('el escalado de api-pagos', 'api-pagos\' scaling')], 'pvc-lleno': ['cluster', T('Almacenamiento', 'Storage'), 'Prometheus'],
  'cert-emisor': ['seg', T('Certificados', 'Certificates'), T('el certificado del checkout', 'the checkout certificate')], 'rbac-sujeto': ['seg', 'RBAC', T('los permisos del pipeline', 'the pipeline\'s permissions')],
  'netpol-puerto': ['seg', 'NetworkPolicies', T('la red de pagos', 'the pagos network')], 'helm-pendiente': ['despliegue', 'Helm', 'ingress-nginx'],
  'gitops-version-rota': ['despliegue', 'GitOps', T('api-pagos, Argo CD y git', 'api-pagos, Argo CD and git')], 'ci-sin-sincronizar': ['cicd', 'CI/CD', T('el pipeline y Argo CD', 'the pipeline and Argo CD')],
  'reinicio-nodo': ['cluster', T('Nodos', 'Nodes'), a => a.nodo], escalado: ['cluster', T('Capacidad', 'Capacity'), a => a.app],
};
const meta = (a, k) => { const v = META[a.tipo][k]; return typeof v === 'function' ? v(a) : v; };
P.incidenciasCfg = {
  alertas: 'amtool alert',
  maxHace: 2000,
  pista: T('Empieza por lo que ven las alertas: amtool alert. Luego kubectl get nodes y kubectl get pods -A: lo que no esté Running y listo es por donde se tira.', 'Start with what the alerts see: amtool alert. Then kubectl get nodes and kubectl get pods -A: whatever is not Running and ready is the thread to pull.'),
  funcionesDe: lista => [...new Set(lista.map(a => meta(a, 0)))].concat('incid'),
  areaDe: lista => [...new Set(lista.filter(a => !P.averias[a.tipo].condicion).map(a => meta(a, 1)))].join(' · '),
  sitios: lista => [...new Set(lista.filter(a => !P.averias[a.tipo].condicion).map(a => meta(a, 2)))],
  mirar: /amtool|kubectl (get|describe|logs|top|diff|auth can-i|rollout (status|history))|argocd app (get|list|diff|history)|helm (list|history|status)|git (log|show|status)|glab ci (list|view|trace)|journalctl|systemctl status|swapon|free|\bcurl\b|\bcat\b/,
  tocar: /kubectl (apply|patch|set|delete|create|rollout (undo|restart)|scale|uncordon|cordon|drain)|helm (upgrade|rollback)|systemctl (start|restart)|swapoff|sed -i|git (revert|push)|argocd app (sync|set|rollback)|glab ci retry/,
  sinReiniciar: { t: T('No reiniciaste nodos para arreglarlo', 'You did not reboot nodes to fix it'), ok: st => !st.hechos.reinicios.length },
  etiqueta: a => a.app ? ' (' + a.app + ')' : a.svc ? ' (' + a.svc + ')' : a.nodo ? ' (' + a.nodo + ')' : a.pol ? ' (' + a.pol + ')' : '',
};
P.compositorCfg = { claveImp: 'puesto-devops-importadas', claveBorrador: 'puesto-devops-borrador', nuevoTipo: 'imagen-inexistente' };

// ------------------------------------------------------------------ usar el catálogo
// En orden cronológico, con el clúster corriendo entre una avería y la siguiente.
P.aplicarAverias = (st, lista) => {
  const xs = lista.map((a, i) => ({ a, i, min: -hace(a) })).sort((x, y) => x.min - y.min || x.i - y.i);
  if (!xs.length) return;
  let t = xs[0].min;
  // Tras una avería el clúster se asienta en minutos: entre dos muy separadas se simulan los 30
  // primeros y los 30 últimos, y el tramo en calma se salta.
  const correr = (desde, hasta) => { if (hasta - desde > 60) { K.simular(st, desde, desde + 29); K.simular(st, hasta - 29, hasta); } else K.simular(st, desde, hasta); };
  xs.forEach(x => { if (x.min > t) { correr(t, x.min - 1); t = x.min; } P.averias[x.a.tipo].aplicar(st, x.a, x.min); });
  correr(t, 0);
};
P.pendientesAverias = (st, lista) => [].concat(...lista.filter(a => !a.soloPractica && !P.averias[a.tipo].condicion).map(a => P.averias[a.tipo].pendientes(st, a)));
P.arregloAverias = (st, lista) => [].concat(...lista.map((a, i) => ({ a, i })).filter(x => !P.averias[x.a.tipo].condicion).sort((x, y) => P.averias[x.a.tipo].orden - P.averias[y.a.tipo].orden || x.i - y.i).map(x => P.averias[x.a.tipo].arreglo(x.a, st)));
P.validarAverias = lista => {
  const st = P.crear(), errores = [], toques = {};
  if (!Array.isArray(lista) || !lista.length) return [T('una incidencia necesita al menos una avería', 'an incident needs at least one fault')];
  lista.forEach((a, i) => {
    const t = a && P.averias[a.tipo];
    if (!t) { errores.push(T('avería ' + (i + 1) + ': tipo desconocido «' + (a && a.tipo) + '»', 'fault ' + (i + 1) + ": unknown type '" + (a && a.tipo) + "'")); return; }
    const pref = T('avería ' + (i + 1) + ' (' + a.tipo + '): ', 'fault ' + (i + 1) + ' (' + a.tipo + '): ');
    const falta = (P.camposAveria[a.tipo] || []).filter(c => !c.opcional && c.def == null && c.t !== 'bool' && (a[c.k] == null || a[c.k] === '')).map(c => c.k);
    if (falta.length) { errores.push(pref + T('falta ', 'missing ') + falta.join(', ')); return; }
    const e = t.validar(st, a);
    if (e) errores.push(pref + e);
    t.toca(a).forEach(k => { if (toques[k] != null) errores.push(T('las averías ' + (toques[k] + 1) + ' y ' + (i + 1) + ' tocan lo mismo (' + k + ')', 'faults ' + (toques[k] + 1) + ' and ' + (i + 1) + ' touch the same thing (' + k + ')')); else toques[k] = i; });
  });
  // Dos nodos fuera a la vez no los absorben tres workers.
  if (lista.filter(a => a && /^(kubelet-parado|swap-kubelet|cordon-olvidado)$/.test(a.tipo)).length > 1) errores.push(T('como mucho un nodo fuera de servicio por incidencia: tres workers no absorben dos', 'at most one node out of service per incident: three workers cannot absorb two'));
  return errores;
};
})(window.PUESTO = window.PUESTO || {});
