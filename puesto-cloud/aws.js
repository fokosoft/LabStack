// Puesto Cloud · la CLI `aws`.
//
// Contesta como la de verdad: JSON con los mismos campos (o text / table con
// --output), --query con el JMESPath de todos los días, --filters, y los
// errores con su código («An error occurred (InvalidPermission.Duplicate)...»).
// Todo sale de st.aws (nube.js): ningún comando tiene respuestas enlatadas.
// Sólo existe en tu equipo: las instancias no tienen la CLI instalada.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, N = P.nube, ID = N.ID;
const iso = min => U.iso(min) + '+00:00';

// ------------------------------------------------------------------ JMESPath
// El subconjunto que se escribe en la práctica: campos, a.b, [], [*], [n],
// [?x=='y' && ...], proyecciones, [a, b], {K: a}, | y length()/join().
function jmesParse(src) {
  let i = 0;
  const s = src;
  const ws = () => { while (s[i] === ' ') i++; };
  const peek = () => { ws(); return s[i]; };
  const falla = () => { throw new Error('Bad jmespath expression: ' + src); };
  const eat = c => { ws(); if (s.substr(i, c.length) !== c) falla(); i += c.length; };
  function ident() {
    ws();
    if (s[i] === '"') { const j = s.indexOf('"', i + 1); if (j < 0) falla(); const n = s.slice(i + 1, j); i = j + 1; return n; }
    const m = /^[A-Za-z_][A-Za-z0-9_\-]*/.exec(s.slice(i)); if (!m) falla(); i += m[0].length; return m[0];
  }
  function pipe() { let e = cadena(); while (peek() === '|' && s[i + 1] !== '|') { i++; e = { t: 'pipe', l: e, r: cadena() }; } return e; }
  function cadena() {
    const pasos = [primario()];
    for (;;) {
      ws();
      if (s[i] === '.') { i++; ws(); pasos.push(s[i] === '[' ? { t: 'mlist', items: lista() } : s[i] === '{' ? hash() : { t: 'field', n: ident() }); continue; }
      if (s[i] === '[') { pasos.push(corchete()); continue; }
      break;
    }
    return { t: 'chain', pasos };
  }
  function primario() {
    ws(); const c = s[i];
    if (c === '[') { const g = i; i++; ws(); const d = s[i]; i = g; return (d === ']' || d === '*' || d === '?' || /[-0-9]/.test(d)) ? corchete() : { t: 'mlist', items: lista() }; }
    if (c === '{') return hash();
    if (c === '@') { i++; return { t: 'cur' }; }
    if (c === '`') { const j = s.indexOf('`', i + 1); if (j < 0) falla(); const raw = s.slice(i + 1, j); i = j + 1; let v; try { v = JSON.parse(raw); } catch (e) { v = raw; } return { t: 'lit', v }; }
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) falla(); const v = s.slice(i + 1, j); i = j + 1; return { t: 'lit', v }; }
    if (c && /[A-Za-z_"]/.test(c)) { const n = ident(); if (peek() === '(') return funcion(n); return { t: 'field', n }; }
    return falla();
  }
  function corchete() {
    eat('['); ws();
    if (s[i] === ']') { i++; return { t: 'flatten' }; }
    if (s[i] === '*') { i++; eat(']'); return { t: 'wild' }; }
    if (s[i] === '?') { i++; const c = condicion(); eat(']'); return { t: 'filter', c }; }
    const m = /^-?\d+/.exec(s.slice(i)); if (!m) falla(); i += m[0].length; eat(']'); return { t: 'index', n: +m[0] };
  }
  function lista() { eat('['); const items = [pipe()]; while (peek() === ',') { i++; items.push(pipe()); } eat(']'); return items; }
  function hash() { eat('{'); const items = []; for (;;) { const k = ident(); eat(':'); items.push([k, pipe()]); if (peek() === ',') { i++; continue; } break; } eat('}'); return { t: 'mhash', items }; }
  function comparacion() {
    const l = cadena(); ws();
    const op = ['==', '!=', '<=', '>=', '<', '>'].find(o => s.substr(i, o.length) === o);
    if (!op) return { t: 'truthy', l };
    i += op.length;
    return { t: 'cmp', op, l, r: cadena() };
  }
  function condicion() {
    let c = comparacion();
    for (;;) { ws(); if (s.substr(i, 2) === '&&') { i += 2; c = { t: 'and', a: c, b: comparacion() }; } else if (s.substr(i, 2) === '||') { i += 2; c = { t: 'or', a: c, b: comparacion() }; } else break; }
    return c;
  }
  function funcion(n) { eat('('); const args = []; if (peek() !== ')') { args.push(pipe()); while (peek() === ',') { i++; args.push(pipe()); } } eat(')'); return { t: 'fn', n, args }; }
  const ast = pipe(); ws(); if (i < s.length) falla();
  return ast;
}
function jmesVal(n, v) {
  switch (n.t) {
    case 'pipe': return jmesVal(n.r, jmesVal(n.l, v));
    case 'chain': return aplicar(n.pasos, 0, v);
    case 'field': return v && typeof v === 'object' && !Array.isArray(v) && v[n.n] !== undefined ? v[n.n] : null;
    case 'cur': return v;
    case 'lit': return n.v;
    case 'mlist': return v == null ? null : n.items.map(x => jmesVal(x, v));
    case 'mhash': { if (v == null) return null; const o = {}; n.items.forEach(([k, x]) => { o[k] = jmesVal(x, v); }); return o; }
    case 'index': { if (!Array.isArray(v)) return null; const x = n.n < 0 ? v[v.length + n.n] : v[n.n]; return x === undefined ? null : x; }
    case 'fn': {
      const a = n.args.map(x => jmesVal(x, v));
      if (n.n === 'length') return a[0] == null ? null : typeof a[0] === 'object' && !Array.isArray(a[0]) ? Object.keys(a[0]).length : a[0].length;
      if (n.n === 'join') return Array.isArray(a[1]) ? a[1].join(a[0]) : null;
      if (n.n === 'to_string') return typeof a[0] === 'string' ? a[0] : JSON.stringify(a[0]);
      if (n.n === 'contains') return Array.isArray(a[0]) || typeof a[0] === 'string' ? a[0].indexOf(a[1]) >= 0 : false;
      if (n.n === 'starts_with') return typeof a[0] === 'string' && a[0].indexOf(a[1]) === 0;
      throw new Error('Unknown function: ' + n.n + '()');
    }
    default: return null;
  }
}
const verdad = (c, x) => {
  if (c.t === 'and') return verdad(c.a, x) && verdad(c.b, x);
  if (c.t === 'or') return verdad(c.a, x) || verdad(c.b, x);
  const l = jmesVal(c.l, x);
  if (c.t === 'truthy') return !(l == null || l === false || l === '' || (Array.isArray(l) && !l.length));
  const r = jmesVal(c.r, x);
  return c.op === '==' ? JSON.stringify(l) === JSON.stringify(r) : c.op === '!=' ? JSON.stringify(l) !== JSON.stringify(r)
    : c.op === '<' ? l < r : c.op === '>' ? l > r : c.op === '<=' ? l <= r : l >= r;
};
// Una proyección ([], [*], [?...]) aplica el resto de la cadena a cada
// elemento; un [] posterior aplana lo proyectado y sigue proyectando.
function aplicar(pasos, k, v) {
  if (k >= pasos.length) return v;
  const p = pasos[k];
  if (p.t === 'flatten' || p.t === 'wild' || p.t === 'filter') {
    if (!Array.isArray(v)) return null;
    let arr = v;
    if (p.t === 'flatten') arr = [].concat(...arr.map(x => Array.isArray(x) ? x : [x]));
    if (p.t === 'filter') arr = arr.filter(x => verdad(p.c, x));
    const j = pasos.findIndex((x, n) => n > k && x.t === 'flatten');
    if (j < 0) return arr.map(x => aplicar(pasos, k + 1, x)).filter(x => x != null);
    const parte = arr.map(x => aplicar(pasos.slice(0, j), k + 1, x)).filter(x => x != null);
    return aplicar(pasos, j, parte);
  }
  return aplicar(pasos, k + 1, jmesVal(p, v));
}
const jmes = (expr, datos) => jmesVal(jmesParse(expr), datos);
N.jmes = jmes;

// ------------------------------------------------------------------ salida
const esEscalar = x => x == null || typeof x !== 'object';
const txt = x => x == null ? 'None' : x === true ? 'True' : x === false ? 'False' : String(x);
function comoTexto(x, pref) {
  if (esEscalar(x)) return [(pref || '') + txt(x)];
  if (Array.isArray(x)) return x.every(esEscalar) ? [(pref || '') + x.map(txt).join('\t')] : [].concat(...x.map(y => comoTexto(y, pref)));
  const ks = Object.keys(x).sort(), esc = ks.filter(k => esEscalar(x[k])), anid = ks.filter(k => !esEscalar(x[k]));
  const out = esc.length ? [(pref || '') + esc.map(k => txt(x[k])).join('\t')] : [];
  anid.forEach(k => { comoTexto(x[k], k.toUpperCase() + '\t').forEach(l => out.push(l)); });
  return out;
}
function comoTabla(titulo, x) {
  let cab = null, filas;
  if (Array.isArray(x) && x.every(Array.isArray)) filas = x.map(f => f.map(txt));
  else if (Array.isArray(x) && x.every(esEscalar)) filas = x.map(f => [txt(f)]);
  else if (Array.isArray(x) && x.every(y => y && typeof y === 'object')) { cab = Array.from(new Set([].concat(...x.map(Object.keys)))); filas = x.map(o => cab.map(k => esEscalar(o[k]) ? txt(o[k]) : JSON.stringify(o[k]))); }
  else if (x && typeof x === 'object' && !Array.isArray(x)) { filas = Object.keys(x).map(k => [k, esEscalar(x[k]) ? txt(x[k]) : JSON.stringify(x[k])]); }
  else filas = [[txt(x)]];
  const nc = Math.max(1, ...filas.map(f => f.length), cab ? cab.length : 0);
  const w = []; for (let c = 0; c < nc; c++) w.push(Math.max(...filas.map(f => String(f[c] == null ? '' : f[c]).length), cab ? String(cab[c] || '').length : 0) + 4);
  let total = w.reduce((a, b) => a + b, 0) + nc - 1;
  if (total < titulo.length + 4) { w[nc - 1] += titulo.length + 4 - total; total = titulo.length + 4; }
  const sep = '+' + w.map(n => '-'.repeat(n)).join('+') + '+';
  const fila = f => '|' + w.map((n, c) => ('  ' + (f[c] == null ? '' : f[c])).padEnd(n)).join('|') + '|';
  const pad = Math.floor((total - titulo.length) / 2);
  const out = ['-'.repeat(total + 2), '|' + ' '.repeat(pad) + titulo + ' '.repeat(total - titulo.length - pad) + '|', sep];
  if (cab) out.push('|' + w.map((n, c) => (' ' + cab[c]).padEnd(n)).join('|') + '|', sep);
  filas.forEach(f => out.push(fila(f)));
  out.push(sep);
  return out;
}
const opNombre = op => op.split('-').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join('');
function salida(datos, o, op, resumen) {
  if (datos === undefined) return [];
  let x = datos;
  if (o.query) { try { x = jmes(o.query, datos); } catch (e) { return [L(e.message, 'err')]; } }
  const fmt = o.output || 'json';
  if (fmt === 'text') return comoTexto(x).map(l => L(l));
  if (fmt === 'table') {
    if (!o.query && resumen) return comoTabla(opNombre(op), resumen(datos)).map(l => L(l)).concat([L(T('(tabla resumida; con --query eliges las columnas)', '(summary table; pick the columns with --query)'), 'dim')]);
    return comoTabla(opNombre(op), x).map(l => L(l));
  }
  return JSON.stringify(x, null, 4).split('\n').map(l => L(l));
}

// ------------------------------------------------------------------ argumentos
const BANDERAS = ['dry-run', 'include-all-instances', 'latest', 'force', 'no-cli-pager', 'no-paginate', 'debug', 'no-verify-ssl', 'associate-public-ip-address', 'no-associate-public-ip-address', 'recursive', 'only-attached'];
function leerArgs(args) {
  const pos = [], o = {};
  for (let k = 0; k < args.length; k++) {
    const x = args[k];
    if (!/^--/.test(x)) { pos.push(x); continue; }
    let n = x.slice(2), v = null;
    if (n.indexOf('=') >= 0) { v = [n.slice(n.indexOf('=') + 1)]; n = n.slice(0, n.indexOf('=')); }
    if (!v) { v = []; if (BANDERAS.indexOf(n) < 0) while (k + 1 < args.length && !/^--/.test(args[k + 1])) v.push(args[++k]); }
    o[n] = v;
  }
  return { pos, o };
}
// --filters "Name=tag:Name,Values=web-01,web-02" "Name=instance-state-name,Values=running"
function leerFiltros(vals) {
  if (!vals || !vals.length) return [];
  const j = vals.join(' ').trim();
  if (/^\[/.test(j)) { try { return JSON.parse(j).map(f => ({ n: f.Name, v: f.Values })); } catch (e) { return null; } }
  return vals.map(s => { const m = /^Name=([^,]+),Values=(.+)$/.exec(s); return m ? { n: m[1], v: m[2].split(',') } : null; });
}
const coincide = (patron, val) => val != null && new RegExp('^' + String(patron).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(String(val));
// Un filtro de AWS: cada Name es una función que saca el (o los) valores del recurso.
const pasaFiltros = (filtros, campos) => filtros.every(f => { const g = campos[f.n]; if (!g) return true; const vs = [].concat(g()); return f.v.some(p => vs.some(v => coincide(p, v))); });

class ErrorAws { constructor(codigo, msg) { this.codigo = codigo; this.msg = msg; } }
const falla = (codigo, msg) => { throw new ErrorAws(codigo, msg); };
const requiere = (o, ...ks) => { const faltan = ks.filter(k => !o[k] || !o[k].length); if (faltan.length) throw new ErrorAws(null, 'aws: error: the following arguments are required: ' + faltan.map(k => '--' + k).join(', ')); };
const uno = (o, k) => (o[k] && o[k].length ? o[k][0] : null);
const lista = (o, k) => (o[k] || []).join(',').split(',').map(x => x.trim()).filter(Boolean);
const etiquetas = nombre => nombre ? [{ Key: 'Name', Value: nombre }] : [];
const deTags = tags => { const m = /Key=Name,Value=([^,}\]]+)/.exec(tags || ''); return m ? m[1] : null; };

// ------------------------------------------------------------------ EC2: instancias
const CODIGO = { pending: 0, running: 16, 'shutting-down': 32, terminated: 48, stopping: 64, stopped: 80 };
const estadoJ = e => ({ Code: CODIGO[e], Name: e });
function instJ(st, i) {
  const s = N.subred(st, i.subred) || { az: i.az };
  const o = { AmiLaunchIndex: 0, ImageId: i.ami, InstanceId: i.id, InstanceType: i.tipo };
  if (i.clave) o.KeyName = i.clave;
  Object.assign(o, { LaunchTime: iso(i.iniciada), Monitoring: { State: 'disabled' }, Placement: { AvailabilityZone: s.az, GroupName: '', Tenancy: 'default' },
    PrivateDnsName: 'ip-' + i.ipPriv.replace(/\./g, '-') + '.eu-west-1.compute.internal', PrivateIpAddress: i.ipPriv, ProductCodes: [],
    PublicDnsName: i.ipPub ? 'ec2-' + i.ipPub.replace(/\./g, '-') + '.eu-west-1.compute.amazonaws.com' : '' });
  if (i.ipPub) o.PublicIpAddress = i.ipPub;
  Object.assign(o, { State: estadoJ(i.estado), StateTransitionReason: i.motivo, SubnetId: i.subred, VpcId: i.vpc || ID.vpc, Architecture: 'x86_64',
    BlockDeviceMappings: N.volsDe(st, i).map(v => ({ DeviceName: v.device, Ebs: { AttachTime: iso(v.creado), DeleteOnTermination: !!v.raiz, Status: 'attached', VolumeId: v.id } })),
    EbsOptimized: true, Hypervisor: 'xen', RootDeviceName: '/dev/sda1', RootDeviceType: 'ebs',
    SecurityGroups: i.sgs.map(g => ({ GroupName: (N.sg(st, g) || { nombre: 'default' }).nombre, GroupId: g })), SourceDestCheck: true,
    Tags: etiquetas(i.nombre), VirtualizationType: 'hvm', PlatformDetails: 'Linux/UNIX' });
  if (i.perfil) o.IamInstanceProfile = { Arn: 'arn:aws:iam::' + ID.cuenta + ':instance-profile/' + i.perfil, Id: 'AIPA' + U.hex('perfil' + i.perfil, 17).toUpperCase() };
  return o;
}
const resumenInst = d => [].concat(...d.Reservations.map(r => r.Instances)).map(i => ({ Name: (i.Tags.find(t => t.Key === 'Name') || {}).Value || '', InstanceId: i.InstanceId, Type: i.InstanceType, AZ: i.Placement.AvailabilityZone, State: i.State.Name, PrivateIp: i.PrivateIpAddress, PublicIp: i.PublicIpAddress || '-' }));
const region = o => o._region || ID.region;
const enRegion = (i, o) => (i.region || ID.region) === region(o);
function instancias(st, o) {
  const ids = lista(o, 'instance-ids'), f = leerFiltros(o.filters);
  if (f && f.some(x => !x)) falla('InvalidParameterValue', 'The filter is invalid: use Name=...,Values=...');
  ids.forEach(id => { if (!st.aws.instancias.some(i => i.id === id && enRegion(i, o))) falla('InvalidInstanceID.NotFound', "The instance ID '" + id + "' does not exist"); });
  return st.aws.instancias.filter(i => enRegion(i, o) && (!ids.length || ids.indexOf(i.id) >= 0) && pasaFiltros(f || [], {
    'tag:Name': () => i.nombre, 'instance-state-name': () => i.estado, 'instance-id': () => i.id, 'subnet-id': () => i.subred, 'vpc-id': () => i.vpc || ID.vpc,
    'private-ip-address': () => i.ipPriv, 'ip-address': () => i.ipPub, 'availability-zone': () => (N.subred(st, i.subred) || { az: i.az }).az, 'instance-type': () => i.tipo,
    'instance.group-id': () => i.sgs, 'key-name': () => i.clave, 'image-id': () => i.ami }));
}
const idsObligatorios = (st, o) => { requiere(o, 'instance-ids'); return lista(o, 'instance-ids').map(id => { const i = st.aws.instancias.find(x => x.id === id && enRegion(x, o)); return i || falla('InvalidInstanceID.NotFound', "The instance ID '" + id + "' does not exist"); }); };
function cambioEstado(clave, st, o, accion) {
  const is = idsObligatorios(st, o);
  return { [clave]: is.map(i => { const antes = i.estado; accion(i); return { CurrentState: estadoJ(i.estado), InstanceId: i.id, PreviousState: estadoJ(antes) }; }) };
}
function consola(st, i) {
  const h = st.hosts[i.host];
  if (i.estado !== 'running' || !h) return '';
  return ['[    0.000000] Linux version ' + h.kernel + ' (buildd@lcy02-amd64-031) (x86_64-linux-gnu-gcc-12) #22~22.04.1-Ubuntu SMP',
    '[    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz-' + h.kernel + ' root=PARTUUID=' + U.uuid(i.id) + ' ro console=tty1 console=ttyS0 nvme_core.io_timeout=4294967295',
    '[    1.873120] EXT4-fs (nvme0n1p1): mounted filesystem with ordered data mode. Quota mode: none.',
    '[  OK  ] Started OpenBSD Secure Shell server.',
    ...Object.keys(h.svcs).filter(u => u !== 'ssh' && u !== 'chrony').map(u => h.svcs[u].estado === 'active' ? '[  OK  ] Started ' + U.desc(u) + '.' : h.svcs[u].estado === 'failed' ? '[FAILED] Failed to start ' + U.desc(u) + '.' : ''),
    'Cloud-init v. 24.1.3-0ubuntu1~22.04.1 finished at ' + U.larga(i.iniciada) + '. Datasource DataSourceEc2Local.  Up 14.21 seconds',
    '', 'Ubuntu 22.04.4 LTS ' + (i.nombre || 'ip-' + i.ipPriv.replace(/\./g, '-')) + ' ttyS0', ''].filter(x => x !== '').join('\n');
}
function estadoInst(st, i) {
  const listo = N.viva(st, i) || (!i.host && i.estado === 'running'), arrancando = st.reloj - i.iniciada < 2;
  const s = !listo ? 'initializing' : arrancando ? 'initializing' : 'ok', d = s === 'ok' ? 'passed' : 'initializing';
  return { AvailabilityZone: (N.subred(st, i.subred) || { az: i.az }).az, InstanceId: i.id, InstanceState: estadoJ(i.estado),
    InstanceStatus: { Details: [{ Name: 'reachability', Status: d }], Status: s }, SystemStatus: { Details: [{ Name: 'reachability', Status: d }], Status: s } };
}

// ------------------------------------------------------------------ EC2: red
function permisosJ(st, g) {
  const grupos = {};
  g.reglas.forEach(r => {
    const k = r.proto + '|' + r.desde + '|' + r.hasta;
    const p = grupos[k] = grupos[k] || (r.proto === '-1' ? { IpProtocol: '-1', IpRanges: [], Ipv6Ranges: [], PrefixListIds: [], UserIdGroupPairs: [] } : { FromPort: r.desde, IpProtocol: r.proto, IpRanges: [], Ipv6Ranges: [], PrefixListIds: [], ToPort: r.hasta, UserIdGroupPairs: [] });
    if (r.cidr) p.IpRanges.push(r.desc ? { CidrIp: r.cidr, Description: r.desc } : { CidrIp: r.cidr });
    if (r.sg) p.UserIdGroupPairs.push(Object.assign(r.desc ? { Description: r.desc } : {}, { GroupId: r.sg, UserId: ID.cuenta }));
  });
  return Object.keys(grupos).map(k => grupos[k]);
}
const sgJ = (st, g) => ({ Description: g.desc, GroupName: g.nombre, IpPermissions: permisosJ(st, g), OwnerId: ID.cuenta, GroupId: g.id,
  IpPermissionsEgress: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [], PrefixListIds: [], UserIdGroupPairs: [] }], Tags: g.nombre === 'default' ? [] : etiquetas(g.nombre), VpcId: ID.vpc });
function sgDe(st, o) {
  const id = uno(o, 'group-id'), n = uno(o, 'group-name');
  if (!id && !n) throw new ErrorAws(null, 'aws: error: one of the arguments --group-id --group-name is required');
  const g = id ? N.sg(st, id) : st.aws.sgs.find(x => x.nombre === n);
  if (!g) falla(id ? 'InvalidGroup.NotFound' : 'InvalidGroup.NotFound', "The security group '" + (id || n) + "' does not exist");
  return g;
}
// --protocol tcp --port 22 --cidr x/32 | --source-group sg-... | --ip-permissions IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=x/32}]
function reglaDe(st, o) {
  const ipp = (o['ip-permissions'] || []).join(' ');
  let proto, desde, hasta, cidr = null, sg = null, desc = null;
  if (ipp) {
    const g = k => { const m = new RegExp(k + '=([^,}\\]\\s]+)').exec(ipp); return m ? m[1] : null; };
    proto = g('IpProtocol'); desde = +g('FromPort'); hasta = +g('ToPort'); cidr = g('CidrIp'); sg = g('GroupId'); desc = g('Description');
    if (/^\[?\{?"/.test(ipp)) { try { const j = [].concat(JSON.parse(ipp))[0]; proto = j.IpProtocol; desde = j.FromPort; hasta = j.ToPort; cidr = j.IpRanges && j.IpRanges[0] && j.IpRanges[0].CidrIp; sg = j.UserIdGroupPairs && j.UserIdGroupPairs[0] && j.UserIdGroupPairs[0].GroupId; } catch (e) { falla('InvalidParameterValue', 'Error parsing parameter --ip-permissions'); } }
  } else {
    proto = uno(o, 'protocol'); const port = uno(o, 'port'); cidr = uno(o, 'cidr'); sg = uno(o, 'source-group');
    if (!proto) throw new ErrorAws(null, 'aws: error: argument --protocol is required with --port / --cidr');
    if (proto === 'all' || proto === '-1') { proto = '-1'; desde = 0; hasta = 65535; }
    else { if (!port) falla('InvalidParameterValue', 'Invalid value for portRange. Must specify both from and to ports with TCP/UDP.'); const ps = port.split('-'); desde = +ps[0]; hasta = +(ps[1] || ps[0]); }
  }
  if (proto !== '-1' && (isNaN(desde) || isNaN(hasta) || desde > hasta)) falla('InvalidParameterValue', 'Invalid value for portRange.');
  if (!cidr && !sg) falla('MissingParameter', 'No CIDR or source security group specified in the request');
  if (cidr && !N.cidrValido(cidr)) falla('InvalidParameterValue', 'Value (' + cidr + ') for parameter cidrIp is invalid. This is not a valid CIDR block.');
  if (sg && !N.sg(st, sg)) falla('InvalidGroup.NotFound', "The security group '" + sg + "' does not exist");
  return { proto, desde, hasta, cidr, sg, desc };
}
const mismaRegla = (a, b) => a.proto === b.proto && a.desde === b.desde && a.hasta === b.hasta && (a.cidr || null) === (b.cidr || null) && (a.sg || null) === (b.sg || null);
const textoRegla = r => 'peer: ' + (r.cidr || r.sg) + ', ' + (r.proto === '-1' ? 'ALL' : r.proto.toUpperCase()) + ', from port: ' + r.desde + ', to port: ' + r.hasta + ', ALLOW';
function rutaJ(st, r) {
  const o = { DestinationCidrBlock: r.dest };
  if (r.gw) o.GatewayId = r.gw; if (r.nat) o.NatGatewayId = r.nat;
  o.Origin = r.gw === 'local' ? 'CreateRouteTable' : 'CreateRoute';
  o.State = N.rutaActiva(st, r) ? 'active' : 'blackhole';
  return o;
}
const rtJ = (st, t) => ({ Associations: st.aws.subredes.filter(s => s.rt === t.id).map(s => ({ Main: false, RouteTableAssociationId: 'rtbassoc-0' + U.hex(t.id + s.id, 16), RouteTableId: t.id, SubnetId: s.id, AssociationState: { State: 'associated' } })),
  PropagatingVgws: [], RouteTableId: t.id, Routes: t.rutas.map(r => rutaJ(st, r)), Tags: etiquetas(t.nombre), VpcId: ID.vpc, OwnerId: ID.cuenta });
function rtDe(st, o) { requiere(o, 'route-table-id'); const t = N.rt(st, uno(o, 'route-table-id')); if (!t) falla('InvalidRouteTableID.NotFound', "The routeTable ID '" + uno(o, 'route-table-id') + "' does not exist"); return t; }
function destinoRuta(st, o) {
  const nat = uno(o, 'nat-gateway-id'), gw = uno(o, 'gateway-id');
  if (!nat && !gw) falla('MissingParameter', 'The request must contain exactly one of gatewayId, natGatewayId, networkInterfaceId, vpcPeeringConnectionId, transitGatewayId or instanceId');
  if (nat) { const n = N.nat(st, nat); if (!n || n.estado === 'deleted') falla('InvalidNatGatewayID.NotFound', "The natGateway ID '" + nat + "' does not exist"); return { nat }; }
  if (gw !== ID.igw) falla('InvalidGatewayID.NotFound', "The gateway ID '" + gw + "' does not exist");
  return { gw };
}

// ------------------------------------------------------------------ EC2: discos
const volJ = (st, v) => {
  const i = st.aws.instancias.find(x => x.id === v.inst);
  return { Attachments: i ? [{ AttachTime: iso(v.creado), Device: v.device, InstanceId: i.id, State: 'attached', VolumeId: v.id, DeleteOnTermination: !!v.raiz }] : [],
    AvailabilityZone: i ? N.subred(st, i.subred).az : 'eu-west-1a', CreateTime: iso(v.creado), Encrypted: true, Size: v.tam, SnapshotId: v.raiz ? 'snap-0' + U.hex('ami' + v.id, 16) : '',
    State: i ? 'in-use' : 'available', VolumeId: v.id, Iops: 3000, Tags: etiquetas((i ? i.nombre : 'vol') + (v.raiz ? '-root' : '-data')), VolumeType: 'gp3', MultiAttachEnabled: false, Throughput: 125 };
};
const modJ = (v, m) => ({ VolumeId: v.id, ModificationState: m.estado, TargetSize: m.objetivo, TargetIops: 3000, TargetVolumeType: 'gp3', TargetThroughput: 125, TargetMultiAttachEnabled: false,
  OriginalSize: m.original, OriginalIops: 3000, OriginalVolumeType: 'gp3', OriginalThroughput: 125, OriginalMultiAttachEnabled: false,
  Progress: m.estado === 'completed' ? 100 : m.estado === 'modifying' ? 0 : 40, StartTime: iso(m.desde) });
const snapJ = s => ({ Description: s.desc, Encrypted: true, OwnerId: ID.cuenta, Progress: s.estado === 'completed' ? '100%' : '27%', SnapshotId: s.id, StartTime: iso(s.desde), State: s.estado, VolumeId: s.vol, VolumeSize: s.tam, StorageTier: 'standard', Tags: [] });
function volDe(st, o) { requiere(o, 'volume-id'); const v = N.vol(st, uno(o, 'volume-id')); if (!v) falla('InvalidVolume.NotFound', "The volume '" + uno(o, 'volume-id') + "' does not exist."); return v; }

// ------------------------------------------------------------------ CloudWatch
function alarmaJ(st, a) {
  const d = a.def, f = iso(st.reloj);
  const razon = a.estado === 'INSUFFICIENT_DATA' ? 'Insufficient Data: 1 datapoint was unknown.'
    : 'Threshold Crossed: 1 out of the last 1 datapoints [' + Number(a.valor).toFixed(1) + ' (' + f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(2, 4) + ' ' + f.slice(11, 16) + ':00)] was ' + (a.estado === 'ALARM' ? '' : 'not ') + (d.op === 'LessThanThreshold' ? 'less than' : 'greater than or equal to') + ' the threshold (' + d.umbral.toFixed(1) + ') (minimum 1 datapoint for ' + (a.estado === 'ALARM' ? 'OK -> ALARM' : 'ALARM -> OK') + ' transition).';
  const desde = st.alertasDesde[a.nombre + '|' + (a.host || '')];
  return { AlarmName: a.nombre, AlarmArn: 'arn:aws:cloudwatch:eu-west-1:' + ID.cuenta + ':alarm:' + a.nombre, AlarmDescription: d.desc, ActionsEnabled: true,
    OKActions: [], AlarmActions: ['arn:aws:sns:eu-west-1:' + ID.cuenta + ':tienda-guardia'], InsufficientDataActions: [], StateValue: a.estado, StateReason: razon,
    StateUpdatedTimestamp: iso(a.estado === 'ALARM' && desde != null ? desde : st.reloj - 30), MetricName: d.metrica, Namespace: d.ns, Statistic: d.metrica === 'procstat_lookup_pid_count' ? 'Minimum' : 'Average',
    Dimensions: d.dim.map(([n, v]) => ({ Name: n, Value: v })), Period: 60, EvaluationPeriods: 1, Threshold: d.umbral, ComparisonOperator: d.op, TreatMissingData: 'missing' };
}

// ------------------------------------------------------------------ operaciones
const REGIONES = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-south-2', 'eu-north-1', 'ap-southeast-1', 'sa-east-1'];
const OPS = {
  sts: {
    'get-caller-identity': (st, o) => { const yo = o._yo; return { datos: yo.rol ? { UserId: 'AROA' + U.hex('rol' + yo.rol, 17).toUpperCase() + ':' + yo.sesion, Account: ID.cuenta, Arn: yo.arn } : { UserId: 'AIDA' + U.hex(yo.usuario, 17).toUpperCase(), Account: ID.cuenta, Arn: yo.arn } }; },
  },
  ec2: {
    'describe-instances': (st, o) => ({ datos: { Reservations: instancias(st, o).map(i => ({ Groups: [], Instances: [instJ(st, i)], OwnerId: ID.cuenta, ReservationId: 'r-0' + U.hex('res' + i.id, 16) })) }, resumen: resumenInst }),
    'describe-instance-status': (st, o) => ({ datos: { InstanceStatuses: instancias(st, o).filter(i => o['include-all-instances'] ? i.estado !== 'terminated' : i.estado === 'running').map(i => estadoInst(st, i)) } }),
    'start-instances': (st, o) => ({ datos: cambioEstado('StartingInstances', st, o, i => { if (i.estado === 'stopped') N.arrancar(st, i); else if (i.estado !== 'running' && i.estado !== 'pending') falla('IncorrectInstanceState', "The instance '" + i.id + "' is not in a state from which it can be started."); }) }),
    'stop-instances': (st, o) => ({ datos: cambioEstado('StoppingInstances', st, o, i => { if (i.estado === 'running' || i.estado === 'pending') N.parar(st, i); else if (i.estado === 'terminated') falla('IncorrectInstanceState', "The instance '" + i.id + "' is not in a state from which it can be stopped."); }) }),
    'reboot-instances': (st, o) => { idsObligatorios(st, o).forEach(i => { if (i.estado !== 'running') falla('IncorrectState', "The instance '" + i.id + "' is not in the 'running' state."); if (st.hosts[i.host]) P.reiniciar(st, st.hosts[i.host]); }); return { datos: undefined }; },
    'terminate-instances': (st, o) => ({ datos: cambioEstado('TerminatingInstances', st, o, i => { if (i.estado !== 'terminated' && i.estado !== 'shutting-down') N.terminar(st, i); }) }),
    'run-instances': (st, o) => {
      requiere(o, 'image-id');
      const ami = uno(o, 'image-id'), tipo = uno(o, 'instance-type') || 'm1.small', sub = uno(o, 'subnet-id'), clave = uno(o, 'key-name');
      const n = +(uno(o, 'count') || 1);
      if (!N.ami(st, ami)) falla('InvalidAMIID.NotFound', "The image id '[" + ami + "]' does not exist");
      if (!N.TIPOS[tipo]) falla('InvalidParameterValue', "Invalid value '" + tipo + "' for InstanceType.");
      if (!sub) falla('VPCIdNotSpecified', 'No default VPC for this user. GroupName is only supported for EC2-Classic and default VPC.');
      if (!N.subred(st, sub)) falla('InvalidSubnetID.NotFound', "The subnet ID '" + sub + "' does not exist");
      const sgs = lista(o, 'security-group-ids');
      sgs.forEach(g => { if (!N.sg(st, g)) falla('InvalidGroup.NotFound', "The security group '" + g + "' does not exist in VPC '" + ID.vpc + "'"); });
      if (clave && clave !== N.CLAVE) falla('InvalidKeyPair.NotFound', "The key pair '" + clave + "' does not exist");
      if (n < 1 || n > 3) falla('InvalidParameterValue', 'MaxCount must be between 1 and 3 in this account');
      const nombre = deTags((o['tag-specifications'] || []).join(' '));
      const nuevas = []; for (let k = 0; k < n; k++) nuevas.push(N.lanzar(st, { ami, tipo, subred: sub, sgs: sgs.length ? sgs : [ID.sg.default], clave, nombre }));
      return { datos: { Groups: [], Instances: nuevas.map(i => instJ(st, i)), OwnerId: ID.cuenta, ReservationId: 'r-0' + U.hex('res' + nuevas[0].id, 16) } };
    },
    'get-console-output': (st, o) => { requiere(o, 'instance-id'); const i = st.aws.instancias.find(x => x.id === uno(o, 'instance-id') && enRegion(x, o)); if (!i) falla('InvalidInstanceID.NotFound', "The instance ID '" + uno(o, 'instance-id') + "' does not exist"); return { datos: { InstanceId: i.id, Output: consola(st, i), Timestamp: iso(st.reloj) }, texto: d => d.Output ? d.Output.split('\n') : [] }; },
    'wait': (st, o, pos) => {
      const que = pos[0], es = () => instancias(st, o).filter(i => i.estado !== 'terminated' || que === 'instance-terminated');
      const cond = { 'instance-running': () => es().length && es().every(i => i.estado === 'running'), 'instance-stopped': () => es().length && es().every(i => i.estado === 'stopped'),
        'instance-terminated': () => es().length && es().every(i => i.estado === 'terminated'), 'instance-status-ok': () => es().length && es().every(i => estadoInst(st, i).InstanceStatus.Status === 'ok'),
        'volume-in-use': () => true, 'snapshot-completed': () => st.aws.snapshots.every(s => s.estado === 'completed') }[que];
      if (!cond) throw new ErrorAws(null, 'aws: error: argument wait: Invalid choice, valid choices are: instance-running | instance-stopped | instance-terminated | instance-status-ok | snapshot-completed | volume-in-use');
      const n = U.hasta(st, cond, 40);
      if (!cond()) throw new ErrorAws(null, 'Waiter ' + opNombre(que).replace(/^Instance/, 'Instance') + ' failed: Max attempts exceeded');
      return { datos: undefined, minutos: 0, extra: n };
    },
    'describe-security-groups': (st, o) => {
      const ids = lista(o, 'group-ids'), ns = lista(o, 'group-names'), f = leerFiltros(o.filters) || [];
      ids.forEach(id => { if (!N.sg(st, id)) falla('InvalidGroup.NotFound', "The security group '" + id + "' does not exist"); });
      return { datos: { SecurityGroups: st.aws.sgs.filter(g => (!ids.length || ids.indexOf(g.id) >= 0) && (!ns.length || ns.indexOf(g.nombre) >= 0) && pasaFiltros(f, { 'group-name': () => g.nombre, 'group-id': () => g.id, 'vpc-id': () => ID.vpc, 'tag:Name': () => g.nombre })).map(g => sgJ(st, g)) } };
    },
    'authorize-security-group-ingress': (st, o) => {
      const g = sgDe(st, o), r = reglaDe(st, o);
      const ya = g.reglas.find(x => mismaRegla(x, r));
      if (ya) falla('InvalidPermission.Duplicate', 'the specified rule "' + textoRegla(r) + '" already exists');
      const nueva = Object.assign({ id: 'sgr-0' + U.hex('regla' + (st.aws.reglasN++), 16) }, r);
      if (!nueva.desc) delete nueva.desc;
      g.reglas.push(nueva);
      return { datos: { Return: true, SecurityGroupRules: [Object.assign({ SecurityGroupRuleId: nueva.id, GroupId: g.id, GroupOwnerId: ID.cuenta, IsEgress: false, IpProtocol: r.proto, FromPort: r.proto === '-1' ? -1 : r.desde, ToPort: r.proto === '-1' ? -1 : r.hasta }, r.cidr ? { CidrIpv4: r.cidr } : { ReferencedGroupInfo: { GroupId: r.sg, UserId: ID.cuenta } })] } };
    },
    'revoke-security-group-ingress': (st, o) => {
      const g = sgDe(st, o), porId = lista(o, 'security-group-rule-ids');
      if (porId.length) {
        porId.forEach(id => { if (!g.reglas.some(x => x.id === id)) falla('InvalidSecurityGroupRuleId.NotFound', "The security group rule ID '" + id + "' does not exist"); });
        g.reglas = g.reglas.filter(x => porId.indexOf(x.id) < 0);
        return { datos: { Return: true } };
      }
      const r = reglaDe(st, o), k = g.reglas.findIndex(x => mismaRegla(x, r));
      if (k < 0) falla('InvalidPermission.NotFound', 'The specified rule does not exist in this security group.');
      g.reglas.splice(k, 1);
      return { datos: { Return: true } };
    },
    'describe-vpcs': () => ({ datos: { Vpcs: [{ CidrBlock: '10.0.0.0/16', DhcpOptionsId: 'dopt-0' + U.hex('dhcp', 16), State: 'available', VpcId: ID.vpc, OwnerId: ID.cuenta, InstanceTenancy: 'default', IsDefault: false, Tags: etiquetas('tienda-prod') }] } }),
    'describe-subnets': (st, o) => { const f = leerFiltros(o.filters) || [], ids = lista(o, 'subnet-ids'); return { datos: { Subnets: st.aws.subredes.filter(s => (!ids.length || ids.indexOf(s.id) >= 0) && pasaFiltros(f, { 'tag:Name': () => s.nombre, 'subnet-id': () => s.id, 'vpc-id': () => ID.vpc, 'availability-zone': () => s.az })).map(s => ({ AvailabilityZone: s.az, AvailableIpAddressCount: 251 - st.aws.instancias.filter(i => i.subred === s.id && i.estado !== 'terminated').length, CidrBlock: s.cidr, DefaultForAz: false, MapPublicIpOnLaunch: s.publica, State: 'available', SubnetId: s.id, VpcId: ID.vpc, OwnerId: ID.cuenta, Tags: etiquetas(s.nombre) })) } }; },
    'describe-route-tables': (st, o) => { const ids = lista(o, 'route-table-ids'), f = leerFiltros(o.filters) || []; ids.forEach(id => { if (!N.rt(st, id)) falla('InvalidRouteTableID.NotFound', "The routeTable ID '" + id + "' does not exist"); }); return { datos: { RouteTables: st.aws.rts.filter(t => (!ids.length || ids.indexOf(t.id) >= 0) && pasaFiltros(f, { 'tag:Name': () => t.nombre, 'route-table-id': () => t.id, 'vpc-id': () => ID.vpc, 'association.subnet-id': () => st.aws.subredes.filter(s => s.rt === t.id).map(s => s.id) })).map(t => rtJ(st, t)) } }; },
    'replace-route': (st, o) => { const t = rtDe(st, o); requiere(o, 'destination-cidr-block'); const d = uno(o, 'destination-cidr-block'), r = t.rutas.find(x => x.dest === d); if (!r) falla('InvalidParameterValue', "There is no route defined for '" + d + "' in the route table. Use CreateRoute instead."); if (r.gw === 'local') falla('InvalidParameterValue', 'cannot replace local route'); const nd = destinoRuta(st, o); delete r.gw; delete r.nat; Object.assign(r, nd); return { datos: undefined }; },
    'create-route': (st, o) => { const t = rtDe(st, o); requiere(o, 'destination-cidr-block'); const d = uno(o, 'destination-cidr-block'); if (t.rutas.some(x => x.dest === d)) falla('RouteAlreadyExists', 'The route identified by ' + d + ' already exists.'); t.rutas.push(Object.assign({ dest: d }, destinoRuta(st, o))); return { datos: { Return: true } }; },
    'delete-route': (st, o) => { const t = rtDe(st, o); requiere(o, 'destination-cidr-block'); const d = uno(o, 'destination-cidr-block'), k = t.rutas.findIndex(x => x.dest === d); if (k < 0 || t.rutas[k].gw === 'local') falla('InvalidRoute.NotFound', "no route with destination-cidr-block " + d + " in route table " + t.id); t.rutas.splice(k, 1); return { datos: undefined }; },
    'describe-nat-gateways': (st, o) => { const f = leerFiltros(o.filters) || []; return { datos: { NatGateways: st.aws.nats.filter(n => pasaFiltros(f, { state: () => n.estado, 'nat-gateway-id': () => n.id, 'subnet-id': () => n.subred, 'vpc-id': () => ID.vpc })).map(n => Object.assign({ CreateTime: iso(n.creado) }, n.estado === 'deleted' ? { DeleteTime: iso(n.borrado) } : {}, { NatGatewayAddresses: [{ AllocationId: 'eipalloc-0' + U.hex('eip' + n.id, 16), NetworkInterfaceId: 'eni-0' + U.hex('eni' + n.id, 16), PrivateIp: n.ipPriv, PublicIp: n.ipPub, IsPrimary: true, Status: n.estado === 'deleted' ? 'disassociating' : 'succeeded' }], NatGatewayId: n.id, State: n.estado, SubnetId: n.subred, VpcId: ID.vpc, Tags: etiquetas(n.nombre), ConnectivityType: 'public' })) } }; },
    'describe-internet-gateways': () => ({ datos: { InternetGateways: [{ Attachments: [{ State: 'available', VpcId: ID.vpc }], InternetGatewayId: ID.igw, OwnerId: ID.cuenta, Tags: etiquetas('tienda-igw') }] } }),
    'describe-volumes': (st, o) => { const ids = lista(o, 'volume-ids'), f = leerFiltros(o.filters) || []; ids.forEach(id => { if (!N.vol(st, id)) falla('InvalidVolume.NotFound', "The volume '" + id + "' does not exist."); }); return { datos: { Volumes: st.aws.volumenes.filter(v => (!ids.length || ids.indexOf(v.id) >= 0) && pasaFiltros(f, { 'attachment.instance-id': () => v.inst, 'volume-id': () => v.id, status: () => 'in-use', 'tag:Name': () => volJ(st, v).Tags.map(t => t.Value) })).map(v => volJ(st, v)) } }; },
    'modify-volume': (st, o) => {
      const v = volDe(st, o), tam = uno(o, 'size') == null ? v.tam : +uno(o, 'size');
      if (uno(o, 'volume-type') && uno(o, 'volume-type') !== 'gp3') falla('InvalidParameterValue', 'This simulator only keeps gp3 volumes');
      const ultima = v.mods[v.mods.length - 1];
      if (ultima && ultima.estado === 'modifying') falla('IncorrectModificationState', 'Volume ' + v.id + ' is currently being modified.');
      if (ultima && st.reloj - ultima.desde < 360) falla('VolumeModificationRateExceeded', "You've reached the maximum modification rate per volume limit. Wait at least 6 hours between modifications per EBS volume.");
      if (isNaN(tam) || tam < v.tam) falla('InvalidParameterValue', 'New size cannot be smaller than existing size');
      if (tam > 16384) falla('InvalidParameterValue', 'Volume of ' + tam + 'GiB is too large for volume type gp3; maximum is 16384GiB.');
      if (tam === v.tam) falla('InvalidParameterCombination', 'New configuration cannot be the same as the existing volume configuration');
      const m = { desde: st.reloj, original: v.tam, objetivo: tam, estado: 'modifying' };
      v.mods.push(m); v.tam = tam;
      return { datos: { VolumeModification: modJ(v, m) } };
    },
    'describe-volumes-modifications': (st, o) => { const ids = lista(o, 'volume-ids'); return { datos: { VolumesModifications: [].concat(...st.aws.volumenes.filter(v => !ids.length || ids.indexOf(v.id) >= 0).map(v => v.mods.map(m => modJ(v, m)))) } }; },
    'create-snapshot': (st, o) => {
      const v = volDe(st, o), a = st.aws;
      const s = { id: 'snap-0' + U.hex('snap' + (a.snapsN++), 16), vol: v.id, tam: v.tam, desc: (o.description || []).join(' '), estado: 'pending', desde: st.reloj, listoEn: st.reloj + Math.max(2, Math.ceil(v.tam / 60)) };
      a.snapshots.push(s);
      return { datos: Object.assign(snapJ(s), { Progress: '' }) };
    },
    'describe-snapshots': (st, o) => { const ids = lista(o, 'snapshot-ids'), f = leerFiltros(o.filters) || []; return { datos: { Snapshots: st.aws.snapshots.filter(s => (!ids.length || ids.indexOf(s.id) >= 0) && pasaFiltros(f, { 'volume-id': () => s.vol, status: () => s.estado })).map(snapJ) } }; },
    'describe-images': (st, o) => { const ids = lista(o, 'image-ids'), propias = lista(o, 'owners').indexOf('self') >= 0; return { datos: { Images: st.aws.amis.filter(a => ids.length ? ids.indexOf(a.id) >= 0 : !propias || a.propia).map(a => ({ Architecture: 'x86_64', CreationDate: iso(a.creado).replace('+00:00', '.000Z'), ImageId: a.id, ImageLocation: (a.propia ? ID.cuenta : '099720109477') + '/' + a.nombre, ImageType: 'machine', Public: !a.propia, OwnerId: a.propia ? ID.cuenta : '099720109477', State: 'available', Description: a.desc, Name: a.nombre, RootDeviceName: '/dev/sda1', RootDeviceType: 'ebs', VirtualizationType: 'hvm' })) } }; },
    'create-tags': (st, o) => {
      requiere(o, 'resources', 'tags');
      const n = deTags((o.tags || []).join(' '));
      lista(o, 'resources').forEach(id => {
        const i = st.aws.instancias.find(x => x.id === id);
        if (!i) falla(/^i-/.test(id) ? 'InvalidInstanceID.NotFound' : 'InvalidID', "The ID '" + id + "' is not valid");
        if (n) i.nombre = n;
      });
      return { datos: undefined };
    },
    'describe-key-pairs': () => ({ datos: { KeyPairs: [{ KeyPairId: 'key-0' + U.hex('kp', 16), KeyFingerprint: '6c:2a:91:' + U.hex('fp', 8).match(/../g).join(':'), KeyName: N.CLAVE, KeyType: 'rsa', Tags: [], CreateTime: iso(-60000) }] } }),
  },
  cloudwatch: {
    'describe-alarms': (st, o) => {
      const est = uno(o, 'state-value'), nombres = lista(o, 'alarm-names').length ? (o['alarm-names'] || []) : [], pref = uno(o, 'alarm-name-prefix');
      if (est && ['OK', 'ALARM', 'INSUFFICIENT_DATA'].indexOf(est) < 0) throw new ErrorAws(null, 'aws: error: argument --state-value: Invalid choice, valid choices are: OK | ALARM | INSUFFICIENT_DATA');
      return { datos: { MetricAlarms: N.alarmas(st).filter(a => (!est || a.estado === est) && (!nombres.length || nombres.indexOf(a.nombre) >= 0) && (!pref || a.nombre.indexOf(pref) === 0)).map(a => alarmaJ(st, a)), CompositeAlarms: [] },
        resumen: d => d.MetricAlarms.map(a => ({ AlarmName: a.AlarmName, State: a.StateValue, Metric: a.MetricName })) };
    },
  },
  configure: {
    list: (st) => ({ lineas: ['      Name                    Value             Type    Location', '      ----                    -----             ----    --------', '   profile                <not set>             None    None', 'access_key     ****************MPLE shared-credentials-file', 'secret_key     ****************EKEY shared-credentials-file', '    region                eu-west-1      config-file    ~/.aws/config'].map(x => L(x)) }),
  },
};
// Lo que no está pero existe en la CLI real: se dice claramente.
const AYUDA_SERVICIOS = ['ec2', 'cloudwatch', 'sts', 'configure'];
const PREFIJO = { ec2: 'ec2', cloudwatch: 'cloudwatch', iam: 'iam', elbv2: 'elasticloadbalancing', s3api: 's3', sts: 'sts' };

function errorAws(op, e) {
  if (e.codigo == null) return [L(''), L(e.msg, 'err')];
  return [L(''), L('An error occurred (' + e.codigo + ') when calling the ' + opNombre(op) + ' operation: ' + e.msg, 'err')];
}
U.cmd('aws', {
  ayuda: T('la CLI de AWS: aws ec2 ..., aws cloudwatch ..., aws sts get-caller-identity', 'the AWS CLI: aws ec2 ..., aws cloudwatch ..., aws sts get-caller-identity'), grupo: 'AWS',
  completar: () => AYUDA_SERVICIOS.concat(Object.keys(OPS.ec2), Object.keys(OPS.cloudwatch), ['get-caller-identity', '--output', 'table', 'text', 'json', '--query', '--filters', '--instance-ids', '--group-id', '--region']),
  fn: ctx => {
    const st = ctx.st, a = ctx.args;
    // Tu equipo trae la CLI con tus claves; las instancias con rol, con las del rol;
    // las demás ni la tienen instalada.
    const yo = N.identidad(st, ctx.ses);
    if (!yo) return { lineas: [L("Command 'aws' not found, but can be installed with:", 'err'), L(''), L('sudo snap install aws-cli --classic', 'err'), L(T('(esta instancia no tiene rol de IAM, así que tampoco tiene la CLI: los comandos de AWS se lanzan desde tu equipo)', '(this instance has no IAM role, so it has no CLI either: AWS commands are run from your workstation)'), 'dim')], minutos: 0 };
    if (!a.length) return [L('usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]', 'err'), L('To see help text, you can run:', 'err'), L(''), L('  aws help'), L('  aws <command> help'), L('  aws <command> <subcommand> help'), L(''), L('aws: error: the following arguments are required: command', 'err')];
    if (a[0] === '--version') return [L('aws-cli/2.17.40 Python/3.11.9 Linux/6.8.0-45-generic exe/x86_64.ubuntu.24')];
    const { pos, o } = leerArgs(a);
    const g = { output: uno(o, 'output'), query: o.query ? o.query.join(' ') : null, region: uno(o, 'region') };
    ['output', 'query', 'region', 'profile', 'no-cli-pager', 'no-paginate', 'debug', 'no-verify-ssl'].forEach(k => delete o[k]);
    const svc = pos[0], op = pos[1];
    o._region = g.region || ID.region; o._yo = yo;
    if (svc === 'help' || (!op && OPS[svc]) || op === 'help') {
      const s = OPS[svc];
      return [L(T('Servicios y operaciones que entiende esta CLI simulada:', 'Services and operations this simulated CLI understands:'), 'dim'), L('')]
        .concat((s ? [svc] : AYUDA_SERVICIOS).map(x => L('  aws ' + x + '  ' + Object.keys(OPS[x]).join(' | '))))
        .concat([L(''), L(T('Opciones globales: --output json|text|table · --query JMESPATH · --region', 'Global options: --output json|text|table · --query JMESPATH · --region'), 'dim')]);
    }
    if (!OPS[svc]) return [L('usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]', 'err'), L(''), L('aws: error: argument command: Invalid choice, valid choices are:', 'err'), L(''), L('  ' + AYUDA_SERVICIOS.join(' | ') + T('  (y muchos más en la CLI real)', '  (and many more in the real CLI)'), 'dim')];
    const fn = OPS[svc][op];
    if (!fn) return [L('usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]', 'err'), L(''), L('aws: error: argument operation: Invalid choice, valid choices are:', 'err'), L(''), L('  ' + Object.keys(OPS[svc]).join(' | '), 'dim'), L(T('(el simulador sólo implementa estas; la CLI real tiene muchas más)', '(the simulator implements only these; the real CLI has many more)'), 'dim')];
    if (g.output && ['json', 'text', 'table', 'yaml'].indexOf(g.output) < 0) return [L(''), L("aws: error: argument --output: Invalid choice, valid choices are: json | text | table | yaml | yaml-stream", 'err')];
    if (g.output === 'yaml') g.output = 'json';
    if (g.region && REGIONES.indexOf(g.region) < 0) return [L(''), L('Could not connect to the endpoint URL: "https://' + svc + '.' + g.region + '.amazonaws.com/"', 'err')];
    // Otra región: la red de la tienda está entera en eu-west-1. Las instancias sí
    // se buscan donde estén (alguien pudo lanzarlas en otra región).
    if (g.region && g.region !== ID.region && svc === 'ec2' && /^describe-/.test(op)) {
      const vacio = { 'describe-security-groups': { SecurityGroups: [] }, 'describe-volumes': { Volumes: [] }, 'describe-route-tables': { RouteTables: [] }, 'describe-subnets': { Subnets: [] }, 'describe-vpcs': { Vpcs: [] } }[op];
      if (vacio) return salida(vacio, g, op);
    }
    if (o['dry-run']) return [L(''), L('An error occurred (DryRunOperation) when calling the ' + opNombre(op) + ' operation: Request would have succeeded, but DryRun flag is set.', 'err')];
    try {
      // Permisos: lo que la operación necesita, contra las políticas de quien la lanza.
      const permiso = fn.permiso ? fn.permiso(o, pos.slice(2), st) : (svc === 'sts' || op === 'wait' || svc === 'configure') ? null : { accion: (PREFIJO[svc] || svc) + ':' + opNombre(op), recurso: '*' };
      [].concat(permiso || []).forEach(p => N.autorizar(st, yo, p.accion, p.recurso, opNombre(op), svc));
      const r = fn(st, o, pos.slice(2), ctx);
      if (r.lineas) return { lineas: r.lineas, fallo: r.fallo };
      if (r.texto && g.output === 'text' && !g.query) return { lineas: r.texto(r.datos).map(x => L(x)) };
      return { lineas: salida(r.datos, g, op, r.resumen), minutos: r.minutos };
    } catch (e) {
      if (e instanceof ErrorAws) return { lineas: errorAws(op, e), fallo: true };
      throw e;
    }
  } });

// servicios.js (IAM, S3, ELB) se engancha aquí: añade sus operaciones a OPS y
// usa las mismas utilidades.
N.cli = { OPS, AYUDA: AYUDA_SERVICIOS, PREFIJO, ErrorAws, falla, requiere, uno, lista, leerFiltros, pasaFiltros, etiquetas, deTags, iso, opNombre, instJ, instancias, salida };
// Sin servicios.js: tu equipo puede con todo y las instancias no tienen CLI.
N.identidad = N.identidad || ((st, ses) => ses.host === P.entrada ? { usuario: 'sre-ops', arn: 'arn:aws:iam::' + ID.cuenta + ':user/sre-ops' } : null);
N.autorizar = N.autorizar || (() => true);
})(window.PUESTO = window.PUESTO || {});
