// Puesto CPD · fase 2: discos, accesos y copias.
//
//   · LVM en web01: disco → PV → VG → LV → sistema de ficheros. lvextend sin
//     sitio en el grupo falla; un LV más grande no agranda el XFS hasta
//     xfs_growfs (o lvextend -r).
//   · sshd: la configuración que vale es la cargada (al arrancar o con
//     reload), no la del fichero. Quitar las contraseñas antes de tener tu
//     clave en el servidor te deja fuera: queda la consola del hipervisor.
//   · MariaDB en db02 y su copia nocturna: un fichero de opciones donde # abre
//     un comentario, y un script que dice «OK» aunque mysqldump haya fallado.
//   · Informes de ACME (Tomcat en app01) contra PostgreSQL en db01.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, C = P.cpd;

// Un fichero de 20 bytes se ve como 20, no como 0.1K.
const tamMotor = U.tam;
U.tam = mb => mb > 0 && mb * 1024 < 1 ? String(Math.round(mb * 1048576)) : tamMotor(mb);

// ------------------------------------------------------------------ informes
C.apps.splice(C.apps.findIndex(a => a.id === 'pedidos') + 1, 0, { id: 'informes', cliente: 'ACME', nombre: T('Informes', 'Reports'), host: 'app01', pila: 'Tomcat → PostgreSQL', informes: true });
const saludBase = C.salud;
C.salud = (st, a) => {
  if (a.informes) {
    const app = st.hosts.app01, db = st.hosts.db01;
    if (!app.up || app.svcs.tomcat.estado !== 'active') return { ok: false, corto: 'down', msg: T('el Tomcat de informes no está en marcha', 'the reports Tomcat is not running') };
    if (!db.up || db.svcs.postgresql.estado !== 'active') return { ok: false, corto: 'db down', msg: 'PostgreSQL down' };
    return C.pgPermite(st, app.ip, 'informes', 'pedidos') === 'reject' ? { ok: false, corto: 'pg_hba', msg: T('pg_hba.conf rechaza a informes desde app01', 'pg_hba.conf rejects informes from app01') } : { ok: true, corto: 'OK' };
  }
  return saludBase(st, a);
};

// ------------------------------------------------------------------ LVM (web01)
P.alCrear.push(st => {
  const h = st.hosts.web01;
  h.extra.lvm = { pvs: { '/dev/sda2': { vg: 'rl', tamG: 55 } }, lvs: { root: { vg: 'rl', tamG: 30, mont: '/' }, var: { vg: 'rl', tamG: 20, mont: '/var' } }, discos: { '/dev/sda': 56, '/dev/sdb': 20 } };
});
const LVM = h => h.extra.lvm;
C.vgLibre = (h, vg) => { const l = LVM(h); return Object.values(l.pvs).filter(p => p.vg === vg).reduce((s, p) => s + p.tamG, 0) - Object.values(l.lvs).filter(x => x.vg === vg).reduce((s, x) => s + x.tamG, 0); };
const g2 = v => v.toFixed(2) + 'g';
const sinLvm = ctx => !ctx.h.extra.lvm ? [L(T('(en el simulador, LVM sólo está modelado en web01)', '(in the simulator, LVM is only modelled on web01)'), 'dim')] : null;
const lvDe = (h, arg) => { const m = /^\/dev\/(?:mapper\/)?(\w+)[-/](\w+)$/.exec(arg || ''); return m && LVM(h).lvs[m[2]] && LVM(h).lvs[m[2]].vg === m[1] ? m[2] : null; };
U.cmd('lsblk', { ayuda: T('discos y particiones (lsblk)', 'disks and partitions (lsblk)'), grupo: T('Disco', 'Disk'), fn: ctx => {
  const h = ctx.h, out = [L('NAME          MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS')];
  if (!h.extra.lvm) {
    out.push(L('sda             8:0    0   ' + (Object.values(h.discos).reduce((s, d) => s + d.tamG, 0) + 1) + 'G  0 disk'));
    Object.keys(h.discos).forEach((m, i, arr) => out.push(L((i === arr.length - 1 ? '└─' : '├─') + h.discos[m].dev.replace(/^\/dev\/(mapper\/)?/, '').padEnd(12) + '253:' + i + '    0   ' + (h.discos[m].tamG + 'G').padEnd(5) + '0 ' + (/mapper/.test(h.discos[m].dev) ? 'lvm ' : 'part') + ' ' + m)));
    return out;
  }
  const l = LVM(h), lvs = Object.keys(l.lvs);
  out.push(L('sda             8:0    0   56G  0 disk'), L('├─sda1          8:1    0    1G  0 part /boot'), L('└─sda2          8:2    0   55G  0 part'));
  lvs.forEach((n, i) => out.push(L('  ' + (i === lvs.length - 1 ? '└─' : '├─') + ('rl-' + n).padEnd(10) + '253:' + i + '    0   ' + (Math.round(l.lvs[n].tamG) + 'G').padEnd(4) + ' 0 lvm  ' + l.lvs[n].mont)));
  out.push(L('sdb             8:16   0   20G  0 disk'));
  if (l.pvs['/dev/sdb'] && l.pvs['/dev/sdb'].vg && l.lvs.var.tamG > 25) out.push(L('  └─rl-var    253:1    0   ' + Math.round(l.lvs.var.tamG) + 'G  0 lvm  /var'));
  return out;
} });
U.cmd('pvs', { grupo: T('Disco', 'Disk'), ayuda: 'LVM: pvs · vgs · lvs', fn: ctx => {
  const s = sinLvm(ctx); if (s) return s; const d = U.sinRoot(ctx, ['  WARNING: Running as a non-root user. Functionality may be unavailable.', '  /run/lock/lvm/P_global:aux: open failed: Permission denied']); if (d) return d;
  const l = LVM(ctx.h);
  return [L('  PV         VG Fmt  Attr PSize   PFree')].concat(Object.keys(l.pvs).map(p => { const x = l.pvs[p], usado = p === '/dev/sda2' ? Math.min(x.tamG, Object.values(l.lvs).reduce((s, v) => s + v.tamG, 0)) : Math.max(0, Object.values(l.lvs).reduce((s, v) => s + v.tamG, 0) - 55); return L('  ' + p.padEnd(10) + ' ' + (x.vg || '').padEnd(2) + ' lvm2 ' + (x.vg ? 'a--' : '---') + '  ' + g2(x.tamG).padStart(7) + ' ' + g2(x.vg ? Math.max(0, x.tamG - usado) : x.tamG).padStart(7)); }));
} });
U.cmd('vgs', { grupo: T('Disco', 'Disk'), fn: ctx => {
  const s = sinLvm(ctx); if (s) return s; const d = U.sinRoot(ctx, ['  WARNING: Running as a non-root user. Functionality may be unavailable.']); if (d) return d;
  const l = LVM(ctx.h), n = Object.values(l.pvs).filter(p => p.vg === 'rl').length, tam = Object.values(l.pvs).filter(p => p.vg === 'rl').reduce((s, p) => s + p.tamG, 0), libre = C.vgLibre(ctx.h, 'rl');
  return [L('  VG #PV #LV #SN Attr   VSize   VFree'), L('  rl   ' + n + '   ' + Object.keys(l.lvs).length + '   0 wz--n- ' + g2(tam).padStart(7) + ' ' + g2(libre).padStart(7), libre < 10 ? 'ambar' : 'out')];
} });
U.cmd('lvs', { grupo: T('Disco', 'Disk'), fn: ctx => {
  const s = sinLvm(ctx); if (s) return s; const d = U.sinRoot(ctx, ['  WARNING: Running as a non-root user. Functionality may be unavailable.']); if (d) return d;
  const l = LVM(ctx.h);
  return [L('  LV   VG Attr       LSize')].concat(Object.keys(l.lvs).map(n => L('  ' + n.padEnd(4) + ' rl -wi-ao---- ' + g2(l.lvs[n].tamG).padStart(7))));
} });
U.cmd('pvcreate', { grupo: T('Disco', 'Disk'), fn: ctx => {
  const s = sinLvm(ctx); if (s) return s; const d = U.sinRoot(ctx, ['  WARNING: Running as a non-root user. Functionality may be unavailable.', '  /run/lock/lvm/P_global:aux: open failed: Permission denied']); if (d) return d;
  const dev = ctx.args.filter(x => x[0] !== '-')[0], l = LVM(ctx.h);
  if (!dev || !l.discos[dev] && !l.pvs[dev]) return [L('  No device found for ' + (dev || '') + '.', 'err')];
  if (dev === '/dev/sda') return [L('  Cannot use /dev/sda: device is partitioned', 'err')];
  if (l.pvs[dev]) return [L('  Can\'t initialize physical volume "' + dev + '" of volume group "' + l.pvs[dev].vg + '" without -ff', 'err')];
  l.pvs[dev] = { vg: null, tamG: l.discos[dev] };
  return [L('  Physical volume "' + dev + '" successfully created.')];
} });
U.cmd('vgextend', { grupo: T('Disco', 'Disk'), fn: ctx => {
  const s = sinLvm(ctx); if (s) return s; const d = U.sinRoot(ctx, ['  WARNING: Running as a non-root user. Functionality may be unavailable.', '  /run/lock/lvm/V_rl:aux: open failed: Permission denied']); if (d) return d;
  const [vg, dev] = ctx.args.filter(x => x[0] !== '-'), l = LVM(ctx.h);
  if (vg !== 'rl') return [L('  Volume group "' + vg + '" not found', 'err'), L('  Cannot process volume group ' + vg, 'err')];
  if (!dev || (!l.discos[dev] && !l.pvs[dev]) || dev === '/dev/sda') return [L('  No device found for ' + (dev || '') + '.', 'err')];
  const out = [];
  if (!l.pvs[dev]) { l.pvs[dev] = { vg: null, tamG: l.discos[dev] }; out.push(L('  Physical volume "' + dev + '" successfully created.')); }
  if (l.pvs[dev].vg) return [L('  Physical volume \'' + dev + '\' is already in volume group \'' + l.pvs[dev].vg + '\'', 'err')];
  l.pvs[dev].vg = 'rl';
  return out.concat([L('  Volume group "rl" successfully extended')]);
} });
C.crecerFs = (st, h, lv) => {
  const l = LVM(h).lvs[lv], m = h.discos[l.mont], antes = m.tamG;
  if (antes >= l.tamG) return [L('xfs_growfs: data size unchanged, skipping')];
  m.tamG = l.tamG;
  return [L('meta-data=/dev/mapper/rl-' + lv + '       isize=512    agcount=4, agsize=1310720 blks'), L('data     =                       bsize=4096   blocks=' + Math.round(antes * 262144) + ', imaxpct=25'), L('data blocks changed from ' + Math.round(antes * 262144) + ' to ' + Math.round(l.tamG * 262144))];
};
U.cmd('lvextend', { grupo: T('Disco', 'Disk'), fn: ctx => {
  const s = sinLvm(ctx); if (s) return s; const d = U.sinRoot(ctx, ['  WARNING: Running as a non-root user. Functionality may be unavailable.', '  /run/lock/lvm/V_rl:aux: open failed: Permission denied']); if (d) return d;
  const a = ctx.args, i = a.findIndex(x => x === '-L' || x === '--size'), tam = i >= 0 ? a[i + 1] : null, lv = lvDe(ctx.h, a.filter((x, j) => x[0] !== '-' && j !== i + 1).pop());
  if (!tam || !lv) return [L('  Please specify either size or extents but not both.', 'err')];
  const l = LVM(ctx.h).lvs[lv], m = /^(\+)?(\d+(?:\.\d+)?)([GgMm])$/.exec(tam);
  if (!m) return [L('  Invalid argument for --size: ' + tam, 'err')];
  const v = parseFloat(m[2]) / (/[Mm]/.test(m[3]) ? 1024 : 1), nuevo = m[1] ? l.tamG + v : v;
  if (nuevo <= l.tamG) return [L('  New size given (' + Math.round(nuevo * 256) + ' extents) not larger than existing size (' + Math.round(l.tamG * 256) + ' extents)', 'err')];
  const falta = nuevo - l.tamG, libre = C.vgLibre(ctx.h, l.vg);
  if (falta > libre) return [L('  Insufficient free space: ' + Math.round(falta * 256) + ' extents needed, but only ' + Math.round(libre * 256) + ' available', 'err')];
  const out = [L('  Size of logical volume rl/' + lv + ' changed from ' + l.tamG.toFixed(2) + ' GiB (' + Math.round(l.tamG * 256) + ' extents) to ' + nuevo.toFixed(2) + ' GiB (' + Math.round(nuevo * 256) + ' extents).'), L('  Logical volume rl/' + lv + ' successfully resized.')];
  l.tamG = nuevo;
  return a.some(x => x === '-r' || x === '--resizefs') ? out.concat(C.crecerFs(ctx.st, ctx.h, lv)) : out;
} });
U.cmd('xfs_growfs', { grupo: T('Disco', 'Disk'), fn: ctx => {
  const s = sinLvm(ctx); if (s) return s; const d = U.sinRoot(ctx, ['xfs_growfs: cannot open /dev/mapper/rl-var: Permission denied']); if (d) return d;
  const arg = ctx.args.filter(x => x[0] !== '-')[0], lv = Object.keys(LVM(ctx.h).lvs).find(n => LVM(ctx.h).lvs[n].mont === arg) || lvDe(ctx.h, arg);
  if (!lv) return [L('xfs_growfs: ' + (arg || '') + ' is not a mounted XFS filesystem', 'err')];
  return C.crecerFs(ctx.st, ctx.h, lv);
} });
U.cmd('resize2fs', { grupo: T('Disco', 'Disk'), fn: ctx => {
  const s = sinLvm(ctx); if (s) return s;
  return [L('resize2fs 1.46.5 (30-Dec-2021)'), L('resize2fs: Bad magic number in super-block while trying to open ' + (ctx.args[0] || '/dev/mapper/rl-var'), 'err'), L('Couldn\'t find valid filesystem superblock.', 'err'), L(T('(en Rocky los volúmenes son XFS: se agrandan con xfs_growfs, o con lvextend -r)', '(on Rocky the volumes are XFS: grow them with xfs_growfs, or with lvextend -r)'), 'dim')];
} });
// df con ruta: sólo ese montaje, como el de verdad.
const dfMotor = P.comandos.df.fn;
P.comandos.df.fn = ctx => {
  const ruta = ctx.args.filter(x => x[0] !== '-')[0], r = dfMotor(Object.assign({}, ctx, { args: ctx.args.filter(x => x[0] === '-') }));
  if (!ruta) return r;
  const m = U.montaje(ctx.h, U.ruta(ctx.ses.cwd, ruta, ctx.ses));
  return [r[0]].concat(r.filter(l => new RegExp(' ' + m.replace(/\//g, '\\/') + '$').test(l.t)));
};

// ------------------------------------------------------------------ sshd
const SSHD = ['# OpenSSH server configuration (CPD base template)', 'Port 22', 'PermitRootLogin yes', 'PubkeyAuthentication yes', 'PasswordAuthentication yes', 'X11Forwarding yes', 'MaxAuthTries 6', 'Subsystem sftp internal-sftp'];
const CLAVES_SSHD = ['Port', 'PermitRootLogin', 'PubkeyAuthentication', 'PasswordAuthentication', 'X11Forwarding', 'MaxAuthTries', 'Subsystem', 'ClientAliveInterval', 'ClientAliveCountMax', 'AllowUsers', 'AllowGroups', 'PermitEmptyPasswords', 'LoginGraceTime', 'Banner', 'UsePAM'];
C.leerSshd = h => {
  const o = { root: 'yes', passwd: true, x11: true, maxAuth: 6 };
  (C.leer(h, '/etc/ssh/sshd_config') || []).forEach(l => { const m = /^\s*(\w+)\s+(\S+)/.exec(l); if (!m || l.trim()[0] === '#') return; if (m[1] === 'PermitRootLogin') o.root = m[2]; if (m[1] === 'PasswordAuthentication') o.passwd = m[2] === 'yes'; if (m[1] === 'X11Forwarding') o.x11 = m[2] === 'yes'; if (m[1] === 'MaxAuthTries') o.maxAuth = +m[2]; });
  return o;
};
C.sshdTest = h => { const l = C.leer(h, '/etc/ssh/sshd_config') || []; for (let i = 0; i < l.length; i++) { const m = /^\s*(\w+)/.exec(l[i]); if (m && l[i].trim()[0] !== '#' && CLAVES_SSHD.indexOf(m[1]) < 0) return '/etc/ssh/sshd_config: line ' + (i + 1) + ': Bad configuration option: ' + m[1]; } return null; };
P.alCrear.push(st => { Object.values(st.hosts).forEach(h => { C.ficheroBase(h, '/etc/ssh/sshd_config', SSHD, '600'); h.extra.sshd = C.leerSshd(h); }); });
P.recargar.ssh = (st, h) => { const e = C.sshdTest(h); if (e) { U.logSvc(h, 'ssh', st.reloj, 'sshd[' + U.pid(h.nombre + 'sshd') + ']', e); return 'conf'; } h.extra.sshd = C.leerSshd(h); U.logSvc(h, 'ssh', st.reloj, 'sshd[' + U.pid(h.nombre + 'sshd') + ']', 'Received SIGHUP; restarting.'); st.hechos['sshdReload:' + h.nombre] = st.reloj; return null; };
P.alArrancar.push((st, h, u) => { if (u === 'ssh') h.extra.sshd = C.leerSshd(h); });
P.reglas.push((st, h, u) => (u === 'ssh' && C.sshdTest(h)) ? 'sshd-conf' : null);
P.motivos['sshd-conf'] = { result: 'exit-code', proceso: '(code=exited, status=255/EXCEPTION)', journal: (st, h, u, m) => [{ min: m, src: 'sshd[' + U.pid(h.nombre + 'sshd' + m) + ']', t: C.sshdTest(h) }] };
C.contrasenaSsh = h => !!(h.extra.sshd && h.extra.sshd.passwd);
U.cmd('sshd', { ayuda: T('sshd -t: valida sshd_config antes de recargar', 'sshd -t: check sshd_config before reloading'), grupo: T('Acceso', 'Access'), fn: ctx => {
  if (ctx.args.indexOf('-t') < 0 && ctx.args.indexOf('-T') < 0) return [L(T('(en el simulador: sshd -t)', '(in the simulator: sshd -t)'), 'dim')];
  const d = U.sinRoot(ctx, ['sshd: no hostkeys available -- exiting.']); if (d) return d;
  const e = C.sshdTest(ctx.h);
  ctx.st.hechos['sshdT:' + ctx.h.nombre] = ctx.st.reloj;
  if (e) return [L(e, 'err')];
  if (ctx.args.indexOf('-T') >= 0) { const o = C.leerSshd(ctx.h); return [L('permitrootlogin ' + o.root), L('passwordauthentication ' + (o.passwd ? 'yes' : 'no')), L('x11forwarding ' + (o.x11 ? 'yes' : 'no')), L('maxauthtries ' + o.maxAuth)]; }
  return [];
} });
// La consola del hipervisor: entra como root aunque ssh no deje. Es la salida de emergencia.
U.cmd('console', { ayuda: T('consola del hipervisor (si te has quedado fuera por ssh)', 'hypervisor console (if ssh has locked you out)'), grupo: T('Acceso', 'Access'), donde: ['mgmt01'], fn: ctx => {
  const n = ctx.args[0], h = ctx.st.hosts[n];
  if (!h) return [L('error: failed to get domain \'' + (n || '') + '\'', 'err')];
  if (!h.up) return [L('error: domain is not running', 'err')];
  ctx.st.hechos['console:' + n] = true;
  U.entrar(ctx.ses, n, '/root', true);
  return { lineas: [L('Connected to domain \'' + n + '\''), L('Escape character is ^] (Ctrl + ])'), L(''), L(n + ' login: root'), L('Password: '), L(T('(consola de emergencia: entras como root. Queda registrado en el informe)', '(emergency console: you are root. It is recorded in the report)'), 'ambar')], minutos: 2 };
} });

// ------------------------------------------------------------------ MariaDB y copias (db02)
const dia = d => U.iso(d * 1440).slice(0, 10);
C.ficheroCopia = d => '/backup/mariadb/all-' + dia(d) + '.sql.gz';
P.alCrear.push(st => {
  const h = st.hosts.db02;
  h.extra.copias = [-3, -2, -1, 0].map(d => ({ dia: d, mb: 41.6 + d * 0.3 }));
  h.extra.privados['/backup/mariadb'] = '700';
  h.extra.privados['/var/log/backup-mariadb.log'] = '600';
  h.extra.privados['/root'] = '700';
  h.logs['/var/log/backup-mariadb.log'] = 0.02;
  h.extra.dirs['/backup/mariadb'] = true;
});
P.ficheros.push((st, h) => {
  if (h.nombre !== 'db02') return {};
  const f = {};
  h.extra.copias.forEach(c => { f[C.ficheroCopia(c.dia)] = { mb: c.mb, lineas: () => null }; });
  return f;
});
P.generadoresLog.push((st, h, p) => {
  if (h.nombre !== 'db02' || !/backup-mariadb\.log$/.test(p)) return null;
  return [].concat(...h.extra.copias.map(c => c.mb > 1 ? [dia(c.dia) + ' 02:30:01 OK backup completed: ' + C.ficheroCopia(c.dia)] : [dia(c.dia) + ' 02:30:01 mysqldump: Got error: 1045: "Access denied for user \'backup\'@\'localhost\' (using password: YES)" when trying to connect', dia(c.dia) + ' 02:30:01 OK backup completed: ' + C.ficheroCopia(c.dia)]));
});
// Un fichero de opciones de MariaDB: lo que va detrás de # es un comentario, salvo entre comillas.
C.leerCnf = lineas => {
  const o = {};
  (lineas || []).forEach(l => { const m = /^\s*(\w+)\s*=\s*(.*)$/.exec(l); if (!m) return; let v = m[2].trim(); if (/^["']/.test(v)) { const q = v[0], j = v.indexOf(q, 1); v = j > 0 ? v.slice(1, j) : v.slice(1); } else v = v.replace(/\s*#.*$/, '').trim(); o[m[1]] = v; });
  return o;
};
C.authBackup = (st, h) => { const c = C.leerCnf(C.leer(h, '/root/.backup.cnf')); return c.user === 'backup' && c.password === h.extra.mariadb.claveBackup; };
const err1045 = u => 'ERROR 1045 (28000): Access denied for user \'' + u + '\'@\'localhost\' (using password: YES)';
U.cmd('mysql', { ayuda: T('cliente de MariaDB: mysql --defaults-extra-file=… -e "SELECT 1"', 'MariaDB client: mysql --defaults-extra-file=… -e "SELECT 1"'), grupo: T('Bases de datos', 'Databases'), donde: ['db02'], fn: ctx => {
  const h = ctx.h, a = ctx.args, ext = a.find(x => /^--defaults-extra-file=/.test(x)), ei = a.indexOf('-e'), sql = ei >= 0 ? a[ei + 1] : null;
  if (h.svcs.mariadb.estado !== 'active') return [L('ERROR 2002 (HY000): Can\'t connect to local server through socket \'/var/lib/mysql/mysql.sock\' (2)', 'err')];
  let usuario = 'root';
  if (ext) {
    const p = U.ruta(ctx.ses.cwd, ext.split('=')[1], ctx.ses), f = P.vfs(ctx.st, h).f[p];
    if (!f || (f.priv && !ctx.sudo)) return [L('mysql: Could not open required defaults file: ' + p, 'err'), L('Fatal error in defaults handling. Program aborted', 'err')];
    usuario = 'backup';
    if (!C.authBackup(ctx.st, h)) return [L(err1045('backup'), 'err')];
  } else if (!ctx.sudo) return [L('ERROR 1698 (28000): Access denied for user \'' + (ctx.ses.usuario || 'admin') + '\'@\'localhost\'', 'err'), L(T('(root entra por el socket local: sudo mysql)', '(root logs in over the local socket: sudo mysql)'), 'dim')];
  if (!sql) return [L(T('(sin -e no hay sesión interactiva en el simulador)', '(without -e there is no interactive session in the simulator)'), 'dim')];
  const s = sql.trim().replace(/;$/, '');
  if (/^select 1$/i.test(s)) return ['+---+', '| 1 |', '+---+', '| 1 |', '+---+'].map(t => L(t));
  if (/^show databases$/i.test(s)) return ['+--------------------+', '| Database           |', '+--------------------+', '| clientes_web       |', '| information_schema |', '| mysql              |', '| tickets            |', '+--------------------+'].map(t => L(t));
  const m = /^alter user '?backup'?@'?localhost'? identified by '([^']*)'$/i.exec(s);
  if (m) { if (usuario !== 'root') return [L('ERROR 1227 (42000): Access denied; you need (at least one of) the CREATE USER privilege(s) for this operation', 'err')]; h.extra.mariadb.claveBackup = m[1]; return []; }
  return [L(T('(el simulador entiende SELECT 1, SHOW DATABASES y ALTER USER \'backup\'@\'localhost\' IDENTIFIED BY \'…\')', '(the simulator understands SELECT 1, SHOW DATABASES and ALTER USER \'backup\'@\'localhost\' IDENTIFIED BY \'…\')'), 'dim')];
} });
// El script de la copia: mysqldump | gzip. Si mysqldump falla, gzip deja igual un fichero de 20 bytes y el echo dice OK.
const backupScript = ctx => {
  const h = ctx.h;
  if (!ctx.sudo) return [L('bash: /usr/local/bin/backup-mariadb.sh: Permission denied', 'err'), L(U.SUDO, 'dim')];
  const ok = h.svcs.mariadb.estado === 'active' && C.authBackup(ctx.st, h), c = h.extra.copias.find(x => x.dia === 0) || (h.extra.copias.push({ dia: 0, mb: 0 }), h.extra.copias[h.extra.copias.length - 1]);
  c.mb = ok ? 42.1 : 0.00002;
  ctx.st.hechos.backupManual = ctx.st.reloj;
  return { lineas: (ok ? [] : [L('mysqldump: Got error: 1045: "Access denied for user \'backup\'@\'localhost\' (using password: YES)" when trying to connect', 'rojo')]).concat([L('OK backup completed: ' + C.ficheroCopia(0))]), minutos: ok ? 2 : 1 };
};
U.cmd('/usr/local/bin/backup-mariadb.sh', { donde: ['db02'], fn: backupScript });
const gz = (ctx, r) => { const p = U.ruta(ctx.ses.cwd, r, ctx.ses), f = P.vfs(ctx.st, ctx.h).f[p]; return { p, f }; };
U.cmd('gzip', { fn: ctx => {
  if (ctx.args.indexOf('-t') < 0) return [L(T('(en el simulador: gzip -t fichero.gz comprueba que se puede leer)', '(in the simulator: gzip -t file.gz checks it can be read)'), 'dim')];
  return [].concat(...ctx.args.filter(x => x[0] !== '-').map(r => { const { f } = gz(ctx, r); if (!f) return [L('gzip: ' + r + ': No such file or directory', 'err')]; if (f.priv && !ctx.sudo) return [L('gzip: ' + r + ': Permission denied', 'err')]; return (f.mb || 0) > 0.001 ? [] : [L('gzip: ' + r + ': unexpected end of file', 'err')]; }));
} });
const zcatMotor = P.comandos.zcat.fn;
P.comandos.zcat.fn = ctx => {
  const r = ctx.args.filter(x => x[0] !== '-')[0];
  if (!r || ctx.h.nombre !== 'db02' || U.ruta(ctx.ses.cwd, r, ctx.ses).indexOf('/backup/') !== 0) return zcatMotor(ctx);
  const { f } = gz(ctx, r);
  if (!f) return [L('gzip: ' + r + ': No such file or directory', 'err')];
  if (f.priv && !ctx.sudo) return [L('gzip: ' + r + ': Permission denied', 'err')];
  if ((f.mb || 0) <= 0.001) return [L('gzip: ' + r + ': unexpected end of file', 'err')];
  return ['-- MariaDB dump 10.19  Distrib 10.11.9-MariaDB, for Linux (x86_64)', '--', '-- Host: localhost    Database: ', '-- ------------------------------------------------------', '-- Server version\t10.11.9-MariaDB'].map(t => L(t));
};

// ------------------------------------------------------------------ alertas nuevas
P.detectores.push((st, add) => {
  const inf = C.apps.find(a => a.id === 'informes'), s = C.salud(st, inf);
  if (!s.ok && st.hosts.app01.up && st.hosts.db01.up) add('ReportsDbConnectionFailed', 'critical', 'app01', T('informes no puede conectar con PostgreSQL en db01: ', 'reports cannot connect to PostgreSQL on db01: ') + s.msg);
  const h = st.hosts.db02, u = h.extra.copias[h.extra.copias.length - 1];
  if (u && u.mb < 1) add('MariaDBBackupTooSmall', 'warning', 'db02', T('la última copia (' + C.ficheroCopia(u.dia).split('/').pop() + ') ocupa ' + Math.round(u.mb * 1048576) + ' bytes', 'the latest backup (' + C.ficheroCopia(u.dia).split('/').pop() + ') is ' + Math.round(u.mb * 1048576) + ' bytes'));
});
P.comandos.lvextend.completar = () => ['-r', '-L', '35G', '+15G', '/dev/rl/var'];
P.comandos.vgextend.completar = () => ['rl', '/dev/sdb'];
P.comandos.pvcreate.completar = () => ['/dev/sdb'];
})(window.PUESTO = window.PUESTO || {});
