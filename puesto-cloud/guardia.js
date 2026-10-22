// Puesto Cloud · guardias y caos (fase 3).
//
// Un catálogo pequeño de averías de la nube. Cada familia sabe romper la cuenta
// (con parámetros al azar: qué frontal, qué bucket…), decir qué queda roto y
// arreglarse con comandos de verdad. Con eso:
//   - una guardia combina familias que no se pisan, a partir de una semilla
//     (la misma semilla, la misma noche), sin ticket: sólo las alarmas;
//   - el caos programa una avería unos minutos más tarde, en el laboratorio libre.
// Es la semilla del catálogo completo de la fase 4.
(function (P) {
'use strict';
const U = P.u, T = P.T, N = P.nube, ID = N.ID;
P.azar = P.azar || (semilla => { let a = semilla >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
const uno = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];
P.nivelesGuardia = { 1: T('Tranquila', 'Quiet'), 2: T('Movida', 'Busy'), 3: T('Infierno', 'Hellish') };

// ------------------------------------------------------------------ familias
// aplicar(st, p, min): rompe en el minuto min · pendientes(st, p): lo que falta · arreglo(st, p): comandos
P.familias = [
  { id: 'web-parada', nivel: 1, toca: p => ['web', 'web:' + p.web], titulo: T('Un frontal parado', 'A stopped web server'), leccion: T('una instancia parada no sirve: start-instances y esperar a que el balanceador la vea sana', 'a stopped instance does not serve: start-instances and wait for the load balancer to see it healthy'),
    params: rnd => ({ web: uno(rnd, ['web-01', 'web-02']) }),
    aplicar: (st, p, min) => N.parar(st, N.inst(st, ID.inst[p.web]), min),
    pendientes: (st, p) => N.inst(st, ID.inst[p.web]).estado === 'running' ? [] : [T(p.web + ' no está running', p.web + ' is not running')],
    arreglo: (st, p) => ['aws ec2 start-instances --instance-ids ' + ID.inst[p.web], 'aws ec2 wait instance-running --instance-ids ' + ID.inst[p.web], 'aws elbv2 wait target-in-service --target-group-arn ' + ID.tg] },
  { id: 'nginx-caido', nivel: 1, toca: p => ['web', 'web:' + p.web], titulo: T('nginx caído en un frontal', 'nginx down on a web server'), leccion: T('el balanceador lo marca unhealthy y deja de mandarle tráfico: se arregla dentro, con systemctl', 'the load balancer marks it unhealthy and stops sending it traffic: you fix it inside, with systemctl'),
    params: rnd => ({ web: uno(rnd, ['web-01', 'web-02']) }),
    aplicar: (st, p, min) => P.fallar(st, p.web, 'nginx', null, min),
    pendientes: (st, p) => st.hosts[p.web].svcs.nginx.estado === 'active' ? [] : [T('nginx no corre en ' + p.web, 'nginx is not running on ' + p.web)],
    arreglo: (st, p) => ['ssh ' + p.web + ' sudo systemctl restart nginx', 'aws elbv2 wait target-in-service --target-group-arn ' + ID.tg] },
  { id: 'ssh-mundo', nivel: 1, toca: p => ['sg:' + p.sg], titulo: T('El 22 abierto a todo internet', 'Port 22 open to the whole internet'), leccion: T('una regla así se quita en cuanto se ve: revoke-security-group-ingress', 'a rule like that is removed as soon as it is spotted: revoke-security-group-ingress'),
    params: rnd => ({ sg: uno(rnd, ['bastion', 'app', 'db']) }),
    aplicar: (st, p) => N.sg(st, ID.sg[p.sg]).reglas.push({ proto: 'tcp', desde: 22, hasta: 22, cidr: '0.0.0.0/0', id: 'sgr-0' + U.hex('caos22' + p.sg, 16) }),
    pendientes: (st, p) => N.sg(st, ID.sg[p.sg]).reglas.some(r => r.cidr === '0.0.0.0/0' && r.desde <= 22 && r.hasta >= 22) ? [T('tienda-' + p.sg + ' deja entrar al 22 desde cualquier sitio', 'tienda-' + p.sg + ' lets anyone into port 22')] : [],
    arreglo: (st, p) => ['aws ec2 revoke-security-group-ingress --group-id ' + ID.sg[p.sg] + ' --protocol tcp --port 22 --cidr 0.0.0.0/0'] },
  { id: 'ruta-igw', nivel: 2, toca: () => ['rt'], titulo: T('La red privada sale por el internet gateway', 'The private network goes out through the internet gateway'), leccion: T('sin IP pública no hay salida por el internet gateway: la ruta privada va al NAT', 'without a public IP there is no way out through the internet gateway: the private route goes to the NAT'),
    params: () => ({}),
    aplicar: st => { const r = N.rt(st, ID.rtPriv).rutas.find(x => x.dest === '0.0.0.0/0'); delete r.nat; r.gw = ID.igw; },
    pendientes: st => N.ipSalida(st, N.inst(st, ID.inst['app-01'])) ? [] : [T('app-01 no tiene salida a internet', 'app-01 has no internet egress')],
    arreglo: () => ['aws ec2 replace-route --route-table-id ' + ID.rtPriv + ' --destination-cidr-block 0.0.0.0/0 --nat-gateway-id ' + ID.nat] },
  { id: 'bucket-publico', nivel: 2, toca: p => ['s3:' + p.b], titulo: T('Un bucket abierto a internet', 'A bucket open to the internet'), leccion: T('se quita la política pública y se enciende el bloqueo de acceso público', 'remove the public policy and switch on Block Public Access'),
    params: rnd => ({ b: uno(rnd, ['tienda-catalogo-backups', 'tienda-facturas']) }),
    aplicar: (st, p) => { const b = N.bucket(st, p.b); b.bloqueo = { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false }; b.politica = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::' + p.b + '/*' }] }; },
    pendientes: (st, p) => N.s3Publico(N.bucket(st, p.b)) ? [T(p.b + ' es público', p.b + ' is public')] : [],
    arreglo: (st, p) => ['aws s3api delete-bucket-policy --bucket ' + p.b, 'aws s3api put-public-access-block --bucket ' + p.b + ' --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"'] },
  { id: 'health-check', nivel: 2, toca: () => ['web', 'tg'], titulo: T('El health check pide una ruta que no existe', 'The health check asks for a path that does not exist'), leccion: T('el ALB da por malos a todos, pero sigue sirviendo (fail-open): modify-target-group', 'the ALB marks them all unhealthy but keeps serving (fail-open): modify-target-group'),
    params: rnd => ({ ruta: uno(rnd, ['/healthz', '/status', '/ping']) }),
    aplicar: (st, p) => { N.tg(st).hc.path = p.ruta; },
    pendientes: st => N.rutaWeb(N.tg(st).hc.path) ? [] : [T('el health check pide ' + N.tg(st).hc.path, 'the health check asks for ' + N.tg(st).hc.path)],
    arreglo: () => ['aws elbv2 modify-target-group --target-group-arn ' + ID.tg + ' --health-check-path /health', 'aws elbv2 wait target-in-service --target-group-arn ' + ID.tg] },
  { id: 'disco-db', nivel: 2, toca: () => ['vol-db'], titulo: T('El disco de PostgreSQL de db-01 casi lleno', 'db-01\'s PostgreSQL disk almost full'), leccion: T('se amplía el volumen y después el sistema de ficheros (resize2fs)', 'grow the volume and then the filesystem (resize2fs)'),
    params: rnd => ({ g: 88 + Math.floor(rnd() * 6) }),
    aplicar: (st, p) => { st.hosts['db-01'].discos['/var/lib/postgresql'].baseG = p.g; },
    pendientes: st => U.pctDisco(st.hosts['db-01'], '/var/lib/postgresql') >= 85 ? [T('/var/lib/postgresql sigue por encima del 85 %', '/var/lib/postgresql is still above 85%')] : [],
    arreglo: () => ['aws ec2 create-snapshot --volume-id ' + ID.vol['db-01-datos'], 'aws ec2 modify-volume --volume-id ' + ID.vol['db-01-datos'] + ' --size 200', 'sleep 60', 'ssh db-01 sudo resize2fs /dev/nvme1n1'] },
  { id: 'precios', nivel: 2, toca: () => ['precios'], titulo: T('Un precios.json vacío', 'An empty precios.json'), leccion: T('el versionado de S3 lo arregla: se copia encima la versión buena', 'S3 versioning fixes it: copy the good version on top'),
    params: () => ({}),
    aplicar: (st, p, min) => N.bucket(st, 'tienda-config').objetos['precios.json'].unshift(N.verS3('precios-caos-' + min, N.PRECIOS_MALOS, min)),
    pendientes: st => { const v = N.objetoActual(N.bucket(st, 'tienda-config'), 'precios.json'); return v && !v.contenido.some(l => /"productos": 0\b/.test(l)) ? [] : [T('precios.json trae 0 productos', 'precios.json has 0 products')]; },
    arreglo: st => { const vs = N.bucket(st, 'tienda-config').objetos['precios.json'], buena = vs.find(v => !v.marcador && !v.contenido.some(l => /"productos": 0\b/.test(l))); return ['aws s3api copy-object --bucket tienda-config --key precios.json --copy-source "tienda-config/precios.json?versionId=' + buena.id + '"']; } },
  { id: 'politica-api', nivel: 3, toca: () => ['iam-api'], titulo: T('La política de la API apunta al bucket, no a sus objetos', 'The API policy points at the bucket, not its objects'), leccion: T('las políticas guardan versiones: set-default-policy-version vuelve a la buena sin abrir permisos', 'policies keep versions: set-default-policy-version goes back to the good one without opening up permissions'),
    params: () => ({}),
    aplicar: (st, p, min) => { const x = st.aws.iam.politicas[ID.pol.api]; if (!x.versiones.some(v => v.id === 'v2')) x.versiones.push({ id: 'v2', doc: N.POL_API_V2_MALA, creada: min }); x.defecto = 'v2'; },
    pendientes: st => N.evaluar(st, { rol: 'tienda-api-role' }, 's3:PutObject', 'arn:aws:s3:::tienda-facturas/facturas/x.pdf').dec === 'allowed' ? [] : [T('tienda-api-role no puede escribir facturas', 'tienda-api-role cannot write invoices')],
    arreglo: () => ['aws iam set-default-policy-version --policy-arn ' + ID.pol.api + ' --version-id v1'] },
  { id: 'rds-lleno', nivel: 3, toca: () => ['rds'], titulo: T('La base de pedidos sin espacio', 'The orders database out of space'), leccion: T('modify-db-instance con --apply-immediately (sin él, espera al domingo)', 'modify-db-instance with --apply-immediately (without it, it waits until Sunday)'),
    params: () => ({}),
    aplicar: st => { const x = N.rds(st, 'tienda-pedidos'); x.usadoG = x.almacen; x.estado = 'storage-full'; },
    pendientes: st => N.rds(st, 'tienda-pedidos').estado === 'storage-full' ? [T('tienda-pedidos en storage-full', 'tienda-pedidos in storage-full')] : [],
    arreglo: st => ['aws rds modify-db-instance --db-instance-identifier tienda-pedidos --allocated-storage ' + Math.ceil(N.rds(st, 'tienda-pedidos').almacen * 1.5) + ' --max-allocated-storage 500 --apply-immediately', 'sleep 240'] },
  { id: 'workers-ami', nivel: 3, toca: () => ['asg'], titulo: T('Workers sin AMI: el grupo no puede reponerlos', 'Workers without an AMI: the group cannot replace them'), leccion: T('el historial de actividad dice por qué no lanza: plantilla nueva con una AMI que exista', 'the activity history says why it cannot launch: a new template version with an AMI that exists'),
    params: () => ({}),
    aplicar: (st, p, min) => { st.aws.amis = st.aws.amis.filter(a => a.id !== ID.ami.worker1); st.aws.instancias.filter(i => i.asg && i.estado !== 'terminated').forEach(i => N.terminar(st, i)); },
    pendientes: st => st.aws.instancias.filter(i => i.asg && i.estado === 'running').length >= 2 ? [] : [T('tienda-workers sin workers en servicio', 'tienda-workers has no workers in service')],
    arreglo: () => ['aws ec2 create-launch-template-version --launch-template-name tienda-worker --source-version 1 --launch-template-data \'{"ImageId":"' + ID.ami.worker2 + '"}\'', 'aws ec2 modify-launch-template --launch-template-name tienda-worker --default-version 2', 'sleep 180'] },
];
const famPorId = id => P.familias.find(f => f.id === id);

// ------------------------------------------------------------------ guardia
const choca = (a, b) => a.some(x => b.indexOf(x) >= 0);
const { usado, antes, despues } = P.ayudasEscenario;
const MUTA = /aws (ec2 (start|stop|terminate|run|authorize|revoke|replace|create|modify|delete)|elbv2 (modify|register)|s3api (delete|put|copy)|iam (set|attach|detach|update|delete|create)|rds (modify|restore|create)|autoscaling (update|set))|systemctl (start|restart)|resize2fs/;
function guardiaDe(nivel, semilla, intento) {
  const rnd = P.azar(semilla * 31 + intento), elegidas = [];
  const exactas = P.familias.filter(f => f.nivel === nivel);
  const pool = P.familias.filter(f => f.nivel <= nivel);
  const primera = uno(rnd, exactas), p0 = primera.params(rnd);
  elegidas.push({ f: primera, p: p0, toca: primera.toca(p0) });
  for (let k = 0; elegidas.length < nivel && k < 30; k++) {
    const f = uno(rnd, pool), p = f.params(rnd), t = f.toca(p);
    if (elegidas.some(x => x.f.id === f.id || choca(x.toca, t))) continue;
    elegidas.push({ f, p, toca: t });
  }
  const id = 'GRD-' + (semilla % 1000000).toString(36).toUpperCase().padStart(4, '0');
  const hace = 20 + Math.floor(rnd() * 60);
  const e = {
    id, clave: id, tipo: 'incidente', nivel, area: T('Guardia', 'On call'), funciones: ['incid'], impacto: nivel === 1 ? 'medio' : 'alto', urgencia: 'alta',
    de: T('Busca de guardia', 'On-call pager'), asunto: T('Guardia ' + P.nivelesGuardia[nivel].toLowerCase() + ' · semilla ' + semilla, P.nivelesGuardia[nivel] + ' on-call shift · seed ' + semilla),
    cuerpo: [T('Te ha saltado la guardia. No hay ticket: sólo lo que dicen las alarmas.', 'You have been paged. There is no ticket: only what the alarms say.')],
    inicio: -hace, abierto: -Math.min(10, hace),
    aplicar: st => elegidas.forEach(x => x.f.aplicar(st, x.p, -hace)),
    objetivo: st => [].concat(...elegidas.map(x => x.f.pendientes(st, x.p))),
    practicas: [
      { t: T('Miraste las alarmas antes de tocar nada', 'You looked at the alarms before touching anything'), ok: st => { const i = st.registro.findIndex(r => /describe-alarms/.test(r.cmd)), j = st.registro.findIndex(r => MUTA.test(r.cmd)); return i >= 0 && (j < 0 || i < j); } },
      { t: T('Comprobaste las alarmas al terminar', 'You checked the alarms when you finished'), ok: st => { let j = -1; st.registro.forEach((r, k) => { if (MUTA.test(r.cmd)) j = k; }); return st.registro.some((r, k) => k > j && /describe-alarms/.test(r.cmd)); } },
      { t: T('No apagaste ni reiniciaste instancias para «ver si se arreglaba»', 'You did not stop or reboot instances to "see if it fixed itself"'), ok: st => !usado(st, /(stop|reboot)-instances|sudo reboot/) },
    ],
    pistas: [
      T('Empieza por las alarmas: aws cloudwatch describe-alarms --state-value ALARM. Cada una dice dónde mirar.', 'Start with the alarms: aws cloudwatch describe-alarms --state-value ALARM. Each one tells you where to look.'),
      T('Esta noche hay ' + elegidas.length + ' cosa' + (elegidas.length > 1 ? 's' : '') + ' rota' + (elegidas.length > 1 ? 's' : '') + ': ' + elegidas.map(x => x.f.titulo.toLowerCase()).join('; ') + '.', 'Tonight ' + elegidas.length + ' thing' + (elegidas.length > 1 ? 's are' : ' is') + ' broken: ' + elegidas.map(x => x.f.titulo.toLowerCase()).join('; ') + '.'),
      T('Por dónde va el arreglo: ' + elegidas.map(x => x.f.leccion).join('; ') + '.', 'Where the fix lies: ' + elegidas.map(x => x.f.leccion).join('; ') + '.'),
    ],
    causa: T('Pasaban ' + (elegidas.length === 1 ? 'una cosa' : elegidas.length + ' cosas a la vez') + ': ', elegidas.length === 1 ? 'One thing was going on: ' : elegidas.length + ' things were going on at once: ') + elegidas.map(x => x.f.titulo.toLowerCase()).join('; ') + '.',
    solucion: elegidas.map(x => x.f.leccion.charAt(0).toUpperCase() + x.f.leccion.slice(1) + '.').join(' '),
    leccion: elegidas.map(x => x.f.leccion.charAt(0).toUpperCase() + x.f.leccion.slice(1) + '.').join(' '),
    guion: st => ['aws cloudwatch describe-alarms --state-value ALARM'].concat(...elegidas.map(x => x.f.arreglo(st, x.p)), ['aws cloudwatch describe-alarms --state-value ALARM']),
    trampas: [],
    guardia: { nivel, semilla, familias: elegidas.map(x => x.f.id) },
  };
  return P.normalizarEscenario(e);
}
// Una guardia sólo sale si su propio arreglo la cierra; si no, se prueba otra combinación.
P.generarGuardia = (nivel, semilla) => {
  for (let k = 0; k < 8; k++) {
    const e = guardiaDe(nivel, semilla, k), st = P.preparar(e);
    if (!e.resuelto(st, P).length) continue;
    const ses = P.nuevaSesion();
    P.guionDe(e, st).forEach(c => { P.ejecutar(st, ses, c); P.expulsar(st, ses); });
    if (!e.resuelto(st, P).length) return { ok: true, escenario: e, intentos: k + 1 };
  }
  return { ok: false };
};

// ------------------------------------------------------------------ caos
P.provocarCaos = (st, semilla, previas) => {
  const rnd = P.azar(semilla), tocadas = [].concat(...(previas || []).map(a => a.toca || []));
  const pool = P.familias.filter(f => f.nivel <= 2);
  for (let k = 0; k < 20; k++) {
    const f = uno(rnd, pool), p = f.params(rnd), t = f.toca(p);
    if (choca(t, tocadas) || f.pendientes(st, p).length) continue;
    const cuando = st.reloj + 2 + Math.floor(rnd() * 4);
    (st.programados = st.programados || []).push({ min: cuando, fn: s => f.aplicar(s, p, cuando) });
    return { familia: f, averias: [Object.assign({ tipo: f.id, toca: t }, p.web ? { nodo: p.web } : {})], cuando, params: p };
  }
  return null;
};
P.pendientesCaos = (st, provocadas) => [].concat(...provocadas.filter(c => c.cuando <= st.reloj).map(c => c.familia.pendientes(st, c.params)));
})(window.PUESTO = window.PUESTO || {});
