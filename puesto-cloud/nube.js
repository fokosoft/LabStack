// Puesto Cloud · la nube: una cuenta de AWS simulada sobre el motor del Puesto.
//
// Las instancias son nodos del motor (servidores Ubuntu con systemctl, df,
// journalctl...). Lo demás vive en st.aws: VPC, subredes, tablas de rutas, NAT,
// security groups, volúmenes EBS, snapshots. Una sola fuente de verdad, como en
// el Puesto Linux: lo que contesta `aws ec2 describe-instances`, si `ssh` llega
// o se queda colgado, lo que pinta el panel y las alarmas salen de este estado.
//
// Simulador educativo independiente: no tiene relación con Amazon Web Services.
// Usa los nombres de los servicios y de los comandos porque es lo que se enseña.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, HOME = U.HOME;
const N = P.nube = {};

// ------------------------------------------------------------------ identificadores
// Deterministas: los mismos en cada partida, para que los tickets, sus guiones
// y el solucionario puedan nombrarlos.
const idDe = (pref, sem) => pref + '-0' + U.hex('nube:' + sem, 16);
const ID = N.ID = {
  cuenta: '123456789012', region: 'eu-west-1',
  vpc: idDe('vpc', 'vpc'), igw: idDe('igw', 'igw'),
  nat: idDe('nat', 'nat-2026-09'), natViejo: idDe('nat', 'nat-2025'),
  rtPub: idDe('rtb', 'pub'), rtPriv: idDe('rtb', 'priv'),
  subred: {}, sg: {}, inst: {}, vol: {},
  ami: { web: idDe('ami', 'web'), base: idDe('ami', 'ubuntu') },
};
const SUBREDES = [
  ['public-a', '10.0.1.0/24', 'eu-west-1a', true], ['public-b', '10.0.2.0/24', 'eu-west-1b', true], ['public-c', '10.0.3.0/24', 'eu-west-1c', true],
  ['private-a', '10.0.11.0/24', 'eu-west-1a', false], ['private-b', '10.0.12.0/24', 'eu-west-1b', false],
];
SUBREDES.forEach(s => { ID.subred[s[0]] = idDe('subnet', s[0]); });
['bastion', 'web', 'app', 'db', 'default'].forEach(n => { ID.sg[n] = idDe('sg', n); });
// nombre, tipo, subred, security group, IP pública, AMI
const INSTANCIAS = [
  ['bastion', 't3.micro', 'public-a', 'bastion', '34.248.51.17', 'base'],
  ['web-01', 't3.small', 'public-a', 'web', '52.18.140.66', 'web'],
  ['web-02', 't3.small', 'public-b', 'web', '54.76.203.9', 'web'],
  ['app-01', 't3.medium', 'private-a', 'app', null, 'base'],
  ['db-01', 'm6i.large', 'private-b', 'db', null, 'base'],
];
INSTANCIAS.forEach(i => { ID.inst[i[0]] = idDe('i', i[0]); ID.vol[i[0]] = idDe('vol', i[0] + '-raiz'); });
ID.vol['db-01-datos'] = idDe('vol', 'db-01-datos');
const TAM_RAIZ = { bastion: 8, 'web-01': 20, 'web-02': 20, 'app-01': 20, 'db-01': 20 };
// El perfil de instancia (rol de IAM) de cada una: con él tiene credenciales y CLI.
const PERFIL = { 'web-01': 'tienda-web-role', 'web-02': 'tienda-web-role', 'app-01': 'tienda-api-role' };
N.PERFIL = PERFIL;
N.OFICINA = '203.0.113.10';
N.CLAVE = 'tienda-prod';
N.TIPOS = { 't3.micro': { cpu: 2, ram: 1 }, 't3.small': { cpu: 2, ram: 2 }, 't3.medium': { cpu: 2, ram: 4 }, 't3.large': { cpu: 2, ram: 8 }, 'm6i.large': { cpu: 2, ram: 8 }, 'm6i.xlarge': { cpu: 4, ram: 16 } };
// Las IP públicas que va dando AWS al arrancar: siempre las mismas, en orden.
const POOL_IP = ['34.245.112.83', '52.49.201.37', '54.170.66.145', '34.242.9.211', '52.214.180.28', '63.33.75.190', '34.251.140.6', '54.155.23.97'];
// El id que tendrá la n-ésima instancia lanzada en la partida (los guiones lo nombran).
N.idLanzada = n => idDe('i', 'lanzada-' + n);
N.siguienteIpPublica = st => POOL_IP[st.aws.ipsDadas % POOL_IP.length];

// ------------------------------------------------------------------ estado
P.alCrear.push(st => {
  const a = st.aws = { miIp: N.OFICINA, ipsDadas: 0, lanzadas: 0, reglasN: 0, snapsN: 0 };
  a.subredes = SUBREDES.map(([n, cidr, az, pub]) => ({ id: ID.subred[n], nombre: n, cidr, az, publica: pub, rt: pub ? ID.rtPub : ID.rtPriv }));
  a.rts = [
    { id: ID.rtPub, nombre: 'tienda-public', rutas: [{ dest: '10.0.0.0/16', gw: 'local' }, { dest: '0.0.0.0/0', gw: ID.igw }] },
    { id: ID.rtPriv, nombre: 'tienda-private', rutas: [{ dest: '10.0.0.0/16', gw: 'local' }, { dest: '0.0.0.0/0', nat: ID.nat }] },
  ];
  a.nats = [{ id: ID.nat, nombre: 'tienda-nat', subred: ID.subred['public-a'], estado: 'available', ipPub: '52.30.87.214', ipPriv: '10.0.1.140', creado: -2880 }];
  const r = (desde, hasta, o) => Object.assign({ proto: 'tcp', desde, hasta, id: 'sgr-0' + U.hex('regla' + (a.reglasN++), 16) }, o);
  a.sgs = [
    { id: ID.sg.bastion, nombre: 'tienda-bastion', desc: T('SSH al bastion solo desde la oficina', 'SSH to the bastion from the office only'),
      reglas: [r(22, 22, { cidr: N.OFICINA + '/32', desc: T('Oficina Madrid', 'Madrid office') })] },
    { id: ID.sg.web, nombre: 'tienda-web', desc: T('Frontales web de la tienda', 'Store web servers'),
      reglas: [r(80, 80, { cidr: '0.0.0.0/0', desc: 'HTTP' }), r(443, 443, { cidr: '0.0.0.0/0', desc: 'HTTPS' }), r(22, 22, { sg: ID.sg.bastion, desc: T('SSH desde el bastion', 'SSH from the bastion') })] },
    { id: ID.sg.app, nombre: 'tienda-app', desc: T('API de la tienda', 'Store API'),
      reglas: [r(8080, 8080, { sg: ID.sg.web, desc: T('API desde los frontales', 'API from the web servers') }), r(22, 22, { sg: ID.sg.bastion, desc: T('SSH desde el bastion', 'SSH from the bastion') })] },
    { id: ID.sg.db, nombre: 'tienda-db', desc: T('PostgreSQL de la tienda', 'Store PostgreSQL'),
      reglas: [r(5432, 5432, { sg: ID.sg.app, desc: T('PostgreSQL desde la API', 'PostgreSQL from the API') }), r(22, 22, { sg: ID.sg.bastion, desc: T('SSH desde el bastion', 'SSH from the bastion') })] },
    // El de toda VPC: lo que AWS pone si lanzas sin decir otro. Sólo deja entrar a sus propios miembros.
    { id: ID.sg.default, nombre: 'default', desc: 'default VPC security group', reglas: [r(0, 65535, { proto: '-1', sg: ID.sg.default })] },
  ];
  a.instancias = INSTANCIAS.map(([n, tipo, sub, sg, ipPub, ami]) => ({
    id: ID.inst[n], nombre: n, tipo, subred: ID.subred[sub], sgs: [ID.sg[sg]], ipPriv: st.hosts[n].ip, ipPub, ami: ID.ami[ami],
    clave: N.CLAVE, estado: 'running', lanzada: -43200, iniciada: -43200, motivo: '', host: n, listoEn: null, perfil: PERFIL[n] || null,
  }));
  a.volumenes = INSTANCIAS.map(([n]) => ({ id: ID.vol[n], inst: ID.inst[n], tam: TAM_RAIZ[n], visible: TAM_RAIZ[n], part: TAM_RAIZ[n] - 0.11, raiz: true, device: '/dev/sda1', nvme: 'nvme0n1', montaje: '/', creado: -43200, mods: [] }));
  a.volumenes.push({ id: ID.vol['db-01-datos'], inst: ID.inst['db-01'], tam: 100, visible: 100, raiz: false, device: '/dev/sdf', nvme: 'nvme1n1', montaje: '/var/lib/postgresql', creado: -43200, mods: [] });
  a.snapshots = [];
  a.amis = [
    { id: ID.ami.web, nombre: 'tienda-web-2026-09-01', desc: T('Ubuntu 22.04 + nginx + front de la tienda', 'Ubuntu 22.04 + nginx + store front end'), creado: -32000, propia: true, unidades: ['nginx'] },
    { id: ID.ami.base, nombre: 'ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-20260901', desc: 'Canonical, Ubuntu, 22.04 LTS, amd64 jammy image', creado: -33000, propia: false, unidades: [] },
  ];
});

// ------------------------------------------------------------------ consultas
const ipNum = ip => ip.split('.').reduce((a, b) => a * 256 + (+b), 0);
N.enCidr = (ip, cidr) => {
  const [base, bits] = cidr.split('/'), b = +bits;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip || '') || !/^\d+\.\d+\.\d+\.\d+$/.test(base || '') || isNaN(b)) return false;
  if (b === 0) return true;
  const m = Math.pow(2, 32 - b);
  return Math.floor(ipNum(ip) / m) === Math.floor(ipNum(base) / m);
};
N.cidrValido = c => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.test(c || '') && c.split('/')[0].split('.').every(x => +x <= 255) && +c.split('/')[1] <= 32;
N.inst = (st, ref) => st.aws.instancias.find(i => i.id === ref) || st.aws.instancias.find(i => i.nombre === ref && i.estado !== 'terminated');
N.instDeHost = (st, host) => st.aws.instancias.find(i => i.host === host && i.estado !== 'terminated');
N.instPorIp = (st, ip) => st.aws.instancias.find(i => i.estado !== 'terminated' && (i.ipPub === ip || i.ipPriv === ip));
N.sg = (st, id) => st.aws.sgs.find(g => g.id === id);
N.subred = (st, id) => st.aws.subredes.find(s => s.id === id);
N.rt = (st, id) => st.aws.rts.find(r => r.id === id);
N.nat = (st, id) => st.aws.nats.find(n => n.id === id);
N.vol = (st, id) => st.aws.volumenes.find(v => v.id === id);
N.volsDe = (st, i) => st.aws.volumenes.filter(v => v.inst === i.id);
N.ami = (st, id) => st.aws.amis.find(a => a.id === id);
N.nombreDe = x => x.nombre;
// Viva = arrancada en AWS y con el sistema operativo levantado.
N.viva = (st, i) => !!(i && i.estado === 'running' && st.hosts[i.host] && st.hosts[i.host].up);
// ¿Algún security group de la instancia deja entrar a ese puerto desde ese origen?
N.permite = (st, i, puerto, origen) => i.sgs.some(gid => {
  const g = N.sg(st, gid);
  return g && g.reglas.some(r => (r.proto === '-1' || (r.proto === 'tcp' && puerto >= r.desde && puerto <= r.hasta))
    && ((r.cidr && origen.ip && N.enCidr(origen.ip, r.cidr)) || (r.sg && origen.sgs && origen.sgs.indexOf(r.sg) >= 0)));
});
N.rutaDefecto = (st, subredId) => { const s = N.subred(st, subredId), rt = s && N.rt(st, s.rt); return rt ? rt.rutas.find(r => r.dest === '0.0.0.0/0') : null; };
N.rutaActiva = (st, r) => r.gw === 'local' || r.gw === ID.igw || !!(r.nat && N.nat(st, r.nat) && N.nat(st, r.nat).estado === 'available');
// Por dónde sale a internet una subred: 'igw', 'nat' o null.
N.salidaSubred = (st, subredId) => {
  const r = N.rutaDefecto(st, subredId);
  if (!r || !N.rutaActiva(st, r)) return null;
  return r.gw === ID.igw ? 'igw' : r.nat ? 'nat' : null;
};
// La IP con la que una instancia sale a internet, o null si no sale.
N.ipSalida = (st, i) => {
  if (!N.viva(st, i)) return null;
  const s = N.salidaSubred(st, i.subred);
  if (s === 'igw') return i.ipPub || null;   // en una subred pública, sin IP pública no hay salida
  if (s === 'nat') { const r = N.rutaDefecto(st, i.subred); return N.nat(st, r.nat).ipPub; }
  return null;
};
N.desdeInternet = (st, i, puerto, ipOrigen) => N.viva(st, i) && !!i.ipPub && N.salidaSubred(st, i.subred) === 'igw' && N.permite(st, i, puerto, { ip: ipOrigen });
N.desdeVpc = (st, origen, i, puerto) => N.viva(st, origen) && N.viva(st, i) && (origen === i || N.permite(st, i, puerto, { ip: origen.ipPriv, sgs: origen.sgs }));
// ¿Escucha alguien en ese puerto dentro de la instancia?
N.escucha = (st, i, puerto) => {
  const h = st.hosts[i.host]; if (!h) return false;
  const svc = { 22: 'ssh', 80: 'nginx', 443: 'nginx', 8080: 'tienda-api', 5432: 'postgresql' }[puerto];
  return !!(svc && h.svcs[svc] && h.svcs[svc].estado === 'active');
};
N.webSana = (st, i) => N.desdeInternet(st, i, 80, '198.51.100.200') && N.escucha(st, i, 80);
// Lo que sirve nginx en los frontales: la portada y la comprobación de salud. Lo demás, 404.
N.rutaWeb = ruta => ['', '/', '/index.html', '/health'].indexOf((ruta || '').split('?')[0]) >= 0;
// Otros servicios contestan en curl: buckets de S3, el balanceador (servicios.js).
N.webExterna = [];
N.webs = st => st.aws.instancias.filter(i => /^web-/.test(i.nombre) && i.estado !== 'terminated');
N.sshAbierto = st => st.aws.sgs.filter(g => g.reglas.some(r => r.cidr === '0.0.0.0/0' && (r.proto === '-1' || (r.desde <= 22 && r.hasta >= 22))));

// ------------------------------------------------------------------ ciclo de vida
// Parar, arrancar, reiniciar, terminar: el estado de AWS y el del sistema
// operativo van juntos. El motor levanta el nodo (servicios habilitados) en el
// minuto en que la instancia pasa a running.
N.parar = (st, i, min) => {
  const h = st.hosts[i.host];
  if (h && h.up) { P.alApagar.forEach(f => f(st, h)); }
  if (h) { h.up = false; h.vuelveEn = null; }
  i.estado = min == null ? 'stopping' : 'stopped'; i.listoEn = st.reloj + 1;
  i.motivo = 'User initiated (' + U.iso(min == null ? st.reloj : min).replace('T', ' ') + ' GMT)';
  i.ipPub = null;
};
N.arrancar = (st, i) => {
  const h = st.hosts[i.host];
  i.estado = 'pending'; i.listoEn = st.reloj + 1; i.motivo = '';
  if (h) h.vuelveEn = st.reloj + 1;
  const s = N.subred(st, i.subred);
  if (s && s.publica && !i.ipPub) { i.ipPub = N.siguienteIpPublica(st); st.aws.ipsDadas++; }
};
N.terminar = (st, i) => {
  const h = st.hosts[i.host];
  if (h && h.up) P.alApagar.forEach(f => f(st, h));
  if (h) { h.up = false; h.vuelveEn = null; }
  i.estado = 'shutting-down'; i.listoEn = st.reloj + 1; i.motivo = 'User initiated (' + U.iso(st.reloj).replace('T', ' ') + ' GMT)';
};
// Una instancia nueva: un nodo nuevo en el motor, que arranca en el minuto siguiente.
N.lanzar = (st, o) => {
  const a = st.aws, s = N.subred(st, o.subred), ami = N.ami(st, o.ami);
  const n = o.nombre || ('ip-' + o.ipPriv.replace(/\./g, '-'));
  const host = st.hosts[n] ? n + '-' + (a.lanzadas + 1) : n;
  const tipo = N.TIPOS[o.tipo] || N.TIPOS['t3.small'];
  const usados = a.instancias.filter(i => i.estado !== 'terminated').map(i => i.ipPriv);
  let ip = null; for (let k = 10; k < 250 && !ip; k++) { const c = s.cidr.split('.').slice(0, 3).join('.') + '.' + k; if (usados.indexOf(c) < 0) ip = c; }
  const h = U.crearHost({ n: host, rol: /web/.test(n) ? 'web' : 'otro', ip, kernel: '6.5.0-1022-aws', unidades: ami.unidades.slice(), ram: tipo.ram, ramBase: 0.4,
    discos: { '/': { dev: '/dev/root', tamG: 7.6, baseG: 2.2 } }, logs: ami.unidades.indexOf('nginx') >= 0 ? { '/var/log/nginx/access.log': 0.1, '/var/log/nginx/error.log': 0.01 } : {} }, st.reloj);
  h.up = false; h.vuelveEn = st.reloj + 1;
  st.hosts[host] = h;
  a.lanzadas++;
  const i = { id: idDe('i', 'lanzada-' + a.lanzadas), nombre: o.nombre || '', tipo: o.tipo, subred: s.id, sgs: o.sgs.slice(), ipPriv: ip, ipPub: null, ami: ami.id,
    clave: o.clave || null, estado: 'pending', lanzada: st.reloj, iniciada: st.reloj + 1, motivo: '', host, listoEn: st.reloj + 1, perfil: o.perfil || null };
  if (s.publica) { i.ipPub = N.siguienteIpPublica(st); a.ipsDadas++; }
  a.instancias.push(i);
  a.volumenes.push({ id: idDe('vol', 'lanzada-' + a.lanzadas), inst: i.id, tam: 8, visible: 8, part: 7.89, raiz: true, device: '/dev/sda1', nvme: 'nvme0n1', montaje: '/', creado: st.reloj, mods: [] });
  return i;
};

P.ticks.push(st => {
  const a = st.aws; if (!a) return;
  a.instancias.forEach(i => {
    if (i.listoEn == null || st.reloj < i.listoEn) return;
    if (i.estado === 'pending') { i.estado = 'running'; i.iniciada = st.reloj; i.listoEn = null; }
    else if (i.estado === 'stopping') { i.estado = 'stopped'; i.listoEn = null; }
    else if (i.estado === 'shutting-down') {
      i.estado = 'terminated'; i.listoEn = null; i.ipPub = null;
      delete st.hosts[i.host];
      a.volumenes = a.volumenes.filter(v => !(v.inst === i.id && v.raiz));
    }
  });
  a.volumenes.forEach(v => v.mods.forEach(m => {
    if (m.estado === 'modifying' && st.reloj >= m.desde + 1) { m.estado = 'optimizing'; v.visible = m.objetivo; }
    if (m.estado === 'optimizing' && st.reloj >= m.desde + 12) m.estado = 'completed';
  }));
  a.snapshots.forEach(s => { if (s.estado === 'pending' && st.reloj >= s.listoEn) s.estado = 'completed'; });
});

// ------------------------------------------------------------------ alarmas
// CloudWatch: cada alarma existe siempre, en OK, ALARM o INSUFFICIENT_DATA. Las
// que están en ALARM son las alertas del motor (panel, `aws cloudwatch
// describe-alarms --state-value ALARM`, y lo que un ticket exige apagar).
const sinDatos = () => ({ estado: 'INSUFFICIENT_DATA', valor: null });
const umbral = (valor, lim, unidad) => ({ estado: valor >= lim ? 'ALARM' : 'OK', valor });
const DEFS = [];
['bastion', 'web-01', 'web-02', 'app-01', 'db-01'].forEach(n => {
  [['/', 'root'], ['/var/lib/postgresql', 'data']].forEach(([m, k]) => {
    if (m !== '/' && n !== 'db-01') return;
    DEFS.push({ nombre: n + '-disk-' + k + '-high', ns: 'CWAgent', metrica: 'disk_used_percent', dim: [['InstanceId', ID.inst[n]], ['path', m]], umbral: 85, op: 'GreaterThanOrEqualToThreshold', host: n,
      desc: T('Disco ' + m + ' de ' + n + ' por encima del 85 %', n + ' disk ' + m + ' above 85%'),
      eval: st => { const i = N.inst(st, ID.inst[n]); if (!N.viva(st, i) || !st.hosts[n].discos[m]) return sinDatos(); const p = U.pctDisco(st.hosts[n], m); return Object.assign(umbral(p, 85), { sev: p >= 95 ? 'critical' : 'warning', res: T(m + ' al ' + p + ' %', m + ' at ' + p + '%') }); } });
  });
});
[['web-01', 'nginx'], ['web-02', 'nginx'], ['app-01', 'tienda-api'], ['db-01', 'postgresql']].forEach(([n, svc]) => {
  DEFS.push({ nombre: n + '-' + svc + '-down', ns: 'CWAgent', metrica: 'procstat_lookup_pid_count', dim: [['InstanceId', ID.inst[n]], ['pattern', svc]], umbral: 1, op: 'LessThanThreshold', host: n,
    desc: T(svc + ' no corre en ' + n, svc + ' is not running on ' + n),
    eval: st => { const i = N.inst(st, ID.inst[n]); if (!N.viva(st, i)) return sinDatos(); const s = st.hosts[n].svcs[svc], ok = s && s.estado === 'active'; return { estado: ok ? 'OK' : 'ALARM', valor: ok ? 1 : 0, sev: 'critical', res: T(svc + ' no está corriendo', svc + ' is not running') }; } });
});
DEFS.push({ nombre: 'tienda-web-healthy-hosts', ns: 'Tienda/Web', metrica: 'HealthyHostCount', dim: [], umbral: 2, op: 'LessThanThreshold', host: null,
  desc: T('Menos de dos frontales sirviendo la web', 'Fewer than two web servers serving the site'),
  eval: st => { const n = N.webs(st).filter(i => N.webSana(st, i)).length; return { estado: n < 2 ? 'ALARM' : 'OK', valor: n, sev: 'warning', res: T('sólo ' + n + ' de 2 frontales sirven la web', 'only ' + n + ' of 2 web servers are serving') }; } });
DEFS.push({ nombre: 'tienda-home-canary', ns: 'CloudWatchSynthetics', metrica: 'SuccessPercent', dim: [['CanaryName', 'tienda-home']], umbral: 100, op: 'LessThanThreshold', host: null,
  desc: T('La portada de la tienda no responde desde internet', 'The store home page does not respond from the internet'),
  eval: st => { const n = N.webs(st).filter(i => N.webSana(st, i)).length; return { estado: n ? 'OK' : 'ALARM', valor: n ? 100 : 0, sev: 'critical', res: T('la web no responde desde internet', 'the site does not respond from the internet') }; } });
DEFS.push({ nombre: 'tienda-api-payment-errors', ns: 'Tienda/API', metrica: 'PaymentGatewayErrors', dim: [['Service', 'tienda-api']], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: 'app-01',
  desc: T('tienda-api no consigue hablar con la pasarela de pagos', 'tienda-api cannot talk to the payment gateway'),
  eval: st => { const i = N.inst(st, ID.inst['app-01']), s = i && st.hosts[i.host] && st.hosts[i.host].svcs['tienda-api']; if (!N.viva(st, i) || !s || s.estado !== 'active') return sinDatos(); const ok = !!N.ipSalida(st, i); return { estado: ok ? 'OK' : 'ALARM', valor: ok ? 0 : 412, sev: 'critical', res: T('tienda-api no llega a la pasarela de pagos (sin salida a internet)', 'tienda-api cannot reach the payment gateway (no internet egress)') }; } });
DEFS.push({ nombre: 'sg-ssh-open-to-world', ns: 'Tienda/Security', metrica: 'OpenSshToWorld', dim: [['ConfigRule', 'restricted-ssh']], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: null,
  desc: T('Algún security group abre el puerto 22 a 0.0.0.0/0', 'A security group opens port 22 to 0.0.0.0/0'),
  eval: st => { const g = N.sshAbierto(st); return { estado: g.length ? 'ALARM' : 'OK', valor: g.length, sev: 'warning', res: T('el puerto 22 está abierto a todo internet en ' + g.map(x => x.nombre).join(', '), 'port 22 is open to the whole internet on ' + g.map(x => x.nombre).join(', ')) }; } });
N.DEFS = DEFS;
N.alarmas = st => DEFS.map(d => Object.assign({ nombre: d.nombre, def: d, sev: 'warning', host: d.host }, d.eval(st)));

// Las alertas del motor en esta app son las alarmas de CloudWatch, y sólo ellas.
P.detectores.length = 0;
P.detectores.push((st, add) => { if (st.aws) N.alarmas(st).filter(x => x.estado === 'ALARM').forEach(x => add(x.nombre, x.sev, x.host, x.res)); });

// ------------------------------------------------------------------ servicios
Object.assign(U.DESC, { nginx: 'A high performance web server and a reverse proxy server', postgresql: 'PostgreSQL RDBMS', 'tienda-api': 'Tienda API (Node.js)' });
Object.assign(P.roles, {
  ops: T('Tu equipo: CLI de AWS y claves SSH', 'Your workstation: AWS CLI and SSH keys'),
  bastion: T('Bastión: la única entrada SSH a la VPC', 'Bastion: the only SSH way into the VPC'),
  web: T('Frontal web (nginx)', 'Web server (nginx)'),
  app: T('Aplicación (tienda-api)', 'Application (tienda-api)'),
  db: T('Base de datos (PostgreSQL 14)', 'Database (PostgreSQL 14)'),
  otro: T('Instancia EC2', 'EC2 instance'),
});
// PostgreSQL no arranca con el disco de datos lleno.
P.motivos['pg-sin-espacio'] = {
  journal: (st, h, u, min) => [{ t: 'FATAL:  could not write lock file "postmaster.pid": No space left on device' }, { t: 'pg_ctl: could not start server' }],
  result: 'exit-code',
};
P.reglas.push((st, h, u) => u === 'postgresql' && h.discos['/var/lib/postgresql'] && U.pctDisco(h, '/var/lib/postgresql') >= 100 ? 'pg-sin-espacio' : null);

// ------------------------------------------------------------------ ficheros
const fijo = arr => ({ lineas: () => arr, mb: arr.join('\n').length / 1048576 });
const LEEME = T([
  '# Operación de la tienda en AWS', '',
  '## Cuenta y región',
  '- Cuenta 123456789012, región eu-west-1 (Irlanda). La CLI de este equipo ya está configurada (~/.aws/).', '',
  '## Red',
  '- VPC tienda-prod, 10.0.0.0/16.',
  '- Subredes públicas public-a/b/c: el bastión y los frontales web. Salen a internet por el internet gateway.',
  '- Subredes privadas private-a/b: tienda-api y PostgreSQL. Salen a internet por el NAT gateway; desde fuera no se llega a ellas.',
  '- Se entra a todo por el bastión: ssh bastion, y ssh web-01, app-01, db-01... saltan por él (ProxyJump en ~/.ssh/config).', '',
  '## Normas de la casa',
  '1. El puerto 22 no se abre nunca a 0.0.0.0/0: sólo a la IP de la oficina, con /32.',
  '2. Antes de tocar un volumen, snapshot.',
  '3. Todo recurso lleva la etiqueta Name.',
  '4. La base de datos y la API no tienen IP pública ni ruta directa a internet.',
  '5. Se mira antes de tocar y se comprueba después: las alarmas de CloudWatch son el termómetro.', '',
  '## Para empezar',
  '- aws ec2 describe-instances --output table',
  '- aws cloudwatch describe-alarms --state-value ALARM',
  '- aws ec2 describe-security-groups --group-ids sg-...',
  '- aws ec2 describe-route-tables',
], [
  '# Running the store on AWS', '',
  '## Account and region',
  '- Account 123456789012, region eu-west-1 (Ireland). The CLI on this workstation is already configured (~/.aws/).', '',
  '## Network',
  '- VPC tienda-prod, 10.0.0.0/16.',
  '- Public subnets public-a/b/c: the bastion and the web servers. They reach the internet through the internet gateway.',
  '- Private subnets private-a/b: tienda-api and PostgreSQL. They reach the internet through the NAT gateway; nothing outside can reach them.',
  '- Everything is accessed through the bastion: ssh bastion, and ssh web-01, app-01, db-01... jump through it (ProxyJump in ~/.ssh/config).', '',
  '## House rules',
  '1. Port 22 is never opened to 0.0.0.0/0: only to the office IP, as a /32.',
  '2. Snapshot before touching a volume.',
  '3. Every resource carries a Name tag.',
  '4. The database and the API have no public IP and no direct route to the internet.',
  '5. Look before you touch, check afterwards: the CloudWatch alarms are the thermometer.', '',
  '## Getting started',
  '- aws ec2 describe-instances --output table',
  '- aws cloudwatch describe-alarms --state-value ALARM',
  '- aws ec2 describe-security-groups --group-ids sg-...',
  '- aws ec2 describe-route-tables',
]);
P.ficheros.push((st, h) => {
  if (!st.aws) return {};
  const f = {};
  if (h.rol === 'ops') {
    const b = N.inst(st, ID.inst.bastion);
    const ssh = ['Host bastion', '    HostName ' + (b && b.ipPub ? b.ipPub : '34.248.51.17'), '    User ubuntu', '    IdentityFile ~/.ssh/tienda-prod.pem', ''];
    INSTANCIAS.slice(1).forEach(([n]) => { const i = N.inst(st, ID.inst[n]); ssh.push('Host ' + n, '    HostName ' + i.ipPriv, '    User ubuntu', '    IdentityFile ~/.ssh/tienda-prod.pem', '    ProxyJump bastion', ''); });
    f[HOME + '/.ssh/config'] = fijo(ssh);
    f[HOME + '/.ssh/tienda-prod.pem'] = fijo(['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA' + U.hex('clave-tienda', 48), '(…)', '-----END RSA PRIVATE KEY-----']);
    f[HOME + '/.aws/config'] = fijo(['[default]', 'region = eu-west-1', 'output = json']);
    f[HOME + '/.aws/credentials'] = fijo(['[default]', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE', 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY']);
    f[HOME + '/LEEME.md'] = fijo(LEEME);
  }
  if (h.svcs.nginx) f['/etc/nginx/sites-enabled/tienda'] = fijo(['server {', '    listen 80 default_server;', '    listen 443 ssl default_server;', '    server_name tienda.example;', '    root /var/www/tienda;', '    location /api/ { proxy_pass http://10.0.11.30:8080; }', '}']);
  if (h.svcs['tienda-api']) f['/etc/tienda-api/config.env'] = fijo(['PORT=8080', 'DATABASE_URL=postgres://tienda@10.0.12.40:5432/tienda', 'PAYMENT_GATEWAY=https://api.pasarela-pagos.example/v2']);
  if (h.svcs.postgresql) f['/etc/postgresql/14/main/postgresql.conf'] = fijo(["data_directory = '/var/lib/postgresql/14/main'", "listen_addresses = '*'", 'max_connections = 200', 'shared_buffers = 2GB']);
  return f;
});

// ------------------------------------------------------------------ ssh
// Llegar a una instancia depende de lo mismo que en AWS: que esté arrancada,
// que tenga IP pública y ruta al internet gateway (si vienes de fuera), que su
// security group deje entrar al 22 desde donde vienes, y la clave y el usuario.
const timeout = (ip, extra) => ({ lineas: [L('ssh: connect to host ' + ip + ' port 22: Connection timed out', 'err')].concat(extra || []), minutos: 2 });
function resolverSsh(st, ses, dest, user, clave, salto) {
  // El ~/.ssh/config de tu equipo: nombres, usuario, clave y el salto por el bastión.
  if (ses.host === P.entrada) {
    const nombres = { bastion: ID.inst.bastion }; INSTANCIAS.slice(1).forEach(([n]) => { nombres[n] = ID.inst[n]; });
    if (nombres[dest]) {
      const i = N.inst(st, nombres[dest]);
      return { i, ip: dest === 'bastion' ? (i.ipPub || '34.248.51.17') : i.ipPriv, user: user || 'ubuntu', clave: clave || '~/.ssh/tienda-prod.pem', salto: dest === 'bastion' ? salto : (salto || 'bastion') };
    }
  }
  const i = /^\d+\.\d+\.\d+\.\d+$/.test(dest) ? N.instPorIp(st, dest) : null;
  if (!i && !/^\d+\.\d+\.\d+\.\d+$/.test(dest)) return { error: 'ssh: Could not resolve hostname ' + dest + ': Name or service not known' };
  return { i, ip: dest, user: user || (ses.host === P.entrada ? 'admin' : 'ubuntu'), clave, salto };
}
// ¿Llega el 22 desde la sesión (o desde el salto) hasta la instancia?
function llega(st, ses, r) {
  const i = r.i;
  if (r.salto) {
    if (ses.host !== P.entrada) return { ok: false, ip: r.ip };
    const b = resolverSsh(st, ses, r.salto, null, null, null);
    if (b.error) return { ok: false, error: b.error.replace(/^ssh:/, 'ssh: (ProxyJump)') };
    if (!(b.i && N.desdeInternet(st, b.i, 22, st.aws.miIp) && N.escucha(st, b.i, 22))) return { ok: false, ip: b.ip, salto: true };
    return { ok: !!(i && N.desdeVpc(st, b.i, i, 22) && N.escucha(st, i, 22) && (r.ip === i.ipPriv)), ip: r.ip };
  }
  if (!i) return { ok: false, ip: r.ip };
  if (ses.host === P.entrada) return { ok: r.ip === i.ipPub && N.desdeInternet(st, i, 22, st.aws.miIp) && N.escucha(st, i, 22), ip: r.ip };
  const origen = N.instDeHost(st, ses.host);
  if (r.ip === i.ipPriv) return { ok: !!origen && N.desdeVpc(st, origen, i, 22) && N.escucha(st, i, 22), ip: r.ip };
  return { ok: !!origen && !!N.ipSalida(st, origen) && N.desdeInternet(st, i, 22, N.ipSalida(st, origen)) && N.escucha(st, i, 22), ip: r.ip };
}
function bienvenida(st, i, desde) {
  const h = st.hosts[i.host], uso = (U.usadoG(h, '/') / h.discos['/'].tamG * 100).toFixed(1);
  const ram = Math.round(((h.ramBase || 0) + Object.keys(h.svcs).filter(u => h.svcs[u].estado === 'active').reduce((x, u) => x + U.rss(st, h, u), 0)) / U.ramTotal(h) * 100);
  return [L('Welcome to Ubuntu 22.04.4 LTS (GNU/Linux ' + h.kernel + ' x86_64)'), L(''), L(' * Documentation:  https://help.ubuntu.com', 'dim'), L(''),
    L('  System information as of ' + U.fechaCorta(st.reloj).replace(/ (\d{4})$/, ' UTC $1'), 'dim'), L(''),
    L('  System load:  0.' + String(8 + (i.nombre.length % 9)).padStart(2, '0') + '              Processes:             ' + (104 + Object.keys(h.svcs).length * 3), 'dim'),
    L(('  Usage of /:   ' + uso + '% of ' + h.discos['/'].tamG.toFixed(2) + 'GB').padEnd(36) + 'Users logged in:       0', 'dim'),
    L(('  Memory usage: ' + ram + '%').padEnd(36) + 'IPv4 address for ens5: ' + i.ipPriv, 'dim'), L(''),
    L(' * ' + (P.roles[h.rol] || i.nombre), 'dim'),
    L('Last login: ' + U.fechaCorta(st.reloj - 133) + ' from ' + desde)];
}
U.cmd('ssh', { ayuda: T('entra en una instancia (ssh web-01, ssh -i clave.pem ubuntu@IP, ssh -J bastion ubuntu@10.0.x.x)', 'log in to an instance (ssh web-01, ssh -i key.pem ubuntu@IP, ssh -J bastion ubuntu@10.0.x.x)'), grupo: T('Acceso', 'Access'), fn: ctx => {
  const st = ctx.st, ses = ctx.ses, a = ctx.args.slice();
  let clave = null, salto = null, dest = null; const resto = [];
  for (let k = 0; k < a.length; k++) {
    const x = a[k];
    if (dest) { resto.push(x); continue; }
    if (x === '-i') { clave = a[++k]; continue; }
    if (x === '-J') { salto = a[++k]; continue; }
    if (x === '-o' || x === '-p' || x === '-l' || x === '-F') { k++; continue; }
    if (/^-/.test(x)) continue;
    dest = x;
  }
  if (!dest) return [L('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-i identity_file] [-J destination] destination [command]', 'err')];
  let user = null;
  if (dest.indexOf('@') >= 0) { user = dest.split('@')[0]; dest = dest.split('@').slice(1).join('@'); }
  if (salto && salto.indexOf('@') >= 0) salto = salto.split('@').pop();
  const r = resolverSsh(st, ses, dest, user, clave, salto);
  if (r.error) return [L(r.error, 'err')];
  const v = llega(st, ses, r);
  if (v.error) return [L(v.error, 'err')];
  if (!v.ok) return timeout(v.ip, v.salto ? [L('Connection closed by UNKNOWN port 65535', 'err')] : r.salto ? [] : !r.i || r.ip === (r.i && r.i.ipPriv) && ses.host === P.entrada ? [L(T('(desde tu equipo no hay ruta a una IP privada de la VPC: salta por el bastión)', '(there is no route from your workstation to a private VPC IP: jump through the bastion)'), 'dim')] : []);
  const i = r.i;
  // Llega: ahora la autenticación. Desde tu equipo hace falta la clave del par
  // con el que se lanzó; dentro de la VPC el bastión reenvía tu agente SSH.
  const conClave = ses.host !== P.entrada || (r.clave && /tienda-prod(\.pem)?$/.test(r.clave));
  if (r.user !== 'ubuntu' || !conClave || i.clave !== N.CLAVE) return { lineas: [L(r.user + '@' + r.ip + ': Permission denied (publickey).', 'err')].concat(r.user !== 'ubuntu' ? [L(T('(en las AMI de Ubuntu el usuario es ubuntu)', '(on Ubuntu AMIs the user is ubuntu)'), 'dim')] : !conClave ? [L(T('(falta la clave: ssh -i ~/.ssh/tienda-prod.pem ...)', '(missing key: ssh -i ~/.ssh/tienda-prod.pem ...)'), 'dim')] : []), minutos: 1 };
  if (resto.length) {
    const r2 = P.correrEn(st, i.host, resto.join(' '), { sudo: false });
    return { lineas: r2.lineas, minutos: 1 + (r2.minutos || 0) };
  }
  const desde = r.salto ? '10.0.1.10' : ses.host === P.entrada ? st.aws.miIp : (N.instDeHost(st, ses.host) || {}).ipPriv;
  U.entrar(ses, i.host, HOME, false, 'ubuntu');
  return { lineas: bienvenida(st, i, desde), minutos: 0 };
} });

// ------------------------------------------------------------------ curl
// La forma de comprobar lo que ve un cliente: la web desde fuera, la salida a
// internet desde dentro, tu propia IP.
U.cmd('curl', { ayuda: T('peticiones HTTP: curl -I http://IP, curl -s https://checkip.amazonaws.com', 'HTTP requests: curl -I http://IP, curl -s https://checkip.amazonaws.com'), grupo: T('Red', 'Network'), fn: ctx => {
  const st = ctx.st, a = ctx.args, url = a.filter(x => !/^-/.test(x) && !/^\d+$/.test(x)).pop();
  if (!url) return [L("curl: try 'curl --help' or 'curl --manual' for more information", 'err')];
  const cab = a.some(x => /^-[a-zA-Z]*I/.test(x) || x === '--head');
  const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) return [L('curl: (3) URL using bad/illegal format or missing URL', 'err')];
  const esq = m[1] || 'http', dom = m[2], puerto = +(m[3] || (esq === 'https' ? 443 : 80));
  const aqui = N.instDeHost(st, ctx.ses.host), enOps = ctx.ses.host === P.entrada;
  const ipSalida = enOps ? st.aws.miIp : N.ipSalida(st, aqui);
  const corta = () => ({ lineas: [L('curl: (28) Failed to connect to ' + dom + ' port ' + puerto + ' after 130041 ms: Connection timed out', 'err')], minutos: 2 });
  const no404 = () => cab ? [L('HTTP/1.1 404 Not Found'), L('Server: nginx/1.18.0 (Ubuntu)'), L('Date: ' + U.larga(st.reloj)), L('Content-Type: text/html')] : [L('<html>'), L('<head><title>404 Not Found</title></head>'), L('<body><center><h1>404 Not Found</h1></center><hr><center>nginx/1.18.0 (Ubuntu)</center></body>'), L('</html>')];
  const ok = (cuerpo, servidor) => cab ? [L('HTTP/1.1 200 OK'), L('Server: ' + servidor), L('Date: ' + U.larga(st.reloj)), L('Content-Type: ' + (/^[{\[]/.test(cuerpo[0]) ? 'application/json' : 'text/html')), L('Connection: keep-alive')] : cuerpo.map(x => L(x));
  // localhost
  if (dom === 'localhost' || dom === '127.0.0.1') {
    const h = ctx.h, svc = { 80: 'nginx', 443: 'nginx', 8080: 'tienda-api' }[puerto];
    if (!svc || !h.svcs[svc] || h.svcs[svc].estado !== 'active') return [L('curl: (7) Failed to connect to ' + dom + ' port ' + puerto + ' after 0 ms: Connection refused', 'err')];
    if (svc === 'nginx' && !N.rutaWeb(m[4])) return no404();
    return svc === 'nginx' ? (m[4] === '/health' ? ok(['ok'], 'nginx/1.18.0 (Ubuntu)') : ok(['<!doctype html>', '<html lang="es"><head><title>Tienda</title></head>', '<body>…</body></html>'], 'nginx/1.18.0 (Ubuntu)')) : ok(['{"status":"ok","db":"up"}'], 'tienda-api');
  }
  // tu IP pública vista desde fuera
  if (/^(checkip\.amazonaws\.com|ifconfig\.me|api\.ipify\.org)$/.test(dom)) return ipSalida ? cab ? ok(['x'], 'nginx') : [L(ipSalida)] : corta();
  // buckets de S3, el balanceador...
  for (const f of N.webExterna) { const r = f(st, { dom, puerto, ruta: m[4] || '/', cab, ipSalida, enOps, aqui, ok, corta, no404 }); if (r) return r; }
  // una IP de la VPC (privada o pública)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(dom)) {
    const i = N.instPorIp(st, dom);
    let llegaA;
    if (!i) llegaA = false;
    else if (dom === i.ipPriv) llegaA = !enOps && !!aqui && N.desdeVpc(st, aqui, i, puerto);
    else llegaA = !!ipSalida && N.desdeInternet(st, i, puerto, ipSalida);
    if (!llegaA) return corta();
    if (!N.escucha(st, i, puerto)) return [L('curl: (7) Failed to connect to ' + dom + ' port ' + puerto + ' after 2 ms: Connection refused', 'err')];
    if (puerto !== 8080 && !N.rutaWeb(m[4])) return no404();
    if (puerto !== 8080 && m[4] === '/health') return ok(['ok'], 'nginx/1.18.0 (Ubuntu)');
    return puerto === 8080 ? ok(['{"status":"ok","db":"up"}'], 'tienda-api') : ok(['<!doctype html>', '<html lang="es"><head><title>Tienda</title></head>', '<body>…</body></html>'], 'nginx/1.18.0 (Ubuntu)');
  }
  // cualquier otro sitio de internet: hace falta salida
  if (!ipSalida) return corta();
  if (/pasarela-pagos/.test(dom)) return ok(['{"status":"ok","version":"2.14.1"}'], 'pasarela-pagos');
  return ok(['<!doctype html>', '<html><head><title>' + dom + '</title></head><body>…</body></html>'], 'nginx');
} });

// ------------------------------------------------------------------ discos
// El tamaño del volumen (lo que ve lsblk) y el del sistema de ficheros (lo que
// ve df) son dos cosas: ampliar el volumen en AWS no amplía el sistema de
// ficheros. Eso es lo que hace resize2fs (y growpart, si hay partición).
const discoDe = (st, h) => { const i = N.instDeHost(st, h.nombre); return i ? N.volsDe(st, i) : []; };
const gib = g => (Math.round(g * 10) / 10).toString().replace(/\.0$/, '') + 'G';
U.cmd('lsblk', { ayuda: T('discos y particiones (tamaño del bloque, no del sistema de ficheros)', 'disks and partitions (block size, not filesystem size)'), grupo: T('Sistema', 'System'), fn: ctx => {
  const st = ctx.st, h = ctx.h, vs = discoDe(st, h);
  const out = [L('NAME         MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS'), L('loop0          7:0    0  25.2M  1 loop /snap/amazon-ssm-agent/7993'), L('loop1          7:1    0  55.7M  1 loop /snap/core18/2829')];
  if (!vs.length) return out.concat([L('nvme0n1      259:0    0 476.9G  0 disk'), L('├─nvme0n1p1  259:1    0   512M  0 part /boot/efi'), L('└─nvme0n1p2  259:2    0 476.4G  0 part /')]);
  vs.sort((x, y) => x.nvme < y.nvme ? -1 : 1).forEach((v, k) => {
    out.push(L((v.nvme).padEnd(13) + '259:' + (k * 4) + '    0' + gib(v.visible).padStart(7) + '  0 disk' + (v.raiz ? '' : ' ' + v.montaje)));
    if (v.raiz) {
      out.push(L('├─' + v.nvme + 'p1  259:' + (k * 4 + 1) + '    0' + gib(v.part).padStart(7) + '  0 part /'));
      out.push(L('├─' + v.nvme + 'p14 259:' + (k * 4 + 2) + '    0     4M  0 part'));
      out.push(L('└─' + v.nvme + 'p15 259:' + (k * 4 + 3) + '    0   106M  0 part /boot/efi'));
    }
  });
  return out;
} });
U.cmd('growpart', { ayuda: T('agranda una partición hasta el final del disco (growpart /dev/nvme0n1 1)', 'grows a partition to the end of the disk (growpart /dev/nvme0n1 1)'), grupo: T('Sistema', 'System'), fn: ctx => {
  const st = ctx.st, a = ctx.args.filter(x => !/^-/.test(x));
  if (a.length < 2) return [L('growpart disk partition', 'err'), L('   rewrite partition table so that partition takes up all the space it can', 'err')];
  const den = U.sinRoot(ctx, ['failed [sfd_dump:1] sfdisk --unit=S --dump ' + a[0], 'sfdisk: cannot open ' + a[0] + ': Permission denied']); if (den) return den;
  const v = discoDe(st, ctx.h).find(x => '/dev/' + x.nvme === a[0]);
  if (!v || !v.raiz || a[1] !== '1') return [L('FAILED: ' + a[0] + ': partition ' + a[1] + ' does not exist', 'err')];
  const sec = g => Math.round(g * 2097152);
  if (v.part >= v.visible - 0.11) return [L('NOCHANGE: partition 1 is size ' + sec(v.part) + '. it cannot be grown', 'ambar')];
  const antes = v.part; v.part = v.visible - 0.11;
  return [L('CHANGED: partition=1 start=227328 old: size=' + sec(antes) + ' end=' + (sec(antes) + 227327) + ' new: size=' + sec(v.part) + ' end=' + (sec(v.part) + 227327))];
} });
U.cmd('resize2fs', { ayuda: T('agranda el sistema de ficheros ext4 al tamaño del disco (resize2fs /dev/nvme1n1)', 'grows the ext4 filesystem to the size of the disk (resize2fs /dev/nvme1n1)'), grupo: T('Sistema', 'System'), fn: ctx => {
  const st = ctx.st, h = ctx.h, dev = ctx.args.filter(x => !/^-/.test(x))[0];
  const out = [L('resize2fs 1.46.5 (30-Dec-2021)')];
  if (!dev) return out.concat([L('Usage: resize2fs [-d debug_flags] [-f] [-F] [-M] [-P] [-p] device [-b|-s|new_size] [-S RAID-stride] [-z undo_file]', 'err')]);
  const den = U.sinRoot(ctx, ['open: Permission denied while opening ' + dev]); if (den) return out.concat(den);
  const vs = discoDe(st, h);
  const v = vs.find(x => (x.raiz && (dev === '/dev/' + x.nvme + 'p1' || dev === '/dev/root')) || (!x.raiz && dev === '/dev/' + x.nvme));
  if (!v) return out.concat([L('resize2fs: No such file or directory while trying to open ' + dev, 'err'), L("Couldn't find valid filesystem superblock.", 'err')]);
  const m = v.montaje, d = h.discos[m];
  const bloques = g => Math.round(g * 262144);
  // ext4 se queda con un poco: lo que ve df es algo menos que la partición.
  const objetivo = Math.round((v.raiz ? v.part * 0.965 : v.visible * 0.982) * 10) / 10;
  if (objetivo <= d.tamG + 0.05) return out.concat([L('The filesystem is already ' + bloques(d.tamG / 0.982) + ' (4k) blocks long.  Nothing to do!'), L('')]);
  d.tamG = objetivo;
  return out.concat([L('Filesystem at ' + dev + ' is mounted on ' + m + '; on-line resizing required'), L('old_desc_blocks = ' + Math.ceil(bloques(objetivo) / 4194304) + ', new_desc_blocks = ' + Math.ceil(bloques(objetivo / 0.982) / 4194304)), L('The filesystem on ' + dev + ' is now ' + bloques(objetivo / 0.982) + ' (4k) blocks long.'), L('')]);
} });

})(window.PUESTO = window.PUESTO || {});
