// Puesto CPD · el sistema operativo de cada servidor.
//
// Lo que en el Puesto Linux era siempre Ubuntu, aquí depende de la máquina: el
// gestor de paquetes (dnf, apt o zypper), el nombre de los servicios (sshd o
// ssh, chronyd o chrony), SELinux y firewalld en la familia Red Hat, quién está
// en el grupo de sudo... Todo se decide por h.extra.distro, que viene de la
// topología.
//
// Y una cosa que el motor no tenía: ficheros de configuración que se editan.
// h.extra.conf guarda su contenido, su modo y su dueño; sed -i, tee, cp, chmod
// y las redirecciones (>, >>) los cambian de verdad, con los permisos de
// verdad: sudo cat a b > fichero falla, porque la redirección la hace tu shell.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L;
const C = P.cpd = P.cpd || {};

// ------------------------------------------------------------------ distribuciones
C.DISTRO = {
  rocky: { fam: 'rh', bonito: 'Rocky Linux 9.4 (Blue Onyx)', id: 'rocky', version: '9.4', like: 'rhel centos fedora',
    banner: () => [], admin: 'wheel' },
  debian: { fam: 'debian', bonito: 'Debian GNU/Linux 12 (bookworm)', id: 'debian', version: '12', like: '',
    banner: h => ['Linux ' + h.nombre + ' ' + h.kernel + ' #1 SMP PREEMPT_DYNAMIC Debian 6.1.119-1 (2024-11-22) x86_64', '', 'The programs included with the Debian GNU/Linux system are free software;', 'Debian GNU/Linux comes with ABSOLUTELY NO WARRANTY, to the extent', 'permitted by applicable law.'], admin: 'sudo' },
  ubuntu: { fam: 'debian', bonito: 'Ubuntu 22.04.4 LTS', id: 'ubuntu', version: '22.04', like: 'debian',
    banner: h => ['Welcome to Ubuntu 22.04.4 LTS (GNU/Linux ' + h.kernel + ' x86_64)', '', ' * Documentation:  https://help.ubuntu.com'], admin: 'sudo' },
  sles: { fam: 'suse', bonito: 'SUSE Linux Enterprise Server 15 SP5', id: 'sles', version: '15-SP5', like: 'suse',
    banner: () => ['SUSE Linux Enterprise Server 15 SP5 x86_64 (64-bit)', '', 'As "root" use the:', '- zypper command for package management', '- yast command for configuration management'], admin: 'wheel' },
};
C.distro = h => C.DISTRO[(h && h.extra.distro) || 'debian'];
C.fam = h => C.distro(h).fam;
C.esRH = h => C.fam(h) === 'rh';
// Los mismos servicios con otro nombre según la familia.
U.visible = (h, u) => (C.fam(h) !== 'debian' && ({ ssh: 'sshd', chrony: 'chronyd' })[u]) || u;
C.hostsDe = fam => P.topologia.filter(d => C.DISTRO[d.distro].fam === fam).map(d => d.n);

P.alCrear.push(st => {
  P.topologia.forEach(d => {
    const h = st.hosts[d.n]; h.extra.distro = d.distro;
    h.extra.conf = {};
    h.extra.usuarios = { root: { uid: 0, home: '/root', shell: '/bin/bash', grupos: ['root'] }, admin: { uid: 1000, home: '/home/admin', shell: '/bin/bash', grupos: ['admin', C.distro(h).admin] } };
    h.extra.pk = { act: [], refrescado: false, historial: [] };
    h.extra.claveMgmt = true;       // la clave pública de mgmt01 está en su authorized_keys
    h.extra.dirs = {};              // directorios que no derivan de un fichero (vacíos, o creados con mkdir)
    h.extra.privados = { '/root': '700' };
    C.ficheroBase(h, '/etc/sudoers', [ '# This file MUST be edited with the \'visudo\' command as root.', 'Defaults\tenv_reset', 'Defaults\tsecure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"', '', 'root\tALL=(ALL:ALL) ALL', '%' + C.distro(h).admin + '\tALL=(ALL:ALL) ALL', '', '@includedir /etc/sudoers.d'], '440');
    h.extra.dirs['/etc/sudoers.d'] = true; h.extra.privados['/etc/sudoers.d'] = '750';
    if (C.esRH(h)) C.crearSelinux(h);
    if (C.fam(h) !== 'debian') C.crearFirewall(h);
  });
});

// ------------------------------------------------------------------ ficheros editables
C.ficheroBase = (h, p, lineas, modo, dueno, grupo) => { h.extra.conf[p] = { lineas: lineas.slice(), modo: modo || '644', dueno: dueno || 'root', grupo: grupo || dueno || 'root' }; };
C.leer = (h, p) => h.extra.conf[p] ? h.extra.conf[p].lineas.slice() : null;
const otros = m => parseInt(String(m).slice(-1), 10) || 0;
// ¿Lo puede leer admin sin sudo?
C.legible = (h, p, usuario) => {
  const e = h.extra.conf[p], u = usuario || 'admin';
  if (C.dirPrivado(h, p, u)) return false;
  if (!e) return true;
  if (e.dueno === u) return true;
  return (otros(e.modo) & 4) !== 0;
};
C.dirPrivado = (h, p, usuario) => Object.keys(h.extra.privados).some(d => (p === d || p.indexOf(d + '/') === 0) && !(usuario && h.extra.usuarios[usuario] && h.extra.usuarios[usuario].home === d));
C.escribible = (h, p, usuario) => {
  const u = usuario || 'admin', home = (h.extra.usuarios[u] || {}).home || '/home/admin';
  if (p.indexOf(home + '/') === 0 || p.indexOf('/tmp/') === 0) return true;
  const e = h.extra.conf[p];
  return !!(e && e.dueno === u);
};
C.escribir = (st, h, p, lineas, o) => {
  o = o || {};
  const quien = o.quien || 'bash', nombre = o.nombre || p;
  if (!o.root && !C.escribible(h, p, o.usuario)) return [L(quien + ': ' + nombre + ': Permission denied', 'err')];
  const dir = p.slice(0, p.lastIndexOf('/')) || '/';
  if (!P.vfs(st, h).dirs[dir]) return [L(quien + ': ' + nombre + ': No such file or directory', 'err')];
  const e = h.extra.conf[p];
  if (e) e.lineas = o.ap ? e.lineas.concat(lineas) : lineas.slice();
  else h.extra.conf[p] = { lineas: lineas.slice(), modo: o.root ? '644' : '664', dueno: o.root ? 'root' : (o.usuario || 'admin'), grupo: o.root ? 'root' : (o.usuario || 'admin') };
  C.alCambiar(st, h, p);
  return [];
};
// Algunos ficheros se leen al vuelo (la configuración de reportd, el compose...).
C.observadores = [];
C.alCambiar = (st, h, p) => C.observadores.forEach(f => f(st, h, p));

P.ficheros.push((st, h) => {
  const f = {};
  Object.keys(h.extra.conf || {}).forEach(p => { const e = h.extra.conf[p]; f[p] = { lineas: () => e.lineas.slice(), mb: 0.004, conf: true }; });
  const d = C.distro(h);
  f['/etc/os-release'] = { lineas: () => ['PRETTY_NAME="' + d.bonito + '"', 'NAME="' + d.bonito.split(' ').slice(0, d.id === 'sles' ? 4 : d.id === 'rocky' ? 2 : 1).join(' ') + '"', 'VERSION_ID="' + d.version + '"', 'ID="' + d.id + '"'].concat(d.like ? ['ID_LIKE="' + d.like + '"'] : []) };
  f['/etc/passwd'] = { lineas: () => Object.keys(h.extra.usuarios).map(n => { const x = h.extra.usuarios[n]; return n + ':x:' + x.uid + ':' + x.uid + '::' + x.home + ':' + x.shell; }) };
  if (C.fam(h) === 'debian') f['/etc/chrony/chrony.conf'] = { lineas: () => C.chronyConf(h) };
  else f['/etc/chrony.conf'] = { lineas: () => C.chronyConf(h) };
  return f;
});
// El motor mete ficheros de Ubuntu (chrony, reboot-required): aquí se quitan donde no tocan,
// y se marcan los que sólo lee root.
const vfsMotor = P.vfs;
P.vfs = (st, h) => {
  const r = vfsMotor(st, h);
  if (!h.extra.conf) return r;
  if (C.fam(h) !== 'debian') { delete r.f['/etc/chrony/chrony.conf']; delete r.f['/var/run/reboot-required']; }
  Object.keys(r.f).forEach(p => { if (!r.f[p]) delete r.f[p]; else if (!C.legible(h, p)) r.f[p] = Object.assign({}, r.f[p], { priv: true }); });
  const dirs = { '/': true };
  Object.keys(r.f).concat(Object.keys(h.extra.dirs)).forEach(p => { let x = h.extra.dirs[p] ? p : p.slice(0, p.lastIndexOf('/')); while (x) { dirs[x] = true; x = x.slice(0, x.lastIndexOf('/')); } });
  ['/home', '/root', '/tmp', '/etc', '/var', '/var/log', '/usr', '/opt', '/srv'].forEach(x => { dirs[x] = true; });
  Object.keys(h.extra.usuarios).forEach(n => { const x = h.extra.usuarios[n]; if (x.conHome) dirs[x.home] = true; });
  dirs[U.HOME] = true;
  r.dirs = dirs;
  return r;
};
P.redirigir = (st, ses, dest, lineas, ap) => {
  const h = st.hosts[ses.host], p = U.ruta(ses.cwd, dest, ses);
  if (p === '/dev/null') return [];
  return C.escribir(st, h, p, lineas, { ap, root: ses.root, usuario: ses.usuario, nombre: dest });
};

// ------------------------------------------------------------------ permisos y ls
const RWX = m => String(m).padStart(3, '0').slice(-3).split('').map(c => { const n = parseInt(c, 10); return (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-'); }).join('');
C.modoDe = (h, p, dir) => {
  const e = h.extra.conf[p];
  if (e) return { modo: e.modo, dueno: e.dueno, grupo: e.grupo };
  if (dir) { const pr = h.extra.privados[p]; const due = (h.extra.duenos || {})[p] || (Object.keys(h.extra.usuarios).find(n => h.extra.usuarios[n].home === p && n !== 'root') || 'root'); return { modo: pr || '755', dueno: due, grupo: due }; }
  if (/^\/var\/log\//.test(p)) return { modo: '640', dueno: (h.extra.duenos || {})[p] || 'root', grupo: C.fam(h) === 'debian' ? 'adm' : 'root' };
  if (p.indexOf(U.HOME + '/') === 0) return { modo: '644', dueno: 'admin', grupo: 'admin' };
  return { modo: '644', dueno: 'root', grupo: 'root' };
};
U.cmd('ls', { ayuda: T('lista ficheros (ls -l, ls -lh, ls -Z para SELinux)', 'list files (ls -l, ls -lh, ls -Z for SELinux)'), fn: ctx => {
  const st = ctx.st, h = ctx.h, fs = P.vfs(st, h);
  const ops = ctx.args.filter(x => x[0] === '-').join(''), rutas = ctx.args.filter(x => x[0] !== '-');
  const largo = ops.indexOf('l') >= 0, humano = ops.indexOf('h') >= 0, zeta = ops.indexOf('Z') >= 0, uno = ops.indexOf('d') >= 0;
  if (zeta && !C.esRH(h)) return [L('ls: SELinux is not enabled on this system', 'err')];
  const out = [], objetivos = rutas.length ? [].concat(...rutas.map(r => U.glob(fs, ctx.ses.cwd, r, ctx.ses))) : [ctx.ses.cwd];
  const linea = (p, nombre) => {
    const dir = !!fs.dirs[p], m = C.modoDe(h, p, dir), ctxSe = zeta ? C.etiqueta(h, p) + ' ' : '';
    if (!largo) return ctxSe + nombre;
    const mb = dir ? 0.004 : (fs.f[p].mb || 0.004), t = humano ? U.tam(mb) : String(Math.round(mb * 1048576));
    return (dir ? 'd' : '-') + RWX(m.modo) + (zeta ? '.' : '') + ' 1 ' + m.dueno.padEnd(8) + ' ' + m.grupo.padEnd(8) + ' ' + (zeta ? ctxSe : '') + t.padStart(humano ? 5 : 8) + ' ' + U.sello(st.reloj - 5).slice(0, 12) + ' ' + nombre;
  };
  objetivos.forEach(p => {
    if (fs.f[p]) { if (C.dirPrivado(h, p.slice(0, p.lastIndexOf('/')) || '/', ctx.ses.usuario) && !ctx.sudo) { out.push(L("ls: cannot access '" + p + "': Permission denied", 'err')); return; } out.push(L(linea(p, p), (fs.f[p].mb || 0) > 10240 ? 'rojo' : 'out')); return; }
    if (!fs.dirs[p]) { out.push(L("ls: cannot access '" + p + "': No such file or directory", 'err')); return; }
    if (uno) { out.push(L(linea(p, p))); return; }
    if (C.dirPrivado(h, p, ctx.ses.usuario) && !ctx.sudo) { out.push(L("ls: cannot open directory '" + p + "': Permission denied", 'err')); return; }
    const hijos = U.hijos(fs, p), nombres = Object.keys(hijos).sort();
    if (objetivos.length > 1) out.push(L(p + ':'));
    if (largo) { out.push(L('total ' + (humano ? U.tam(U.tamRuta(fs, p)) : Math.round(U.tamRuta(fs, p) * 1024)))); nombres.forEach(n => { const q = (p === '/' ? '' : p) + '/' + n; out.push(L(linea(q, n), hijos[n] === 'd' ? 'azul' : (U.tamRuta(fs, q) > 10240 ? 'rojo' : 'out'))); }); }
    else if (zeta) nombres.forEach(n => out.push(L(linea((p === '/' ? '' : p) + '/' + n, n))));
    else if (nombres.length) out.push(L(nombres.map(n => hijos[n] === 'd' ? n + '/' : n).join('   ')));
  });
  return { lineas: out, minutos: 0 };
} });
U.cmd('chmod', { ayuda: T('cambia permisos (chmod 440 fichero)', 'change permissions (chmod 440 file)'), fn: ctx => {
  const [modo, ...rutas] = ctx.args.filter(x => x[0] !== '-');
  if (!modo || !rutas.length) return [L("chmod: missing operand", 'err')];
  if (!/^0?[0-7]{3}$/.test(modo)) return [L(T('(en el simulador, chmod sólo entiende el modo en octal: chmod 440 fichero)', '(in the simulator, chmod only takes an octal mode: chmod 440 file)'), 'dim')];
  const out = [];
  rutas.forEach(r => {
    const p = U.ruta(ctx.ses.cwd, r, ctx.ses), e = ctx.h.extra.conf[p];
    if (!e && !P.vfs(ctx.st, ctx.h).f[p]) { out.push(L("chmod: cannot access '" + r + "': No such file or directory", 'err')); return; }
    if (!e) { out.push(L("chmod: changing permissions of '" + r + "': Operation not permitted", 'err')); return; }
    if (!ctx.sudo && e.dueno !== (ctx.ses.usuario || 'admin')) { out.push(L("chmod: changing permissions of '" + r + "': Operation not permitted", 'err')); out.push(L(U.SUDO, 'dim')); return; }
    e.modo = modo.slice(-3);
  });
  return out;
} });
U.cmd('chown', { fn: ctx => {
  const [due, ...rutas] = ctx.args.filter(x => x[0] !== '-');
  if (!due || !rutas.length) return [L('chown: missing operand', 'err')];
  const d = U.sinRoot(ctx, rutas.map(r => "chown: changing ownership of '" + r + "': Operation not permitted")); if (d) return d;
  const [u, g] = due.split(':');
  return [].concat(...rutas.map(r => { const p = U.ruta(ctx.ses.cwd, r, ctx.ses), e = ctx.h.extra.conf[p]; if (!e) return [L("chown: cannot access '" + r + "': No such file or directory", 'err')]; e.dueno = u; if (g) e.grupo = g; return []; }));
} });
U.cmd('touch', { fn: ctx => [].concat(...ctx.args.filter(x => x[0] !== '-').map(r => { const p = U.ruta(ctx.ses.cwd, r, ctx.ses); if (ctx.h.extra.conf[p] || P.vfs(ctx.st, ctx.h).f[p]) return []; return C.escribir(ctx.st, ctx.h, p, [], { root: ctx.sudo, usuario: ctx.ses.usuario, quien: 'touch', nombre: "cannot touch '" + r + "'" }); })) });
U.cmd('mkdir', { fn: ctx => [].concat(...ctx.args.filter(x => x[0] !== '-').map(r => {
  const p = U.ruta(ctx.ses.cwd, r, ctx.ses);
  if (!ctx.sudo && !C.escribible(ctx.h, p + '/x', ctx.ses.usuario)) return [L("mkdir: cannot create directory '" + r + "': Permission denied", 'err')];
  ctx.h.extra.dirs[p] = true; return [];
})) });
U.cmd('cp', { ayuda: T('copia ficheros (cp origen destino)', 'copy files (cp source destination)'), fn: ctx => {
  const a = ctx.args.filter(x => x[0] !== '-'), fs = P.vfs(ctx.st, ctx.h);
  if (a.length < 2) return [L("cp: missing destination file operand after '" + (a[0] || '') + "'", 'err')];
  const destTxt = a.pop(), dest0 = U.ruta(ctx.ses.cwd, destTxt, ctx.ses), out = [];
  a.forEach(r => {
    const p = U.ruta(ctx.ses.cwd, r, ctx.ses);
    if (!fs.f[p]) { out.push(L("cp: cannot stat '" + r + "': No such file or directory", 'err')); return; }
    if (fs.f[p].priv && !ctx.sudo) { out.push(L("cp: cannot open '" + r + "' for reading: Permission denied", 'err')); return; }
    const dest = fs.dirs[dest0] ? dest0 + '/' + p.split('/').pop() : dest0;
    const e = C.escribir(ctx.st, ctx.h, dest, fs.f[p].lineas() || [], { root: ctx.sudo, usuario: ctx.ses.usuario, quien: 'cp', nombre: "cannot create regular file '" + destTxt + "'" });
    if (e.length) out.push(...e);
  });
  if (out.some(l => /Permission denied/.test(l.t)) && !ctx.sudo) out.push(L(U.SUDO, 'dim'));
  return out;
} });

// sed: lo justo de GNU sed para editar configuración (s///, /patrón/i, /patrón/a, d, c).
const bre = pat => pat.replace(/\\([()|{}+?])|([()|{}+?])/g, (m, esc, lit) => esc ? esc : '\\' + lit);
C.sed = (expr, lineas) => {
  const out = lineas.slice();
  let m = /^s(.)(.*?)\1(.*?)\1([gI]*)$/.exec(expr);
  if (m) {
    let re; try { re = new RegExp(bre(m[2]), (m[4].indexOf('g') >= 0 ? 'g' : '') + (m[4].indexOf('I') >= 0 ? 'i' : '')); } catch (e) { return null; }
    const rep = m[3].replace(/\\(\d)/g, '$$$1').replace(/(^|[^\\])&/g, '$1$$&').replace(/\\&/g, '&').replace(/\\\//g, '/');
    return out.map(l => l.replace(re, rep));
  }
  m = /^(\$|\d+|\/(.+)\/)\s*([iacd])\s*(.*)$/.exec(expr);
  if (!m) return null;
  const quien = m[1], cmd = m[3], txt = m[4].replace(/^\\/, '');
  let re = null; if (m[2] != null) { try { re = new RegExp(bre(m[2])); } catch (e) { return null; } }
  const toca = (l, i) => quien === '$' ? i === out.length - 1 : re ? re.test(l) : i === parseInt(quien, 10) - 1;
  const res = [];
  out.forEach((l, i) => {
    if (!toca(l, i)) { res.push(l); return; }
    if (cmd === 'i') { res.push(txt); res.push(l); } else if (cmd === 'a') { res.push(l); res.push(txt); } else if (cmd === 'c') res.push(txt);
  });
  return res;
};
U.cmd('sed', { ayuda: T('edita ficheros: sed -i \'s/viejo/nuevo/\' fichero', 'edit files: sed -i \'s/old/new/\' file'), fn: ctx => {
  const a = ctx.args, enSitio = a.some(x => /^-[a-zA-Z]*i/.test(x) || x === '--in-place');
  const resto = a.filter((x, i) => !/^-/.test(x) || (a[i - 1] === '-e'));
  const exprs = []; let ficheros = [];
  a.forEach((x, i) => { if (a[i - 1] === '-e') exprs.push(x); });
  const sinE = resto.filter(x => exprs.indexOf(x) < 0);
  if (!exprs.length) { exprs.push(sinE[0]); ficheros = sinE.slice(1); } else ficheros = sinE;
  if (!exprs[0]) return [L('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...', 'err')];
  if (!ficheros.length) return [L(T('(en el simulador, sed trabaja sobre un fichero: sed -i \'s/a/b/\' fichero)', '(in the simulator, sed works on a file: sed -i \'s/a/b/\' file)'), 'dim')];
  const fs = P.vfs(ctx.st, ctx.h), out = [];
  for (const r of ficheros) {
    const p = U.ruta(ctx.ses.cwd, r, ctx.ses);
    if (!fs.f[p]) { out.push(L('sed: can\'t read ' + r + ': No such file or directory', 'err')); continue; }
    if (fs.f[p].priv && !ctx.sudo) { out.push(L('sed: couldn\'t open file ' + r + ': Permission denied', 'err')); continue; }
    let lin = fs.f[p].lineas() || [];
    for (const ex of exprs) { lin = C.sed(ex, lin); if (!lin) return [L("sed: -e expression #1, char " + ex.length + ": unknown command: `" + ex.slice(-1) + "'", 'err')]; }
    if (!enSitio) { lin.forEach(x => out.push(L(x))); continue; }
    if (!ctx.h.extra.conf[p]) { out.push(L('sed: couldn\'t edit ' + r + ': not a regular file', 'err')); continue; }
    if (!ctx.sudo && !C.escribible(ctx.h, p, ctx.ses.usuario)) { out.push(L('sed: couldn\'t open temporary file ' + p.slice(0, p.lastIndexOf('/')) + '/sed' + U.hex(p, 6) + ': Permission denied', 'err')); out.push(L(U.SUDO, 'dim')); continue; }
    ctx.h.extra.conf[p].lineas = lin; C.alCambiar(ctx.st, ctx.h, p);
  }
  return out;
} });
// tee detrás de un |: con sudo delante escribe como root; la redirección > no.
P.filtros.tee = (lineas, args, ctx) => {
  const ap = args.some(x => /^-[a-z]*a/.test(x)), rutas = args.filter(x => x[0] !== '-'), out = lineas.slice();
  rutas.forEach(r => { const p = U.ruta(ctx.ses.cwd, r, ctx.ses); C.escribir(ctx.st, ctx.h, p, lineas.map(l => l.t), { ap, root: ctx.sudo, usuario: ctx.ses.usuario, quien: 'tee', nombre: r }).forEach(e => out.push(e)); });
  return out;
};
U.cmd('tee', { fn: () => [L(T('(tee lee de una tubería: echo \'texto\' | sudo tee fichero)', '(tee reads from a pipe: echo \'text\' | sudo tee file)'), 'dim')] });
// sh -c "…": con sudo delante, todo lo de dentro (también la redirección) va como root.
const shc = ctx => {
  const i = ctx.args.indexOf('-c');
  if (i < 0 || !ctx.args[i + 1]) return [L(T('(en el simulador sólo existe sh -c "comando")', '(in the simulator only sh -c "command" exists)'), 'dim')];
  const ses = { host: ctx.ses.host, cwd: ctx.ses.cwd, env: ctx.ses.env, root: ctx.sudo, usuario: ctx.ses.usuario, pila: [], hist: [], pendiente: null };
  const r = P.correrLinea(ctx.st, ses, ctx.args[i + 1]);
  return { lineas: r.lineas, minutos: Math.max(1, r.minutos) };
};
U.cmd('sh', { fn: shc }); U.cmd('bash', { fn: shc });

// ------------------------------------------------------------------ usuarios y sudo
U.cmd('whoami', { fn: ctx => ({ lineas: [L(ctx.ses.root ? 'root' : ctx.ses.usuario || 'admin')], minutos: 0 }) });
U.cmd('id', { fn: ctx => {
  const n = ctx.args.filter(x => x[0] !== '-')[0] || (ctx.ses.root ? 'root' : ctx.ses.usuario || 'admin'), x = ctx.h.extra.usuarios[n];
  if (!x) return [L('id: ‘' + n + '’: no such user', 'err')];
  return { lineas: [L('uid=' + x.uid + '(' + n + ') gid=' + x.uid + '(' + n + ') groups=' + x.grupos.map((g, i) => (i ? 990 + i : x.uid) + '(' + g + ')').join(','))], minutos: 0 };
} });
U.cmd('getent', { fn: ctx => {
  const [db, n] = ctx.args;
  if (db === 'passwd') { const ns = n ? [n] : Object.keys(ctx.h.extra.usuarios); return ns.filter(k => ctx.h.extra.usuarios[k]).map(k => { const x = ctx.h.extra.usuarios[k]; return L(k + ':x:' + x.uid + ':' + x.uid + '::' + x.home + ':' + x.shell); }); }
  if (db === 'group') { const g = {}; Object.keys(ctx.h.extra.usuarios).forEach(k => ctx.h.extra.usuarios[k].grupos.forEach(x => { (g[x] = g[x] || []).push(k); })); return Object.keys(g).filter(k => !n || k === n).map(k => L(k + ':x:' + (900 + k.length) + ':' + g[k].join(','))); }
  return [L('Unknown database: ' + (db || ''), 'err')];
} });
U.cmd('useradd', { ayuda: T('crea un usuario (useradd -m -s /bin/bash nombre)', 'create a user (useradd -m -s /bin/bash name)'), grupo: T('Usuarios', 'Users'), fn: ctx => {
  const a = ctx.args, n = a.filter((x, i) => x[0] !== '-' && ['-s', '-d', '-G', '-g', '-c', '-u'].indexOf(a[i - 1]) < 0).pop();
  if (!n) return [L('Usage: useradd [options] LOGIN', 'err')];
  const d = U.sinRoot(ctx, ['useradd: Permission denied.', 'useradd: cannot lock /etc/passwd; try again later.']); if (d) return d;
  const us = ctx.h.extra.usuarios;
  if (us[n]) return [L("useradd: user '" + n + "' already exists", 'err')];
  const deb = C.fam(ctx.h) === 'debian', conHome = a.indexOf('-m') >= 0 || a.indexOf('--create-home') >= 0 || (!deb && a.indexOf('-M') < 0);
  const i = a.indexOf('-s'), shell = i >= 0 ? a[i + 1] : (deb ? '/bin/sh' : '/bin/bash');
  const j = a.indexOf('-G'), grupos = [n].concat(j >= 0 ? a[j + 1].split(',') : []);
  us[n] = { uid: 1000 + Object.keys(us).length, home: '/home/' + n, shell, grupos, conHome };
  return [];
} });
U.cmd('userdel', { grupo: T('Usuarios', 'Users'), fn: ctx => {
  const n = ctx.args.filter(x => x[0] !== '-')[0];
  if (!n) return [L('Usage: userdel [options] LOGIN', 'err')];
  const d = U.sinRoot(ctx, ['userdel: Permission denied.', 'userdel: cannot lock /etc/passwd; try again later.']); if (d) return d;
  if (!ctx.h.extra.usuarios[n] || n === 'root' || n === 'admin') return [L("userdel: user '" + n + "' does not exist", 'err')];
  delete ctx.h.extra.usuarios[n];
  return [];
} });
U.cmd('usermod', { fn: ctx => {
  const a = ctx.args, n = a[a.length - 1], x = ctx.h.extra.usuarios[n], i = a.indexOf('-G') >= 0 ? a.indexOf('-G') : a.indexOf('-aG');
  const d = U.sinRoot(ctx, ['usermod: Permission denied.', 'usermod: cannot lock /etc/passwd; try again later.']); if (d) return d;
  if (!x) return [L("usermod: user '" + n + "' does not exist", 'err')];
  if (i >= 0) a[i + 1].split(',').forEach(g => { if (x.grupos.indexOf(g) < 0) x.grupos.push(g); });
  const s = a.indexOf('-s'); if (s >= 0) x.shell = a[s + 1];
  return [];
} });
U.cmd('passwd', { fn: ctx => {
  const n = ctx.args.filter(x => x[0] !== '-')[0] || ctx.ses.usuario || 'admin';
  if (n !== (ctx.ses.usuario || 'admin')) { const d = U.sinRoot(ctx, ['passwd: You may not view or modify password information for ' + n + '.']); if (d) return d; }
  if (!ctx.h.extra.usuarios[n]) return [L("passwd: user '" + n + "' does not exist", 'err')];
  ctx.ses.pendiente = { prompt: 'New password: ', oculto: true, responder: (st, ses) => { ses.pendiente = { prompt: 'Retype new password: ', oculto: true, responder: () => ({ lineas: [L('passwd: password updated successfully')] }) }; return { lineas: [], minutos: 0 }; } };
  return { lineas: [], minutos: 0 };
} });

// sudoers: /etc/sudoers y /etc/sudoers.d/* (sudo ignora los nombres con punto o ~).
const REGLA = /^(%?[\w.-]+)\s+([\w.,-]+)\s*=\s*(?:\(([\w:,\s-]+)\)\s*)?((?:NOPASSWD:|PASSWD:)\s*)?(.+)$/;
C.sudoersFicheros = h => ['/etc/sudoers'].concat(Object.keys(h.extra.conf).filter(p => p.indexOf('/etc/sudoers.d/') === 0 && !/[.~]/.test(p.slice(15))).sort());
C.lineaSudoers = l => { const t = l.trim(); if (!t || t[0] === '#' || /^(Defaults|@include)/.test(t)) return { vacia: true }; const m = REGLA.exec(t); return m ? { quien: m[1], como: m[3] || 'root', nopass: /NOPASSWD/.test(m[4] || ''), cmds: m[5].split(',').map(x => x.trim()) } : { error: true }; };
C.reglasDe = (h, usuario) => {
  const x = h.extra.usuarios[usuario], out = [];
  if (!x) return out;
  C.sudoersFicheros(h).forEach(p => (h.extra.conf[p].lineas || []).forEach(l => { const r = C.lineaSudoers(l); if (r.quien && (r.quien === usuario || (r.quien[0] === '%' && x.grupos.indexOf(r.quien.slice(1)) >= 0))) out.push(r); }));
  return out;
};
const RUTA_CMD = c => /^\//.test(c) ? c : (['systemctl', 'journalctl', 'docker', 'cat', 'tail', 'less', 'ls', 'tee', 'sed', 'cp', 'kill', 'lsof', 'chmod', 'mysql', 'psql', 'needs-restarting', 'dnf', 'apt', 'zypper', 'firewall-cmd', 'nginx', 'su', 'sh', 'bash'].indexOf(c) >= 0 ? (/^(firewall-cmd|nginx)$/.test(c) ? '/usr/sbin/' : '/usr/bin/') + c : '/usr/bin/' + c);
C.permite = (r, argv) => r.cmds.some(c => { if (c === 'ALL') return true; const [ruta, ...args] = c.split(/\s+/); return ruta === RUTA_CMD(argv[0]) && (!args.length || args.join(' ') === argv.slice(1).join(' ')); });
P.puedeSudo = (st, ses, h, argv) => {
  const u = ses.usuario || 'admin';
  if (ses.root || u === 'admin' || !h.extra.usuarios) return null;
  const reglas = C.reglasDe(h, u);
  if (!reglas.length) return [L(u + ' is not in the sudoers file.', 'err')];
  if (reglas.some(r => C.permite(r, argv))) return null;
  return [L('Sorry, user ' + u + " is not allowed to execute '" + RUTA_CMD(argv[0]) + (argv.length > 1 ? ' ' + argv.slice(1).join(' ') : '') + "' as root on " + h.nombre + '.', 'err')];
};
P.sudoLista = (st, ses, h, a) => {
  const i = a.indexOf('-U'), u = i >= 0 ? a[i + 1] : (ses.usuario || 'admin');
  if (i >= 0 && !ses.root && (ses.usuario || 'admin') !== 'admin') return [L('Sorry, user ' + ses.usuario + ' is not allowed to list privileges for ' + u + '.', 'err')];
  if (!h.extra.usuarios[u]) return [L('sudo: unknown user ' + u, 'err')];
  const reglas = C.reglasDe(h, u);
  if (!reglas.length) return [L('User ' + u + ' is not allowed to run sudo on ' + h.nombre + '.')];
  return [L('Matching Defaults entries for ' + u + ' on ' + h.nombre + ':'), L('    env_reset, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin'), L(''), L('User ' + u + ' may run the following commands on ' + h.nombre + ':')]
    .concat(reglas.map(r => L('    (' + (r.como === 'root' ? 'root' : r.como.replace(/:/, ' : ')) + ') ' + (r.nopass ? 'NOPASSWD: ' : '') + r.cmds.join(', '))));
};
U.cmd('visudo', { ayuda: T('edita y valida sudoers (visudo -f /etc/sudoers.d/x · visudo -c)', 'edit and check sudoers (visudo -f /etc/sudoers.d/x · visudo -c)'), grupo: T('Usuarios', 'Users'), fn: ctx => {
  const h = ctx.h, a = ctx.args;
  const d = U.sinRoot(ctx, ['visudo: /etc/sudoers: Permission denied']); if (d) return d;
  if (a.indexOf('-c') >= 0) {
    const out = [];
    let mal = false;
    C.sudoersFicheros(h).concat(Object.keys(h.extra.conf).filter(p => p.indexOf('/etc/sudoers.d/') === 0 && /[.~]/.test(p.slice(15)))).forEach(p => {
      const e = h.extra.conf[p];
      if (e.modo !== '440') { out.push(L(p + ': bad permissions, should be mode 0440', 'err')); mal = true; return; }
      const n = e.lineas.findIndex(l => C.lineaSudoers(l).error);
      if (n >= 0) { out.push(L('>>> ' + p + ': syntax error near line ' + (n + 1) + ' <<<', 'err')); out.push(L('parse error in ' + p + ' near line ' + (n + 1), 'err')); mal = true; return; }
      out.push(L(p + ': parsed OK'));
    });
    return mal ? out : out;
  }
  const i = a.indexOf('-f'), p = i >= 0 ? U.ruta(ctx.ses.cwd, a[i + 1] || '', ctx.ses) : '/etc/sudoers';
  if (p === '/etc/sudoers') return [L(T('(no edites /etc/sudoers: las reglas nuevas van en un fichero propio, visudo -f /etc/sudoers.d/nombre)', '(do not edit /etc/sudoers: new rules go in a file of their own, visudo -f /etc/sudoers.d/name)'), 'dim')];
  ctx.ses.pendiente = { prompt: T('visudo ▸ escribe la línea y pulsa Enter (vacío para cancelar): ', 'visudo ▸ type the line and press Enter (empty to cancel): '), responder: (st, ses, linea) => {
    if (!linea) return { lineas: [L(T('visudo: sin cambios', 'visudo: no changes'), 'dim')], minutos: 0 };
    if (C.lineaSudoers(linea).error) return { lineas: [L('>>> ' + p + ': syntax error near line 1 <<<', 'err'), L(T('visudo no guarda un fichero con errores: así no te quedas sin sudo', 'visudo does not save a file with errors: that way you never lock yourself out of sudo'), 'dim')] };
    const e = h.extra.conf[p];
    if (e) { e.lineas = e.lineas.concat([linea]); e.modo = '440'; } else h.extra.conf[p] = { lineas: [linea], modo: '440', dueno: 'root', grupo: 'root' };
    return { lineas: [] };
  } };
  return { lineas: [L(T('(no hay editor en el simulador: visudo te pide la línea aquí y la valida antes de guardar)', '(there is no editor in the simulator: visudo asks for the line here and checks it before saving)'), 'dim')], minutos: 0 };
} });

// ------------------------------------------------------------------ uname, hostnamectl, ssh
U.cmd('uname', { ayuda: T('versión del kernel (uname -r)', 'kernel version (uname -r)'), fn: ctx => {
  const h = ctx.h, d = C.distro(h);
  if (ctx.args.indexOf('-r') >= 0) return [L(h.kernel)];
  if (ctx.args.indexOf('-a') >= 0) return [L('Linux ' + h.nombre + ' ' + h.kernel + ' #1 SMP PREEMPT_DYNAMIC ' + (d.fam === 'rh' ? 'Thu Sep 12 13:17:26 UTC 2026 x86_64 x86_64 x86_64' : d.fam === 'suse' ? 'Mon Aug 18 08:44:29 UTC 2026 (4f3c2a1) x86_64 x86_64 x86_64' : d.id === 'debian' ? 'Debian 6.1.119-1 (2024-11-22) x86_64' : 'Ubuntu SMP x86_64 x86_64 x86_64') + ' GNU/Linux')];
  return [L('Linux')];
} });
U.cmd('hostnamectl', { ayuda: T('qué sistema es este equipo', 'what system this host is running'), fn: ctx => {
  const h = ctx.h, d = C.distro(h);
  return [L(' Static hostname: ' + h.nombre), L('       Icon name: computer-vm'), L('         Chassis: vm 🖴'), L('Operating System: ' + d.bonito, 'verde'), L('          Kernel: Linux ' + h.kernel), L('    Architecture: x86-64')];
} });
P.alCrear.push(st => { Object.values(st.hosts).forEach(h => { h.extra.contrasenas = h.extra.contrasenas || {}; }); });
const entrarSsh = (ctx, dest, usuario) => {
  const st = ctx.st, h = st.hosts[dest], u = usuario || 'admin', x = h.extra.usuarios[u];
  U.entrar(ctx.ses, dest, x && x.conHome !== false ? x.home : '/', false, u === 'admin' ? undefined : u);
  const out = C.distro(h).banner(h).map(t => L(t, 'dim'));
  if (h.kernelNuevo && C.fam(h) === 'debian') { out.push(L('')); out.push(L('*** System restart required ***', 'ambar')); }
  out.push(L('Last login: ' + U.fechaCorta(st.reloj - 71) + ' from 10.10.0.10'));
  if (x && x.conHome === false) out.push(L('Could not chdir to home directory /home/' + u + ': No such file or directory', 'ambar'));
  return out;
};
U.cmd('ssh', { ayuda: T('entra en otro equipo (ssh web01, ssh usuario@app01)', 'log in to another host (ssh web01, ssh user@app01)'), grupo: T('Acceso', 'Access'), fn: ctx => {
  const arg = (ctx.args.filter((x, i) => x[0] !== '-' && ['-i', '-p', '-l', '-J', '-o'].indexOf(ctx.args[i - 1]) < 0)[0] || '');
  const usuario = arg.indexOf('@') > 0 ? arg.split('@')[0] : null, dest = arg.replace(/^.*@/, '').replace(/\.cpd\.local$/, '');
  if (!dest) return [L('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] destination [command]', 'err')];
  const h = ctx.st.hosts[dest];
  if (!h) return [L('ssh: Could not resolve hostname ' + dest + ': Name or service not known', 'err')];
  if (!h.up) return [L('ssh: connect to host ' + dest + ' port 22: No route to host', 'err')];
  if (h.svcs.ssh && h.svcs.ssh.estado !== 'active') return [L('ssh: connect to host ' + dest + ' port 22: Connection refused', 'err')];
  const u = usuario || 'admin', conClave = u === 'admin' && h.extra.claveMgmt && ctx.ses.host === P.entrada;
  if (conClave) return { lineas: entrarSsh(ctx, dest, u), minutos: 0 };
  if (!C.contrasenaSsh(h)) return [L(u + '@' + dest + ': Permission denied (publickey).', 'err')].concat(u === 'admin' ? [L(T('(' + dest + ' sólo acepta claves y la tuya no está: instálala desde mgmt01 con ssh-copy-id ' + dest + ', o entra por la consola del hipervisor)', '(' + dest + ' only accepts keys and yours is not there: install it from mgmt01 with ssh-copy-id ' + dest + ', or log in through the hypervisor console)'), 'dim')] : []);
  ctx.ses.pendiente = { prompt: u + '@' + dest + "'s password: ", oculto: true, responder: (st, ses) => {
    if (!h.extra.usuarios[u] || (u === 'root' && h.extra.sshd && h.extra.sshd.root !== 'yes')) return { lineas: [L('Permission denied, please try again.', 'err')], minutos: 0 };
    const out = entrarSsh(Object.assign({}, ctx, { ses }), dest, u);
    if (u === 'root') { ses.root = true; st.hechos['rootSsh:' + dest] = true; }
    return { lineas: out, minutos: 0 };
  } };
  return { lineas: [], minutos: 0 };
} });
// ¿Acepta contraseña? Lo dice sshd_config (la línea base de seguridad la quita).
C.contrasenaSsh = h => !(h.extra.conf['/etc/ssh/sshd_config'] && h.extra.conf['/etc/ssh/sshd_config'].lineas.some(l => /^PasswordAuthentication\s+no/.test(l)) && h.extra.sshdCargado !== false);
U.cmd('ssh-copy-id', { ayuda: T('instala tu clave pública en otro equipo', 'install your public key on another host'), grupo: T('Acceso', 'Access'), fn: ctx => {
  const dest = (ctx.args.filter(x => x[0] !== '-').pop() || '').replace(/^.*@/, ''), h = ctx.st.hosts[dest];
  if (!dest) return [L('Usage: /usr/bin/ssh-copy-id [-h|-?|-f|-n|-s|-x] [-i [identity_file]] [-p port] [-F alternative ssh_config file] [-t target_path] [[-o <ssh -o options>] ...] [user@]hostname', 'err')];
  if (ctx.ses.host !== P.entrada) return [L(T('(tu clave está en mgmt01: lánzalo desde allí)', '(your key lives on mgmt01: run it from there)'), 'dim')];
  if (!h) return [L('ssh: Could not resolve hostname ' + dest + ': Name or service not known', 'err')];
  if (!h.up) return [L('ssh: connect to host ' + dest + ' port 22: No route to host', 'err')];
  const cab = [L('/usr/bin/ssh-copy-id: INFO: Source of key(s) to be installed: "/home/admin/.ssh/id_ed25519.pub"'), L('/usr/bin/ssh-copy-id: INFO: attempting to log in with the new key(s), to filter out any that are already installed')];
  if (h.extra.claveMgmt) return cab.concat([L(''), L('/usr/bin/ssh-copy-id: WARNING: All keys were skipped because they already exist on the remote system.'), L('\t\t(if you think this is a mistake, you may want to use -f option)')]);
  if (!C.contrasenaSsh(h)) return cab.concat([L('admin@' + dest + ': Permission denied (publickey).', 'err')]);
  ctx.ses.pendiente = { prompt: 'admin@' + dest + "'s password: ", oculto: true, responder: () => { h.extra.claveMgmt = true; return { lineas: [L(''), L('Number of key(s) added: 1'), L(''), L('Now try logging into the machine, with:   "ssh \'' + dest + '\'"'), L('and check to make sure that only the key(s) you wanted were added.')] }; } };
  return { lineas: cab.concat([L('/usr/bin/ssh-copy-id: INFO: 1 key(s) remain to be installed -- if you are prompted now it is to install the new keys')]), minutos: 0 };
} });

// ------------------------------------------------------------------ paquetes
// Cada actualización: { n, de, a, sec, kernel }. Instalar un kernel deja h.kernelNuevo:
// el motor lo aplica al reiniciar y avisa con NodeRebootRequired.
C.instalar = (st, h, lista) => {
  lista.forEach(p => { if (p.kernel) h.kernelNuevo = p.kernelNuevo; });
  h.extra.pk.act = h.extra.pk.act.filter(p => lista.indexOf(p) < 0);
  h.extra.pk.historial.push({ min: st.reloj, n: lista.length, cmd: '' });
};
const sinRootPk = (ctx, msg) => U.sinRoot(ctx, msg);
U.cmd('dnf', { ayuda: T('paquetes en Rocky/RHEL: check-update · updateinfo list --security · upgrade --security', 'packages on Rocky/RHEL: check-update · updateinfo list --security · upgrade --security'), grupo: T('Paquetes', 'Packages'), donde: C.hostsDe('rh'), fuera: T('(dnf es de la familia Red Hat; aquí mira con hostnamectl qué sistema hay: apt en Debian/Ubuntu, zypper en SUSE)', '(dnf belongs to the Red Hat family; check with hostnamectl what runs here: apt on Debian/Ubuntu, zypper on SUSE)'), fn: ctx => dnf(ctx) });
P.comandos.yum = P.comandos.dnf;
function dnf(ctx) {
  const h = ctx.h, a = ctx.args, sub = a.find(x => x[0] !== '-') || '', act = h.extra.pk.act, sec = act.filter(p => p.sec);
  const meta = L('Last metadata expiration check: 0:41:12 ago on ' + U.fechaCorta(ctx.st.reloj - 41) + '.');
  if (sub === 'check-update') return { lineas: [meta, L('')].concat(act.map(p => L(p.n.padEnd(38) + p.a.padEnd(36) + (p.repo || 'baseos'), 'verde'))), fallo: false };
  if (sub === 'updateinfo') {
    const lista = a.indexOf('--security') >= 0 || a.indexOf('sec') >= 0 ? sec : act.filter(p => p.aviso);
    if (a.indexOf('list') < 0) return [meta, L('Updates Information Summary: available'), L('    ' + sec.length + ' Security notice(s)'), L('        ' + sec.filter(p => p.imp === 'Important').length + ' Important Security notice(s)')];
    return [meta].concat(lista.map(p => L((p.aviso || 'RLBA-2026:7001').padEnd(16) + ' ' + ((p.imp || 'bugfix') + (p.sec ? '/Sec.' : '')).padEnd(15) + ' ' + p.n + '-' + p.a, 'verde')));
  }
  if (['upgrade', 'update'].indexOf(sub) >= 0) {
    const d = sinRootPk(ctx, ['Error: This command has to be run with superuser privileges (under the root user on most systems).']); if (d) return d;
    const lista = a.indexOf('--security') >= 0 ? sec : act;
    if (!lista.length) return [meta, L('Dependencies resolved.'), L('Nothing to do.'), L('Complete!')];
    const cab = [meta, L('Dependencies resolved.'), L('================================================================================'), L(' Package                  Arch       Version                       Repository   Size'), L('================================================================================'), L(lista.some(p => p.kernel) ? 'Installing:' : 'Upgrading:')]
      .concat(lista.map(p => L(' ' + p.n.padEnd(24) + ' x86_64     ' + p.a.padEnd(29) + ' ' + (p.repo || 'baseos').padEnd(12) + ' ' + (p.mb || 2.1) + ' M'))).concat([L(''), L('Transaction Summary'), L('================================================================================')]).concat(lista.some(p => p.kernel) ? [L('Install  1 Package'), L('Upgrade  ' + (lista.length - 1) + ' Packages')] : [L('Upgrade  ' + lista.length + ' Packages')]);
    const hacer = () => { C.instalar(ctx.st, h, lista); return lista.map(p => L('  Upgrading        : ' + p.n + '-' + p.a)).concat([L('  Running scriptlet: ' + lista[lista.length - 1].n), L('Complete!', 'verde')]); };
    if (a.indexOf('-y') >= 0 || a.indexOf('--assumeyes') >= 0) return { lineas: cab.concat(hacer()), minutos: 3 };
    ctx.ses.pendiente = { prompt: 'Is this ok [y/N]: ', responder: (st, ses, r) => /^y(es)?$/i.test(r) ? { lineas: hacer(), minutos: 3 } : { lineas: [L('Operation aborted.')] } };
    return { lineas: cab, minutos: 0 };
  }
  if (sub === 'history') return [L('ID     | Command line             | Date and time    | Action(s)      | Altered'), L('-------------------------------------------------------------------------------')].concat(h.extra.pk.historial.slice().reverse().map((x, i) => L(String(h.extra.pk.historial.length - i + 41).padEnd(6) + ' | upgrade                  | ' + U.iso(x.min).replace('T', ' ').slice(0, 16) + ' | Upgrade        | ' + String(x.n).padStart(7)))).concat([L('41     | update                   | 2026-08-12 03:10 | I, U           |      14')]);
  if (sub === 'install' || sub === 'remove') return [L(T('(en el CPD el software de cada servidor lo instala su rol de Ansible: aquí sólo se parchea)', '(in this datacenter each server\'s software is installed by its Ansible role: here you only patch)'), 'dim')];
  return [L('usage: dnf [options] COMMAND'), L('check-update · updateinfo · upgrade · history')];
}
U.cmd('needs-restarting', { ayuda: T('¿hace falta reiniciar? (needs-restarting -r)', 'is a reboot needed? (needs-restarting -r)'), grupo: T('Paquetes', 'Packages'), donde: C.hostsDe('rh'), fuera: T('(needs-restarting es de Rocky/RHEL; en Debian/Ubuntu mira /var/run/reboot-required, en SUSE zypper needs-rebooting)', '(needs-restarting belongs to Rocky/RHEL; on Debian/Ubuntu look at /var/run/reboot-required, on SUSE zypper needs-rebooting)'), fn: ctx => ctx.h.kernelNuevo
  ? [L('Core libraries or services have been updated since boot-up:'), L('  * kernel'), L(''), L('Reboot is required to fully utilize these updates.', 'ambar'), L('More information: https://access.redhat.com/solutions/27943')]
  : [L('No core libraries or services have been updated since boot-up.'), L('Reboot should not be necessary.')] });

function apt(ctx) {
  const h = ctx.h, a = ctx.args, sub = a.find(x => x[0] !== '-') || '', act = h.extra.pk.act, pk = h.extra.pk, get = ctx.nombre === 'apt-get';
  const d = U.sinRoot(ctx, ['E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)', 'E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?']);
  const deb = C.distro(h).id === 'debian', cod = deb ? 'bookworm' : 'jammy';
  if (sub === 'update') {
    if (d) return d;
    pk.refrescado = true;
    return [L('Hit:1 http://' + (deb ? 'deb.debian.org/debian ' + cod : 'archive.ubuntu.com/ubuntu ' + cod) + ' InRelease'), L('Get:2 http://' + (deb ? 'security.debian.org/debian-security ' + cod + '-security' : 'security.ubuntu.com/ubuntu ' + cod + '-security') + ' InRelease [48.0 kB]'), L('Fetched 48.0 kB in 1s (61.2 kB/s)'), L('Reading package lists... Done'), L('Building dependency tree... Done'), L('Reading state information... Done'), L(act.length ? act.length + " packages can be upgraded. Run 'apt list --upgradable' to see them." : 'All packages are up to date.')];
  }
  if (sub === 'list') {
    if (a.indexOf('--upgradable') < 0) return [L('Listing... Done')];
    return [L('Listing... Done')].concat(pk.refrescado ? act.map(p => L(p.n + '/' + cod + '-security ' + p.a + ' amd64 [upgradable from: ' + p.de + ']', 'verde')) : []);
  }
  if (['upgrade', 'full-upgrade', 'dist-upgrade'].indexOf(sub) >= 0) {
    if (d) return d;
    const visibles = pk.refrescado ? act : [];
    // apt-get upgrade no instala paquetes nuevos: un kernel nuevo se queda «kept back».
    const retenidos = get && sub === 'upgrade' ? visibles.filter(p => p.kernel) : [];
    const lista = visibles.filter(p => retenidos.indexOf(p) < 0);
    const cab = [L('Reading package lists... Done'), L('Building dependency tree... Done'), L('Reading state information... Done'), L('Calculating upgrade... Done')];
    if (retenidos.length) { cab.push(L('The following packages have been kept back:', 'ambar')); cab.push(L('  ' + retenidos.map(p => p.n).join(' '), 'ambar')); }
    if (!lista.length) return cab.concat([L('0 upgraded, 0 newly installed, 0 to remove and ' + retenidos.length + ' not upgraded.')]);
    const nuevos = lista.filter(p => p.kernel);
    if (nuevos.length) { cab.push(L('The following NEW packages will be installed:')); cab.push(L('  ' + nuevos.map(p => p.paquete || ('linux-image-' + p.kernelNuevo)).join(' '))); }
    cab.push(L('The following packages will be upgraded:')); cab.push(L('  ' + lista.map(p => p.n).join(' ')));
    cab.push(L(lista.length + ' upgraded, ' + nuevos.length + ' newly installed, 0 to remove and ' + retenidos.length + ' not upgraded.'));
    const hacer = () => { C.instalar(ctx.st, h, lista); return lista.map(p => L('Setting up ' + p.n + ' (' + p.a + ') ...')).concat(nuevos.length ? [L('Processing triggers for initramfs-tools ...'), L('update-initramfs: Generating /boot/initrd.img-' + nuevos[0].kernelNuevo)] : []); };
    if (a.indexOf('-y') >= 0 || a.indexOf('--yes') >= 0) return { lineas: cab.concat(hacer()), minutos: 3 };
    ctx.ses.pendiente = { prompt: 'Do you want to continue? [Y/n] ', responder: (st, ses, r) => (r === '' || /^y(es)?$/i.test(r)) ? { lineas: hacer(), minutos: 3 } : { lineas: [L('Abort.')] } };
    return { lineas: cab, minutos: 0 };
  }
  if (sub === 'install' || sub === 'remove' || sub === 'purge') return [L(T('(en el CPD el software de cada servidor lo instala su rol de Ansible: aquí sólo se parchea)', '(in this datacenter each server\'s software is installed by its Ansible role: here you only patch)'), 'dim')];
  return [L('apt 2.6.1 (amd64)'), L('Usage: apt [options] command')];
}
const FUERA_APT = T('(apt es de Debian/Ubuntu; aquí mira con hostnamectl qué sistema hay: dnf en Rocky, zypper en SUSE)', '(apt belongs to Debian/Ubuntu; check with hostnamectl what runs here: dnf on Rocky, zypper on SUSE)');
U.cmd('apt', { ayuda: T('paquetes en Debian/Ubuntu: update · list --upgradable · upgrade', 'packages on Debian/Ubuntu: update · list --upgradable · upgrade'), grupo: T('Paquetes', 'Packages'), donde: C.hostsDe('debian'), fuera: FUERA_APT, fn: apt });
U.cmd('apt-get', { donde: C.hostsDe('debian'), fuera: FUERA_APT, fn: apt });
U.cmd('zypper', { ayuda: T('paquetes en SUSE: refresh · list-patches · patch', 'packages on SUSE: refresh · list-patches · patch'), grupo: T('Paquetes', 'Packages'), donde: C.hostsDe('suse'), fuera: T('(zypper es de SUSE; aquí mira con hostnamectl qué sistema hay)', '(zypper belongs to SUSE; check with hostnamectl what runs here)'), fn: ctx => {
  const h = ctx.h, a = ctx.args, sub = a.find(x => x[0] !== '-') || '', act = h.extra.pk.act;
  const d = U.sinRoot(ctx, ['Root privileges are required to run this command.']);
  if (sub === 'refresh' || sub === 'ref') { if (d) return d; h.extra.pk.refrescado = true; return [L("Repository 'SLE-Module-Basesystem15-SP5-Updates' is up to date."), L("Repository 'SLE-Product-SLES15-SP5-Updates' is up to date."), L('All repositories have been refreshed.')]; }
  if (['list-updates', 'lu', 'list-patches', 'lp'].indexOf(sub) >= 0) return [L('Loading repository data...'), L('Reading installed packages...')].concat(act.length ? act.map(p => L('SUSE-SLE-Module-Basesystem-15-SP5-2026-' + (3000 + p.n.length) + ' | security | ' + (p.imp || 'important') + ' | ' + p.n, 'verde')) : [L('No updates found.')]);
  if (sub === 'needs-rebooting') return h.kernelNuevo ? [L('Core libraries or services have been updated.'), L('Reboot is required to ensure that your system benefits from these updates.', 'ambar')] : [L('No core libraries or services have been updated since boot-up.'), L('Reboot should not be necessary.')];
  if (['patch', 'update', 'up'].indexOf(sub) >= 0) { if (d) return d; if (!act.length) return [L('Nothing to do.')]; const l = act.slice(); C.instalar(ctx.st, h, l); return { lineas: [L('Loading repository data...'), L('Resolving package dependencies...')].concat(l.map(p => L('(' + (l.indexOf(p) + 1) + '/' + l.length + ') Installing: ' + p.n + '-' + p.a + ' ....[done]'))), minutos: 3 }; }
  return [L('Usage: zypper [--global-options] <command> [--command-options] [arguments]')];
} });

// ------------------------------------------------------------------ SELinux (familia Red Hat)
// Una etiqueta por ruta: la que dice la política (más las reglas de semanage
// fcontext), o la que alguien puso con chcon. restorecon vuelve a la política.
const POLITICA = [
  [/^\/var\/www(\/.*)?$/, 'httpd_sys_content_t'], [/^\/var\/log\/(nginx|httpd)(\/.*)?$/, 'httpd_log_t'], [/^\/etc\/nginx(\/.*)?$/, 'httpd_config_t'],
  [/^\/etc\/httpd(\/.*)?$/, 'httpd_config_t'], [/^\/srv(\/.*)?$/, 'var_t'], [/^\/home\/[^/]+(\/.*)?$/, 'user_home_t'], [/^\/etc(\/.*)?$/, 'etc_t'],
  [/^\/var\/lib\/mysql(\/.*)?$/, 'mysqld_db_t'], [/^\/backup(\/.*)?$/, 'default_t'], [/^\/tmp(\/.*)?$/, 'tmp_t'], [/^\/var\/log(\/.*)?$/, 'var_log_t'], [/./, 'default_t'],
];
C.crearSelinux = h => { h.extra.se = { modo: 'enforcing', config: 'enforcing', bools: { httpd_can_network_connect: { v: false, p: false }, httpd_can_network_connect_db: { v: false, p: false } }, fcontext: [], etiquetas: {}, avc: [] }; };
C.politica = (h, p) => {
  const reglas = (h.extra.se.fcontext || []).slice().reverse();
  for (const r of reglas) { try { if (new RegExp('^' + r.re + '$').test(p)) return r.tipo; } catch (e) { /* regla rara: se ignora */ } }
  return POLITICA.find(x => x[0].test(p))[1];
};
C.tipo = (h, p) => h.extra.se.etiquetas[p] || C.politica(h, p);
C.congelarEtiquetas = (st, h) => { const fs = P.vfs(st, h); Object.keys(fs.f).concat(Object.keys(fs.dirs)).forEach(p => { if (!h.extra.se.etiquetas[p]) h.extra.se.etiquetas[p] = C.politica(h, p); }); };
C.etiqueta = (h, p) => (/^\/home\//.test(p) ? 'unconfined_u' : 'system_u') + ':object_r:' + C.tipo(h, p) + ':s0';
C.enforcing = h => !!(h.extra.se && h.extra.se.modo === 'enforcing');
C.bool = (h, b) => !!(h.extra.se && h.extra.se.bools[b] && h.extra.se.bools[b].v);
// Lo que SELinux le niega a un servicio queda en el log de auditoría.
C.avc = (st, h, permiso, comm, extra, tcontext, tclass) => {
  const se = h.extra.se, id = 1700000000 + st.reloj * 7 + se.avc.length;
  const linea = 'type=AVC msg=audit(' + id + '.' + String(412 + se.avc.length).padStart(3, '0') + ':' + (2000 + se.avc.length) + '): avc:  denied  { ' + permiso + ' } for  pid=' + U.pid(h.nombre + comm) + ' comm="' + comm + '" ' + extra + ' scontext=system_u:system_r:httpd_t:s0 tcontext=' + tcontext + ' tclass=' + tclass + ' permissive=' + (C.enforcing(h) ? 0 : 1);
  if (!se.avc.length || se.avc[se.avc.length - 1].t !== linea.replace(/audit\([^)]*\)/, '')) se.avc.push({ min: st.reloj, t: linea.replace(/audit\([^)]*\)/, ''), linea });
  if (se.avc.length > 40) se.avc.shift();
};
const SE_DONDE = C.hostsDe('rh'), SE_FUERA = T('(SELinux está en la familia Red Hat: Rocky, RHEL. Este equipo no lo usa)', '(SELinux lives in the Red Hat family: Rocky, RHEL. This host does not use it)');
const seCmd = (n, ayuda, fn) => U.cmd(n, { ayuda, grupo: 'SELinux', donde: SE_DONDE, fuera: SE_FUERA, fn });
seCmd('getenforce', T('modo de SELinux ahora mismo', 'current SELinux mode'), ctx => ({ lineas: [L(ctx.h.extra.se.modo[0].toUpperCase() + ctx.h.extra.se.modo.slice(1), C.enforcing(ctx.h) ? 'verde' : 'ambar')], minutos: 0 }));
seCmd('setenforce', T('cambia el modo hasta el próximo arranque (1 enforcing, 0 permissive)', 'change the mode until the next boot (1 enforcing, 0 permissive)'), ctx => {
  const v = ctx.args[0], d = U.sinRoot(ctx, ['setenforce:  setenforce() failed']); if (d) return d;
  if (['0', '1', 'Permissive', 'Enforcing', 'permissive', 'enforcing'].indexOf(v) < 0) return [L('usage:  setenforce [ Enforcing | Permissive | 1 | 0 ]', 'err')];
  ctx.h.extra.se.modo = /^(1|enforcing)$/i.test(v) ? 'enforcing' : 'permissive';
  return [];
});
seCmd('sestatus', T('estado completo de SELinux', 'full SELinux status'), ctx => { const se = ctx.h.extra.se; return [L('SELinux status:                 enabled'), L('SELinuxfs mount:                /sys/fs/selinux'), L('Loaded policy name:             targeted'), L('Current mode:                   ' + se.modo, se.modo === 'enforcing' ? 'verde' : 'ambar'), L('Mode from config file:          ' + se.config), L('Policy MLS status:              enabled'), L('Max kernel policy version:      33')]; });
seCmd('getsebool', T('valor de un booleano (getsebool httpd_can_network_connect)', 'value of a boolean (getsebool httpd_can_network_connect)'), ctx => {
  const se = ctx.h.extra.se, n = ctx.args.filter(x => x[0] !== '-');
  const lista = ctx.args.indexOf('-a') >= 0 ? Object.keys(se.bools) : n;
  if (!lista.length) return [L('usage:  getsebool -a or getsebool boolean...', 'err')];
  return lista.map(b => se.bools[b] ? L(b + ' --> ' + (se.bools[b].v ? 'on' : 'off'), se.bools[b].v ? 'verde' : 'out') : L('Error getting active value for ' + b, 'err'));
});
seCmd('setsebool', T('cambia un booleano (-P lo hace persistente)', 'change a boolean (-P makes it persistent)'), ctx => {
  const se = ctx.h.extra.se, per = ctx.args.indexOf('-P') >= 0, [b, v] = ctx.args.filter(x => x[0] !== '-');
  if (!b || v == null) return [L('usage:  setsebool [ -NPV ] boolean value | bool1=val1 bool2=val2 ...', 'err')];
  const d = U.sinRoot(ctx, ['Could not change active booleans. Please try as root: Permission denied']); if (d) return d;
  if (!se.bools[b]) return [L('Boolean ' + b + ' is not defined', 'err')];
  const on = /^(1|on|true)$/i.test(v);
  se.bools[b].v = on; if (per) se.bools[b].p = on;
  return { lineas: [], minutos: per ? 1 : 1 };
});
seCmd('semanage', T('reglas persistentes: semanage fcontext -a -t tipo "ruta(/.*)?"', 'persistent rules: semanage fcontext -a -t type "path(/.*)?"'), ctx => {
  const se = ctx.h.extra.se, a = ctx.args, sub = a[0];
  if (sub === 'fcontext') {
    if (a.indexOf('-l') >= 0) return (a.indexOf('-C') >= 0 ? [L('SELinux fcontext                                   type               Context'), L('')] : [L('SELinux fcontext                                   type               Context')]).concat(se.fcontext.map(r => L(r.re.padEnd(50) + ' all files          system_u:object_r:' + r.tipo + ':s0'))).concat(a.indexOf('-C') >= 0 || se.fcontext.length ? [] : [L('/srv(/.*)?                                         all files          system_u:object_r:var_t:s0'), L('/var/www(/.*)?                                     all files          system_u:object_r:httpd_sys_content_t:s0')]);
    const d = U.sinRoot(ctx, ['ValueError: SELinux policy is not managed or store cannot be accessed.']); if (d) return d;
    const i = a.indexOf('-t'), re = a[a.length - 1];
    if ((a.indexOf('-a') < 0 && a.indexOf('-m') < 0 && a.indexOf('-d') < 0) || (a.indexOf('-d') < 0 && i < 0) || !re || re[0] !== '/') return [L('usage: semanage fcontext [-h] [-n] [-N] [-S STORE] [ --add ( -t TYPE -f FTYPE -r RANGE -s SEUSER | -e EQUAL ) FILE_SPEC ]', 'err')];
    // Cambiar la política no reetiqueta nada: los ficheros conservan la etiqueta que tienen hasta un restorecon.
    C.congelarEtiquetas(ctx.st, ctx.h);
    if (a.indexOf('-d') >= 0) { se.fcontext = se.fcontext.filter(r => r.re !== re); return { lineas: [], minutos: 1 }; }
    if (a.indexOf('-a') >= 0 && se.fcontext.some(r => r.re === re)) return [L('ValueError: File context for ' + re + ' already defined', 'err')];
    se.fcontext = se.fcontext.filter(r => r.re !== re).concat([{ re, tipo: a[i + 1] }]);
    return { lineas: [], minutos: 1 };
  }
  if (sub === 'boolean' && a.indexOf('-l') >= 0) return Object.keys(se.bools).map(b => L(b.padEnd(34) + ' (' + (se.bools[b].v ? 'on ' : 'off') + '  ,  ' + (se.bools[b].p ? 'on ' : 'off') + ')'));
  if (sub === 'port' && a.indexOf('-l') >= 0) return [L('http_port_t                    tcp      80, 81, 443, 488, 8008, 8009, 8443, 9000'), L('http_cache_port_t              tcp      8080, 8118, 8123, 10001-10010'), L('mysqld_port_t                  tcp      1186, 3306, 63132-63164'), L('postgresql_port_t              tcp      5432, 9898')];
  return [L('usage: semanage [-h] {import,export,login,user,port,boolean,fcontext,...} ...', 'err')];
});
const relabel = (ctx, fn) => {
  const fs = P.vfs(ctx.st, ctx.h), a = ctx.args, rec = a.some(x => /^-[a-zA-Z]*R/.test(x)), vb = a.some(x => /^-[a-zA-Z]*v/.test(x));
  const rutas = a.filter((x, i) => x[0] !== '-' && a[i - 1] !== '-t');
  const out = [];
  rutas.forEach(r => {
    const base = U.ruta(ctx.ses.cwd, r, ctx.ses);
    const todas = [base].concat(rec ? Object.keys(fs.f).concat(Object.keys(fs.dirs)).filter(p => p.indexOf(base + '/') === 0).sort() : []);
    todas.forEach(p => { const antes = C.etiqueta(ctx.h, p); fn(p); const ahora = C.etiqueta(ctx.h, p); if (vb && antes !== ahora) out.push(L('Relabeled ' + p + ' from ' + antes + ' to ' + ahora)); });
  });
  return out;
};
seCmd('restorecon', T('devuelve las etiquetas a lo que dice la política (restorecon -Rv ruta)', 'reset labels to what the policy says (restorecon -Rv path)'), ctx => {
  const d = U.sinRoot(ctx, ['restorecon: Could not set context for ' + (ctx.args.filter(x => x[0] !== '-')[0] || '') + ':  Permission denied']); if (d) return d;
  return relabel(ctx, p => { delete ctx.h.extra.se.etiquetas[p]; });
});
seCmd('chcon', T('cambia una etiqueta a mano (se pierde con restorecon)', 'change a label by hand (lost on restorecon)'), ctx => {
  const a = ctx.args, i = a.indexOf('-t'); if (i < 0) return [L('chcon: missing operand', 'err')];
  const d = U.sinRoot(ctx, ['chcon: failed to change context: Operation not permitted']); if (d) return d;
  return relabel(ctx, p => { ctx.h.extra.se.etiquetas[p] = a[i + 1]; });
});
seCmd('matchpathcon', T('qué etiqueta le daría la política a una ruta', 'which label the policy would give a path'), ctx => ctx.args.filter(x => x[0] !== '-').map(r => { const p = U.ruta(ctx.ses.cwd, r, ctx.ses); return L(p + '\tsystem_u:object_r:' + C.politica(ctx.h, p) + ':s0'); }));
seCmd('ausearch', T('lo que SELinux ha denegado (ausearch -m avc -ts recent)', 'what SELinux has denied (ausearch -m avc -ts recent)'), ctx => {
  const d = U.sinRoot(ctx, ['Error opening config file (Permission denied)', 'NOTE - using built-in logs: /var/log/audit/audit.log', 'Error opening /var/log/audit/audit.log (Permission denied)']); if (d) return d;
  const reciente = ctx.args.indexOf('recent') >= 0, av = ctx.h.extra.se.avc.filter(x => !reciente || ctx.st.reloj - x.min <= 10);
  if (!av.length) return [L('<no matches>')];
  return [].concat(...av.map(x => [L('----'), L('time->' + U.fechaCorta(x.min)), L(x.linea, 'rojo')]));
});

// ------------------------------------------------------------------ firewalld (Red Hat y SUSE)
// Dos configuraciones: la que está en marcha (runtime) y la guardada (permanent).
// --permanent sólo toca la guardada; --reload carga la guardada en runtime.
const SERV = { ssh: [22], http: [80], https: [443], postgresql: [5432], mysql: [3306], cockpit: [9090], 'dhcpv6-client': [] };
C.crearFirewall = h => { const z = { servicios: ['cockpit', 'dhcpv6-client', 'ssh'], puertos: [], ricas: [] }; h.extra.fw = { runtime: z, perm: JSON.parse(JSON.stringify(z)) }; };
C.fwAbre = (h, servicios, puertos) => { ['runtime', 'perm'].forEach(k => { const z = h.extra.fw[k]; servicios.forEach(s => { if (z.servicios.indexOf(s) < 0) z.servicios.push(s); }); puertos.forEach(p => { if (z.puertos.indexOf(p) < 0) z.puertos.push(p); }); }); };
// ¿Deja entrar a ese puerto desde esa IP? (desde el propio equipo, siempre).
C.fwPermite = (st, h, puerto, ipOrigen) => {
  if (!h.extra.fw || !h.svcs.firewalld || h.svcs.firewalld.estado !== 'active') return true;
  if (ipOrigen === h.ip || ipOrigen === '127.0.0.1') return true;
  const z = h.extra.fw.runtime;
  if (z.puertos.indexOf(puerto + '/tcp') >= 0) return true;
  if (z.servicios.some(s => (SERV[s] || []).indexOf(puerto) >= 0)) return true;
  return z.ricas.some(r => { const m = /source address="([\d./]+)".*port port="(\d+)"/.exec(r); return m && +m[2] === puerto && (m[1] === ipOrigen || m[1] === ipOrigen + '/32' || (/\/24$/.test(m[1]) && ipOrigen.indexOf(m[1].replace(/\.\d+\/24$/, '.')) === 0)) && /accept/.test(r); });
};
U.cmd('firewall-cmd', { ayuda: T('el cortafuegos: --list-all · --permanent --add-port=9100/tcp · --reload', 'the firewall: --list-all · --permanent --add-port=9100/tcp · --reload'), grupo: T('Red', 'Network'), donde: C.hostsDe('rh').concat(C.hostsDe('suse')), fuera: T('(firewalld es de Rocky/RHEL y SUSE; este equipo no lo usa)', '(firewalld belongs to Rocky/RHEL and SUSE; this host does not use it)'), fn: ctx => {
  const h = ctx.h, a = ctx.args, fw = h.extra.fw, act = h.svcs.firewalld && h.svcs.firewalld.estado === 'active';
  if (a.indexOf('--state') >= 0) return [L(act ? 'running' : 'not running', act ? 'verde' : 'err')];
  if (!act) return [L('FirewallD is not running', 'err')];
  const per = a.indexOf('--permanent') >= 0, z = per ? fw.perm : fw.runtime;
  const lst = x => x.join(' ');
  if (a.indexOf('--list-all') >= 0) return [L('public (active)'), L('  target: default'), L('  icmp-block-inversion: no'), L('  interfaces: eth0'), L('  sources: '), L('  services: ' + lst(z.servicios)), L('  ports: ' + lst(z.puertos)), L('  protocols: '), L('  forward: yes'), L('  masquerade: no'), L('  forward-ports: '), L('  source-ports: '), L('  icmp-blocks: '), L('  rich rules: ')].concat(z.ricas.map(r => L('\t' + r)));
  if (a.indexOf('--list-ports') >= 0) return [L(lst(z.puertos))];
  if (a.indexOf('--list-services') >= 0) return [L(lst(z.servicios))];
  if (a.indexOf('--get-active-zones') >= 0) return [L('public'), L('  interfaces: eth0')];
  const d = U.sinRoot(ctx, ['Authorization failed.', '    Make sure polkit agent is running or run the application as superuser.']); if (d) return d;
  if (a.indexOf('--reload') >= 0) { fw.runtime = JSON.parse(JSON.stringify(fw.perm)); return [L('success')]; }
  if (a.indexOf('--runtime-to-permanent') >= 0) { fw.perm = JSON.parse(JSON.stringify(fw.runtime)); return [L('success')]; }
  const out = [];
  a.forEach(x => {
    let m;
    if ((m = /^--(add|remove)-port=(\d+\/(tcp|udp))$/.exec(x))) { const i = z.puertos.indexOf(m[2]); if (m[1] === 'add') { if (i >= 0) out.push(L('Warning: ALREADY_ENABLED: ' + m[2], 'ambar')); else z.puertos.push(m[2]); } else if (i >= 0) z.puertos.splice(i, 1); else out.push(L('Warning: NOT_ENABLED: ' + m[2], 'ambar')); }
    else if ((m = /^--(add|remove)-service=([\w-]+)$/.exec(x))) { if (!SERV[m[2]]) { out.push(L('Error: INVALID_SERVICE: ' + m[2], 'err')); return; } const i = z.servicios.indexOf(m[2]); if (m[1] === 'add') { if (i >= 0) out.push(L('Warning: ALREADY_ENABLED: ' + m[2], 'ambar')); else z.servicios.push(m[2]); } else if (i >= 0) z.servicios.splice(i, 1); }
    else if ((m = /^--(add|remove)-rich-rule=(.+)$/.exec(x))) { if (m[1] === 'add') z.ricas.push(m[2]); else z.ricas = z.ricas.filter(r => r !== m[2]); }
  });
  if (!out.some(l => l.c === 'err') && a.some(x => /^--(add|remove)-/.test(x))) out.push(L('success'));
  return out.length ? out : [L(T('(en el simulador: --list-all, --add-port, --add-service, --add-rich-rule, --remove-..., --permanent, --reload)', '(in the simulator: --list-all, --add-port, --add-service, --add-rich-rule, --remove-..., --permanent, --reload)'), 'dim')];
} });

// Lo que vuelve tras un reinicio: SELinux, booleanos y firewall, tal como estén guardados.
P.alVolver.push((st, h) => {
  if (h.extra.se) { h.extra.se.modo = h.extra.se.config; Object.keys(h.extra.se.bools).forEach(b => { h.extra.se.bools[b].v = h.extra.se.bools[b].p; }); }
  if (h.extra.fw) h.extra.fw.runtime = JSON.parse(JSON.stringify(h.extra.fw.perm));
});
P.alArrancar.push((st, h, u) => { if (u === 'firewalld' && h.extra.fw) h.extra.fw.runtime = JSON.parse(JSON.stringify(h.extra.fw.perm)); });
})(window.PUESTO = window.PUESTO || {});
