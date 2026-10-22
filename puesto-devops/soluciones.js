// Puesto DevOps · solucionario: por qué se hace cada paso, y el glosario.
//
// La página es la del Puesto Linux (../puesto-linux/solucionario.js): ejecuta
// el `guion` de cada ticket en el simulador y pinta la salida real. Aquí sólo
// va lo que un comando no dice: la fase y el porqué de cada paso.
//
// Cada paso es [trozo, fase, explicación]. El trozo es un fragmento que tiene
// que aparecer en el comando de esa posición del guion (los nombres de los pods
// llevan un hash y ya están en el guion). devops-test.js lo comprueba.
//
//   fase: 'diag' (mirar) · 'arreglo' (cambiar algo) · 'comprobar' · '' (moverse)
(function (P) {
'use strict';
const T = P.T;

P.solucionarioCfg = {
  buscar: T('Buscar un término: CrashLoopBackOff, rolling update, selector…', 'Search for a term: CrashLoopBackOff, rolling update, selector…'),
  silencio: T('(no devuelve nada: en kubectl y en Linux, el silencio suele significar que ha ido bien)', '(no output: in kubectl and in Linux, silence usually means it worked)'),
};

P.soluciones = {
'INC-8101': {
  terminos: ['crashloop', 'logs-previous', 'configmap', 'entorno-arranque', 'kubectl-diff', 'deriva'],
  pasos: [
    ['amtool alert', 'diag', T('Dos alertas: un pod en CrashLoopBackOff y el Deployment con 2 de 3 réplicas. Ya sabes qué aplicación y qué pod.', 'Two alerts: a pod in CrashLoopBackOff and the Deployment at 2 of 3 replicas. You already know which application and which pod.')],
    ['get pods -n pagos -o wide', 'diag', T('El pod malo está en worker-02, el nodo que se reinició, y lleva más de diez reinicios. Los otros pods de worker-02 tienen 1 reinicio y están bien: el reinicio del nodo no es la causa, es el momento en que se destapó.', 'The bad pod is on worker-02, the node that rebooted, and it has restarted more than ten times. The other pods on worker-02 have 1 restart and are fine: the node reboot is not the cause, it is the moment it surfaced.')],
    ['--previous', 'diag', T('El log del contenedor que murió. Lo dice claro: falta PASARELA_URL. Y la línea anterior enseña qué variables sí tiene: PAYMENT_GATEWAY_URL.', 'The log of the container that died. It says it plainly: PASARELA_URL is missing. And the line before shows which variables it does have: PAYMENT_GATEWAY_URL.')],
    ['get configmap api-pagos-config', 'diag', T('El ConfigMap en el clúster: alguien renombró la clave. Los otros dos pods arrancaron antes del cambio y siguen con la variable vieja en su entorno.', 'The ConfigMap in the cluster: someone renamed the key. The other two pods started before the change and still have the old variable in their environment.')],
    ['kubectl diff', 'diag', T('La diferencia con el repositorio: aplicar ~/k8s devuelve PASARELA_URL y quita PAYMENT_GATEWAY_URL. Es exactamente lo que se quiere.', 'The difference with the repository: applying ~/k8s brings back PASARELA_URL and removes PAYMENT_GATEWAY_URL. That is exactly what is wanted.')],
    ['kubectl apply', 'arreglo', T('El ConfigMap vuelve a lo que dice el repositorio. Sin deriva.', 'The ConfigMap goes back to what the repository says. No drift.')],
    ['kubectl delete pod', 'arreglo', T('El pod lo leería en su próximo intento (el backoff ya va por 5 minutos). Borrarlo hace que el ReplicaSet cree otro ya, con el entorno bueno. Sólo ése: los sanos no se tocan.', 'The pod would read it on its next attempt (the backoff is already at 5 minutes). Deleting it makes the ReplicaSet create another one right away, with the good environment. Only that one: the healthy ones are left alone.')],
    ['rollout status', 'comprobar', T('Espera a que el Deployment vuelva a tener sus 3 réplicas listas.', 'Waits until the Deployment has its 3 ready replicas again.')],
    ['amtool alert', 'comprobar', T('Sin alertas.', 'No alerts.')],
  ],
},
'INC-8104': {
  terminos: ['imagepullbackoff', 'registro', 'rolling-update', 'progress-deadline', 'kubectl-diff', 'gitops'],
  pasos: [
    ['get pods -n pagos', 'diag', T('Tres pods de api-pagos sanos (la versión vieja) y uno nuevo en ImagePullBackOff. El rolling update no quita los viejos mientras el nuevo no esté listo: por eso nadie lo nota fuera.', 'Three healthy api-pagos pods (the old version) and a new one in ImagePullBackOff. The rolling update does not remove the old ones while the new one is not ready: that is why nobody notices outside.')],
    ['describe pod', 'diag', T('Los eventos lo cuentan: «failed to resolve reference … :2.15.0: not found». El nodo no encuentra esa etiqueta en el registro.', 'The events tell the story: "failed to resolve reference … :2.15.0: not found". The node cannot find that tag in the registry.')],
    ['tags/list', 'diag', T('Las etiquetas que existen: v2.15.0, con v. El correo decía 2.15.0.', 'The tags that exist: v2.15.0, with a v. The email said 2.15.0.')],
    ['kubectl diff', 'diag', T('El manifiesto que dejó CI en el repositorio ya tiene la etiqueta buena: el diff sólo cambia la imagen.', 'The manifest CI left in the repository already has the right tag: the diff only changes the image.')],
    ['kubectl apply', 'arreglo', T('Se despliega lo que dice el repositorio. El rollout empieza de nuevo con la imagen que sí existe.', 'What the repository says is deployed. The rollout starts again with the image that does exist.')],
    ['rollout status', 'comprobar', T('Espera, como el de verdad, a que los tres pods nuevos estén listos y los viejos se hayan ido.', 'It waits, like the real one, for the three new pods to be ready and the old ones to be gone.')],
    ['amtool alert', 'comprobar', T('Sin alertas.', 'No alerts.')],
  ],
},
'INC-8108': {
  terminos: ['oomkilled', 'limites', 'rolling-update', 'change-cause', 'top', 'kubectl-diff'],
  pasos: [
    ['amtool alert', 'diag', T('antifraude en CrashLoopBackOff.', 'antifraude in CrashLoopBackOff.')],
    ['-l app=antifraude', 'diag', T('Los dos pods de la revisión nueva, con muchos reinicios. Ninguno de la versión anterior: el rollout terminó antes de que empezaran a morir.', 'Both pods of the new revision, with many restarts. None of the previous version: the rollout finished before they started dying.')],
    ['describe pod', 'diag', T('Last State: Terminated, Reason: OOMKilled, Exit Code: 137. Lo ha matado el kernel por pasar de su límite: 512Mi.', 'Last State: Terminated, Reason: OOMKilled, Exit Code: 137. The kernel killed it for going over its limit: 512Mi.')],
    ['top pod', 'diag', T('Cuánto usa un pod de antifraude cuando ya ha cargado el modelo: unos 720Mi. Con 512Mi no cabe nunca.', 'How much an antifraude pod uses once it has loaded the model: about 720Mi. With 512Mi it never fits.')],
    ['rollout history', 'diag', T('La revisión 2 lleva el change-cause de FinOps: ahí está el cambio de esta mañana.', 'Revision 2 carries FinOps\' change-cause: there is this morning\'s change.')],
    ['kubectl diff', 'diag', T('El repositorio sigue con 1Gi de límite y 768Mi de request: el «ajuste» se hizo sobre el clúster, no en el código.', 'The repository still has a 1Gi limit and a 768Mi request: the "tuning" was done on the cluster, not in the code.')],
    ['kubectl apply', 'arreglo', T('Vuelve a lo del repositorio. Un rollout nuevo con el límite bueno.', 'Back to the repository\'s. A new rollout with the right limit.')],
    ['rollout status', 'comprobar', T('Los pods nuevos cargan el modelo y siguen vivos: el rollout termina.', 'The new pods load the model and stay alive: the rollout finishes.')],
    ['amtool alert', 'comprobar', T('Sin alertas.', 'No alerts.')],
  ],
},
'INC-8112': {
  terminos: ['pending', 'scheduler', 'requests', 'cordon-drain', 'taint'],
  pasos: [
    ['get pods -n pagos -o wide', 'diag', T('Dos liquidaciones en Pending, sin nodo. Y ningún pod de la plataforma en worker-03: raro, con tres workers.', 'Two liquidaciones pods Pending, with no node. And no platform pod on worker-03: odd, with three workers.')],
    ['describe pod', 'diag', T('El evento del scheduler lo explica todo: un nodo es el control plane (taint), uno «unschedulable» y en los otros dos no queda CPU para 1500m.', 'The scheduler\'s event explains it all: one node is the control plane (taint), one is "unschedulable" and the other two have no CPU left for 1500m.')],
    ['get nodes', 'diag', T('worker-03 está Ready,SchedulingDisabled: está sano, pero no acepta pods.', 'worker-03 is Ready,SchedulingDisabled: it is healthy, but it accepts no pods.')],
    ['describe node worker-03', 'diag', T('Unschedulable: true, con el taint de unschedulable, sus condiciones en verde y sin pods salvo los de sistema: lo drenaron y nadie lo devolvió.', 'Unschedulable: true, with the unschedulable taint, its conditions green and no pods except the system ones: it was drained and nobody gave it back.')],
    ['uncordon', 'arreglo', T('Se devuelve el nodo al servicio. No hay que mover nada a mano: el scheduler coloca los pendientes solo.', 'The node goes back into service. Nothing needs moving by hand: the scheduler places the pending ones by itself.')],
    ['rollout status', 'comprobar', T('Espera a que liquidaciones tenga sus 4 réplicas listas.', 'Waits until liquidaciones has its 4 replicas ready.')],
    ['get pods -n pagos -o wide', 'comprobar', T('Los dos nuevos están en worker-03.', 'The two new ones are on worker-03.')],
    ['amtool alert', 'comprobar', T('Sin alertas.', 'No alerts.')],
  ],
},
'INC-8116': {
  terminos: ['service', 'endpoints', 'selector', 'kubectl-diff', 'deriva'],
  pasos: [
    ['curl -s', 'diag', T('Reproduce lo que ve el cliente: 502 Bad Gateway.', 'Reproduce what the customer sees: 502 Bad Gateway.')],
    ['get pods -n pagos', 'diag', T('Todo Running y 1/1. Los pods están bien: el problema está entre el tráfico y ellos.', 'Everything Running and 1/1. The pods are fine: the problem is between the traffic and them.')],
    ['get endpoints', 'diag', T('api-pagos: <none>. El Service no encuentra ningún pod al que mandar tráfico.', 'api-pagos: <none>. The Service finds no pod to send traffic to.')],
    ['describe svc', 'diag', T('Su selector pide app=api-pagos y tier=backend.', 'Its selector asks for app=api-pagos and tier=backend.')],
    ['--show-labels', 'diag', T('Los pods tienen app=api-pagos, pero no tier. Ninguno casa con el selector.', 'The pods have app=api-pagos, but no tier. None matches the selector.')],
    ['kubectl diff', 'diag', T('El Service del repositorio sólo pide app=api-pagos: aplicar quita la línea de tier.', 'The repository\'s Service only asks for app=api-pagos: applying removes the tier line.')],
    ['kubectl apply', 'arreglo', T('El Service vuelve al del repositorio.', 'The Service goes back to the repository\'s.')],
    ['get endpoints api-pagos', 'comprobar', T('Tres endpoints, uno por pod.', 'Three endpoints, one per pod.')],
    ['curl -s', 'comprobar', T('El pago de prueba vuelve a contestar 200.', 'The test payment answers 200 again.')],
    ['amtool alert', 'comprobar', T('Sin alertas.', 'No alerts.')],
  ],
},
'REQ-8120': {
  terminos: ['readiness', 'rolling-update', 'progress-deadline', 'kubectl-diff', 'gitops'],
  pasos: [
    ['-l app=web-checkout', 'diag', T('Dos pods de la 1.8.3 sanos y uno de la 1.9.0 Running pero 0/1: vivo, pero no listo.', 'Two healthy 1.8.3 pods and one 1.9.0 pod that is Running but 0/1: alive, but not ready.')],
    ['describe pod', 'diag', T('«Readiness probe failed: HTTP probe failed with statuscode: 404», decenas de veces. La sonda pide /health.', '"Readiness probe failed: HTTP probe failed with statuscode: 404", dozens of times. The probe asks for /health.')],
    ['--tail 5', 'diag', T('El log de nginx lo confirma: kube-probe pide GET /health y recibe 404.', 'The nginx log confirms it: kube-probe asks for GET /health and gets 404.')],
    ['CHANGELOG', 'diag', T('La 1.9.0 mueve la salud a /ready. El cambio de contrato estaba avisado.', '1.9.0 moves health to /ready. The contract change was announced.')],
    ['kubectl diff', 'diag', T('El manifiesto del PR cambia la imagen y la sonda a la vez. set image sólo había cambiado la imagen.', 'The PR\'s manifest changes the image and the probe together. set image had only changed the image.')],
    ['kubectl apply', 'arreglo', T('Se despliega la versión con su contrato completo.', 'The release is deployed with its full contract.')],
    ['rollout status', 'comprobar', T('Los pods nuevos pasan la sonda en /ready y el rollout termina.', 'The new pods pass the probe on /ready and the rollout finishes.')],
    ['amtool alert', 'comprobar', T('Sin alertas.', 'No alerts.')],
  ],
},
};

P.glosario = [
  { id: 'pod', t: 'Pod', d: T('La unidad mínima de Kubernetes: uno o varios contenedores que comparten red y se programan juntos en un nodo. Los pods son desechables: se crean y se borran, no se arreglan.', 'The smallest unit in Kubernetes: one or more containers that share a network and are scheduled together on a node. Pods are disposable: they are created and deleted, not repaired.') },
  { id: 'deployment', t: 'Deployment', d: T('Declara cuántas réplicas de una plantilla de pod quieres. Cada cambio de plantilla es una revisión nueva, con su ReplicaSet.', 'Declares how many replicas of a pod template you want. Each template change is a new revision, with its own ReplicaSet.') },
  { id: 'replicaset', t: 'ReplicaSet', d: T('Mantiene N pods de una plantilla concreta. Lo crea el Deployment; tú casi nunca lo tocas. El hash de su nombre está también en el de sus pods.', 'Keeps N pods of one specific template. The Deployment creates it; you almost never touch it. The hash in its name also appears in its pods\' names.') },
  { id: 'rolling-update', t: 'Rolling update', d: T('Cómo cambia un Deployment de versión: sube pods nuevos (hasta maxSurge de más) y quita viejos sólo si quedan disponibles al menos réplicas − maxUnavailable. Si los nuevos no llegan a estar listos, los viejos se quedan.', 'How a Deployment changes version: it brings up new pods (up to maxSurge extra) and removes old ones only if at least replicas − maxUnavailable stay available. If the new ones never become ready, the old ones stay.') },
  { id: 'progress-deadline', t: 'progressDeadlineSeconds', d: T('Lo que espera un Deployment a que un rollout avance (10 min por defecto). Si no avanza, marca Progressing=False ProgressDeadlineExceeded. No deshace nada: sólo avisa.', 'How long a Deployment waits for a rollout to make progress (10 min by default). If it does not, it sets Progressing=False ProgressDeadlineExceeded. It does not undo anything: it only reports.') },
  { id: 'service', t: 'Service', d: T('Un nombre y una IP estables delante de un grupo de pods, que se eligen por etiquetas (el selector). Reparte el tráfico entre los que están listos.', 'A stable name and IP in front of a group of pods, chosen by labels (the selector). It spreads traffic across the ones that are ready.') },
  { id: 'endpoints', t: 'Endpoints', d: T('La lista de IP:puerto a las que un Service manda tráfico ahora mismo: los pods que casan con su selector y están listos. Vacía = el Service no lleva a ninguna parte.', 'The list of IP:port a Service sends traffic to right now: the pods that match its selector and are ready. Empty = the Service leads nowhere.') },
  { id: 'selector', t: T('Selector y etiquetas', 'Selector and labels'), d: T('Las etiquetas son pares clave=valor en los objetos; un selector elige los que tienen todas las que pide. Un selector que no casa con nada no da error: da cero resultados.', 'Labels are key=value pairs on objects; a selector picks the ones that have all the labels it asks for. A selector that matches nothing gives no error: it gives zero results.') },
  { id: 'configmap', t: 'ConfigMap', d: T('Configuración (claves y valores) separada de la imagen. Un pod la puede leer como variables de entorno (envFrom) o como ficheros.', 'Configuration (keys and values) kept apart from the image. A pod can read it as environment variables (envFrom) or as files.') },
  { id: 'entorno-arranque', t: T('El entorno se lee al arrancar', 'The environment is read at startup'), d: T('Las variables que vienen de un ConfigMap se fijan cuando arranca el contenedor. Cambiar el ConfigMap no cambia los pods que ya corren: sólo los que arranquen después.', 'Variables that come from a ConfigMap are fixed when the container starts. Changing the ConfigMap does not change pods that are already running: only those that start afterwards.') },
  { id: 'crashloop', t: 'CrashLoopBackOff', d: T('El contenedor arranca y muere una y otra vez; el kubelet espera cada vez más entre intentos (10 s, 20 s, 40 s… hasta 5 min). No es la causa: es el síntoma de que el proceso sale.', 'The container starts and dies over and over; the kubelet waits longer each time between attempts (10 s, 20 s, 40 s… up to 5 min). It is not the cause: it is the symptom that the process exits.') },
  { id: 'logs-previous', t: 'kubectl logs --previous', d: T('El log del contenedor anterior, el que murió. En un CrashLoopBackOff es donde está el motivo.', 'The log of the previous container, the one that died. In a CrashLoopBackOff that is where the reason is.') },
  { id: 'imagepullbackoff', t: 'ImagePullBackOff', d: T('El nodo no consigue descargar la imagen: etiqueta que no existe, registro inaccesible o sin credenciales. El contenedor ni siquiera arranca.', 'The node cannot pull the image: a tag that does not exist, an unreachable registry or no credentials. The container does not even start.') },
  { id: 'registro', t: T('Registro de imágenes', 'Image registry'), d: T('Donde CI publica las imágenes. Una imagen se pide por repositorio y etiqueta (repo:tag); la API /v2/REPO/tags/list dice qué etiquetas existen.', 'Where CI publishes images. An image is requested by repository and tag (repo:tag); the /v2/REPO/tags/list API says which tags exist.') },
  { id: 'oomkilled', t: 'OOMKilled', d: T('El kernel mató el contenedor por pasar de su límite de memoria. Exit code 137 y ni una línea de error en el log de la aplicación: se ve en describe pod, en Last State.', 'The kernel killed the container for going over its memory limit. Exit code 137 and not a single error line in the application log: you see it in describe pod, under Last State.') },
  { id: 'limites', t: T('Límites (limits)', 'Limits'), d: T('Lo máximo que puede usar un contenedor. Pasarse de memoria es la muerte (OOMKilled); pasarse de CPU es ir más lento (throttling). Protegen al resto del nodo.', 'The most a container may use. Going over memory means death (OOMKilled); going over CPU means going slower (throttling). They protect the rest of the node.') },
  { id: 'requests', t: T('Peticiones (requests)', 'Requests'), d: T('Lo que un contenedor reserva. El scheduler coloca pods sumando requests, no el consumo real: si los requests mienten, el nodo se llena de verdad aunque «quepa».', 'What a container reserves. The scheduler places pods by adding up requests, not real usage: if requests lie, the node really fills up even though it "fits".') },
  { id: 'readiness', t: 'Readiness probe', d: T('La pregunta «¿estás listo para recibir tráfico?». Si falla, el pod sigue vivo pero sale de los endpoints, y un rolling update no avanza. Un fallo aquí protege, no rompe.', 'The question "are you ready to receive traffic?". If it fails, the pod stays alive but leaves the endpoints, and a rolling update does not advance. A failure here protects, it does not break.') },
  { id: 'scheduler', t: 'Scheduler', d: T('Decide en qué nodo va cada pod: descarta los que no valen (taints, cordon, requests que no caben) y elige entre el resto. Si no vale ninguno, el pod se queda en Pending y lo explica en un evento FailedScheduling.', 'Decides which node each pod goes on: it rules out those that do not fit (taints, cordon, requests that do not fit) and picks among the rest. If none fits, the pod stays Pending and explains why in a FailedScheduling event.') },
  { id: 'pending', t: 'Pending', d: T('Un pod que existe pero no tiene nodo. kubectl logs no tiene nada que enseñar; describe pod, sí: el motivo del scheduler.', 'A pod that exists but has no node. kubectl logs has nothing to show; describe pod does: the scheduler\'s reason.') },
  { id: 'cordon-drain', t: 'cordon / drain / uncordon', d: T('cordon marca un nodo como no programable (no recibe pods nuevos, los que tiene siguen). drain = cordon + desalojar sus pods. uncordon lo devuelve. Un mantenimiento termina con uncordon.', 'cordon marks a node unschedulable (it gets no new pods, the ones it has stay). drain = cordon + evict its pods. uncordon gives it back. A maintenance ends with uncordon.') },
  { id: 'taint', t: 'Taint', d: T('Una marca en un nodo que repele pods que no la toleran. El control plane lleva una para que no le caigan aplicaciones; un nodo en cordon lleva node.kubernetes.io/unschedulable.', 'A mark on a node that repels pods that do not tolerate it. The control plane carries one so applications do not land there; a cordoned node carries node.kubernetes.io/unschedulable.') },
  { id: 'kubectl-diff', t: 'kubectl diff', d: T('Enseña qué cambiaría en el clúster si aplicaras un manifiesto. Se mira antes de cada apply.', 'Shows what would change in the cluster if you applied a manifest. You look at it before every apply.') },
  { id: 'deriva', t: T('Deriva (drift)', 'Drift'), d: T('La diferencia entre lo que dice el repositorio y lo que hay en el clúster, normalmente por un cambio a mano (kubectl edit, set, patch). El siguiente apply la deshace, o queda escondida.', 'The difference between what the repository says and what is in the cluster, usually from a manual change (kubectl edit, set, patch). The next apply undoes it, or it stays hidden.') },
  { id: 'gitops', t: T('El repositorio es la verdad', 'The repository is the truth'), d: T('Los manifiestos versionados describen el estado deseado; se despliega aplicándolos (o con una herramienta GitOps como Argo CD). Desplegar a mano con set image se salta el contrato completo de la versión.', 'Versioned manifests describe the desired state; you deploy by applying them (or with a GitOps tool such as Argo CD). Deploying by hand with set image skips the release\'s full contract.') },
  { id: 'change-cause', t: 'CHANGE-CAUSE', d: T('Una anotación (kubernetes.io/change-cause) que sale en kubectl rollout history: quién o qué hizo cada revisión. Si las herramientas la rellenan, el historial cuenta la historia.', 'An annotation (kubernetes.io/change-cause) shown by kubectl rollout history: who or what made each revision. If tools fill it in, the history tells the story.') },
  { id: 'top', t: 'kubectl top', d: T('Consumo real de CPU y memoria (vía metrics-server), frente a lo que cada pod pide y su límite.', 'Real CPU and memory usage (via metrics-server), against what each pod requests and its limit.') },
  { id: 'namespace', t: 'Namespace', d: T('Un espacio de nombres dentro del clúster. Sin -n, kubectl mira el namespace por defecto, y «No resources found» suele ser eso.', 'A name space inside the cluster. Without -n, kubectl looks at the default namespace, and "No resources found" is usually just that.') },
  { id: 'kubelet', t: 'kubelet', d: T('El agente de cada nodo: arranca los contenedores (a través de containerd), los reinicia, ejecuta las sondas e informa del estado del nodo. Si se para, el nodo pasa a NotReady.', 'The agent on each node: it starts containers (through containerd), restarts them, runs the probes and reports the node\'s status. If it stops, the node goes NotReady.') },
  { id: 'alertmanager', t: 'Alertmanager', d: T('Recibe las alertas de Prometheus (aquí, las reglas de kube-prometheus: KubePodCrashLooping, KubeDeploymentReplicasMismatch…) y las agrupa y notifica. amtool alert lista las activas.', 'Receives Prometheus\' alerts (here, the kube-prometheus rules: KubePodCrashLooping, KubeDeploymentReplicasMismatch…) and groups and notifies them. amtool alert lists the active ones.') },
];
})(window.PUESTO = window.PUESTO || {});
