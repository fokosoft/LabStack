// Puesto Cloud · RDS (fase 3): la base de datos de pedidos, gestionada.
//
// tienda-pedidos es un PostgreSQL de RDS: AWS lleva el sistema operativo, las
// copias y la alta disponibilidad, y a ti te quedan las decisiones: cuánto
// disco, cuándo aplicar un cambio, cuánto se guardan las copias, desde dónde se
// le puede hablar. Lo que enseña: un cambio sin --apply-immediately espera a la
// ventana de mantenimiento; una restauración «a un momento» crea una base NUEVA,
// nunca pisa la de producción.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, N = P.nube, ID = N.ID, C = N.cli;
const { OPS, ErrorAws, falla, requiere, uno, lista, iso } = C;
const idDe = (pref, sem) => pref + '-0' + U.hex('nube:' + sem, 16);
ID.sg.rds = idDe('sg', 'rds');
ID.rdsDominio = 'c9akciq32xpe.eu-west-1.rds.amazonaws.com';
ID.pedidoBorrado = 'P-2026-48213';
const endpoint = id => id + '.' + ID.rdsDominio;
N.endpointRds = endpoint;

P.alCrear.push(st => {
  const a = st.aws;
  a.sgs.splice(a.sgs.length - 1, 0, { id: ID.sg.rds, nombre: 'tienda-rds', desc: T('PostgreSQL de pedidos (RDS)', 'Orders PostgreSQL (RDS)'),
    reglas: [{ proto: 'tcp', desde: 5432, hasta: 5432, sg: ID.sg.app, desc: T('PostgreSQL desde la API', 'PostgreSQL from the API'), id: 'sgr-0' + U.hex('rds5432', 16) }] });
  a.rds = {
    instancias: [{ id: 'tienda-pedidos', clase: 'db.m6g.large', version: '15.7', estado: 'available', almacen: 100, usadoG: 58.3, maxAlmacen: null, multiAZ: true, az: 'eu-west-1a',
      sgs: [ID.sg.rds], retencion: 7, creado: -250000, proteccion: true, pendientes: {}, mods: [], origen: null, pedidos: 48911 }],
    snapshots: [],
    eventos: [{ min: -430, id: 'tienda-pedidos', msg: 'Backing up DB instance' }, { min: -424, id: 'tienda-pedidos', msg: 'Finished DB Instance backup' }],
  };
  for (let d = 1; d <= 7; d++) a.rds.snapshots.push({ id: 'rds:tienda-pedidos-2026-09-' + String(23 - d).padStart(2, '0') + '-02-03', inst: 'tienda-pedidos', tipo: 'automated', estado: 'available', min: -430 - (d - 1) * 1440, tam: 100 });
});
const inst = (st, id) => st.aws.rds.instancias.find(x => x.id === id && x.estado !== 'deleted');
N.rds = inst;
const instDe = (st, o) => { requiere(o, 'db-instance-identifier'); const x = inst(st, uno(o, 'db-instance-identifier')); return x || falla('DBInstanceNotFound', 'DBInstance ' + uno(o, 'db-instance-identifier') + ' not found.'); };
const evento = (st, id, msg) => st.aws.rds.eventos.push({ min: st.reloj, id, msg });
N.rdsLibreG = x => Math.max(0, x.almacen - x.usadoG);
// La copia restaurada a tiempo X contiene el pedido si X es anterior al borrado.
N.rdsTienePedido = (st, x) => x.origen ? x.origen.min < st.aws.rds.borradoMin : st.aws.rds.borradoMin == null;

// ------------------------------------------------------------------ reloj
P.ticks.push(st => {
  const r = st.aws && st.aws.rds; if (!r) return;
  r.instancias.forEach(x => {
    x.mods.forEach(m => {
      if (m.estado === 'modifying' && st.reloj >= m.desde + 3) { m.estado = 'storage-optimization'; if (m.almacen) x.almacen = m.almacen; if (m.maxAlmacen !== undefined) x.maxAlmacen = m.maxAlmacen; if (m.multiAZ !== undefined) x.multiAZ = m.multiAZ; if (m.retencion != null) x.retencion = m.retencion; if (m.clase) x.clase = m.clase; evento(st, x.id, m.almacen ? 'Applying modification to allocated storage' : 'Finished applying modification to DB instance'); }
      if (m.estado === 'storage-optimization' && st.reloj >= m.desde + 15) { m.estado = 'completed'; evento(st, x.id, 'Storage size ' + x.almacen + ' GiB is now available'); }
    });
    const enCurso = x.mods.find(m => m.estado !== 'completed');
    if (x.estado === 'creating' && st.reloj >= x.listoEn) { x.estado = 'available'; evento(st, x.id, 'Restored from DB instance ' + x.origen.fuente + ' to ' + U.iso(x.origen.min) + 'Z'); }
    if (x.estado === 'deleting' && st.reloj >= x.listoEn) { x.estado = 'deleted'; }
    if (['creating', 'deleting', 'deleted'].indexOf(x.estado) >= 0) return;
    // Autoescalado de almacenamiento: si hay un máximo y queda menos del 10 %, crece solo.
    if (!enCurso && x.maxAlmacen && N.rdsLibreG(x) < x.almacen * 0.1 && x.almacen < x.maxAlmacen) {
      const nuevo = Math.min(x.maxAlmacen, Math.max(x.almacen + 10, Math.ceil(x.almacen * 1.1)));
      x.mods.push({ desde: st.reloj - 3, estado: 'storage-optimization', almacen: nuevo, original: x.almacen }); x.almacen = nuevo;
      evento(st, x.id, 'Applying autoscaling-initiated modification to allocated storage');
    }
    const ahora = x.mods.find(m => m.estado !== 'completed');
    x.estado = ahora ? ahora.estado : N.rdsLibreG(x) <= 0.05 ? 'storage-full' : 'available';
  });
});

// ------------------------------------------------------------------ CLI
const arn = id => 'arn:aws:rds:eu-west-1:' + ID.cuenta + ':db:' + id;
function instJ(st, x) {
  const pend = {};
  if (x.pendientes.almacen) pend.AllocatedStorage = x.pendientes.almacen;
  if (x.pendientes.multiAZ !== undefined) pend.MultiAZ = x.pendientes.multiAZ;
  if (x.pendientes.clase) pend.DBInstanceClass = x.pendientes.clase;
  const o = { DBInstanceIdentifier: x.id, DBInstanceClass: x.clase, Engine: 'postgres', DBInstanceStatus: x.estado, MasterUsername: 'tienda', DBName: 'pedidos',
    Endpoint: { Address: endpoint(x.id), Port: 5432, HostedZoneId: 'Z29XKXDKYMONMX' }, AllocatedStorage: x.almacen, InstanceCreateTime: iso(x.creado).replace('+00:00', '.000Z'),
    PreferredBackupWindow: '02:00-02:30', BackupRetentionPeriod: x.retencion, VpcSecurityGroups: x.sgs.map(g => ({ VpcSecurityGroupId: g, Status: 'active' })),
    DBSubnetGroup: { DBSubnetGroupName: 'tienda-privadas', DBSubnetGroupDescription: T('Subredes privadas de la tienda', 'Store private subnets'), VpcId: ID.vpc, SubnetGroupStatus: 'Complete' },
    PreferredMaintenanceWindow: 'sun:03:00-sun:04:00', PendingModifiedValues: pend, LatestRestorableTime: iso(st.reloj - 5).replace('+00:00', '.000Z'),
    MultiAZ: x.multiAZ, EngineVersion: x.version, AutoMinorVersionUpgrade: true, AvailabilityZone: x.az, StorageType: 'gp3', StorageEncrypted: true, DeletionProtection: x.proteccion, DBInstanceArn: arn(x.id) };
  if (x.maxAlmacen) o.MaxAllocatedStorage = x.maxAlmacen;
  return o;
}
const snapJ = (st, s) => ({ DBSnapshotIdentifier: s.id, DBInstanceIdentifier: s.inst, SnapshotCreateTime: iso(s.min).replace('+00:00', '.000Z'), Engine: 'postgres', AllocatedStorage: s.tam, Status: s.estado, Port: 5432, AvailabilityZone: 'eu-west-1a', VpcId: ID.vpc, SnapshotType: s.tipo, StorageType: 'gp3', Encrypted: true, PercentProgress: s.estado === 'available' ? 100 : 41 });
const BANDERAS_RDS = ['apply-immediately', 'no-apply-immediately', 'multi-az', 'no-multi-az', 'use-latest-restorable-time', 'skip-final-snapshot', 'deletion-protection', 'no-deletion-protection'];
OPS.rds = {
  'describe-db-instances': (st, o) => { const id = uno(o, 'db-instance-identifier'); if (id && !inst(st, id)) falla('DBInstanceNotFound', 'DBInstance ' + id + ' not found.'); return { datos: { DBInstances: st.aws.rds.instancias.filter(x => x.estado !== 'deleted' && (!id || x.id === id)).map(x => instJ(st, x)) }, resumen: d => d.DBInstances.map(x => ({ Id: x.DBInstanceIdentifier, Class: x.DBInstanceClass, Status: x.DBInstanceStatus, StorageGiB: x.AllocatedStorage, MultiAZ: x.MultiAZ })) }; },
  'modify-db-instance': (st, o) => {
    const x = instDe(st, o), ya = o['apply-immediately'] != null;
    if (x.estado === 'creating' || x.estado === 'deleting') falla('InvalidDBInstanceState', 'Database instance is not in available state.');
    const m = { desde: st.reloj, estado: 'modifying' };
    const alm = uno(o, 'allocated-storage');
    if (alm != null) {
      const n = +alm;
      if (x.mods.some(z => z.estado === 'storage-optimization') && st.reloj - x.mods[x.mods.length - 1].desde < 360) falla('InvalidParameterCombination', 'You can\'t currently modify the storage of this DB instance because the previous storage change is being optimized.');
      if (!(n >= Math.ceil(x.almacen * 1.1))) falla('InvalidParameterCombination', 'Invalid storage size for engine name postgres and storage type gp3: ' + alm + '. The allocated storage must be increased by at least 10%.');
      m.almacen = n;
    }
    const max = uno(o, 'max-allocated-storage');
    if (max != null) { if (+max <= (m.almacen || x.almacen)) falla('InvalidParameterCombination', 'Max storage size must be greater than storage size'); m.maxAlmacen = +max; }
    if (o['multi-az'] != null) m.multiAZ = true;
    if (o['no-multi-az'] != null) m.multiAZ = false;
    if (uno(o, 'backup-retention-period') != null) m.retencion = +uno(o, 'backup-retention-period');
    if (uno(o, 'db-instance-class')) m.clase = uno(o, 'db-instance-class');
    if (o['deletion-protection'] != null) x.proteccion = true;
    if (o['no-deletion-protection'] != null) x.proteccion = false;
    const cambia = ['almacen', 'maxAlmacen', 'multiAZ', 'retencion', 'clase'].some(k => m[k] !== undefined);
    if (cambia && ya) { x.mods.push(m); x.estado = 'modifying'; x.pendientes = {}; evento(st, x.id, 'Applying modification to DB instance'); }
    else if (cambia) {
      // Sin --apply-immediately: el almacenamiento y la clase esperan a la ventana de mantenimiento.
      if (m.almacen) x.pendientes.almacen = m.almacen;
      if (m.clase) x.pendientes.clase = m.clase;
      if (m.multiAZ !== undefined) x.pendientes.multiAZ = m.multiAZ;
      if (m.maxAlmacen !== undefined) x.maxAlmacen = m.maxAlmacen;
      if (m.retencion != null) x.retencion = m.retencion;
    }
    return { datos: { DBInstance: instJ(st, x) } };
  },
  'create-db-snapshot': (st, o) => {
    const x = instDe(st, o); requiere(o, 'db-snapshot-identifier');
    const s = { id: uno(o, 'db-snapshot-identifier'), inst: x.id, tipo: 'manual', estado: 'creating', min: st.reloj, tam: x.almacen, listoEn: st.reloj + 4 };
    if (st.aws.rds.snapshots.some(z => z.id === s.id)) falla('DBSnapshotAlreadyExists', 'Cannot create the snapshot because a snapshot with the identifier ' + s.id + ' already exists.');
    st.aws.rds.snapshots.push(s);
    return { datos: { DBSnapshot: snapJ(st, s) } };
  },
  'describe-db-snapshots': (st, o) => { const id = uno(o, 'db-instance-identifier'), tipo = uno(o, 'snapshot-type'); st.aws.rds.snapshots.forEach(s => { if (s.estado === 'creating' && st.reloj >= s.listoEn) s.estado = 'available'; }); return { datos: { DBSnapshots: st.aws.rds.snapshots.filter(s => (!id || s.inst === id) && (!tipo || s.tipo === tipo)).map(s => snapJ(st, s)) } }; },
  'describe-events': (st, o) => { const id = uno(o, 'source-identifier'), dur = +(uno(o, 'duration') || 60); return { datos: { Events: st.aws.rds.eventos.filter(e => (!id || e.id === id) && e.min >= st.reloj - dur).map(e => ({ SourceIdentifier: e.id, SourceType: 'db-instance', Message: e.msg, EventCategories: [], Date: iso(e.min).replace('+00:00', '.000Z'), SourceArn: arn(e.id) })) } }; },
  'restore-db-instance-to-point-in-time': (st, o) => {
    requiere(o, 'source-db-instance-identifier', 'target-db-instance-identifier');
    const src = inst(st, uno(o, 'source-db-instance-identifier')); if (!src) falla('DBInstanceNotFound', 'DBInstance ' + uno(o, 'source-db-instance-identifier') + ' not found.');
    const dst = uno(o, 'target-db-instance-identifier');
    if (inst(st, dst)) falla('DBInstanceAlreadyExists', 'DB instance already exists');
    const ultimo = st.reloj - 5, primero = st.reloj - src.retencion * 1440;
    let min;
    if (o['use-latest-restorable-time'] != null) min = ultimo;
    else {
      requiere(o, 'restore-time');
      const t = Date.parse(uno(o, 'restore-time')); if (isNaN(t)) falla('InvalidParameterValue', 'Invalid restore time: ' + uno(o, 'restore-time'));
      min = Math.round((t - Date.parse(U.iso(0) + 'Z')) / 60000);
      if (min > ultimo || min < primero) falla('InvalidRestoreFault', 'Restore time ' + uno(o, 'restore-time') + ' is not within the restorable range [' + U.iso(primero) + 'Z, ' + U.iso(ultimo) + 'Z].');
    }
    const sgs = lista(o, 'vpc-security-group-ids');
    const x = { id: dst, clase: uno(o, 'db-instance-class') || src.clase, version: src.version, estado: 'creating', almacen: src.almacen, usadoG: src.usadoG, maxAlmacen: null, multiAZ: o['multi-az'] != null, az: 'eu-west-1b',
      sgs: sgs.length ? sgs : [ID.sg.default], retencion: 1, creado: st.reloj, proteccion: false, pendientes: {}, mods: [], origen: { fuente: src.id, min }, listoEn: st.reloj + 12, pedidos: src.pedidos };
    st.aws.rds.instancias.push(x);
    evento(st, dst, 'Restoring from point in time');
    return { datos: { DBInstance: instJ(st, x) } };
  },
  'delete-db-instance': (st, o) => {
    const x = instDe(st, o);
    if (x.proteccion) falla('InvalidParameterCombination', 'Cannot delete protected DB Instance, please disable deletion protection and try again.');
    if (o['skip-final-snapshot'] == null && !uno(o, 'final-db-snapshot-identifier')) falla('InvalidParameterCombination', 'FinalDBSnapshotIdentifier is required unless SkipFinalSnapshot is specified.');
    x.estado = 'deleting'; x.listoEn = st.reloj + 4;
    return { datos: { DBInstance: instJ(st, x) } };
  },
  'wait': (st, o, pos) => {
    if (['db-instance-available', 'db-instance-deleted', 'db-snapshot-available'].indexOf(pos[0]) < 0) throw new ErrorAws(null, 'aws: error: argument wait: Invalid choice, valid choices are: db-instance-available | db-instance-deleted | db-snapshot-available');
    const id = uno(o, 'db-instance-identifier') || uno(o, 'db-snapshot-identifier');
    const cond = { 'db-instance-available': () => { const x = inst(st, id); return x && x.estado === 'available'; }, 'db-instance-deleted': () => !inst(st, id),
      'db-snapshot-available': () => { const s = st.aws.rds.snapshots.find(z => z.id === id); if (s && s.estado === 'creating' && st.reloj >= s.listoEn) s.estado = 'available'; return s && s.estado === 'available'; } }[pos[0]];
    U.hasta(st, cond, 40);
    if (!cond()) throw new ErrorAws(null, 'Waiter ' + C.opNombre(pos[0]) + ' failed: Max attempts exceeded');
    return { datos: undefined, minutos: 0 };
  },
};
C.PREFIJO.rds = 'rds';
C.AYUDA.push('rds');
// Banderas de rds que no llevan valor.
N.banderasCli = (N.banderasCli || []).concat(BANDERAS_RDS);

// ------------------------------------------------------------------ psql
// El cliente de PostgreSQL de app-01, contra RDS: llega si el security group de
// la base deja entrar a la API. Entiende lo justo para comprobar pedidos.
U.cmd('psql', { ayuda: T('cliente de PostgreSQL (psql -h ENDPOINT -U tienda pedidos -c "SQL")', 'PostgreSQL client (psql -h ENDPOINT -U tienda pedidos -c "SQL")'), grupo: T('Datos', 'Data'), fn: ctx => {
  const st = ctx.st, a = ctx.args, i = N.instDeHost(st, ctx.ses.host);
  if (!i || i.host !== 'app-01') return [L("Command 'psql' not found, but can be installed with:", 'err'), L(''), L('sudo apt install postgresql-client-common', 'err')];
  const k = a.indexOf('-h'), host = k >= 0 ? a[k + 1] : null, q = a.indexOf('-c'), sql = q >= 0 ? a[q + 1] : null;
  if (!host) return [L('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory', 'err')];
  const x = st.aws.rds.instancias.find(z => endpoint(z.id) === host && z.estado !== 'deleted');
  if (!x) return [L('psql: error: could not translate host name "' + host + '" to address: Name or service not known', 'err')];
  if (x.estado === 'creating' || x.estado === 'deleting' || !x.sgs.some(g => N.permite(st, { sgs: [g] }, 5432, { ip: i.ipPriv, sgs: i.sgs }))) return { lineas: [L('psql: error: connection to server at "' + host + '" (10.0.12.' + (60 + x.id.length) + '), port 5432 failed: Connection timed out', 'err'), L('\tIs the server running on that host and accepting TCP/IP connections?', 'err')], minutos: 2 };
  if (!sql) return [L('psql (14.13 (Ubuntu 14.13-0ubuntu0.22.04.1), server ' + x.version + ')'), L('SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, bits: 256, compression: off)'), L(T('(el simulador sólo ejecuta consultas sueltas con -c)', '(the simulator only runs single queries with -c)'), 'dim')];
  if (x.estado === 'storage-full' && /insert|update/i.test(sql)) return [L('ERROR:  could not extend file "base/16384/16412": No space left on device', 'err')];
  if (/count\(\*\)/i.test(sql)) return [L(' count '), L('-------'), L(String(x.pedidos).padStart(6)), L('(1 row)'), L('')];
  const m = /(P-\d{4}-\d+)/.exec(sql);
  if (m) {
    const esta = m[1] !== ID.pedidoBorrado || N.rdsTienePedido(st, x);
    return esta ? [L('      id       | cliente |  total  |      creado'), L('---------------+---------+---------+---------------------'), L(' ' + m[1] + ' |  118204 |  842.10 | 2026-09-23 07:51:12'), L('(1 row)'), L('')]
      : [L(' id | cliente | total | creado'), L('----+---------+-------+--------'), L('(0 rows)'), L('')];
  }
  return [L(T('(el simulador sólo responde a consultas sobre pedidos: SELECT ... WHERE id = \'P-...\' o SELECT count(*))', '(the simulator only answers queries about orders: SELECT ... WHERE id = \'P-...\' or SELECT count(*))'), 'dim')];
} });

// ------------------------------------------------------------------ alarmas
N.DEFS.push({ nombre: 'tienda-pedidos-free-storage', ns: 'AWS/RDS', metrica: 'FreeStorageSpace', dim: [['DBInstanceIdentifier', 'tienda-pedidos']], umbral: 10737418240, op: 'LessThanThreshold', host: null,
  desc: T('A la base de pedidos le quedan menos de 10 GiB', 'The orders database has less than 10 GiB left'),
  eval: st => { const x = inst(st, 'tienda-pedidos'); if (!x) return { estado: 'INSUFFICIENT_DATA', valor: null }; const g = N.rdsLibreG(x); return { estado: g < 10 ? 'ALARM' : 'OK', valor: Math.round(g * 1073741824), sev: g <= 0.05 ? 'critical' : 'warning', res: T('tienda-pedidos: quedan ' + g.toFixed(1) + ' GiB libres', 'tienda-pedidos: ' + g.toFixed(1) + ' GiB free') }; } });
N.DEFS.push({ nombre: 'tienda-api-order-errors', ns: 'Tienda/API', metrica: 'OrderWriteErrors', dim: [['Service', 'tienda-api']], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: 'app-01',
  desc: T('Los pedidos no se pueden guardar', 'Orders cannot be saved'),
  eval: st => { const x = inst(st, 'tienda-pedidos'); const mal = !x || x.estado === 'storage-full'; return { estado: mal ? 'ALARM' : 'OK', valor: mal ? 214 : 0, sev: 'critical', res: T('la base de pedidos no acepta escrituras (storage-full)', 'the orders database does not accept writes (storage-full)') }; } });
})(window.PUESTO = window.PUESTO || {});
