// Puesto Cloud · lo que cambia en la interfaz del Puesto (../puesto-linux/app.js).
//
// La interfaz es la misma: cola, terminal, ticket, ITSM, pistas, cierre e
// informe. Aquí sólo se declara lo propio de la nube: la oferta, la bienvenida,
// los paneles de la izquierda (EC2, EBS, rutas) y los experimentos. Se carga
// antes que app.js.
(function (P) {
'use strict';
const T = P.T, U = P.u, N = P.nube, ID = N.ID;

function panelInstancias({ st, h, alertas }) {
  const is = st.aws.instancias.filter(i => i.estado !== 'terminated');
  const enConfig = n => n === 'bastion' || ['web-01', 'web-02', 'app-01', 'db-01'].indexOf(n) >= 0;
  const fila = i => {
    const hs = st.hosts[i.host], s = N.subred(st, i.subred);
    const e = i.estado !== 'running' ? (i.estado === 'stopped' ? 'caido' : 'reserva') : !hs ? 'ok' : !hs.up ? 'aviso' : P.estadoHost(st, hs);
    const a = alertas.find(x => x.host === i.nombre);
    const nota = i.estado !== 'running' ? i.estado : hs && !hs.up ? T('reiniciando…', 'rebooting…') : a ? a.res : i.tipo + ' · ' + s.az.slice(-2) + ' · ' + (i.ipPub || i.ipPriv);
    const nombre = i.nombre || i.id.slice(0, 10) + '…';
    return enConfig(i.nombre) && i.estado === 'running'
      ? `<button class="host${nombre.length > 7 ? ' ancho' : ''} e-${e}" data-act="ssh" data-host="${h(i.nombre)}" title="${T('Abrir una sesión en ', 'Open a session on ') + h(nombre)}"><i class="punto"></i><b>${h(nombre)}</b><span>${h(nota)}</span></button>`
      : `<div class="host${nombre.length > 7 ? ' ancho' : ''} e-${e}" title="${h(i.id)}"><i class="punto"></i><b>${h(nombre)}</b><span>${h(nota)}</span></div>`;
  };
  const pub = is.filter(i => N.subred(st, i.subred).publica), priv = is.filter(i => !N.subred(st, i.subred).publica);
  const corriendo = is.filter(i => i.estado === 'running').length;
  return `<section class="panel"><h3>EC2 <span class="der-n">${corriendo}/${is.length} running</span></h3>
    <div class="grupo"><p class="grupo-t">${T('Subredes públicas', 'Public subnets')}</p>${pub.map(fila).join('')}</div>
    <div class="grupo"><p class="grupo-t">${T('Subredes privadas', 'Private subnets')}</p>${priv.map(fila).join('')}</div></section>`;
}
function panelEbs({ st, h }) {
  const grupos = st.aws.instancias.filter(i => i.estado !== 'terminated' && st.hosts[i.host]).map(i => {
    const hs = st.hosts[i.host];
    const vs = N.volsDe(st, i).map(v => {
      const d = hs.discos[v.montaje], p = d ? U.pctDisco(hs, v.montaje) : 0, m = v.mods.find(x => x.estado !== 'completed');
      const clase = p >= 90 ? 'caido' : p >= 80 ? 'lleno' : '';
      return `<div class="osd ${clase}" title="${h(v.id)} · ${v.tam} GiB gp3${m ? ' · ' + m.estado : ''}"><b>${v.raiz ? '/' : T('datos', 'data')}</b><span class="osd-bar"><i style="width:${p}%"></i></span><em>${p} %</em></div>`;
    }).join('');
    return `<div class="osd-host"><p class="grupo-t">${h(i.nombre || i.id)}</p>${vs}</div>`;
  }).join('');
  const mods = [].concat(...st.aws.volumenes.map(v => v.mods.filter(m => m.estado !== 'completed').map(m => v.id.slice(0, 12) + '… → ' + m.objetivo + ' GiB · ' + m.estado)));
  const rds = st.aws.rds.instancias.filter(x => x.estado !== 'deleted').map(x => { const pc = Math.min(100, Math.round(x.usadoG / x.almacen * 100)); return `<div class="osd ${x.estado === 'storage-full' ? 'caido' : pc >= 80 ? 'lleno' : ''}" title="${h(x.estado)} · ${x.almacen} GiB"><b>${h(x.id.replace('tienda-', ''))}</b><span class="osd-bar"><i style="width:${pc}%"></i></span><em>${x.estado === 'available' ? pc + ' %' : h(x.estado.replace('storage-optimization', 'optimizing'))}</em></div>`; }).join('');
  return `<section class="panel"><h3>${T('Almacenamiento', 'Storage')} <span class="der-n">${T('uso', 'usage')}</span></h3><p class="grupo-t">RDS</p>${rds}${grupos}${mods.length ? '<div class="flags">' + mods.map(x => '<span class="flag">' + h(x) + '</span>').join('') + '</div>' : ''}</section>`;
}
function panelAlb({ st, h }) {
  const tg = N.tg(st), sanos = N.sanos(st).length;
  const filas = tg.targets.map(t => {
    const i = st.aws.instancias.find(x => x.id === t.id), s = N.salud(st, tg, t);
    const e = s.estado === 'healthy' ? 'ok' : s.estado === 'initial' ? 'aviso' : s.estado === 'unused' ? 'reserva' : 'fallo';
    return `<div class="host e-${e}" title="${h(s.desc || '')}"><i class="punto"></i><b>${h(i ? i.nombre || i.id.slice(0, 10) : t.id)}</b><span>${h(s.estado)}${s.razon ? ' · ' + h(s.razon.replace(/^(Target|Elb)\./, '')) : ''}</span></div>`;
  }).join('');
  const g = N.asg(st), w = st.aws.instancias.filter(i => i.asg && i.estado === 'running').length, falla = st.aws.asg.actividades[0] && !st.aws.asg.actividades[0].ok && w < g.deseado;
  const asg = `<p class="grupo-t">Auto Scaling · tienda-workers</p><div class="host e-${w >= g.min ? 'ok' : w ? 'aviso' : 'fallo'}"><i class="punto"></i><b>workers</b><span>${w}/${g.deseado} InService${falla ? ' · ' + T('no puede lanzar', 'cannot launch') : ''}</span></div>`;
  return `<section class="panel"><h3>${T('Balanceo y escalado', 'Load balancing and scaling')} <span class="der-n">${sanos}/${tg.targets.length} healthy</span></h3><p class="grupo-t">ALB · tienda-web-tg · GET ${h(tg.hc.path)}</p>${filas}${asg}</section>`;
}
function panelS3({ st, h }) {
  return `<section class="panel"><h3>S3</h3>${st.aws.s3.buckets.map(b => {
    const pub = N.s3Publico(b);
    const nota = (pub ? T('PÚBLICO', 'PUBLIC') : T('privado', 'private')) + (b.versionado === 'Enabled' ? ' · ' + T('versionado', 'versioned') : '') + ' · ' + Object.keys(b.objetos).filter(k => N.objetoActual(b, k)).length + T(' objetos', ' objects');
    return `<div class="host ancho e-${pub ? 'fallo' : 'ok'}"><i class="punto"></i><b>${h(b.nombre.replace(/^tienda-/, ''))}</b><span>${h(nota)}</span></div>`;
  }).join('')}</section>`;
}
function panelCoste({ st, h }) {
  const g = N.gastado(st), pr = N.prevision(st), dia = N.ritmo(st) * 24, base = N.ritmoBase(st) * 24, top = Math.max(pr, N.PRESUPUESTO) * 1.05;
  const fila = (txt, v, cls) => `<div class="osd ${cls}"><b>${txt}</b><span class="osd-bar"><i style="width:${Math.min(100, v / top * 100)}%"></i></span><em>${Math.round(v)} $</em></div>`;
  return `<section class="panel"><h3>${T('Coste del mes', 'Monthly cost')} <span class="der-n">${T('presupuesto', 'budget')} ${N.PRESUPUESTO} $</span></h3>${fila(T('gasto', 'spent'), g, '')}${fila(T('prev.', 'fcst'), pr, pr > N.PRESUPUESTO ? 'caido' : pr > N.PRESUPUESTO * 0.8 ? 'lleno' : '')}<p class="grupo-t" style="margin-top:6px">${T('ritmo', 'rate')} ${Math.round(dia)} $/${T('día', 'day')} · ${T('normal', 'usual')} ${Math.round(base)} $/${T('día', 'day')}</p></section>`;
}
function panelRutas({ st, h }) {
  return `<section class="panel"><h3>${T('Rutas a internet', 'Routes to the internet')}</h3>${st.aws.rts.map(t => {
    const r = t.rutas.find(x => x.dest === '0.0.0.0/0'), ok = r && N.rutaActiva(st, r);
    const destino = !r ? T('sin ruta', 'no route') : r.gw === ID.igw ? 'internet gateway' : r.nat ? 'NAT ' + r.nat.slice(0, 12) + '…' : r.gw;
    return `<div class="host e-${ok ? 'ok' : 'fallo'}"><i class="punto"></i><b>${h(t.nombre.replace('tienda-', ''))}</b><span>0.0.0.0/0 → ${h(destino)}${ok ? '' : ' · blackhole'}</span></div>`;
  }).join('')}</section>`;
}

P.ui = {
  clave: 'puesto-cloud-v1',
  claveImp: P.compositorCfg.claveImp,
  oferta: {
    tag: T('📌 Puesto', '📌 Job opening'),
    titulo: T('Ingeniero/a de Sistemas Cloud (AWS)', 'Cloud Systems Engineer (AWS)'),
    sub: T('Comercio electrónico · remoto · contrato indefinido', 'E-commerce · remote · permanent, full-time'),
    txt: T('Administración de la infraestructura de una tienda online en AWS: instancias EC2, almacenamiento, balanceo y Auto Scaling, bases de datos RDS, redes y seguridad en la VPC, identidades y permisos con IAM, S3, coste, Terraform, y monitorización con CloudWatch y resolución de incidencias. Cada función del puesto tiene sus tickets:', 'Run an online store\'s infrastructure on AWS: EC2 instances, storage, load balancing and Auto Scaling, RDS databases, VPC networking and security, identities and permissions with IAM, S3, cost, Terraform, and CloudWatch monitoring and incident resolution. Each duty of the role has its own tickets:'),
  },
  como: [
    T('<b>Una cuenta de AWS simulada</b>: una VPC con subredes públicas y privadas, frontales detrás de un balanceador, workers en Auto Scaling, una base de pedidos en RDS, security groups, volúmenes EBS, un NAT gateway, usuarios y roles de IAM, buckets de S3, una factura y alarmas de CloudWatch.', '<b>A simulated AWS account</b>: a VPC with public and private subnets, web servers behind a load balancer, workers in Auto Scaling, an RDS orders database, security groups, EBS volumes, a NAT gateway, IAM users and roles, S3 buckets, a bill and CloudWatch alarms.'),
    T('<b>Arreglas con comandos reales</b>: aws ec2…, aws cloudwatch…, ssh, systemctl, df, curl… La red se comporta como la de AWS: un security group no rechaza, descarta.', '<b>You fix things with real commands</b>: aws ec2…, aws cloudwatch…, ssh, systemctl, df, curl… The network behaves like AWS: a security group does not reject, it drops.'),
    T('<b>Se comprueba el estado</b>, no el camino. Luego se valora cómo llegaste: las buenas prácticas del oficio.', '<b>The end state is checked</b>, not the path. Then how you got there is scored: the good practices of the trade.'),
  ],
  guardia: true, importar: true, caos: true,
  bienvenida: modo => modo === 'libre'
    ? [T('Laboratorio libre: la cuenta está sana y no hay ticket.', 'Free lab: the account is healthy and there is no ticket.'), T('Estás en tu equipo, con la CLI de AWS configurada. Empieza por cat ~/LEEME.md', 'You are on your workstation, with the AWS CLI configured. Start with cat ~/LEEME.md')]
    : [T('Estás en tu equipo (ops), con la CLI de AWS ya configurada para la cuenta de producción.', 'You are on your workstation (ops), with the AWS CLI already configured for the production account.'), T('Para orientarte: cat ~/LEEME.md · aws ec2 describe-instances --output table · aws cloudwatch describe-alarms --state-value ALARM', 'To get your bearings: cat ~/LEEME.md · aws ec2 describe-instances --output table · aws cloudwatch describe-alarms --state-value ALARM')],
  sesionNueva: T('Nueva sesión en tu equipo', 'New session on your workstation'),
  alertas: T('Alarmas (CloudWatch)', 'Alarms (CloudWatch)'),
  paneles: ctx => panelInstancias(ctx) + panelAlb(ctx) + panelEbs(ctx) + panelS3(ctx) + panelRutas(ctx) + panelCoste(ctx),
  experimentos: [
    ['aws ec2 describe-instances --output table', T('Mira la cuenta: qué instancias hay, en qué zona y con qué IP.', 'Look at the account: which instances there are, in which zone and with which IP.')],
    ['aws ec2 describe-security-groups --group-ids ' + ID.sg.web, T('Lee las reglas de un security group: quién puede hablar con los frontales.', 'Read a security group\'s rules: who may talk to the web servers.')],
    ['aws ec2 stop-instances --instance-ids ' + ID.inst['web-01'], T('Para un frontal y mira qué alarma salta, y qué IP pública tiene al volver a arrancarlo.', 'Stop a web server and see which alarm fires, and what public IP it gets when you start it again.')],
    ['ssh -i ~/.ssh/tienda-prod.pem ubuntu@10.0.11.30', T('Intenta entrar directamente en una IP privada. Después prueba con -J bastion.', 'Try to log straight into a private IP. Then try with -J bastion.')],
    ['aws ec2 describe-route-tables --query "RouteTables[].[Tags[0].Value,Routes[?DestinationCidrBlock==\'0.0.0.0/0\']|[0].[NatGatewayId,GatewayId,State]]" --output text', T('Por dónde sale cada subred a internet.', 'How each subnet reaches the internet.')],
    ['ssh app-01', T('Entra en app-01 y prueba aws sts get-caller-identity: la instancia habla con AWS con su rol, sin claves.', 'Log into app-01 and try aws sts get-caller-identity: the instance talks to AWS with its role, no keys.')],
    ['aws elbv2 describe-target-health --target-group-arn ' + ID.tg, T('Cómo ve el balanceador a cada frontal. Para nginx en uno y vuelve a mirar.', 'How the load balancer sees each web server. Stop nginx on one and look again.')],
    ['aws s3 ls', T('Los buckets de la cuenta. Prueba a leer uno desde fuera con curl: https://BUCKET.s3.eu-west-1.amazonaws.com/FICHERO', 'The account\'s buckets. Try reading one from outside with curl: https://BUCKET.s3.eu-west-1.amazonaws.com/FILE')],
    ['aws autoscaling describe-scaling-activities --auto-scaling-group-name tienda-workers --max-items 3', T('El historial del grupo de workers. Termina un worker y mira cómo lo repone.', 'The workers group\'s history. Terminate a worker and watch it replace it.')],
    ['aws ce get-cost-and-usage --time-period Start=2026-09-01,End=2026-09-24 --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE', T('En qué se va el dinero este mes.', 'Where the money goes this month.')],
    ['cd ~/infra', T('El código de Terraform. Cambia a mano una regla de tienda-web y luego prueba terraform plan.', 'The Terraform code. Change a tienda-web rule by hand and then try terraform plan.')],
    ['cat ~/LEEME.md', T('Las normas de la casa.', 'The house rules.')],
  ],
};
})(window.PUESTO = window.PUESTO || {});
