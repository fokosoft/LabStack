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
const crash = (st, n) => K.podsDe(st, dep(st, n)).find(p => p.c.razon === 'CrashLoopBackOff');
const conRaiz = 'kubectl (apply|patch|set|delete|create|rollout (undo|restart)|scale|uncordon|cordon|drain)|helm (upgrade|rollback)';
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
  averias: [{ tipo: 'configmap-clave', clave: 'PASARELA_URL', nueva: 'PAYMENT_GATEWAY_URL', hace: 900 }, { tipo: 'reinicio-nodo', nodo: 'worker-02', hace: 52 }],
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
  averias: [{ tipo: 'despliegue-a-mano', app: 'api-pagos', version: 'v2.15.0', tecleada: '2.15.0', hace: 40 }],
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
  averias: [{ tipo: 'limite-memoria', app: 'antifraude', limite: 512, hace: 95 }],
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
  averias: [{ tipo: 'cordon-olvidado', nodo: 'worker-03', hace: 1020 }, { tipo: 'escalado', app: 'liquidaciones', replicas: 4, hace: 30 }],
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
  averias: [{ tipo: 'selector-roto', svc: 'api-pagos', etiqueta: 'tier=backend', hace: 18 }],
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
  averias: [{ tipo: 'despliegue-a-mano', app: 'web-checkout', version: '1.9.0', tecleada: '1.9.0', hace: 35 }],
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
// ============================================================================ 7 · fase 2
{
  id: 'INC-8124', clave: 'pvc-lleno', tipo: 'incidente', nivel: 2, area: T('Almacenamiento · PVC', 'Storage · PVC'), funciones: ['cluster', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Equipo de pagos (Raúl Ortega)', 'Payments team (Raúl Ortega)'),
  asunto: T('Grafana sin datos desde hace hora y media: Prometheus no arranca', 'Grafana has had no data for an hour and a half: Prometheus does not start'),
  cuerpo: [T('Todos los paneles de Grafana están vacíos desde las 07:40. Sin métricas no vemos los pagos, y la campaña de esta tarde va a ciegas.', 'Every Grafana dashboard has been empty since 07:40. Without metrics we cannot see payments, and this afternoon\'s campaign is flying blind.'),
    T('Ayer se fusionó un PR de Iván para «ampliar el volumen de Prometheus». No sé si se llegó a aplicar.', 'Yesterday a PR from Iván to "grow Prometheus\' volume" was merged. I do not know whether it was ever applied.')],
  inicio: -95, abierto: -25,
  averias: [{ tipo: 'pvc-lleno', nuevo: 100, hace: 95 }],
  practicas: [
    { t: T('Leíste por qué muere Prometheus (logs --previous) antes de tocar nada', 'You read why Prometheus dies (logs --previous) before touching anything'), ok: st => antes(st, /kubectl logs .*(--previous|-p\b)/, CAMBIA) },
    { t: T('Comprobaste que la StorageClass permite ampliar volúmenes antes de pedirlo', 'You checked that the StorageClass allows volume expansion before asking for it'), ok: st => antes(st, /kubectl (get|describe) (sc|storageclass)/, /kubectl apply/) },
    { t: T('Miraste la diferencia con el repositorio antes de aplicar', 'You looked at the difference with the repository before applying'), ok: st => antes(st, /kubectl diff/, /kubectl apply/) },
    { t: T('Comprobaste el volumen y Prometheus después del cambio', 'You checked the volume and Prometheus after the change'), ok: st => despues(st, /kubectl (get pvc|describe pvc|rollout status|get pods)/, /kubectl apply/) },
  ],
  pistas: [
    T('Prometheus está en CrashLoopBackOff en el namespace monitoring. Lo que dijo antes de morir: kubectl logs POD -n monitoring --previous.', 'Prometheus is in CrashLoopBackOff in the monitoring namespace. What it said before dying: kubectl logs POD -n monitoring --previous.'),
    T('«no space left on device»: su volumen está lleno. kubectl get pvc -n monitoring dice su tamaño; kubectl get sc, si se puede ampliar. Y en el repositorio, ¿qué tamaño pide? (cd ~/k8s y git log --oneline)', '"no space left on device": its volume is full. kubectl get pvc -n monitoring tells you its size; kubectl get sc, whether it can grow. And in the repository, what size does it ask for? (cd ~/k8s and git log --oneline)'),
    T('El PR está fusionado pero no aplicado: kubectl diff -f ~/k8s/monitoring/prometheus-pvc.yaml y kubectl apply -f ~/k8s/monitoring/prometheus-pvc.yaml. Longhorn amplía en caliente; luego borra el pod para que arranque ya (kubectl delete pod POD -n monitoring).', 'The PR is merged but not applied: kubectl diff -f ~/k8s/monitoring/prometheus-pvc.yaml and kubectl apply -f ~/k8s/monitoring/prometheus-pvc.yaml. Longhorn grows it online; then delete the pod so it starts right away (kubectl delete pod POD -n monitoring).'),
  ],
  causa: T('El volumen de 50Gi de Prometheus se llenó: el WAL no pudo escribir («no space left on device») y Prometheus muere al arrancar. El PR que lo ampliaba a 100Gi se fusionó ayer, pero nadie lo aplicó al clúster: el repositorio decía una cosa y el clúster otra.', 'Prometheus\' 50Gi volume filled up: the WAL could not write ("no space left on device") and Prometheus dies at startup. The PR that grew it to 100Gi was merged yesterday, but nobody applied it to the cluster: the repository said one thing and the cluster another.'),
  solucion: T('Aplicado el PVC del repositorio (100Gi); Longhorn amplió el volumen en caliente, Prometheus arrancó y volvieron los datos a Grafana.', 'The repository\'s PVC applied (100Gi); Longhorn grew the volume online, Prometheus started and the data came back to Grafana.'),
  leccion: T('Un PVC se puede ampliar (si su StorageClass lo permite) pero nunca encoger, y se amplía cambiando lo que pide, no tocando el disco. Y un PR fusionado no es un cambio hecho: hasta que alguien lo aplica (o lo aplica una herramienta de GitOps), sólo existe en el repositorio.', 'A PVC can be grown (if its StorageClass allows it) but never shrunk, and you grow it by changing what it requests, not by touching the disk. And a merged PR is not a change made: until someone applies it (or a GitOps tool does), it only exists in the repository.'),
  guion: st => { const p = K.podsDe(st, st.k8s.deps['monitoring/prometheus'])[0]; return ['amtool alert', 'kubectl get pods -n monitoring', 'kubectl logs ' + p.nombre + ' -n monitoring --previous', 'kubectl get pvc -n monitoring', 'kubectl get sc', 'cd ~/k8s', 'git log --oneline', 'cd', 'kubectl diff -f ~/k8s/monitoring/prometheus-pvc.yaml', 'kubectl apply -f ~/k8s/monitoring/prometheus-pvc.yaml', 'kubectl describe pvc prometheus-data -n monitoring', 'kubectl delete pod ' + p.nombre + ' -n monitoring', 'kubectl rollout status deployment/prometheus -n monitoring', 'amtool alert']; },
  trampas: [
    { cmds: st => ['kubectl delete pod ' + K.podsDe(st, st.k8s.deps['monitoring/prometheus'])[0].nombre + ' -n monitoring', 'sleep 120'], porque: T('el pod nuevo monta el mismo volumen lleno y vuelve a morir', 'the new pod mounts the same full volume and dies again') },
    { cmds: ['kubectl scale deployment/prometheus -n monitoring --replicas=0'], porque: T('sin Prometheus no hay CrashLoop, pero tampoco métricas, y el volumen sigue lleno', 'without Prometheus there is no CrashLoop, but no metrics either, and the volume is still full') },
  ],
},
// ============================================================================ 8
{
  id: 'INC-8128', clave: 'cert-caducado', tipo: 'incidente', nivel: 2, area: T('Ingress · Certificados', 'Ingress · Certificates'), funciones: ['seg', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Atención al cliente', 'Customer support'),
  asunto: T('«La conexión no es privada» al ir a pagar', '"Your connection is not private" when going to pay'),
  cuerpo: [T('Desde hace una hora y media los clientes ven un aviso de seguridad del navegador al abrir el checkout. Casi nadie se atreve a seguir y las ventas se han desplomado.', 'For the last hour and a half customers have seen a browser security warning when they open the checkout. Hardly anyone dares to continue and sales have collapsed.'),
    T('El certificado se renueva solo con cert-manager, nos dijeron. Nadie ha tocado nada esta semana.', 'The certificate renews itself with cert-manager, we were told. Nobody has touched anything this week.')],
  inicio: -95, abierto: -8,
  averias: [{ tipo: 'cert-emisor', viejo: 'letsencrypt-production', hace: 95 }],
  practicas: [
    { t: T('Miraste las fechas del certificado (curl -v o describe certificate) antes de cambiar nada', 'You looked at the certificate dates (curl -v or describe certificate) before changing anything'), ok: st => antes(st, /curl .*-[a-z]*v|kubectl describe (certificate|cert)\b/, CAMBIA) },
    { t: T('Comprobaste qué ClusterIssuers existen', 'You checked which ClusterIssuers exist'), ok: st => antes(st, /kubectl (get|describe) clusterissuer/, CAMBIA) },
    { t: T('Miraste la diferencia con el repositorio antes de aplicar', 'You looked at the difference with the repository before applying'), ok: st => antes(st, /kubectl diff/, /kubectl apply/) },
    { t: T('Comprobaste desde fuera, con curl, que el checkout vuelve a ir', 'You checked from outside, with curl, that the checkout works again'), ok: st => despues(st, /curl .*checkout\.pagos\.example/, /kubectl apply/) },
  ],
  pistas: [
    T('Reproduce lo que ve el cliente con detalle: curl -sv ' + K.URL_PAGO + '. ¿Qué dice del certificado? Luego kubectl get certificate -n pagos.', 'Reproduce what the customer sees, in detail: curl -sv ' + K.URL_PAGO + '. What does it say about the certificate? Then kubectl get certificate -n pagos.'),
    T('Caducado y sin renovar. ¿Por qué no lo renovó cert-manager? kubectl describe certificate checkout-tls -n pagos te lleva a su CertificateRequest; descríbela. ¿Existe el ClusterIssuer que pide? kubectl get clusterissuer', 'Expired and not renewed. Why did cert-manager not renew it? kubectl describe certificate checkout-tls -n pagos leads you to its CertificateRequest; describe it. Does the ClusterIssuer it asks for exist? kubectl get clusterissuer'),
    T('El Certificate apunta a letsencrypt-production, que ya no existe; el repositorio ya dice letsencrypt-prod. kubectl diff -f ~/k8s/web-checkout/certificate.yaml y kubectl apply -f ~/k8s/web-checkout/certificate.yaml. cert-manager lo emite en un minuto: compruébalo con curl.', 'The Certificate points at letsencrypt-production, which no longer exists; the repository already says letsencrypt-prod. kubectl diff -f ~/k8s/web-checkout/certificate.yaml and kubectl apply -f ~/k8s/web-checkout/certificate.yaml. cert-manager issues it within a minute: check it with curl.'),
  ],
  causa: T('Hace un mes se unificaron los ClusterIssuers: desapareció letsencrypt-production y quedó letsencrypt-prod. El repositorio se actualizó, pero el Certificate del clúster siguió apuntando al viejo. Cuando llegó la hora de renovar (30 días antes de caducar), cert-manager no encontró el emisor y lo reintentó en silencio un mes entero; la alerta de «caduca pronto» se ignoró, y hoy el certificado caducó.', 'A month ago the ClusterIssuers were unified: letsencrypt-production disappeared and letsencrypt-prod remained. The repository was updated, but the Certificate in the cluster kept pointing at the old one. When renewal time came (30 days before expiry), cert-manager could not find the issuer and retried silently for a whole month; the "expires soon" alert was ignored, and today the certificate expired.'),
  solucion: T('Certificate aplicado desde el repositorio (issuerRef letsencrypt-prod); cert-manager emitió uno nuevo y el checkout volvió a cargar sin avisos.', 'Certificate applied from the repository (issuerRef letsencrypt-prod); cert-manager issued a new one and the checkout loaded again without warnings.'),
  leccion: T('La renovación automática también falla, y falla en silencio: por eso existe la alerta de «caduca pronto», y hay que atenderla. Un certificado caducado se diagnostica de fuera hacia dentro: lo que ve el cliente (curl -v), el Certificate, su CertificateRequest y el emisor. Y borrar el Secret no lo arregla: si el emisor no existe, te quedas con el certificado de pega del ingress.', 'Automatic renewal also fails, and it fails silently: that is why the "expires soon" alert exists, and it must be attended to. An expired certificate is diagnosed from the outside in: what the customer sees (curl -v), the Certificate, its CertificateRequest and the issuer. And deleting the Secret does not fix it: if the issuer does not exist, you are left with the ingress\' fake certificate.'),
  guion: st => { const c = st.k8s.certs['pagos/checkout-tls']; return ['curl -sv ' + K.URL_PAGO, 'kubectl get certificate -n pagos', 'kubectl describe certificate checkout-tls -n pagos', 'kubectl describe certificaterequest checkout-tls-' + c.peticiones + ' -n pagos', 'kubectl get clusterissuer', 'kubectl diff -f ~/k8s/web-checkout/certificate.yaml', 'kubectl apply -f ~/k8s/web-checkout/certificate.yaml', 'kubectl get certificate -n pagos', 'curl -s ' + K.URL_PAGO, 'amtool alert']; },
  trampas: [
    { cmds: ['kubectl delete secret checkout-tls -n pagos', 'sleep 60', 'curl -s ' + K.URL_PAGO], porque: T('sin emisor no se emite otro: el ingress pasa a servir su certificado de pega', 'with no issuer nothing new is issued: the ingress falls back to its fake certificate') },
    { cmds: ['kubectl rollout restart deployment/ingress-nginx-controller -n ingress-nginx', 'kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx'], porque: T('el controlador vuelve a leer el mismo Secret caducado', 'the controller reads the same expired Secret again') },
  ],
},
// ============================================================================ 9
{
  id: 'INC-8132', clave: 'hpa-maximo', tipo: 'incidente', nivel: 2, area: T('Escalado · HPA', 'Scaling · HPA'), funciones: ['cluster', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Alertmanager (guardia)', 'Alertmanager (on call)'),
  asunto: T('Campaña de otoño: los pagos tardan segundos y la HPA no escala', 'Autumn campaign: payments take seconds and the HPA does not scale'),
  cuerpo: [T('La campaña empezó hace 40 minutos y el tráfico se ha triplicado. api-pagos tarda segundos en contestar y los clientes abandonan.', 'The campaign started 40 minutes ago and traffic has tripled. api-pagos takes seconds to answer and customers are giving up.'),
    T('Para eso tenemos la HPA, ¿no? Pues api-pagos sigue con 3 pods.', 'That is what the HPA is for, right? Well, api-pagos is still on 3 pods.')],
  inicio: -40, abierto: -6,
  averias: [{ tipo: 'hpa-techo', max: 3, carga: 650, hace: 40 }],
  practicas: [
    { t: T('Miraste por qué no escala la HPA (describe hpa) antes de cambiar nada', 'You looked at why the HPA does not scale (describe hpa) before changing anything'), ok: st => antes(st, /kubectl describe (hpa|horizontalpodautoscaler)/, CAMBIA) },
    { t: T('Miraste el consumo real de los pods (kubectl top)', 'You looked at the pods\' real usage (kubectl top)'), ok: st => usado(st, /kubectl top pod/) },
    { t: T('No escalaste a mano: la HPA lo deshace al minuto', 'You did not scale by hand: the HPA undoes it within a minute'), ok: st => !usado(st, /kubectl scale .*api-pagos/) },
    { t: T('Comprobaste que escala y que la latencia baja', 'You checked that it scales and that latency comes down'), ok: st => despues(st, /kubectl (get hpa|rollout status|get pods)|amtool/, /kubectl apply/) },
  ],
  pistas: [
    T('kubectl get hpa -n pagos: ¿qué utilización tiene, cuántas réplicas, y cuál es su máximo?', 'kubectl get hpa -n pagos: what utilisation does it have, how many replicas, and what is its maximum?'),
    T('kubectl describe hpa api-pagos -n pagos: «ScalingLimited True TooManyReplicas». Quiere más pods, pero su máximo es 3. ¿Qué máximo dice el repositorio? kubectl diff -f ~/k8s/api-pagos/hpa.yaml', 'kubectl describe hpa api-pagos -n pagos: "ScalingLimited True TooManyReplicas". It wants more pods, but its maximum is 3. What maximum does the repository say? kubectl diff -f ~/k8s/api-pagos/hpa.yaml'),
    T('Alguien bajó el máximo a mano. kubectl apply -f ~/k8s/api-pagos/hpa.yaml devuelve el 12 y la HPA escala sola en el siguiente minuto; kubectl rollout status deployment/api-pagos -n pagos espera a que estén listos.', 'Someone lowered the maximum by hand. kubectl apply -f ~/k8s/api-pagos/hpa.yaml brings back the 12 and the HPA scales by itself the next minute; kubectl rollout status deployment/api-pagos -n pagos waits until they are ready.'),
  ],
  causa: T('Durante la auditoría PCI de hace dos semanas alguien congeló la HPA de api-pagos bajando su máximo a 3 (kubectl patch) y no lo devolvió. Con el tráfico de la campaña la CPU pasa del 150 % de lo pedido: la HPA quiere 6 pods, pero su techo es 3, y cada pod atiende el doble de lo que puede.', 'During the PCI audit two weeks ago someone froze api-pagos\' HPA by lowering its maximum to 3 (kubectl patch) and never put it back. With the campaign traffic CPU goes above 150% of the request: the HPA wants 6 pods, but its ceiling is 3, and each pod handles twice what it can.'),
  solucion: T('HPA devuelta a lo que dice el repositorio (máximo 12); escaló a 6 pods, la CPU bajó del 70 % y la latencia volvió a la normalidad.', 'HPA put back to what the repository says (maximum 12); it scaled to 6 pods, CPU dropped below 70% and latency went back to normal.'),
  leccion: T('Una HPA no escala más allá de su máximo, y lo dice en describe (ScalingLimited) y en KubeHpaMaxedOut. Con HPA, kubectl scale no sirve: la HPA es la dueña de las réplicas y deshace el cambio en un minuto. Y escala sobre los requests: sin request de CPU, ni siquiera sabe calcular.', 'An HPA does not scale beyond its maximum, and it says so in describe (ScalingLimited) and in KubeHpaMaxedOut. With an HPA, kubectl scale does not help: the HPA owns the replicas and undoes the change within a minute. And it scales on the requests: without a CPU request it cannot even compute.'),
  guion: ['amtool alert', 'kubectl get hpa -n pagos', 'kubectl describe hpa api-pagos -n pagos', 'kubectl top pod -n pagos -l app=api-pagos', 'kubectl diff -f ~/k8s/api-pagos/hpa.yaml', 'kubectl apply -f ~/k8s/api-pagos/hpa.yaml', 'kubectl rollout status deployment/api-pagos -n pagos', 'kubectl get hpa -n pagos', 'amtool alert'],
  trampas: [
    { cmds: ['kubectl scale deployment/api-pagos -n pagos --replicas=8', 'sleep 120'], porque: T('la HPA, con su máximo de 3, vuelve a bajarlo al minuto', 'the HPA, with its maximum of 3, brings it back down within a minute') },
    { cmds: ['kubectl delete hpa api-pagos -n pagos', 'kubectl scale deployment/api-pagos -n pagos --replicas=8', 'kubectl rollout status deployment/api-pagos -n pagos'], porque: T('va rápido, pero sin HPA: cuando acabe la campaña nadie bajará esos pods, y el repositorio dice otra cosa', 'it is fast, but with no HPA: when the campaign ends nobody will scale those pods down, and the repository says otherwise') },
  ],
},
// ============================================================================ 10
{
  id: 'REQ-8136', clave: 'rbac-ci', tipo: 'peticion', nivel: 2, area: 'RBAC · CI/CD', funciones: ['cicd', 'seg'],
  impacto: 'medio', urgencia: 'media', de: T('Equipo de frontal (Laura Méndez)', 'Front-end team (Laura Méndez)'),
  asunto: T('El pipeline no puede desplegar web-checkout: «Forbidden»', 'The pipeline cannot deploy web-checkout: "Forbidden"'),
  cuerpo: [T('Desde ayer el paso de despliegue de nuestro pipeline falla con un Forbidden. No hemos cambiado nada del pipeline. Os dejo el log del último intento en ~/ci/.', 'Since yesterday our pipeline\'s deploy step fails with a Forbidden. We have not changed anything in the pipeline. I have left the log of the last attempt in ~/ci/.'),
    T('Plataforma movió ayer los runners de CI a otro namespace; no sé si tiene que ver.', 'Platform moved the CI runners to another namespace yesterday; not sure whether that is related.')],
  inicio: -1300, abierto: -40,
  averias: [{ tipo: 'rbac-sujeto', viejo: 'cicd', hace: 1300 }],
  practicas: [
    { t: T('Leíste el log del pipeline antes de tocar nada', 'You read the pipeline log before touching anything'), ok: st => antes(st, /(cat|less|tail|head|grep) .*ci\//, CAMBIA) },
    { t: T('Reprodujiste el permiso con kubectl auth can-i --as antes del cambio', 'You reproduced the permission with kubectl auth can-i --as before the change'), ok: st => antes(st, /auth can-i .*--as/, CAMBIA) },
    { t: T('Lo comprobaste con kubectl auth can-i después', 'You checked it with kubectl auth can-i afterwards'), ok: st => despues(st, /auth can-i .*--as/, /kubectl (apply|create)/) },
    { t: T('Mínimo privilegio: no creaste bindings nuevos a mano', 'Least privilege: you did not create new bindings by hand'), ok: st => !usado(st, /kubectl create (cluster)?rolebinding/) },
  ],
  pistas: [
    T('El log está en ~/ci/. Fíjate en quién pide el permiso (User "system:serviceaccount:...") y qué le falta. Reprodúcelo: kubectl auth can-i patch deployments -n pagos --as=system:serviceaccount:ci:deployer', 'The log is in ~/ci/. Look at who is asking (User "system:serviceaccount:...") and what is missing. Reproduce it: kubectl auth can-i patch deployments -n pagos --as=system:serviceaccount:ci:deployer'),
    T('¿Quién tiene permiso de desplegar en pagos? kubectl get rolebinding -n pagos -o wide y kubectl describe rolebinding deployer-desplegador -n pagos. Mira el namespace de la ServiceAccount.', 'Who is allowed to deploy in pagos? kubectl get rolebinding -n pagos -o wide and kubectl describe rolebinding deployer-desplegador -n pagos. Look at the ServiceAccount\'s namespace.'),
    T('El binding sigue apuntando a cicd:deployer; los runners ya son ci:deployer y el repositorio ya lo dice (cd ~/k8s, git log --oneline). kubectl diff -f ~/k8s/rbac/deployer-rolebinding.yaml, kubectl apply -f y vuelve a preguntar con auth can-i.', 'The binding still points at cicd:deployer; the runners are now ci:deployer and the repository already says so (cd ~/k8s, git log --oneline). kubectl diff -f ~/k8s/rbac/deployer-rolebinding.yaml, kubectl apply -f and ask again with auth can-i.'),
  ],
  causa: T('Al mover los runners de CI del namespace cicd a ci, la ServiceAccount que usa el pipeline pasó a ser ci:deployer. El RoleBinding de pagos seguía dando el Role desplegador a cicd:deployer, que ya no existe. RBAC sólo suma permisos: lo que nadie concede está denegado, y el despliegue falla con Forbidden.', 'When the CI runners moved from the cicd namespace to ci, the ServiceAccount the pipeline uses became ci:deployer. The RoleBinding in pagos still granted the desplegador Role to cicd:deployer, which no longer exists. RBAC only adds permissions: whatever nobody grants is denied, and the deployment fails with Forbidden.'),
  solucion: T('RoleBinding aplicado desde el repositorio (sujeto ci:deployer); auth can-i confirma que el pipeline puede hacer patch de deployments en pagos, y nada más.', 'RoleBinding applied from the repository (subject ci:deployer); auth can-i confirms the pipeline can patch deployments in pagos, and nothing else.'),
  leccion: T('Un Forbidden te dice exactamente quién, qué verbo, qué recurso y en qué namespace: con eso y kubectl auth can-i --as reproduces el problema sin tocar el pipeline. La tentación es darle cluster-admin «para que funcione»; el arreglo es el binding justo, el que dice el repositorio.', 'A Forbidden tells you exactly who, which verb, which resource and in which namespace: with that and kubectl auth can-i --as you reproduce the problem without touching the pipeline. The temptation is to grant cluster-admin "so it works"; the fix is the exact binding, the one the repository says.'),
  guion: ['cat ~/ci/web-checkout-1.9.0.log', 'kubectl auth can-i patch deployments -n pagos --as=system:serviceaccount:ci:deployer', 'kubectl get rolebinding -n pagos -o wide', 'kubectl describe rolebinding deployer-desplegador -n pagos', 'kubectl get sa -n ci', 'cd ~/k8s', 'git log --oneline', 'cd', 'kubectl diff -f ~/k8s/rbac/deployer-rolebinding.yaml', 'kubectl apply -f ~/k8s/rbac/deployer-rolebinding.yaml', 'kubectl auth can-i patch deployments -n pagos --as=system:serviceaccount:ci:deployer', 'kubectl auth can-i get secrets -n pagos --as=system:serviceaccount:ci:deployer'],
  trampas: [
    { cmds: ['kubectl create clusterrolebinding deployer-admin --clusterrole=cluster-admin --serviceaccount=ci:deployer'], porque: T('el pipeline despliega, pero ahora puede hacer cualquier cosa en todo el clúster', 'the pipeline deploys, but now it can do anything in the whole cluster') },
    { cmds: ['kubectl create rolebinding deployer-edit --clusterrole=edit --serviceaccount=ci:deployer -n pagos'], porque: T('funciona, pero edit también le deja leer los Secrets de pagos', 'it works, but edit also lets it read the Secrets in pagos') },
  ],
},
// ============================================================================ 11
{
  id: 'INC-8140', clave: 'netpol-puerto', tipo: 'incidente', nivel: 3, area: T('Red · NetworkPolicies', 'Network · NetworkPolicies'), funciones: ['seg', 'incid'],
  impacto: 'alto', urgencia: 'media', de: T('Equipo de fraude (Marta Gil)', 'Fraud team (Marta Gil)'),
  asunto: T('Todos los pagos caen en revisión manual desde las 08:30', 'Every payment has been going to manual review since 08:30'),
  cuerpo: [T('Desde las 08:30 ningún pago pasa por antifraude: todos acaban en nuestra cola de revisión manual, que ya va por cientos. antifraude está arriba, sus pods están 1/1.', 'Since 08:30 no payment goes through antifraude: they all end up in our manual review queue, which is already in the hundreds. antifraude is up, its pods are 1/1.'),
    T('Seguridad está preparando la versión 3.4 de antifraude, que irá con TLS. Esta mañana estuvieron haciendo pruebas.', 'Security is preparing antifraude 3.4, which will run with TLS. This morning they were running some tests.')],
  inicio: -42, abierto: -20,
  averias: [{ tipo: 'netpol-puerto', pol: 'permitir-api-a-antifraude', puerto: 8443, hace: 42 }],
  practicas: [
    { t: T('Reprodujiste la llamada desde dentro de api-pagos antes de cambiar nada', 'You reproduced the call from inside api-pagos before changing anything'), ok: st => antes(st, /kubectl exec .*(curl|wget) .*antifraude/, CAMBIA) },
    { t: T('Leíste las NetworkPolicies de pagos', 'You read the NetworkPolicies in pagos'), ok: st => antes(st, /kubectl (get|describe) (netpol|networkpolic)/, CAMBIA) },
    { t: T('Miraste la diferencia con el repositorio antes de aplicar', 'You looked at the difference with the repository before applying'), ok: st => antes(st, /kubectl diff/, /kubectl apply/) },
    { t: T('Lo comprobaste otra vez desde dentro de api-pagos', 'You checked it again from inside api-pagos'), ok: st => despues(st, /kubectl exec .*(curl|wget) .*antifraude/, /kubectl (apply|delete)/) },
  ],
  pistas: [
    T('Mira qué dice api-pagos cuando llama a antifraude: kubectl logs deploy/api-pagos -n pagos --tail 5. Y pruébalo tú desde dentro: kubectl exec POD -n pagos -- curl -s antifraude:8080/actuator/health', 'See what api-pagos says when it calls antifraude: kubectl logs deploy/api-pagos -n pagos --tail 5. And try it yourself from inside: kubectl exec POD -n pagos -- curl -s antifraude:8080/actuator/health'),
    T('«i/o timeout», no «connection refused»: el Service tiene endpoints, pero algo descarta el tráfico por el camino. En pagos todo está cerrado por defecto: kubectl get netpol -n pagos y kubectl describe netpol permitir-api-a-antifraude -n pagos.', '"i/o timeout", not "connection refused": the Service has endpoints, but something drops the traffic on the way. In pagos everything is closed by default: kubectl get netpol -n pagos and kubectl describe netpol permitir-api-a-antifraude -n pagos.'),
    T('La política deja pasar al 8443 (el de la futura 3.4) y antifraude escucha en el 8080. El repositorio tiene la buena: kubectl diff -f ~/k8s/netpol/ y kubectl apply -f ~/k8s/netpol/. Luego, la misma prueba desde dentro.', 'The policy lets traffic through to 8443 (the future 3.4\'s) and antifraude listens on 8080. The repository has the right one: kubectl diff -f ~/k8s/netpol/ and kubectl apply -f ~/k8s/netpol/. Then the same test from inside.'),
  ],
  causa: T('Seguridad aplicó en producción las NetworkPolicies de la rama de antifraude 3.4, que abren el 8443 (TLS) en vez del 8080. Con default-deny-ingress en pagos, lo que ninguna política permite se descarta en silencio: api-pagos se queda esperando, agota el tiempo y manda cada pago a revisión manual.', 'Security applied in production the NetworkPolicies from the antifraude 3.4 branch, which open 8443 (TLS) instead of 8080. With default-deny-ingress in pagos, whatever no policy allows is silently dropped: api-pagos waits, times out and sends every payment to manual review.'),
  solucion: T('NetworkPolicies devueltas a las del repositorio (antifraude abierto a api-pagos en el 8080); la llamada desde api-pagos vuelve a contestar y los pagos dejan de ir a revisión manual.', 'NetworkPolicies put back to the repository\'s (antifraude open to api-pagos on 8080); the call from api-pagos answers again and payments stop going to manual review.'),
  leccion: T('Una NetworkPolicy no rechaza: descarta. Por eso da un timeout y no un «connection refused», y esa diferencia te dice dónde mirar (sin endpoints sería refused). Las políticas se suman: borrar default-deny no abre nada si otra política sigue seleccionando a los pods. Y las de una versión futura se aplican con esa versión, no antes.', 'A NetworkPolicy does not reject: it drops. That is why you get a timeout and not a "connection refused", and that difference tells you where to look (with no endpoints it would be refused). Policies add up: deleting default-deny opens nothing if another policy still selects the pods. And a future release\'s policies are applied with that release, not before.'),
  guion: st => { const p = K.podsDe(st, st.k8s.deps['pagos/api-pagos']).filter(x => K.listo(st, x))[0]; return ['amtool alert', 'kubectl logs deploy/api-pagos -n pagos --tail 5', 'kubectl exec ' + p.nombre + ' -n pagos -- curl -s antifraude:8080/actuator/health', 'kubectl get pods -n pagos -l app=antifraude', 'kubectl get netpol -n pagos', 'kubectl describe netpol permitir-api-a-antifraude -n pagos', 'kubectl diff -f ~/k8s/netpol/', 'kubectl apply -f ~/k8s/netpol/', 'kubectl exec ' + p.nombre + ' -n pagos -- curl -s antifraude:8080/actuator/health', 'amtool alert']; },
  trampas: [
    { cmds: ['kubectl delete netpol default-deny-ingress -n pagos'], porque: T('no abre antifraude: permitir-api-a-antifraude y permitir-monitorizacion siguen seleccionándolo, y ninguna deja pasar el 8080 desde api-pagos', 'it does not open antifraude: permitir-api-a-antifraude and permitir-monitorizacion still select it, and neither lets 8080 through from api-pagos') },
    { cmds: ['kubectl delete netpol default-deny-ingress permitir-api-a-antifraude permitir-monitorizacion -n pagos'], porque: T('ahora antifraude está abierto a todo el clúster, y el repositorio dice otra cosa', 'now antifraude is open to the whole cluster, and the repository says otherwise') },
  ],
},
// ============================================================================ 12
{
  id: 'REQ-8144', clave: 'helm-pendiente', tipo: 'peticion', nivel: 3, area: 'Helm · ingress-nginx', funciones: ['despliegue', 'seg'],
  impacto: 'alto', urgencia: 'media', de: T('Seguridad (Iván Rubio)', 'Security (Iván Rubio)'),
  asunto: T('Parchear ingress-nginx hoy (CVE-2025-1974): el job de CI se quedó colgado', 'Patch ingress-nginx today (CVE-2025-1974): the CI job got stuck'),
  cuerpo: [T('ingress-nginx 1.10.1 es vulnerable a CVE-2025-1974 (ejecución remota en el controlador). Hay que subir al chart 4.11.5 (controlador 1.11.5) hoy mismo.', 'ingress-nginx 1.10.1 is vulnerable to CVE-2025-1974 (remote code execution in the controller). It has to go up to chart 4.11.5 (controller 1.11.5) today.'),
    T('Lancé el job de CI esta mañana, el runner murió a mitad y ahora cada reintento falla. El log está en ~/ci/. Con los values de siempre, por favor.', 'I launched the CI job this morning, the runner died halfway and now every retry fails. The log is in ~/ci/. With the usual values, please.')],
  inicio: -38, abierto: -30,
  averias: [{ tipo: 'helm-pendiente', version: '4.11.5', hace: 38 }],
  objetivo(st) {
    const r = K.helm.release(st, 'ingress-nginx', 'ingress-nginx'), v = r.historia[r.historia.length - 1], d = st.k8s.deps['ingress-nginx/ingress-nginx-controller'], out = [];
    if (v.estado !== 'deployed' || v.chartV !== '4.11.5') out.push(T('El release ingress-nginx no está desplegado con el chart 4.11.5 (última revisión: ' + v.chartV + ', ' + v.estado + ')', 'The ingress-nginx release is not deployed with chart 4.11.5 (latest revision: ' + v.chartV + ', ' + v.estado + ')'));
    if (d.replicas !== 2) out.push(T('ingress-nginx-controller tiene ' + d.replicas + ' réplica(s): los values del equipo dicen 2', 'ingress-nginx-controller has ' + d.replicas + ' replica(s): the team\'s values say 2'));
    if (!/v1\.11\.5$/.test(d.tpl.imagen) || !K.completo(st, d)) out.push(T('El controlador no corre todavía la 1.11.5 en todos sus pods', 'The controller is not yet running 1.11.5 on all its pods'));
    return out;
  },
  practicas: [
    { t: T('Miraste el historial del release (helm history) antes de cambiar nada', 'You looked at the release history (helm history) before changing anything'), ok: st => antes(st, /helm (history|hist)/, /helm (upgrade|rollback)|kubectl delete/) },
    { t: T('No tocaste a mano los Secrets de Helm', 'You did not touch Helm\'s Secrets by hand'), ok: st => !usado(st, /kubectl delete secret.*sh\.helm/) },
    { t: T('Pasaste los values del equipo (-f o --reuse-values)', 'You passed the team\'s values (-f or --reuse-values)'), ok: st => usado(st, /helm upgrade .*(-f |--values|--reuse-values)/) },
    { t: T('Comprobaste el rollout del controlador después del upgrade', 'You checked the controller\'s rollout after the upgrade'), ok: st => despues(st, /kubectl (rollout status|get pods)/, /helm upgrade/) },
  ],
  pistas: [
    T('Lee el log de ~/ci/. Luego mira el release: helm list -n ingress-nginx (¿sale?) y helm history ingress-nginx -n ingress-nginx.', 'Read the log in ~/ci/. Then look at the release: helm list -n ingress-nginx (does it show up?) and helm history ingress-nginx -n ingress-nginx.'),
    T('La revisión 7 se quedó en pending-upgrade: Helm cree que hay otra operación en curso y no deja hacer más. La salida limpia es volver a la última buena: helm rollback ingress-nginx 6 -n ingress-nginx.', 'Revision 7 was left in pending-upgrade: Helm thinks another operation is in progress and allows nothing else. The clean way out is to go back to the last good one: helm rollback ingress-nginx 6 -n ingress-nginx.'),
    T('Después, el upgrade de verdad con los values del equipo: helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version 4.11.5 -n ingress-nginx -f ~/helm/ingress-nginx/values.yaml, y kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx.', 'Then the real upgrade with the team\'s values: helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version 4.11.5 -n ingress-nginx -f ~/helm/ingress-nginx/values.yaml, and kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx.'),
  ],
  causa: T('El runner de CI murió (OOMKilled) en mitad del helm upgrade. Helm ya había escrito la revisión 7 como pending-upgrade y no llegó a terminarla: para Helm hay una operación en curso, y cualquier upgrade nuevo falla con «another operation is in progress». El controlador, mientras, seguía en la 1.10.1 vulnerable.', 'The CI runner died (OOMKilled) in the middle of helm upgrade. Helm had already written revision 7 as pending-upgrade and never finished it: for Helm there is an operation in progress, and any new upgrade fails with "another operation is in progress". Meanwhile the controller was still on the vulnerable 1.10.1.'),
  solucion: T('helm rollback a la revisión 6 (la última buena) para cerrar la operación colgada, y helm upgrade al chart 4.11.5 con los values del equipo; el controlador terminó su rollout en la 1.11.5 con sus 2 réplicas.', 'helm rollback to revision 6 (the last good one) to close the hung operation, and helm upgrade to chart 4.11.5 with the team\'s values; the controller finished its rollout on 1.11.5 with its 2 replicas.'),
  leccion: T('Un release en pending-upgrade se cierra con helm rollback a la última revisión buena, no borrando sus Secrets: eso «funciona», pero te carga la historia que necesitas para volver atrás. Y un helm upgrade sin -f ni --reuse-values vuelve a los valores por defecto del chart: aquí, una réplica en vez de dos.', 'A release in pending-upgrade is closed with helm rollback to the last good revision, not by deleting its Secrets: that "works", but it wipes the history you need to go back. And a helm upgrade without -f or --reuse-values goes back to the chart\'s default values: here, one replica instead of two.'),
  guion: ['cat ~/ci/ingress-nginx-upgrade.log', 'helm list -n ingress-nginx', 'helm list -n ingress-nginx -a', 'helm history ingress-nginx -n ingress-nginx', 'helm rollback ingress-nginx 6 -n ingress-nginx', 'helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version 4.11.5 -n ingress-nginx -f ~/helm/ingress-nginx/values.yaml', 'kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx', 'helm list -n ingress-nginx'],
  trampas: [
    { cmds: ['kubectl delete secret sh.helm.release.v1.ingress-nginx.v7 -n ingress-nginx', 'helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version 4.11.5 -n ingress-nginx -f ~/helm/ingress-nginx/values.yaml', 'kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx'], porque: T('el upgrade sale, pero has borrado a mano el registro de Helm', 'the upgrade goes through, but you have deleted Helm\'s record by hand'), practicas: [1] },
    { cmds: ['helm rollback ingress-nginx 6 -n ingress-nginx', 'helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version 4.11.5 -n ingress-nginx', 'kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx'], porque: T('sin -f ni --reuse-values vuelve a los valores del chart: el controlador se queda con una sola réplica', 'without -f or --reuse-values it goes back to the chart\'s values: the controller is left with a single replica') },
    { cmds: ['helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version 4.11.5 -n ingress-nginx -f ~/helm/ingress-nginx/values.yaml'], porque: T('falla igual: hay una operación «en curso»', 'it fails just the same: there is an operation "in progress"') },
  ],
},
// ============================================================================ 13 · fase 3
{
  id: 'INC-8148', clave: 'gitops-revert', tipo: 'incidente', nivel: 3, area: 'GitOps · Argo CD', funciones: ['despliegue', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Equipo de pagos (Raúl Ortega)', 'Payments team (Raúl Ortega)'),
  asunto: T('La 2.16.0 de api-pagos no arranca y el rollout undo «no se queda»', 'api-pagos 2.16.0 does not start and rollout undo "does not stick"'),
  cuerpo: [T('Nuestro pipeline publicó la 2.16.0 de api-pagos hace media hora y el pod nuevo no arranca. Hice kubectl rollout undo y a los dos minutos volvía a estar la 2.16.0, otra vez rota.', 'Our pipeline shipped api-pagos 2.16.0 half an hour ago and the new pod does not start. I ran kubectl rollout undo and two minutes later 2.16.0 was back, broken again.'),
    T('La semana pasada plataforma activó Argo CD con auto-sync para api-pagos. Los pagos siguen funcionando con los pods viejos, pero no sabemos cuánto aguantará.', 'Last week platform enabled Argo CD auto-sync for api-pagos. Payments still work on the old pods, but we do not know for how long.')],
  inicio: -35, abierto: -12,
  averias: [{ tipo: 'gitops-version-rota', version: '2.16.0', hace: 35, undo: true }],
  practicas: [
    { t: T('Leíste el log del contenedor que murió antes de tocar nada', 'You read the dead container\'s log before touching anything'), ok: st => antes(st, /kubectl logs .*(--previous|-p\b)/, /git (revert|push)|kubectl (rollout|set|apply|patch)|argocd app (sync|set|rollback)/) },
    { t: T('Miraste qué hace Argo CD con la aplicación (argocd app get o history)', 'You looked at what Argo CD does with the application (argocd app get or history)'), ok: st => antes(st, /argocd app (get|history)/, /git (revert|push)/) },
    { t: T('Leíste el commit antes de revertirlo (git show)', 'You read the commit before reverting it (git show)'), ok: st => antes(st, /git show/, /git revert/) },
    { t: T('Comprobaste el resultado después del push', 'You checked the result after the push'), ok: st => despues(st, /kubectl (rollout status|get pods)|argocd app get/, /git push/) },
  ],
  pistas: [
    T('Primero, por qué no arranca: kubectl logs POD -n pagos --previous. Después, por qué vuelve: argocd app get api-pagos y argocd app history api-pagos.', 'First, why it does not start: kubectl logs POD -n pagos --previous. Then, why it comes back: argocd app get api-pagos and argocd app history api-pagos.'),
    T('Con auto-sync y self-heal, Argo CD deja el clúster como dice git: lo que cambies con kubectl lo deshace en un minuto. Lo que hay que cambiar es git. En ~/k8s: git log --oneline y git show del commit de la 2.16.0.', 'With auto-sync and self-heal, Argo CD keeps the cluster as git says: whatever you change with kubectl it undoes within a minute. What has to change is git. In ~/k8s: git log --oneline and git show on the 2.16.0 commit.'),
    T('La 2.16.0 exige PASARELA_TIMEOUT_MS, que el ConfigMap no tiene. Vuelve atrás en git: git revert COMMIT --no-edit y git push. Argo CD sincronizará la 2.14.1; compruébalo con kubectl rollout status deployment/api-pagos -n pagos.', '2.16.0 requires PASARELA_TIMEOUT_MS, which the ConfigMap does not have. Go back in git: git revert COMMIT --no-edit and git push. Argo CD will sync 2.14.1; check it with kubectl rollout status deployment/api-pagos -n pagos.'),
  ],
  causa: T('La 2.16.0 de api-pagos exige una variable nueva (PASARELA_TIMEOUT_MS) que nadie añadió al ConfigMap: el pod nuevo muere al arrancar y el rolling update se queda a medias, con los viejos sirviendo. Como la aplicación tiene auto-sync y self-heal en Argo CD, el kubectl rollout undo duró lo que tarda Argo en ver que el clúster no es lo que dice git.', 'api-pagos 2.16.0 requires a new variable (PASARELA_TIMEOUT_MS) that nobody added to the ConfigMap: the new pod dies at startup and the rolling update is left halfway, with the old ones serving. Because the application has auto-sync and self-heal in Argo CD, the kubectl rollout undo lasted as long as Argo took to notice the cluster was not what git says.'),
  solucion: T('git revert del commit de la 2.16.0 y git push; Argo CD sincronizó la 2.14.1, el rollout terminó y la aplicación quedó Synced y Healthy, con su auto-sync intacto.', 'git revert of the 2.16.0 commit and git push; Argo CD synced 2.14.1, the rollout finished and the application was left Synced and Healthy, with its auto-sync intact.'),
  leccion: T('Con GitOps, git es la única palanca: volver atrás es git revert + push, no kubectl rollout undo (que Argo deshace) ni argocd app rollback (que no funciona con auto-sync). Y quitar el auto-sync para «arreglarlo a mano» funciona hoy y deja el clúster mintiendo a git mañana.', 'With GitOps, git is the only lever: going back is git revert + push, not kubectl rollout undo (which Argo undoes) nor argocd app rollback (which does not work with auto-sync). And turning auto-sync off to "fix it by hand" works today and leaves the cluster lying to git tomorrow.'),
  guion: st => { const p = crash(st, 'api-pagos'); return ['amtool alert', 'kubectl get pods -n pagos -l app=api-pagos', 'kubectl logs ' + p.nombre + ' -n pagos --previous', 'argocd app get api-pagos', 'argocd app history api-pagos', 'cd ~/k8s', 'git log --oneline', 'git show b7c41e8', 'git revert b7c41e8 --no-edit', 'git push', 'cd', 'kubectl rollout status deployment/api-pagos -n pagos', 'argocd app get api-pagos', 'amtool alert']; },
  trampas: [
    { cmds: ['kubectl rollout undo deployment/api-pagos -n pagos', 'sleep 120'], porque: T('Argo CD, con self-heal, vuelve a aplicar la 2.16.0 al minuto', 'Argo CD, with self-heal, applies 2.16.0 again within a minute') },
    { cmds: ['argocd app rollback api-pagos 0'], porque: T('Argo CD no deja hacer rollback con auto-sync activo', 'Argo CD does not allow a rollback with auto-sync enabled') },
    { cmds: ['argocd app set api-pagos --sync-policy none', 'kubectl rollout undo deployment/api-pagos -n pagos', 'kubectl rollout status deployment/api-pagos -n pagos'], porque: T('funciona, pero sin auto-sync y con el clúster distinto de git: el siguiente que sincronice vuelve a romperlo', 'it works, but with no auto-sync and the cluster different from git: whoever syncs next breaks it again') },
  ],
},
// ============================================================================ 14
{
  id: 'INC-8152', clave: 'kubelet-swap', tipo: 'incidente', nivel: 2, area: T('Nodos · kubelet', 'Nodes · kubelet'), funciones: ['cluster', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Alertmanager (guardia)', 'Alertmanager (on call)'),
  asunto: T('worker-02 NotReady desde el parcheo de anoche', 'worker-02 NotReady since last night\'s patching'),
  cuerpo: [T('worker-02 se reinició con el parche del kernel y no ha vuelto: lleva más de una hora NotReady. Sus pods se han ido a los otros dos workers, que van justos.', 'worker-02 rebooted with the kernel patch and has not come back: it has been NotReady for over an hour. Its pods moved to the other two workers, which are running tight.'),
    T('Ayer por la tarde alguien estuvo haciendo pruebas de memoria en ese nodo.', 'Yesterday afternoon someone was running memory tests on that node.')],
  inicio: -75, abierto: -30,
  averias: [{ tipo: 'swap-kubelet', nodo: 'worker-02', hace: 75 }],
  practicas: [
    { t: T('Leíste por qué no arranca el kubelet (journalctl o systemctl status) antes de tocar nada', 'You read why the kubelet does not start (journalctl or systemctl status) before touching anything'), ok: st => antes(st, /journalctl .*kubelet|systemctl status kubelet/, /swapoff|systemctl (restart|start) kubelet|sed -i/) },
    { t: T('Comprobaste el swap antes de quitarlo (swapon o free)', 'You checked the swap before removing it (swapon or free)'), ok: st => antes(st, /swapon( --show)?$|^free|free -h/, /swapoff/) },
    { t: T('No reiniciaste el nodo «a ver si volvía»', 'You did not reboot the node "to see if it came back"'), ok: st => !st.hechos.reinicios.length },
    { t: T('Comprobaste que el nodo vuelve a Ready', 'You checked that the node is Ready again'), ok: st => despues(st, /kubectl (get|describe) node/, /systemctl (restart|start) kubelet/) },
  ],
  pistas: [
    T('kubectl get nodes y kubectl describe node worker-02: «Kubelet stopped posting node status». El problema está en el nodo: ssh worker-02 y systemctl status kubelet.', 'kubectl get nodes and kubectl describe node worker-02: "Kubelet stopped posting node status". The problem is on the node: ssh worker-02 and systemctl status kubelet.'),
    T('journalctl -u kubelet -n 20 dice por qué no arranca: hay swap activo, y el kubelet no lo admite. ¿Desde dónde se activa al arrancar? cat /etc/fstab', 'journalctl -u kubelet -n 20 says why it does not start: swap is on, and the kubelet does not accept it. What turns it on at boot? cat /etc/fstab'),
    T("sudo swapoff -a lo quita ahora; sudo sed -i '/swap/ s/^/#/' /etc/fstab, para siempre. Luego sudo systemctl restart kubelet, exit y kubectl get nodes.", "sudo swapoff -a turns it off now; sudo sed -i '/swap/ s/^/#/' /etc/fstab, for good. Then sudo systemctl restart kubelet, exit and kubectl get nodes."),
  ],
  causa: T('En las pruebas de memoria de ayer alguien creó un swapfile en worker-02 y lo añadió a /etc/fstab. Al reiniciar por el parche, el swap se activó al arrancar y el kubelet se negó a hacerlo («running with swap on is not supported»). El nodo pasó a NotReady y, a los 5 minutos, Kubernetes desalojó sus pods hacia los otros workers.', 'In yesterday\'s memory tests someone created a swapfile on worker-02 and added it to /etc/fstab. When it rebooted for the patch, swap came up at boot and the kubelet refused to start ("running with swap on is not supported"). The node went NotReady and, 5 minutes later, Kubernetes evicted its pods to the other workers.'),
  solucion: T('swapoff -a, la línea del swapfile comentada en /etc/fstab y el kubelet reiniciado: worker-02 vuelve a estar Ready y no volverá a caer en el próximo reinicio.', 'swapoff -a, the swapfile line commented out in /etc/fstab and the kubelet restarted: worker-02 is Ready again and will not go down on the next reboot.'),
  leccion: T('Un nodo NotReady se arregla dentro del nodo: el kubelet es un servicio de systemd y su journal dice por qué no arranca. Arreglarlo sólo para ahora (swapoff) deja la avería esperando al próximo reinicio: lo que se activa al arrancar se mira en /etc/fstab. Y fíjate en lo que hizo Kubernetes solo: a los 5 minutos movió los pods a otros nodos.', 'A NotReady node is fixed inside the node: the kubelet is a systemd service and its journal says why it does not start. Fixing it only for now (swapoff) leaves the fault waiting for the next reboot: what turns on at boot lives in /etc/fstab. And notice what Kubernetes did on its own: after 5 minutes it moved the pods to other nodes.'),
  guion: ['amtool alert', 'kubectl get nodes', 'kubectl describe node worker-02', 'ssh worker-02', 'systemctl status kubelet', 'journalctl -u kubelet -n 20', 'swapon --show', 'sudo swapoff -a', 'cat /etc/fstab', "sudo sed -i '/swap/ s/^/#/' /etc/fstab", 'sudo systemctl restart kubelet', 'exit', 'kubectl get nodes', 'amtool alert'],
  trampas: [
    { cmds: ['ssh worker-02', 'sudo systemctl restart kubelet', 'exit'], porque: T('con el swap activo, el kubelet vuelve a negarse a arrancar', 'with swap on, the kubelet refuses to start again') },
    { cmds: ['ssh worker-02', 'sudo swapoff -a', 'sudo systemctl restart kubelet', 'exit'], porque: T('vuelve a Ready, pero /etc/fstab activará el swap en el próximo reinicio', 'it is Ready again, but /etc/fstab will turn swap on at the next reboot') },
  ],
},
// ============================================================================ 15
{
  id: 'REQ-8156', clave: 'ci-argo-sync', tipo: 'peticion', nivel: 2, area: 'CI/CD · Argo CD', funciones: ['cicd', 'despliegue'],
  impacto: 'medio', urgencia: 'media', de: T('Equipo de frontal (Laura Méndez)', 'Front-end team (Laura Méndez)'),
  asunto: T('El pipeline de web-checkout 1.9.1 falla en «deploy»', 'The web-checkout 1.9.1 pipeline fails at "deploy"'),
  cuerpo: [T('El pipeline de la 1.9.1 construye, pasa los tests, publica la imagen y actualiza el manifiesto, pero el job de deploy falla por timeout esperando a Argo CD. Producción sigue en la 1.8.3.', 'The 1.9.1 pipeline builds, passes the tests, publishes the image and updates the manifest, but the deploy job fails with a timeout waiting for Argo CD. Production is still on 1.8.3.'),
    T('¿Podéis desplegarla y dejarnos el pipeline en verde? La release está aprobada.', 'Can you deploy it and leave our pipeline green? The release is approved.')],
  inicio: -50, abierto: -25,
  averias: [{ tipo: 'ci-sin-sincronizar', version: '1.9.1', hace: 50 }],
  practicas: [
    { t: T('Leíste el log del job que falla (glab ci trace) antes de tocar nada', 'You read the failing job\'s log (glab ci trace) before touching anything'), ok: st => antes(st, /glab ci trace/, /argocd app (sync|set)|kubectl (apply|set)|glab ci retry/) },
    { t: T('Miraste la diferencia (argocd app diff) antes de sincronizar', 'You looked at the difference (argocd app diff) before syncing'), ok: st => antes(st, /argocd app diff/, /argocd app sync|kubectl apply/) },
    { t: T('Sincronizaste con Argo CD, que deja constancia en su historial', 'You synced with Argo CD, which keeps a record in its history'), ok: st => usado(st, /argocd app sync/) },
    { t: T('Reintentaste el job cuando el despliegue ya estaba sano', 'You retried the job once the deployment was healthy'), ok: st => despues(st, /glab ci retry/, /kubectl rollout status|argocd app get/) },
  ],
  pistas: [
    T('glab ci list y glab ci view: ¿qué job falla? Su log: glab ci trace 9305.', 'glab ci list and glab ci view: which job fails? Its log: glab ci trace 9305.'),
    T('El job espera a que Argo CD tenga web-checkout Synced, y nunca llega: argocd app get web-checkout. ¿Qué política de sincronización tiene? El manifiesto nuevo está en git, pero nadie lo ha sincronizado.', 'The job waits for Argo CD to have web-checkout Synced, and it never gets there: argocd app get web-checkout. What sync policy does it have? The new manifest is in git, but nobody has synced it.'),
    T('argocd app diff web-checkout para ver qué va a cambiar, argocd app sync web-checkout, kubectl rollout status deployment/web-checkout -n pagos, y glab ci retry 9305.', 'argocd app diff web-checkout to see what will change, argocd app sync web-checkout, kubectl rollout status deployment/web-checkout -n pagos, and glab ci retry 9305.'),
  ],
  causa: T('En producción, web-checkout se sincroniza a mano en Argo CD: es una decisión del equipo. El pipeline hace bien su parte (imagen y manifiesto en git), pero su último job espera a que la aplicación esté Synced y nadie la sincronizó, así que agota los 10 minutos y falla.', 'In production, web-checkout is synced by hand in Argo CD: it is a team decision. The pipeline does its part right (image and manifest in git), but its last job waits for the application to be Synced and nobody synced it, so it runs out its 10 minutes and fails.'),
  solucion: T('argocd app diff y argocd app sync de web-checkout; rollout terminado en la 1.9.1, la aplicación Synced y Healthy, y el job de deploy reintentado en verde.', 'argocd app diff and argocd app sync of web-checkout; rollout finished on 1.9.1, the application Synced and Healthy, and the deploy job retried green.'),
  leccion: T('Con GitOps, «está en git» no es «está desplegado»: entre los dos está la política de sincronización. Sincronizar a mano en producción es un control, no un estorbo: se mira el diff, se sincroniza con Argo (que deja historial) y se comprueba. Cambiar la política para que el pipeline pase es quitar ese control sin preguntar.', 'With GitOps, "it is in git" is not "it is deployed": between the two lies the sync policy. Syncing by hand in production is a control, not a nuisance: you look at the diff, sync with Argo (which keeps a history) and check. Changing the policy so the pipeline passes is removing that control without asking.'),
  guion: ['glab ci list', 'glab ci view', 'glab ci trace 9305', 'argocd app get web-checkout', 'argocd app diff web-checkout', 'argocd app sync web-checkout', 'kubectl rollout status deployment/web-checkout -n pagos', 'glab ci retry 9305', 'glab ci list'],
  trampas: [
    { cmds: ['glab ci retry 9305'], porque: T('reintentar sin sincronizar falla igual: Argo sigue esperando a que alguien sincronice', 'retrying without syncing fails just the same: Argo is still waiting for someone to sync') },
    { cmds: ['argocd app set web-checkout --sync-policy automated', 'sleep 120', 'glab ci retry 9305'], porque: T('el pipeline pasa, pero has cambiado la política de producción del equipo', 'the pipeline passes, but you have changed the team\'s production policy') },
    { cmds: ['kubectl apply -f ~/k8s/web-checkout/', 'kubectl rollout status deployment/web-checkout -n pagos', 'glab ci retry 9305'], porque: T('queda desplegado, pero por fuera de Argo CD: su historial no sabe nada', 'it ends up deployed, but outside Argo CD: its history knows nothing about it'), practicas: [2] },
  ],
},
];

// ------------------------------------------------------------------ uso
// Un ticket declara sus averías (del catálogo, averias.js) y, si pide algo nuevo, un objetivo.
P.normalizarEscenario = e => {
  e.averias = e.averias || [];
  if (!e.aplicar) e.aplicar = st => P.aplicarAverias(st, e.averias);
  e.resuelto = st => P.pendientesAverias(st, e.averias).concat(e.objetivo ? e.objetivo(st, P) : [], alertas(st));
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
