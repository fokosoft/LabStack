// Puesto DevOps · Helm.
//
// Las piezas de terceros (ingress-nginx, cert-manager, kube-prometheus-stack)
// se instalan con Helm. Cada release guarda su historial de revisiones, y cada
// revisión vive en un Secret sh.helm.release.v1.NOMBRE.vN, como en Helm 3: por
// eso `kubectl get secrets` las enseña y por eso borrarlas a mano «arregla» un
// release atascado... a costa de perder la historia.
//
// Un upgrade que se corta a medias deja el release en pending-upgrade y todos
// los siguientes fallan con «another operation is in progress». La salida
// buena es `helm rollback`; un upgrade sin -f ni --reuse-values vuelve a los
// valores por defecto del chart.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, K = P.k8s, HOME = U.HOME;
const H = K.helm = {};
// Los charts publicados: versión del chart -> versión de la aplicación.
H.CHARTS = {
  'ingress-nginx/ingress-nginx': { repo: 'ingress-nginx', url: 'https://kubernetes.github.io/ingress-nginx', desc: 'Ingress controller for Kubernetes using NGINX as a reverse proxy and load balancer', versiones: [['4.11.5', '1.11.5'], ['4.11.2', '1.11.2'], ['4.10.1', '1.10.1'], ['4.9.1', '1.9.6']] },
  'jetstack/cert-manager': { repo: 'jetstack', url: 'https://charts.jetstack.io', desc: 'A Helm chart for cert-manager', versiones: [['v1.15.1', 'v1.15.1'], ['v1.14.5', 'v1.14.5']] },
  'prometheus-community/kube-prometheus-stack': { repo: 'prometheus-community', url: 'https://prometheus-community.github.io/helm-charts', desc: 'kube-prometheus-stack collects Kubernetes manifests, Grafana dashboards, and Prometheus rules', versiones: [['61.3.0', 'v0.75.1'], ['58.7.2', 'v0.74.0']] },
};
// Lo que hace cada chart con sus values: aquí, imagen y réplicas del controlador.
const DEFECTO = { 'ingress-nginx': { 'controller.replicaCount': 1 } };
const VALUES_INGRESS = ['controller:', '  replicaCount: 2', '  resources:', '    requests:', '      cpu: 100m', '      memory: 90Mi', '  config:', '    use-forwarded-headers: "true"', '  metrics:', '    enabled: true'];
H.valuesFichero = { [HOME + '/helm/ingress-nginx/values.yaml']: { 'controller.replicaCount': 2, 'controller.resources.requests.cpu': '100m', 'controller.config.use-forwarded-headers': 'true', 'controller.metrics.enabled': true } };
const aplicaChart = (st, r, rev) => {
  if (r.chart !== 'ingress-nginx') return;
  const d = st.k8s.deps['ingress-nginx/ingress-nginx-controller'], tpl = K.copia(d.tpl);
  tpl.imagen = 'registry.k8s.io/ingress-nginx/controller:v' + rev.app;
  d.replicas = rev.values['controller.replicaCount'] || DEFECTO['ingress-nginx']['controller.replicaCount'];
  K.cambiarPlantilla(st, d, tpl, 'helm: ' + r.nombre + ' rev ' + rev.rev, st.reloj);
};

P.alCrear.push(st => {
  const rev = (n, chartV, app, estado, min, desc, values) => ({ rev: n, chartV, app, estado, min, desc, values: values || {} });
  const vIng = H.valuesFichero[HOME + '/helm/ingress-nginx/values.yaml'];
  st.k8s.helm = {
    'ingress-nginx/ingress-nginx': { nombre: 'ingress-nginx', ns: 'ingress-nginx', chart: 'ingress-nginx', ref: 'ingress-nginx/ingress-nginx',
      historia: [rev(4, '4.9.1', '1.9.6', 'superseded', -98000, 'Upgrade complete', vIng), rev(5, '4.10.1', '1.10.1', 'superseded', -40100, 'Upgrade complete', vIng), rev(6, '4.10.1', '1.10.1', 'deployed', -11600, 'Upgrade complete', vIng)] },
    'cert-manager/cert-manager': { nombre: 'cert-manager', ns: 'cert-manager', chart: 'cert-manager', ref: 'jetstack/cert-manager',
      historia: [rev(1, 'v1.14.5', 'v1.14.5', 'superseded', -60000, 'Install complete', { crds: { enabled: true } }), rev(2, 'v1.15.1', 'v1.15.1', 'deployed', -11600, 'Upgrade complete', { 'crds.enabled': true })] },
    'monitoring/kube-prometheus-stack': { nombre: 'kube-prometheus-stack', ns: 'monitoring', chart: 'kube-prometheus-stack', ref: 'prometheus-community/kube-prometheus-stack',
      historia: [rev(3, '61.3.0', 'v0.75.1', 'deployed', -11600, 'Upgrade complete', { 'prometheus.prometheusSpec.retention': '15d', 'grafana.enabled': true })] },
  };
});
const releases = st => Object.values(st.k8s.helm || {});
const ultima = r => r.historia[r.historia.length - 1];
H.release = (st, ns, nombre) => st.k8s.helm[ns + '/' + nombre];
H.pendiente = r => /^pending-/.test(ultima(r).estado);
const fechaHelm = m => U.iso(m).replace('T', ' ') + '.' + String(100000 + (((m * 7919) % 900000) + 900000) % 900000) + ' +0000 UTC';
// Los Secrets que guardan cada revisión.
K.secretosHelm = st => [].concat(...releases(st).map(r => r.historia.map(v => ({ ns: r.ns, nombre: 'sh.helm.release.v1.' + r.nombre + '.v' + v.rev, tipo: 'helm.sh/release.v1', datos: 1, creado: v.min, helm: true, r, v }))));
K.borrarRevisionHelm = (st, s) => { s.r.historia = s.r.historia.filter(v => v !== s.v); };

function leer(args) {
  const o = { pos: [], f: {}, valores: [] };
  for (let i = 0; i < args.length; i++) {
    const x = args[i], m = /^(--?[a-z-]+)=(.*)$/.exec(x);
    if (m) { if (m[1] === '-f' || m[1] === '--values') o.valores.push(m[2]); else o.f[m[1]] = m[2]; continue; }
    if (x === '-f' || x === '--values') { o.valores.push(args[++i]); continue; }
    if (['-n', '--namespace', '--version', '--revision', '-o', '--output', '--timeout'].indexOf(x) >= 0) { o.f[x] = args[++i]; continue; }
    if (/^-/.test(x)) { o.f[x] = true; continue; }
    o.pos.push(x);
  }
  o.ns = o.f['-n'] || o.f['--namespace'] || 'default';
  return o;
}
const err = (t, extra) => ({ lineas: [L(t, 'err')].concat(extra || []), fallo: true });
const tabla = K.tabla;
const noEncontrado = n => err('Error: release: not found');

U.cmd('helm', { ayuda: T('los releases de Helm: list, history, status, get values, upgrade, rollback', 'Helm releases: list, history, status, get values, upgrade, rollback'), grupo: 'Kubernetes', donde: ['ops'], fn: ctx => {
  const st = ctx.st, sub = ctx.args[0], o = leer(ctx.args.slice(1));
  switch (sub) {
    case 'list': case 'ls': {
      const rs = releases(st).filter(r => o.f['-A'] || o.f['--all-namespaces'] || r.ns === o.ns).filter(r => o.f['-a'] || o.f['--all'] || (o.f['--pending'] ? H.pendiente(r) : !H.pendiente(r)));   // por defecto, sólo deployed y failed
      return tabla(['NAME', 'NAMESPACE', 'REVISION', 'UPDATED', 'STATUS', 'CHART', 'APP VERSION'], rs.map(r => { const v = ultima(r); return [r.nombre, r.ns, v.rev, fechaHelm(v.min), v.estado, r.chart + '-' + v.chartV, v.app]; }));
    }
    case 'history': case 'hist': {
      const r = H.release(st, o.ns, o.pos[0]); if (!r) return noEncontrado();
      return tabla(['REVISION', 'UPDATED', 'STATUS', 'CHART', 'APP VERSION', 'DESCRIPTION'], r.historia.map(v => [v.rev, U.fechaCorta(v.min).replace(/ (\d{4})$/, ' $1'), v.estado, r.chart + '-' + v.chartV, v.app, v.desc]));
    }
    case 'status': {
      const r = H.release(st, o.ns, o.pos[0]); if (!r) return noEncontrado();
      const v = ultima(r);
      return [L('NAME: ' + r.nombre), L('LAST DEPLOYED: ' + U.fechaCorta(v.min).replace(/ (\d{4})$/, ' $1')), L('NAMESPACE: ' + r.ns), L('STATUS: ' + v.estado, /pending|failed/.test(v.estado) ? 'ambar' : 'out'), L('REVISION: ' + v.rev), L('TEST SUITE: None')];
    }
    case 'get': {
      if (o.pos[0] !== 'values') return err('Error: ' + T('(en el simulador: helm get values NOMBRE -n NS)', '(in the simulator: helm get values NAME -n NS)'));
      const r = H.release(st, o.ns, o.pos[1]); if (!r) return noEncontrado();
      const v = o.f['--revision'] ? r.historia.find(x => String(x.rev) === String(o.f['--revision'])) : r.historia.slice().reverse().find(x => x.estado === 'deployed') || ultima(r);
      return [L('USER-SUPPLIED VALUES:')].concat(Object.keys(v.values).length ? (r.chart === 'ingress-nginx' && v.values['controller.replicaCount'] === 2 ? VALUES_INGRESS : Object.keys(v.values).map(k => k + ': ' + v.values[k])).map(x => L(x)) : [L('null')]);
    }
    case 'repo': {
      if (o.pos[0] === 'list') return tabla(['NAME', 'URL'], Object.values(H.CHARTS).map(c => [c.repo, c.url]));
      if (o.pos[0] === 'update') return [L('Hang tight while we grab the latest from your chart repositories...')].concat(Object.values(H.CHARTS).map(c => L('...Successfully got an update from the "' + c.repo + '" chart repository')), [L('Update Complete. ⎈Happy Helming!⎈')]);
      return err('Error: ' + T('(en el simulador: helm repo list | update)', '(in the simulator: helm repo list | update)'));
    }
    case 'search': {
      const q = o.pos[1] || '', cs = Object.keys(H.CHARTS).filter(k => k.indexOf(q) >= 0);
      if (!cs.length) return [L('No results found')];
      return tabla(['NAME', 'CHART VERSION', 'APP VERSION', 'DESCRIPTION'], [].concat(...cs.map(k => (o.f['--versions'] || o.f['-l'] ? H.CHARTS[k].versiones : H.CHARTS[k].versiones.slice(0, 1)).map(v => [k, v[0], v[1], H.CHARTS[k].desc]))));
    }
    case 'rollback': {
      const r = H.release(st, o.ns, o.pos[0]); if (!r) return noEncontrado();
      const actual = ultima(r), dest = o.pos[1] ? r.historia.find(v => String(v.rev) === String(o.pos[1])) : r.historia.slice(0, -1).reverse().find(v => v.estado !== 'pending-upgrade' && v.estado !== 'failed');
      if (!dest) return err('Error: release has no ' + (o.pos[1] || 'previous') + ' version');
      r.historia.forEach(v => { if (v.estado === 'deployed') v.estado = 'superseded'; });
      if (actual.estado === 'pending-upgrade' || actual.estado === 'pending-install') actual.estado = 'failed';
      const nueva = { rev: actual.rev + 1, chartV: dest.chartV, app: dest.app, estado: 'deployed', min: st.reloj, desc: 'Rollback to ' + dest.rev, values: K.copia(dest.values) };
      r.historia.push(nueva);
      aplicaChart(st, r, nueva);
      return [L('Rollback was a success! Happy Helming!')];
    }
    case 'upgrade': {
      const nombre = o.pos[0], ref = o.pos[1];
      if (!nombre || !ref) return err('Error: "helm upgrade" requires 2 arguments', [L(''), L('Usage:  helm upgrade [RELEASE] [CHART] [flags]')]);
      const r = H.release(st, o.ns, nombre);
      if (!r) return err('Error: UPGRADE FAILED: "' + nombre + '" has no deployed releases');
      const c = H.CHARTS[ref];
      if (!c) return err('Error: repo ' + ref.split('/')[0] + ' not found');
      if (ref !== r.ref) return err('Error: UPGRADE FAILED: ' + T('(en el simulador, cada release se actualiza con su propio chart: ' + r.ref + ')', '(in the simulator each release is upgraded with its own chart: ' + r.ref + ')'));
      const ver = o.f['--version'] || c.versiones[0][0], cv = c.versiones.find(v => v[0] === ver);
      if (!cv) return err('Error: chart "' + ref.split('/')[1] + '" matching ' + ver + ' not found in ' + c.repo + ' index. (try \'helm repo update\'): no chart version found for ' + ref.split('/')[1] + '-' + ver);
      if (H.pendiente(r)) return err('Error: UPGRADE FAILED: another operation (install/upgrade/rollback) is in progress');
      // Los values: los del fichero, los de la última revisión con --reuse-values, o los del chart.
      let values = {};
      for (const fv of o.valores) {
        const ruta = U.ruta(ctx.ses.cwd, fv, ctx.ses);
        if (!H.valuesFichero[ruta]) return err('Error: open ' + fv + ': no such file or directory');
        Object.assign(values, H.valuesFichero[ruta]);
      }
      if (o.f['--reuse-values']) values = Object.assign({}, ultima(r).values, values);
      r.historia.forEach(v => { if (v.estado === 'deployed') v.estado = 'superseded'; });
      const nueva = { rev: ultima(r).rev + 1, chartV: cv[0], app: cv[1], estado: 'deployed', min: st.reloj, desc: 'Upgrade complete', values };
      r.historia.push(nueva);
      aplicaChart(st, r, nueva);
      return [L('Release "' + r.nombre + '" has been upgraded. Happy Helming!'), L('NAME: ' + r.nombre), L('LAST DEPLOYED: ' + U.fechaCorta(st.reloj).replace(/ (\d{4})$/, ' $1')), L('NAMESPACE: ' + r.ns), L('STATUS: deployed'), L('REVISION: ' + nueva.rev), L('TEST SUITE: None'), L('NOTES:'), L('The ingress-nginx controller has been installed.'), L('It may take a few minutes for the load balancer IP to be available.')];
    }
    case 'version': return [L('version.BuildInfo{Version:"v3.15.3", GitCommit:"3bb50bbbdd9c946ba9989fbe4fb4104766302a64", GitTreeState:"clean", GoVersion:"go1.22.5"}')];
    case 'install': return err('Error: INSTALLATION FAILED: cannot re-use a name that is still in use', [L(T('(en el simulador los releases ya están instalados: helm upgrade)', '(in the simulator the releases are already installed: helm upgrade)'), 'dim')]);
    case 'uninstall': case 'delete': return { lineas: [L(T('(desinstalar ' + (o.pos[0] || 'un release') + ' en producción no está en ningún guion)', '(uninstalling ' + (o.pos[0] || 'a release') + ' in production is not in any script)'), 'dim')] };
    default: return [L('The Kubernetes package manager'), L(''), L('Usage:'), L('  helm [command]'), L(''), L('Available Commands:')].concat(['get', 'history', 'list', 'repo', 'rollback', 'search', 'status', 'upgrade', 'version'].map(x => L('  ' + x)));
  }
}, completar: (st, ses, pal) => {
  if (!pal.length) return ['list', 'history', 'status', 'get', 'upgrade', 'rollback', 'repo', 'search', 'version'];
  if (pal[pal.length - 1] === '-n') return K.NAMESPACES;
  if (pal[pal.length - 1] === '-f') return [HOME + '/helm/ingress-nginx/values.yaml'];
  if (['history', 'status', 'rollback', 'upgrade'].indexOf(pal[0]) >= 0 && pal.length === 1) return releases(st).map(r => r.nombre);
  if (pal[0] === 'upgrade' && pal.length === 2) return Object.keys(H.CHARTS);
  return ['-n', '--version', '-f', '--reuse-values', '-A'];
} });

// Los ficheros de Helm de tu equipo.
P.ficheros.push((st, h) => {
  if (!st.k8s || h.rol !== 'ops') return {};
  const fijo = arr => ({ lineas: () => arr, mb: 0.002 });
  return {
    [HOME + '/helm/README.md']: fijo(T(['# helm — componentes de plataforma', '', 'Cada carpeta tiene los values de un release. Para actualizar:', '  helm upgrade RELEASE REPO/CHART --version X -n NS -f <carpeta>/values.yaml', 'Sin -f (o --reuse-values) Helm vuelve a los valores por defecto del chart.'],
      ['# helm — platform components', '', 'Each folder has a release\'s values. To upgrade:', '  helm upgrade RELEASE REPO/CHART --version X -n NS -f <folder>/values.yaml', 'Without -f (or --reuse-values) Helm goes back to the chart\'s default values.'])),
    [HOME + '/helm/ingress-nginx/values.yaml']: fijo(VALUES_INGRESS),
  };
});
})(window.PUESTO = window.PUESTO || {});
