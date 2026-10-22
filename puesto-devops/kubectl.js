// Puesto DevOps · kubectl.
//
// El cliente contra st.k8s, sólo en tu equipo (ops). Imita la salida de
// kubectl 1.29: las tablas sin bordes, describe con sus eventos agregados,
// «No resources found in default namespace.» si olvidas -n, y los errores con
// sus textos de verdad. No hay editor: lo que en la vida real se hace con
// kubectl edit aquí se hace con apply -f, set, scale o patch.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, K = P.k8s;

// ------------------------------------------------------------------ argumentos
const TIPOS = {
  pod: 'pods', pods: 'pods', po: 'pods',
  deployment: 'deployments', deployments: 'deployments', deploy: 'deployments', 'deployment.apps': 'deployments',
  replicaset: 'replicasets', replicasets: 'replicasets', rs: 'replicasets', 'replicaset.apps': 'replicasets',
  service: 'services', services: 'services', svc: 'services',
  endpoints: 'endpoints', ep: 'endpoints', endpoint: 'endpoints',
  node: 'nodes', nodes: 'nodes', no: 'nodes',
  event: 'events', events: 'events', ev: 'events',
  configmap: 'configmaps', configmaps: 'configmaps', cm: 'configmaps',
  namespace: 'namespaces', namespaces: 'namespaces', ns: 'namespaces',
  all: 'all',
};
const SINGULAR = { pods: 'pod', deployments: 'deployment.apps', replicasets: 'replicaset.apps', services: 'service', endpoints: 'endpoints', nodes: 'node', configmaps: 'configmap', namespaces: 'namespace', events: 'event' };
// Separa flags y posicionales. Los flags con valor admiten «-n x», «-n=x», «--namespace=x».
function leer(args, conValor) {
  const o = { pos: [], f: {}, resto: null };
  for (let i = 0; i < args.length; i++) {
    const x = args[i];
    if (x === '--') { o.resto = args.slice(i + 1); break; }
    let m = /^(--?[a-zA-Z-]+)=(.*)$/.exec(x);
    if (m) { o.f[m[1]] = m[2]; continue; }
    m = /^-o(wide|yaml|json|name)$/.exec(x);
    if (m) { o.f['-o'] = m[1]; continue; }
    if (/^-/.test(x) && x.length > 1) { if (conValor.indexOf(x) >= 0) { o.f[x] = args[i + 1]; i++; } else o.f[x] = true; continue; }
    o.pos.push(x);
  }
  return o;
}
const VALOR = ['-n', '--namespace', '-o', '--output', '-l', '--selector', '-c', '--container', '--tail', '--sort-by', '--replicas', '--to-revision', '-f', '--filename', '--limits', '--requests', '--type', '--context', '--timeout', '--field-selector'];
const nsDe = (st, o) => o.f['-n'] || o.f['--namespace'] || st.k8s.nsDefecto || 'default';
const salidaDe = o => o.f['-o'] || o.f['--output'] || '';
const selDe = o => { const s = o.f['-l'] || o.f['--selector']; if (!s) return null; const r = {}; String(s).split(',').forEach(x => { const [k, v] = x.split('='); r[k] = v; }); return r; };
const casa = (labels, s) => !s || Object.keys(s).every(k => labels[k] === s[k]);
const todos = o => !!(o.f['-A'] || o.f['--all-namespaces']);
const err = t => ({ lineas: [L(t, 'err')], fallo: true });
const nf = (tipo, nombre) => err('Error from server (NotFound): ' + tipo + ' "' + nombre + '" not found');
// «deployment/api-pagos» o «deployment api-pagos».
function objetivo(pos) {
  if (!pos.length) return null;
  if (pos[0].indexOf('/') > 0) { const [t, n] = pos[0].split('/'); return { tipo: TIPOS[t] || t, nombre: n, resto: pos.slice(1), crudo: t }; }
  return { tipo: TIPOS[pos[0]] || pos[0], nombre: pos[1], resto: pos.slice(2), crudo: pos[0] };
}
const edad = (st, m) => K.edad(st.reloj - m);
const reinicios = (st, p) => p.c.reinicios ? p.c.reinicios + (p.c.ultimo ? ' (' + K.edad(st.reloj - p.c.ultimo.fin) + ' ago)' : '') : '0';

// ------------------------------------------------------------------ get
function listar(st, tipo, ns, s) {
  const k = st.k8s, en = x => ns == null || x.ns === ns;
  if (tipo === 'pods') return k.pods.filter(p => en(p) && casa(Object.assign({}, p.labels, p.tpl.labels), s)).sort((a, b) => (a.ns + a.nombre < b.ns + b.nombre ? -1 : 1));
  if (tipo === 'deployments') return Object.values(k.deps).filter(d => en(d) && casa(d.labels, s));
  if (tipo === 'replicasets') return k.rss.filter(r => en(r) && casa(r.tpl.labels, s));
  if (tipo === 'services') return Object.values(k.svcs).filter(en).concat(ns == null || ns === 'default' ? [{ ns: 'default', nombre: 'kubernetes', selector: {}, puerto: 443, ip: '10.96.0.1', creado: -11520, api: true }] : []);
  if (tipo === 'endpoints') return listar(st, 'services', ns, null);
  if (tipo === 'configmaps') return Object.values(k.cms).filter(en).concat((ns == null ? K.NAMESPACES : [ns]).filter(n => K.NAMESPACES.indexOf(n) >= 0).map(n => ({ ns: n, nombre: 'kube-root-ca.crt', data: { 'ca.crt': '-----BEGIN CERTIFICATE-----' }, creado: -11520 })));
  if (tipo === 'events') return k.eventos.filter(e => ns == null || (e.ns || 'default') === ns).slice().sort((a, b) => a.min - b.min);
  return [];
}
const PORTS = s => s.api ? '443/TCP' : s.puerto + '/' + (s.proto || 'TCP');
function filasTipo(st, tipo, xs, o, conNs) {
  const wide = salidaDe(o) === 'wide', ns = x => conNs ? [x.ns || 'default'] : [];
  const cabNs = conNs ? ['NAMESPACE'] : [];
  if (tipo === 'pods') {
    const cab = cabNs.concat(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE']).concat(wide ? ['IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'] : []).concat(o.f['--show-labels'] ? ['LABELS'] : []);
    return [cab, xs.map(p => ns(p).concat([p.nombre, (K.listo(st, p) ? 1 : 0) + '/1', K.estadoPod(st, p), reinicios(st, p), edad(st, p.creado)])
      .concat(wide ? [p.ip || '<none>', p.nodo || '<none>', '<none>', '<none>'] : []).concat(o.f['--show-labels'] ? [K.sel(Object.keys(p.labels).length ? p.labels : p.tpl.labels)] : []))];
  }
  if (tipo === 'deployments') {
    const cab = cabNs.concat(['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE']).concat(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : []).concat(o.f['--show-labels'] ? ['LABELS'] : []);
    return [cab, xs.map(d => { const r = K.resumenDep(st, d); return ns(d).concat([d.nombre, r.listos + '/' + d.replicas, r.actualizados, r.listos, edad(st, d.creado)]).concat(wide ? [d.tpl.contenedor, d.tpl.imagen, 'app=' + d.labels.app] : []).concat(o.f['--show-labels'] ? [K.sel(d.labels)] : []); })];
  }
  if (tipo === 'replicasets') {
    const cab = cabNs.concat(['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE']).concat(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : []);
    return [cab, xs.map(r => { const ps = K.podsDeRs(st, r); return ns(r).concat([r.nombre, r.deseado, ps.length, ps.filter(p => K.listo(st, p)).length, edad(st, r.creado)]).concat(wide ? [r.tpl.contenedor, r.tpl.imagen, 'app=' + r.tpl.labels.app + ',pod-template-hash=' + r.hash] : []); })];
  }
  if (tipo === 'services') {
    const cab = cabNs.concat(['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE']).concat(wide ? ['SELECTOR'] : []);
    return [cab, xs.map(s => ns(s).concat([s.nombre, 'ClusterIP', s.ip, '<none>', PORTS(s), edad(st, s.creado)]).concat(wide ? [Object.keys(s.selector).length ? K.sel(s.selector) : '<none>'] : []))];
  }
  if (tipo === 'endpoints') return [cabNs.concat(['NAME', 'ENDPOINTS', 'AGE']), xs.map(s => {
    const eps = s.api ? ['10.30.0.10:6443'] : K.endpoints(st, s).map(p => p.ip + ':' + s.targetPort);
    return ns(s).concat([s.nombre, eps.length ? eps.slice(0, 3).join(',') + (eps.length > 3 ? ' + ' + (eps.length - 3) + ' more...' : '') : '<none>', edad(st, s.creado)]);
  })];
  if (tipo === 'configmaps') return [cabNs.concat(['NAME', 'DATA', 'AGE']), xs.map(c => ns(c).concat([c.nombre, Object.keys(c.data).length, edad(st, c.creado)]))];
  if (tipo === 'events') return [cabNs.concat(['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE']), xs.map(e => ns(e).concat([K.edad(st.reloj - e.min), e.tipo, e.razon, e.obj, e.msg]))];
  return [[], []];
}
function get(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), out = salidaDe(o);
  if (out && ['wide', 'yaml', 'name'].indexOf(out) < 0) return { lineas: [L(T('(en el simulador: -o wide, -o yaml o -o name)', '(in the simulator: -o wide, -o yaml or -o name)'), 'dim')] };
  const ob = objetivo(o.pos);
  if (!ob) return { lineas: [L('You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.', 'err'), L(''), L('error: Required resource not specified.', 'err')], fallo: true };
  // Varios tipos a la vez: kubectl get deploy,pods
  if (!ob.nombre && ob.crudo.indexOf(',') > 0) return { lineas: [].concat(...ob.crudo.split(',').map((t, i) => (i ? [L('')] : []).concat(get(Object.assign({}, ctx, { args: [t].concat(ctx.args.slice(1)) })).lineas))) };
  const tipo = ob.tipo;
  if (['pods', 'deployments', 'replicasets', 'services', 'endpoints', 'nodes', 'events', 'configmaps', 'namespaces', 'all'].indexOf(tipo) < 0) return err('error: the server doesn\'t have a resource type "' + ob.crudo + '"');
  if (tipo === 'nodes') {
    let ns = Object.values(st.k8s.nodos);
    if (ob.nombre) { ns = ns.filter(n => n.nombre === ob.nombre); if (!ns.length) return nf('nodes', ob.nombre); }
    const wide = out === 'wide';
    return { lineas: K.tabla(['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION'].concat(wide ? ['INTERNAL-IP', 'EXTERNAL-IP', 'OS-IMAGE', 'KERNEL-VERSION', 'CONTAINER-RUNTIME'] : []),
      ns.map(n => [n.nombre, (K.nodoListo(st, n) ? 'Ready' : 'NotReady') + (n.cordon ? ',SchedulingDisabled' : ''), n.rol === 'cp' ? 'control-plane' : '<none>', edad(st, n.creado), 'v1.29.8'].concat(wide ? [n.ip, '<none>', 'Ubuntu 24.04.1 LTS', st.hosts[n.nombre].kernel, 'containerd://1.7.12'] : []))) };
  }
  if (tipo === 'namespaces') return { lineas: K.tabla(['NAME', 'STATUS', 'AGE'], K.NAMESPACES.map(n => [n, 'Active', edad(st, -11520)])) };
  const ns = todos(o) ? null : nsDe(st, o);
  if (tipo === 'all') {
    const out2 = [];
    [['pods', 'pod/'], ['services', 'service/'], ['deployments', 'deployment.apps/'], ['replicasets', 'replicaset.apps/']].forEach(([t, pref]) => {
      const xs = listar(st, t, ns, selDe(o)); if (!xs.length) return;
      const [cab, filas] = filasTipo(st, t, xs, o, ns == null);
      const i = ns == null ? 1 : 0;
      if (out2.length) out2.push(L(''));
      out2.push(...K.tabla(cab, filas.map(f => { const g = f.slice(); g[i] = pref + g[i]; return g; })));
    });
    return { lineas: out2.length ? out2 : [L('No resources found in ' + ns + ' namespace.')] };
  }
  let xs = listar(st, tipo, ns, selDe(o));
  if (ob.nombre) {
    xs = xs.filter(x => x.nombre === ob.nombre);
    if (!xs.length) return nf(tipo, ob.nombre);
  }
  if (!xs.length) return { lineas: [L(ns == null ? 'No resources found' : 'No resources found in ' + ns + ' namespace.')] };
  if (out === 'name') return { lineas: xs.map(x => L(SINGULAR[tipo] + '/' + x.nombre)) };
  if (out === 'yaml') {
    const ys = xs.map(x => yamlVivo(st, tipo, x));
    return { lineas: (xs.length > 1 ? ['apiVersion: v1', 'items:'].concat(...ys.map(y => y.map((l, i) => (i ? '  ' : '- ') + l)), ['kind: List']) : ys[0]).map(l => L(l)) };
  }
  const [cab, filas] = filasTipo(st, tipo, xs, o, ns == null);
  return { lineas: K.tabla(cab, filas) };
}
function yamlVivo(st, tipo, x) {
  if (tipo === 'deployments') { const m = K.manifiesto(st, 'Deployment', x.ns + '/' + x.nombre), y = K.yamlDe(m), r = K.resumenDep(st, x); y.splice(3, 0, '  annotations:', '    deployment.kubernetes.io/revision: "' + x.rev + '"'); return y.concat(['status:', '  availableReplicas: ' + r.listos, '  readyReplicas: ' + r.listos, '  replicas: ' + r.total, '  updatedReplicas: ' + r.actualizados]); }
  if (tipo === 'configmaps') return x.nombre === 'kube-root-ca.crt' ? ['apiVersion: v1', 'data:', '  ca.crt: |', '    -----BEGIN CERTIFICATE-----', '    (…)', 'kind: ConfigMap', 'metadata:', '  name: kube-root-ca.crt', '  namespace: ' + x.ns] : K.yamlDe(K.manifiesto(st, 'ConfigMap', x.ns + '/' + x.nombre));
  if (tipo === 'services') return x.api ? ['apiVersion: v1', 'kind: Service', 'metadata:', '  name: kubernetes', '  namespace: default', 'spec:', '  clusterIP: 10.96.0.1'] : K.yamlDe(K.manifiesto(st, 'Service', x.ns + '/' + x.nombre)).concat(['  clusterIP: ' + x.ip]);
  if (tipo === 'pods') {
    const c = x.c, e = K.estadoPod(st, x);
    return K.yaml({ apiVersion: 'v1', kind: 'Pod', metadata: { name: x.nombre, namespace: x.ns, labels: Object.keys(x.labels).length ? x.labels : x.tpl.labels }, spec: { containers: [K.contenedor(x.tpl)], nodeName: x.nodo || undefined },
      status: { phase: x.nodo ? (e === 'Unknown' ? 'Unknown' : 'Running') : 'Pending', podIP: x.ip || undefined, containerStatuses: x.nodo ? [Object.assign({ name: x.tpl.contenedor, image: x.tpl.imagen, ready: K.listo(st, x), restartCount: c.reinicios },
        c.estado === 'espera' ? { state: { waiting: { reason: c.razon } } } : c.estado === 'corriendo' ? { state: { running: { startedAt: U.iso(c.arranque) + 'Z' } } } : {},
        c.ultimo ? { lastState: { terminated: { reason: c.ultimo.razon, exitCode: c.ultimo.codigo, startedAt: U.iso(c.ultimo.inicio) + 'Z', finishedAt: U.iso(c.ultimo.fin) + 'Z' } } } : {})] : undefined } });
  }
  return [];
}

// ------------------------------------------------------------------ describe
const eventosDe = (st, obj, ns) => {
  const ev = st.k8s.eventos.filter(e => e.obj === obj && (ns == null || (e.ns || 'default') === ns));
  if (!ev.length) return [L('Events:  <none>')];
  return [L('Events:')].concat(K.tabla(['  Type', 'Reason', 'Age', 'From', 'Message'], [['  ----', '------', '----', '----', '-------']].concat(ev.slice(-12).map(e => ['  ' + e.tipo, e.razon, (e.n > 1 ? K.edad(st.reloj - e.min) + ' (x' + e.n + ' over ' + K.edad(st.reloj - e.primero) + ')' : K.edad(st.reloj - e.min)), e.de, e.msg]))));
};
const kv = (pares, ancho) => pares.map(([k, v]) => L((k + ':').padEnd(ancho || 18) + v));
function recursos(tpl, sangria) {
  const out = [];
  const lim = Object.keys(tpl.lim).filter(k => tpl.lim[k]), req = Object.keys(tpl.req).filter(k => tpl.req[k]);
  if (lim.length) { out.push(sangria + 'Limits:'); lim.forEach(k => out.push(sangria + '  ' + (k === 'cpu' ? 'cpu' : 'memory') + ':  ' + (k === 'cpu' ? K.cpu(tpl.lim.cpu) : K.mem(tpl.lim.mem)))); }
  if (req.length) { out.push(sangria + 'Requests:'); req.forEach(k => out.push(sangria + '  ' + (k === 'cpu' ? 'cpu:   ' : 'memory:') + '     ' + (k === 'cpu' ? K.cpu(tpl.req.cpu) : K.mem(tpl.req.mem)))); }
  if (tpl.ready) out.push(sangria + 'Readiness:    http-get http://:' + tpl.ready.port + tpl.ready.path + ' delay=5s timeout=1s period=10s #success=1 #failure=3');
  if (tpl.envFrom) { out.push(sangria + 'Environment Variables from:'); out.push(sangria + '  ' + tpl.envFrom + '  ConfigMap  Optional: false'); }
  out.push(sangria + 'Environment:  ' + (Object.keys(tpl.env).length ? '' : '<none>'));
  Object.keys(tpl.env).forEach(k => out.push(sangria + '  ' + k + ':  ' + tpl.env[k]));
  return out.map(x => L(x));
}
function describePod(st, p) {
  const c = p.c, e = K.estadoPod(st, p), n = p.nodo && st.k8s.nodos[p.nodo], listo = K.listo(st, p);
  const out = kv([['Name', p.nombre], ['Namespace', p.ns], ['Priority', '0'], ['Service Account', 'default'], ['Node', n ? n.nombre + '/' + n.ip : '<none>'], ['Start Time', K.fecha(p.programadoEn != null ? p.programadoEn : p.creado)]]);
  const labels = Object.keys(p.labels).length ? p.labels : p.tpl.labels;
  Object.keys(labels).forEach((k, i) => out.push(L((i ? '' : 'Labels:').padEnd(18) + k + '=' + labels[k])));
  out.push(...kv([['Annotations', '<none>'], ['Status', p.nodo ? (e === 'Unknown' ? 'Unknown' : 'Running') : 'Pending'], ['IP', p.ip || '']]));
  if (p.dueno || p.rs) out.push(L('Controlled By:  ' + (p.rs ? 'ReplicaSet/' + p.rs : p.dueno)));
  out.push(L('Containers:'), L('  ' + p.tpl.contenedor + ':'));
  const cc = [];
  if (p.nodo && c.arranque != null) cc.push(['Container ID', 'containerd://' + U.hex('c' + p.nombre + c.reinicios, 64)]);
  cc.push(['Image', p.tpl.imagen]);
  if (p.tpl.puerto) cc.push(['Port', p.tpl.puerto + '/TCP'], ['Host Port', '0/TCP']);
  out.push(...cc.map(([k, v]) => L('    ' + (k + ':').padEnd(16) + v)));
  if (c.estado === 'corriendo' && p.nodo) out.push(L('    State:          Running'), L('      Started:      ' + K.fecha(c.arranque)));
  else if (c.estado === 'espera') out.push(L('    State:          Waiting'), L('      Reason:       ' + c.razon));
  else out.push(L('    State:          Waiting'), L('      Reason:       ' + (p.nodo ? 'ContainerCreating' : 'Pending')));
  if (c.ultimo) out.push(L('    Last State:     Terminated'), L('      Reason:       ' + c.ultimo.razon, c.ultimo.razon === 'OOMKilled' ? 'rojo' : 'out'), L('      Exit Code:    ' + c.ultimo.codigo), L('      Started:      ' + K.fecha(c.ultimo.inicio)), L('      Finished:     ' + K.fecha(c.ultimo.fin)));
  out.push(L('    Ready:          ' + (listo ? 'True' : 'False')), L('    Restart Count:  ' + c.reinicios));
  out.push(...recursos(p.tpl, '    '));
  out.push(L('Conditions:'), L('  Type              Status'), L('  Initialized       ' + (p.nodo ? 'True' : 'False')), L('  Ready             ' + (listo ? 'True' : 'False')), L('  ContainersReady   ' + (listo ? 'True' : 'False')), L('  PodScheduled      ' + (p.nodo ? 'True' : 'False')));
  out.push(L('QoS Class:                   Burstable'), L('Node-Selectors:              <none>'), L('Tolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s'), L('                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s'));
  return out.concat(eventosDe(st, 'pod/' + p.nombre, p.ns));
}
function describeDeploy(st, d) {
  const r = K.resumenDep(st, d), n = K.rsActual(st, d), viejos = K.rssDe(st, d).filter(x => x !== n && (x.deseado || K.podsDeRs(st, x).length));
  const ps = K.podsDe(st, d), disp = r.listos;
  const out = kv([['Name', d.nombre], ['Namespace', d.ns], ['CreationTimestamp', K.fecha(d.creado)], ['Labels', K.sel(d.labels)], ['Annotations', 'deployment.kubernetes.io/revision: ' + d.rev], ['Selector', 'app=' + d.labels.app],
    ['Replicas', d.replicas + ' desired | ' + r.actualizados + ' updated | ' + ps.length + ' total | ' + disp + ' available | ' + Math.max(0, ps.length - disp) + ' unavailable'],
    ['StrategyType', 'RollingUpdate'], ['MinReadySeconds', '0'], ['RollingUpdateStrategy', '25% max unavailable, 25% max surge']], 24);
  out.push(L('Pod Template:'), L('  Labels:  ' + K.sel(d.tpl.labels)));
  if (Object.keys(d.tpl.anot || {}).length) out.push(L('  Annotations:  ' + Object.keys(d.tpl.anot).map(k => k + ': ' + d.tpl.anot[k]).join(', ')));
  out.push(L('  Containers:'), L('   ' + d.tpl.contenedor + ':'), L('    Image:      ' + d.tpl.imagen));
  if (d.tpl.puerto) out.push(L('    Port:       ' + d.tpl.puerto + '/TCP'), L('    Host Port:  0/TCP'));
  out.push(...recursos(d.tpl, '    '));
  const minDisp = d.replicas - Math.floor(d.replicas * 0.25);
  out.push(L('Conditions:'), L('  Type           Status  Reason'), L('  ----           ------  ------'),
    L('  Available      ' + (disp >= minDisp ? 'True    MinimumReplicasAvailable' : 'False   MinimumReplicasUnavailable')),
    L('  Progressing    ' + (d.atascado ? 'False   ProgressDeadlineExceeded' : r.completo ? 'True    NewReplicaSetAvailable' : 'True    ReplicaSetUpdated')));
  out.push(L('OldReplicaSets:  ' + (viejos.length ? viejos.map(x => x.nombre + ' (' + K.podsDeRs(st, x).length + '/' + x.deseado + ' replicas created)').join(', ') : '<none>')));
  out.push(L('NewReplicaSet:   ' + (n ? n.nombre + ' (' + K.podsDeRs(st, n).length + '/' + n.deseado + ' replicas created)' : '<none>')));
  return out.concat(eventosDe(st, 'deployment/' + d.nombre, d.ns));
}
function describeNode(st, n) {
  const h = st.hosts[n.nombre], ps = st.k8s.pods.filter(p => p.nodo === n.nombre), l = K.libre(st, n), listo = K.nodoListo(st, n);
  const out = kv([['Name', n.nombre], ['Roles', n.rol === 'cp' ? 'control-plane' : '<none>']], 20);
  out.push(L('Labels:             kubernetes.io/arch=amd64'), L('                    kubernetes.io/hostname=' + n.nombre), L('                    kubernetes.io/os=linux'));
  if (n.rol === 'cp') out.push(L('                    node-role.kubernetes.io/control-plane='));
  const taints = (n.rol === 'cp' ? ['node-role.kubernetes.io/control-plane:NoSchedule'] : []).concat(n.cordon ? ['node.kubernetes.io/unschedulable:NoSchedule'] : []).concat(listo ? [] : ['node.kubernetes.io/not-ready:NoSchedule']);
  out.push(L('Taints:             ' + (taints[0] || '<none>')), ...taints.slice(1).map(x => L('                    ' + x)));
  out.push(L('Unschedulable:      ' + (n.cordon ? 'true' : 'false'), n.cordon ? 'ambar' : 'out'));
  out.push(L('Conditions:'), ...K.tabla(['  Type', 'Status', 'Reason', 'Message'], [
    ['  MemoryPressure', 'False', 'KubeletHasSufficientMemory', 'kubelet has sufficient memory available'],
    ['  DiskPressure', 'False', 'KubeletHasNoDiskPressure', 'kubelet has no disk pressure'],
    ['  PIDPressure', 'False', 'KubeletHasSufficientPID', 'kubelet has sufficient PID available'],
    ['  Ready', listo ? 'True' : 'Unknown', listo ? 'KubeletReady' : 'NodeStatusUnknown', listo ? 'kubelet is posting ready status' : 'Kubelet stopped posting node status.']]));
  out.push(L('Addresses:'), L('  InternalIP:  ' + n.ip), L('  Hostname:    ' + n.nombre));
  out.push(L('Capacity:'), L('  cpu:     ' + Math.ceil(n.cpu / 1000)), L('  memory:  ' + (Math.round(n.mem * 1.04) * 1024) + 'Ki'), L('  pods:    110'));
  out.push(L('Allocatable:'), L('  cpu:     ' + K.cpu(n.cpu)), L('  memory:  ' + n.mem * 1024 + 'Ki'), L('  pods:    110'));
  out.push(L('System Info:'), L('  Kernel Version:             ' + h.kernel), L('  OS Image:                   Ubuntu 24.04.1 LTS'), L('  Container Runtime Version:  containerd://1.7.12'), L('  Kubelet Version:            v1.29.8'));
  out.push(L('PodCIDR:                      10.244.' + (n.idx + 1) + '.0/24'));
  out.push(L('Non-terminated Pods:          (' + ps.length + ' in total)'));
  out.push(...K.tabla(['  Namespace', 'Name', 'CPU Requests', 'CPU Limits', 'Memory Requests', 'Memory Limits', 'Age'], [['  ---------', '----', '------------', '----------', '---------------', '-------------', '---']].concat(ps.map(p => {
    const pc = (v, tot) => v ? ' (' + Math.round(v / tot * 100) + '%)' : ' (0%)';
    return ['  ' + p.ns, p.nombre, K.cpu(p.tpl.req.cpu || 0) + pc(p.tpl.req.cpu, n.cpu), '0 (0%)', (p.tpl.req.mem ? K.mem(p.tpl.req.mem) : '0') + pc(p.tpl.req.mem, n.mem), p.tpl.lim.mem ? K.mem(p.tpl.lim.mem) + pc(p.tpl.lim.mem, n.mem) : '0 (0%)', edad(st, p.creado)];
  }))));
  const cpuU = n.cpu - l.cpu, memU = n.mem - l.mem, memL = ps.reduce((s, p) => s + (p.tpl.lim.mem || 0), 0);
  out.push(L('Allocated resources:'), L('  (Total limits may be over 100 percent, i.e., overcommitted.)'), L('  Resource           Requests      Limits'), L('  --------           --------      ------'),
    L('  cpu                ' + (K.cpu(cpuU) + ' (' + Math.round(cpuU / n.cpu * 100) + '%)').padEnd(14) + '0 (0%)'), L('  memory             ' + (K.mem(memU) + ' (' + Math.round(memU / n.mem * 100) + '%)').padEnd(14) + K.mem(memL) + ' (' + Math.round(memL / n.mem * 100) + '%)'));
  return out.concat(eventosDe(st, 'node/' + n.nombre, null));
}
function describe(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), ob = objetivo(o.pos), ns = nsDe(st, o);
  if (!ob) return err('error: You must specify the type of resource to describe. Use "kubectl api-resources" for a complete list of supported resources.');
  const k = st.k8s;
  if (ob.tipo === 'nodes') { const xs = ob.nombre ? [k.nodos[ob.nombre]].filter(Boolean) : Object.values(k.nodos); if (!xs.length) return nf('nodes', ob.nombre); return { lineas: [].concat(...xs.map((n, i) => (i ? [L(''), L('')] : []).concat(describeNode(st, n)))) }; }
  if (ob.tipo === 'pods') {
    const xs = k.pods.filter(p => p.ns === ns && (ob.nombre ? p.nombre === ob.nombre : casa(Object.assign({}, p.labels, p.tpl.labels), selDe(o))));
    if (!xs.length) return ob.nombre ? nf('pods', ob.nombre) : { lineas: [L('No resources found in ' + ns + ' namespace.')] };
    return { lineas: [].concat(...xs.map((p, i) => (i ? [L(''), L('')] : []).concat(describePod(st, p)))) };
  }
  if (ob.tipo === 'deployments') { const xs = Object.values(k.deps).filter(d => d.ns === ns && (!ob.nombre || d.nombre === ob.nombre)); if (!xs.length) return ob.nombre ? nf('deployments.apps', ob.nombre) : { lineas: [L('No resources found in ' + ns + ' namespace.')] }; return { lineas: [].concat(...xs.map((d, i) => (i ? [L(''), L('')] : []).concat(describeDeploy(st, d)))) }; }
  if (ob.tipo === 'services') {
    const s = k.svcs[ns + '/' + ob.nombre]; if (!s) return nf('services', ob.nombre);
    const eps = K.endpoints(st, s);
    return { lineas: kv([['Name', s.nombre], ['Namespace', s.ns], ['Labels', '<none>'], ['Annotations', '<none>'], ['Selector', K.sel(s.selector)], ['Type', 'ClusterIP'], ['IP Family Policy', 'SingleStack'], ['IP Families', 'IPv4'], ['IP', s.ip], ['IPs', s.ip], ['Port', '<unset>  ' + s.puerto + '/' + (s.proto || 'TCP')], ['TargetPort', s.targetPort + '/' + (s.proto || 'TCP')], ['Endpoints', eps.length ? eps.map(p => p.ip + ':' + s.targetPort).join(',') : '<none>'], ['Session Affinity', 'None']], 19).concat([L('Events:            <none>')]) };
  }
  if (ob.tipo === 'configmaps') {
    const c = k.cms[ns + '/' + ob.nombre]; if (!c) return nf('configmaps', ob.nombre);
    const out = kv([['Name', c.nombre], ['Namespace', c.ns], ['Labels', '<none>'], ['Annotations', '<none>']], 14);
    out.push(L(''), L('Data'), L('===='));
    Object.keys(c.data).sort().forEach(x => out.push(L(x + ':'), L('----'), L(c.data[x]), L('')));
    out.push(L(''), L('BinaryData'), L('===='), L(''), L('Events:  <none>'));
    return { lineas: out };
  }
  if (ob.tipo === 'replicasets') {
    const r = k.rss.find(x => x.ns === ns && x.nombre === ob.nombre); if (!r) return nf('replicasets.apps', ob.nombre);
    const ps = K.podsDeRs(st, r);
    return { lineas: kv([['Name', r.nombre], ['Namespace', r.ns], ['Selector', 'app=' + r.tpl.labels.app + ',pod-template-hash=' + r.hash], ['Annotations', 'deployment.kubernetes.io/revision: ' + r.rev], ['Controlled By', 'Deployment/' + r.dep.split('/')[1]], ['Replicas', ps.length + ' current / ' + r.deseado + ' desired'],
      ['Pods Status', ps.filter(p => p.c.estado === 'corriendo').length + ' Running / ' + ps.filter(p => !p.nodo || p.c.estado !== 'corriendo').length + ' Waiting / 0 Succeeded / 0 Failed']], 14).concat([L('Pod Template:'), L('  Containers:'), L('   ' + r.tpl.contenedor + ':'), L('    Image:      ' + r.tpl.imagen)], recursos(r.tpl, '    '), eventosDe(st, 'replicaset/' + r.nombre, r.ns)) };
  }
  return err('error: the server doesn\'t have a resource type "' + ob.crudo + '"');
}

// ------------------------------------------------------------------ logs
// Lo que escribe cada aplicación, derivado de su estado: arranque, peticiones,
// y el motivo por el que muere (si el proceso llega a decirlo: un OOMKilled no
// deja ni una línea, lo mata el kernel).
function lineasApp(st, p, inst) {
  const a = K.appDe(p), ini = inst.inicio, fin = inst.fin, env = inst.env || {}, out = [];
  const ts = (m, s) => U.iso(m, s) + '.' + String(100 + (m * 37 + s * 11) % 900).slice(0, 3) + 'Z';
  const reqs = (desde, gen) => { for (let m = Math.max(desde, fin - 14); m < fin; m++) gen(m).forEach(x => out.push(x)); };
  if (a.nombre === 'api-pagos') {
    const lf = (m, s, lvl, msg) => 'time="' + U.iso(m, s) + 'Z" level=' + lvl + ' msg=' + msg;
    out.push(lf(ini, 1, 'info', '"starting api-pagos" version=' + a.tag + ' commit=' + U.hex(a.tag, 7) + ' go=go1.22.6'));
    out.push(lf(ini, 1, 'info', '"loading configuration" source=env keys=' + Object.keys(env).sort().join(',')));
    if (inst.falta) { out.push(lf(ini, 1, 'fatal', '"invalid configuration" error="' + inst.falta[0] + ' is required"')); return out; }
    out.push(lf(ini, 2, 'info', '"database pool ready" host=' + env.DB_HOST + ' db=' + env.DB_NAME + ' max_conns=20'));
    out.push(lf(ini, 2, 'info', '"payment gateway configured" url=' + env.PASARELA_URL));
    out.push(lf(ini, 2, 'info', '"http server listening" addr=":8080"'));
    reqs(ini + 1, m => [lf(m, 7, 'info', '"request" method=GET path=/healthz status=200 duration_ms=1'), lf(m, 31, 'info', '"request" method=POST path=/api/v1/pagos status=201 duration_ms=' + (30 + m % 17))]);
  } else if (a.nombre === 'antifraude') {
    const sp = (m, s, lvl, cls, msg) => ts(m, s) + '  ' + lvl + ' 1 --- [antifraude] [' + (cls[0] === 'h' ? 'nio-8080-exec-' + (1 + s % 9) : 'main') + '] ' + cls.slice(1).padEnd(42) + ' : ' + msg;
    out.push(sp(ini, 2, 'INFO', 'me.p.antifraude.AntifraudeApplication', 'Starting AntifraudeApplication v' + a.tag + ' using Java 21.0.4 with PID 1'));
    out.push(sp(ini, 9, 'INFO', 'mo.s.b.w.embedded.tomcat.TomcatWebServer', "Tomcat started on port 8080 (http) with context path '/'"));
    out.push(sp(ini, 9, 'INFO', 'me.p.antifraude.AntifraudeApplication', 'Started AntifraudeApplication in 8.214 seconds (process running for 9.03)'));
    out.push(sp(ini + 1, 12, 'INFO', 'he.p.antifraude.modelo.CargadorModelo', 'Loading model ' + (env.MODELO || 'gbm') + ' (612 MB) on first scoring request'));
    if (inst.razon === 'OOMKilled') return out;
    out.push(sp(ini + 1, 51, 'INFO', 'he.p.antifraude.modelo.CargadorModelo', 'Model loaded in 38712 ms, heap used 655 MB'));
    reqs(ini + 2, m => [sp(m, 19, 'INFO', 'he.p.antifraude.web.ScoringController', 'score txn=T' + U.hex('t' + m, 8) + ' result=ALLOW score=0.' + (10 + m % 80) + ' latency=' + (9 + m % 7) + 'ms')]);
  } else if (a.nombre === 'web-checkout') {
    const ng = (m, s, ip, req, cod, ua) => ip + ' - - [' + new Date(U.iso(m, s) + 'Z').toUTCString().replace(/^\w+, (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1/$2/$3:$4') + ' +0000] "' + req + ' HTTP/1.1" ' + cod + ' ' + (cod === 200 ? 612 : 153) + ' "-" "' + ua + '"';
    out.push('/docker-entrypoint.sh: Configuration complete; ready for start up');
    const sonda = p.tpl.ready ? p.tpl.ready.path : '/', cod = K.sirve(p, sonda) ? 200 : 404, nodo = p.nodo ? '10.244.' + (st.k8s.nodos[p.nodo].idx + 1) + '.1' : '10.244.0.1';
    reqs(ini, m => [ng(m, 3, nodo, 'GET ' + sonda, cod, 'kube-probe/1.29'), ng(m, 13, nodo, 'GET ' + sonda, cod, 'kube-probe/1.29')].concat(cod === 200 ? [ng(m, 22, '10.244.3.9', 'GET /checkout', 200, 'Mozilla/5.0')] : []));
  } else if (a.nombre === 'liquidaciones') {
    out.push(ts(ini, 1) + ' INFO  liquidaciones ' + a.tag + ' arrancando (lotes de cierre de mes)');
    reqs(ini + 1, m => [ts(m, 5) + ' INFO  lote ' + (4100 + m % 400) + ': ' + (800 + m % 300) + ' liquidaciones procesadas']);
  } else {
    out.push(ts(ini, 1) + ' level=info msg="' + a.nombre + ' started" version=' + a.tag);
    reqs(ini + 1, m => m % 5 ? [] : [ts(m, 4) + ' level=info msg="ok"']);
  }
  return out;
}
function logs(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), ns = nsDe(st, o);
  let nombre = o.pos[0];
  if (!nombre) return err('error: expected \'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]\'.\nPOD or TYPE/NAME is a required argument for the logs command');
  let p, aviso = null;
  if (nombre.indexOf('/') > 0) {
    const [t, n] = nombre.split('/');
    if ((TIPOS[t] || t) === 'pods') nombre = n;
    else {
      const d = st.k8s.deps[ns + '/' + n]; if (!d || (TIPOS[t] || t) !== 'deployments') return nf(TIPOS[t] || t, n);
      const ps = K.podsDe(st, d).sort((a, b) => (K.listo(st, b) - K.listo(st, a)) || (a.nombre < b.nombre ? -1 : 1));
      p = ps[0]; if (ps.length > 1) aviso = 'Found ' + ps.length + ' pods, using pod/' + p.nombre;
    }
  }
  p = p || st.k8s.pods.find(x => x.ns === ns && x.nombre === nombre);
  if (!p) return nf('pods', nombre);
  const c = p.c, prev = o.f['--previous'] || o.f['-p'], cola = o.f['--tail'] ? parseInt(o.f['--tail'], 10) : null;
  if (o.f['-f'] || o.f['--follow']) aviso = (aviso ? aviso + '\n' : '') + T('(en el simulador -f no se queda escuchando: enseña lo que hay)', '(in the simulator -f does not keep listening: it shows what is there)');
  if (!p.nodo) return err('Error from server (BadRequest): pod ' + p.nombre + ' does not have a host assigned');
  let inst;
  if (prev) {
    if (!c.ultimo) return err('Error from server (BadRequest): previous terminated container "' + p.tpl.contenedor + '" in pod "' + p.nombre + '" not found');
    inst = c.ultimo;
  } else if (c.estado === 'corriendo') inst = { inicio: c.arranque, fin: st.reloj, env: c.env };
  else if (c.estado === 'espera' && c.razon === 'CrashLoopBackOff' && c.ultimo) inst = c.ultimo;
  else return err('Error from server (BadRequest): container "' + p.tpl.contenedor + '" in pod "' + p.nombre + '" is waiting to start: ' + (c.razon === 'ImagePullBackOff' || c.razon === 'ErrImagePull' ? 'trying and failing to pull image' : c.razon || 'ContainerCreating'));
  let ls = lineasApp(st, p, inst);
  if (cola != null) ls = ls.slice(-cola);
  return { lineas: (aviso ? aviso.split('\n').map(x => L(x, 'dim')) : []).concat(ls.map(x => L(x, /level=(fatal|error)| ERROR /.test(x) ? 'rojo' : /" 404 /.test(x) ? 'ambar' : 'out'))) };
}

// ------------------------------------------------------------------ top
function top(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), t = TIPOS[o.pos[0]] || o.pos[0];
  const usoPod = p => { if (p.c.estado !== 'corriendo' || !p.nodo) return null; const a = K.appDe(p).def; return { cpu: p.sistema ? 8 : a.cpu, mem: p.sistema ? 40 : Math.min(K.memApp(p, st.reloj), p.tpl.lim.mem || 1e9) }; };
  if (t === 'nodes') return { lineas: K.tabla(['NAME', 'CPU(cores)', 'CPU%', 'MEMORY(bytes)', 'MEMORY%'], Object.values(st.k8s.nodos).map(n => {
    if (!K.nodoListo(st, n)) return [n.nombre, '<unknown>', '<unknown>', '<unknown>', '<unknown>'];
    const us = st.k8s.pods.filter(p => p.nodo === n.nombre).map(usoPod).filter(Boolean), cpu = 90 + us.reduce((s, u) => s + u.cpu, 0), mem = 620 + us.reduce((s, u) => s + u.mem, 0);
    return [n.nombre, cpu + 'm', Math.round(cpu / n.cpu * 100) + '%', mem + 'Mi', Math.round(mem / n.mem * 100) + '%'];
  })) };
  if (t !== 'pods') return err('error: unknown command "' + (o.pos[0] || '') + '" for "kubectl top"');
  const ns = todos(o) ? null : nsDe(st, o);
  let ps = st.k8s.pods.filter(p => (ns == null || p.ns === ns) && (!o.pos[1] || p.nombre === o.pos[1]) && casa(Object.assign({}, p.labels, p.tpl.labels), selDe(o)));
  if (o.pos[1] && !ps.length) return nf('pods', o.pos[1]);
  ps = ps.filter(p => usoPod(p));
  if (!ps.length) return { lineas: [L('No resources found in ' + ns + ' namespace.')] };
  return { lineas: K.tabla((ns == null ? ['NAMESPACE'] : []).concat(['NAME', 'CPU(cores)', 'MEMORY(bytes)']), ps.map(p => { const u = usoPod(p); return (ns == null ? [p.ns] : []).concat([p.nombre, u.cpu + 'm', u.mem + 'Mi']); })) };
}

// ------------------------------------------------------------------ cambios
const depDe = (st, o, ob) => { const ns = nsDe(st, o); if (!ob || ob.tipo !== 'deployments' || !ob.nombre) return { error: err('error: ' + T('indica el deployment: deployment/NOMBRE', 'specify the deployment: deployment/NAME')) }; const d = st.k8s.deps[ns + '/' + ob.nombre]; return d ? { d } : { error: nf('deployments.apps', ob.nombre) }; };
function rollout(ctx) {
  const st = ctx.st, sub = ctx.args[0], o = leer(ctx.args.slice(1), VALOR), ob = objetivo(o.pos);
  if (['status', 'history', 'undo', 'restart', 'pause', 'resume'].indexOf(sub) < 0) return err('error: unknown command "' + (sub || '') + '" for "kubectl rollout"');
  const r = depDe(st, o, ob); if (r.error) return r.error;
  const d = r.d, n = 'deployment.apps/' + d.nombre;
  if (sub === 'history') {
    const revs = K.rssDe(st, d).map(x => ({ rev: x.rev, causa: x.causa || '<none>' })).sort((a, b) => a.rev - b.rev);
    if (o.f['--revision']) { const x = K.rssDe(st, d).find(y => String(y.rev) === String(o.f['--revision'])); if (!x) return err('error: unable to find the specified revision'); return { lineas: [L(n + ' with revision #' + x.rev), L('Pod Template:'), L('  Labels:\t' + K.sel(x.tpl.labels) + ',pod-template-hash=' + x.hash), L('  Containers:'), L('   ' + x.tpl.contenedor + ':'), L('    Image:\t' + x.tpl.imagen)].concat(recursos(x.tpl, '    ')) }; }
    return { lineas: [L(n), L('REVISION  CHANGE-CAUSE')].concat(revs.map(x => L(String(x.rev).padEnd(10) + x.causa))).concat([L('')]) };
  }
  if (sub === 'undo') {
    const revs = K.rssDe(st, d).filter(x => x.rev !== d.rev).sort((a, b) => b.rev - a.rev);
    const dest = o.f['--to-revision'] ? K.rssDe(st, d).find(x => String(x.rev) === String(o.f['--to-revision'])) : revs[0];
    if (!dest) return err(o.f['--to-revision'] ? 'error: unable to find specified revision ' + o.f['--to-revision'] + ' in history' : 'error: no rollout history found for deployment "' + d.nombre + '"');
    if (dest.rev === d.rev) return { lineas: [L(n + ' skipped rollback (current template already matches revision ' + dest.rev + ')')] };
    K.cambiarPlantilla(st, d, dest.tpl, dest.causa, st.reloj);
    return { lineas: [L(n + ' rolled back')] };
  }
  if (sub === 'restart') {
    const tpl = K.copia(d.tpl); tpl.anot = Object.assign({}, tpl.anot, { 'kubectl.kubernetes.io/restartedAt': U.iso(st.reloj) + 'Z' });
    K.cambiarPlantilla(st, d, tpl, d.causa, st.reloj);
    return { lineas: [L(n + ' restarted')] };
  }
  if (sub === 'pause' || sub === 'resume') return { lineas: [L(T('(en el simulador no se pausan rollouts)', '(rollouts cannot be paused in the simulator)'), 'dim')] };
  // status: espera, como el de verdad, hasta que termina o vence el plazo.
  const out = [], visto = {};
  const linea = () => {
    const rs = K.resumenDep(st, d), nuevo = K.rsActual(st, d), act = nuevo ? K.podsDeRs(st, nuevo).length : 0, viejos = rs.total - act;
    const t = act < d.replicas ? 'Waiting for deployment "' + d.nombre + '" rollout to finish: ' + act + ' out of ' + d.replicas + ' new replicas have been updated...'
      : viejos > 0 ? 'Waiting for deployment "' + d.nombre + '" rollout to finish: ' + viejos + ' old replicas are pending termination...'
      : 'Waiting for deployment "' + d.nombre + '" rollout to finish: ' + K.podsDeRs(st, nuevo).filter(p => K.listo(st, p)).length + ' of ' + d.replicas + ' updated replicas are available...';
    if (!visto[t]) { visto[t] = 1; out.push(L(t)); }
  };
  const max = o.f['--timeout'] ? Math.max(1, Math.ceil(parseInt(o.f['--timeout'], 10) / (/m$/.test(o.f['--timeout']) ? 1 : 60))) : 15;
  let i = 0;
  while (!K.completo(st, d) && !d.atascado && i < max) { linea(); P.avanzar(st, 1); i++; }
  if (K.completo(st, d)) out.push(L('deployment "' + d.nombre + '" successfully rolled out', 'verde'));
  else if (d.atascado) { linea(); out.push(L('error: deployment "' + d.nombre + '" exceeded its progress deadline', 'err')); }
  else out.push(L('error: timed out waiting for the condition', 'err'));
  return { lineas: out, minutos: 0, fallo: !K.completo(st, d) };
}
function setCmd(ctx) {
  const st = ctx.st, sub = ctx.args[0], o = leer(ctx.args.slice(1), VALOR), ob = objetivo(o.pos);
  if (sub !== 'image' && sub !== 'resources') return { lineas: [L('error: unknown command "' + (sub || '') + '" for "kubectl set"', 'err'), L(T('(en el simulador: set image, set resources)', '(in the simulator: set image, set resources)'), 'dim')], fallo: true };
  const r = depDe(st, o, ob); if (r.error) return r.error;
  const d = r.d, tpl = K.copia(d.tpl);
  if (sub === 'image') {
    const pares = ob.resto.filter(x => x.indexOf('=') > 0);
    if (!pares.length) return err('error: at least one image update is required');
    for (const x of pares) { const [c, img] = x.split('='); if (c !== tpl.contenedor && c !== '*') return err('error: unable to find container named "' + c + '"'); tpl.imagen = img; }
    if (!K.cambiarPlantilla(st, d, tpl, '<none>', st.reloj)) return { lineas: [L('deployment.apps/' + d.nombre + ' image updated')] };
    return { lineas: [L('deployment.apps/' + d.nombre + ' image updated')] };
  }
  const aplica = (txt, dest) => {
    for (const x of String(txt).split(',')) {
      const [k, v] = x.split('=');
      if (k === 'cpu') { const n = K.leerCpu(v); if (n == null) return 'error: quantities must match the regular expression \'^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$\''; dest.cpu = n; }
      else if (k === 'memory') { if (v === '0') { delete dest.mem; continue; } const n = K.leerMem(v); if (n == null) return 'error: quantities must match the regular expression \'^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$\''; dest.mem = n; }
      else return 'error: invalid resource name "' + k + '": must be cpu or memory';
    }
    return null;
  };
  if (!o.f['--limits'] && !o.f['--requests']) return err('error: you must specify an update to requests or limits (in the form of --requests/--limits)');
  const e1 = o.f['--limits'] && aplica(o.f['--limits'], tpl.lim), e2 = o.f['--requests'] && aplica(o.f['--requests'], tpl.req);
  if (e1 || e2) return err(e1 || e2);
  if (tpl.lim.mem && tpl.req.mem > tpl.lim.mem) return err('The Deployment "' + d.nombre + '" is invalid: spec.template.spec.containers[0].resources.requests: Invalid value: "' + K.mem(tpl.req.mem) + '": must be less than or equal to memory limit of ' + K.mem(tpl.lim.mem));
  K.cambiarPlantilla(st, d, tpl, '<none>', st.reloj);
  return { lineas: [L('deployment.apps/' + d.nombre + ' resource requirements updated')] };
}
function scale(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), ob = objetivo(o.pos), n = o.f['--replicas'];
  if (n == null || !/^\d+$/.test(n)) return err('error: --replicas=COUNT is required, and COUNT must be greater than or equal to 0');
  const r = depDe(st, o, ob); if (r.error) return r.error;
  r.d.replicas = parseInt(n, 10); r.d.progreso = st.reloj;
  return { lineas: [L('deployment.apps/' + r.d.nombre + ' scaled')] };
}
function nodoCmd(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), nombre = o.pos[0], n = st.k8s.nodos[nombre], verbo = ctx.nombreSub;
  if (!nombre) return err('error: USAGE: ' + verbo + ' NODE [flags]');
  if (!n) return nf('nodes', nombre);
  if (verbo === 'uncordon') { if (!n.cordon) return { lineas: [L('node/' + nombre + ' already uncordoned')] }; n.cordon = false; K.evento(st, st.reloj, '', 'Normal', 'NodeSchedulable', 'node/' + nombre, 'Node ' + nombre + ' status is now: NodeSchedulable', 'kubelet'); return { lineas: [L('node/' + nombre + ' uncordoned')] }; }
  if (verbo === 'cordon') { if (n.cordon) return { lineas: [L('node/' + nombre + ' already cordoned')] }; n.cordon = true; K.evento(st, st.reloj, '', 'Normal', 'NodeNotSchedulable', 'node/' + nombre, 'Node ' + nombre + ' status is now: NodeNotSchedulable', 'kubelet'); return { lineas: [L('node/' + nombre + ' cordoned')] }; }
  // drain
  const ds = st.k8s.pods.filter(p => p.nodo === nombre && p.sistema && /DaemonSet/.test(p.dueno || ''));
  if (ds.length && !o.f['--ignore-daemonsets']) return { lineas: [L('node/' + nombre + ' cordoned'), L('error: unable to drain node "' + nombre + '" due to error: cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): ' + ds.map(p => p.ns + '/' + p.nombre).join(', '), 'err')], fallo: true };
  if (n.rol === 'cp') return err('error: ' + T('(no se drena el control plane en el simulador)', '(the control plane is not drained in the simulator)'));
  const out = [L('node/' + nombre + ' cordoned'), L('Warning: ignoring DaemonSet-managed Pods: ' + ds.map(p => p.ns + '/' + p.nombre).join(', '))];
  const ps = st.k8s.pods.filter(p => p.nodo === nombre && p.rs);
  ps.forEach(p => out.push(L('evicting pod ' + p.ns + '/' + p.nombre)));
  K.drenar(st, nombre, st.reloj);
  ps.forEach(p => out.push(L('pod/' + p.nombre + ' evicted')));
  out.push(L('node/' + nombre + ' drained'));
  return { lineas: out, minutos: 2 };
}
function borrar(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), ob = objetivo(o.pos), ns = nsDe(st, o);
  if (!ob) return err('error: You must provide one or more resources by argument or filename.');
  if (ob.tipo !== 'pods') return { lineas: [L(T('(en el simulador sólo se borran pods: lo demás se cambia con apply, set, scale o patch)', '(in the simulator only pods are deleted: everything else is changed with apply, set, scale or patch)'), 'dim')], fallo: true };
  const nombres = [ob.nombre].concat(ob.resto).filter(Boolean), s = selDe(o);
  const ps = nombres.length ? nombres.map(n => st.k8s.pods.find(p => p.ns === ns && p.nombre === n) || n) : st.k8s.pods.filter(p => p.ns === ns && s && casa(Object.assign({}, p.labels, p.tpl.labels), s));
  if (!ps.length) return { lineas: [L('No resources found')] };
  const out = [];
  ps.forEach(p => { if (typeof p === 'string') out.push(L('Error from server (NotFound): pods "' + p + '" not found', 'err')); else { out.push(L('pod "' + p.nombre + '" deleted')); if (p.sistema) return; K.borrarPod(st, p, st.reloj); } });
  return { lineas: out };
}

// ------------------------------------------------------------------ apply / diff / patch
function ficherosDe(st, ctx, o) {
  const f = o.f['-f'] || o.f['--filename'];
  if (!f) return { error: err('error: must specify one of -f and -k') };
  const ruta = U.ruta(ctx.ses.cwd, f, ctx.ses).replace(/\/$/, ''), fs = P.vfs(st, ctx.h);
  if (fs.dirs[ruta]) return { ms: K.rutasRepo(st).filter(r => r.indexOf(ruta + '/') === 0).sort().map(r => K.desdeRepo(st, r)).filter(Boolean) };
  if (!fs.f[ruta]) return { error: err('error: the path "' + f + '" does not exist') };
  const m = K.desdeRepo(st, ruta);
  if (!m) return { error: err('error: error validating "' + f + '": error validating data: ' + T('(no es un manifiesto de Kubernetes)', '(not a Kubernetes manifest)')) };
  return { ms: [m] };
}
function apply(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), r = ficherosDe(st, ctx, o);
  if (r.error) return r.error;
  if (o.f['--dry-run']) return { lineas: r.ms.map(m => L(({ Deployment: 'deployment.apps', ConfigMap: 'configmap', Service: 'service' })[m.kind] + '/' + m.nombre + ' configured (dry run)')) };
  return { lineas: r.ms.map(m => L(K.aplicar(st, m, st.reloj))) };
}
// Diferencia de líneas (LCS): basta para manifiestos de unas decenas de líneas.
K.diff = (a, b) => {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push(' ' + a[i]); i++; j++; }
    else if (i < n && (j === m || dp[i + 1][j] >= dp[i][j + 1])) { out.push('-' + a[i]); i++; }
    else { out.push('+' + b[j]); j++; }
  }
  return out;
};
function diff(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), r = ficherosDe(st, ctx, o);
  if (r.error) return r.error;
  const out = [];
  r.ms.forEach(m => {
    const vivo = K.manifiesto(st, m.kind, m.ns + '/' + m.nombre), a = vivo ? K.yamlDe(vivo) : [], b = K.yamlDe(m);
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const g = ({ Deployment: 'apps.v1.Deployment', ConfigMap: 'v1.ConfigMap', Service: 'v1.Service' })[m.kind] + '.' + m.ns + '.' + m.nombre, tmp = U.hex('diff' + st.reloj, 9);
    out.push(L('diff -u -N /tmp/LIVE-' + tmp + '/' + g + ' /tmp/MERGED-' + tmp + '/' + g), L('--- /tmp/LIVE-' + tmp + '/' + g + '\t' + U.iso(st.reloj).replace('T', ' ') + '.000000000 +0000'), L('+++ /tmp/MERGED-' + tmp + '/' + g + '\t' + U.iso(st.reloj).replace('T', ' ') + '.000000000 +0000'));
    const d = K.diff(a, b), cambios = d.map((x, i) => x[0] !== ' ' ? i : -1).filter(i => i >= 0);
    // Un único hunk con tres líneas de contexto a cada lado.
    const desde = Math.max(0, cambios[0] - 3), hasta = Math.min(d.length, cambios[cambios.length - 1] + 4);
    out.push(L('@@ -' + (desde + 1) + ',' + d.slice(desde, hasta).filter(x => x[0] !== '+').length + ' +' + (desde + 1) + ',' + d.slice(desde, hasta).filter(x => x[0] !== '-').length + ' @@', 'dim'));
    d.slice(desde, hasta).forEach(x => out.push(L(x, x[0] === '+' ? 'verde' : x[0] === '-' ? 'rojo' : 'out')));
  });
  return { lineas: out };
}
// patch: sobre el mismo objeto que se pinta en YAML, y vuelta atrás.
const aObjeto = m => {
  if (m.kind === 'ConfigMap') return { data: K.copia(m.data) };
  if (m.kind === 'Service') return { spec: { selector: K.copia(m.selector), ports: [{ port: m.puerto, targetPort: m.targetPort }] } };
  return { metadata: { labels: K.copia(m.labels) }, spec: { replicas: m.replicas, template: { metadata: { labels: K.copia(m.tpl.labels), annotations: K.copia(m.tpl.anot || {}) }, spec: { containers: [K.contenedor(m.tpl)] } } } };
};
function desdeObjeto(m, o) {
  if (m.kind === 'ConfigMap') return Object.assign({}, m, { data: o.data || {} });
  if (m.kind === 'Service') return Object.assign({}, m, { selector: o.spec.selector || {}, puerto: o.spec.ports[0].port, targetPort: o.spec.ports[0].targetPort });
  const c = o.spec.template.spec.containers[0], r = c.resources || {}, tpl = {
    contenedor: c.name, imagen: c.image, puerto: c.ports && c.ports[0] ? c.ports[0].containerPort : 0, envFrom: c.envFrom && c.envFrom[0] ? c.envFrom[0].configMapRef.name : null,
    env: (c.env || []).reduce((a, e) => Object.assign(a, { [e.name]: e.value }), {}), req: {}, lim: {}, ready: c.readinessProbe ? { path: c.readinessProbe.httpGet.path, port: c.readinessProbe.httpGet.port } : null,
    labels: o.spec.template.metadata.labels, anot: o.spec.template.metadata.annotations || {},
  };
  const q = (src, dst) => { if (!src) return null; if (src.cpu != null) { const v = K.leerCpu(src.cpu); if (v == null) return src.cpu; dst.cpu = v; } if (src.memory != null) { const v = K.leerMem(src.memory); if (v == null) return src.memory; dst.mem = v; } return null; };
  const malo = q(r.requests, tpl.req) || q(r.limits, tpl.lim);
  if (malo) throw new Error('quantities must match the regular expression \'^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$\'');
  if (!tpl.imagen) throw new Error('spec.template.spec.containers[0].image: Required value');
  if (tpl.labels.app !== m.labels.app) throw new Error('spec.template.metadata.labels: Invalid value: map[string]string{"app":"' + tpl.labels.app + '"}: `selector` does not match template `labels`');
  return Object.assign({}, m, { replicas: o.spec.replicas, labels: (o.metadata && o.metadata.labels) || m.labels, tpl });
}
function fusionar(a, b, estrategico) {
  if (b === null) return undefined;
  if (Array.isArray(b)) {
    if (estrategico && Array.isArray(a) && b.every(x => x && x.name)) return a.map(x => { const y = b.find(z => z.name === x.name); return y ? fusionar(x, y, true) : x; }).concat(b.filter(y => !a.some(x => x.name === y.name)));
    return K.copia(b);
  }
  if (b && typeof b === 'object') { const r = Object.assign({}, a && typeof a === 'object' && !Array.isArray(a) ? a : {}); Object.keys(b).forEach(k => { const v = fusionar(r[k], b[k], estrategico); if (v === undefined) delete r[k]; else r[k] = v; }); return r; }
  return b;
}
function parcheJson(o, ops) {
  ops.forEach(op => {
    const partes = op.path.split('/').slice(1).map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'));
    let x = o; for (let i = 0; i < partes.length - 1; i++) { x = x[/^\d+$/.test(partes[i]) ? +partes[i] : partes[i]]; if (x == null) throw new Error('the server rejected our request due to an error in our request'); }
    const k = partes[partes.length - 1];
    if (op.op === 'remove') { if (Array.isArray(x)) x.splice(+k, 1); else delete x[k]; }
    else if (op.op === 'replace' || op.op === 'add') { if (op.op === 'replace' && !(k in x)) throw new Error('the server rejected our request due to an error in our request'); x[k] = op.value; }
    else throw new Error('Unable to process the patch: ' + op.op);
  });
  return o;
}
function patch(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR.concat(['-p', '--patch'])), ob = objetivo(o.pos), ns = nsDe(st, o), txt = o.f['-p'] || o.f['--patch'];
  if (!ob || !ob.nombre) return err('error: must specify a resource and a patch: kubectl patch TYPE NAME -p PATCH');
  const kind = ({ deployments: 'Deployment', configmaps: 'ConfigMap', services: 'Service' })[ob.tipo];
  if (!kind) return { lineas: [L(T('(en el simulador se parchean deployments, configmaps y services)', '(in the simulator you can patch deployments, configmaps and services)'), 'dim')], fallo: true };
  const m = K.manifiesto(st, kind, ns + '/' + ob.nombre);
  if (!m) return nf(ob.tipo === 'deployments' ? 'deployments.apps' : ob.tipo, ob.nombre);
  if (!txt) return err('error: must specify -p to patch');
  let p; try { p = JSON.parse(txt); } catch (e) { return err('error: unable to parse "' + txt + '": yaml: did not find expected node content'); }
  const tipo = o.f['--type'] || 'strategic', nombre = ({ Deployment: 'deployment.apps/', ConfigMap: 'configmap/', Service: 'service/' })[kind] + m.nombre;
  let nuevo;
  try {
    const obj = aObjeto(m);
    nuevo = desdeObjeto(m, tipo === 'json' ? parcheJson(obj, Array.isArray(p) ? p : [p]) : fusionar(obj, p, tipo !== 'merge'));
  } catch (e) { return err(/^the server|Unable/.test(e.message) ? 'The request is invalid: ' + e.message : 'The ' + kind + ' "' + m.nombre + '" is invalid: ' + e.message); }
  if (JSON.stringify(nuevo) === JSON.stringify(m)) return { lineas: [L(nombre + ' patched (no change)')] };
  K.aplicar(st, nuevo, st.reloj);
  return { lineas: [L(nombre + ' patched')] };
}

// ------------------------------------------------------------------ exec
function exec(ctx) {
  const st = ctx.st, o = leer(ctx.args, VALOR), ns = nsDe(st, o), nombre = o.pos[0], cmd = o.resto || [];
  if (!nombre) return err('error: pod, type/name or --filename must be specified');
  if (!cmd.length) return err('error: you must specify at least one command for the container');
  const p = st.k8s.pods.find(x => x.ns === ns && x.nombre === nombre);
  if (!p) return nf('pods', nombre);
  if (p.c.estado !== 'corriendo' || !p.nodo) return err('error: unable to upgrade connection: container not found ("' + p.tpl.contenedor + '")');
  if (o.f['-it'] || o.f['-ti'] || /^(ba)?sh$/.test(cmd[0]) && cmd.length === 1) return { lineas: [L(T('(en el simulador no hay shell interactiva: kubectl exec POD -n NS -- comando)', '(no interactive shell in the simulator: kubectl exec POD -n NS -- command)'), 'dim')] };
  const c = cmd[0];
  if (c === 'env' || c === 'printenv') {
    const env = Object.assign({ HOSTNAME: p.nombre, KUBERNETES_SERVICE_HOST: '10.96.0.1', KUBERNETES_SERVICE_PORT: '443', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }, p.c.env);
    if (c === 'printenv' && cmd[1]) return env[cmd[1]] != null ? [L(env[cmd[1]])] : { lineas: [L('command terminated with exit code 1', 'err')], fallo: true };
    return Object.keys(env).sort().map(k => L(k + '=' + env[k]));
  }
  if (c === 'hostname') return [L(p.nombre)];
  if (c === 'curl' || c === 'wget') {
    const url = cmd.slice(1).filter(x => !/^-/.test(x)).pop() || '';
    const m = /^(?:https?:\/\/)?(localhost|127\.0\.0\.1)(?::(\d+))?(\/.*)?$/.exec(url);
    if (!m) return { lineas: [L(c === 'curl' ? 'curl: (6) Could not resolve host: ' + url.replace(/^https?:\/\//, '').split('/')[0] : 'wget: bad address \'' + url + '\'', 'err'), L('command terminated with exit code ' + (c === 'curl' ? 6 : 1), 'err')], fallo: true };
    const puerto = m[2] ? +m[2] : 80, ruta = m[3] || '/';
    if (puerto !== (p.tpl.puerto || 80)) return { lineas: [L(c === 'curl' ? 'curl: (7) Failed to connect to localhost port ' + puerto + ' after 0 ms: Couldn\'t connect to server' : 'wget: can\'t connect to remote host (127.0.0.1): Connection refused', 'err'), L('command terminated with exit code ' + (c === 'curl' ? 7 : 1), 'err')], fallo: true };
    if (!K.sirve(p, ruta)) return c === 'curl' ? (cmd.indexOf('-f') >= 0 || cmd.indexOf('-sf') >= 0 ? { lineas: [L('curl: (22) The requested URL returned error: 404', 'err'), L('command terminated with exit code 22', 'err')], fallo: true } : [L('<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center></body></html>')]) : { lineas: [L('wget: server returned error: HTTP/1.1 404 Not Found', 'err'), L('command terminated with exit code 1', 'err')], fallo: true };
    return [L(/health|ready|healthz/.test(ruta) ? (K.appDe(p).nombre === 'antifraude' ? '{"status":"UP"}' : 'ok') : '<!doctype html><html><head><title>Checkout</title></head>…')];
  }
  if (c === 'ls') return [L('app  bin  etc  lib  tmp  usr  var')];
  if (c === 'cat') return { lineas: [L('cat: ' + (cmd[1] || '') + ': No such file or directory', 'err'), L('command terminated with exit code 1', 'err')], fallo: true };
  return { lineas: [L('error: Internal error occurred: error executing command in container: failed to exec in container: failed to start exec "' + U.hex(p.nombre + c, 64) + '": OCI runtime exec failed: exec failed: unable to start container process: exec: "' + c + '": executable file not found in $PATH: unknown', 'err')], fallo: true };
}

// ------------------------------------------------------------------ el comando
const AYUDA_SUB = ['get', 'describe', 'logs', 'top', 'rollout', 'set', 'scale', 'cordon', 'uncordon', 'drain', 'delete', 'apply', 'diff', 'patch', 'exec', 'edit', 'config', 'cluster-info', 'version', 'api-resources'];
U.cmd('kubectl', { ayuda: T('el clúster: get, describe, logs, rollout, set, scale, apply, diff, exec...', 'the cluster: get, describe, logs, rollout, set, scale, apply, diff, exec...'), grupo: 'Kubernetes', donde: ['ops'], fn: ctx => {
  const st = ctx.st, sub = ctx.args[0], resto = ctx.args.slice(1), c2 = Object.assign({}, ctx, { args: resto, nombreSub: sub });
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') return [L('kubectl controls the Kubernetes cluster manager.'), L(''), L(' Find more information at: https://kubernetes.io/docs/reference/kubectl/'), L('')].concat(AYUDA_SUB.map(x => L('  ' + x)));
  // Lo que puede ir antes del verbo: kubectl -n pagos get pods
  if (/^-/.test(sub)) { const o = leer(ctx.args, VALOR); const i = ctx.args.findIndex((x, j) => x === o.pos[0] && (j === 0 || VALOR.indexOf(ctx.args[j - 1]) < 0)); if (i > 0) return P.comandos.kubectl.fn(Object.assign({}, ctx, { args: [ctx.args[i]].concat(ctx.args.slice(0, i), ctx.args.slice(i + 1)) })); }
  if (resto.indexOf('-w') >= 0 || resto.indexOf('--watch') >= 0) return { lineas: [L(T('(en el simulador -w no se queda mirando: repite el comando, o usa kubectl rollout status)', '(in the simulator -w does not keep watching: run the command again, or use kubectl rollout status)'), 'dim')] };
  switch (sub) {
    case 'get': return get(c2);
    case 'describe': return describe(c2);
    case 'logs': return logs(c2);
    case 'top': return top(c2);
    case 'rollout': return rollout(c2);
    case 'set': return setCmd(c2);
    case 'scale': return scale(c2);
    case 'cordon': case 'uncordon': case 'drain': return nodoCmd(c2);
    case 'delete': return borrar(c2);
    case 'apply': return apply(c2);
    case 'diff': return diff(c2);
    case 'patch': return patch(c2);
    case 'exec': return exec(c2);
    case 'edit': return { lineas: [L(T('(en el simulador no hay editor: cambia el manifiesto con kubectl apply -f, kubectl set, kubectl scale o kubectl patch)', '(there is no editor in the simulator: change things with kubectl apply -f, kubectl set, kubectl scale or kubectl patch)'), 'dim')] };
    case 'config': {
      const a = resto[0];
      if (a === 'current-context') return [L('pagos-prod')];
      if (a === 'get-contexts') return K.tabla(['CURRENT', 'NAME', 'CLUSTER', 'AUTHINFO', 'NAMESPACE'], [['*', 'pagos-prod', 'pagos-prod', 'sre-admin', st.k8s.nsDefecto || '']]);
      if (a === 'set-context') { const o = leer(resto.slice(1), VALOR); if (o.f['--namespace']) { st.k8s.nsDefecto = o.f['--namespace']; return [L('Context "pagos-prod" modified.')]; } return err('error: ' + T('(en el simulador: kubectl config set-context --current --namespace=NS)', '(in the simulator: kubectl config set-context --current --namespace=NS)')); }
      if (a === 'view') return P.vfs(st, ctx.h).f[U.HOME + '/.kube/config'].lineas().map(x => L(x.replace(/(data: ).*/, '$1DATA+OMITTED')));
      return err('error: unknown command "' + (a || '') + '" for "kubectl config"');
    }
    case 'cluster-info': return [L('Kubernetes control plane is running at https://10.30.0.10:6443', 'verde'), L('CoreDNS is running at https://10.30.0.10:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy', 'verde'), L(''), L("To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.")];
    case 'version': return [L('Client Version: v1.29.8'), L('Kustomize Version: v5.0.4-0.20230601165947-6ce0bf390ce3'), L('Server Version: v1.29.8')];
    case 'api-resources': return K.tabla(['NAME', 'SHORTNAMES', 'APIVERSION', 'NAMESPACED', 'KIND'], [['configmaps', 'cm', 'v1', 'true', 'ConfigMap'], ['endpoints', 'ep', 'v1', 'true', 'Endpoints'], ['events', 'ev', 'v1', 'true', 'Event'], ['namespaces', 'ns', 'v1', 'false', 'Namespace'], ['nodes', 'no', 'v1', 'false', 'Node'], ['pods', 'po', 'v1', 'true', 'Pod'], ['services', 'svc', 'v1', 'true', 'Service'], ['deployments', 'deploy', 'apps/v1', 'true', 'Deployment'], ['replicasets', 'rs', 'apps/v1', 'true', 'ReplicaSet']]);
    default: return { lineas: [L('error: unknown command "' + sub + '" for "kubectl"', 'err'), L(''), L('Did you mean this?', 'err')].concat(AYUDA_SUB.filter(x => x[0] === sub[0]).slice(0, 2).map(x => L('\t' + x, 'err'))), fallo: true };
  }
}, completar: (st, ses, pal, ult, rutas) => {
  if (!pal.length) return AYUDA_SUB;
  const ant = pal[pal.length - 1], verbo = pal[0];
  if (ant === '-n' || ant === '--namespace') return K.NAMESPACES;
  if (ant === '-f' || ant === '--filename') return rutas();
  if (verbo === 'rollout' && pal.length === 1) return ['status', 'history', 'undo', 'restart'];
  if (verbo === 'set' && pal.length === 1) return ['image', 'resources'];
  if (['cordon', 'uncordon', 'drain'].indexOf(verbo) >= 0) return Object.keys(st.k8s.nodos);
  const ns = (() => { const i = pal.indexOf('-n'); return i >= 0 ? pal[i + 1] : st.k8s.nsDefecto || 'default'; })();
  if (['logs', 'exec'].indexOf(verbo) >= 0) return st.k8s.pods.filter(p => p.ns === ns).map(p => p.nombre).concat(['-n', '--previous', '--tail']);
  if (['get', 'describe', 'delete'].indexOf(verbo) >= 0 && pal.length === 1) return ['pods', 'deployments', 'replicasets', 'services', 'endpoints', 'nodes', 'events', 'configmaps', 'namespaces', 'all'];
  const t = TIPOS[pal[1]];
  if (t === 'pods') return st.k8s.pods.filter(p => p.ns === ns).map(p => p.nombre).concat(['-n', '-o', '-A']);
  if (t === 'deployments' || ['rollout', 'set', 'scale'].indexOf(verbo) >= 0) return Object.values(st.k8s.deps).filter(d => d.ns === ns).map(d => (pal.length > 1 && t ? '' : 'deployment/') + d.nombre).concat(['-n']);
  if (t === 'nodes') return Object.keys(st.k8s.nodos);
  if (t === 'services' || t === 'endpoints') return Object.values(st.k8s.svcs).filter(s => s.ns === ns).map(s => s.nombre).concat(['-n']);
  if (t === 'configmaps') return Object.values(st.k8s.cms).filter(c => c.ns === ns).map(c => c.nombre).concat(['-n']);
  return ['-n', '-o', '-A', '-l', '-f'];
} });
})(window.PUESTO = window.PUESTO || {});
