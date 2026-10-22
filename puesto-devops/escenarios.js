// Puesto DevOps · los tickets.
//
// Mismo contrato que los otros puestos: aplicar(st) rompe, resuelto(st) dice lo
// que falta (comprueba el ESTADO, nunca qué comandos se escribieron), practicas
// se juzgan con el registro, guion es una solución de referencia y trampas son
// arreglos a medias que no deben cerrarlo. Y además, en esta app: ninguna
// alerta de Alertmanager puede quedar activa.
//
// Cada ticket rompe algo en un minuto del pasado y deja que K.simular corra el
// clúster hasta ahora: los reinicios, los eventos y la edad de los pods salen
// del modelo, no se escriben a mano.
(function (P) {
'use strict';
const U = P.u, T = P.T, K = P.k8s;

const idx = (st, re, desde) => { for (let i = desde || 0; i < st.registro.length; i++) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const ultimo = (st, re) => { for (let i = st.registro.length - 1; i >= 0; i--) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const usado = (st, re) => idx(st, re) >= 0;
const antes = (st, a, b) => { const i = idx(st, a), j = idx(st, b); return i >= 0 && (j < 0 || i < j); };
const despues = (st, a, b) => { const j = ultimo(st, b); return j >= 0 && idx(st, a, j + 1) >= 0; };
P.ayudasEscenario = { usado, antes, despues, idx, ultimo };

const MATRIZ = { 'alto|alta': 'P1', 'alto|media': 'P2', 'medio|alta': 'P2', 'alto|baja': 'P3', 'medio|media': 'P3', 'bajo|alta': 'P3', 'medio|baja': 'P4', 'bajo|media': 'P4', 'bajo|baja': 'P4' };
const SLA = { P1: 60, P2: 240, P3: 480, P4: 1440 };
P.prioridad = e => { const p = MATRIZ[e.impacto + '|' + e.urgencia]; return { p, sla: SLA[p] }; };

// Las cinco funciones de la oferta. Una función sin tickets no se enseña en la cola.
P.funciones = [
  { id: 'cluster', titulo: T('Operar y mantener los clústeres de Kubernetes (nodos, capacidad)', 'Operate and maintain the Kubernetes clusters (nodes, capacity)'), corto: T('Clúster', 'Cluster') },
  { id: 'despliegue', titulo: T('Despliegue y versionado de aplicaciones sin cortes', 'Zero-downtime application deployment and versioning'), corto: T('Despliegues', 'Deployments') },
  { id: 'cicd', titulo: T('Pipelines de CI/CD: imágenes, registro y promoción', 'CI/CD pipelines: images, registry and promotion'), corto: 'CI/CD' },
  { id: 'incid', titulo: T('Observabilidad (Prometheus, Alertmanager) y guardias', 'Observability (Prometheus, Alertmanager) and on-call'), corto: T('Incidencias', 'Incidents') },
  { id: 'seg', titulo: T('Seguridad de la plataforma: RBAC, Secrets, NetworkPolicies', 'Platform security: RBAC, Secrets, NetworkPolicies'), corto: T('Seguridad', 'Security') },
];

// ------------------------------------------------------------------ comprobaciones comunes
const alertas = st => P.alertasActivas(st).map(a => T('La alerta ' + a.nombre + ' sigue activa', 'Alert ' + a.nombre + ' is still firing') + ' (' + a.res + ')');
const dep = (st, n) => st.k8s.deps['pagos/' + n];
// La deriva: lo que el repositorio dice y el clúster no.
K.deriva = (st, rutas) => (rutas || Object.keys(st.k8s.repo)).filter(r => {
  const m = st.k8s.repo[r], vivo = K.manifiesto(st, m.kind, m.ns + '/' + m.nombre);
  return JSON.stringify(vivo) !== JSON.stringify(m);
});
const sinDeriva = (st, rutas) => K.deriva(st, rutas).map(r => T('El clúster no coincide con ~/k8s/' + r + ' (kubectl diff -f ~/k8s/' + r + ')', 'The cluster does not match ~/k8s/' + r + ' (kubectl diff -f ~/k8s/' + r + ')'));
const desplegado = (st, n) => { const d = dep(st, n), r = K.resumenDep(st, d); return r.completo ? [] : d.enRollout ? [T(n + ': el rollout no ha terminado (' + r.listos + '/' + d.replicas + ' listos, ' + r.actualizados + ' con la plantilla nueva)', n + ': the rollout has not finished (' + r.listos + '/' + d.replicas + ' ready, ' + r.actualizados + ' on the new template)')] : [T(n + ': ' + r.listos + ' de ' + d.replicas + ' réplicas listas', n + ': ' + r.listos + ' of ' + d.replicas + ' replicas ready')]; };
const crash = (st, n) => K.podsDe(st, dep(st, n)).find(p => p.c.razon === 'CrashLoopBackOff');
const conRaiz = 'kubectl (apply|patch|set|delete|rollout (undo|restart)|scale|uncordon|cordon|drain)';
const CAMBIA = new RegExp(conRaiz);

P.escenarios = [
// ============================================================================ 1
{
  id: 'INC-8101', clave: 'crashloop-config', tipo: 'incidente', nivel: 2, area: 'Deployments · ConfigMaps', funciones: ['despliegue', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Alertmanager (guardia)', 'Alertmanager (on call)'),
  asunto: T('KubePodCrashLooping: un pod de api-pagos no levanta desde el parcheo de anoche', 'KubePodCrashLooping: one api-pagos pod has not come up since last night\'s patching'),
  cuerpo: [T('Desde las 08:20 uno de los tres pods de api-pagos está en CrashLoopBackOff. Los otros dos atienden los pagos, pero vamos sin margen: si cae otro, la pasarela se queda corta.', 'Since 08:20 one of the three api-pagos pods has been in CrashLoopBackOff. The other two are handling payments, but there is no headroom left: if another one goes, the gateway falls short.'),
    T('Anoche se parchearon los nodos y worker-02 se reinició a esa hora. Ayer por la tarde, además, alguien «alineó los nombres» de la configuración de api-pagos con el equipo de la pasarela.', 'The nodes were patched overnight and worker-02 rebooted at that time. Yesterday afternoon, on top of that, someone "aligned the names" in api-pagos\' configuration with the gateway team.')],
  inicio: -52, abierto: -18,
  aplicar(st) {
    const cm = st.k8s.cms['pagos/api-pagos-config'];
    cm.data.PAYMENT_GATEWAY_URL = cm.data.PASARELA_URL; delete cm.data.PASARELA_URL; cm.rv++;
    K.reinicioNodo(st, 'worker-02', -52, 3);
    st.hosts['worker-02'].arrancado = -52;
    K.simular(st, -52, 0);
  },
  objetivo(st) { return desplegado(st, 'api-pagos').concat(crash(st, 'api-pagos') ? [T('Sigue habiendo un pod de api-pagos en CrashLoopBackOff', 'There is still an api-pagos pod in CrashLoopBackOff')] : [], sinDeriva(st, ['api-pagos/configmap.yaml'])); },
  practicas: [
    { t: T('Leíste el log del contenedor que murió (logs --previous) antes de tocar nada', 'You read the dead container\'s log (logs --previous) before touching anything'), ok: st => antes(st, /kubectl logs .*(--previous|-p\b)/, CAMBIA) },
    { t: T('Comparaste el ConfigMap con el repositorio (kubectl diff) antes de aplicarlo', 'You compared the ConfigMap with the repository (kubectl diff) before applying it'), ok: st => antes(st, /kubectl diff/, /kubectl (apply|patch)/) },
    { t: T('No reiniciaste los pods sanos: los otros dos seguían atendiendo pagos', 'You did not restart the healthy pods: the other two were still handling payments'), ok: st => !usado(st, /rollout restart/) },
    { t: T('Comprobaste el resultado después del arreglo (rollout status o get pods)', 'You checked the result after the fix (rollout status or get pods)'), ok: st => despues(st, /kubectl (rollout status|get pods)/, /kubectl (apply|patch)/) },
  ],
  pistas: [
    T('Un pod en CrashLoopBackOff arranca, muere y espera cada vez más. Lo que dijo antes de morir está en kubectl logs POD -n pagos --previous. Empieza por kubectl get pods -n pagos -o wide.', 'A pod in CrashLoopBackOff starts, dies and waits longer each time. What it said before dying is in kubectl logs POD -n pagos --previous. Start with kubectl get pods -n pagos -o wide.'),
    T('El log dice que falta PASARELA_URL. Mira qué tiene el ConfigMap: kubectl get configmap api-pagos-config -n pagos -o yaml, y compáralo con el repositorio: kubectl diff -f ~/k8s/api-pagos/configmap.yaml. ¿Por qué los otros dos pods no fallan? Porque leyeron el entorno al arrancar, antes del cambio.', 'The log says PASARELA_URL is missing. Look at what the ConfigMap has: kubectl get configmap api-pagos-config -n pagos -o yaml, and compare it with the repository: kubectl diff -f ~/k8s/api-pagos/configmap.yaml. Why do the other two pods not fail? Because they read their environment at startup, before the change.'),
    T('kubectl apply -f ~/k8s/api-pagos/configmap.yaml devuelve el ConfigMap a lo que dice el repositorio. El pod lo leerá en su próximo arranque; para no esperar al backoff, kubectl delete pod POD -n pagos. Y kubectl rollout status deployment/api-pagos -n pagos.', 'kubectl apply -f ~/k8s/api-pagos/configmap.yaml puts the ConfigMap back to what the repository says. The pod will read it on its next start; so as not to wait for the backoff, kubectl delete pod POD -n pagos. Then kubectl rollout status deployment/api-pagos -n pagos.'),
  ],
  causa: T('Ayer alguien cambió a mano (kubectl edit) el ConfigMap api-pagos-config y renombró PASARELA_URL a PAYMENT_GATEWAY_URL. Los pods que ya corrían no se enteraron: el entorno se lee al arrancar. Al reiniciarse worker-02 con el parcheo, su pod de api-pagos arrancó con el ConfigMap nuevo, no encontró PASARELA_URL y murió.', 'Yesterday someone changed the api-pagos-config ConfigMap by hand (kubectl edit) and renamed PASARELA_URL to PAYMENT_GATEWAY_URL. The pods already running never noticed: the environment is read at startup. When worker-02 rebooted for the patching, its api-pagos pod started with the new ConfigMap, did not find PASARELA_URL and died.'),
  solucion: T('ConfigMap devuelto a lo que dice ~/k8s con kubectl apply, el pod que fallaba borrado para que arranque ya con la configuración buena, y api-pagos de nuevo 3/3.', 'ConfigMap put back to what ~/k8s says with kubectl apply, the failing pod deleted so it starts right away with the good configuration, and api-pagos back to 3/3.'),
  leccion: T('Un cambio en un ConfigMap no llega a los pods que ya corren: llega al siguiente que arranque, a veces días después y por otro motivo. Por eso un cambio de configuración se despliega (rollout) y se vigila, en vez de dejarlo «puesto». Y el log que importa es el del contenedor que murió: --previous.', 'A ConfigMap change does not reach pods that are already running: it reaches the next one that starts, sometimes days later and for another reason. That is why a configuration change is rolled out and watched, instead of left "in place". And the log that matters is the dead container\'s: --previous.'),
  guion: st => { const p = crash(st, 'api-pagos'); return ['amtool alert', 'kubectl get pods -n pagos -o wide', 'kubectl logs ' + p.nombre + ' -n pagos --previous', 'kubectl get configmap api-pagos-config -n pagos -o yaml', 'kubectl diff -f ~/k8s/api-pagos/configmap.yaml', 'kubectl apply -f ~/k8s/api-pagos/configmap.yaml', 'kubectl delete pod ' + p.nombre + ' -n pagos', 'kubectl rollout status deployment/api-pagos -n pagos', 'amtool alert']; },
  trampas: [
    { cmds: st => ['kubectl delete pod ' + crash(st, 'api-pagos').nombre + ' -n pagos', 'sleep 120'], porque: T('el pod nuevo lee el mismo ConfigMap y vuelve a morir', 'the new pod reads the same ConfigMap and dies again') },
    { cmds: ['kubectl rollout restart deployment/api-pagos -n pagos', 'sleep 120'], porque: T('reiniciar el deployment crea pods nuevos que también mueren; por suerte el rolling update no quita los sanos', 'restarting the deployment creates new pods that also die; luckily the rolling update does not remove the healthy ones') },
    { cmds: st => ['kubectl patch configmap api-pagos-config -n pagos -p \'{"data":{"PASARELA_URL":"https://api.pasarela-pagos.example/v3"}}\'', 'kubectl delete pod ' + crash(st, 'api-pagos').nombre + ' -n pagos', 'sleep 120'], porque: T('el pod vuelve, pero el ConfigMap queda distinto del repositorio (sobra PAYMENT_GATEWAY_URL): deriva', 'the pod comes back, but the ConfigMap is left different from the repository (PAYMENT_GATEWAY_URL is extra): drift') },
  ],
},
// ============================================================================ 2
{
  id: 'INC-8104', clave: 'imagen-etiqueta', tipo: 'incidente', nivel: 1, area: T('Despliegues · Registro', 'Deployments · Registry'), funciones: ['despliegue', 'incid'],
  impacto: 'medio', urgencia: 'media', de: T('Equipo de pagos (Raúl Ortega)', 'Payments team (Raúl Ortega)'),
  asunto: T('La 2.15.0 de api-pagos lleva 40 minutos desplegándose y no termina', 'api-pagos 2.15.0 has been deploying for 40 minutes and never finishes'),
  cuerpo: [T('He desplegado la 2.15.0 de api-pagos con kubectl set image, como decía el correo de release, y kubectl rollout status se queda esperando. Los pagos funcionan (sigue la 2.14.1), pero hoy tenía que salir la 2.15.', 'I deployed api-pagos 2.15.0 with kubectl set image, as the release email said, and kubectl rollout status just keeps waiting. Payments work (2.14.1 is still running), but 2.15 was supposed to go out today.'),
    T('El pipeline de CI terminó en verde y dejó el manifiesto actualizado en el repositorio.', 'The CI pipeline finished green and left the manifest updated in the repository.')],
  inicio: -40, abierto: -12,
  aplicar(st) {
    const d = dep(st, 'api-pagos'), repo = st.k8s.repo['api-pagos/deployment.yaml'];
    repo.tpl.imagen = K.REGISTRO + '/api-pagos:v2.15.0';
    const tpl = K.copia(d.tpl); tpl.imagen = K.REGISTRO + '/api-pagos:2.15.0';
    K.cambiarPlantilla(st, d, tpl, '<none>', -40);
    K.simular(st, -40, 0);
  },
  objetivo(st) {
    const d = dep(st, 'api-pagos'), tag = K.partesImagen(d.tpl.imagen).tag;
    return (tag !== 'v2.15.0' ? [T('api-pagos no corre la 2.15 publicada (v2.15.0): la plantilla tiene :' + tag, 'api-pagos is not running the published 2.15 (v2.15.0): the template has :' + tag)] : []).concat(desplegado(st, 'api-pagos'), sinDeriva(st, ['api-pagos/deployment.yaml']));
  },
  practicas: [
    { t: T('Leíste por qué no arranca el pod nuevo (describe pod o get events) antes de cambiar nada', 'You read why the new pod does not start (describe pod or get events) before changing anything'), ok: st => antes(st, /kubectl (describe pod|get events|describe deploy)/, CAMBIA) },
    { t: T('Comprobaste qué etiquetas existen de verdad en el registro', 'You checked which tags really exist in the registry'), ok: st => usado(st, /tags\/list/) },
    { t: T('Miraste la diferencia con el repositorio antes de aplicar', 'You looked at the difference with the repository before applying'), ok: st => antes(st, /kubectl diff/, /kubectl (apply|set image)/) },
    { t: T('Esperaste a que terminara el rollout (rollout status)', 'You waited for the rollout to finish (rollout status)'), ok: st => despues(st, /rollout status/, /kubectl (apply|set image)/) },
  ],
  pistas: [
    T('Un rollout que no termina casi siempre tiene un pod nuevo que no llega a estar listo. kubectl get pods -n pagos: busca el que no está Running, y kubectl describe pod POD -n pagos para ver sus eventos.', 'A rollout that never finishes almost always has a new pod that never becomes ready. kubectl get pods -n pagos: find the one that is not Running, and kubectl describe pod POD -n pagos to see its events.'),
    T('«not found» al descargar la imagen: esa etiqueta no existe. Pregunta al registro cuáles hay: curl -s https://' + K.REGISTRO + '/v2/api-pagos/tags/list', '"not found" when pulling the image: that tag does not exist. Ask the registry which ones there are: curl -s https://' + K.REGISTRO + '/v2/api-pagos/tags/list'),
    T('El repositorio ya tiene la buena (CI lo actualizó): kubectl diff -f ~/k8s/api-pagos/deployment.yaml y kubectl apply -f ~/k8s/api-pagos/deployment.yaml. Después, kubectl rollout status deployment/api-pagos -n pagos.', 'The repository already has the right one (CI updated it): kubectl diff -f ~/k8s/api-pagos/deployment.yaml and kubectl apply -f ~/k8s/api-pagos/deployment.yaml. Then kubectl rollout status deployment/api-pagos -n pagos.'),
  ],
  causa: T('El correo de release decía «2.15.0», pero CI publica las imágenes con una v delante: la etiqueta que existe es v2.15.0. kubectl set image puso :2.15.0, que no existe, y el pod nuevo se quedó en ImagePullBackOff. Como el rolling update no quita un pod viejo hasta que el nuevo está listo, la 2.14.1 siguió sirviendo y nadie lo notó salvo el despliegue.', 'The release email said "2.15.0", but CI publishes images with a leading v: the tag that exists is v2.15.0. kubectl set image set :2.15.0, which does not exist, and the new pod got stuck in ImagePullBackOff. Since a rolling update does not remove an old pod until the new one is ready, 2.14.1 kept serving and nobody noticed except the deployment.'),
  solucion: T('Desplegado desde el repositorio (kubectl apply -f ~/k8s/api-pagos/deployment.yaml), que ya tenía la etiqueta buena v2.15.0; rollout terminado.', 'Deployed from the repository (kubectl apply -f ~/k8s/api-pagos/deployment.yaml), which already had the right tag v2.15.0; rollout finished.'),
  leccion: T('ImagePullBackOff no es un fallo de la aplicación: es el nodo que no consigue la imagen (etiqueta que no existe, registro inaccesible, credenciales). Y el rolling update te protegió: con maxUnavailable, los pods viejos no se van hasta que los nuevos están listos. Desplegar a mano copiando de un correo es la forma más fiable de equivocarse en un carácter; el manifiesto que dejó CI es la fuente.', 'ImagePullBackOff is not an application failure: it is the node failing to get the image (a tag that does not exist, an unreachable registry, credentials). And the rolling update protected you: with maxUnavailable, old pods do not leave until the new ones are ready. Deploying by hand by copying from an email is the most reliable way to get one character wrong; the manifest CI left behind is the source.'),
  guion: st => { const p = K.podsDe(st, dep(st, 'api-pagos')).find(x => /Image/.test(x.c.razon || '')); return ['kubectl get pods -n pagos', 'kubectl describe pod ' + p.nombre + ' -n pagos', 'curl -s https://' + K.REGISTRO + '/v2/api-pagos/tags/list', 'kubectl diff -f ~/k8s/api-pagos/deployment.yaml', 'kubectl apply -f ~/k8s/api-pagos/deployment.yaml', 'kubectl rollout status deployment/api-pagos -n pagos', 'amtool alert']; },
  trampas: [
    { cmds: ['kubectl rollout undo deployment/api-pagos -n pagos', 'kubectl rollout status deployment/api-pagos -n pagos'], porque: T('vuelve a la 2.14.1: la alerta se apaga, pero la 2.15 sigue sin salir', 'it goes back to 2.14.1: the alert goes away, but 2.15 still has not shipped') },
    { cmds: ['kubectl delete pod -l app=api-pagos -n pagos', 'sleep 60'], porque: T('borrar pods no cambia la etiqueta: el nuevo vuelve a ImagePullBackOff (y has tirado los sanos)', 'deleting pods does not change the tag: the new one goes back to ImagePullBackOff (and you have killed the healthy ones)') },
  ],
},
// ============================================================================ 3
{
  id: 'INC-8108', clave: 'oomkilled', tipo: 'incidente', nivel: 2, area: T('Recursos · Límites', 'Resources · Limits'), funciones: ['cluster', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Alertmanager (guardia)', 'Alertmanager (on call)'),
  asunto: T('antifraude reiniciándose sin parar: los pagos se quedan sin puntuar', 'antifraude restarting non-stop: payments are left unscored'),
  cuerpo: [T('Los dos pods de antifraude se reinician cada pocos minutos. Mientras están caídos, api-pagos deja los pagos en «revisión manual» y la cola del equipo de fraude no para de crecer.', 'Both antifraude pods restart every few minutes. While they are down, api-pagos sends payments to "manual review" and the fraud team\'s queue keeps growing.'),
    T('No hay errores en el log de antifraude: arranca, empieza a cargar el modelo y se corta. Esta mañana FinOps aplicó su «ajuste de recursos» a varios servicios.', 'There are no errors in antifraude\'s log: it starts, begins loading the model and just stops. This morning FinOps applied their "resource tuning" to several services.')],
  inicio: -95, abierto: -10,
  aplicar(st) {
    const d = dep(st, 'antifraude'), tpl = K.copia(d.tpl);
    tpl.lim.mem = 512; tpl.req.mem = 384;
    K.cambiarPlantilla(st, d, tpl, 'finops: rightsizing CHG-2231', -95);
    K.simular(st, -95, 0);
  },
  objetivo(st) {
    const d = dep(st, 'antifraude'), m = K.podsDe(st, d).filter(p => p.c.ultimo && p.c.ultimo.razon === 'OOMKilled' && p.c.estado !== 'corriendo');
    return desplegado(st, 'antifraude').concat(m.length ? [T(m.length + ' pod(s) de antifraude siguen muriendo por OOMKilled', m.length + ' antifraude pod(s) are still being OOMKilled')] : [], !d.tpl.lim.mem ? [T('antifraude se ha quedado sin límite de memoria', 'antifraude has been left without a memory limit')] : []);
  },
  practicas: [
    { t: T('Encontraste el OOMKilled en describe pod (Last State) antes de cambiar nada', 'You found the OOMKilled in describe pod (Last State) before changing anything'), ok: st => antes(st, /kubectl describe pod/, CAMBIA) },
    { t: T('Miraste cuánta memoria usa de verdad (kubectl top pod)', 'You looked at how much memory it really uses (kubectl top pod)'), ok: st => usado(st, /kubectl top pod/) },
    { t: T('No quitaste el límite de memoria: lo subiste a algo razonable (768Mi–2Gi)', 'You did not remove the memory limit: you raised it to something reasonable (768Mi–2Gi)'), ok: st => { const l = dep(st, 'antifraude').tpl.lim.mem; return l >= 768 && l <= 2048; } },
    { t: T('Comprobaste que el rollout terminó', 'You checked that the rollout finished'), ok: st => despues(st, /rollout status/, CAMBIA) },
  ],
  pistas: [
    T('Un contenedor que muere sin dejar un error en el log suele morir desde fuera: el kernel. kubectl describe pod POD -n pagos y mira Last State y su Reason.', 'A container that dies without leaving an error in its log is usually killed from outside: by the kernel. kubectl describe pod POD -n pagos and look at Last State and its Reason.'),
    T('OOMKilled con exit code 137: pasó de su límite de memoria. ¿Cuál es el límite ahora y cuál era antes? kubectl rollout history deployment/antifraude -n pagos y kubectl diff -f ~/k8s/antifraude/deployment.yaml. Cuánto usa cuando está sano: kubectl top pod -n pagos.', 'OOMKilled with exit code 137: it went over its memory limit. What is the limit now and what was it before? kubectl rollout history deployment/antifraude -n pagos and kubectl diff -f ~/k8s/antifraude/deployment.yaml. How much it uses when healthy: kubectl top pod -n pagos.'),
    T('Devuélvelo a lo que dice el repositorio (kubectl apply -f ~/k8s/antifraude/deployment.yaml) o sube el límite: kubectl set resources deployment/antifraude -n pagos --limits=memory=1Gi --requests=memory=768Mi. Después, kubectl rollout status.', 'Put it back to what the repository says (kubectl apply -f ~/k8s/antifraude/deployment.yaml) or raise the limit: kubectl set resources deployment/antifraude -n pagos --limits=memory=1Gi --requests=memory=768Mi. Then kubectl rollout status.'),
  ],
  causa: T('El «ajuste de recursos» bajó el límite de memoria de antifraude de 1Gi a 512Mi. Los pods nuevos arrancan, pasan la sonda y reciben tráfico; con el primer pago cargan el modelo (≈720 MiB), pasan del límite y el kernel los mata (OOMKilled, exit 137). Como estuvieron listos un momento, el rolling update ya había retirado los viejos: no quedó ninguno sano.', 'The "resource tuning" lowered antifraude\'s memory limit from 1Gi to 512Mi. The new pods start, pass the probe and receive traffic; with the first payment they load the model (≈720 MiB), go over the limit and the kernel kills them (OOMKilled, exit 137). Because they were ready for a moment, the rolling update had already retired the old ones: none healthy was left.'),
  solucion: T('Límite de memoria devuelto a 1Gi (y request a 768Mi), como en el repositorio; rollout terminado y antifraude estable.', 'Memory limit back to 1Gi (and request to 768Mi), as in the repository; rollout finished and antifraude stable.'),
  leccion: T('OOMKilled no deja rastro en el log de la aplicación: lo cuenta describe pod. Un límite de memoria se fija mirando el consumo real con margen, no la media: un proceso que carga algo grande tarde (un modelo, una caché) pasa la sonda y muere después, y entonces el rolling update ya no te protege. Y quitar el límite no es arreglarlo: es dejar que ese pod se coma el nodo.', 'OOMKilled leaves no trace in the application log: describe pod tells you. A memory limit is set from real usage plus headroom, not the average: a process that loads something big late (a model, a cache) passes the probe and dies afterwards, and then the rolling update no longer protects you. And removing the limit is not a fix: it lets that pod eat the node.'),
  guion: st => { const p = K.podsDe(st, dep(st, 'antifraude')).find(x => x.c.ultimo) || K.podsDe(st, dep(st, 'antifraude'))[0]; return ['amtool alert', 'kubectl get pods -n pagos -l app=antifraude', 'kubectl describe pod ' + p.nombre + ' -n pagos', 'kubectl top pod -n pagos', 'kubectl rollout history deployment/antifraude -n pagos', 'kubectl diff -f ~/k8s/antifraude/deployment.yaml', 'kubectl apply -f ~/k8s/antifraude/deployment.yaml', 'kubectl rollout status deployment/antifraude -n pagos', 'amtool alert']; },
  trampas: [
    { cmds: ['kubectl delete pod -l app=antifraude -n pagos', 'sleep 180'], porque: T('los pods nuevos tienen el mismo límite y mueren igual', 'the new pods have the same limit and die just the same') },
    { cmds: ['kubectl set resources deployment/antifraude -n pagos --limits=memory=0', 'kubectl rollout status deployment/antifraude -n pagos'], porque: T('sin límite deja de morir, pero ese pod puede comerse la memoria del nodo', 'without a limit it stops dying, but that pod can eat the node\'s memory'), practicas: [2] },
  ],
},
// ============================================================================ 4
{
  id: 'INC-8112', clave: 'pending-cordon', tipo: 'incidente', nivel: 1, area: T('Nodos · Scheduling', 'Nodes · Scheduling'), funciones: ['cluster', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Finanzas (cierre de mes)', 'Finance (month-end close)'),
  asunto: T('Las liquidaciones del cierre van a medio gas: dos pods en Pending', 'Month-end settlements are running at half speed: two pods Pending'),
  cuerpo: [T('Para el cierre de mes escalamos liquidaciones a 4 réplicas, como siempre. Dos llevan media hora en Pending y el lote no va a terminar a tiempo.', 'For the month-end close we scaled liquidaciones to 4 replicas, as always. Two have been Pending for half an hour and the batch will not finish on time.'),
    T('El mes pasado cupieron sin problema. Ayer hubo mantenimiento de nodos.', 'Last month they fitted without any trouble. There was node maintenance yesterday.')],
  inicio: -30, abierto: -14,
  aplicar(st) {
    K.drenar(st, 'worker-03', -1020);
    st.hosts['worker-03'].arrancado = -1004;
    K.simular(st, -1020, -1000);
    dep(st, 'liquidaciones').replicas = 4;
    K.simular(st, -30, 0);
  },
  objetivo(st) {
    const d = dep(st, 'liquidaciones'), out = [];
    if (d.replicas < 4) out.push(T('liquidaciones tiene ' + d.replicas + ' réplicas: el cierre necesita 4', 'liquidaciones has ' + d.replicas + ' replicas: the close needs 4'));
    const pend = K.podsDe(st, d).filter(p => !p.nodo).length;
    if (pend) out.push(T(pend + ' pod(s) de liquidaciones siguen en Pending', pend + ' liquidaciones pod(s) are still Pending'));
    return out.concat(desplegado(st, 'liquidaciones'));
  },
  practicas: [
    { t: T('Leíste por qué no se programan (describe pod o get events) antes de tocar nada', 'You read why they are not scheduled (describe pod or get events) before touching anything'), ok: st => antes(st, /kubectl (describe pod|get events)/, CAMBIA) },
    { t: T('Miraste el estado de los nodos antes de devolver uno al servicio', 'You looked at the state of the nodes before returning one to service'), ok: st => antes(st, /kubectl (get nodes|describe node)/, /uncordon/) },
    { t: T('No bajaste los requests de liquidaciones para que «cupiera»', 'You did not lower liquidaciones\' requests to make it "fit"'), ok: st => dep(st, 'liquidaciones').tpl.req.cpu >= 1500 },
  ],
  pistas: [
    T('Un pod en Pending no ha llegado a ningún nodo: el scheduler explica por qué en sus eventos. kubectl describe pod POD -n pagos, al final.', 'A Pending pod has not reached any node: the scheduler explains why in its events. kubectl describe pod POD -n pagos, at the bottom.'),
    T('«1 node(s) were unschedulable»: hay un nodo que no acepta pods. kubectl get nodes: busca SchedulingDisabled. ¿Por qué lo está, y está sano? kubectl describe node worker-03.', '"1 node(s) were unschedulable": there is a node that does not accept pods. kubectl get nodes: look for SchedulingDisabled. Why is it, and is it healthy? kubectl describe node worker-03.'),
    T('Tras el mantenimiento alguien se olvidó de devolverlo: kubectl uncordon worker-03. El scheduler colocará solo los pendientes; compruébalo con kubectl get pods -n pagos -o wide.', 'After the maintenance someone forgot to give it back: kubectl uncordon worker-03. The scheduler will place the pending ones by itself; check it with kubectl get pods -n pagos -o wide.'),
  ],
  causa: T('Ayer se drenó worker-03 para parchear el kernel (kubectl drain) y, al terminar, nadie hizo uncordon. El nodo está sano pero marcado SchedulingDisabled, así que todo el clúster cabe en dos workers... hasta que liquidaciones pide dos réplicas más de 1,5 CPU cada una.', 'Yesterday worker-03 was drained to patch the kernel (kubectl drain) and, at the end, nobody ran uncordon. The node is healthy but marked SchedulingDisabled, so the whole cluster fits on two workers... until liquidaciones asks for two more replicas of 1.5 CPUs each.'),
  solucion: T('kubectl uncordon worker-03: el scheduler colocó allí los dos pods pendientes y liquidaciones está 4/4.', 'kubectl uncordon worker-03: the scheduler placed the two pending pods there and liquidaciones is 4/4.'),
  leccion: T('drain = cordon + desalojar. El cordon se queda hasta que alguien lo quita, y un nodo sano que no acepta pods no salta en ninguna alerta: lo ves cuando falta sitio. Un mantenimiento termina con uncordon y comprobando que el nodo vuelve a recibir trabajo. Y la solución nunca es bajar los requests: mienten al scheduler y el problema vuelve con peor cara.', 'drain = cordon + evict. The cordon stays until someone removes it, and a healthy node that accepts no pods fires no alert: you see it when you run out of room. A maintenance ends with uncordon and checking that the node gets work again. And the answer is never to lower the requests: they lie to the scheduler and the problem comes back looking worse.'),
  guion: st => { const p = K.podsDe(st, dep(st, 'liquidaciones')).find(x => !x.nodo); return ['kubectl get pods -n pagos -o wide', 'kubectl describe pod ' + p.nombre + ' -n pagos', 'kubectl get nodes', 'kubectl describe node worker-03', 'kubectl uncordon worker-03', 'kubectl rollout status deployment/liquidaciones -n pagos', 'kubectl get pods -n pagos -o wide', 'amtool alert']; },
  trampas: [
    { cmds: ['kubectl scale deployment/liquidaciones -n pagos --replicas=2'], porque: T('ya no hay Pending, pero el cierre necesita 4 réplicas', 'there is no Pending any more, but the close needs 4 replicas') },
    { cmds: ['kubectl set resources deployment/liquidaciones -n pagos --requests=cpu=500m', 'kubectl rollout status deployment/liquidaciones -n pagos'], porque: T('caben, pero con requests que mienten: el nodo se queda sin CPU de verdad', 'they fit, but with requests that lie: the node runs out of real CPU'), practicas: [2] },
  ],
},
// ============================================================================ 5
{
  id: 'INC-8116', clave: 'svc-selector', tipo: 'incidente', nivel: 2, area: T('Services · Endpoints', 'Services · Endpoints'), funciones: ['despliegue', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Atención al cliente', 'Customer support'),
  asunto: T('Nadie puede pagar: el checkout devuelve 502', 'Nobody can pay: checkout returns 502'),
  cuerpo: [T('Desde hace un cuarto de hora todos los pagos fallan con «502 Bad Gateway». Los pods de api-pagos están todos Running y 1/1, eso dice el equipo de pagos.', 'For the last quarter of an hour every payment has failed with "502 Bad Gateway". The api-pagos pods are all Running and 1/1, says the payments team.'),
    T('Lo único que ha cambiado hoy: Iván estaba preparando el «refactor de etiquetas» de los manifiestos.', 'The only thing that changed today: Iván was preparing the manifests\' "labels refactor".')],
  inicio: -18, abierto: -6,
  aplicar(st) {
    st.k8s.svcs['pagos/api-pagos'].selector = { app: 'api-pagos', tier: 'backend' };
    K.simular(st, -18, 0);
  },
  objetivo(st) {
    const s = st.k8s.svcs['pagos/api-pagos'], eps = K.endpoints(st, s);
    return (eps.length < 3 ? [T('El Service api-pagos tiene ' + eps.length + ' endpoints', 'The api-pagos Service has ' + eps.length + ' endpoints')] : []).concat(sinDeriva(st, ['api-pagos/service.yaml', 'api-pagos/deployment.yaml']));
  },
  practicas: [
    { t: T('Miraste los endpoints del Service antes de tocar nada', 'You looked at the Service\'s endpoints before touching anything'), ok: st => antes(st, /kubectl (get (endpoints|ep)|describe (svc|service))/, CAMBIA) },
    { t: T('Comparaste el selector con las etiquetas de los pods', 'You compared the selector with the pods\' labels'), ok: st => usado(st, /--show-labels|get pods .*-l /) },
    { t: T('Comprobaste el pago desde fuera después del arreglo', 'You checked the payment from outside after the fix'), ok: st => despues(st, /curl .*checkout\.pagos\.example/, /kubectl (apply|patch)/) },
  ],
  pistas: [
    T('Pods sanos y un 502: el tráfico no llega a ellos. Un Service manda tráfico a los pods que casan con su selector; los que casan son sus endpoints. kubectl get endpoints -n pagos.', 'Healthy pods and a 502: the traffic is not reaching them. A Service sends traffic to the pods that match its selector; those are its endpoints. kubectl get endpoints -n pagos.'),
    T('api-pagos no tiene endpoints. Compara el selector (kubectl describe svc api-pagos -n pagos) con las etiquetas de los pods (kubectl get pods -n pagos --show-labels).', 'api-pagos has no endpoints. Compare the selector (kubectl describe svc api-pagos -n pagos) with the pods\' labels (kubectl get pods -n pagos --show-labels).'),
    T('El selector pide tier=backend y ningún pod la tiene. El repositorio tiene el Service bueno: kubectl diff -f ~/k8s/api-pagos/service.yaml y kubectl apply -f ~/k8s/api-pagos/service.yaml. Después, curl -s ' + K.URL_PAGO, 'The selector asks for tier=backend and no pod has it. The repository has the right Service: kubectl diff -f ~/k8s/api-pagos/service.yaml and kubectl apply -f ~/k8s/api-pagos/service.yaml. Then curl -s ' + K.URL_PAGO),
  ],
  causa: T('Iván aplicó a mano el Service de su rama del «refactor de etiquetas», con el selector app=api-pagos,tier=backend, antes de que los pods llevaran la etiqueta tier. Un Service sin pods que casen se queda sin endpoints: web-checkout no tiene a quién pasar los pagos y el ingress devuelve 502. Los pods, mientras, perfectamente sanos.', 'Iván applied by hand the Service from his "labels refactor" branch, with the selector app=api-pagos,tier=backend, before the pods carried the tier label. A Service with no matching pods has no endpoints: web-checkout has nobody to pass payments to and the ingress returns 502. Meanwhile the pods were perfectly healthy.'),
  solucion: T('Service devuelto al del repositorio (selector app=api-pagos) con kubectl apply; tres endpoints y los pagos funcionando.', 'Service put back to the repository\'s (selector app=api-pagos) with kubectl apply; three endpoints and payments working.'),
  leccion: T('Que los pods estén Running y listos no significa que reciban tráfico: el Service los encuentra por etiquetas, y un selector que no casa con nada no da error, da cero endpoints. kubectl get endpoints es la primera pregunta cuando «todo está verde y nada funciona». Y un cambio a medio hacer de una rama no se aplica a producción a mano.', 'Pods being Running and ready does not mean they receive traffic: the Service finds them by labels, and a selector that matches nothing gives no error, it gives zero endpoints. kubectl get endpoints is the first question when "everything is green and nothing works". And a half-finished change from a branch is not applied to production by hand.'),
  guion: ['curl -s ' + K.URL_PAGO, 'kubectl get pods -n pagos', 'kubectl get endpoints -n pagos', 'kubectl describe svc api-pagos -n pagos', 'kubectl get pods -n pagos -l app=api-pagos --show-labels', 'kubectl diff -f ~/k8s/api-pagos/service.yaml', 'kubectl apply -f ~/k8s/api-pagos/service.yaml', 'kubectl get endpoints api-pagos -n pagos', 'curl -s ' + K.URL_PAGO, 'amtool alert'],
  trampas: [
    { cmds: ['kubectl rollout restart deployment/api-pagos -n pagos', 'kubectl rollout status deployment/api-pagos -n pagos'], porque: T('los pods nuevos tienen las mismas etiquetas: el Service sigue sin endpoints', 'the new pods have the same labels: the Service still has no endpoints') },
    { cmds: ['kubectl patch deployment api-pagos -n pagos -p \'{"spec":{"template":{"metadata":{"labels":{"tier":"backend"}}}}}\'', 'kubectl rollout status deployment/api-pagos -n pagos'], porque: T('los pagos vuelven, pero el Deployment ya no coincide con el repositorio: el próximo apply lo deshará', 'payments come back, but the Deployment no longer matches the repository: the next apply will undo it') },
  ],
},
// ============================================================================ 6
{
  id: 'REQ-8120', clave: 'readiness-ruta', tipo: 'peticion', nivel: 2, area: T('Despliegues · Sondas', 'Deployments · Probes'), funciones: ['despliegue'],
  impacto: 'medio', urgencia: 'media', de: T('Equipo de frontal (Laura Méndez)', 'Front-end team (Laura Méndez)'),
  asunto: T('Desplegar web-checkout 1.9.0: el rollout se ha quedado colgado', 'Deploy web-checkout 1.9.0: the rollout is stuck'),
  cuerpo: [T('He lanzado la 1.9.0 de web-checkout con kubectl set image y lleva más de media hora con un pod 0/1. La web sigue en la 1.8.3 y funciona. La imagen está en el registro, la he comprobado.', 'I launched web-checkout 1.9.0 with kubectl set image and it has had a pod at 0/1 for over half an hour. The site is still on 1.8.3 and works. The image is in the registry, I checked.'),
    T('La release está aprobada y el PR con el manifiesto ya está fusionado en ~/k8s.', 'The release is approved and the PR with the manifest is already merged in ~/k8s.')],
  inicio: -35, abierto: -20,
  aplicar(st) {
    const d = dep(st, 'web-checkout'), repo = st.k8s.repo['web-checkout/deployment.yaml'];
    repo.tpl.imagen = K.REGISTRO + '/web-checkout:1.9.0'; repo.tpl.ready.path = '/ready';
    st.k8s.notas = Object.assign({}, st.k8s.notas, { 'web-checkout/CHANGELOG.md': ['# web-checkout', '', '## 1.9.0', T('- Pago con un clic para clientes recurrentes.', '- One-click payment for returning customers.'), T('- BREAKING: el endpoint de salud pasa de /health a /ready (y /health desaparece). Actualizad la readinessProbe.', '- BREAKING: the health endpoint moves from /health to /ready (and /health is gone). Update the readinessProbe.'), '', '## 1.8.3', T('- Corrige el redondeo del IVA en carritos con descuento.', '- Fixes VAT rounding on discounted carts.')] });
    const tpl = K.copia(d.tpl); tpl.imagen = K.REGISTRO + '/web-checkout:1.9.0';
    K.cambiarPlantilla(st, d, tpl, '<none>', -35);
    K.simular(st, -35, 0);
  },
  objetivo(st) {
    const d = dep(st, 'web-checkout'), tag = K.partesImagen(d.tpl.imagen).tag;
    return (tag !== '1.9.0' ? [T('web-checkout no está en la 1.9.0 (plantilla con ' + tag + ')', 'web-checkout is not on 1.9.0 (template has ' + tag + ')')] : []).concat(desplegado(st, 'web-checkout'), sinDeriva(st, ['web-checkout/deployment.yaml']));
  },
  practicas: [
    { t: T('Leíste por qué el pod nuevo no está listo (describe pod) antes de cambiar nada', 'You read why the new pod is not ready (describe pod) before changing anything'), ok: st => antes(st, /kubectl (describe pod|get events)/, CAMBIA) },
    { t: T('Leíste el CHANGELOG de la versión', 'You read the release\'s CHANGELOG'), ok: st => usado(st, /CHANGELOG/) },
    { t: T('Miraste la diferencia con el repositorio antes de aplicar', 'You looked at the difference with the repository before applying'), ok: st => antes(st, /kubectl diff/, /kubectl (apply|patch)/) },
    { t: T('Esperaste a que terminara el rollout', 'You waited for the rollout to finish'), ok: st => despues(st, /rollout status/, /kubectl (apply|patch)/) },
  ],
  pistas: [
    T('Un pod Running pero 0/1 está vivo y no pasa su readiness probe: no recibe tráfico, y el rollout no sigue hasta que esté listo. kubectl describe pod POD -n pagos: Readiness y los eventos.', 'A pod that is Running but 0/1 is alive and failing its readiness probe: it gets no traffic, and the rollout does not continue until it is ready. kubectl describe pod POD -n pagos: Readiness and the events.'),
    T('«Readiness probe failed: HTTP probe failed with statuscode: 404»: la sonda pide una ruta que la 1.9.0 ya no sirve. ¿Qué cambió en esta versión? cat ~/k8s/web-checkout/CHANGELOG.md', '"Readiness probe failed: HTTP probe failed with statuscode: 404": the probe asks for a path that 1.9.0 no longer serves. What changed in this release? cat ~/k8s/web-checkout/CHANGELOG.md'),
    T('kubectl set image sólo cambió la imagen; el manifiesto del PR cambia también la sonda. kubectl diff -f ~/k8s/web-checkout/deployment.yaml, kubectl apply -f ~/k8s/web-checkout/deployment.yaml y kubectl rollout status deployment/web-checkout -n pagos.', 'kubectl set image only changed the image; the PR\'s manifest also changes the probe. kubectl diff -f ~/k8s/web-checkout/deployment.yaml, kubectl apply -f ~/k8s/web-checkout/deployment.yaml and kubectl rollout status deployment/web-checkout -n pagos.'),
  ],
  causa: T('La 1.9.0 movió el endpoint de salud de /health a /ready. kubectl set image cambió sólo la imagen, así que el pod nuevo seguía con la readinessProbe en /health: 404, nunca listo. El rolling update no retira los pods viejos hasta que el nuevo está listo, y se quedó esperando (ProgressDeadlineExceeded).', '1.9.0 moved the health endpoint from /health to /ready. kubectl set image changed only the image, so the new pod still had its readinessProbe on /health: 404, never ready. The rolling update does not retire the old pods until the new one is ready, and it was left waiting (ProgressDeadlineExceeded).'),
  solucion: T('Desplegado el manifiesto del repositorio (imagen 1.9.0 y sonda en /ready); rollout terminado, web-checkout 2/2 en la 1.9.0.', 'The repository\'s manifest deployed (image 1.9.0 and probe on /ready); rollout finished, web-checkout 2/2 on 1.9.0.'),
  leccion: T('Una versión no es sólo una imagen: trae su contrato (puertos, sondas, variables). Desplegar con set image se salta ese contrato; desplegar el manifiesto de la versión, no. Y una readiness probe que falla es un seguro, no una avería: gracias a ella la 1.8.3 siguió sirviendo mientras la 1.9.0 no estaba lista.', 'A release is not just an image: it brings its contract (ports, probes, variables). Deploying with set image skips that contract; deploying the release\'s manifest does not. And a failing readiness probe is a safety net, not a fault: thanks to it 1.8.3 kept serving while 1.9.0 was not ready.'),
  guion: st => { const p = K.podsDe(st, dep(st, 'web-checkout')).find(x => !K.listo(st, x)); return ['kubectl get pods -n pagos -l app=web-checkout', 'kubectl describe pod ' + p.nombre + ' -n pagos', 'kubectl logs ' + p.nombre + ' -n pagos --tail 5', 'cat ~/k8s/web-checkout/CHANGELOG.md', 'kubectl diff -f ~/k8s/web-checkout/deployment.yaml', 'kubectl apply -f ~/k8s/web-checkout/deployment.yaml', 'kubectl rollout status deployment/web-checkout -n pagos', 'amtool alert']; },
  trampas: [
    { cmds: ['kubectl rollout undo deployment/web-checkout -n pagos', 'kubectl rollout status deployment/web-checkout -n pagos'], porque: T('vuelve a la 1.8.3: deja de estar atascado, pero la 1.9.0 no sale', 'it goes back to 1.8.3: it is no longer stuck, but 1.9.0 does not ship') },
    { cmds: ['kubectl patch deployment web-checkout -n pagos --type json -p \'[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe"}]\'', 'kubectl rollout status deployment/web-checkout -n pagos'], porque: T('sin sonda el rollout termina, pero el manifiesto ya no es el del repositorio y los pods reciben tráfico sin comprobar que están listos', 'without a probe the rollout finishes, but the manifest is no longer the repository\'s and the pods get traffic without checking they are ready') },
  ],
},
];

// ------------------------------------------------------------------ uso
P.normalizarEscenario = e => {
  e.averias = e.averias || [];
  e.resuelto = st => (e.objetivo ? e.objetivo(st, P) : []).concat(alertas(st));
  return e;
};
P.escenarios.forEach(P.normalizarEscenario);
P.importadas = P.importadas || [];
P.escenario = id => P.escenarios.concat(P.importadas).find(e => e.id === id || e.clave === id);
P.preparar = function (e) {
  const st = P.crear();
  if (e) { st.inicioFallo = e.inicio || 0; e.aplicar(st, P); st.alertasDesde = {}; P.refrescarAlertas(st); }
  return st;
};
P.evaluar = function (st, e) {
  return { pendientes: e.resuelto(st, P), practicas: e.practicas.map(x => ({ t: x.t, ok: !!x.ok(st) })) };
};
P.guionDe = (e, st) => typeof e.guion === 'function' ? e.guion(st) : e.guion;
})(window.PUESTO = window.PUESTO || {});
