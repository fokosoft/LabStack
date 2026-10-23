// Puesto DevOps · fase 2: almacenamiento, Ingress y certificados, HPA, RBAC y
// NetworkPolicies.
//
// Cada recurso se engancha a los registros de cluster.js y kubectl.js:
//   K.kinds       manifiesto, YAML y apply (para ~/k8s, kubectl apply y diff)
//   K.recursos    get / describe / delete
//   K.controladoresExtra   lo que reconcilia cada minuto (cert-manager, la HPA)
//   K.pasosSonda  el camino del pago de prueba (TLS, ingress, red)
//   K.fallosExtra por qué muere un contenedor (un volumen lleno)
//   P.detectores  las alertas, con los nombres de kube-prometheus y cert-manager
// Como en el resto del puesto, una sola fuente de verdad: lo que contesta
// kubectl, lo que ve curl y lo que dispara una alerta sale del mismo estado.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, K = P.k8s, HOME = U.HOME;
const copia = K.copia, CREADO = K.ANTIGUO, DIA = 1440;
const edad = (st, m) => K.edad(st.reloj - m);
const sel = o => Object.keys(o || {}).length ? K.sel(o) : '<none>';
const eventos = (st, obj, ns) => {
  const ev = st.k8s.eventos.filter(e => e.obj === obj && (ns == null || (e.ns || 'default') === ns));
  if (!ev.length) return [L('Events:  <none>')];
  return [L('Events:')].concat(K.tabla(['  Type', 'Reason', 'Age', 'From', 'Message'], [['  ----', '------', '----', '----', '-------']].concat(ev.slice(-10).map(e => ['  ' + e.tipo, e.razon, e.n > 1 ? K.edad(st.reloj - e.min) + ' (x' + e.n + ' over ' + K.edad(st.reloj - e.primero) + ')' : K.edad(st.reloj - e.min), e.de, e.msg]))));
};
const kv = (pares, w) => pares.map(([k, v]) => L((k + ':').padEnd(w || 14) + v));
const recurso = (tipo, def) => { K.recursos[tipo] = def; };
const kind = (k, def) => { K.kinds[k] = def; };
const porNs = (obj, ns) => Object.values(obj).filter(x => ns == null || x.ns === ns);
// Un evento con historia: lleva días repitiéndose (no hace falta simular cada minuto).
const eventoViejo = (st, ns, tipo, razon, obj, msg, de, primero, n) => st.k8s.eventos.push({ ns, tipo, razon, obj, msg, de, n, primero, min: n > 1 ? -1 : primero });
K.eventoViejo = eventoViejo;

// ------------------------------------------------------------------ estado de partida
P.alCrear.push(st => {
  const k = st.k8s;
  // Almacenamiento: Longhorn, con expansión en caliente.
  k.scs = {
    longhorn: { nombre: 'longhorn', prov: 'driver.longhorn.io', reclaim: 'Delete', binding: 'Immediate', expande: true, defecto: true, creado: CREADO },
    'longhorn-static': { nombre: 'longhorn-static', prov: 'driver.longhorn.io', reclaim: 'Retain', binding: 'Immediate', expande: false, defecto: false, creado: CREADO },
  };
  k.pvcs = { 'monitoring/prometheus-data': { ns: 'monitoring', nombre: 'prometheus-data', sc: 'longhorn', tam: 50, pedido: 50, usado: 31.4, ritmo: 0.0004, pv: 'pvc-' + U.uuid('prometheus-data'), modo: 'ReadWriteOnce', creado: CREADO } };
  // Entrada: ingress-nginx, cert-manager y el certificado de la tienda.
  k.issuers = {
    'letsencrypt-prod': { nombre: 'letsencrypt-prod', listo: true, servidor: 'https://acme-v02.api.letsencrypt.org/directory', email: 'plataforma@pagos.example', creado: CREADO },
    'letsencrypt-staging': { nombre: 'letsencrypt-staging', listo: true, servidor: 'https://acme-staging-v02.api.letsencrypt.org/directory', email: 'plataforma@pagos.example', creado: CREADO },
  };
  k.certs = { 'pagos/checkout-tls': { ns: 'pagos', nombre: 'checkout-tls', secret: 'checkout-tls', dns: ['checkout.pagos.example'], issuer: 'letsencrypt-prod', creado: CREADO, peticiones: 4 } };
  k.secrets = {
    'pagos/checkout-tls': { ns: 'pagos', nombre: 'checkout-tls', tipo: 'kubernetes.io/tls', datos: 2, desde: -50400, hasta: -50400 + 90 * DIA, creado: CREADO },
    'pagos/api-pagos-db': { ns: 'pagos', nombre: 'api-pagos-db', tipo: 'Opaque', datos: 2, creado: CREADO },
    'cert-manager/letsencrypt-prod-cuenta': { ns: 'cert-manager', nombre: 'letsencrypt-prod-cuenta', tipo: 'Opaque', datos: 1, creado: CREADO },
  };
  k.ingresses = { 'pagos/checkout': { ns: 'pagos', nombre: 'checkout', clase: 'nginx', host: 'checkout.pagos.example', tls: 'checkout-tls', reglas: [{ path: '/api', svc: 'api-pagos', port: 8080 }, { path: '/', svc: 'web-checkout', port: 80 }], creado: CREADO } };
  // HPA: api-pagos escala con la CPU. La carga normal no la mueve del mínimo.
  k.carga = { 'api-pagos': 180 };
  k.hpas = { 'pagos/api-pagos': { ns: 'pagos', nombre: 'api-pagos', dep: 'api-pagos', min: 3, max: 12, objetivo: 70, creado: CREADO, recs: [], maxDesde: null } };
  // RBAC.
  k.sas = ['ci/deployer', 'ci/default', 'pagos/default', 'pagos/liquidaciones', 'monitoring/prometheus', 'monitoring/default', 'cert-manager/cert-manager', 'ingress-nginx/ingress-nginx', 'kube-system/default']
    .map(x => ({ ns: x.split('/')[0], nombre: x.split('/')[1], creado: CREADO }));
  const R = (grupos, recursos, verbos) => ({ grupos, recursos, verbos });
  k.croles = {
    'cluster-admin': { nombre: 'cluster-admin', reglas: [R(['*'], ['*'], ['*'])] },
    admin: { nombre: 'admin', reglas: [R(['', 'apps', 'networking.k8s.io', 'autoscaling', 'rbac.authorization.k8s.io'], ['*'], ['*'])] },
    edit: { nombre: 'edit', reglas: [R(['', 'apps', 'networking.k8s.io', 'autoscaling'], ['pods', 'pods/log', 'pods/exec', 'services', 'endpoints', 'configmaps', 'secrets', 'persistentvolumeclaims', 'deployments', 'replicasets', 'ingresses', 'horizontalpodautoscalers'], ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'])] },
    view: { nombre: 'view', reglas: [R(['', 'apps', 'networking.k8s.io', 'autoscaling'], ['pods', 'pods/log', 'services', 'endpoints', 'configmaps', 'persistentvolumeclaims', 'deployments', 'replicasets', 'ingresses', 'horizontalpodautoscalers'], ['get', 'list', 'watch'])] },
  };
  k.roles = { 'pagos/desplegador': { ns: 'pagos', nombre: 'desplegador', creado: CREADO, reglas: [R(['apps'], ['deployments'], ['get', 'list', 'watch', 'patch', 'update']), R(['apps'], ['replicasets'], ['get', 'list', 'watch']), R([''], ['pods', 'services', 'configmaps'], ['get', 'list', 'watch'])] } };
  k.rbs = {
    'pagos/deployer-desplegador': { ns: 'pagos', nombre: 'deployer-desplegador', rol: { kind: 'Role', nombre: 'desplegador' }, sujetos: [{ kind: 'ServiceAccount', nombre: 'deployer', ns: 'ci' }], creado: CREADO },
    'monitoring/prometheus-view': { ns: 'monitoring', nombre: 'prometheus-view', rol: { kind: 'ClusterRole', nombre: 'view' }, sujetos: [{ kind: 'ServiceAccount', nombre: 'prometheus', ns: 'monitoring' }], creado: CREADO },
  };
  k.crbs = {
    'cluster-admin': { nombre: 'cluster-admin', rol: { kind: 'ClusterRole', nombre: 'cluster-admin' }, sujetos: [{ kind: 'Group', nombre: 'system:masters' }], creado: CREADO },
    'plataforma-admin': { nombre: 'plataforma-admin', rol: { kind: 'ClusterRole', nombre: 'cluster-admin' }, sujetos: [{ kind: 'User', nombre: 'sre-admin' }], creado: CREADO },
  };
  // NetworkPolicies: pagos está cerrado por defecto y se abre lo justo.
  const np = (nombre, selector, ingress) => ({ ns: 'pagos', nombre, sel: selector, tipos: ['Ingress'], ingress, creado: CREADO });
  k.netpols = {
    'pagos/default-deny-ingress': np('default-deny-ingress', {}, []),
    'pagos/permitir-ingress-a-web': np('permitir-ingress-a-web', { app: 'web-checkout' }, [{ desde: [{ ns: { 'kubernetes.io/metadata.name': 'ingress-nginx' } }], puertos: [80] }]),
    'pagos/permitir-ingress-a-api': np('permitir-ingress-a-api', { app: 'api-pagos' }, [{ desde: [{ ns: { 'kubernetes.io/metadata.name': 'ingress-nginx' } }, { pod: { app: 'web-checkout' } }], puertos: [8080] }]),
    'pagos/permitir-api-a-antifraude': np('permitir-api-a-antifraude', { app: 'antifraude' }, [{ desde: [{ pod: { app: 'api-pagos' } }], puertos: [8080] }]),
    'pagos/permitir-monitorizacion': np('permitir-monitorizacion', {}, [{ desde: [{ ns: { 'kubernetes.io/metadata.name': 'monitoring' } }], puertos: [] }]),
  };
  // El repositorio también los declara.
  const repo = (ruta, kind, key) => { k.repo[ruta] = K.manifiesto(st, kind, key); };
  repo('monitoring/prometheus-pvc.yaml', 'PersistentVolumeClaim', 'monitoring/prometheus-data');
  repo('web-checkout/certificate.yaml', 'Certificate', 'pagos/checkout-tls');
  repo('web-checkout/ingress.yaml', 'Ingress', 'pagos/checkout');
  repo('api-pagos/hpa.yaml', 'HorizontalPodAutoscaler', 'pagos/api-pagos');
  repo('rbac/deployer-rolebinding.yaml', 'RoleBinding', 'pagos/deployer-desplegador');
  Object.keys(k.netpols).forEach(key => repo('netpol/' + key.split('/')[1] + '.yaml', 'NetworkPolicy', key));
  k.git = [
    ['a91c3f2', -2900, 'Laura Méndez', 'web-checkout: 1.8.3'],
    ['5d0e7b1', -6100, 'Iván Rubio', T('netpol: cerrar pagos por defecto y abrir lo justo', 'netpol: close pagos by default and open just what is needed')],
    ['e44f019', -9800, 'Raúl Ortega', T('api-pagos: hpa de 3 a 12 réplicas al 70 % de CPU', 'api-pagos: hpa from 3 to 12 replicas at 70% CPU')],
    ['0b7d2c8', -172000, 'Plataforma', T('primer commit: manifiestos de pagos-prod', 'first commit: pagos-prod manifests')],
  ].map(([h, min, autor, msg]) => ({ h, min, autor, msg }));
});

// ------------------------------------------------------------------ almacenamiento
K.pvcDe = (st, p) => p.tpl.pvc && st.k8s.pvcs[p.ns + '/' + p.tpl.pvc.nombre];
K.fallosExtra.push((st, p) => { const v = K.pvcDe(st, p); return v && v.usado >= v.tam - 0.05 ? { tras: 0, razon: 'Error', codigo: 1, disco: true } : null; });
K.controladoresExtra.push((st, t) => {
  Object.values(st.k8s.pvcs || {}).forEach(v => {
    // Lo que escribe el pod que lo monta (sólo mientras corre).
    const usa = st.k8s.pods.some(p => K.pvcDe(st, p) === v && p.c.estado === 'corriendo');
    if (usa) v.usado = Math.min(v.tam, v.usado + v.ritmo);
    // Expansión en caliente: el CSI amplía el volumen y luego el sistema de ficheros.
    if (v.pedido > v.tam) {
      if (!v.redim) { v.redim = t; K.evento(st, t, v.ns, 'Normal', 'Resizing', 'persistentvolumeclaim/' + v.nombre, 'External resizer is resizing volume ' + v.pv, 'external-resizer driver.longhorn.io'); }
      else if (t >= v.redim + 1) {
        K.evento(st, t, v.ns, 'Normal', 'FileSystemResizeSuccessful', 'persistentvolumeclaim/' + v.nombre, 'MountVolume.NodeExpandVolume succeeded for volume "' + v.pv + '"', 'kubelet');
        v.tam = v.pedido; v.redim = null;
      }
    }
  });
});
recurso('storageclasses', { alias: ['sc', 'storageclass'], singular: 'storageclass.storage.k8s.io', nf: 'storageclasses.storage.k8s.io', global: true,
  listar: st => Object.values(st.k8s.scs),
  tabla: (st, xs) => [['NAME', 'PROVISIONER', 'RECLAIMPOLICY', 'VOLUMEBINDINGMODE', 'ALLOWVOLUMEEXPANSION', 'AGE'], xs.map(s => [s.nombre + (s.defecto ? ' (default)' : ''), s.prov, s.reclaim, s.binding, String(s.expande), edad(st, s.creado)])],
  yaml: (st, s) => K.yaml({ allowVolumeExpansion: s.expande, apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: s.nombre }, provisioner: s.prov, reclaimPolicy: s.reclaim, volumeBindingMode: s.binding }),
  describe: (st, s) => kv([['Name', s.nombre], ['IsDefaultClass', s.defecto ? 'Yes' : 'No'], ['Provisioner', s.prov], ['AllowVolumeExpansion', s.expande ? 'True' : 'False'], ['ReclaimPolicy', s.reclaim], ['VolumeBindingMode', s.binding]], 22).concat([L('Events:                <none>')]),
});
recurso('persistentvolumeclaims', { alias: ['pvc', 'persistentvolumeclaim'], singular: 'persistentvolumeclaim', nf: 'persistentvolumeclaims',
  listar: (st, ns) => porNs(st.k8s.pvcs, ns),
  tabla: (st, xs, o, conNs) => [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'STATUS', 'VOLUME', 'CAPACITY', 'ACCESS MODES', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'AGE']), xs.map(v => (conNs ? [v.ns] : []).concat([v.nombre, 'Bound', v.pv, v.tam + 'Gi', 'RWO', v.sc, '<unset>', edad(st, v.creado)]))],
  yaml: (st, v) => K.yamlDe(K.manifiesto(st, 'PersistentVolumeClaim', v.ns + '/' + v.nombre)).concat(['status:', '  capacity:', '    storage: ' + v.tam + 'Gi', '  phase: Bound']),
  describe: (st, v) => {
    const pod = st.k8s.pods.find(p => K.pvcDe(st, p) === v);
    return kv([['Name', v.nombre], ['Namespace', v.ns], ['StorageClass', v.sc], ['Status', 'Bound'], ['Volume', v.pv], ['Labels', '<none>'], ['Annotations', 'pv.kubernetes.io/bind-completed: yes'], ['Finalizers', '[kubernetes.io/pvc-protection]'], ['Capacity', v.tam + 'Gi'], ['Access Modes', 'RWO'], ['VolumeMode', 'Filesystem'], ['Used By', pod ? pod.nombre : '<none>']], 15)
      .concat(v.redim != null ? [L('Conditions:'), L('  Type       Status  LastProbeTime                     LastTransitionTime                Reason  Message'), L('  ----       ------  -----------------                 ------------------                ------  -------'), L('  Resizing   True    Mon, 01 Jan 0001 00:00:00 +0000   ' + K.fecha(v.redim) + '           ')] : [])
      .concat(eventos(st, 'persistentvolumeclaim/' + v.nombre, v.ns));
  },
});
recurso('persistentvolumes', { alias: ['pv', 'persistentvolume'], singular: 'persistentvolume', nf: 'persistentvolumes', global: true,
  listar: st => Object.values(st.k8s.pvcs).map(v => ({ nombre: v.pv, v })),
  tabla: (st, xs) => [['NAME', 'CAPACITY', 'ACCESS MODES', 'RECLAIM POLICY', 'STATUS', 'CLAIM', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'REASON', 'AGE'], xs.map(x => [x.nombre, x.v.tam + 'Gi', 'RWO', st.k8s.scs[x.v.sc].reclaim, 'Bound', x.v.ns + '/' + x.v.nombre, x.v.sc, '<unset>', '', edad(st, x.v.creado)])],
  yaml: (st, x) => K.yaml({ apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: x.nombre }, spec: { capacity: { storage: x.v.tam + 'Gi' }, claimRef: { name: x.v.nombre, namespace: x.v.ns }, csi: { driver: 'driver.longhorn.io', volumeHandle: x.nombre }, storageClassName: x.v.sc } }),
});
kind('PersistentVolumeClaim', { prefijo: 'persistentvolumeclaim', grupo: 'v1.PersistentVolumeClaim',
  manifiesto: (st, key) => { const v = st.k8s.pvcs[key]; return v && { kind: 'PersistentVolumeClaim', ns: v.ns, nombre: v.nombre, sc: v.sc, modo: v.modo, tam: v.pedido }; },
  yaml: m => K.yaml({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: m.nombre, namespace: m.ns }, spec: { accessModes: [m.modo], storageClassName: m.sc, resources: { requests: { storage: m.tam + 'Gi' } } } }),
  aplicar: (st, m, t, vivo) => {
    if (!vivo) return T('(en el simulador no se crean volúmenes nuevos)', '(new volumes cannot be created in the simulator)');
    const v = st.k8s.pvcs[m.ns + '/' + m.nombre];
    if (m.sc !== vivo.sc || m.modo !== vivo.modo) return 'The PersistentVolumeClaim "' + m.nombre + '" is invalid: spec: Forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims';
    if (m.tam < v.pedido) return 'The PersistentVolumeClaim "' + m.nombre + '" is invalid: spec.resources.requests.storage: Forbidden: field can not be less than previous value';
    if (!st.k8s.scs[v.sc].expande) return 'Error from server (Forbidden): persistentvolumeclaims "' + m.nombre + '" is forbidden: only dynamically provisioned pvc can be resized and the storageclass that provisions the pvc must support resize';
    v.pedido = m.tam;
    return null;
  },
});
P.detectores.push((st, add) => {
  Object.values(st.k8s.pvcs || {}).forEach(v => {
    const libre = (v.tam - v.usado) / v.tam * 100;
    if (libre < 15) add('KubePersistentVolumeFillingUp', libre < 3 ? 'critical' : 'warning', null, T('Al volumen de ' + v.nombre + ' (namespace ' + v.ns + ') sólo le queda un ' + libre.toFixed(1) + ' % libre', 'The PersistentVolume claimed by ' + v.nombre + ' in Namespace ' + v.ns + ' is only ' + libre.toFixed(1) + '% free.'), 'KubePersistentVolumeFillingUp|' + v.nombre);
  });
});

// ------------------------------------------------------------------ Ingress y cert-manager
const listos = (st, key) => { const d = st.k8s.deps[key]; return d ? K.podsDe(st, d).filter(p => K.listo(st, p)) : []; };
const RENUEVA = 30 * DIA;
K.secretoValido = (st, s) => !!s && s.desde <= st.reloj && st.reloj < s.hasta;
K.controladoresExtra.push((st, t) => {
  if (!listos(st, 'cert-manager/cert-manager').length) return;   // sin controlador, nadie renueva
  Object.values(st.k8s.certs || {}).forEach(c => {
    const s = st.k8s.secrets[c.ns + '/' + c.secret];
    if (s && t < s.hasta - RENUEVA) return;
    const obj = 'certificate/' + c.nombre, iss = st.k8s.issuers[c.issuer];
    if (!iss || !iss.listo) {
      if (c.fallaDesde == null) { c.fallaDesde = t; c.peticiones++; K.evento(st, t, c.ns, 'Normal', 'Issuing', obj, s ? 'Renewing certificate as renewal was scheduled at ' + U.iso(s.hasta - RENUEVA).replace('T', ' ') + ' +0000 UTC' : 'Issuing certificate as Secret does not exist', 'cert-manager-certificates-trigger'); K.evento(st, t, c.ns, 'Normal', 'Requested', obj, 'Created new CertificateRequest resource "' + c.nombre + '-' + c.peticiones + '"', 'cert-manager-certificates-request-manager'); }
      K.evento(st, t, c.ns, 'Warning', 'IssuerNotFound', 'certificaterequest/' + c.nombre + '-' + c.peticiones, 'Referenced "ClusterIssuer" not found: clusterissuer.cert-manager.io "' + c.issuer + '" not found', 'cert-manager-certificaterequests-approver');
      return;
    }
    c.fallaDesde = null; c.peticiones++;
    K.evento(st, t, c.ns, 'Normal', 'Issuing', obj, s ? 'Renewing certificate as renewal was scheduled at ' + U.iso(s.hasta - RENUEVA).replace('T', ' ') + ' +0000 UTC' : 'Issuing certificate as Secret does not exist', 'cert-manager-certificates-trigger');
    K.evento(st, t, c.ns, 'Normal', 'Requested', obj, 'Created new CertificateRequest resource "' + c.nombre + '-' + c.peticiones + '"', 'cert-manager-certificates-request-manager');
    K.evento(st, t, c.ns, 'Normal', 'Issuing', obj, 'The certificate has been successfully issued', 'cert-manager-certificates-issuing');
    st.k8s.secrets[c.ns + '/' + c.secret] = { ns: c.ns, nombre: c.secret, tipo: 'kubernetes.io/tls', datos: 2, desde: t, hasta: t + 90 * DIA, creado: s ? s.creado : t };
  });
});
const certListo = (st, c) => { const s = st.k8s.secrets[c.ns + '/' + c.secret]; return K.secretoValido(st, s) && !!st.k8s.issuers[c.issuer]; };
// El camino del pago entra por aquí: el controlador, el certificado, la regla y la red.
K.pasosSonda.unshift(
  st => listos(st, 'ingress-nginx/ingress-nginx-controller').length ? null : { codigo: 0, porque: T('el ingress controller no tiene pods listos', 'the ingress controller has no ready pods') },
  (st, o) => {
    if (o.sinTls) return null;
    const ing = Object.values(st.k8s.ingresses).find(i => i.host === 'checkout.pagos.example'), s = ing && st.k8s.secrets[ing.ns + '/' + ing.tls];
    if (!s) return { codigo: 0, porque: T('el ingress sirve su certificado de pega', 'the ingress serves its fake certificate'), tls: ['curl: (60) SSL: no alternative certificate subject name matches target host name \'checkout.pagos.example\'', 'More details here: https://curl.se/docs/sslcerts.html'] };
    if (!K.secretoValido(st, s)) return { codigo: 0, porque: T('el certificado TLS ha caducado', 'the TLS certificate has expired'), tls: ['curl: (60) SSL certificate problem: certificate has expired', 'More details here: https://curl.se/docs/sslcerts.html', '', 'curl failed to verify the legitimacy of the server and therefore could not', 'establish a secure connection to it. To learn more about this situation and', 'how to fix it, please visit the webpage mentioned above.'] };
    return null;
  },
  st => Object.values(st.k8s.ingresses).some(i => i.host === 'checkout.pagos.example') ? null : { codigo: 404, porque: T('ningún Ingress sirve checkout.pagos.example', 'no Ingress serves checkout.pagos.example') },
  st => { const c = listos(st, 'ingress-nginx/ingress-nginx-controller')[0]; return c && K.endpoints(st, st.k8s.svcs['pagos/web-checkout']).length && !K.alcanza(st, c, 'pagos/web-checkout') ? { codigo: 504, porque: T('la red no deja pasar del ingress a web-checkout', 'the network does not let traffic from the ingress reach web-checkout') } : null; },
);
K.pasosSonda.push(st => { const w = K.endpoints(st, st.k8s.svcs['pagos/web-checkout'])[0]; return w && K.endpoints(st, st.k8s.svcs['pagos/api-pagos']).length && !K.alcanza(st, w, 'pagos/api-pagos') ? { codigo: 504, porque: T('la red no deja pasar de web-checkout a api-pagos', 'the network does not let traffic from web-checkout reach api-pagos') } : null; });
// curl -v: lo que dice el servidor de su certificado.
K.curlVerbose = st => {
  const ing = Object.values(st.k8s.ingresses).find(i => i.host === 'checkout.pagos.example'), s = ing && st.k8s.secrets[ing.ns + '/' + ing.tls];
  const f = m => { const d = new Date(U.iso(m) + 'Z'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + String(d.getUTCDate()).padStart(2) + ' ' + U.iso(m).slice(11) + ' ' + d.getUTCFullYear() + ' GMT'; };
  const out = ['*   Trying 10.30.0.200:443...', '* Connected to checkout.pagos.example (10.30.0.200) port 443', '* ALPN: curl offers h2,http/1.1', '* TLSv1.3 (OUT), TLS handshake, Client hello (1):'];
  if (s) out.push('* Server certificate:', '*  subject: CN=checkout.pagos.example', '*  start date: ' + f(s.desde), '*  expire date: ' + f(s.hasta), '*  subjectAltName: host "checkout.pagos.example" matched cert\'s "checkout.pagos.example"', '*  issuer: C=US; O=Let\'s Encrypt; CN=R11');
  else out.push('* Server certificate:', '*  subject: O=Acme Co; CN=Kubernetes Ingress Controller Fake Certificate', '*  issuer: O=Acme Co; CN=Kubernetes Ingress Controller Fake Certificate');
  return out.map(x => L(x, 'dim'));
};
recurso('certificates', { alias: ['certificate', 'cert', 'certs'], singular: 'certificate.cert-manager.io', nf: 'certificates.cert-manager.io',
  listar: (st, ns) => porNs(st.k8s.certs, ns),
  tabla: (st, xs, o, conNs) => [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'READY', 'SECRET', 'AGE']), xs.map(c => (conNs ? [c.ns] : []).concat([c.nombre, certListo(st, c) ? 'True' : 'False', c.secret, edad(st, c.creado)]))],
  yaml: (st, c) => K.yamlDe(K.manifiesto(st, 'Certificate', c.ns + '/' + c.nombre)),
  describe: (st, c) => {
    const s = st.k8s.secrets[c.ns + '/' + c.secret], listo = certListo(st, c), iss = st.k8s.issuers[c.issuer];
    const out = kv([['Name', c.nombre], ['Namespace', c.ns], ['Labels', '<none>'], ['Annotations', '<none>'], ['API Version', 'cert-manager.io/v1'], ['Kind', 'Certificate']], 14);
    out.push(L('Spec:'), L('  Dns Names:'), ...c.dns.map(d => L('    ' + d)), L('  Issuer Ref:'), L('    Group:  cert-manager.io'), L('    Kind:   ClusterIssuer'), L('    Name:   ' + c.issuer), L('  Secret Name:  ' + c.secret));
    out.push(L('Status:'), L('  Conditions:'));
    if (s && !iss) out.push(L('    Last Transition Time:  ' + U.iso(s.hasta - RENUEVA) + 'Z'), L('    Message:               Renewing certificate as renewal was scheduled at ' + U.iso(s.hasta - RENUEVA).replace('T', ' ') + ' +0000 UTC'), L('    Observed Generation:   1'), L('    Reason:                Renewing'), L('    Status:                True'), L('    Type:                  Issuing'));
    out.push(L('    Last Transition Time:  ' + U.iso(s && !listo ? s.hasta : s ? s.desde : c.creado) + 'Z'), L('    Message:               ' + (listo ? 'Certificate is up to date and has not expired' : s ? 'Certificate expired on ' + U.iso(s.hasta).replace('T', ' ') + ' +0000 UTC' : 'Issuing certificate as Secret does not exist')), L('    Observed Generation:   1'), L('    Reason:                ' + (listo ? 'Ready' : s ? 'Expired' : 'DoesNotExist'), listo ? 'out' : 'rojo'), L('    Status:                ' + (listo ? 'True' : 'False')), L('    Type:                  Ready'));
    if (s) out.push(L('  Not After:               ' + U.iso(s.hasta) + 'Z', !K.secretoValido(st, s) ? 'rojo' : 'out'), L('  Not Before:              ' + U.iso(s.desde) + 'Z'), L('  Renewal Time:            ' + U.iso(s.hasta - RENUEVA) + 'Z'));
    out.push(L('  Revision:                ' + Math.max(1, c.peticiones - (c.fallaDesde != null ? 1 : 0))));
    return out.concat(eventos(st, 'certificate/' + c.nombre, c.ns), c.fallaDesde != null ? [L(''), L(T('(la última CertificateRequest, ' + c.nombre + '-' + c.peticiones + ', explica por qué no se emite: kubectl describe certificaterequest ' + c.nombre + '-' + c.peticiones + ' -n ' + c.ns + ')', '(the latest CertificateRequest, ' + c.nombre + '-' + c.peticiones + ', explains why it is not issued: kubectl describe certificaterequest ' + c.nombre + '-' + c.peticiones + ' -n ' + c.ns + ')'), 'dim')] : []);
  },
});
recurso('certificaterequests', { alias: ['certificaterequest', 'cr', 'crs'], singular: 'certificaterequest.cert-manager.io', nf: 'certificaterequests.cert-manager.io',
  listar: (st, ns) => porNs(st.k8s.certs, ns).map(c => ({ ns: c.ns, nombre: c.nombre + '-' + c.peticiones, c })),
  tabla: (st, xs, o, conNs) => [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'APPROVED', 'DENIED', 'READY', 'ISSUER', 'REQUESTOR', 'AGE']), xs.map(x => (conNs ? [x.ns] : []).concat([x.nombre, 'True', '', x.c.fallaDesde != null ? 'False' : 'True', x.c.issuer, 'system:serviceaccount:cert-manager:cert-manager', K.edad(st.reloj - (x.c.fallaDesde != null ? x.c.fallaDesde : -50400))]))],
  yaml: (st, x) => K.yaml({ apiVersion: 'cert-manager.io/v1', kind: 'CertificateRequest', metadata: { name: x.nombre, namespace: x.ns }, spec: { issuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: x.c.issuer } } }),
  describe: (st, x) => kv([['Name', x.nombre], ['Namespace', x.ns], ['API Version', 'cert-manager.io/v1'], ['Kind', 'CertificateRequest']], 14).concat([L('Spec:'), L('  Issuer Ref:'), L('    Group:  cert-manager.io'), L('    Kind:   ClusterIssuer'), L('    Name:   ' + x.c.issuer), L('Status:'), L('  Conditions:'), L('    Reason:   ' + (x.c.fallaDesde != null ? 'Pending' : 'Issued')), L('    Status:   ' + (x.c.fallaDesde != null ? 'False' : 'True')), L('    Type:     Ready')], eventos(st, 'certificaterequest/' + x.nombre, x.ns)),
});
recurso('clusterissuers', { alias: ['clusterissuer'], singular: 'clusterissuer.cert-manager.io', nf: 'clusterissuers.cert-manager.io', global: true,
  listar: st => Object.values(st.k8s.issuers),
  tabla: (st, xs) => [['NAME', 'READY', 'AGE'], xs.map(i => [i.nombre, i.listo ? 'True' : 'False', edad(st, i.creado)])],
  yaml: (st, i) => K.yaml({ apiVersion: 'cert-manager.io/v1', kind: 'ClusterIssuer', metadata: { name: i.nombre }, spec: { acme: { server: i.servidor, email: i.email, privateKeySecretRef: { name: i.nombre + '-cuenta' }, solvers: [{ http01: { ingress: { ingressClassName: 'nginx' } } }] } } }),
  describe: (st, i) => kv([['Name', i.nombre], ['API Version', 'cert-manager.io/v1'], ['Kind', 'ClusterIssuer']], 14).concat([L('Spec:'), L('  Acme:'), L('    Email:   ' + i.email), L('    Server:  ' + i.servidor), L('Status:'), L('  Conditions:'), L('    Message:  The ACME account was registered with the ACME server'), L('    Reason:   ACMEAccountRegistered'), L('    Status:   ' + (i.listo ? 'True' : 'False')), L('    Type:     Ready'), L('Events:  <none>')]),
});
recurso('ingresses', { alias: ['ingress', 'ing'], singular: 'ingress.networking.k8s.io', nf: 'ingresses.networking.k8s.io',
  listar: (st, ns) => porNs(st.k8s.ingresses, ns),
  tabla: (st, xs, o, conNs) => [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'CLASS', 'HOSTS', 'ADDRESS', 'PORTS', 'AGE']), xs.map(i => (conNs ? [i.ns] : []).concat([i.nombre, i.clase, i.host, '10.30.0.200', i.tls ? '80, 443' : '80', edad(st, i.creado)]))],
  yaml: (st, i) => K.yamlDe(K.manifiesto(st, 'Ingress', i.ns + '/' + i.nombre)),
  describe: (st, i) => {
    const out = kv([['Name', i.nombre], ['Labels', '<none>'], ['Namespace', i.ns], ['Address', '10.30.0.200'], ['Ingress Class', i.clase], ['Default backend', '<default>']], 17);
    out.push(L('TLS:'), L('  ' + i.tls + ' terminates ' + i.host), L('Rules:'), L('  Host                    Path  Backends'), L('  ----                    ----  --------'));
    i.reglas.forEach((r, n) => { const s = st.k8s.svcs[i.ns + '/' + r.svc], eps = s ? K.endpoints(st, s) : []; out.push(L('  ' + (n ? '' : i.host).padEnd(24) + r.path.padEnd(6) + r.svc + ':' + r.port + ' (' + (eps.length ? eps.map(p => p.ip + ':' + s.targetPort).join(',') : '<none>') + ')')); });
    return out.concat([L('Annotations:  <none>')], eventos(st, 'ingress/' + i.nombre, i.ns));
  },
});
recurso('secrets', { alias: ['secret'], singular: 'secret', nf: 'secrets',
  listar: (st, ns) => porNs(st.k8s.secrets, ns).concat(K.secretosHelm ? K.secretosHelm(st).filter(s => ns == null || s.ns === ns) : []).sort((a, b) => (a.nombre < b.nombre ? -1 : 1)),
  tabla: (st, xs, o, conNs) => [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'TYPE', 'DATA', 'AGE']), xs.map(s => (conNs ? [s.ns] : []).concat([s.nombre, s.tipo, s.datos, edad(st, s.creado)]))],
  yaml: (st, s) => K.yaml({ apiVersion: 'v1', data: s.tipo === 'kubernetes.io/tls' ? { 'tls.crt': 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t' + U.hex(s.nombre + s.desde, 24), 'tls.key': 'LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0t' + U.hex(s.nombre, 16) } : { valor: U.hex(s.nombre, 24) }, kind: 'Secret', metadata: { name: s.nombre, namespace: s.ns }, type: s.tipo }),
  describe: (st, s) => kv([['Name', s.nombre], ['Namespace', s.ns], ['Labels', '<none>'], ['Annotations', '<none>']], 14).concat([L(''), L('Type:  ' + s.tipo), L(''), L('Data'), L('====')], s.tipo === 'kubernetes.io/tls' ? [L('tls.crt:  3742 bytes'), L('tls.key:  1679 bytes')] : s.tipo === 'helm.sh/release.v1' ? [L('release:  48213 bytes')] : [L('valor:  32 bytes')]),
  borrar: (st, s, t) => { if (s.helm) K.borrarRevisionHelm(st, s); else delete st.k8s.secrets[s.ns + '/' + s.nombre]; void t; },
});
const reglaYaml = i => ({ host: i.host, http: { paths: i.reglas.map(r => ({ path: r.path, pathType: 'Prefix', backend: { service: { name: r.svc, port: { number: r.port } } } })) } });
kind('Certificate', { prefijo: 'certificate.cert-manager.io', grupo: 'cert-manager.io.v1.Certificate',
  manifiesto: (st, key) => { const c = st.k8s.certs[key]; return c && { kind: 'Certificate', ns: c.ns, nombre: c.nombre, secret: c.secret, dns: copia(c.dns), issuer: c.issuer }; },
  yaml: m => K.yaml({ apiVersion: 'cert-manager.io/v1', kind: 'Certificate', metadata: { name: m.nombre, namespace: m.ns }, spec: { secretName: m.secret, dnsNames: m.dns, issuerRef: { name: m.issuer, kind: 'ClusterIssuer', group: 'cert-manager.io' }, duration: '2160h', renewBefore: '720h' } }),
  aplicar: (st, m) => { const c = st.k8s.certs[m.ns + '/' + m.nombre]; Object.assign(c, { secret: m.secret, dns: m.dns, issuer: m.issuer, fallaDesde: null }); return null; },
});
kind('Ingress', { prefijo: 'ingress.networking.k8s.io', grupo: 'networking.k8s.io.v1.Ingress',
  manifiesto: (st, key) => { const i = st.k8s.ingresses[key]; return i && { kind: 'Ingress', ns: i.ns, nombre: i.nombre, clase: i.clase, host: i.host, tls: i.tls, reglas: copia(i.reglas) }; },
  yaml: m => K.yaml({ apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: { name: m.nombre, namespace: m.ns }, spec: { ingressClassName: m.clase, tls: [{ hosts: [m.host], secretName: m.tls }], rules: [reglaYaml(m)] } }),
  aplicar: (st, m) => { Object.assign(st.k8s.ingresses[m.ns + '/' + m.nombre], { clase: m.clase, host: m.host, tls: m.tls, reglas: m.reglas }); return null; },
});
P.detectores.push((st, add) => {
  Object.values(st.k8s.certs || {}).forEach(c => {
    const s = st.k8s.secrets[c.ns + '/' + c.secret], dias = s ? (s.hasta - st.reloj) / DIA : -1;
    if (!certListo(st, c)) add('CertManagerCertNotReady', 'critical', null, T('El certificado ' + c.ns + '/' + c.nombre + ' no está listo' + (s && dias < 0 ? ' (caducado)' : ''), 'The cert-manager certificate ' + c.ns + '/' + c.nombre + ' does not have a Ready condition' + (s && dias < 0 ? ' (expired)' : '')), 'CertManagerCertNotReady|' + c.nombre);
    else if (dias < 21) add('CertManagerCertExpirySoon', 'warning', null, T('El certificado ' + c.ns + '/' + c.nombre + ' caduca en ' + Math.floor(dias) + ' días', 'The cert-manager certificate ' + c.ns + '/' + c.nombre + ' expires in ' + Math.floor(dias) + ' days'), 'CertManagerCertExpirySoon|' + c.nombre);
  });
});

// ------------------------------------------------------------------ HPA
// La CPU de api-pagos sale de la carga repartida entre sus pods listos.
const POR_POD = 110;   // peticiones por segundo que un pod atiende sin que suba la latencia
K.rpsPorPod = st => { const n = listos(st, 'pagos/api-pagos').length; return (st.k8s.carga || {})['api-pagos'] / Math.max(1, n); };
K.APPS['api-pagos'].cpu = (st, p) => Math.round(40 + (st.k8s.carga ? K.rpsPorPod(st) : 60) * 1.2) + (p.nombre.charCodeAt(p.nombre.length - 1) % 7);
K.latenciaApi = st => { const r = K.rpsPorPod(st); return r <= POR_POD ? 30 : Math.round(300 + (r - POR_POD) * 15); };
const utilHpa = (st, h) => {
  const d = st.k8s.deps[h.ns + '/' + h.dep], ps = K.podsDe(st, d).filter(p => K.listo(st, p));
  const sin = K.podsDe(st, d).find(p => !p.tpl.req.cpu);
  if (sin) return { error: 'failed to get cpu utilization: missing request for cpu in container ' + sin.tpl.contenedor + ' of Pod ' + sin.nombre };
  if (!ps.length) return { error: 'failed to get cpu utilization: did not receive metrics for targeted pods (pods might be unready)' };
  const cpu = ps.reduce((s, p) => s + K.cpuApp(st, p), 0) / ps.length;
  return { util: Math.round(cpu / ps[0].tpl.req.cpu * 100), cpu: Math.round(cpu), n: ps.length };
};
K.utilHpa = utilHpa;
K.controladoresExtra.push((st, t) => {
  Object.values(st.k8s.hpas || {}).forEach(h => {
    const d = st.k8s.deps[h.ns + '/' + h.dep]; if (!d) return;
    const u = utilHpa(st, h); h.estado = u;
    if (u.error) { K.evento(st, t, h.ns, 'Warning', 'FailedGetResourceMetric', 'horizontalpodautoscaler/' + h.nombre, u.error, 'horizontal-pod-autoscaler'); return; }
    const actual = d.replicas, ratio = u.util / h.objetivo;
    let rec = Math.abs(ratio - 1) <= 0.1 ? actual : Math.ceil(u.n * ratio);
    h.recs = h.recs.filter(r => r.t > t - 5).concat([{ t, n: rec }]);
    // Para bajar, espera 5 minutos (ventana de estabilización); para subir, no.
    if (rec < actual) rec = Math.max(rec, ...h.recs.map(r => r.n));
    const limitado = rec > h.max ? 'max' : rec < h.min ? 'min' : null;
    h.limitado = limitado;
    const n = Math.max(h.min, Math.min(h.max, rec));
    if (limitado === 'max') { if (h.maxDesde == null) h.maxDesde = t; } else h.maxDesde = null;
    if (n !== actual) {
      d.replicas = n; d.progreso = t;
      K.evento(st, t, h.ns, 'Normal', 'SuccessfulRescale', 'horizontalpodautoscaler/' + h.nombre, 'New size: ' + n + '; reason: cpu resource utilization (percentage of request) ' + (n > actual ? 'above' : 'below') + ' target', 'horizontal-pod-autoscaler');
    }
  });
});
recurso('horizontalpodautoscalers', { alias: ['hpa', 'horizontalpodautoscaler'], singular: 'horizontalpodautoscaler.autoscaling', nf: 'horizontalpodautoscalers.autoscaling',
  listar: (st, ns) => porNs(st.k8s.hpas, ns),
  tabla: (st, xs, o, conNs) => [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'REFERENCE', 'TARGETS', 'MINPODS', 'MAXPODS', 'REPLICAS', 'AGE']), xs.map(h => { const u = utilHpa(st, h), d = st.k8s.deps[h.ns + '/' + h.dep]; return (conNs ? [h.ns] : []).concat([h.nombre, 'Deployment/' + h.dep, 'cpu: ' + (u.error ? '<unknown>' : u.util + '%') + '/' + h.objetivo + '%', h.min, h.max, d ? d.replicas : 0, edad(st, h.creado)]); })],
  yaml: (st, h) => K.yamlDe(K.manifiesto(st, 'HorizontalPodAutoscaler', h.ns + '/' + h.nombre)),
  describe: (st, h) => {
    const u = utilHpa(st, h), d = st.k8s.deps[h.ns + '/' + h.dep];
    const out = kv([['Name', h.nombre], ['Namespace', h.ns], ['Labels', '<none>'], ['Annotations', '<none>'], ['CreationTimestamp', K.fecha(h.creado)], ['Reference', 'Deployment/' + h.dep]], 52);
    out.push(L('Metrics:                                             ( current / target )'), L('  resource cpu on pods  (as a percentage of request):  ' + (u.error ? '<unknown>' : u.util + '% (' + u.cpu + 'm)') + ' / ' + h.objetivo + '%'));
    out.push(...kv([['Min replicas', h.min], ['Max replicas', h.max], ['Deployment pods', K.podsDe(st, d).length + ' current / ' + d.replicas + ' desired']], 52));
    out.push(L('Conditions:'), ...K.tabla(['  Type', 'Status', 'Reason', 'Message'], [['  ----', '------', '------', '-------'],
      ['  AbleToScale', 'True', 'ReadyForNewScale', 'recommended size matches current size'],
      ['  ScalingActive', u.error ? 'False' : 'True', u.error ? 'FailedGetResourceMetric' : 'ValidMetricFound', u.error ? 'the HPA was unable to compute the replica count: ' + u.error : 'the HPA was able to successfully calculate a replica count from cpu resource utilization (percentage of request)'],
      ['  ScalingLimited', h.limitado ? 'True' : 'False', h.limitado === 'max' ? 'TooManyReplicas' : h.limitado === 'min' ? 'TooFewReplicas' : 'DesiredWithinRange', h.limitado === 'max' ? 'the desired replica count is more than the maximum replica count' : h.limitado === 'min' ? 'the desired replica count is less than the minimum replica count' : 'the desired count is within the acceptable range']]));
    return out.concat(eventos(st, 'horizontalpodautoscaler/' + h.nombre, h.ns));
  },
  borrar: (st, h) => { delete st.k8s.hpas[h.ns + '/' + h.nombre]; },
});
kind('HorizontalPodAutoscaler', { prefijo: 'horizontalpodautoscaler.autoscaling', grupo: 'autoscaling.v2.HorizontalPodAutoscaler',
  manifiesto: (st, key) => { const h = st.k8s.hpas[key]; return h && { kind: 'HorizontalPodAutoscaler', ns: h.ns, nombre: h.nombre, dep: h.dep, min: h.min, max: h.max, objetivo: h.objetivo }; },
  yaml: m => K.yaml({ apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', metadata: { name: m.nombre, namespace: m.ns }, spec: { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: m.dep }, minReplicas: m.min, maxReplicas: m.max, metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: m.objetivo } } }] } }),
  aplicar: (st, m) => { const key = m.ns + '/' + m.nombre, h = st.k8s.hpas[key]; if (h) Object.assign(h, { dep: m.dep, min: m.min, max: m.max, objetivo: m.objetivo }); else st.k8s.hpas[key] = Object.assign({ creado: st.reloj, recs: [], maxDesde: null }, copia(m)); return null; },
});
P.detectores.push((st, add) => {
  Object.values(st.k8s.hpas || {}).forEach(h => { if (h.maxDesde != null && st.reloj - h.maxDesde >= 15) add('KubeHpaMaxedOut', 'warning', null, T('La HPA ' + h.ns + '/' + h.nombre + ' lleva más de 15 min en su máximo de réplicas (' + h.max + ')', 'HPA ' + h.ns + '/' + h.nombre + ' has been running at max replicas (' + h.max + ') for longer than 15 minutes.'), 'KubeHpaMaxedOut|' + h.nombre); });
  if (st.k8s.carga && listos(st, 'pagos/api-pagos').length && K.rpsPorPod(st) > POR_POD) {
    const p99 = (K.latenciaApi(st) * 2.6 / 1000).toFixed(1);
    add('ApiPagosLatenciaAlta', 'critical', null, T('El p99 de api-pagos está en ' + p99 + ' s (objetivo: 300 ms)', 'api-pagos p99 latency is ' + p99 + ' s (objective: 300 ms)'), 'ApiPagosLatenciaAlta');
  }
});

// ------------------------------------------------------------------ RBAC
const GRUPO = { deployments: 'apps', replicasets: 'apps', statefulsets: 'apps', daemonsets: 'apps', ingresses: 'networking.k8s.io', networkpolicies: 'networking.k8s.io', horizontalpodautoscalers: 'autoscaling', roles: 'rbac.authorization.k8s.io', rolebindings: 'rbac.authorization.k8s.io', clusterroles: 'rbac.authorization.k8s.io', clusterrolebindings: 'rbac.authorization.k8s.io' };
const NOMBRE_RECURSO = { deploy: 'deployments', deployment: 'deployments', deployments: 'deployments', po: 'pods', pod: 'pods', pods: 'pods', svc: 'services', service: 'services', services: 'services', cm: 'configmaps', configmap: 'configmaps', configmaps: 'configmaps', secret: 'secrets', secrets: 'secrets', rs: 'replicasets', replicasets: 'replicasets', ing: 'ingresses', ingresses: 'ingresses', netpol: 'networkpolicies', networkpolicies: 'networkpolicies', hpa: 'horizontalpodautoscalers', pvc: 'persistentvolumeclaims', persistentvolumeclaims: 'persistentvolumeclaims', 'pods/log': 'pods/log', 'pods/exec': 'pods/exec', rolebindings: 'rolebindings', clusterrolebindings: 'clusterrolebindings', nodes: 'nodes', namespaces: 'namespaces' };
const casaSujeto = (s, quien) => (s.kind === 'User' && quien.kind === 'User' && s.nombre === quien.nombre) || (s.kind === 'ServiceAccount' && quien.kind === 'ServiceAccount' && s.nombre === quien.nombre && s.ns === quien.ns) || (s.kind === 'Group' && quien.grupos && quien.grupos.indexOf(s.nombre) >= 0);
const reglasDe = (st, rol, ns) => rol.kind === 'ClusterRole' ? (st.k8s.croles[rol.nombre] || { reglas: [] }).reglas : (st.k8s.roles[ns + '/' + rol.nombre] || { reglas: [] }).reglas;
// ¿Puede? Lo que no está permitido por alguna regla, está denegado (RBAC sólo suma).
K.puede = (st, quien, verbo, recurso, ns) => {
  const grupo = GRUPO[recurso.split('/')[0]] || '', casa = r => (r.verbos.indexOf('*') >= 0 || r.verbos.indexOf(verbo) >= 0) && (r.recursos.indexOf('*') >= 0 || r.recursos.indexOf(recurso) >= 0) && (r.grupos.indexOf('*') >= 0 || r.grupos.indexOf(grupo) >= 0);
  const crb = Object.values(st.k8s.crbs).filter(b => b.sujetos.some(s => casaSujeto(s, quien))).some(b => reglasDe(st, b.rol).some(casa));
  const rb = ns != null && Object.values(st.k8s.rbs).filter(b => b.ns === ns && b.sujetos.some(s => casaSujeto(s, quien))).some(b => reglasDe(st, b.rol, ns).some(casa));
  return crb || rb;
};
const quienDe = as => { if (!as) return { kind: 'User', nombre: 'sre-admin', grupos: ['system:authenticated'] }; const m = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(as); return m ? { kind: 'ServiceAccount', ns: m[1], nombre: m[2], grupos: ['system:serviceaccounts', 'system:serviceaccounts:' + m[1], 'system:authenticated'] } : { kind: 'User', nombre: as, grupos: ['system:authenticated'] }; };
K.verbos.auth = ctx => {
  const st = ctx.st, a = ctx.args;
  if (a[0] !== 'can-i') return { lineas: [L('error: unknown command "' + (a[0] || '') + '" for "kubectl auth"', 'err'), L(T('(en el simulador: kubectl auth can-i VERBO RECURSO -n NS [--as=...])', '(in the simulator: kubectl auth can-i VERB RESOURCE -n NS [--as=...])'), 'dim')], fallo: true };
  let ns = st.k8s.nsDefecto || 'default', as = null, todos = false; const pos = [];
  for (let i = 1; i < a.length; i++) {
    const x = a[i]; let m;
    if (x === '-n' || x === '--namespace') ns = a[++i]; else if ((m = /^--namespace=(.+)$/.exec(x))) ns = m[1];
    else if (x === '--as') as = a[++i]; else if ((m = /^--as=(.+)$/.exec(x))) as = m[1];
    else if (x === '-A' || x === '--all-namespaces') todos = true;
    else if (x === '--list') return { lineas: [L(T('(en el simulador: pregunta verbo por verbo con kubectl auth can-i)', '(in the simulator: ask verb by verb with kubectl auth can-i)'), 'dim')] };
    else pos.push(x);
  }
  if (pos.length < 2) return { lineas: [L('error: you must specify two arguments: verb resource or a nonResourceURL', 'err')], fallo: true };
  const recurso = NOMBRE_RECURSO[pos[1].split('/')[0]] || pos[1].split('/')[0];
  const si = K.puede(st, quienDe(as), pos[0], recurso, todos ? null : ns);
  return { lineas: [L(si ? 'yes' : 'no', si ? 'verde' : 'rojo')] };
};
// kubectl create rolebinding / clusterrolebinding: lo que se hace con prisa.
K.verbos.create = ctx => {
  const st = ctx.st, a = ctx.args, que = a[0], nombre = a[1];
  if (que !== 'rolebinding' && que !== 'clusterrolebinding') return { lineas: [L(T('(en el simulador se crea con kubectl apply -f desde ~/k8s; kubectl create sólo admite rolebinding y clusterrolebinding)', '(in the simulator things are created with kubectl apply -f from ~/k8s; kubectl create only supports rolebinding and clusterrolebinding)'), 'dim')], fallo: true };
  if (!nombre || /^-/.test(nombre)) return { lineas: [L('error: exactly one NAME is required, got 0', 'err')], fallo: true };
  let ns = st.k8s.nsDefecto || 'default', rol = null; const sujetos = [];
  for (let i = 2; i < a.length; i++) {
    const x = a[i], m = /^--([a-z]+)=(.+)$/.exec(x), k = m ? m[1] : x.replace(/^--?/, ''), v = m ? m[2] : a[++i];
    if (k === 'n' || k === 'namespace') ns = v;
    else if (k === 'clusterrole') rol = { kind: 'ClusterRole', nombre: v };
    else if (k === 'role') rol = { kind: 'Role', nombre: v };
    else if (k === 'serviceaccount') sujetos.push({ kind: 'ServiceAccount', ns: v.split(':')[0], nombre: v.split(':')[1] });
    else if (k === 'user') sujetos.push({ kind: 'User', nombre: v });
    else if (k === 'group') sujetos.push({ kind: 'Group', nombre: v });
  }
  if (!rol) return { lineas: [L('error: exactly one of clusterrole or role must be specified', 'err')], fallo: true };
  if (que === 'clusterrolebinding' && rol.kind === 'Role') return { lineas: [L('error: unknown flag: --role', 'err')], fallo: true };
  const dest = que === 'rolebinding' ? st.k8s.rbs : st.k8s.crbs, key = que === 'rolebinding' ? ns + '/' + nombre : nombre;
  if (dest[key]) return { lineas: [L('error: failed to create ' + que + ': ' + que + 's.rbac.authorization.k8s.io "' + nombre + '" already exists', 'err')], fallo: true };
  dest[key] = Object.assign({ nombre, rol, sujetos, creado: st.reloj }, que === 'rolebinding' ? { ns } : {});
  return { lineas: [L(que + '.rbac.authorization.k8s.io/' + nombre + ' created')] };
};
const tablaBinding = (st, xs, o, conNs) => { const wide = (o.f['-o'] || o.f['--output']) === 'wide'; return [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'ROLE', 'AGE']).concat(wide ? ['USERS', 'GROUPS', 'SERVICEACCOUNTS'] : []), xs.map(b => (conNs ? [b.ns] : []).concat([b.nombre, b.rol.kind + '/' + b.rol.nombre, edad(st, b.creado)]).concat(wide ? [b.sujetos.filter(s => s.kind === 'User').map(s => s.nombre).join(','), b.sujetos.filter(s => s.kind === 'Group').map(s => s.nombre).join(','), b.sujetos.filter(s => s.kind === 'ServiceAccount').map(s => s.ns + '/' + s.nombre).join(',')] : []))]; };
const describeBinding = (st, b) => kv([['Name', b.nombre], ['Labels', '<none>'], ['Annotations', '<none>'], ['Role', '']], 14).concat([L('  Kind:  ' + b.rol.kind), L('  Name:  ' + b.rol.nombre), L('Subjects:')], K.tabla(['  Kind', 'Name', 'Namespace'], [['  ----', '----', '---------']].concat(b.sujetos.map(s => ['  ' + s.kind, s.nombre, s.ns || '']))));
const yamlBinding = (st, b, kindN) => K.yaml({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: kindN, metadata: Object.assign({ name: b.nombre }, b.ns ? { namespace: b.ns } : {}), roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: b.rol.kind, name: b.rol.nombre }, subjects: b.sujetos.map(s => Object.assign({ kind: s.kind, name: s.nombre }, s.ns ? { namespace: s.ns } : {})) });
const describeRol = (st, r) => kv([['Name', r.nombre], ['Labels', '<none>'], ['Annotations', '<none>']], 14).concat([L('PolicyRule:')], K.tabla(['  Resources', 'Non-Resource URLs', 'Resource Names', 'Verbs'], [['  ---------', '-----------------', '--------------', '-----']].concat([].concat(...r.reglas.map(x => x.recursos.map(rc => ['  ' + rc + (x.grupos[0] && x.grupos[0] !== '*' ? '.' + x.grupos[0] : x.grupos[0] === '*' ? '.*' : ''), '[]', '[]', '[' + x.verbos.join(' ') + ']']))))));
recurso('serviceaccounts', { alias: ['sa', 'serviceaccount'], singular: 'serviceaccount', nf: 'serviceaccounts',
  listar: (st, ns) => st.k8s.sas.filter(s => ns == null || s.ns === ns),
  tabla: (st, xs, o, conNs) => [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'SECRETS', 'AGE']), xs.map(s => (conNs ? [s.ns] : []).concat([s.nombre, 0, edad(st, s.creado)]))],
  yaml: (st, s) => K.yaml({ apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: s.nombre, namespace: s.ns } }),
});
recurso('roles', { alias: ['role'], singular: 'role.rbac.authorization.k8s.io', nf: 'roles.rbac.authorization.k8s.io',
  listar: (st, ns) => porNs(st.k8s.roles, ns),
  tabla: (st, xs, o, conNs) => [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'CREATED AT']), xs.map(r => (conNs ? [r.ns] : []).concat([r.nombre, U.iso(r.creado) + 'Z']))],
  yaml: (st, r) => K.yaml({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: { name: r.nombre, namespace: r.ns }, rules: r.reglas.map(x => ({ apiGroups: x.grupos, resources: x.recursos, verbs: x.verbos })) }),
  describe: describeRol,
});
recurso('clusterroles', { alias: ['clusterrole'], singular: 'clusterrole.rbac.authorization.k8s.io', nf: 'clusterroles.rbac.authorization.k8s.io', global: true,
  listar: st => Object.values(st.k8s.croles),
  tabla: (st, xs) => [['NAME', 'CREATED AT'], xs.map(r => [r.nombre, U.iso(CREADO) + 'Z'])],
  yaml: (st, r) => K.yaml({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole', metadata: { name: r.nombre }, rules: r.reglas.map(x => ({ apiGroups: x.grupos, resources: x.recursos, verbs: x.verbos })) }),
  describe: describeRol,
});
recurso('rolebindings', { alias: ['rolebinding'], singular: 'rolebinding.rbac.authorization.k8s.io', nf: 'rolebindings.rbac.authorization.k8s.io',
  listar: (st, ns) => porNs(st.k8s.rbs, ns), tabla: tablaBinding, yaml: (st, b) => yamlBinding(st, b, 'RoleBinding'), describe: describeBinding,
  borrar: (st, b) => { delete st.k8s.rbs[b.ns + '/' + b.nombre]; },
});
recurso('clusterrolebindings', { alias: ['clusterrolebinding'], singular: 'clusterrolebinding.rbac.authorization.k8s.io', nf: 'clusterrolebindings.rbac.authorization.k8s.io', global: true,
  listar: st => Object.values(st.k8s.crbs), tabla: tablaBinding, yaml: (st, b) => yamlBinding(st, b, 'ClusterRoleBinding'), describe: describeBinding,
  borrar: (st, b) => { delete st.k8s.crbs[b.nombre]; },
});
kind('RoleBinding', { prefijo: 'rolebinding.rbac.authorization.k8s.io', grupo: 'rbac.authorization.k8s.io.v1.RoleBinding',
  manifiesto: (st, key) => { const b = st.k8s.rbs[key]; return b && { kind: 'RoleBinding', ns: b.ns, nombre: b.nombre, rol: copia(b.rol), sujetos: copia(b.sujetos) }; },
  yaml: m => yamlBinding(null, m, 'RoleBinding'),
  aplicar: (st, m, t, vivo) => {
    if (vivo && JSON.stringify(vivo.rol) !== JSON.stringify(m.rol)) return 'The RoleBinding "' + m.nombre + '" is invalid: roleRef: Invalid value: rbac.RoleRef{APIGroup:"rbac.authorization.k8s.io", Kind:"' + m.rol.kind + '", Name:"' + m.rol.nombre + '"}: cannot change roleRef';
    st.k8s.rbs[m.ns + '/' + m.nombre] = Object.assign({ creado: vivo ? st.k8s.rbs[m.ns + '/' + m.nombre].creado : t }, { ns: m.ns, nombre: m.nombre, rol: m.rol, sujetos: m.sujetos });
    return null;
  },
});

// ------------------------------------------------------------------ NetworkPolicies
const casaEtiquetas = (sel, labels) => Object.keys(sel || {}).every(k => labels[k] === sel[k]);
const etiquetasDe = p => Object.assign({}, p.tpl.labels, p.labels);
// Una política que selecciona al destino decide; sin ninguna, todo pasa (así es Kubernetes).
K.permiteRed = (st, src, dst, port) => {
  const pols = Object.values(st.k8s.netpols || {}).filter(n => n.ns === dst.ns && n.tipos.indexOf('Ingress') >= 0 && casaEtiquetas(n.sel, etiquetasDe(dst)));
  if (!pols.length) return true;
  return pols.some(n => n.ingress.some(r => (!r.puertos.length || r.puertos.indexOf(port) >= 0) && (!r.desde || !r.desde.length || r.desde.some(f =>
    (f.ns ? casaEtiquetas(f.ns, { 'kubernetes.io/metadata.name': src.ns }) : src.ns === n.ns) && (!f.pod || casaEtiquetas(f.pod, etiquetasDe(src)))))));
};
const npYaml = m => K.yaml({ apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: { name: m.nombre, namespace: m.ns }, spec: { podSelector: Object.keys(m.sel).length ? { matchLabels: m.sel } : {}, policyTypes: m.tipos,
  ingress: m.ingress.length ? m.ingress.map(r => Object.assign({ from: r.desde.map(f => Object.assign({}, f.ns ? { namespaceSelector: { matchLabels: f.ns } } : {}, f.pod ? { podSelector: { matchLabels: f.pod } } : {})) }, r.puertos.length ? { ports: r.puertos.map(p => ({ protocol: 'TCP', port: p })) } : {})) : null } });
recurso('networkpolicies', { alias: ['netpol', 'networkpolicy', 'netpols'], singular: 'networkpolicy.networking.k8s.io', nf: 'networkpolicies.networking.k8s.io',
  listar: (st, ns) => porNs(st.k8s.netpols, ns),
  tabla: (st, xs, o, conNs) => [(conNs ? ['NAMESPACE'] : []).concat(['NAME', 'POD-SELECTOR', 'AGE']), xs.map(n => (conNs ? [n.ns] : []).concat([n.nombre, Object.keys(n.sel).length ? K.sel(n.sel) : '<none>', edad(st, n.creado)]))],
  yaml: (st, n) => npYaml(K.manifiesto(st, 'NetworkPolicy', n.ns + '/' + n.nombre)),
  describe: (st, n) => {
    const out = kv([['Name', n.nombre], ['Namespace', n.ns], ['Created on', U.iso(n.creado).replace('T', ' ') + ' +0000 UTC'], ['Labels', '<none>'], ['Annotations', '<none>']], 16);
    out.push(L('Spec:'), L('  PodSelector:     ' + (Object.keys(n.sel).length ? K.sel(n.sel) : '<none> (Allowing the specific traffic to all pods in this namespace)')));
    if (!n.ingress.length) out.push(L('  Allowing ingress traffic:'), L('    <none> (Selected pods are isolated for ingress connectivity)'));
    else n.ingress.forEach(r => {
      out.push(L('  Allowing ingress traffic:'));
      if (r.puertos.length) r.puertos.forEach(p => out.push(L('    To Port: ' + p + '/TCP'))); else out.push(L('    To Port: <any> (traffic allowed to all ports)'));
      out.push(L('    From:'));
      r.desde.forEach(f => { if (f.ns) out.push(L('      NamespaceSelector: ' + K.sel(f.ns))); if (f.pod) out.push(L('      PodSelector: ' + K.sel(f.pod))); });
    });
    out.push(L('  Not affecting egress traffic'), L('  Policy Types: ' + n.tipos.join(', ')));
    return out;
  },
  borrar: (st, n) => { delete st.k8s.netpols[n.ns + '/' + n.nombre]; },
});
kind('NetworkPolicy', { prefijo: 'networkpolicy.networking.k8s.io', grupo: 'networking.k8s.io.v1.NetworkPolicy',
  manifiesto: (st, key) => { const n = st.k8s.netpols[key]; return n && { kind: 'NetworkPolicy', ns: n.ns, nombre: n.nombre, sel: copia(n.sel), tipos: copia(n.tipos), ingress: copia(n.ingress) }; },
  yaml: npYaml,
  aplicar: (st, m, t, vivo) => { st.k8s.netpols[m.ns + '/' + m.nombre] = { ns: m.ns, nombre: m.nombre, sel: m.sel, tipos: m.tipos, ingress: m.ingress, creado: vivo ? st.k8s.netpols[m.ns + '/' + m.nombre].creado : t }; return null; },
});
// La alerta de negocio: los pagos que se quedan sin puntuar van a revisión manual.
P.detectores.push((st, add) => {
  const api = listos(st, 'pagos/api-pagos');
  if (api.length && !api.some(p => K.alcanza(st, p, 'pagos/antifraude'))) add('PagosRevisionManualAlta', 'warning', null, T('Casi todos los pagos van a revisión manual: api-pagos no consigue hablar con antifraude', 'Nearly all payments are going to manual review: api-pagos cannot reach antifraude'), 'PagosRevisionManualAlta');
});

// La carpeta del pipeline de CI: sus logs, para los tickets que vienen de CI.
P.ficheros.push((st, h) => {
  if (!st.k8s || h.rol !== 'ops' || !st.k8s.ci) return {};
  const f = {};
  Object.keys(st.k8s.ci).forEach(n => { const ls = st.k8s.ci[n]; f[HOME + '/ci/' + n] = { lineas: () => ls, mb: 0.01 }; });
  return f;
});
})(window.PUESTO = window.PUESTO || {});
