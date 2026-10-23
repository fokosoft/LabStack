// Puesto DevOps · fase 3: GitOps (git + Argo CD) y el pipeline de CI.
//
// ~/k8s es un clon de plataforma/k8s.git. Argo CD no lee tu copia: lee lo que
// está empujado (origin/main). Por eso un commit local no cambia nada hasta el
// git push, y por eso en GitOps se vuelve atrás con git revert + push, no con
// kubectl rollout undo: si la aplicación tiene self-heal, Argo deshace el undo
// en un minuto, igual que la HPA deshace un kubectl scale.
//
// Cada commit que crean los tickets guarda lo que cambió (antes/después de
// cada manifiesto), así que git show enseña el diff y git revert lo invierte.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, K = P.k8s;
const copia = K.copia;
const REPO_URL = 'https://git.pagos.example/plataforma/k8s.git';

// ------------------------------------------------------------------ git
P.alCrear.push(st => { st.k8s.git.forEach(c => { c.empujado = true; c.cambios = c.cambios || []; }); });
const ordenados = st => st.k8s.git.slice().sort((a, b) => b.min - a.min || (st.k8s.git.indexOf(b) - st.k8s.git.indexOf(a)));
K.headEmpujado = st => ordenados(st).find(c => c.empujado);
// Lo que ve Argo: el repositorio menos los commits que aún no se han empujado.
K.origen = (st, ruta) => {
  let v = st.k8s.repo[ruta];
  ordenados(st).filter(c => !c.empujado).forEach(c => c.cambios.forEach(x => { if (x.ruta === ruta) v = x.antes; }));
  return v ? copia(v) : null;
};
// Un commit hecho (y empujado) por alguien en el pasado: cambia el repositorio.
K.commit = (st, o) => {
  const cambios = (o.cambios || []).map(x => ({ ruta: x.ruta, antes: copia(st.k8s.repo[x.ruta]), despues: copia(x.despues) }));
  cambios.forEach(x => { st.k8s.repo[x.ruta] = copia(x.despues); });
  const c = { h: o.h || U.hex('commit' + st.k8s.git.length + o.msg, 7), min: o.min, autor: o.autor, msg: o.msg, cambios, empujado: o.empujado !== false };
  st.k8s.git.push(c);
  return c;
};
const yamlRuta = (st, m) => m ? K.yamlDe(m) : [];
U.cmd('git', { ayuda: T('el repositorio de manifiestos: git log --oneline, git show, git revert, git push (en ~/k8s)', 'the manifests repository: git log --oneline, git show, git revert, git push (in ~/k8s)'), grupo: 'GitOps', donde: ['ops'], fn: ctx => {
  const st = ctx.st, a = ctx.args, sub = a[0];
  if (ctx.ses.cwd !== K.REPO && ctx.ses.cwd.indexOf(K.REPO + '/') !== 0) return [L('fatal: not a git repository (or any of the parent directories): .git', 'err')];
  const cs = ordenados(st), sinEmpujar = cs.filter(c => !c.empujado);
  const buscar = h => cs.find(c => h && (c.h.indexOf(h) === 0 || (h === 'HEAD' && c === cs[0])));
  switch (sub) {
    case 'status': return [L('On branch main')].concat(sinEmpujar.length ? [L("Your branch is ahead of 'origin/main' by " + sinEmpujar.length + ' commit' + (sinEmpujar.length > 1 ? 's' : '') + '.'), L('  (use "git push" to publish your local commits)')] : [L("Your branch is up to date with 'origin/main'.")], [L(''), L('nothing to commit, working tree clean')]);
    case 'pull': return [L(sinEmpujar.length ? 'Already up to date.' : 'Already up to date.')];
    case 'log': {
      const una = a.indexOf('--oneline') >= 0, n = U.num(a.slice(1), 50), head = cs[0], origen = K.headEmpujado(st);
      const ref = c => (c === head ? ' (HEAD -> main' + (c === origen ? ', origin/main, origin/HEAD' : '') + ')' : c === origen ? ' (origin/main, origin/HEAD)' : '');
      if (una) return cs.slice(0, n).map(c => L(c.h + ref(c) + ' ' + c.msg));
      return [].concat(...cs.slice(0, n).map(c => [L('commit ' + c.h + U.hex(c.h, 33) + ref(c), 'ambar'), L('Author: ' + c.autor + ' <' + c.autor.toLowerCase().split(' ')[0].normalize('NFD').replace(/[̀-ͯ]/g, '') + '@pagos.example>'), L('Date:   ' + U.fechaCorta(c.min) + ' +0000'), L(''), L('    ' + c.msg), L('')]));
    }
    case 'show': {
      const c = buscar(a[1] || 'HEAD');
      if (!c) return [L("fatal: ambiguous argument '" + a[1] + "': unknown revision or path not in the working tree.", 'err')];
      const out = [L('commit ' + c.h + U.hex(c.h, 33), 'ambar'), L('Author: ' + c.autor), L('Date:   ' + U.fechaCorta(c.min) + ' +0000'), L(''), L('    ' + c.msg), L('')];
      c.cambios.forEach(x => {
        out.push(L('diff --git a/' + x.ruta + ' b/' + x.ruta, 'dim'), L('--- a/' + x.ruta), L('+++ b/' + x.ruta));
        const d = K.diff(yamlRuta(st, x.antes), yamlRuta(st, x.despues)), idx = d.map((y, i) => y[0] !== ' ' ? i : -1).filter(i => i >= 0);
        if (!idx.length) return;
        const desde = Math.max(0, idx[0] - 3), hasta = Math.min(d.length, idx[idx.length - 1] + 4);
        out.push(L('@@ -' + (desde + 1) + ' +' + (desde + 1) + ' @@', 'dim'));
        d.slice(desde, hasta).forEach(y => out.push(L(y, y[0] === '+' ? 'verde' : y[0] === '-' ? 'rojo' : 'out')));
      });
      if (!c.cambios.length) out.push(L(T('(commit sin cambios de manifiestos en este simulador)', '(commit with no manifest changes in this simulator)'), 'dim'));
      return out;
    }
    case 'revert': {
      const h = a.slice(1).find(x => !/^-/.test(x)), c = buscar(h);
      if (!h) return [L('usage: git revert [--[no-]edit] [-n] [-m <parent-number>] [-s] [-S[<keyid>]] <commit>...', 'err')];
      if (!c) return [L("fatal: bad revision '" + h + "'", 'err')];
      if (!c.cambios.length) return [L(T('(ese commit no cambia manifiestos en el simulador: no hay nada que revertir)', '(that commit changes no manifests in the simulator: nothing to revert)'), 'dim')];
      const choque = c.cambios.find(x => JSON.stringify(st.k8s.repo[x.ruta]) !== JSON.stringify(x.despues));
      if (choque) return [L('error: could not revert ' + c.h + '... ' + c.msg, 'err'), L('hint: After resolving the conflicts, mark them with', 'err'), L('hint: "git add/rm <pathspec>", then run', 'err'), L('hint: "git revert --continue".', 'err'), L('CONFLICT (content): Merge conflict in ' + choque.ruta, 'err')];
      const r = K.commit(st, { min: st.reloj, autor: 'sre-admin', msg: 'Revert "' + c.msg + '"', cambios: c.cambios.map(x => ({ ruta: x.ruta, despues: x.antes })), empujado: false });
      return [L('[main ' + r.h + '] Revert "' + c.msg + '"'), L(' ' + c.cambios.length + ' file' + (c.cambios.length > 1 ? 's' : '') + ' changed, ' + c.cambios.length + ' insertion' + (c.cambios.length > 1 ? 's' : '') + '(+), ' + c.cambios.length + ' deletion' + (c.cambios.length > 1 ? 's' : '') + '(-)')];
    }
    case 'push': {
      if (!sinEmpujar.length) return [L('Everything up-to-date')];
      const antes = K.headEmpujado(st);
      sinEmpujar.forEach(c => { c.empujado = true; });
      return [L('Enumerating objects: 7, done.'), L('Writing objects: 100% (4/4), 412 bytes | 412.00 KiB/s, done.'), L('To ' + REPO_URL), L('   ' + antes.h + '..' + cs[0].h + '  main -> main')];
    }
    case 'diff': return [];
    case 'branch': return [L('* main', 'verde')];
    default: return [L(T('(en el simulador: git log, git show, git revert, git push, git status)', '(in the simulator: git log, git show, git revert, git push, git status)'), 'dim')];
  }
}, completar: () => ['log', 'show', 'revert', 'push', 'status', '--oneline', '--no-edit'] });

// ------------------------------------------------------------------ Argo CD
const APPS = [
  ['api-pagos', 'api-pagos', 'pagos'], ['web-checkout', 'web-checkout', 'pagos'], ['antifraude', 'antifraude', 'pagos'], ['liquidaciones', 'liquidaciones', 'pagos'],
  ['monitoring', 'monitoring', 'monitoring'], ['plataforma-rbac', 'rbac', 'pagos'], ['plataforma-netpol', 'netpol', 'pagos'],
];
P.alCrear.push(st => {
  const head = K.headEmpujado(st);
  st.k8s.argo = {};
  APPS.forEach(([n, ruta, ns]) => { st.k8s.argo[n] = { nombre: n, ruta, ns, auto: false, selfHeal: false, prune: false, historia: [{ id: 0, min: head.min + 4, rev: head.h, ms: manifiestosOrigen(st, ruta) }], revSync: head.h, op: { fase: 'Succeeded', msg: 'successfully synced (all tasks run)', min: head.min + 4, rev: head.h } }; });
});
function rutasApp(st, a) { return Object.keys(st.k8s.repo).filter(r => r.indexOf(a.ruta + '/') === 0).sort(); }
function manifiestosOrigen(st, ruta) { return Object.keys(st.k8s.repo).filter(r => r.indexOf(ruta + '/') === 0).sort().map(r => K.origen(st, r)).filter(Boolean); }
K.argoApp = (st, n) => st.k8s.argo && st.k8s.argo[n];
// Estado de sincronización: lo empujado frente a lo vivo, manifiesto a manifiesto.
K.argoRecursos = (st, a) => manifiestosOrigen(st, a.ruta).map(m => {
  const vivo = K.manifiesto(st, m.kind, (m.ns ? m.ns + '/' : '') + m.nombre);
  return { m, sync: vivo && JSON.stringify(vivo) === JSON.stringify(m) ? 'Synced' : 'OutOfSync', salud: saludDe(st, m) };
});
function saludDe(st, m) {
  if (m.kind === 'Deployment') {
    const d = st.k8s.deps[m.ns + '/' + m.nombre]; if (!d) return 'Missing';
    if (d.atascado || K.podsDe(st, d).some(p => p.c.razon === 'CrashLoopBackOff' || /Image/.test(p.c.razon || ''))) return 'Degraded';
    return K.completo(st, d) ? 'Healthy' : 'Progressing';
  }
  if (m.kind === 'Certificate') { const c = st.k8s.certs[m.ns + '/' + m.nombre]; const s = c && st.k8s.secrets[c.ns + '/' + c.secret]; return K.secretoValido(st, s) ? 'Healthy' : 'Degraded'; }
  if (m.kind === 'PersistentVolumeClaim' || m.kind === 'Ingress' || m.kind === 'Service') return 'Healthy';
  return '';
}
K.argoEstado = (st, a) => {
  const rs = K.argoRecursos(st, a), sal = rs.map(r => r.salud);
  return { sync: rs.some(r => r.sync === 'OutOfSync') ? 'OutOfSync' : 'Synced', salud: sal.indexOf('Degraded') >= 0 ? 'Degraded' : sal.indexOf('Missing') >= 0 ? 'Missing' : sal.indexOf('Progressing') >= 0 ? 'Progressing' : 'Healthy', rs };
};
// Sincronizar: aplicar lo empujado de la carpeta de la aplicación.
K.argoSync = (st, a, t, ms, quien) => {
  const head = K.headEmpujado(st), lista = ms || manifiestosOrigen(st, a.ruta), res = lista.map(m => ({ m, r: K.aplicar(st, copia(m), t) }));
  const malo = res.find(x => /^(Error|The )/.test(x.r));
  a.op = { fase: malo ? 'Failed' : 'Succeeded', msg: malo ? 'one or more objects failed to apply, reason: ' + malo.r : 'successfully synced (all tasks run)', min: t, rev: head.h, res, quien: quien || 'automated sync policy' };
  if (!malo) { a.revSync = head.h; a.historia.push({ id: a.historia.length, min: t, rev: head.h, ms: lista.map(copia) }); }
  K.evento(st, t, 'argocd', malo ? 'Warning' : 'Normal', malo ? 'OperationFailed' : 'OperationCompleted', 'application/' + a.nombre, malo ? 'Sync operation to ' + head.h + ' failed: ' + a.op.msg : 'Sync operation to ' + head.h + ' succeeded', 'argocd-application-controller');
  return a.op;
};
// El controlador: con auto-sync, sincroniza cada commit nuevo; con self-heal, además deshace los cambios a mano.
K.controladoresExtra.push((st, t) => {
  if (!st.k8s.argo) return;
  Object.values(st.k8s.argo).forEach(a => {
    if (!a.auto) return;
    const head = K.headEmpujado(st);
    if (a.revSync !== head.h && rutasApp(st, a).length) { if (K.argoEstado(st, a).sync === 'OutOfSync') K.argoSync(st, a, t); else a.revSync = head.h; return; }
    if (a.selfHeal && K.argoEstado(st, a).sync === 'OutOfSync') K.argoSync(st, a, t, null, 'self-heal');
  });
});
const nombreApp = x => String(x || '').replace(/^argocd\//, '');
const politica = a => a.auto ? 'Auto' + (a.prune ? '-Prune' : '') : '<none>';
const fechaUtc = m => U.iso(m).replace('T', ' ') + ' +0000 UTC';
U.cmd('argocd', { ayuda: T('Argo CD: app list, app get, app diff, app sync, app history, app set', 'Argo CD: app list, app get, app diff, app sync, app history, app set'), grupo: 'GitOps', donde: ['ops'], fn: ctx => {
  const st = ctx.st, a = ctx.args;
  if (a[0] === 'version') return [L('argocd: v2.12.3+6b9cd82'), L('argocd-server: v2.12.3+6b9cd82')];
  if (a[0] !== 'app') return [L(T('(en el simulador: argocd app list | get | diff | sync | history | rollback | set)', '(in the simulator: argocd app list | get | diff | sync | history | rollback | set)'), 'dim')];
  const sub = a[1], nombre = nombreApp(a.filter((x, i) => i > 1 && !/^-/.test(x) && !/^-/.test(a[i - 1] || ''))[0]), app = K.argoApp(st, nombre);
  const fatal = m => ({ lineas: [L('FATA[0000] ' + m, 'err')], fallo: true });
  if (sub === 'list') return K.tabla(['NAME', 'CLUSTER', 'NAMESPACE', 'PROJECT', 'STATUS', 'HEALTH', 'SYNCPOLICY', 'CONDITIONS', 'REPO', 'PATH', 'TARGET'],
    Object.values(st.k8s.argo).map(x => { const e = K.argoEstado(st, x); return ['argocd/' + x.nombre, 'https://kubernetes.default.svc', x.ns, 'default', e.sync, e.salud, politica(x), '<none>', REPO_URL, x.ruta, 'main']; }));
  if (!nombre) return fatal('rpc error: code = InvalidArgument desc = application name is required');
  if (!app) return fatal('rpc error: code = NotFound desc = applications.argoproj.io "' + nombre + '" not found');
  const e = K.argoEstado(st, app), head = K.headEmpujado(st);
  if (sub === 'get') {
    if (a.indexOf('-o') >= 0 || a.indexOf('yaml') >= 0) return K.yaml({ apiVersion: 'argoproj.io/v1alpha1', kind: 'Application', metadata: { name: app.nombre, namespace: 'argocd' }, spec: { project: 'default', source: { repoURL: REPO_URL, path: app.ruta, targetRevision: 'main' }, destination: { server: 'https://kubernetes.default.svc', namespace: app.ns }, syncPolicy: app.auto ? { automated: { prune: app.prune, selfHeal: app.selfHeal } } : null }, status: { sync: { status: e.sync, revision: head.h }, health: { status: e.salud } } }).map(x => L(x));
    const out = [['Name', 'argocd/' + app.nombre], ['Project', 'default'], ['Server', 'https://kubernetes.default.svc'], ['Namespace', app.ns], ['URL', 'https://argocd.pagos.example/applications/' + app.nombre], ['Source', ''], ['- Repo', REPO_URL], ['  Target', 'main'], ['  Path', app.ruta], ['SyncWindow', 'Sync Allowed'], ['Sync Policy', app.auto ? 'Automated' + (app.prune ? ' (Prune)' : '') : '<none>'], ['Sync Status', e.sync + ' from main (' + head.h + ')'], ['Health Status', e.salud]].map(([k, v]) => L((k + ':').padEnd(20) + v, k === 'Sync Status' && e.sync === 'OutOfSync' || k === 'Health Status' && e.salud === 'Degraded' ? 'ambar' : 'out'));
    if (app.op && app.op.fase === 'Failed') out.push(L(''), L('Operation:          Sync'), L('Sync Revision:      ' + app.op.rev), L('Phase:              Failed', 'rojo'), L('Message:            ' + app.op.msg, 'rojo'));
    const grupo = m => ({ Deployment: 'apps', Certificate: 'cert-manager.io', Ingress: 'networking.k8s.io', HorizontalPodAutoscaler: 'autoscaling', RoleBinding: 'rbac.authorization.k8s.io', NetworkPolicy: 'networking.k8s.io' })[m.kind] || '';
    return out.concat([L('')], K.tabla(['GROUP', 'KIND', 'NAMESPACE', 'NAME', 'STATUS', 'HEALTH', 'HOOK', 'MESSAGE'], e.rs.map(r => [grupo(r.m), r.m.kind, r.m.ns || '', r.m.nombre, r.sync, r.salud, '', ''])));
  }
  if (sub === 'diff') {
    const out = [];
    e.rs.filter(r => r.sync === 'OutOfSync').forEach(r => {
      const vivo = K.manifiesto(st, r.m.kind, (r.m.ns ? r.m.ns + '/' : '') + r.m.nombre);
      out.push(L(''), L('===== ' + ({ Deployment: 'apps/', Certificate: 'cert-manager.io/', Ingress: 'networking.k8s.io/', HorizontalPodAutoscaler: 'autoscaling/', RoleBinding: 'rbac.authorization.k8s.io/', NetworkPolicy: 'networking.k8s.io/' }[r.m.kind] || '') + r.m.kind + ' ' + (r.m.ns ? r.m.ns + '/' : '') + r.m.nombre + ' ======', 'ambar'));
      K.diff(vivo ? K.yamlDe(vivo) : [], K.yamlDe(r.m)).filter(x => x[0] !== ' ').forEach(x => out.push(L((x[0] === '-' ? '< ' : '> ') + x.slice(1), x[0] === '-' ? 'rojo' : 'verde')));
    });
    return { lineas: out, fallo: out.length > 0 };
  }
  if (sub === 'sync') {
    const op = K.argoSync(st, app, st.reloj, null, 'sre-admin');
    const out = K.tabla(['TIMESTAMP', 'GROUP', 'KIND', 'NAMESPACE', 'NAME', 'STATUS', 'HEALTH', 'HOOK', 'MESSAGE'], op.res.map(x => [U.iso(st.reloj) + 'Z', '', x.m.kind, x.m.ns || '', x.m.nombre, /^(Error|The )/.test(x.r) ? 'SyncFailed' : 'Synced', '', '', x.r]));
    return { lineas: out.concat([L(''), L('Name:               argocd/' + app.nombre), L('Project:            default'), L('Server:             https://kubernetes.default.svc'), L('Namespace:          ' + app.ns), L('Sync Revision:      ' + op.rev), L('Phase:              ' + op.fase, op.fase === 'Failed' ? 'rojo' : 'verde'), L('Message:            ' + op.msg)]), fallo: op.fase === 'Failed' };
  }
  if (sub === 'history') return K.tabla(['ID', 'DATE', 'REVISION'], app.historia.map(x => [x.id, fechaUtc(x.min), 'main (' + x.rev + ')']));
  if (sub === 'rollback') {
    if (app.auto) return fatal('rpc error: code = FailedPrecondition desc = rollback cannot be initiated when auto-sync is enabled');
    const id = a.filter((x, i) => i > 2 && /^\d+$/.test(x))[0], h = id != null ? app.historia.find(x => String(x.id) === id) : app.historia[app.historia.length - 2];
    if (!h) return fatal('rpc error: code = InvalidArgument desc = application ' + app.nombre + ' does not have deployment id \'' + id + '\' in history');
    K.argoSync(st, app, st.reloj, h.ms, 'sre-admin (rollback)');
    return [L('Name:               argocd/' + app.nombre), L('Phase:              Succeeded'), L('Message:            successfully synced (all tasks run)')];
  }
  if (sub === 'set') {
    const i = a.indexOf('--sync-policy'), v = i >= 0 ? a[i + 1] : (a.find(x => /^--sync-policy=/.test(x)) || '').split('=')[1];
    if (v === 'none' || v === 'manual') { app.auto = false; app.selfHeal = false; }
    else if (v === 'automated' || v === 'auto' || v === 'automatic') app.auto = true;
    if (a.indexOf('--self-heal') >= 0) app.selfHeal = true;
    if (a.indexOf('--self-heal=false') >= 0) app.selfHeal = false;
    if (a.indexOf('--auto-prune') >= 0) app.prune = true;
    return [];
  }
  if (sub === 'wait') return { lineas: [L(T('(en el simulador: argocd app get para ver el estado)', '(in the simulator: argocd app get to see the state)'), 'dim')] };
  return fatal('unknown command "' + (sub || '') + '" for "argocd app"');
}, completar: (st, ses, pal) => {
  if (!pal.length) return ['app', 'version'];
  if (pal.length === 1) return ['list', 'get', 'diff', 'sync', 'history', 'rollback', 'set'];
  if (pal.length === 2) return Object.keys(st.k8s.argo);
  return ['--sync-policy', 'automated', 'none', '--self-heal'];
} });
// Las alertas de Argo CD (argocd-mixin): una aplicación degradada o con la sincronización fallida.
P.detectores.push((st, add) => {
  if (!st.k8s.argo) return;
  Object.values(st.k8s.argo).forEach(a => {
    if (a.op && a.op.fase === 'Failed') add('ArgoCdAppSyncFailed', 'warning', null, T('La sincronización de la aplicación ' + a.nombre + ' de Argo CD ha fallado', 'The sync operation of Argo CD application ' + a.nombre + ' has failed'), 'ArgoCdAppSyncFailed|' + a.nombre);
  });
});

// ------------------------------------------------------------------ CI (GitLab)
const PROY = 'pagos/web-checkout';
P.alCrear.push(st => { st.k8s.pipelines = []; });
K.pipeline = (st, o) => { st.k8s.pipelines.push(Object.assign({ proyecto: PROY }, o)); };
const haceTxt = m => { m = Math.max(0, Math.round(m)); return m < 60 ? (m <= 1 ? 'about 1 minute ago' : m + ' minutes ago') : m < 1440 ? 'about ' + Math.round(m / 60) + ' hour' + (Math.round(m / 60) > 1 ? 's' : '') + ' ago' : Math.round(m / 1440) + ' days ago'; };
// El job de deploy espera a que Argo CD tenga la aplicación sincronizada y sana.
K.jobDeploy = (st, app) => { const e = K.argoEstado(st, K.argoApp(st, app)); return e.sync === 'Synced' && e.salud === 'Healthy'; };
U.cmd('glab', { ayuda: T('los pipelines de CI: glab ci list, glab ci trace JOB, glab ci retry JOB', 'CI pipelines: glab ci list, glab ci trace JOB, glab ci retry JOB'), grupo: 'CI/CD', donde: ['ops'], fn: ctx => {
  const st = ctx.st, a = ctx.args;
  if (a[0] !== 'ci') return [L(T('(en el simulador: glab ci list | trace JOB | retry JOB)', '(in the simulator: glab ci list | trace JOB | retry JOB)'), 'dim')];
  const ps = st.k8s.pipelines, jobs = [].concat(...ps.map(p => p.jobs.map(j => Object.assign(j, { p }))));
  const job = id => jobs.find(j => String(j.id) === String(id));
  if (a[1] === 'list') {
    if (!ps.length) return [L('No Pipelines available on ' + PROY)];
    return [L('Showing ' + ps.length + ' pipelines on ' + PROY + ' (Page 1)'), L('')].concat(ps.slice().reverse().map(p => L('(' + p.estado + ') • #' + p.id + '  ' + p.ref + '  (' + haceTxt(st.reloj - p.min) + ')', p.estado === 'failed' ? 'rojo' : p.estado === 'success' ? 'verde' : 'out')));
  }
  if (a[1] === 'view' || a[1] === 'status') {
    const p = ps[ps.length - 1]; if (!p) return [L('No Pipelines available on ' + PROY)];
    return [L('(' + p.estado + ') • #' + p.id + '  ' + p.ref + '  ' + p.titulo)].concat(p.jobs.map(j => L('  ' + j.stage.padEnd(16) + ('(' + j.estado + ')').padEnd(11) + j.nombre + '  #' + j.id, j.estado === 'failed' ? 'rojo' : j.estado === 'success' ? 'verde' : 'dim')));
  }
  if (a[1] === 'trace') {
    const j = job(a[2]); if (!j) return { lineas: [L(a[2] ? 'ERROR: 404 Not Found' : 'ERROR: you must specify a job id: glab ci trace <job-id>', 'err')], fallo: true };
    return j.log.map(x => L(x, /^ERROR|Error from server|FATA|timed out/i.test(x) ? 'rojo' : /^\$ /.test(x) ? 'ambar' : 'out'));
  }
  if (a[1] === 'retry') {
    const j = job(a[2]); if (!j) return { lineas: [L(a[2] ? 'ERROR: 404 Not Found' : 'ERROR: you must specify a job id: glab ci retry <job-id>', 'err')], fallo: true };
    if (!j.reintentar) return [L(T('(ese job no se reintenta en el simulador)', '(that job cannot be retried in the simulator)'), 'dim')];
    // Un reintento es un job nuevo, con otro id, en el sitio del anterior.
    const r = j.reintentar(st), p = j.p, nuevo = { id: Math.max(...jobs.map(x => x.id)) + 1, nombre: j.nombre, stage: j.stage, estado: r.ok ? 'success' : 'failed', log: r.log, reintentar: j.reintentar };
    p.jobs.splice(p.jobs.indexOf(j), 1, nuevo);
    p.estado = p.jobs.every(x => x.estado === 'success') ? 'success' : 'failed';
    return [L('Retried job (id: ' + nuevo.id + ' ), status: ' + (r.ok ? 'success' : 'failed') + ' , ref: ' + j.p.ref + ' , weburl: https://git.pagos.example/' + PROY + '/-/jobs/' + nuevo.id + ' )', r.ok ? 'verde' : 'rojo')];
  }
  return [L(T('(en el simulador: glab ci list | view | trace JOB | retry JOB)', '(in the simulator: glab ci list | view | trace JOB | retry JOB)'), 'dim')];
}, completar: (st, ses, pal) => !pal.length ? ['ci'] : pal.length === 1 ? ['list', 'view', 'trace', 'retry'] : [].concat(...st.k8s.pipelines.map(p => p.jobs.map(j => String(j.id)))) });
})(window.PUESTO = window.PUESTO || {});
