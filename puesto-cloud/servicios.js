// Puesto Cloud · IAM, S3 y el balanceador (fase 2).
//
// Se carga después de aws.js y se engancha a él: añade sus operaciones a la
// CLI, decide quién eres (N.identidad) y si puedes hacer lo que pides
// (N.autorizar), suma alarmas y contesta en curl por los buckets y el
// balanceador. Lo mismo que nube.js: un estado y todo lo demás se deriva.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, N = P.nube, ID = N.ID, C = N.cli;
const { OPS, ErrorAws, falla, requiere, uno, lista, iso } = C;
const idDe = (pref, sem) => pref + '-0' + U.hex('nube:' + sem, 16);
const clave = sem => 'AKIA' + U.hex('clave:' + sem, 16).toUpperCase();
const secreto = sem => U.hex('secreto:' + sem, 40).replace(/(.{8})/g, '$1/').slice(0, 40);

// ------------------------------------------------------------------ identificadores
ID.sg.alb = idDe('sg', 'alb');
ID.alb = 'arn:aws:elasticloadbalancing:eu-west-1:' + ID.cuenta + ':loadbalancer/app/tienda-alb/' + U.hex('alb', 16);
ID.tg = 'arn:aws:elasticloadbalancing:eu-west-1:' + ID.cuenta + ':targetgroup/tienda-web-tg/' + U.hex('tg', 16);
ID.albDns = 'tienda-alb-1384729561.eu-west-1.elb.amazonaws.com';
ID.pol = { api: 'arn:aws:iam::' + ID.cuenta + ':policy/tienda-api-facturas', deploy: 'arn:aws:iam::' + ID.cuenta + ':policy/tienda-deploy' };
ID.clave = { sre: clave('sre-ops'), ci: clave('ci-deploy-2025'), lucia: clave('lucia') };
const awsPol = n => 'arn:aws:iam::aws:policy/' + n;

// ------------------------------------------------------------------ políticas
const doc = (...sts) => ({ Version: '2012-10-17', Statement: sts });
const allow = (Action, Resource, Sid) => Object.assign(Sid ? { Sid } : {}, { Effect: 'Allow', Action, Resource });
const POL_API_V1 = doc(allow(['s3:PutObject', 's3:GetObject'], 'arn:aws:s3:::tienda-facturas/*', 'FacturasObjetos'), allow('s3:ListBucket', 'arn:aws:s3:::tienda-facturas', 'FacturasListar'));
N.POL_API_V2_MALA = doc(allow(['s3:PutObject', 's3:GetObject', 's3:ListBucket'], 'arn:aws:s3:::tienda-facturas', 'Facturas'));
function politicas() {
  const p = {}, def = (arn, nombre, aws, d, desc, creada) => { p[arn] = { arn, nombre, aws, desc: desc || '', creada: creada || -200000, versiones: [{ id: 'v1', doc: d, creada: creada || -200000 }], defecto: 'v1' }; };
  def(awsPol('AdministratorAccess'), 'AdministratorAccess', true, doc(allow('*', '*')), 'Provides full access to AWS services and resources.');
  def(awsPol('ReadOnlyAccess'), 'ReadOnlyAccess', true, doc(allow(['ec2:Describe*', 's3:Get*', 's3:List*', 'iam:Get*', 'iam:List*', 'elasticloadbalancing:Describe*', 'cloudwatch:Describe*', 'cloudwatch:Get*', 'cloudwatch:List*'], '*')), 'Provides read-only access to AWS services and resources.');
  def(awsPol('SecurityAudit'), 'SecurityAudit', true, doc(allow(['ec2:Describe*', 's3:GetBucket*', 's3:ListAllMyBuckets', 'iam:Get*', 'iam:List*', 'elasticloadbalancing:Describe*', 'cloudwatch:Describe*'], '*')), 'The security audit template grants access to read security configuration metadata.');
  def(awsPol('AmazonS3FullAccess'), 'AmazonS3FullAccess', true, doc(allow(['s3:*', 's3-object-lambda:*'], '*')), 'Provides full access to all buckets via the AWS Management Console.');
  def(awsPol('CloudWatchAgentServerPolicy'), 'CloudWatchAgentServerPolicy', true, doc(allow(['cloudwatch:PutMetricData', 'ec2:DescribeVolumes', 'ec2:DescribeTags', 'logs:PutLogEvents', 'logs:DescribeLogStreams', 'logs:DescribeLogGroups', 'logs:CreateLogStream', 'logs:CreateLogGroup'], '*')), 'Permissions required to use AmazonCloudWatchAgent on servers');
  def(ID.pol.api, 'tienda-api-facturas', false, POL_API_V1, T('tienda-api sube y lee facturas en S3', 'tienda-api uploads and reads invoices in S3'), -90000);
  def(ID.pol.deploy, 'tienda-deploy', false, doc(allow(['ec2:Describe*', 'ec2:RunInstances', 'ec2:TerminateInstances', 'ec2:CreateTags', 'elasticloadbalancing:Describe*', 'elasticloadbalancing:RegisterTargets', 'elasticloadbalancing:DeregisterTargets'], '*', 'Despliegue'), allow(['s3:PutObject', 's3:GetObject'], 'arn:aws:s3:::tienda-artefactos/*', 'Artefactos')), T('El pipeline de CI despliega en los frontales', 'The CI pipeline deploys to the web servers'), -150000);
  return p;
}

// ------------------------------------------------------------------ S3: contenido
const PRECIOS_BUENOS = ['{', '  "version": 412,', '  "moneda": "EUR",', '  "productos": 1873,', '  "actualizado": "2026-09-22T21:00:00Z",', '  "tarifas": { "general": "tarifa-2026-09.csv", "outlet": "outlet-2026-09.csv" }', '}'];
const PRECIOS_VIEJOS = ['{', '  "version": 411,', '  "moneda": "EUR",', '  "productos": 1868,', '  "actualizado": "2026-09-15T21:00:00Z",', '  "tarifas": { "general": "tarifa-2026-09.csv", "outlet": "outlet-2026-08.csv" }', '}'];
N.PRECIOS_MALOS = ['{', '  "version": 413,', '  "moneda": "EUR",', '  "productos": 0,', '  "actualizado": "2026-09-23T08:47:00Z",', '  "tarifas": {}', '}'];
const ver = (sem, contenido, min, extra) => Object.assign({ id: U.hex('ver:' + sem, 32).replace(/[0-9]/g, c => 'abcdefghij'[c]).slice(0, 32), tam: contenido.join('\n').length, fecha: min, contenido }, extra || {});
N.verS3 = ver;
const binario = (sem, tam, min) => ({ id: 'null', tam, fecha: min, contenido: ['(' + T('fichero binario', 'binary file') + ', ' + tam + ' bytes)'], sem });
const BLOQUEADO = { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true };

// ------------------------------------------------------------------ estado
P.alCrear.push(st => {
  const a = st.aws;
  a.sgs.splice(a.sgs.length - 1, 0, { id: ID.sg.alb, nombre: 'tienda-alb', desc: T('Balanceador de la tienda: web desde internet', 'Store load balancer: web from the internet'),
    reglas: [{ proto: 'tcp', desde: 80, hasta: 80, cidr: '0.0.0.0/0', desc: 'HTTP', id: 'sgr-0' + U.hex('alb80', 16) }, { proto: 'tcp', desde: 443, hasta: 443, cidr: '0.0.0.0/0', desc: 'HTTPS', id: 'sgr-0' + U.hex('alb443', 16) }] });
  a.iam = {
    politicas: politicas(),
    usuarios: [
      { nombre: 'sre-ops', grupos: ['admins'], politicas: [], creado: -400000, claves: [{ id: ID.clave.sre, estado: 'Active', creada: -60000, uso: { min: 0, svc: 'ec2', region: 'eu-west-1' } }] },
      { nombre: 'ci-deploy', grupos: ['despliegue'], politicas: [], creado: -380000, claves: [{ id: ID.clave.ci, estado: 'Active', creada: -260000, uso: { min: -55, svc: 'elasticloadbalancing', region: 'eu-west-1' } }] },
      { nombre: 'lucia.pardo', grupos: ['desarrollo'], politicas: [], creado: -120000, claves: [{ id: ID.clave.lucia, estado: 'Active', creada: -110000, uso: { min: -1500, svc: 's3', region: 'eu-west-1' } }] },
    ],
    grupos: [
      { nombre: 'admins', politicas: [awsPol('AdministratorAccess')] },
      { nombre: 'despliegue', politicas: [ID.pol.deploy] },
      { nombre: 'desarrollo', politicas: [awsPol('ReadOnlyAccess')] },
      { nombre: 'auditores', politicas: [awsPol('SecurityAudit')] },
    ],
    roles: [
      { nombre: 'tienda-api-role', politicas: [ID.pol.api, awsPol('CloudWatchAgentServerPolicy')], creado: -90000, desc: T('Rol de las instancias de tienda-api', 'Role for the tienda-api instances') },
      { nombre: 'tienda-web-role', politicas: [awsPol('CloudWatchAgentServerPolicy')], creado: -90000, desc: T('Rol de los frontales web', 'Role for the web servers') },
    ],
    clavesN: 0,
  };
  a.s3 = {
    firmas: {},
    buckets: [
      { nombre: 'tienda-facturas', creado: -300000, versionado: '', bloqueo: Object.assign({}, BLOQUEADO), politica: null, objetos: {
        'facturas/2026/09/F-2026-091807.pdf': [binario('f1', 48213, -7200)], 'facturas/2026/09/F-2026-092214.pdf': [binario('f2', 51877, -1300)] } },
      { nombre: 'tienda-catalogo-backups', creado: -250000, versionado: '', bloqueo: Object.assign({}, BLOQUEADO), politica: null, objetos: {
        'catalogo-2026-09-20.sql.gz': [binario('c1', 412839117, -4300)], 'clientes-2026-09-20.csv.gz': [binario('c2', 88213902, -4300)] } },
      { nombre: 'tienda-config', creado: -240000, versionado: 'Enabled', bloqueo: Object.assign({}, BLOQUEADO), politica: null, objetos: {
        'precios.json': [ver('precios-412', PRECIOS_BUENOS, -720), ver('precios-411', PRECIOS_VIEJOS, -10800)], 'envio.json': [ver('envio-7', ['{ "gratis_desde": 49, "zonas": 4 }'], -40000)] } },
      { nombre: 'tienda-artefactos', creado: -200000, versionado: 'Enabled', bloqueo: Object.assign({}, BLOQUEADO), politica: null, objetos: {
        'web/tienda-web-412.tar.gz': [binario('a1', 18339201, -760)] } },
    ],
  };
  a.elb = {
    lb: { nombre: 'tienda-alb', arn: ID.alb, dns: ID.albDns, sg: ID.sg.alb, subredes: ['public-a', 'public-b', 'public-c'].map(s => ID.subred[s]), creado: -43000 },
    tgs: [{ nombre: 'tienda-web-tg', arn: ID.tg, puerto: 80, hc: { path: '/health', puerto: 'traffic-port', codigos: '200' }, cambiado: -43000,
      targets: ['web-01', 'web-02'].map(n => ({ id: ID.inst[n], registrado: -43000 })), salud: {} }],
  };
  a.elb.tgs[0].targets.forEach(t => { a.elb.tgs[0].salud[t.id] = { real: 'healthy', desde: -43000, antes: 'healthy' }; });
});

// ------------------------------------------------------------------ IAM: quién eres y qué puedes
N.identidad = (st, ses) => {
  if (ses.host === P.entrada) return { usuario: 'sre-ops', arn: 'arn:aws:iam::' + ID.cuenta + ':user/sre-ops' };
  const i = N.instDeHost(st, ses.host);
  if (!i || !i.perfil) return null;
  return { rol: i.perfil, sesion: i.id, arn: 'arn:aws:sts::' + ID.cuenta + ':assumed-role/' + i.perfil + '/' + i.id };
};
const usuario = (st, n) => st.aws.iam.usuarios.find(u => u.nombre === n);
const rol = (st, n) => st.aws.iam.roles.find(r => r.nombre === n);
const grupo = (st, n) => st.aws.iam.grupos.find(g => g.nombre === n);
N.iam = { usuario, rol, grupo };
function politicasDe(st, yo) {
  const iam = st.aws.iam;
  let arns = [];
  if (yo.rol) { const r = rol(st, yo.rol); arns = r ? r.politicas : []; }
  else { const u = usuario(st, yo.usuario); if (u) arns = u.politicas.concat(...u.grupos.map(g => (grupo(st, g) || { politicas: [] }).politicas)); }
  return arns.map(a => iam.politicas[a]).filter(Boolean);
}
const glob = (patron, valor, mayus) => new RegExp('^' + String(patron).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', mayus ? '' : 'i').test(valor);
// La evaluación de IAM: un Deny explícito gana; si no, hace falta un Allow que
// case acción y recurso; si no hay ninguno, se deniega (implícitamente).
N.evaluar = (st, yo, accion, recurso) => {
  let dec = 'implicitDeny';
  const casan = [];
  politicasDe(st, yo).forEach(p => {
    const v = p.versiones.find(x => x.id === p.defecto);
    [].concat(v.doc.Statement).forEach(s => {
      const acs = [].concat(s.Action || []), res = [].concat(s.Resource || []);
      if (acs.some(x => glob(x, accion)) && res.some(x => glob(x, recurso, true))) {
        casan.push({ politica: p.nombre, sid: s.Sid || null, efecto: s.Effect });
        if (s.Effect === 'Deny') dec = 'explicitDeny'; else if (dec !== 'explicitDeny') dec = 'allowed';
      }
    });
  });
  return { dec, casan };
};
N.autorizar = (st, yo, accion, recurso, op, svc) => {
  const e = N.evaluar(st, yo, accion, recurso);
  if (e.dec === 'allowed') return true;
  const motivo = e.dec === 'explicitDeny' ? 'with an explicit deny in an identity-based policy' : 'because no identity-based policy allows the ' + accion + ' action';
  if (svc === 'ec2') throw new ErrorAws('UnauthorizedOperation', 'You are not authorized to perform this operation. User: ' + yo.arn + ' is not authorized to perform: ' + accion + ' ' + motivo);
  throw new ErrorAws('AccessDenied', 'User: ' + yo.arn + ' is not authorized to perform: ' + accion + (recurso && recurso !== '*' ? ' on resource: ' + (svc === 's3' || svc === 's3api' ? '"' + recurso + '"' : recurso) : '') + ' ' + motivo);
};

// ------------------------------------------------------------------ IAM: CLI
const arnUsuario = n => 'arn:aws:iam::' + ID.cuenta + ':user/' + n;
const arnRol = n => 'arn:aws:iam::' + ID.cuenta + ':role/' + n;
const noExiste = (tipo, n) => falla('NoSuchEntity', 'The ' + tipo + ' with name ' + n + ' cannot be found.');
const usuarioDe = (st, o) => { const n = uno(o, 'user-name') || (o._yo.usuario || ''); const u = usuario(st, n); return u || noExiste('user', n); };
const rolDe = (st, o) => { requiere(o, 'role-name'); const r = rol(st, uno(o, 'role-name')); return r || noExiste('role', uno(o, 'role-name')); };
const politicaDe = (st, o) => { requiere(o, 'policy-arn'); const p = st.aws.iam.politicas[uno(o, 'policy-arn')]; return p || falla('NoSuchEntity', 'Policy ' + uno(o, 'policy-arn') + ' does not exist or is not attachable.'); };
const usuarioJ = u => ({ Path: '/', UserName: u.nombre, UserId: 'AIDA' + U.hex('usr' + u.nombre, 17).toUpperCase(), Arn: arnUsuario(u.nombre), CreateDate: iso(u.creado) });
const rolJ = r => ({ Path: '/', RoleName: r.nombre, RoleId: 'AROA' + U.hex('rol' + r.nombre, 17).toUpperCase(), Arn: arnRol(r.nombre), CreateDate: iso(r.creado), Description: r.desc,
  AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] }, MaxSessionDuration: 3600 });
const polJ = (st, p) => ({ PolicyName: p.nombre, PolicyId: 'ANPA' + U.hex('pol' + p.nombre, 17).toUpperCase(), Arn: p.arn, Path: '/', DefaultVersionId: p.defecto,
  AttachmentCount: st.aws.iam.roles.concat(st.aws.iam.grupos, st.aws.iam.usuarios).filter(x => x.politicas.indexOf(p.arn) >= 0).length, PermissionsBoundaryUsageCount: 0, IsAttachable: true,
  Description: p.desc, CreateDate: iso(p.creada), UpdateDate: iso(Math.max(...p.versiones.map(v => v.creada))) });
const adjuntas = (st, arns) => ({ AttachedPolicies: arns.map(a => ({ PolicyName: st.aws.iam.politicas[a].nombre, PolicyArn: a })) });
const claveJ = (u, k) => ({ UserName: u.nombre, AccessKeyId: k.id, Status: k.estado, CreateDate: iso(k.creada) });
OPS.iam = {
  'get-user': (st, o) => ({ datos: { User: usuarioJ(usuarioDe(st, o)) } }),
  'list-users': st => ({ datos: { Users: st.aws.iam.usuarios.map(usuarioJ) } }),
  'list-groups': st => ({ datos: { Groups: st.aws.iam.grupos.map(g => ({ Path: '/', GroupName: g.nombre, GroupId: 'AGPA' + U.hex('grp' + g.nombre, 17).toUpperCase(), Arn: 'arn:aws:iam::' + ID.cuenta + ':group/' + g.nombre, CreateDate: iso(-400000) })) } }),
  'list-groups-for-user': (st, o) => { requiere(o, 'user-name'); const u = usuarioDe(st, o); return { datos: { Groups: u.grupos.map(g => ({ Path: '/', GroupName: g, Arn: 'arn:aws:iam::' + ID.cuenta + ':group/' + g })) } }; },
  'get-group': (st, o) => { requiere(o, 'group-name'); const g = grupo(st, uno(o, 'group-name')) || noExiste('group', uno(o, 'group-name')); return { datos: { Users: st.aws.iam.usuarios.filter(u => u.grupos.indexOf(g.nombre) >= 0).map(usuarioJ), Group: { Path: '/', GroupName: g.nombre, Arn: 'arn:aws:iam::' + ID.cuenta + ':group/' + g.nombre } } }; },
  'list-attached-group-policies': (st, o) => { requiere(o, 'group-name'); const g = grupo(st, uno(o, 'group-name')) || noExiste('group', uno(o, 'group-name')); return { datos: adjuntas(st, g.politicas) }; },
  'list-attached-user-policies': (st, o) => { requiere(o, 'user-name'); return { datos: adjuntas(st, usuarioDe(st, o).politicas) }; },
  'list-access-keys': (st, o) => { const u = usuarioDe(st, o); return { datos: { AccessKeyMetadata: u.claves.map(k => claveJ(u, k)) } }; },
  'get-access-key-last-used': (st, o) => {
    requiere(o, 'access-key-id');
    const id = uno(o, 'access-key-id'), u = st.aws.iam.usuarios.find(x => x.claves.some(k => k.id === id));
    if (!u) falla('AccessDenied', 'User: arn:aws:iam::' + ID.cuenta + ':user/sre-ops is not authorized to perform: iam:GetAccessKeyLastUsed on resource: access key ' + id);
    const k = u.claves.find(x => x.id === id);
    return { datos: { UserName: u.nombre, AccessKeyLastUsed: k.uso ? { LastUsedDate: iso(k.uso.min), ServiceName: k.uso.svc, Region: k.uso.region } : { ServiceName: 'N/A', Region: 'N/A' } } };
  },
  'update-access-key': (st, o) => {
    requiere(o, 'access-key-id', 'status');
    const u = usuarioDe(st, o), k = u.claves.find(x => x.id === uno(o, 'access-key-id'));
    if (!k) falla('NoSuchEntity', 'The Access Key with id ' + uno(o, 'access-key-id') + ' cannot be found.');
    if (['Active', 'Inactive'].indexOf(uno(o, 'status')) < 0) throw new ErrorAws(null, "aws: error: argument --status: Invalid choice, valid choices are: Active | Inactive");
    k.estado = uno(o, 'status');
    return { datos: undefined };
  },
  'create-access-key': (st, o) => {
    const u = usuarioDe(st, o);
    if (u.claves.length >= 2) falla('LimitExceeded', 'Cannot exceed quota for AccessKeysPerUser: 2');
    const n = ++st.aws.iam.clavesN, k = { id: clave(u.nombre + '-nueva-' + n), estado: 'Active', creada: st.reloj, uso: null };
    u.claves.push(k);
    return { datos: { AccessKey: { UserName: u.nombre, AccessKeyId: k.id, Status: 'Active', SecretAccessKey: secreto(u.nombre + n), CreateDate: iso(st.reloj) } } };
  },
  'delete-access-key': (st, o) => {
    requiere(o, 'access-key-id');
    const u = usuarioDe(st, o), k = u.claves.findIndex(x => x.id === uno(o, 'access-key-id'));
    if (k < 0) falla('NoSuchEntity', 'The Access Key with id ' + uno(o, 'access-key-id') + ' cannot be found.');
    u.claves.splice(k, 1);
    return { datos: undefined };
  },
  'list-roles': st => ({ datos: { Roles: st.aws.iam.roles.map(rolJ) } }),
  'get-role': (st, o) => ({ datos: { Role: rolJ(rolDe(st, o)) } }),
  'list-attached-role-policies': (st, o) => ({ datos: adjuntas(st, rolDe(st, o).politicas) }),
  'attach-role-policy': (st, o) => { const r = rolDe(st, o), p = politicaDe(st, o); if (r.politicas.indexOf(p.arn) < 0) r.politicas.push(p.arn); return { datos: undefined }; },
  'detach-role-policy': (st, o) => { const r = rolDe(st, o), p = politicaDe(st, o), k = r.politicas.indexOf(p.arn); if (k < 0) falla('NoSuchEntity', 'Policy ' + p.arn + ' was not found.'); r.politicas.splice(k, 1); return { datos: undefined }; },
  'list-policies': (st, o) => { const sc = uno(o, 'scope') || 'All'; return { datos: { Policies: Object.keys(st.aws.iam.politicas).map(a => st.aws.iam.politicas[a]).filter(p => sc === 'All' || (sc === 'Local') === !p.aws).filter(p => !o['only-attached'] || polJ(st, p).AttachmentCount).map(p => polJ(st, p)) } }; },
  'get-policy': (st, o) => ({ datos: { Policy: polJ(st, politicaDe(st, o)) } }),
  'list-policy-versions': (st, o) => { const p = politicaDe(st, o); return { datos: { Versions: p.versiones.slice().reverse().map(v => ({ VersionId: v.id, IsDefaultVersion: v.id === p.defecto, CreateDate: iso(v.creada) })) } }; },
  'get-policy-version': (st, o) => { requiere(o, 'version-id'); const p = politicaDe(st, o), v = p.versiones.find(x => x.id === uno(o, 'version-id')); if (!v) falla('NoSuchEntity', 'Policy ' + p.arn + ' version ' + uno(o, 'version-id') + ' does not exist or is not attachable.'); return { datos: { PolicyVersion: { Document: v.doc, VersionId: v.id, IsDefaultVersion: v.id === p.defecto, CreateDate: iso(v.creada) } } }; },
  'set-default-policy-version': (st, o) => { requiere(o, 'version-id'); const p = politicaDe(st, o); if (p.aws) falla('AccessDenied', 'Cannot modify an AWS managed policy'); if (!p.versiones.some(x => x.id === uno(o, 'version-id'))) falla('NoSuchEntity', 'Policy ' + p.arn + ' version ' + uno(o, 'version-id') + ' does not exist or is not attachable.'); p.defecto = uno(o, 'version-id'); return { datos: undefined }; },
  'simulate-principal-policy': (st, o) => {
    requiere(o, 'policy-source-arn', 'action-names');
    const arn = uno(o, 'policy-source-arn'), mr = /:(user|role)\/(.+)$/.exec(arn);
    if (!mr || (mr[1] === 'user' ? !usuario(st, mr[2]) : !rol(st, mr[2]))) falla('NoSuchEntity', 'PolicySourceArn ' + arn + ' is not valid.');
    const yo = mr[1] === 'user' ? { usuario: mr[2] } : { rol: mr[2] }, recursos = (o['resource-arns'] || ['*']);
    return { datos: { EvaluationResults: [].concat(...(o['action-names'] || []).map(ac => recursos.map(r => { const e = N.evaluar(st, yo, ac, r); return { EvalActionName: ac, EvalResourceName: r, EvalDecision: e.dec, MatchedStatements: e.casan.map(m => ({ SourcePolicyId: m.politica, SourcePolicyType: 'IAM Policy' })), MissingContextValues: [] }; }))), IsTruncated: false } };
  },
};

// ------------------------------------------------------------------ S3
const bucket = (st, n) => st.aws.s3.buckets.find(b => b.nombre === n);
N.bucket = bucket;
const arnS3 = (b, k) => 'arn:aws:s3:::' + b + (k != null ? '/' + k : '');
const actual = (b, k) => { const vs = b.objetos[k]; return vs && vs.length && !vs[0].marcador ? vs[0] : null; };
N.objetoActual = actual;
// Público: una política que deja leer a cualquiera, y el bloqueo que lo impediría apagado.
const politicaPublica = b => !!(b.politica && [].concat(b.politica.Statement).some(s => s.Effect === 'Allow' && (s.Principal === '*' || (s.Principal && s.Principal.AWS === '*')) && [].concat(s.Action).some(x => glob(x, 's3:GetObject'))));
N.s3Publico = b => politicaPublica(b) && !(b.bloqueo && b.bloqueo.RestrictPublicBuckets);
const bucketDe = (st, o, op) => { requiere(o, 'bucket'); const b = bucket(st, uno(o, 'bucket')); return b || falla('NoSuchBucket', 'The specified bucket does not exist'); };
const verJ = (b, k, v, ultima) => ({ ETag: '"' + U.hex('etag' + v.id + k, 32) + '"', Size: v.tam, StorageClass: 'STANDARD', Key: k, VersionId: v.id, IsLatest: ultima, LastModified: iso(v.fecha).replace('+00:00', '.000Z'), Owner: { ID: U.hex('owner', 64) } });
const fecha = min => U.iso(min).replace('T', ' ');
const subir = (st, b, k, contenido, tam) => {
  const n = st.aws.s3.subidas = (st.aws.s3.subidas || 0) + 1;
  const v = { id: b.versionado === 'Enabled' ? ver('subida' + b.nombre + k + n, contenido, st.reloj).id : 'null', tam, fecha: st.reloj, contenido };
  if (b.versionado === 'Enabled') b.objetos[k] = [v].concat(b.objetos[k] || []); else b.objetos[k] = [v];
  return v;
};
const s3Ruta = x => { const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(x || ''); return m ? { b: m[1], k: m[2] } : null; };
function s3Error(op, e, prefijo) {
  if (!(e instanceof ErrorAws)) throw e;
  return { lineas: [L((prefijo || '') + 'An error occurred (' + e.codigo + ') when calling the ' + op + ' operation: ' + e.msg, 'err')], fallo: true };
}
OPS.s3 = {
  ls: (st, o, pos) => {
    const yo = o._yo, r = s3Ruta(pos[0]);
    try {
      if (!r) { N.autorizar(st, yo, 's3:ListAllMyBuckets', '*', 'ListBuckets', 's3'); return { lineas: st.aws.s3.buckets.map(b => L(fecha(b.creado) + ' ' + b.nombre)) }; }
      const b = bucket(st, r.b); if (!b) falla('NoSuchBucket', 'The specified bucket does not exist');
      N.autorizar(st, yo, 's3:ListBucket', arnS3(b.nombre), 'ListObjectsV2', 's3');
      const ks = Object.keys(b.objetos).filter(k => actual(b, k) && k.indexOf(r.k) === 0).sort();
      if (o.recursive) return { lineas: ks.map(k => { const v = actual(b, k); return L(fecha(v.fecha) + ' ' + String(v.tam).padStart(10) + ' ' + k); }) };
      const vistos = {}, out = [];
      ks.forEach(k => { const resto = k.slice(r.k.length), j = resto.indexOf('/'); if (j >= 0) { const pre = resto.slice(0, j + 1); if (!vistos[pre]) { vistos[pre] = 1; out.push(L('                           PRE ' + pre)); } } else { const v = actual(b, k); out.push(L(fecha(v.fecha) + ' ' + String(v.tam).padStart(10) + ' ' + resto)); } });
      return { lineas: out };
    } catch (e) { return s3Error(r ? 'ListObjectsV2' : 'ListBuckets', e); }
  },
  cp: (st, o, pos, ctx) => {
    const yo = o._yo, [src, dst] = pos, rs = s3Ruta(src), rd = s3Ruta(dst);
    if (!src || !dst) throw new ErrorAws(null, 'aws: error: the following arguments are required: paths');
    if (rs && !rd) {   // bajar (o a la pantalla con -)
      try {
        const b = bucket(st, rs.b); if (!b) falla('NoSuchBucket', 'The specified bucket does not exist');
        N.autorizar(st, yo, 's3:GetObject', arnS3(b.nombre, rs.k), 'GetObject', 's3');
        const v = actual(b, rs.k); if (!v) falla('404', 'Not Found');
        return { lineas: dst === '-' ? v.contenido.map(x => L(x)) : [L('download: s3://' + b.nombre + '/' + rs.k + ' to ' + dst)] };
      } catch (e) { return s3Error(e.codigo === '404' ? 'HeadObject' : 'GetObject', e, 'fatal error: '); }
    }
    if (!rs && rd) {   // subir un fichero de esta máquina
      const ses = ctx.ses, h = st.hosts[ses.host], ruta = U.ruta(ses.cwd, src, ses), fs = P.vfs(st, h);
      if (!fs.f[ruta]) return { lineas: [L("The user-provided path " + src + " does not exist.", 'err')], fallo: true };
      const k = rd.k && !/\/$/.test(rd.k) ? rd.k : rd.k + ruta.split('/').pop();
      try {
        const b = bucket(st, rd.b); if (!b) falla('NoSuchBucket', 'The specified bucket does not exist');
        N.autorizar(st, yo, 's3:PutObject', arnS3(b.nombre, k), 'PutObject', 's3');
        const lineas = fs.f[ruta].lineas();
        subir(st, b, k, lineas, lineas.join('\n').length);
        return { lineas: [L('upload: ' + src + ' to s3://' + b.nombre + '/' + k)] };
      } catch (e) { return s3Error('PutObject', e, 'upload failed: ' + src + ' to s3://' + rd.b + '/' + k + ' '); }
    }
    return { lineas: [L(T('(el simulador sólo copia entre tu máquina y S3)', '(the simulator only copies between your machine and S3)'), 'dim')] };
  },
  rm: (st, o, pos) => {
    const r = s3Ruta(pos[0]); if (!r || !r.k) throw new ErrorAws(null, 'aws: error: the following arguments are required: paths');
    try {
      const b = bucket(st, r.b); if (!b) falla('NoSuchBucket', 'The specified bucket does not exist');
      N.autorizar(st, o._yo, 's3:DeleteObject', arnS3(b.nombre, r.k), 'DeleteObject', 's3');
      if (b.versionado === 'Enabled') b.objetos[r.k] = [{ id: ver('marca' + r.k + st.reloj, ['x'], st.reloj).id, tam: 0, fecha: st.reloj, contenido: [], marcador: true }].concat(b.objetos[r.k] || []);
      else delete b.objetos[r.k];
      return { lineas: [L('delete: s3://' + b.nombre + '/' + r.k)] };
    } catch (e) { return s3Error('DeleteObject', e); }
  },
  presign: (st, o, pos) => {
    const r = s3Ruta(pos[0]); if (!r || !r.k) throw new ErrorAws(null, 'aws: error: the following arguments are required: path');
    const exp = +(uno(o, 'expires-in') || 3600), firma = U.hex('firma' + r.b + r.k + st.reloj, 64);
    st.aws.s3.firmas[firma] = { b: r.b, k: r.k, caduca: st.reloj + Math.ceil(exp / 60), yo: o._yo };
    return { lineas: [L('https://' + r.b + '.s3.eu-west-1.amazonaws.com/' + r.k + '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=' + ID.clave.sre + '%2F20260923%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Date=' + U.iso(st.reloj).replace(/[-:]/g, '') + 'Z&X-Amz-Expires=' + exp + '&X-Amz-SignedHeaders=host&X-Amz-Signature=' + firma)] };
  },
};
Object.keys(OPS.s3).forEach(k => { OPS.s3[k].permiso = () => null; });
const pab = b => b.bloqueo ? { PublicAccessBlockConfiguration: Object.assign({}, b.bloqueo) } : null;
OPS.s3api = {
  'list-buckets': st => ({ datos: { Buckets: st.aws.s3.buckets.map(b => ({ Name: b.nombre, CreationDate: iso(b.creado).replace('+00:00', '.000Z') })), Owner: { ID: U.hex('owner', 64) } } }),
  'get-bucket-policy': (st, o) => { const b = bucketDe(st, o); if (!b.politica) falla('NoSuchBucketPolicy', 'The bucket policy does not exist'); return { datos: { Policy: JSON.stringify(b.politica) } }; },
  'get-bucket-policy-status': (st, o) => { const b = bucketDe(st, o); if (!b.politica) falla('NoSuchBucketPolicy', 'The bucket policy does not exist'); return { datos: { PolicyStatus: { IsPublic: N.s3Publico(b) } } }; },
  'delete-bucket-policy': (st, o) => { bucketDe(st, o).politica = null; return { datos: undefined }; },
  'get-public-access-block': (st, o) => { const b = bucketDe(st, o), d = pab(b); if (!d) falla('NoSuchPublicAccessBlockConfiguration', 'The public access block configuration was not found'); return { datos: d }; },
  'put-public-access-block': (st, o) => {
    requiere(o, 'public-access-block-configuration');
    const b = bucketDe(st, o), txt = (o['public-access-block-configuration'] || []).join(' '), c = { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false };
    let j = null; try { j = JSON.parse(txt); } catch (e) { /* forma corta */ }
    Object.keys(c).forEach(k => { const m = new RegExp(k + '=(true|false)', 'i').exec(txt); if (j && j[k] != null) c[k] = !!j[k]; else if (m) c[k] = m[1].toLowerCase() === 'true'; });
    b.bloqueo = c;
    return { datos: undefined };
  },
  'delete-public-access-block': (st, o) => { bucketDe(st, o).bloqueo = null; return { datos: undefined }; },
  'get-bucket-versioning': (st, o) => { const b = bucketDe(st, o); return { datos: b.versionado ? { Status: b.versionado, MFADelete: 'Disabled' } : {} }; },
  'put-bucket-versioning': (st, o) => { requiere(o, 'versioning-configuration'); const b = bucketDe(st, o), m = /Status=(Enabled|Suspended)/.exec((o['versioning-configuration'] || []).join(' ')); if (!m) falla('MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema'); b.versionado = m[1]; return { datos: undefined }; },
  'list-object-versions': (st, o) => {
    const b = bucketDe(st, o), pre = uno(o, 'prefix') || '', vs = [], ms = [];
    Object.keys(b.objetos).filter(k => k.indexOf(pre) === 0).sort().forEach(k => b.objetos[k].forEach((v, n) => { if (v.marcador) ms.push({ Owner: { ID: U.hex('owner', 64) }, Key: k, VersionId: v.id, IsLatest: n === 0, LastModified: iso(v.fecha).replace('+00:00', '.000Z') }); else vs.push(verJ(b, k, v, n === 0)); }));
    return { datos: Object.assign({ Versions: vs }, ms.length ? { DeleteMarkers: ms } : {}, { Name: b.nombre, Prefix: pre, MaxKeys: 1000, IsTruncated: false }) };
  },
  'head-object': (st, o) => {
    requiere(o, 'key'); const b = bucketDe(st, o), k = uno(o, 'key'), vid = uno(o, 'version-id');
    const v = vid ? (b.objetos[k] || []).find(x => x.id === vid) : actual(b, k);
    if (!v) falla('404', 'Not Found');
    return { datos: { AcceptRanges: 'bytes', LastModified: U.larga(v.fecha), ContentLength: v.tam, ETag: '"' + U.hex('etag' + v.id + k, 32) + '"', VersionId: v.id, ContentType: /\.json$/.test(k) ? 'application/json' : 'binary/octet-stream', ServerSideEncryption: 'AES256', Metadata: {} } };
  },
  'get-object': (st, o, pos) => {
    requiere(o, 'key'); const b = bucketDe(st, o), k = uno(o, 'key'), vid = uno(o, 'version-id'), sal = pos[0];
    if (!sal) throw new ErrorAws(null, 'aws: error: the following arguments are required: outfile');
    const v = vid ? (b.objetos[k] || []).find(x => x.id === vid) : actual(b, k);
    if (!v) falla(vid ? 'NoSuchVersion' : 'NoSuchKey', vid ? 'The specified version does not exist.' : 'The specified key does not exist.');
    const meta = { AcceptRanges: 'bytes', LastModified: U.larga(v.fecha), ContentLength: v.tam, ETag: '"' + U.hex('etag' + v.id + k, 32) + '"', VersionId: v.id, ContentType: /\.json$/.test(k) ? 'application/json' : 'binary/octet-stream', Metadata: {} };
    if (sal === '/dev/stdout' || sal === '-') return { lineas: v.contenido.map(x => L(x)).concat(JSON.stringify(meta, null, 4).split('\n').map(x => L(x))) };
    return { datos: meta };
  },
  'copy-object': (st, o) => {
    requiere(o, 'key', 'copy-source');
    const b = bucketDe(st, o), k = uno(o, 'key'), src = uno(o, 'copy-source'), m = /^\/?([^/]+)\/([^?]+)(\?versionId=(.+))?$/.exec(src || '');
    if (!m) falla('InvalidArgument', 'Invalid copy source object key');
    const bs = bucket(st, m[1]); if (!bs) falla('NoSuchBucket', 'The specified bucket does not exist');
    const v = m[4] ? (bs.objetos[m[2]] || []).find(x => x.id === m[4]) : actual(bs, m[2]);
    if (!v || v.marcador) falla(m[4] ? 'NoSuchVersion' : 'NoSuchKey', m[4] ? 'The specified version does not exist.' : 'The specified key does not exist.');
    N.autorizar(st, o._yo, m[4] ? 's3:GetObjectVersion' : 's3:GetObject', arnS3(bs.nombre, m[2]), 'CopyObject', 's3');
    const nueva = subir(st, b, k, v.contenido.slice(), v.tam);
    return { datos: Object.assign(m[4] ? { CopySourceVersionId: m[4] } : {}, { VersionId: nueva.id, ServerSideEncryption: 'AES256', CopyObjectResult: { ETag: '"' + U.hex('etag' + nueva.id + k, 32) + '"', LastModified: iso(st.reloj).replace('+00:00', '.000Z') } }) };
  },
};
// Lo que pide cada operación de s3api, sobre el bucket o el objeto.
const PERMISO_S3 = { 'list-buckets': 's3:ListAllMyBuckets', 'get-bucket-policy': 's3:GetBucketPolicy', 'get-bucket-policy-status': 's3:GetBucketPolicyStatus', 'delete-bucket-policy': 's3:DeleteBucketPolicy',
  'get-public-access-block': 's3:GetBucketPublicAccessBlock', 'put-public-access-block': 's3:PutBucketPublicAccessBlock', 'delete-public-access-block': 's3:PutBucketPublicAccessBlock',
  'get-bucket-versioning': 's3:GetBucketVersioning', 'put-bucket-versioning': 's3:PutBucketVersioning', 'list-object-versions': 's3:ListBucketVersions', 'head-object': 's3:GetObject', 'get-object': 's3:GetObject', 'copy-object': 's3:PutObject' };
Object.keys(OPS.s3api).forEach(op => { OPS.s3api[op].permiso = o => ({ accion: PERMISO_S3[op], recurso: op === 'list-buckets' ? '*' : ['head-object', 'get-object', 'copy-object'].indexOf(op) >= 0 ? arnS3(uno(o, 'bucket'), uno(o, 'key')) : arnS3(uno(o, 'bucket')) }); });

// curl a un bucket: público, firmado o denegado.
const xml = (cod, msg) => ['<?xml version="1.0" encoding="UTF-8"?>', '<Error><Code>' + cod + '</Code><Message>' + msg + '</Message><RequestId>' + U.hex('req' + cod, 16).toUpperCase() + '</RequestId></Error>'];
N.webExterna.push((st, c) => {
  const m = /^([a-z0-9.-]+)\.s3(\.[a-z0-9-]+)?\.amazonaws\.com$/.exec(c.dom);
  if (!m) return null;
  if (!c.ipSalida) return c.corta();
  const b = bucket(st, m[1]), q = c.ruta.split('?'), k = decodeURIComponent(q[0].replace(/^\//, '')), f = /X-Amz-Signature=([0-9a-f]+)/.exec(q[1] || '');
  const res = (cod, txt, cuerpo) => c.cab ? [L('HTTP/1.1 ' + cod + ' ' + txt), L('x-amz-request-id: ' + U.hex('req' + k, 16).toUpperCase()), L('Date: ' + U.larga(st.reloj)), L('Server: AmazonS3')] : cuerpo.map(x => L(x));
  if (!b) return res(404, 'Not Found', xml('NoSuchBucket', 'The specified bucket does not exist'));
  const firma = f && st.aws.s3.firmas[f[1]];
  if (firma && firma.b === b.nombre && firma.k === k) {
    if (st.reloj > firma.caduca) return res(403, 'Forbidden', xml('AccessDenied', 'Request has expired'));
    const v = actual(b, k); return v ? res(200, 'OK', v.contenido) : res(404, 'Not Found', xml('NoSuchKey', 'The specified key does not exist.'));
  }
  if (!N.s3Publico(b)) return res(403, 'Forbidden', xml('AccessDenied', 'Access Denied'));
  const v = actual(b, k);
  return v ? res(200, 'OK', v.contenido) : res(404, 'Not Found', xml('NoSuchKey', 'The specified key does not exist.'));
});

// ------------------------------------------------------------------ balanceador
// Un target group comprueba /health cada 30 s; hacen falta 3 aciertos seguidos
// para dar un destino por sano (unos 2 minutos). Si TODOS están mal, el ALB no
// corta: manda tráfico a todos igual («fail-open»), como el de verdad.
const tgDe = (st, o) => { requiere(o, 'target-group-arn'); const t = st.aws.elb.tgs.find(x => x.arn === uno(o, 'target-group-arn')); return t || falla('TargetGroupNotFound', "Target groups '" + uno(o, 'target-group-arn') + "' not found"); };
function saludReal(st, tg, t) {
  const i = st.aws.instancias.find(x => x.id === t.id);
  if (!i || i.estado === 'terminated') return { estado: 'unused', razon: 'Target.InvalidState', desc: 'Target is in the terminated state' };
  if (i.estado !== 'running') return { estado: 'unused', razon: 'Target.InvalidState', desc: 'Target is in the ' + i.estado + ' state' };
  const h = st.hosts[i.host];
  if (!h || !h.up || !N.permite(st, i, tg.puerto, { ip: '10.0.1.200', sgs: [ID.sg.alb] })) return { estado: 'unhealthy', razon: 'Target.Timeout', desc: 'Request timed out' };
  if (!N.escucha(st, i, tg.puerto)) return { estado: 'unhealthy', razon: 'Target.FailedHealthChecks', desc: 'Health checks failed' };
  if (!N.rutaWeb(tg.hc.path)) return { estado: 'unhealthy', razon: 'Target.ResponseCodeMismatch', desc: 'Health checks failed with these codes: [404]' };
  return { estado: 'healthy' };
}
N.salud = (st, tg, t) => {
  const r = saludReal(st, tg, t);
  let s = tg.salud[t.id];
  if (!s || s.real !== r.estado) { s = tg.salud[t.id] = { real: r.estado, desde: st.reloj, antes: s ? s.real : 'nuevo', razonAntes: s ? s.razon : null, descAntes: s ? s.desc : null, razon: r.razon, desc: r.desc }; }
  if (r.estado === 'healthy' && st.reloj - s.desde < 2) return s.antes === 'nuevo' || s.antes === 'unused' ? { estado: 'initial', razon: 'Elb.InitialHealthChecking', desc: 'Initial health checks in progress' } : { estado: 'unhealthy', razon: s.razonAntes, desc: s.descAntes };
  return r;
};
N.tg = st => st.aws.elb.tgs[0];
N.sanos = st => { const tg = N.tg(st); return tg.targets.filter(t => N.salud(st, tg, t).estado === 'healthy'); };
// ¿Contesta la web a través del balanceador? Sanos, o (fail-open) cualquiera que sirva.
N.porAlb = (st, ruta) => {
  const tg = N.tg(st), sirve = t => { const i = st.aws.instancias.find(x => x.id === t.id); return N.viva(st, i) && N.escucha(st, i, tg.puerto) && N.permite(st, i, tg.puerto, { ip: '10.0.1.200', sgs: [ID.sg.alb] }); };
  const sanos = N.sanos(st);
  return (sanos.length ? sanos : tg.targets).filter(sirve);
};
P.ticks.push(st => { if (st.aws && st.aws.elb) st.aws.elb.tgs.forEach(tg => tg.targets.forEach(t => N.salud(st, tg, t))); });
const lbJ = st => { const lb = st.aws.elb.lb; return { LoadBalancerArn: lb.arn, DNSName: lb.dns, CanonicalHostedZoneId: 'Z32O12XQLNTSW2', CreatedTime: iso(lb.creado).replace('+00:00', '.000Z'), LoadBalancerName: lb.nombre, Scheme: 'internet-facing', VpcId: ID.vpc, State: { Code: 'active' }, Type: 'application', AvailabilityZones: lb.subredes.map(s => ({ ZoneName: N.subred(st, s).az, SubnetId: s, LoadBalancerAddresses: [] })), SecurityGroups: [lb.sg], IpAddressType: 'ipv4' }; };
const tgJ = (st, tg) => ({ TargetGroupArn: tg.arn, TargetGroupName: tg.nombre, Protocol: 'HTTP', Port: tg.puerto, VpcId: ID.vpc, HealthCheckProtocol: 'HTTP', HealthCheckPort: tg.hc.puerto, HealthCheckEnabled: true, HealthCheckIntervalSeconds: 30, HealthCheckTimeoutSeconds: 5, HealthyThresholdCount: 3, UnhealthyThresholdCount: 2, HealthCheckPath: tg.hc.path, Matcher: { HttpCode: tg.hc.codigos }, LoadBalancerArns: [ID.alb], TargetType: 'instance', ProtocolVersion: 'HTTP1', IpAddressType: 'ipv4' });
const leerTargets = o => (o.targets || []).map(x => { const m = /Id=([^,\s]+)(,Port=(\d+))?/.exec(x); return m ? { id: m[1], puerto: m[3] ? +m[3] : null } : null; }).filter(Boolean);
OPS.elbv2 = {
  'describe-load-balancers': (st, o) => { const ns = o.names || []; if (ns.length && ns.indexOf('tienda-alb') < 0) falla('LoadBalancerNotFound', "Load balancers '[" + ns.join(', ') + "]' not found"); return { datos: { LoadBalancers: [lbJ(st)] } }; },
  'describe-listeners': (st, o) => ({ datos: { Listeners: [{ ListenerArn: ID.alb.replace(':loadbalancer/', ':listener/') + '/' + U.hex('l80', 16), LoadBalancerArn: ID.alb, Port: 80, Protocol: 'HTTP', DefaultActions: [{ Type: 'forward', TargetGroupArn: ID.tg, ForwardConfig: { TargetGroups: [{ TargetGroupArn: ID.tg, Weight: 1 }] } }] }] } }),
  'describe-target-groups': (st, o) => { const ns = o.names || [], arns = lista(o, 'target-group-arns'); const ts = st.aws.elb.tgs.filter(t => (!ns.length || ns.indexOf(t.nombre) >= 0) && (!arns.length || arns.indexOf(t.arn) >= 0)); if ((ns.length || arns.length) && !ts.length) falla('TargetGroupNotFound', "One or more target groups not found"); return { datos: { TargetGroups: ts.map(t => tgJ(st, t)) } }; },
  'describe-target-health': (st, o) => { const tg = tgDe(st, o), solo = leerTargets(o).map(x => x.id); return { datos: { TargetHealthDescriptions: tg.targets.filter(t => !solo.length || solo.indexOf(t.id) >= 0).map(t => { const s = N.salud(st, tg, t); return { Target: { Id: t.id, Port: tg.puerto }, HealthCheckPort: String(tg.puerto), TargetHealth: s.estado === 'healthy' ? { State: 'healthy' } : { State: s.estado, Reason: s.razon, Description: s.desc } }; }) } }; },
  'modify-target-group': (st, o) => {
    const tg = tgDe(st, o), ruta = uno(o, 'health-check-path'), m = /HttpCode=([0-9,-]+)/.exec((o.matcher || []).join(' '));
    if (ruta) { if (ruta[0] !== '/') falla('ValidationError', 'Health check path must begin with a \'/\' character'); tg.hc.path = ruta; }
    if (m) tg.hc.codigos = m[1];
    tg.cambiado = st.reloj;
    return { datos: { TargetGroups: [tgJ(st, tg)] } };
  },
  'register-targets': (st, o) => {
    const tg = tgDe(st, o), ts = leerTargets(o);
    if (!ts.length) throw new ErrorAws(null, 'aws: error: the following arguments are required: --targets');
    ts.forEach(x => { const i = st.aws.instancias.find(y => y.id === x.id && (y.region || ID.region) === ID.region); if (!i) falla('InvalidTarget', "The following targets are not in the target group's VPC: '" + x.id + "'"); if (i.estado !== 'running') falla('InvalidTarget', "The following targets are not in a running state and cannot be registered: '" + x.id + "'"); });
    ts.forEach(x => { if (!tg.targets.some(t => t.id === x.id)) { tg.targets.push({ id: x.id, registrado: st.reloj }); delete tg.salud[x.id]; } });
    return { datos: undefined };
  },
  'deregister-targets': (st, o) => { const tg = tgDe(st, o), ids = leerTargets(o).map(x => x.id); tg.targets = tg.targets.filter(t => ids.indexOf(t.id) < 0); return { datos: undefined }; },
  'wait': (st, o, pos) => {
    if (pos[0] !== 'target-in-service' && pos[0] !== 'target-deregistered') throw new ErrorAws(null, 'aws: error: argument wait: Invalid choice, valid choices are: load-balancer-available | load-balancer-exists | load-balancers-deleted | target-deregistered | target-in-service');
    const tg = tgDe(st, o), solo = leerTargets(o).map(x => x.id);
    const cond = () => { const ts = tg.targets.filter(t => !solo.length || solo.indexOf(t.id) >= 0); return pos[0] === 'target-in-service' ? ts.length && ts.every(t => N.salud(st, tg, t).estado === 'healthy') : !tg.targets.some(t => solo.indexOf(t.id) >= 0); };
    U.hasta(st, cond, 20);
    if (!cond()) throw new ErrorAws(null, 'Waiter TargetInService failed: Max attempts exceeded');
    return { datos: undefined, minutos: 0 };
  },
};
// El balanceador en curl: DNS público, puerto 80.
N.webExterna.push((st, c) => {
  if (c.dom !== ID.albDns) return null;
  if (!c.ipSalida) return c.corta();
  const destinos = N.porAlb(st);
  if (!destinos.length) return c.cab ? [L('HTTP/1.1 503 Service Temporarily Unavailable'), L('Server: awselb/2.0'), L('Date: ' + U.larga(st.reloj)), L('Content-Type: text/html')] : [L('<html>'), L('<head><title>503 Service Temporarily Unavailable</title></head>'), L('<body><center><h1>503 Service Temporarily Unavailable</h1></center></body>'), L('</html>')];
  if (!N.rutaWeb(c.ruta)) return c.no404();
  return c.ruta === '/health' ? c.ok(['ok'], 'nginx/1.18.0 (Ubuntu)') : c.ok(['<!doctype html>', '<html lang="es"><head><title>Tienda</title></head>', '<body>…</body></html>'], 'nginx/1.18.0 (Ubuntu)');
});

// ------------------------------------------------------------------ alarmas
// La capacidad y la portada pasan a medirse en el balanceador, como en una cuenta
// real; y llegan las de IAM, S3 y GuardDuty.
const def = n => N.DEFS.find(d => d.nombre === n);
Object.assign(def('tienda-web-healthy-hosts'), { ns: 'AWS/ApplicationELB', metrica: 'HealthyHostCount', dim: [['TargetGroup', 'targetgroup/tienda-web-tg/' + U.hex('tg', 16)], ['LoadBalancer', 'app/tienda-alb/' + U.hex('alb', 16)]],
  eval: st => { const n = N.sanos(st).length; return { estado: n < 2 ? 'ALARM' : 'OK', valor: n, sev: 'warning', res: T('el balanceador sólo ve ' + n + ' frontal' + (n === 1 ? '' : 'es') + ' sano' + (n === 1 ? '' : 's') + ' (mínimo 2)', 'the load balancer sees only ' + n + ' healthy web server' + (n === 1 ? '' : 's') + ' (minimum 2)') }; } });
Object.assign(def('tienda-home-canary'), { eval: st => { const n = N.porAlb(st).length; return { estado: n ? 'OK' : 'ALARM', valor: n ? 100 : 0, sev: 'critical', res: T('la web no responde a través del balanceador', 'the site does not respond through the load balancer') }; } });
N.DEFS.push({ nombre: 'tienda-alb-unhealthy-hosts', ns: 'AWS/ApplicationELB', metrica: 'UnHealthyHostCount', dim: [['TargetGroup', 'targetgroup/tienda-web-tg/' + U.hex('tg', 16)]], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: null,
  desc: T('El balanceador da por malo algún destino', 'The load balancer considers a target unhealthy'),
  eval: st => { const tg = N.tg(st), n = tg.targets.filter(t => N.salud(st, tg, t).estado === 'unhealthy').length; return { estado: n ? 'ALARM' : 'OK', valor: n, sev: 'warning', res: T(n + ' destino' + (n === 1 ? '' : 's') + ' unhealthy en tienda-web-tg', n + ' unhealthy target' + (n === 1 ? '' : 's') + ' in tienda-web-tg') }; } });
N.DEFS.push({ nombre: 'tienda-api-invoice-errors', ns: 'Tienda/API', metrica: 'InvoiceUploadErrors', dim: [['Service', 'tienda-api']], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: 'app-01',
  desc: T('tienda-api no consigue subir facturas a S3', 'tienda-api cannot upload invoices to S3'),
  eval: st => { const i = N.inst(st, ID.inst['app-01']), s = i && st.hosts[i.host] && st.hosts[i.host].svcs['tienda-api']; if (!N.viva(st, i) || !s || s.estado !== 'active' || !i.perfil) return { estado: 'INSUFFICIENT_DATA', valor: null }; const ok = N.evaluar(st, { rol: i.perfil }, 's3:PutObject', 'arn:aws:s3:::tienda-facturas/facturas/2026/09/F-2026-092301.pdf').dec === 'allowed'; return { estado: ok ? 'OK' : 'ALARM', valor: ok ? 0 : 37, sev: 'critical', res: T('las facturas no se suben a S3 (AccessDenied)', 'invoices are not being uploaded to S3 (AccessDenied)') }; } });
N.DEFS.push({ nombre: 'tienda-s3-public-bucket', ns: 'Tienda/Security', metrica: 'PublicBuckets', dim: [['ConfigRule', 's3-bucket-public-read-prohibited']], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: null,
  desc: T('Algún bucket de S3 se puede leer desde internet', 'An S3 bucket can be read from the internet'),
  eval: st => { const bs = st.aws.s3.buckets.filter(N.s3Publico); return { estado: bs.length ? 'ALARM' : 'OK', valor: bs.length, sev: 'critical', res: T('bucket público: ' + bs.map(b => b.nombre).join(', '), 'public bucket: ' + bs.map(b => b.nombre).join(', ')) }; } });
N.DEFS.push({ nombre: 'tienda-prices-config', ns: 'Tienda/Web', metrica: 'CatalogPriceErrors', dim: [['File', 's3://tienda-config/precios.json']], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: null,
  desc: T('La web no puede cargar los precios', 'The site cannot load the prices'),
  eval: st => { const v = actual(bucket(st, 'tienda-config'), 'precios.json'), mal = !v || v.contenido.some(l => /"productos": 0\b/.test(l)); return { estado: mal ? 'ALARM' : 'OK', valor: mal ? 1873 : 0, sev: 'critical', res: v ? T('precios.json trae 0 productos: la tienda muestra precios a 0', 'precios.json has 0 products: the store shows prices of 0') : T('precios.json no existe', 'precios.json does not exist') }; } });
N.DEFS.push({ nombre: 'iam-access-key-exposed', ns: 'Tienda/Security', metrica: 'ExposedAccessKeys', dim: [['Source', 'AWS Health']], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: null,
  desc: T('Una clave de acceso publicada sigue activa', 'A published access key is still active'),
  eval: st => { const f = st.aws.iam.filtrada, u = f && usuario(st, f.usuario), k = u && u.claves.find(x => x.id === f.clave && x.estado === 'Active'); return { estado: k ? 'ALARM' : 'OK', valor: k ? 1 : 0, sev: 'critical', res: T('la clave ' + (f ? f.clave : '') + ' está publicada y sigue activa', 'key ' + (f ? f.clave : '') + ' is public and still active') }; } });
N.DEFS.push({ nombre: 'guardduty-high-severity', ns: 'Tienda/Security', metrica: 'GuardDutyHighFindings', dim: [['Detector', U.hex('gd', 32)]], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: null,
  desc: T('GuardDuty ha encontrado algo grave', 'GuardDuty has found something serious'),
  eval: st => { const n = st.aws.instancias.filter(i => i.malicia && ['running', 'pending', 'stopping'].indexOf(i.estado) >= 0).length; return { estado: n ? 'ALARM' : 'OK', valor: n, sev: 'critical', res: T('CryptoCurrency:EC2/BitcoinTool.B: ' + n + ' instancias de la cuenta hablan con pools de minería', 'CryptoCurrency:EC2/BitcoinTool.B: ' + n + ' account instances are talking to mining pools') }; } });

// run-instances con --iam-instance-profile Name=...
const correr = OPS.ec2['run-instances'];
OPS.ec2['run-instances'] = (st, o) => {
  const m = /(?:Name=|instance-profile\/)([^,\s]+)/.exec((o['iam-instance-profile'] || []).join(' '));
  if (m && !rol(st, m[1])) falla('InvalidParameterValue', "Value (" + m[1] + ") for parameter iamInstanceProfile.name is invalid. Invalid IAM Instance Profile name");
  const r = correr(st, o);
  if (m) r.datos.Instances.forEach(j => { const i = st.aws.instancias.find(x => x.id === j.InstanceId); i.perfil = m[1]; Object.assign(j, C.instJ(st, i)); });
  return r;
};
C.AYUDA.push('iam', 's3', 's3api', 'elbv2');
})(window.PUESTO = window.PUESTO || {});
