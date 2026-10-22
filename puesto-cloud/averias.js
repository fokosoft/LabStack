// Puesto Cloud · catálogo de averías (fase 4).
//
// Lo mismo que el catálogo del Puesto Linux, pero de la nube: cada tipo sabe
// romper la cuenta (aplicar), decir lo que sigue roto (pendientes), arreglarse
// con comandos de verdad (arreglo), comprobar que sus parámetros tienen sentido
// (validar) y qué recurso toca (para no combinar dos averías sobre lo mismo).
// Con eso se componen los tickets, las guardias y las incidencias que llegan en
// un fichero. Las condiciones (condicion: true) preparan la escena: no rompen
// nada ni tienen arreglo.
(function (P) {
'use strict';
const U = P.u, T = P.T, N = P.nube, ID = N.ID;
P.averias = {};
const def = (id, o) => { P.averias[id] = Object.assign({ id, orden: 1, condicion: false, params: {}, toca: () => [], pendientes: () => [], arreglo: () => [], validar: () => null }, o); };
const INST = ['bastion', 'web-01', 'web-02', 'app-01', 'db-01'];
const BUCKETS = ['tienda-facturas', 'tienda-catalogo-backups', 'tienda-config', 'tienda-artefactos'];
const hace = a => (a.hace != null ? a.hace : 30);
const pHace = T('minutos desde que empezó la avería', 'minutes since the fault started');
// Lo que dejan unas pruebas de carga y lo que lanza un intruso: ids fijos, para que los guiones los nombren.
N.CARGA = { inst: 'i-0' + U.hex('carga-01', 16), vol: 'vol-0' + U.hex('carga-datos', 16), eip: 'eipalloc-0' + U.hex('carga-eip', 16) };
N.idMalo = k => 'i-0' + U.hex('malo:' + k, 16);

// ------------------------------------------------------------------ red y acceso
def('ip-oficina', {
  titulo: T('La IP pública de la oficina cambia', 'The office public IP changes'),
  descripcion: T('El security group del bastión sólo deja entrar al 22 desde la IP antigua: ssh se queda en timeout.', 'The bastion security group only lets the old IP into port 22: ssh times out.'),
  params: { nueva: T('la IP nueva de la oficina', 'the office\'s new IP'), hace: pHace }, ejemplo: { nueva: '198.51.100.24', hace: 45 },
  toca: () => ['oficina'],
  validar: (st, a) => !/^\d+\.\d+\.\d+\.\d+$/.test(a.nueva || '') ? T('nueva tiene que ser una IP', 'nueva must be an IP') : a.nueva === N.OFICINA ? T('esa es la IP de siempre: no cambiaría nada', 'that is the usual IP: nothing would change') : null,
  aplicar: (st, a) => { st.aws.miIp = a.nueva; },
  pendientes: (st, a) => N.permite(st, N.inst(st, ID.inst.bastion), 22, { ip: st.aws.miIp }) ? [] : [T('Desde la oficina (' + st.aws.miIp + ') sigue sin llegarse al puerto 22 del bastión', 'The bastion\'s port 22 is still unreachable from the office (' + st.aws.miIp + ')')],
  arreglo: a => ['aws ec2 revoke-security-group-ingress --group-id ' + ID.sg.bastion + ' --protocol tcp --port 22 --cidr ' + N.OFICINA + '/32', 'aws ec2 authorize-security-group-ingress --group-id ' + ID.sg.bastion + ' --protocol tcp --port 22 --cidr ' + a.nueva + '/32'],
});
def('sg-abierto', {
  titulo: T('Un puerto abierto a todo internet', 'A port open to the whole internet'),
  descripcion: T('Alguien añade a mano una regla 0.0.0.0/0 a un security group. Si es el 22, salta la alarma de seguridad.', 'Someone adds a 0.0.0.0/0 rule to a security group by hand. If it is port 22, the security alarm fires.'),
  params: { sg: T('el security group: bastion, web, app o db', 'the security group: bastion, web, app or db'), puerto: T('el puerto', 'the port') }, ejemplo: { sg: 'app', puerto: 22 },
  toca: a => ['sg:' + a.sg],
  validar: (st, a) => !ID.sg[a.sg] || a.sg === 'default' || a.sg === 'alb' || a.sg === 'rds' ? T('sg tiene que ser bastion, web, app o db', 'sg must be bastion, web, app or db') : !(a.puerto >= 1 && a.puerto <= 65535) ? T('puerto entre 1 y 65535', 'puerto between 1 and 65535') : N.sg(st, ID.sg[a.sg]).reglas.some(r => r.cidr === '0.0.0.0/0' && r.desde <= a.puerto && r.hasta >= a.puerto) ? T('ese puerto ya está abierto a internet en tienda-' + a.sg, 'that port is already open to the internet on tienda-' + a.sg) : null,
  aplicar: (st, a) => { N.sg(st, ID.sg[a.sg]).reglas.push({ proto: 'tcp', desde: a.puerto, hasta: a.puerto, cidr: '0.0.0.0/0', id: 'sgr-0' + U.hex('abierto' + a.sg + a.puerto, 16) }); },
  pendientes: (st, a) => N.sg(st, ID.sg[a.sg]).reglas.some(r => r.cidr === '0.0.0.0/0' && r.desde <= a.puerto && r.hasta >= a.puerto) ? [T('tienda-' + a.sg + ' deja entrar al ' + a.puerto + ' desde cualquier sitio', 'tienda-' + a.sg + ' lets anyone into port ' + a.puerto)] : [],
  arreglo: a => ['aws ec2 revoke-security-group-ingress --group-id ' + ID.sg[a.sg] + ' --protocol tcp --port ' + a.puerto + ' --cidr 0.0.0.0/0'],
});
def('ruta-rota', {
  titulo: T('La red privada pierde su salida a internet', 'The private network loses its way to the internet'),
  descripcion: T('La ruta por defecto de las subredes privadas apunta a un NAT borrado (blackhole) o al internet gateway, por donde no pueden salir.', 'The private subnets\' default route points at a deleted NAT (blackhole) or at the internet gateway, which they cannot use.'),
  params: { modo: T('nat-borrado o igw', 'nat-borrado or igw'), hace: pHace }, ejemplo: { modo: 'nat-borrado', hace: 60 },
  toca: () => ['rt'],
  validar: (st, a) => ['nat-borrado', 'igw'].indexOf(a.modo) < 0 ? T('modo: nat-borrado o igw', 'modo: nat-borrado or igw') : null,
  aplicar: (st, a) => {
    const r = N.rt(st, ID.rtPriv).rutas.find(x => x.dest === '0.0.0.0/0');
    if (a.modo === 'igw') { delete r.nat; r.gw = ID.igw; return; }
    st.aws.nats.unshift({ id: ID.natViejo, nombre: 'tienda-nat-old', subred: ID.subred['public-b'], estado: 'deleted', ipPub: '34.250.18.95', ipPriv: '10.0.2.140', creado: -400000, borrado: -hace(a) });
    st.aws.nats.find(n => n.id === ID.nat).creado = -hace(a) - 35;
    r.nat = ID.natViejo;
  },
  pendientes: st => {
    const out = [], r = N.rutaDefecto(st, ID.subred['private-a']);
    if (r && r.gw === ID.igw) out.push(T('La tabla de rutas privada sale por el internet gateway: la API y la base de datos no deben tener ruta directa a internet', 'The private route table goes out through the internet gateway: the API and the database must not have a direct route to the internet'));
    if (!N.ipSalida(st, N.inst(st, ID.inst['app-01']))) out.push(T('app-01 sigue sin salida a internet', 'app-01 still has no internet egress'));
    return out;
  },
  arreglo: () => ['aws ec2 replace-route --route-table-id ' + ID.rtPriv + ' --destination-cidr-block 0.0.0.0/0 --nat-gateway-id ' + ID.nat],
});

// ------------------------------------------------------------------ instancias y discos
def('instancia-parada', {
  titulo: T('Una instancia parada', 'A stopped instance'),
  descripcion: T('Alguien la paró y nadie la volvió a arrancar. Al arrancarla tendrá otra IP pública.', 'Someone stopped it and nobody started it again. When started it gets another public IP.'),
  params: { instancia: T('bastion, web-01, web-02, app-01 o db-01', 'bastion, web-01, web-02, app-01 or db-01'), hace: pHace }, ejemplo: { instancia: 'web-02', hace: 600 },
  toca: a => ['inst:' + a.instancia],
  validar: (st, a) => INST.indexOf(a.instancia) < 0 ? T('instancia: ' + INST.join(', '), 'instancia: ' + INST.join(', ')) : null,
  aplicar: (st, a) => N.parar(st, N.inst(st, ID.inst[a.instancia]), -hace(a)),
  pendientes: (st, a) => { const i = N.inst(st, ID.inst[a.instancia]); return i.estado === 'running' ? [] : [T(a.instancia + ' está ' + i.estado, a.instancia + ' is ' + i.estado)]; },
  arreglo: a => ['aws ec2 start-instances --instance-ids ' + ID.inst[a.instancia], 'aws ec2 wait instance-running --instance-ids ' + ID.inst[a.instancia]].concat(/^web/.test(a.instancia) ? ['sleep 120'] : []),
});
def('servicio-caido', {
  titulo: T('Un servicio caído en una instancia', 'A service down on an instance'),
  descripcion: T('nginx, tienda-api o postgresql parados (o caídos), y quizá deshabilitados: no volverán solos con un reinicio.', 'nginx, tienda-api or postgresql stopped (or crashed), and maybe disabled: they will not come back by themselves on a reboot.'),
  orden: 2,
  params: { instancia: T('la instancia', 'the instance'), servicio: T('nginx, tienda-api o postgresql', 'nginx, tienda-api or postgresql'), deshabilitado: T('además, deshabilitado', 'disabled as well'), hace: pHace }, ejemplo: { instancia: 'web-01', servicio: 'nginx', deshabilitado: false, hace: 15 },
  toca: a => ['svc:' + a.instancia + ':' + a.servicio],
  validar: (st, a) => INST.indexOf(a.instancia) < 0 ? T('instancia: ' + INST.join(', '), 'instancia: ' + INST.join(', ')) : !st.hosts[a.instancia].svcs[a.servicio] || ['ssh', 'chrony'].indexOf(a.servicio) >= 0 ? T(a.instancia + ' no tiene el servicio «' + a.servicio + '»', a.instancia + ' does not have the service \'' + a.servicio + '\'') : null,
  aplicar: (st, a) => { const h = st.hosts[a.instancia]; if (a.deshabilitado) P.parado(st, h, a.servicio, -hace(a), true); else P.fallar(st, h, a.servicio, null, -hace(a)); },
  pendientes: (st, a) => { const h = st.hosts[a.instancia], s = h && h.svcs[a.servicio], out = []; if (!s) return [T(a.instancia + ' ya no existe', a.instancia + ' no longer exists')]; if (s.estado !== 'active') out.push(T(a.servicio + ' no está corriendo en ' + a.instancia, a.servicio + ' is not running on ' + a.instancia)); if (a.deshabilitado && !s.enabled) out.push(T(a.servicio + ' de ' + a.instancia + ' no está habilitado: volverá a caer en el próximo reinicio', a.servicio + ' on ' + a.instancia + ' is not enabled: it will go down again on the next reboot')); return out; },
  arreglo: a => ['ssh ' + a.instancia + ' sudo systemctl ' + (a.deshabilitado ? 'enable --now ' : 'restart ') + a.servicio].concat(/^web/.test(a.instancia) ? ['aws elbv2 wait target-in-service --target-group-arn ' + ID.tg] : []),
});
def('disco-lleno', {
  titulo: T('El disco de PostgreSQL de db-01 se llena', 'db-01\'s PostgreSQL disk fills up'),
  descripcion: T('El volumen de datos crece con los pedidos. Ampliarlo son dos pasos: el volumen (modify-volume) y el sistema de ficheros (resize2fs).', 'The data volume grows with orders. Growing it is two steps: the volume (modify-volume) and the filesystem (resize2fs).'),
  params: { usadoG: T('GiB usados de 98', 'GiB used out of 98'), hace: pHace }, ejemplo: { usadoG: 91.3, hace: 180 },
  toca: () => ['vol-db'],
  validar: (st, a) => !(a.usadoG >= 80 && a.usadoG <= 98) ? T('usadoG entre 80 y 98', 'usadoG between 80 and 98') : null,
  aplicar: (st, a) => { st.hosts['db-01'].discos['/var/lib/postgresql'].baseG = a.usadoG; },
  pendientes: st => { const p = U.pctDisco(st.hosts['db-01'], '/var/lib/postgresql'), v = N.vol(st, ID.vol['db-01-datos']), d = st.hosts['db-01'].discos['/var/lib/postgresql']; return p < 80 ? [] : [v.visible > 100 && d.tamG < v.visible * 0.9 ? T('El volumen ya mide ' + v.visible + ' GiB, pero el sistema de ficheros sigue con el tamaño antiguo: /var/lib/postgresql al ' + p + ' % (df -h)', 'The volume is already ' + v.visible + ' GiB, but the filesystem still has the old size: /var/lib/postgresql at ' + p + '% (df -h)') : T('/var/lib/postgresql sigue al ' + p + ' %', '/var/lib/postgresql is still at ' + p + '%')]; },
  arreglo: () => ['aws ec2 create-snapshot --volume-id ' + ID.vol['db-01-datos'], 'aws ec2 modify-volume --volume-id ' + ID.vol['db-01-datos'] + ' --size 200', 'sleep 60', 'ssh db-01 sudo resize2fs /dev/nvme1n1'],
});
def('recursos-olvidados', {
  titulo: T('Restos de unas pruebas de carga', 'Leftovers from some load tests'),
  descripcion: T('Una m6i.4xlarge encendida, un volumen io2 de 1000 GiB y 10 000 IOPS sin usar y una IP elástica suelta, de hace tres semanas: dispara la detección de anomalías de coste.', 'A running m6i.4xlarge, an unused 1000 GiB io2 volume with 10,000 IOPS and a loose Elastic IP, from three weeks ago: it fires cost anomaly detection.'),
  orden: 3,
  params: { instancia: T('deja la instancia', 'leaves the instance'), volumen: T('deja el volumen io2', 'leaves the io2 volume'), eip: T('deja la IP elástica', 'leaves the Elastic IP'), hace: pHace }, ejemplo: { instancia: true, volumen: true, eip: true, hace: 30300 },
  toca: () => ['carga'],
  validar: (st, a) => a.instancia === false && a.volumen === false && a.eip === false ? T('tiene que dejar al menos una cosa', 'it must leave at least one thing') : null,
  aplicar: (st, a) => {
    const s = st.aws, tg = [{ Key: 'Entorno', Value: 'pruebas' }, { Key: 'Propietario', Value: 'qa' }], m = -hace(a);
    if (a.instancia !== false) s.instancias.push({ id: N.CARGA.inst, nombre: 'carga-01', tipo: 'm6i.4xlarge', subred: ID.subred['public-b'], sgs: [ID.sg.web], ipPriv: '10.0.2.88', ipPub: '34.247.18.120', ami: ID.ami.base, clave: N.CLAVE, estado: 'running', lanzada: m, iniciada: m, motivo: '', host: null, listoEn: null, perfil: null, tags: tg });
    if (a.volumen !== false) s.volumenes.push({ id: N.CARGA.vol, inst: null, tam: 1000, visible: 1000, tipo: 'io2', iops: 10000, raiz: false, device: null, nvme: null, montaje: null, creado: m, mods: [], tags: [{ Key: 'Name', Value: 'carga-datos' }].concat(tg) });
    if (a.eip !== false) s.eips.push({ id: N.CARGA.eip, ip: '52.48.210.17', inst: null, creado: m, tags: [{ Key: 'Name', Value: 'carga-eip' }].concat(tg) });
  },
  pendientes: (st, a) => {
    const out = [], i = st.aws.instancias.find(x => x.id === N.CARGA.inst);
    if (i && i.estado !== 'terminated' && i.estado !== 'shutting-down') out.push(T('carga-01 (m6i.4xlarge) sigue existiendo: ' + i.estado, 'carga-01 (m6i.4xlarge) still exists: ' + i.estado));
    if (N.vol(st, N.CARGA.vol)) out.push(T('El volumen io2 de 1000 GiB carga-datos sigue existiendo', 'The 1000 GiB io2 volume carga-datos still exists'));
    if (st.aws.eips.some(e => e.id === N.CARGA.eip && e.liberada == null)) out.push(T('La IP elástica de las pruebas sigue reservada', 'The tests\' Elastic IP is still allocated'));
    return out;
  },
  arreglo: a => [].concat(a.instancia !== false ? ['aws ec2 terminate-instances --instance-ids ' + N.CARGA.inst] : [], a.volumen !== false ? ['aws ec2 create-snapshot --volume-id ' + N.CARGA.vol, 'aws ec2 delete-volume --volume-id ' + N.CARGA.vol] : [], a.eip !== false ? ['aws ec2 release-address --allocation-id ' + N.CARGA.eip] : []),
});

// ------------------------------------------------------------------ IAM y S3
def('politica-api', {
  titulo: T('La política de la API apunta al bucket, no a sus objetos', 'The API policy points at the bucket, not its objects'),
  descripcion: T('Una versión nueva de tienda-api-facturas da PutObject sobre arn:aws:s3:::tienda-facturas en vez de tienda-facturas/*: las facturas no se suben.', 'A new version of tienda-api-facturas grants PutObject on arn:aws:s3:::tienda-facturas instead of tienda-facturas/*: invoices are not uploaded.'),
  params: { hace: pHace }, ejemplo: { hace: 1052 },
  toca: () => ['iam-api'],
  aplicar: (st, a) => { const p = st.aws.iam.politicas[ID.pol.api]; if (!p.versiones.some(v => v.id === 'v2')) p.versiones.push({ id: 'v2', doc: N.POL_API_V2_MALA, creada: -hace(a) }); p.defecto = 'v2'; },
  pendientes: st => {
    const out = [], r = N.iam.rol(st, 'tienda-api-role');
    if (N.evaluar(st, { rol: 'tienda-api-role' }, 's3:PutObject', 'arn:aws:s3:::tienda-facturas/facturas/2026/09/F-2026-092301.pdf').dec !== 'allowed') out.push(T('tienda-api-role sigue sin poder escribir facturas en tienda-facturas', 'tienda-api-role still cannot write invoices to tienda-facturas'));
    const anchas = r.politicas.filter(x => /AdministratorAccess|AmazonS3FullAccess|PowerUserAccess/.test(x));
    if (anchas.length) out.push(T('tienda-api-role tiene una política demasiado amplia (' + anchas.map(x => x.split('/').pop()).join(', ') + '): sólo necesita su bucket', 'tienda-api-role has an overly broad policy (' + anchas.map(x => x.split('/').pop()).join(', ') + '): it only needs its bucket'));
    return out;
  },
  arreglo: () => ['aws iam set-default-policy-version --policy-arn ' + ID.pol.api + ' --version-id v1'],
});
def('clave-filtrada', {
  titulo: T('Una clave de acceso publicada, y usada', 'A published access key, and used'),
  descripcion: T('La clave de ci-deploy aparece en un repositorio público y alguien ya ha lanzado instancias de minería en us-east-1.', 'ci-deploy\'s key shows up in a public repository and someone has already launched mining instances in us-east-1.'),
  orden: 3,
  params: { intrusas: T('instancias del intruso (1-3)', 'intruder instances (1-3)'), hace: pHace }, ejemplo: { intrusas: 3, hace: 40 },
  toca: () => ['iam-ci'],
  validar: (st, a) => !(a.intrusas >= 1 && a.intrusas <= 3) ? T('intrusas entre 1 y 3', 'intrusas between 1 and 3') : null,
  aplicar: (st, a) => {
    const s = st.aws, u = N.iam.usuario(st, 'ci-deploy'), m = -hace(a);
    s.iam.filtrada = { usuario: 'ci-deploy', clave: ID.clave.ci };
    u.claves[0].uso = { min: m + 18, svc: 'ec2', region: 'us-east-1' };
    for (let k = 1; k <= a.intrusas; k++) s.instancias.push({ id: N.idMalo(k), nombre: '', tipo: 'c5.4xlarge', region: 'us-east-1', az: 'us-east-1' + 'abc'[k - 1], subred: 'subnet-0' + U.hex('use1-sub' + k, 16), vpc: 'vpc-0' + U.hex('use1-vpc', 16),
      sgs: ['sg-0' + U.hex('use1-sg', 16)], ipPriv: '172.31.' + (20 + k) + '.' + (40 + k * 7), ipPub: '3.' + (80 + k) + '.' + (11 * k) + '.' + (200 + k), ami: 'ami-0' + U.hex('xmrig', 16),
      clave: null, estado: 'running', lanzada: m + 19, iniciada: m + 19, motivo: '', host: null, listoEn: null, perfil: null, malicia: true });
  },
  pendientes: st => {
    const out = [], u = N.iam.usuario(st, 'ci-deploy'), k = u.claves.find(x => x.id === ID.clave.ci);
    if (k && k.estado === 'Active') out.push(T('La clave filtrada ' + ID.clave.ci + ' sigue activa', 'The leaked key ' + ID.clave.ci + ' is still active'));
    if (!u.claves.some(x => x.id !== ID.clave.ci && x.estado === 'Active')) out.push(T('ci-deploy no tiene ninguna clave activa nueva: el pipeline de despliegue se ha quedado sin credenciales', 'ci-deploy has no new active key: the deployment pipeline has been left without credentials'));
    const malas = st.aws.instancias.filter(i => i.malicia && i.estado !== 'terminated' && i.estado !== 'shutting-down');
    if (malas.length) out.push(T('Siguen vivas ' + malas.length + ' instancias que no son vuestras', malas.length + ' instances that are not yours are still alive'));
    return out;
  },
  arreglo: a => ['aws iam update-access-key --user-name ci-deploy --access-key-id ' + ID.clave.ci + ' --status Inactive', 'aws ec2 terminate-instances --region us-east-1 --instance-ids ' + Array.from({ length: a.intrusas }, (_, k) => N.idMalo(k + 1)).join(' '), 'aws iam create-access-key --user-name ci-deploy', 'aws iam delete-access-key --user-name ci-deploy --access-key-id ' + ID.clave.ci],
});
def('bucket-publico', {
  titulo: T('Un bucket abierto a internet', 'A bucket open to the internet'),
  descripcion: T('Bloqueo de acceso público apagado y una política con Principal "*": cualquiera puede leerlo.', 'Block Public Access off and a policy with Principal "*": anyone can read it.'),
  params: { bucket: T('el bucket', 'the bucket'), hace: pHace }, ejemplo: { bucket: 'tienda-catalogo-backups', hace: 1260 },
  toca: a => ['s3:' + a.bucket],
  validar: (st, a) => BUCKETS.indexOf(a.bucket) < 0 ? T('bucket: ' + BUCKETS.join(', '), 'bucket: ' + BUCKETS.join(', ')) : null,
  aplicar: (st, a) => { const b = N.bucket(st, a.bucket); b.bloqueo = { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false }; b.politica = { Version: '2012-10-17', Statement: [{ Sid: 'CompartirProveedor', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::' + a.bucket + '/*' }] }; },
  pendientes: (st, a) => { const b = N.bucket(st, a.bucket); return N.s3Publico(b) ? [T(a.bucket + ' sigue siendo público', a.bucket + ' is still public')] : (!b.bloqueo || !b.bloqueo.BlockPublicPolicy || !b.bloqueo.RestrictPublicBuckets) ? [T(a.bucket + ' no está protegido: sin el bloqueo de acceso público, cualquiera puede volver a publicarlo con una política', a.bucket + ' is not protected: without the public access block, anyone can make it public again with a policy')] : []; },
  arreglo: a => ['aws s3api delete-bucket-policy --bucket ' + a.bucket, 'aws s3api put-public-access-block --bucket ' + a.bucket + ' --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"'],
});
def('precios-vacios', {
  titulo: T('Un precios.json vacío', 'An empty precios.json'),
  descripcion: T('El pipeline sube una versión de s3://tienda-config/precios.json con 0 productos. El bucket tiene versionado.', 'The pipeline uploads a version of s3://tienda-config/precios.json with 0 products. The bucket is versioned.'),
  params: { hace: pHace }, ejemplo: { hace: 25 },
  toca: () => ['precios'],
  aplicar: (st, a) => { N.bucket(st, 'tienda-config').objetos['precios.json'].unshift(N.verS3('precios-413', N.PRECIOS_MALOS, -hace(a))); },
  pendientes: st => { const v = N.objetoActual(N.bucket(st, 'tienda-config'), 'precios.json'); return !v ? [T('precios.json no existe: la web no tiene precios', 'precios.json does not exist: the site has no prices')] : v.contenido.some(l => /"productos": 0\b/.test(l)) ? [T('precios.json sigue trayendo 0 productos', 'precios.json still has 0 products')] : v.contenido.some(l => /"version": 412/.test(l)) ? [] : [T('precios.json no es la última versión buena (la 412)', 'precios.json is not the last good version (412)')]; },
  arreglo: (a, st) => { const buena = N.bucket(st, 'tienda-config').objetos['precios.json'].find(v => !v.marcador && !v.contenido.some(l => /"productos": 0\b/.test(l))); return ['aws s3api copy-object --bucket tienda-config --key precios.json --copy-source "tienda-config/precios.json?versionId=' + buena.id + '"']; },
});

// ------------------------------------------------------------------ balanceo, datos y escalado
def('health-check', {
  titulo: T('El health check pide una ruta que no existe', 'The health check asks for a path that does not exist'),
  descripcion: T('El target group pide otra ruta: 404 en todos los destinos. El ALB sigue sirviendo a ciegas (fail-open).', 'The target group asks for another path: 404 on every target. The ALB keeps serving blindly (fail-open).'),
  params: { ruta: T('la ruta equivocada', 'the wrong path'), hace: pHace }, ejemplo: { ruta: '/healthz', hace: 42 },
  toca: () => ['tg'],
  validar: (st, a) => !/^\/[a-z0-9/_-]*$/.test(a.ruta || '') ? T('ruta tiene que empezar por /', 'ruta must start with /') : N.rutaWeb(a.ruta) ? T('nginx sirve ' + a.ruta + ': no rompería nada', 'nginx serves ' + a.ruta + ': nothing would break') : null,
  aplicar: (st, a) => { const tg = N.tg(st); tg.hc.path = a.ruta; tg.cambiado = -hace(a); tg.targets.forEach(t => { tg.salud[t.id] = { real: 'unhealthy', desde: -hace(a) + 1, antes: 'healthy', razon: 'Target.ResponseCodeMismatch', desc: 'Health checks failed with these codes: [404]' }; }); },
  pendientes: st => { const tg = N.tg(st), malos = tg.targets.filter(t => { const i = st.aws.instancias.find(x => x.id === t.id); return i && i.estado === 'running' && N.salud(st, tg, t).estado !== 'healthy'; }); return malos.length ? [T(malos.length + ' destino' + (malos.length > 1 ? 's' : '') + ' de tienda-web-tg sin pasar el health check', malos.length + ' target' + (malos.length > 1 ? 's' : '') + ' in tienda-web-tg not passing the health check')] : []; },
  arreglo: () => ['aws elbv2 modify-target-group --target-group-arn ' + ID.tg + ' --health-check-path /health', 'aws elbv2 wait target-in-service --target-group-arn ' + ID.tg],
});
def('rds-lleno', {
  titulo: T('La base de pedidos sin espacio', 'The orders database out of space'),
  descripcion: T('tienda-pedidos llega al 100 %: storage-full, y los pedidos no se guardan.', 'tienda-pedidos reaches 100%: storage-full, and orders are not saved.'),
  params: { hace: pHace }, ejemplo: { hace: 8 },
  toca: () => ['rds'],
  aplicar: (st, a) => { const x = N.rds(st, 'tienda-pedidos'); x.usadoG = x.almacen; x.estado = 'storage-full';
    st.aws.rds.eventos.push({ min: -hace(a) - 32, id: x.id, msg: 'The free storage capacity for DB Instance: tienda-pedidos is low at 3% of the provisioned storage [Provisioned Storage: 100.00 GB, Free Storage: 3.00 GB]. You may want to increase the provisioned storage to address this issue.' }, { min: -hace(a), id: x.id, msg: 'DB instance has a storage-full status' }); },
  pendientes: st => { const x = N.rds(st, 'tienda-pedidos'); return x.estado === 'storage-full' ? [T('tienda-pedidos sigue en storage-full', 'tienda-pedidos is still in storage-full') + (x.pendientes.almacen ? T(' (el cambio a ' + x.pendientes.almacen + ' GiB espera a la ventana de mantenimiento)', ' (the change to ' + x.pendientes.almacen + ' GiB is waiting for the maintenance window)') : '')] : N.rdsLibreG(x) < x.almacen * 0.2 ? [T('A tienda-pedidos le queda menos del 20 % libre: volverá a llenarse esta semana', 'tienda-pedidos has less than 20% free: it will fill up again this week')] : []; },
  arreglo: (a, st) => ['aws rds modify-db-instance --db-instance-identifier tienda-pedidos --allocated-storage ' + Math.ceil(N.rds(st, 'tienda-pedidos').almacen * 1.5) + ' --max-allocated-storage 500 --apply-immediately', 'sleep 240'],
});
def('ami-borrada', {
  titulo: T('Los workers sin AMI: el grupo no puede reponerlos', 'Workers without an AMI: the group cannot replace them'),
  descripcion: T('Alguien borró la AMI que usa la plantilla de tienda-workers, y AWS retiró las dos instancias: el grupo falla una y otra vez al lanzar.', 'Someone deleted the AMI tienda-workers\' template uses, and AWS retired both instances: the group fails again and again to launch.'),
  orden: 2,
  params: { hace: pHace }, ejemplo: { hace: 55 },
  toca: () => ['asg'],
  aplicar: (st, a) => {
    const m = -hace(a);
    st.aws.amis = st.aws.amis.filter(x => x.id !== ID.ami.worker1);
    st.aws.instancias.filter(i => i.asg).forEach(i => { i.estado = 'terminated'; i.fin = m; i.motivo = 'Service initiated (' + U.iso(m).replace('T', ' ') + ' GMT)'; st.aws.asg.actN++; st.aws.asg.actividades.unshift({ id: U.uuid('ret' + i.id), desc: 'Terminating EC2 instance: ' + i.id, causa: 'At ' + U.iso(m) + 'Z an instance was taken out of service in response to an EC2 scheduled retirement event.', ok: true, min: m }); });
    for (let x = m + 1; x < 0; x += 8) { st.aws.asg.actN++; st.aws.asg.actividades.unshift({ id: U.uuid('fallo' + x), desc: 'Launching a new EC2 instance.  Status Reason: The image id \'[' + ID.ami.worker1 + ']\' does not exist. Launching EC2 instance failed.', causa: 'At ' + U.iso(x) + 'Z an instance was started in response to a difference between desired and actual capacity, increasing the capacity from 0 to 2.', ok: false, msg: 'The image id \'[' + ID.ami.worker1 + ']\' does not exist. Launching EC2 instance failed.', min: x }); }
    N.asg(st).reintento = 2;
  },
  pendientes: st => { const out = [], n = st.aws.instancias.filter(i => i.asg && i.estado === 'running').length, d = N.datosLtAsg(st, N.asg(st)); if (!d || !N.ami(st, d.ImageId)) out.push(T('La plantilla que usa el grupo sigue apuntando a una AMI que no existe', 'The template the group uses still points at an AMI that does not exist')); if (n < 2) out.push(T('tienda-workers tiene ' + n + ' workers en servicio y hacen falta 2', 'tienda-workers has ' + n + ' workers in service and 2 are needed')); return out; },
  arreglo: () => ['aws ec2 create-launch-template-version --launch-template-name tienda-worker --source-version 1 --launch-template-data \'{"ImageId":"' + ID.ami.worker2 + '"}\'', 'aws ec2 modify-launch-template --launch-template-name tienda-worker --default-version 2', 'sleep 180'],
});
def('deriva-terraform', {
  titulo: T('Reglas añadidas a mano fuera de Terraform', 'Rules added by hand outside Terraform'),
  descripcion: T('tienda-web gana reglas que no están en ~/infra. terraform plan las enseña; terraform apply las quita.', 'tienda-web gains rules that are not in ~/infra. terraform plan shows them; terraform apply removes them.'),
  params: { puertos: T('los puertos abiertos a mano', 'the ports opened by hand'), hace: pHace }, ejemplo: { puertos: [22, 8080], hace: 200 },
  toca: () => ['sg:web'],
  validar: (st, a) => !Array.isArray(a.puertos) || !a.puertos.length || a.puertos.some(p => !(+p >= 1 && +p <= 65535)) ? T('puertos: una lista de puertos', 'puertos: a list of ports') : a.puertos.some(p => +p === 80 || +p === 443) ? T('el 80 y el 443 ya están abiertos en el código: no habría deriva', '80 and 443 are already open in the code: there would be no drift') : null,
  aplicar: (st, a) => { const g = N.sg(st, ID.sg.web); a.puertos.map(Number).forEach(p => g.reglas.push({ proto: 'tcp', desde: p, hasta: p, cidr: '0.0.0.0/0', desc: p === 22 ? T('depuracion desde casa (temporal)', 'debugging from home (temporary)') : p === 8080 ? T('API directa (pruebas)', 'direct API (tests)') : T('pruebas', 'tests'), id: 'sgr-0' + U.hex('deriva' + p, 16) })); },
  pendientes: st => { const d = N.derivaTf(st); return d.sobran.length || d.faltan.length ? [T('tienda-web no coincide con el código: ' + d.sobran.map(r => r.desde + '/' + (r.cidr || r.sg)).join(', ') + ' de más' + (d.faltan.length ? ', ' + d.faltan.length + ' de menos' : ''), 'tienda-web does not match the code: ' + d.sobran.map(r => r.desde + '/' + (r.cidr || r.sg)).join(', ') + ' extra' + (d.faltan.length ? ', ' + d.faltan.length + ' missing' : ''))] : []; },
  arreglo: () => ['cd ~/infra', 'terraform apply -auto-approve', 'cd'],
});

// ------------------------------------------------------------------ condiciones
def('pedido-borrado', {
  condicion: true,
  titulo: T('Un pedido borrado por error', 'An order deleted by mistake'),
  descripcion: T('El pedido P-2026-48213 desaparece de la base de producción: sólo una restauración a un momento anterior lo recupera.', 'Order P-2026-48213 disappears from the production database: only a restore to an earlier moment brings it back.'),
  params: { hace: pHace }, ejemplo: { hace: 31 },
  toca: () => ['pedido'],
  aplicar: (st, a) => { st.aws.rds.borradoMin = -hace(a); N.rds(st, 'tienda-pedidos').pedidos -= 1; },
});

// ------------------------------------------------------------------ campos (el compositor)
const cHace = { k: 'hace', t: 'num', min: 0, max: 40000, def: 30, etiqueta: T('hace (min)', 'ago (min)') };
const opc = (k, xs, etq) => ({ k, t: 'opciones', opciones: xs, etiqueta: etq || k });
P.camposAveria = {
  'ip-oficina': [{ k: 'nueva', t: 'texto', def: '198.51.100.24', etiqueta: T('IP nueva', 'new IP') }, cHace],
  'sg-abierto': [opc('sg', ['bastion', 'web', 'app', 'db'], 'security group'), { k: 'puerto', t: 'num', min: 1, max: 65535, def: 22, etiqueta: T('puerto', 'port') }],
  'ruta-rota': [opc('modo', ['nat-borrado', 'igw'], T('cómo se rompe', 'how it breaks')), cHace],
  'instancia-parada': [opc('instancia', INST, T('instancia', 'instance')), cHace],
  'servicio-caido': [opc('instancia', ['web-01', 'web-02', 'app-01', 'db-01'], T('instancia', 'instance')), opc('servicio', ['nginx', 'tienda-api', 'postgresql'], T('servicio', 'service')), { k: 'deshabilitado', t: 'bool', etiqueta: T('además, deshabilitado', 'disabled as well') }, cHace],
  'disco-lleno': [{ k: 'usadoG', t: 'num', min: 80, max: 98, paso: 0.1, def: 91.3, etiqueta: T('GiB usados (de 98)', 'GiB used (of 98)') }, cHace],
  'recursos-olvidados': [{ k: 'instancia', t: 'bool', opcional: true, etiqueta: T('la m6i.4xlarge', 'the m6i.4xlarge') }, { k: 'volumen', t: 'bool', opcional: true, etiqueta: T('el io2 de 1000 GiB', 'the 1000 GiB io2') }, { k: 'eip', t: 'bool', opcional: true, etiqueta: T('la IP elástica', 'the Elastic IP') }, cHace],
  'politica-api': [cHace],
  'clave-filtrada': [{ k: 'intrusas', t: 'num', min: 1, max: 3, def: 3, etiqueta: T('instancias del intruso', 'intruder instances') }, cHace],
  'bucket-publico': [opc('bucket', BUCKETS, 'bucket'), cHace],
  'precios-vacios': [cHace],
  'health-check': [{ k: 'ruta', t: 'texto', def: '/healthz', etiqueta: T('ruta equivocada', 'wrong path') }, cHace],
  'rds-lleno': [cHace],
  'ami-borrada': [cHace],
  'deriva-terraform': [{ k: 'puertos', t: 'lista', def: [22, 8080], etiqueta: T('puertos (separados por comas)', 'ports (comma-separated)') }, cHace],
  'pedido-borrado': [cHace],
};

// ------------------------------------------------------------------ para las incidencias en fichero
// Por tipo: la función del puesto, el área del ticket y dónde mirar (la segunda pista, sin decir qué).
const META = {
  'ip-oficina': ['red', 'VPC', T('el security group del bastión', 'the bastion\'s security group')],
  'sg-abierto': ['red', 'VPC', a => T('el security group tienda-' + a.sg, 'the tienda-' + a.sg + ' security group')],
  'ruta-rota': ['red', 'VPC', T('la salida a internet de la red privada', 'the private network\'s way out to the internet')],
  'instancia-parada': ['ec2', 'EC2', a => a.instancia],
  'servicio-caido': ['ec2', 'EC2', a => a.instancia],
  'disco-lleno': ['ec2', 'EBS', T('db-01 y sus volúmenes', 'db-01 and its volumes')],
  'recursos-olvidados': ['coste', T('Coste', 'Cost'), T('la factura (Cost Explorer)', 'the bill (Cost Explorer)')],
  'politica-api': ['iam', 'IAM', T('los permisos de la API', 'the API\'s permissions')],
  'clave-filtrada': ['iam', 'IAM', T('las claves de acceso y lo que se ha hecho con ellas', 'the access keys and what has been done with them')],
  'bucket-publico': ['iam', 'S3', a => a.bucket],
  'precios-vacios': ['ec2', 'S3', T('la configuración de la web en S3', 'the site\'s configuration in S3')],
  'health-check': ['ec2', 'ELB', T('el balanceador', 'the load balancer')],
  'rds-lleno': ['datos', 'RDS', 'tienda-pedidos'],
  'ami-borrada': ['ec2', 'Auto Scaling', T('el grupo de workers', 'the workers group')],
  'deriva-terraform': ['iac', 'Terraform', T('el security group tienda-web y ~/infra', 'the tienda-web security group and ~/infra')],
  'pedido-borrado': ['datos', 'RDS', 'tienda-pedidos'],
};
const meta = (a, k) => { const v = META[a.tipo][k]; return typeof v === 'function' ? v(a) : v; };
const ALARMAS = 'aws cloudwatch describe-alarms --state-value ALARM';
P.incidenciasCfg = {
  alertas: ALARMAS,
  maxHace: 43200,   // un mes: la factura de unas pruebas de carga olvidadas viene de hace semanas
  pista: T('Empieza por lo que ven las alarmas: ' + ALARMAS + '. Cada una dice dónde mirar.', 'Start with what the alarms see: ' + ALARMAS + '. Each one tells you where to look.'),
  funcionesDe: lista => [...new Set(lista.map(a => meta(a, 0)))].concat('incid'),
  areaDe: lista => [...new Set(lista.map(a => meta(a, 1)))].join(' · '),
  sitios: lista => [...new Set(lista.filter(a => !P.averias[a.tipo].condicion).map(a => meta(a, 2)))],
  mirar: /describe-|cloudwatch|\bwait\b|get-|list-|simulate-principal-policy|aws s3 ls|\bcurl\b|systemctl status|journalctl|\bdf\b|lsblk|terraform plan/,
  tocar: /(start|stop|reboot|terminate)-instances|authorize-|revoke-|(replace|create|delete)-route|modify-|put-|delete-|set-default-policy-version|(update|create)-access-key|copy-object|release-address|restore-db|launch-template|update-auto-scaling-group|systemctl (start|restart|enable)|resize2fs|growpart|terraform apply/,
  sinReiniciar: { t: T('No apagaste ni reiniciaste instancias para «ver si se arreglaba»', 'You did not stop or reboot instances to "see if it fixed itself"'), ok: st => !st.registro.some(r => /(stop|reboot)-instances|sudo reboot/.test(r.cmd)) },
  etiqueta: a => a.instancia && a.tipo !== 'recursos-olvidados' ? ' (' + (a.servicio ? a.servicio + T(' en ', ' on ') : '') + a.instancia + ')' : a.bucket ? ' (' + a.bucket + ')' : a.sg ? ' (tienda-' + a.sg + ')' : '',
};
// Dónde guardan el compositor y la cola lo suyo: no se mezcla con lo del Puesto Linux.
P.compositorCfg = { claveImp: 'puesto-cloud-importadas', claveBorrador: 'puesto-cloud-borrador', nuevoTipo: 'instancia-parada' };

// ------------------------------------------------------------------ usar el catálogo
P.aplicarAverias = (st, lista) => lista.forEach(a => P.averias[a.tipo].aplicar(st, a));
P.pendientesAverias = (st, lista) => [].concat(...lista.filter(a => !a.soloPractica && !P.averias[a.tipo].condicion).map(a => P.averias[a.tipo].pendientes(st, a)));
// Los arreglos encadenados: primero lo que otros necesitan (orden 1), después lo que depende de ello.
P.arregloAverias = (st, lista) => [].concat(...lista.map((a, i) => ({ a, i })).filter(x => !P.averias[x.a.tipo].condicion).sort((x, y) => P.averias[x.a.tipo].orden - P.averias[y.a.tipo].orden || x.i - y.i).map(x => P.averias[x.a.tipo].arreglo(x.a, st)));
P.validarAverias = lista => {
  const st = P.crear(), errores = [], toques = {};
  if (!Array.isArray(lista) || !lista.length) return [T('una incidencia necesita al menos una avería', 'an incident needs at least one fault')];
  lista.forEach((a, i) => {
    const t = a && P.averias[a.tipo];
    if (!t) { errores.push(T('avería ' + (i + 1) + ': tipo desconocido «' + (a && a.tipo) + '»', 'fault ' + (i + 1) + ": unknown type '" + (a && a.tipo) + "'")); return; }
    const pref = T('avería ' + (i + 1) + ' (' + a.tipo + '): ', 'fault ' + (i + 1) + ' (' + a.tipo + '): ');
    const falta = (P.camposAveria[a.tipo] || []).filter(c => !c.opcional && c.def == null && c.t !== 'bool' && (a[c.k] == null || a[c.k] === '')).map(c => c.k);
    if (falta.length) { errores.push(pref + T('falta ', 'missing ') + falta.join(', ')); return; }
    const e = t.validar(st, a);
    if (e) errores.push(pref + e);
    t.toca(a).forEach(k => { if (toques[k] != null) errores.push(T('las averías ' + (toques[k] + 1) + ' y ' + (i + 1) + ' tocan lo mismo (' + k + ')', 'faults ' + (toques[k] + 1) + ' and ' + (i + 1) + ' touch the same thing (' + k + ')')); else toques[k] = i; });
  });
  return errores;
};
})(window.PUESTO = window.PUESTO || {});
