// Comprueba el Puesto DevOps sin navegador.
//
//   node puesto-devops/devops-test.js
//
// Como en los otros puestos, lo importante no es que arranque: es que cada
// ticket se resuelva con comandos de verdad, que los arreglos a medias NO lo
// cierren, que el clúster se comporte como Kubernetes (un rolling update no
// quita los pods viejos hasta que los nuevos están listos, un ConfigMap se lee
// al arrancar, el scheduler suma requests) y que el mismo guion dé siempre lo mismo.
const fs = require('fs'), path = require('path');
const D = __dirname, LINUX = path.join(D, '..', 'puesto-linux');
function cargar(idioma) {
  const win = { PUESTO: { idioma } };
  [path.join(D, 'topologia.js'), path.join(LINUX, 'motor.js'), path.join(D, 'cluster.js'), path.join(D, 'kubectl.js'), path.join(D, 'recursos.js'), path.join(D, 'helm.js'), path.join(D, 'nodos.js'), path.join(D, 'gitops.js'), path.join(D, 'averias.js'), path.join(D, 'escenarios.js'), path.join(LINUX, 'incidencias.js'), path.join(D, 'guardia.js'), path.join(D, 'soluciones.js'), path.join(D, 'ui.js')]
    .forEach(f => new Function('window', fs.readFileSync(f, 'utf8'))(win));
  return win.PUESTO;
}
const P = cargar('es'), K = P.k8s;

let fallos = 0;
const mal = m => { console.error('  ✕ ' + m); fallos++; };
const bien = m => console.log('  ✓ ' + m);
function correr(P, st, cmds, ses) {
  ses = ses || P.nuevaSesion();
  const salida = [];
  cmds.forEach(c => { const r = P.ejecutar(st, ses, c); salida.push({ cmd: c, lineas: r.lineas }); P.expulsar(st, ses); });
  return { ses, salida, texto: salida.map(x => '$ ' + x.cmd + '\n' + x.lineas.map(l => l.t).join('\n')).join('\n') };
}
const texto = (r, i) => r.salida[i].lineas.map(l => l.t).join('\n');
const dep = (st, n) => st.k8s.deps['pagos/' + n];

console.log('Puesto DevOps · Kubernetes en producción\n');

// ------------------------------------------------------------ plataforma sana
console.log('  clúster de partida:');
{
  const st = P.crear();
  const al = P.alertasActivas(st);
  if (al.length) mal('el clúster sano ya tiene alertas: ' + al.map(a => a.nombre).join(', '));
  const raros = st.k8s.pods.filter(p => K.estadoPod(st, p) !== 'Running' || !K.listo(st, p));
  if (raros.length) mal('pods que no están Running y listos al empezar: ' + raros.map(p => p.nombre).join(', '));
  const sinTerminar = Object.values(st.k8s.deps).filter(d => !K.completo(st, d));
  if (sinTerminar.length) mal('deployments a medias al empezar: ' + sinTerminar.map(d => d.nombre).join(', '));
  if (K.deriva(st).length) mal('el clúster sano ya tiene deriva respecto a ~/k8s: ' + K.deriva(st).join(', '));
  const r = correr(P, st, ['kubectl diff -f ~/k8s/', 'kubectl apply -f ~/k8s/api-pagos/', 'kubectl get pods', 'kubectl get nodes']);
  if (texto(r, 0).trim()) mal('kubectl diff sobre el clúster sano no sale vacío');
  if (!/unchanged/.test(texto(r, 1)) || /configured/.test(texto(r, 1))) mal('apply del repositorio sobre el clúster sano no dice unchanged: ' + texto(r, 1));
  if (texto(r, 2) !== 'No resources found in default namespace.') mal('kubectl get pods sin -n debería mirar el namespace default: ' + texto(r, 2));
  if (!/worker-03\s+Ready\s/.test(texto(r, 3))) mal('get nodes no enseña los workers Ready');
  // Las réplicas de cada aplicación se reparten entre nodos, como el scheduler de verdad.
  const ap = K.podsDe(st, dep(st, 'api-pagos')).map(p => p.nodo);
  if (new Set(ap).size !== 3) mal('las 3 réplicas de api-pagos no están en 3 nodos distintos: ' + ap.join(', '));
  if (!fallos) bien('sin alertas, todo Running y listo, sin deriva, réplicas repartidas, y kubectl sin -n mira default');
}

// ------------------------------------------------------------ la mecánica de Kubernetes
console.log('\n  Kubernetes se comporta como Kubernetes:');
{
  let malos = 0;
  // 1. Un rolling update con una imagen que no existe no tira el servicio.
  {
    const st = P.crear();
    const r = correr(P, st, ['kubectl set image deployment/api-pagos api-pagos=' + K.REGISTRO + '/api-pagos:9.9.9 -n pagos', 'sleep 120', 'kubectl get pods -n pagos -l app=api-pagos', 'kubectl get endpoints api-pagos -n pagos']);
    const t = texto(r, 2);
    if ((t.match(/1\/1\s+Running/g) || []).length !== 3 || !/ImagePullBackOff|ErrImagePull/.test(t)) { mal('rolling update con imagen inexistente: deberían quedar 3 viejos sanos y 1 nuevo en ImagePullBackOff\n' + t); malos++; }
    if ((texto(r, 3).match(/:8080/g) || []).length !== 3) { mal('durante un rolling update atascado los 3 pods viejos deben seguir en los endpoints'); malos++; }
    const r2 = correr(P, st, ['kubectl rollout status deployment/api-pagos -n pagos']);
    if (!/exceeded its progress deadline/.test(texto(r2, 0))) { mal('rollout status de un rollout atascado debería acabar en «exceeded its progress deadline»: ' + texto(r2, 0)); malos++; }
    if (!P.alertasActivas(st).some(a => a.nombre === 'KubeDeploymentRolloutStuck')) { mal('un rollout atascado no dispara KubeDeploymentRolloutStuck'); malos++; }
    const r3 = correr(P, st, ['kubectl rollout undo deployment/api-pagos -n pagos', 'kubectl rollout status deployment/api-pagos -n pagos']);
    if (!/successfully rolled out/.test(texto(r3, 1)) || P.alertasActivas(st).length) { mal('rollout undo no devuelve el clúster a sano'); malos++; }
  }
  // 2. Un ConfigMap se lee al arrancar: los pods que corren no se enteran.
  {
    const st = P.crear();
    correr(P, st, ['kubectl patch configmap api-pagos-config -n pagos -p \'{"data":{"PASARELA_URL":null}}\'', 'sleep 300']);
    if (K.podsDe(st, dep(st, 'api-pagos')).some(p => !K.listo(st, p))) { mal('cambiar el ConfigMap ha afectado a pods que ya corrían'); malos++; }
    const p = K.podsDe(st, dep(st, 'api-pagos'))[0];
    const r = correr(P, st, ['kubectl delete pod ' + p.nombre + ' -n pagos', 'sleep 60', 'kubectl get pods -n pagos -l app=api-pagos']);
    if (!/CrashLoopBackOff/.test(texto(r, 2))) { mal('un pod nuevo con el ConfigMap roto debería quedar en CrashLoopBackOff\n' + texto(r, 2)); malos++; }
    const q = K.podsDe(st, dep(st, 'api-pagos')).find(x => x.c.razon === 'CrashLoopBackOff');
    const r2 = correr(P, st, ['kubectl logs ' + q.nombre + ' -n pagos --previous', 'kubectl logs ' + K.podsDe(st, dep(st, 'api-pagos')).find(x => K.listo(st, x)).nombre + ' -n pagos --previous']);
    if (!/PASARELA_URL is required/.test(texto(r2, 0))) { mal('logs --previous no cuenta por qué murió'); malos++; }
    if (!/previous terminated container .* not found/.test(texto(r2, 1))) { mal('logs --previous de un pod que nunca murió debería dar el error de kubectl'); malos++; }
  }
  // 3. Pasarse del límite de memoria: OOMKilled, exit 137, sin rastro en el log.
  {
    const st = P.crear();
    correr(P, st, ['kubectl set resources deployment/antifraude -n pagos --limits=memory=512Mi --requests=memory=256Mi', 'sleep 480']);
    const p = K.podsDe(st, dep(st, 'antifraude')).find(x => x.c.ultimo);
    if (!p || p.c.ultimo.razon !== 'OOMKilled') { mal('un límite de memoria por debajo del consumo no acaba en OOMKilled'); malos++; }
    else {
      const r = correr(P, st, ['kubectl describe pod ' + p.nombre + ' -n pagos', 'kubectl logs ' + p.nombre + ' -n pagos --previous']);
      if (!/Reason:\s+OOMKilled/.test(texto(r, 0)) || !/Exit Code:\s+137/.test(texto(r, 0))) { mal('describe pod no enseña OOMKilled y exit 137'); malos++; }
      if (/ERROR|fatal/i.test(texto(r, 1)) || !/Loading model/.test(texto(r, 1))) { mal('el log de un OOMKilled debería cortarse en seco, sin error'); malos++; }
    }
    const r = correr(P, st, ['kubectl set resources deployment/antifraude -n pagos --requests=memory=2Gi']);
    if (!/must be less than or equal to memory limit/.test(texto(r, 0))) { mal('un request por encima del límite debería rechazarse'); malos++; }
  }
  // 4. cordon y el scheduler: sin sitio, Pending con su motivo; uncordon, colocado.
  {
    const st = P.crear();
    const r = correr(P, st, ['kubectl drain worker-03', 'kubectl drain worker-03 --ignore-daemonsets', 'kubectl get pods -n pagos -o wide', 'kubectl scale deployment/liquidaciones -n pagos --replicas=4', 'sleep 60']);
    if (!/cannot delete DaemonSet-managed Pods/.test(texto(r, 0))) { mal('drain sin --ignore-daemonsets debería negarse'); malos++; }
    if (/worker-03/.test(texto(r, 2))) { mal('después de drain sigue habiendo pods de pagos en worker-03'); malos++; }
    const pend = K.podsDe(st, dep(st, 'liquidaciones')).filter(p => !p.nodo);
    if (pend.length !== 2) { mal('con worker-03 en cordon deberían quedar 2 liquidaciones en Pending (hay ' + pend.length + ')'); malos++; }
    else {
      const r2 = correr(P, st, ['kubectl describe pod ' + pend[0].nombre + ' -n pagos', 'kubectl logs ' + pend[0].nombre + ' -n pagos', 'kubectl uncordon worker-03', 'sleep 120']);
      if (!/FailedScheduling.*were unschedulable.*Insufficient cpu/.test(texto(r2, 0))) { mal('el motivo del scheduler no dice que hay un nodo unschedulable y falta CPU:\n' + texto(r2, 0).split('\n').slice(-3).join('\n')); malos++; }
      if (!/does not have a host assigned/.test(texto(r2, 1))) { mal('logs de un pod Pending debería decir que no tiene nodo'); malos++; }
      if (K.podsDe(st, dep(st, 'liquidaciones')).some(p => !K.listo(st, p))) { mal('tras uncordon los pendientes no se colocan solos'); malos++; }
    }
  }
  // 5. Un selector que no casa: cero endpoints y el pago falla, con los pods sanos.
  {
    const st = P.crear();
    const r = correr(P, st, ['kubectl patch svc api-pagos -n pagos -p \'{"spec":{"selector":{"version":"v2"}}}\'', 'kubectl get endpoints api-pagos -n pagos', 'curl -s ' + K.URL_PAGO, 'kubectl patch svc api-pagos -n pagos -p \'{"spec":{"selector":{"version":null}}}\'', 'curl -s ' + K.URL_PAGO]);
    if (!/<none>/.test(texto(r, 1)) || !/502/.test(texto(r, 2))) { mal('un selector que no casa debería dejar el Service sin endpoints y el pago en 502'); malos++; }
    if (!/"estado":"ok"/.test(texto(r, 4))) { mal('quitar la clave del selector con null debería arreglarlo'); malos++; }
  }
  // 6. Una readiness probe que falla: Running 0/1, fuera de los endpoints.
  {
    const st = P.crear();
    correr(P, st, ['kubectl patch deployment web-checkout -n pagos -p \'{"spec":{"template":{"spec":{"containers":[{"name":"web-checkout","readinessProbe":{"httpGet":{"path":"/nope"}}}]}}}}\'', 'sleep 120']);
    const malo = K.podsDe(st, dep(st, 'web-checkout')).find(p => p.c.estado === 'corriendo' && !K.listo(st, p));
    if (!malo) { mal('una readiness probe a una ruta que no existe debería dejar un pod Running pero no listo'); malos++; }
    else if (K.endpoints(st, st.k8s.svcs['pagos/web-checkout']).some(p => p === malo)) { mal('un pod no listo no debe estar en los endpoints'); malos++; }
    const r = correr(P, st, ['kubectl exec ' + malo.nombre + ' -n pagos -- wget -qO- localhost/nope', 'kubectl exec ' + malo.nombre + ' -n pagos -- wget -qO- localhost/health']);
    if (!/404/.test(texto(r, 0)) || texto(r, 1) !== 'ok') { mal('exec dentro del pod no contesta como la aplicación'); malos++; }
  }
  // 7. Un nodo que se reinicia vuelve solo, y sus pods arrancan otra vez.
  {
    const st = P.crear();
    const r = correr(P, st, ['ssh worker-01', 'sudo reboot', 'kubectl get nodes']);
    if (!/worker-01\s+NotReady/.test(texto(r, 2))) { mal('un nodo reiniciándose debería salir NotReady'); malos++; }
    correr(P, st, ['sleep 360']);
    if (!K.nodoListo(st, st.k8s.nodos['worker-01']) || P.alertasActivas(st).length) { mal('el nodo no vuelve a Ready o deja alertas: ' + P.alertasActivas(st).map(a => a.nombre).join(', ')); malos++; }
  }
  // 8. Lo que no se puede hacer, se dice.
  {
    const st = P.crear();
    const r = correr(P, st, ['kubectl get pod no-existe -n pagos', 'kubectl get cosas', 'kubectl edit deployment api-pagos -n pagos', 'kubectl set image deployment/api-pagos otro=x:1 -n pagos', 'kubectl apply -f /etc/passwd']);
    if (!/NotFound\): pods "no-existe" not found/.test(texto(r, 0))) { mal('get de un pod que no existe: ' + texto(r, 0)); malos++; }
    if (!/doesn't have a resource type "cosas"/.test(texto(r, 1))) { mal('get de un tipo que no existe: ' + texto(r, 1)); malos++; }
    if (!/apply -f/.test(texto(r, 2))) { mal('kubectl edit debería explicar cómo se cambian las cosas en el simulador'); malos++; }
    if (!/unable to find container named "otro"/.test(texto(r, 3))) { mal('set image con un contenedor que no existe: ' + texto(r, 3)); malos++; }
    if (!/does not exist|error validating/.test(texto(r, 4))) { mal('apply de algo que no es un manifiesto'); malos++; }
  }
  if (!malos) bien('rolling update que protege, ConfigMap leído al arrancar, OOMKilled, cordon y el scheduler, selector sin endpoints, readiness, reinicio de un nodo y los errores de kubectl');
}

// ------------------------------------------------------------ fase 2: almacenamiento, entrada, escalado, RBAC, red y Helm
console.log('\n  fase 2 (PVC, certificados, HPA, RBAC, NetworkPolicies, Helm):');
{
  let malos = 0;
  const ko = m => { mal(m); malos++; };
  // Un PVC se amplía en caliente si la StorageClass lo permite, y nunca encoge.
  {
    const st = P.crear(), m = K.copia(st.k8s.repo['monitoring/prometheus-pvc.yaml']);
    m.tam = 40; if (!/can not be less than previous value/.test(K.aplicar(st, m, 0))) ko('encoger un PVC debería rechazarse');
    m.tam = 80; K.aplicar(st, m, 0); P.avanzar(st, 3);
    if (st.k8s.pvcs['monitoring/prometheus-data'].tam !== 80) ko('ampliar un PVC en una StorageClass expandible debería hacerse en caliente');
    st.k8s.pvcs['monitoring/prometheus-data'].sc = 'longhorn-static'; m.tam = 90; m.sc = 'longhorn-static';
    if (!/only dynamically provisioned pvc can be resized/.test(K.aplicar(st, m, 0))) ko('ampliar en una StorageClass sin expansión debería rechazarse');
  }
  // cert-manager vuelve a emitir si se borra el Secret y el emisor existe; curl -k se salta la verificación.
  {
    const st = P.crear(), r = correr(P, st, ['kubectl delete secret checkout-tls -n pagos', 'kubectl get certificate -n pagos', 'curl -s ' + K.URL_PAGO]);
    if (!/checkout-tls\s+True/.test(texto(r, 1)) || !/"estado":"ok"/.test(texto(r, 2))) ko('con el emisor sano, cert-manager debería volver a emitir el certificado borrado');
    const s = st.k8s.secrets['pagos/checkout-tls']; s.hasta = st.reloj - 5; s.desde = s.hasta - 129600; st.k8s.issuers = {};
    const r2 = correr(P, st, ['curl -s ' + K.URL_PAGO, 'curl -sk ' + K.URL_PAGO]);
    if (!/certificate has expired/.test(texto(r2, 0)) || !/"estado":"ok"/.test(texto(r2, 1))) ko('un certificado caducado: curl falla, curl -k pasa');
  }
  // La HPA sube enseguida, baja tras 5 minutos de calma, y deshace un kubectl scale.
  {
    const st = P.crear(); st.k8s.carga['api-pagos'] = 650; P.avanzar(st, 3);
    if (dep(st, 'api-pagos').replicas !== 6) ko('con 650 req/s la HPA debería subir api-pagos a 6 (está en ' + dep(st, 'api-pagos').replicas + ')');
    st.k8s.carga['api-pagos'] = 180; P.avanzar(st, 3);
    if (dep(st, 'api-pagos').replicas !== 6) ko('la HPA no debería bajar antes de 5 minutos de calma');
    P.avanzar(st, 4);
    if (dep(st, 'api-pagos').replicas !== 3) ko('pasados 5 minutos de calma la HPA debería volver al mínimo (está en ' + dep(st, 'api-pagos').replicas + ')');
    correr(P, st, ['kubectl scale deployment/api-pagos -n pagos --replicas=9', 'sleep 60']);
    if (dep(st, 'api-pagos').replicas === 9) ko('con HPA, kubectl scale debería durar sólo hasta la siguiente vuelta de la HPA');
    const sinReq = P.crear();
    correr(P, sinReq, ['kubectl set resources deployment/api-pagos -n pagos --requests=cpu=0', 'sleep 120']);
    delete dep(sinReq, 'api-pagos').tpl.req.cpu;
    P.avanzar(sinReq, 3);
    const r = correr(P, sinReq, ['kubectl get hpa -n pagos']);
    if (!/<unknown>\/70%/.test(texto(r, 0))) ko('sin request de CPU la HPA debería enseñar <unknown>: ' + texto(r, 0));
  }
  // RBAC: sólo suma; un binding lo concede y quitarlo lo retira.
  {
    const st = P.crear(), as = ' --as=system:serviceaccount:ci:deployer';
    const r = correr(P, st, ['kubectl auth can-i get secrets -n pagos' + as, 'kubectl create rolebinding prueba --clusterrole=edit --serviceaccount=ci:deployer -n pagos', 'kubectl auth can-i get secrets -n pagos' + as, 'kubectl delete rolebinding prueba -n pagos', 'kubectl auth can-i get secrets -n pagos' + as, 'kubectl auth can-i delete nodes', 'kubectl auth can-i delete deployments -n monitoring' + as]);
    if (texto(r, 0) !== 'no' || texto(r, 2) !== 'yes' || texto(r, 4) !== 'no') ko('RBAC: get secrets debería ser no, yes con edit, y no al quitarlo');
    if (texto(r, 5) !== 'yes' || texto(r, 6) !== 'no') ko('RBAC: sre-admin es cluster-admin; el deployer no puede nada fuera de pagos');
  }
  // NetworkPolicies: descartan (timeout); sin endpoints, refused. Borrar default-deny no abre lo que otra política selecciona.
  {
    const st = P.crear(), api = K.podsDe(st, dep(st, 'api-pagos'))[0], web = K.podsDe(st, dep(st, 'web-checkout'))[0];
    const r = correr(P, st, ['kubectl exec ' + web.nombre + ' -n pagos -- wget -qO- antifraude:8080/actuator/health', 'kubectl exec ' + api.nombre + ' -n pagos -- curl -s antifraude:8080/actuator/health', 'kubectl exec ' + api.nombre + ' -n pagos -- curl -s antifraude.pagos.svc.cluster.local:8080/actuator/health', 'kubectl exec ' + api.nombre + ' -n pagos -- curl -s noexiste:8080/']);
    if (!/timed out/.test(texto(r, 0))) ko('web-checkout no debería llegar a antifraude (ninguna política lo permite): timeout');
    if (texto(r, 1) !== '{"status":"UP"}' || texto(r, 2) !== '{"status":"UP"}') ko('api-pagos sí debería llegar a antifraude, por nombre corto y por FQDN');
    if (!/Could not resolve host/.test(texto(r, 3))) ko('un Service que no existe no resuelve');
    correr(P, st, ['kubectl scale deployment/antifraude -n pagos --replicas=0', 'sleep 60']);
    const r2 = correr(P, st, ['kubectl exec ' + api.nombre + ' -n pagos -- curl -s antifraude:8080/actuator/health']);
    if (!/Couldn't connect to server/.test(texto(r2, 0))) ko('un Service sin endpoints da connection refused, no timeout: ' + texto(r2, 0));
    const st2 = P.crear(), w2 = K.podsDe(st2, dep(st2, 'web-checkout'))[0];
    const r3 = correr(P, st2, ['kubectl delete netpol default-deny-ingress -n pagos', 'kubectl exec ' + w2.nombre + ' -n pagos -- wget -qO- antifraude:8080/actuator/health']);
    if (!/timed out/.test(texto(r3, 1))) ko('borrar default-deny no debería abrir antifraude: otras políticas lo siguen seleccionando');
  }
  // Helm: pending-upgrade bloquea, list lo esconde, rollback lo cierra, y un upgrade sin values vuelve a los del chart.
  {
    const st = P.crear(), rel = K.helm.release(st, 'ingress-nginx', 'ingress-nginx');
    rel.historia.push({ rev: 7, chartV: '4.11.5', app: '1.11.5', estado: 'pending-upgrade', min: -5, desc: 'Preparing upgrade', values: {} });
    const r = correr(P, st, ['helm list -n ingress-nginx', 'helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version 4.11.5 -n ingress-nginx', 'kubectl get secrets -n ingress-nginx', 'helm rollback ingress-nginx 6 -n ingress-nginx', 'helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version 4.11.5 -n ingress-nginx', 'kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx', 'helm upgrade ingress-nginx ingress-nginx/ingress-nginx --version 9.9.9 -n ingress-nginx']);
    if (/ingress-nginx\s+ingress-nginx/.test(texto(r, 0))) ko('helm list sin -a no debería enseñar un release en pending-upgrade');
    if (!/another operation \(install\/upgrade\/rollback\) is in progress/.test(texto(r, 1))) ko('un upgrade con una revisión pending-upgrade debería fallar');
    if (!/sh\.helm\.release\.v1\.ingress-nginx\.v7/.test(texto(r, 2))) ko('cada revisión de Helm debería verse como un Secret');
    if (!/Rollback was a success/.test(texto(r, 3)) || !/has been upgraded/.test(texto(r, 4))) ko('rollback y después upgrade deberían funcionar');
    if (st.k8s.deps['ingress-nginx/ingress-nginx-controller'].replicas !== 1) ko('un upgrade sin -f ni --reuse-values debería volver a 1 réplica (los valores del chart)');
    if (!/matching 9\.9\.9 not found/.test(texto(r, 6))) ko('una versión de chart que no existe debería decirlo');
  }
  if (!malos) bien('PVC que crece en caliente y no encoge, cert-manager que renueva, HPA que sube, se estabiliza y gana a kubectl scale, RBAC que sólo suma, NetworkPolicies que descartan (timeout frente a refused) y Helm con pending-upgrade, rollback y values');
}

// ------------------------------------------------------------ fase 3: GitOps, CI, nodos
console.log('\n  fase 3 (git, Argo CD, CI, nodos que caen):');
{
  let malos = 0;
  const ko = m => { mal(m); malos++; };
  // Argo lee lo empujado: un commit local no cambia nada hasta el push. Con self-heal, un cambio a mano dura un minuto.
  {
    const st = P.crear(), app = K.argoApp(st, 'web-checkout'), nuevo = K.copia(st.k8s.repo['web-checkout/deployment.yaml']);
    nuevo.tpl.imagen = K.REGISTRO + '/web-checkout:1.8.2';
    K.commit(st, { min: 0, autor: 'test', msg: 'prueba', cambios: [{ ruta: 'web-checkout/deployment.yaml', despues: nuevo }], empujado: false });
    if (K.argoEstado(st, app).sync !== 'Synced') ko('un commit sin empujar no debería poner la aplicación OutOfSync');
    Object.assign(app, { auto: true, selfHeal: true });
    const r = correr(P, st, ['cd ~/k8s', 'git status', 'git push', 'cd', 'sleep 60']);
    if (!/ahead of 'origin\/main' by 1 commit/.test(texto(r, 1))) ko('git status debería decir que hay un commit sin empujar');
    if (!/1\.8\.2$/.test(dep(st, 'web-checkout').tpl.imagen)) ko('con auto-sync, Argo debería aplicar lo empujado');
    correr(P, st, ['kubectl rollout undo deployment/web-checkout -n pagos', 'sleep 60']);
    if (!/1\.8\.2$/.test(dep(st, 'web-checkout').tpl.imagen)) ko('con self-heal, Argo debería deshacer el rollout undo hecho a mano');
    const r2 = correr(P, st, ['argocd app rollback web-checkout 0']);
    if (!/rollback cannot be initiated when auto-sync is enabled/.test(texto(r2, 0))) ko('argocd app rollback con auto-sync debería negarse');
    const r3 = correr(P, st, ['cd ~/k8s', 'git revert HEAD --no-edit', 'git push', 'cd', 'kubectl rollout status deployment/web-checkout -n pagos']);
    if (!/1\.8\.3$/.test(dep(st, 'web-checkout').tpl.imagen) || !/successfully rolled out/.test(texto(r3, 4))) ko('git revert + push debería volver a la 1.8.3');
  }
  // Un nodo NotReady pierde sus pods a los 5 minutos; con swap y fstab, el kubelet vuelve a caer al reiniciar.
  {
    const st = P.crear(), en2 = () => st.k8s.pods.filter(p => p.nodo === 'worker-02' && p.rs).length;
    const antes = en2();
    correr(P, st, ['ssh worker-02', 'sudo systemctl stop kubelet', 'exit', 'sleep 180']);
    if (en2() !== antes) ko('antes de 5 minutos NotReady no se desaloja nada');
    correr(P, st, ['sleep 240']);
    if (en2() !== 0) ko('a los 5 minutos NotReady los pods del nodo deberían desalojarse');
    if (Object.values(st.k8s.deps).some(d => !K.completo(st, d))) ko('los pods desalojados deberían volver a estar listos en otros nodos');
    const h = st.hosts['worker-03']; Object.assign(h.extra, { swap: false, fstabSwap: true });
    correr(P, st, ['ssh worker-02', 'sudo systemctl start kubelet', 'exit', 'ssh worker-03', 'sudo reboot', 'sleep 300']);
    if (K.nodoListo(st, st.k8s.nodos['worker-03']) || h.svcs.kubelet.estado !== 'failed') ko('con el swap en /etc/fstab, el kubelet debería volver a fallar tras reiniciar');
    const r = correr(P, st, ['ssh worker-03', 'free -h', 'sudo swapoff -a', "sudo sed -i '/swap/ s/^/#/' /etc/fstab", 'cat /etc/fstab', 'sudo systemctl restart kubelet', 'exit']);
    if (!/Swap:\s+8\.0Gi/.test(texto(r, 1)) || !/^#\/swapfile/m.test(texto(r, 4)) || !K.nodoListo(st, st.k8s.nodos['worker-03'])) ko('free enseña el swap, sed lo comenta en fstab y el kubelet vuelve');
  }
  if (!malos) bien('Argo CD lee lo empujado, self-heal deshace lo hecho a mano, rollback se niega con auto-sync y git revert + push vuelve atrás; un nodo NotReady pierde sus pods a los 5 minutos; swap y fstab tumban el kubelet al reiniciar');
}

// ------------------------------------------------------------ guardias y caos
console.log('\n  guardias y caos:');
{
  let malos = 0;
  for (const n of [1, 2, 3]) for (let s = 1; s <= 30; s++) {
    const g = P.generarGuardia(n, s);
    if (!g.ok) { mal('guardia ' + n + '/' + s + ': no sale jugable'); malos++; continue; }
    const e = g.escenario, st = P.preparar(e);
    if (!P.alertasActivas(st).length) { mal('guardia ' + n + '/' + s + ': sin alertas'); malos++; }
    if (P.familias.find(f => f.id === e.guardia.familias[0] || e.guardia.familias.indexOf(f.id) >= 0 && f.nivel === n) === undefined) { mal('guardia ' + n + '/' + s + ': ninguna familia de su nivel'); malos++; }
    // El determinismo se comprueba en una de cada cinco semillas: generar es lo caro.
    const g2 = s % 5 ? g : P.generarGuardia(n, s);
    if (JSON.stringify(g2.escenario.guardia) !== JSON.stringify(e.guardia) || g2.escenario.inicio !== e.inicio) { mal('guardia ' + n + '/' + s + ': la misma semilla no da la misma noche'); malos++; }
    correr(P, st, P.guionDe(e, st));
    if (e.resuelto(st, P).length || e.practicas.some(p => !p.ok(st))) { mal('guardia ' + n + '/' + s + ': su guion no la cierra con sus prácticas'); malos++; }
  }
  // Caos: rompe algo unos minutos después, y su arreglo lo deja como estaba.
  let caos = 0;
  for (let s = 1; s <= 12; s++) {
    const st = P.crear(), c = P.provocarCaos(st, s, []);
    if (!c) { mal('caos ' + s + ': no programa nada'); malos++; continue; }
    P.avanzar(st, 10);
    if (!P.pendientesCaos(st, [c]).length) { mal('caos ' + s + ' (' + c.familia.id + '): no rompe nada'); malos++; continue; }
    correr(P, st, c.familia.arreglo(st, c.params));
    if (P.pendientesCaos(st, [c]).length) { mal('caos ' + s + ' (' + c.familia.id + '): su arreglo no lo arregla'); malos++; continue; }
    caos++;
  }
  if (!malos) bien('90 guardias (30 semillas × 3 niveles) jugables, con alertas, deterministas y cerradas por su guion con sus prácticas; ' + caos + ' caos que rompen y se arreglan');
}

// ------------------------------------------------------------ tickets
function probarTickets(P, etiqueta) {
  let malos = 0;
  if (P.escenarios.length !== 15) { mal(etiqueta + 'se esperaban 15 tickets y hay ' + P.escenarios.length); malos++; }
  P.escenarios.forEach(e => {
    const st = P.preparar(e), antes = e.resuelto(st, P), al = P.alertasActivas(st);
    if (!antes.length) { mal(etiqueta + e.id + ': nace resuelto'); malos++; return; }
    if (e.tipo === 'incidente' && !al.length) { mal(etiqueta + e.id + ': un incidente sin alertas'); malos++; }
    const pr = P.prioridad(e);
    if (-e.abierto >= pr.sla / 2) { mal(etiqueta + e.id + ': nace con más de medio SLA gastado'); malos++; }
    if (!e.pistas || e.pistas.length !== 3) { mal(etiqueta + e.id + ': no tiene exactamente 3 pistas'); malos++; }
    if (!e.funciones.every(f => P.funciones.some(x => x.id === f))) { mal(etiqueta + e.id + ': función desconocida'); malos++; }
    const g = P.guionDe(e, st), r = correr(P, st, g);
    const raros = r.salida.filter(x => x.lineas.some(l => /: command not found|unknown command/.test(l.t)));
    if (raros.length) { mal(etiqueta + e.id + ': su guion usa comandos que no existen: ' + raros.map(x => x.cmd).join(', ')); malos++; }
    const q = e.resuelto(st, P);
    if (q.length) { mal(etiqueta + e.id + ': su guion no lo resuelve: ' + q.join(' | ')); malos++; }
    const np = e.practicas.filter(p => !p.ok(st));
    if (np.length) { mal(etiqueta + e.id + ': su guion no cumple sus prácticas: ' + np.map(p => p.t).join(' | ')); malos++; }
    // Determinista: el mismo guion, la misma salida.
    const st2 = P.preparar(e), r2 = correr(P, st2, P.guionDe(e, st2));
    if (r2.texto !== r.texto) { mal(etiqueta + e.id + ': el mismo guion da salidas distintas'); malos++; }
    (e.trampas || []).forEach((t, i) => {
      const s3 = P.preparar(e), cmds = typeof t.cmds === 'function' ? t.cmds(s3) : t.cmds;
      correr(P, s3, cmds);
      if (t.practicas) { const pr3 = e.practicas.map(p => p.ok(s3)); if (!t.practicas.some(k => !pr3[k])) { mal(etiqueta + e.id + ' trampa ' + (i + 1) + ': debería fallar la práctica ' + t.practicas.join(',')); malos++; } }
      else if (!e.resuelto(s3, P).length) { mal(etiqueta + e.id + ' trampa ' + (i + 1) + ' lo cierra: ' + t.porque); malos++; }
    });
  });
  return malos;
}
console.log('\n  tickets:');
{
  const E = cargar('en');
  if (!(probarTickets(P, '') + probarTickets(E, '[en] '))) bien(P.escenarios.length + ' tickets: nacen rotos y con alertas, su guion los cierra con todas sus prácticas, siempre igual, y sus trampas no los cierran; en los dos idiomas');
}

// ------------------------------------------------------------ inglés
console.log('\n  en inglés:');
{
  const E = cargar('en'), raros = [];
  const ES = /[áéíóúñ¿¡«»]|(^|[^a-zA-Z\-_./])(el|los|las|que|para|con|sin|una|del|está|hay|pero|sigue|antes|después|nada|cada|desde|tiene|pod de|réplicas)(?=$|[^a-zA-Z\-_./])/i;
  const mira = (donde, t) => { if (t && ES.test(String(t).replace(/Raúl Ortega|Laura Méndez|Iván|api-pagos|web-checkout|antifraude|liquidaciones|pagos(-prod|-db)?|pasarela-pagos|PASARELA_URL|tier=backend/g, ''))) raros.push(donde + ': ' + String(t).slice(0, 90)); };
  E.escenarios.forEach(e => {
    ['asunto', 'de', 'area', 'causa', 'solucion', 'leccion'].forEach(k => mira(e.id + '.' + k, e[k]));
    e.cuerpo.concat(e.pistas).forEach((x, i) => mira(e.id + ' texto ' + i, x));
    e.practicas.forEach((p, i) => mira(e.id + ' práctica ' + i, p.t));
    const st = E.preparar(e);
    e.resuelto(st, E).forEach(x => mira(e.id + ' pendiente', x));
    E.alertasActivas(st).forEach(a => mira(e.id + ' alerta', a.res));
    const r = correr(E, st, E.guionDe(e, st));
    r.salida.forEach(x => x.lineas.forEach(l => mira(e.id + ' $ ' + x.cmd, l.t)));
  });
  E.funciones.forEach(f => mira('función ' + f.id, f.titulo));
  E.familias.forEach(f => { mira('familia ' + f.id, f.titulo); mira('familia ' + f.id, f.leccion); });
  [1, 2, 3].forEach(n => { const g = E.generarGuardia(n, 11); g.escenario.pistas.concat(g.escenario.causa, g.escenario.practicas.map(p => p.t)).forEach(x => mira('guardia ' + n, x)); });
  const st = E.crear(), r = correr(E, st, ['cat ~/LEEME.md', 'cat ~/k8s/README.md', 'help', 'kubectl edit x']);
  r.salida.forEach(x => x.lineas.forEach(l => mira('$ ' + x.cmd, l.t)));
  [E.ui.oferta.titulo, E.ui.oferta.sub, E.ui.oferta.txt, E.ui.sesionNueva, E.ui.alertas].concat(E.ui.como, E.ui.bienvenida('libre'), E.ui.bienvenida('ticket'), E.ui.experimentos.map(x => x[1])).forEach((x, i) => mira('ui ' + i, x));
  raros.forEach(x => mal('[en] parece español: ' + x));
  if (!raros.length) bien('en inglés no queda nada en español: tickets, pistas, prácticas, alertas, ficheros, interfaz y la salida de los ' + E.escenarios.length + ' guiones');
}

// ------------------------------------------------------------ solucionario
console.log('\n  solucionario:');
function probarSolucionario(P, etiqueta) {
  let malos = 0;
  const ids = new Set(P.glosario.map(g => g.id));
  if (ids.size !== P.glosario.length) { mal(etiqueta + 'ids repetidos en el glosario'); malos++; }
  P.escenarios.forEach(e => {
    const s = P.soluciones[e.id];
    if (!s) { mal(etiqueta + e.id + ': no está en el solucionario'); malos++; return; }
    const guion = P.guionDe(e, P.preparar(e));
    if (s.pasos.length !== guion.length) { mal(etiqueta + e.id + ': el solucionario tiene ' + s.pasos.length + ' pasos y el guion ' + guion.length); malos++; return; }
    s.pasos.forEach((p, i) => {
      if (guion[i].indexOf(p[0]) < 0) { mal(etiqueta + e.id + ' paso ' + (i + 1) + ': «' + p[0] + '» no está en «' + guion[i] + '»'); malos++; }
      if (['diag', 'arreglo', 'comprobar', ''].indexOf(p[1]) < 0 || !p[2]) { mal(etiqueta + e.id + ' paso ' + (i + 1) + ': sin fase válida o sin explicación'); malos++; }
    });
    if (!s.pasos.some(p => p[1] === 'comprobar')) { mal(etiqueta + e.id + ': no termina comprobando nada'); malos++; }
    (s.terminos || []).forEach(t => { if (!ids.has(t)) { mal(etiqueta + e.id + ': término de glosario inexistente «' + t + '»'); malos++; } });
  });
  return malos;
}
{
  const E = cargar('en');
  if (!(probarSolucionario(P, '') + probarSolucionario(E, '[en] '))) bien(P.escenarios.length + ' tickets con sus pasos alineados con el guion, en los dos idiomas; ' + P.glosario.length + ' términos de glosario');
}

// ------------------------------------------------------------ catálogo de averías (fase 4)
// Las tres promesas de los otros catálogos: cada avería, sola, rompe algo y su
// arreglo deja el clúster sano; los tickets hechos sólo de averías se cierran
// encadenando sus arreglos; y una combinación inventada también.
console.log('\n  catálogo de averías:');
const ALERTAS = 'amtool alert';
for (const [Q, et] of [[P, ''], [cargar('en'), '[en] ']]) {
  const tipos = Object.keys(Q.averias), rompen = tipos.filter(t => !Q.averias[t].condicion);
  let malos = 0;
  const ES_TXT = /[áéíóúñ¿¡«»]|(^|[^a-zA-Z\-_./])(el|los|las|que|para|con|sin|una|del|está|hay|pero|sigue|antes|después|nada|cada|desde|tiene)(?=$|[^a-zA-Z\-_./])/i;
  tipos.forEach(t => {
    const a = Object.assign({ tipo: t }, Q.averias[t].ejemplo), v = Q.validarAverias([a]);
    if (v.length) { mal(et + t + ': su ejemplo no valida: ' + v.join(' | ')); malos++; return; }
    if (et && [Q.averias[t].titulo, Q.averias[t].descripcion].some(x => ES_TXT.test(x))) { mal(et + t + ': el título o la descripción parecen español'); malos++; }
    const st = Q.crear(); Q.aplicarAverias(st, [a]); Q.refrescarAlertas(st);
    if (Q.averias[t].condicion) { if (Q.alertasActivas(st).length) { mal(et + t + ': una condición sola no debería disparar alertas'); malos++; } return; }
    const antes = Q.pendientesAverias(st, [a]);
    if (!antes.length) { mal(et + t + ': aplicada sola no rompe nada'); malos++; return; }
    if (et && antes.some(x => ES_TXT.test(x))) { mal(et + t + ': lo pendiente parece español: ' + antes.join(' | ')); malos++; }
    const r = correr(Q, st, [ALERTAS].concat(Q.arregloAverias(st, [a])));
    const raros = r.salida.filter(x => x.lineas.some(l => /: command not found|unknown command/.test(l.t)));
    if (raros.length) { mal(et + t + ': su arreglo usa comandos que no existen: ' + raros.map(x => x.cmd).join(', ')); malos++; }
    const quedan = Q.pendientesAverias(st, [a]).concat(Q.alertasActivas(st).map(x => x.nombre));
    if (quedan.length) { mal(et + t + ': su arreglo no la arregla: ' + quedan.join(' | ')); malos++; }
  });
  if (!malos) bien(et + tipos.length + ' tipos de avería (' + rompen.length + ' que rompen, ' + (tipos.length - rompen.length) + ' condiciones): cada una, sola, rompe algo y su arreglo deja el clúster sano y sin alertas');
}
{
  const sinCampo = [];
  Object.keys(P.averias).forEach(t => {
    const c = P.camposAveria[t], ks = (c || []).map(x => x.k), ps = Object.keys(P.averias[t].params);
    if (!c) { sinCampo.push(t + ' (sin campos)'); return; }
    ps.filter(k => ks.indexOf(k) < 0).forEach(k => sinCampo.push(t + '.' + k));
    ks.filter(k => ps.indexOf(k) < 0).forEach(k => sinCampo.push(t + '.' + k + ' (campo sin parámetro)'));
  });
  if (sinCampo.length) mal('parámetros que el compositor no puede editar: ' + sinCampo.join(', '));
  else bien('el compositor tiene un campo para cada parámetro de los ' + Object.keys(P.averias).length + ' tipos');

  let malos = 0;
  const compuestos = P.escenarios.filter(e => !e.objetivo && e.averias.some(a => !P.averias[a.tipo].condicion));
  compuestos.forEach(e => {
    const st = P.preparar(e);
    correr(P, st, [ALERTAS].concat(P.arregloAverias(st, e.averias), [ALERTAS]));
    const q = e.resuelto(st, P);
    if (q.length) { mal(e.id + ': encadenar los arreglos de sus averías no lo cierra: ' + q.join(' | ')); malos++; }
  });
  if (!malos) bien(compuestos.length + ' tickets hechos sólo de averías se cierran encadenando los arreglos del catálogo, sin su guion');

  const inventada = [{ tipo: 'selector-roto', svc: 'web-checkout', etiqueta: 'version=v2', hace: 20 }, { tipo: 'limite-memoria', app: 'antifraude', limite: 400, hace: 60 }, { tipo: 'kubelet-parado', nodo: 'worker-01', hace: 30 },
    { tipo: 'netpol-puerto', pol: 'permitir-ingress-a-api', puerto: 9090, hace: 15 }, { tipo: 'helm-pendiente', version: '4.11.2', hace: 50 }, { tipo: 'reinicio-nodo', nodo: 'worker-02', hace: 70 }];
  const v = P.validarAverias(inventada);
  if (v.length) mal('la combinación inventada no valida: ' + v.join(' | '));
  else {
    const st = P.crear(); P.aplicarAverias(st, inventada); P.refrescarAlertas(st);
    const al = P.alertasActivas(st).length, antes = P.pendientesAverias(st, inventada).length;
    correr(P, st, P.arregloAverias(st, inventada)); P.refrescarAlertas(st);
    const q = P.pendientesAverias(st, inventada).concat(P.alertasActivas(st).map(x => x.nombre));
    if (!al || !antes || q.length) mal('la combinación inventada: ' + al + ' alertas, ' + antes + ' pendientes, y tras arreglar quedan: ' + q.join(' | '));
    else bien('una combinación inventada de 5 averías y una condición valida, dispara ' + al + ' alertas y se cierra encadenando sus arreglos');
  }
  const rechazos = [
    [[{ tipo: 'kaboom' }], /desconocido/], [[{ tipo: 'selector-roto' }], /falta svc/], [[{ tipo: 'kubelet-parado', nodo: 'worker-09' }], /nodo/],
    [[{ tipo: 'imagen-inexistente', app: 'web-checkout', tag: '1.8.2' }], /no rompería/], [[{ tipo: 'kubelet-parado', nodo: 'worker-01' }, { tipo: 'swap-kubelet', nodo: 'worker-02' }], /un nodo/],
    [[{ tipo: 'netpol-puerto', pol: 'permitir-api-a-antifraude', puerto: 8080 }], /no rompería/], [[{ tipo: 'limite-memoria', app: 'antifraude', limite: 2048 }], /no rompería/],
  ].filter(([l, re]) => !P.validarAverias(l).some(x => re.test(x)));
  if (rechazos.length) rechazos.forEach(([l]) => mal('el validador acepta ' + JSON.stringify(l)));
  else bien('el validador rechaza tipos inventados, parámetros que faltan, recursos que no existen, dos nodos fuera a la vez y averías que no romperían nada');
}

// ------------------------------------------------------------ incidencias en fichero
console.log('\n  incidencias en fichero:');
for (const [Q, et] of [[P, ''], [cargar('en'), '[en] ']]) {
  let malos = 0;
  const ex = Q.exportables();
  ex.forEach(e => {
    const d = Q.exportarIncidencia(e), r = Q.cargarIncidencia(JSON.stringify(d));
    if (!r.ok) { mal(et + e.id + ' exportado no se acepta al reimportarlo: ' + r.errores.join(' | ')); malos++; return; }
    const st = Q.preparar(r.escenario);
    correr(Q, st, Q.guionDe(r.escenario, st));
    const q = r.escenario.resuelto(st, Q);
    if (q.length) { mal(et + d.id + ': su solución generada no lo cierra: ' + q.join(' | ')); malos++; }
  });
  if (!malos) bien(et + ex.length + ' tickets exportados como plantilla se reimportan y su solución generada los cierra');
}
{
  const base = { formato: 'puesto-incidencia/1', asunto: 'x', cuerpo: ['y'], impacto: 'medio', urgencia: 'media', averias: [{ tipo: 'selector-roto', svc: 'antifraude', etiqueta: 'a=b' }] };
  const casos = [
    ['{ esto no es json', /JSON/], [Object.assign({}, base, { formato: 'otro/1' }), /formato/], [Object.assign({}, base, { id: 'INC-8101' }), /ya es un ticket/],
    [Object.assign({}, base, { averias: [{ tipo: 'reinicio-nodo', nodo: 'worker-01', hace: 10 }] }), /No rompe nada/], [Object.assign({}, base, { hace: 5000 }), /2000/],
  ].filter(([d, re]) => { const r = P.cargarIncidencia(typeof d === 'string' ? d : JSON.stringify(d)); return r.ok || !r.errores.some(x => re.test(x)); });
  if (casos.length) casos.forEach(([d]) => mal('el cargador acepta o no explica: ' + (typeof d === 'string' ? d : JSON.stringify(d))));
  else bien('rechaza JSON roto, otro formato, el id de un ticket, lo que no rompe nada y lo que pasó hace demasiado');
  let malos = 0;
  P.familias.forEach(f => { for (let s = 1; s <= 5; s++) { const v = P.validarAverias(f.crear(P.azar(s))); if (v.length) { mal('la familia ' + f.id + ' no se dice con el catálogo: ' + v.join(' | ')); malos++; break; } } });
  [1, 2, 3].forEach(n => [7, 1234].forEach(s => {
    const g = P.generarGuardia(n, s), r = g.ok && P.cargarIncidencia(Object.assign({}, g.def));
    if (!r || !r.ok) { mal('la guardia ' + n + '/' + s + ' como fichero no se acepta: ' + (r ? r.errores.join(' | ') : 'no se genera')); malos++; }
  }));
  if (!malos) bien(P.familias.length + ' familias se dicen con el catálogo, y 6 guardias generadas se aceptan como fichero');
}

// ------------------------------------------------------------ compositor
console.log('\n  compositor:');
{
  const win = { PUESTO: { idioma: 'es' } };
  [path.join(D, 'topologia.js'), path.join(LINUX, 'motor.js'), path.join(D, 'cluster.js'), path.join(D, 'kubectl.js'), path.join(D, 'recursos.js'), path.join(D, 'helm.js'), path.join(D, 'nodos.js'), path.join(D, 'gitops.js'), path.join(D, 'averias.js'), path.join(D, 'escenarios.js'), path.join(LINUX, 'incidencias.js'), path.join(D, 'guardia.js')]
    .forEach(f => new Function('window', fs.readFileSync(f, 'utf8'))(win));
  const Q = win.PUESTO, els = {}, almacen = {};
  const el = () => ({ innerHTML: '', textContent: '', classList: { add() {}, toggle() {} }, querySelector: () => null });
  const documento = { querySelector: s => els[s] || (els[s] = el()), querySelectorAll: () => [], addEventListener() {}, body: el() };
  const ls = { getItem: k => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: k => { delete almacen[k]; } };
  new Function('window', 'document', 'localStorage', 'location', fs.readFileSync(path.join(LINUX, 'compositor.js'), 'utf8'))(win, documento, ls, {});
  const C = Q.compositor, html = () => els['#vista'].innerHTML;
  let malos = 0;
  Object.keys(Q.averias).forEach(t => {
    C.cargar({ asunto: 'x', cuerpo: ['y'], averias: [Object.assign({ tipo: t }, JSON.parse(JSON.stringify(Q.averias[t].ejemplo)))] }, t);
    const falta = (Q.camposAveria[t] || []).filter(c => html().indexOf('data-k="' + c.k + '"') < 0).map(c => c.k);
    if (falta.length) { mal('el compositor no pinta ' + t + '.' + falta.join(', ')); malos++; }
    if (!Q.averias[t].condicion && !C.est.res.ok) { mal('el ejemplo de ' + t + ' no sale jugable en el compositor: ' + C.est.res.errores.join(' | ')); malos++; }
  });
  Q.exportables().forEach(e => {
    C.cargar(Q.exportarIncidencia(e), e.id);
    const id = C.guardarEnCola(), g = JSON.parse(almacen['puesto-devops-importadas'] || '[]').find(x => x.id === id);
    if (!C.est.res.ok || !C.est.vista || !g || !Q.cargarIncidencia(g).ok) { mal('partir de ' + e.id + ' y guardarlo no da una incidencia jugable: ' + (C.est.res.errores || []).join(' | ')); malos++; }
  });
  if (Object.keys(almacen).some(k => /puesto-(linux|cloud)/.test(k))) { mal('el compositor de DevOps escribe en la cola de otro puesto'); malos++; }
  C.cargar(JSON.parse(JSON.stringify(Q.generarGuardia(3, 4242).def)), 'guardia');
  if (!C.est.res.ok) { mal('una guardia de nivel 3 no sale jugable en el compositor: ' + C.est.res.errores.join(' | ')); malos++; }
  C.cargar({ asunto: 'x', cuerpo: [''], averias: [{ tipo: 'selector-roto' }] }, 'a medias');
  if (!C.est.res.errores.some(x => /falta svc/.test(x))) { mal('con el ticket a medias, el ensayo no avisa del Service sin elegir'); malos++; }
  if (!malos) bien('pinta los ' + Object.keys(Q.averias).length + ' tipos con un control por campo; ' + Q.exportables().length + ' tickets y una guardia de nivel 3 cargan, se guardan en su propia cola y siguen siendo jugables');
}

console.log('\n' + (fallos ? fallos + ' fallo' + (fallos === 1 ? '' : 's') : 'Todo en orden'));
process.exit(fallos ? 1 : 0);
