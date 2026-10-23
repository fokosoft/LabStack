// Puesto DevOps · fase 3: los nodos por dentro.
//
// El kubelet se niega a arrancar con swap activo (salvo que se le diga lo
// contrario), y ése es un fallo clásico tras reiniciar un nodo en el que
// alguien activó un swapfile «para probar». Aquí: swap en el nodo, /etc/fstab
// que lo vuelve a activar en cada arranque, swapon, swapoff, free y un sed -i
// mínimo para comentar la línea del fstab.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L;

// El kubelet no arranca con swap activo.
P.motivos['kubelet-swap'] = {
  journal: (st, h, u, min) => [
    { t: 'I0923 ' + U.iso(min).slice(11) + '.512033    ' + U.pid(h.nombre + 'kubelet') + ' server.go:487] "Kubelet version" kubeletVersion="v1.29.8"' },
    { t: 'E0923 ' + U.iso(min).slice(11) + '.519874    ' + U.pid(h.nombre + 'kubelet') + ' run.go:74] "command failed" err="failed to run Kubelet: running with swap on is not supported, please disable swap! or set --fail-swap-on flag to false. /proc/swaps contained: [Filename\\t\\t\\t\\tType\\t\\tSize\\t\\tUsed\\t\\tPriority /swapfile                               file\\t\\t8388604\\t\\t0\\t\\t-2]"' },
  ],
  result: 'exit-code', limite: false,
};
P.reglas.push((st, h, u) => u === 'kubelet' && h.extra.swap ? 'kubelet-swap' : null);
// Al volver de un reinicio, lo que diga /etc/fstab se vuelve a activar.
P.alVolver.push((st, h) => { if (h.extra.fstabSwap && !h.extra.swap) { h.extra.swap = true; if (h.svcs.kubelet) P.fallar(st, h, 'kubelet', 'kubelet-swap', st.reloj); } });

U.cmd('swapon', { ayuda: T('el swap activo (swapon --show)', 'active swap (swapon --show)'), grupo: T('Servicios', 'Services'), fn: ctx => {
  const h = ctx.h;
  if (ctx.args[0] === '-a') { if (!ctx.sudo) return U.sinRoot(ctx, ['swapon: /swapfile: swapon failed: Operation not permitted']); if (h.extra.fstabSwap) h.extra.swap = true; return []; }
  return h.extra.swap ? [L('NAME      TYPE SIZE USED PRIO'), L('/swapfile file   8G   0B   -2')] : [];
} });
U.cmd('swapoff', { ayuda: T('desactiva el swap (sudo swapoff -a)', 'turn swap off (sudo swapoff -a)'), grupo: T('Servicios', 'Services'), fn: ctx => {
  if (!ctx.sudo) return U.sinRoot(ctx, ['swapoff: /swapfile: swapoff failed: Operation not permitted']);
  ctx.h.extra.swap = false;
  return [];
} });
// free enseña el swap de verdad.
(orig => { P.comandos.free.fn = ctx => { const r = orig(ctx); if (ctx.h.extra.swap && Array.isArray(r)) r[2] = L('Swap:          8.0Gi          0B       8.0Gi'); return r; }; })(P.comandos.free.fn);
// /etc/fstab, con la línea del swapfile si alguien la añadió.
P.ficheros.push((st, h) => {
  if (h.rol !== 'worker' && h.rol !== 'cp') return {};
  const ls = ['# /etc/fstab: static file system information.', 'UUID=' + U.uuid(h.nombre + 'root') + ' / ext4 defaults 0 1', 'UUID=' + U.uuid(h.nombre + 'boot') + ' /boot/efi vfat umask=0077 0 1'];
  if (h.extra.fstabSwap) ls.push('/swapfile none swap sw 0 0');
  else if (h.extra.fstabComentado) ls.push('#/swapfile none swap sw 0 0');
  return { '/etc/fstab': { lineas: () => ls, mb: 0.001 } };
});
// sed -i: sólo lo que se hace con el fstab (comentar o borrar las líneas que casan).
U.cmd('sed', { ayuda: T("edita un fichero en el sitio (sudo sed -i '/swap/ s/^/#/' /etc/fstab)", "edit a file in place (sudo sed -i '/swap/ s/^/#/' /etc/fstab)"), fn: ctx => {
  const a = ctx.args, i = a.indexOf('-i'), expr = a.filter(x => x !== '-i' && !/^-/.test(x))[0], fich = a.filter(x => !/^-/.test(x))[1];
  if (i < 0 || !expr || !fich) return [L(T("(en el simulador: sed -i '/patrón/ s/^/#/' fichero, o sed -i '/patrón/d' fichero)", "(in the simulator: sed -i '/pattern/ s/^/#/' file, or sed -i '/pattern/d' file)"), 'dim')];
  const ruta = U.ruta(ctx.ses.cwd, fich, ctx.ses);
  if (ruta !== '/etc/fstab') { const fs = P.vfs(ctx.st, ctx.h); return fs.f[ruta] ? [L(T('(en el simulador sed -i sólo edita /etc/fstab)', '(in the simulator sed -i only edits /etc/fstab)'), 'dim')] : [L("sed: can't read " + fich + ': No such file or directory', 'err')]; }
  if (!ctx.sudo) return U.sinRoot(ctx, ['sed: couldn\'t open temporary file /etc/sedXy7k2q: Permission denied']);
  const m = /^\/([^/]+)\/\s*(s\/\^\/#\/|d)$/.exec(expr);
  if (!m) return [L("sed: -e expression #1, char 1: unknown command: `" + expr[0] + "'", 'err')];
  if (new RegExp(m[1]).test('/swapfile none swap sw 0 0') && ctx.h.extra.fstabSwap) { ctx.h.extra.fstabSwap = false; ctx.h.extra.fstabComentado = m[2] !== 'd'; }
  return [];
} });
})(window.PUESTO = window.PUESTO || {});
