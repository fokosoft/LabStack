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
  [path.join(D, 'topologia.js'), path.join(LINUX, 'motor.js'), path.join(D, 'cluster.js'), path.join(D, 'kubectl.js'), path.join(D, 'escenarios.js'), path.join(D, 'soluciones.js'), path.join(D, 'ui.js')]
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

// ------------------------------------------------------------ tickets
function probarTickets(P, etiqueta) {
  let malos = 0;
  if (P.escenarios.length !== 6) { mal(etiqueta + 'se esperaban 6 tickets y hay ' + P.escenarios.length); malos++; }
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
  const st = E.crear(), r = correr(E, st, ['cat ~/LEEME.md', 'cat ~/k8s/README.md', 'help', 'kubectl edit x']);
  r.salida.forEach(x => x.lineas.forEach(l => mira('$ ' + x.cmd, l.t)));
  [E.ui.oferta.titulo, E.ui.oferta.sub, E.ui.oferta.txt, E.ui.sesionNueva, E.ui.alertas].concat(E.ui.como, E.ui.bienvenida('libre'), E.ui.bienvenida('ticket'), E.ui.experimentos.map(x => x[1])).forEach((x, i) => mira('ui ' + i, x));
  raros.forEach(x => mal('[en] parece español: ' + x));
  if (!raros.length) bien('en inglés no queda nada en español: tickets, pistas, prácticas, alertas, ficheros, interfaz y la salida de los 6 guiones');
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

console.log('\n' + (fallos ? fallos + ' fallo' + (fallos === 1 ? '' : 's') : 'Todo en orden'));
process.exit(fallos ? 1 : 0);
