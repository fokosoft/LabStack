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
    const e = i.estado !== 'running' ? (i.estado === 'stopped' ? 'caido' : 'reserva') : !hs.up ? 'aviso' : P.estadoHost(st, hs);
    const a = alertas.find(x => x.host === i.nombre);
    const nota = i.estado !== 'running' ? i.estado : !hs.up ? T('reiniciando…', 'rebooting…') : a ? a.res : i.tipo + ' · ' + s.az.slice(-2) + ' · ' + (i.ipPub || i.ipPriv);
    const nombre = i.nombre || i.id.slice(0, 10) + '…';
    return enConfig(i.nombre) && i.estado === 'running'
      ? `<button class="host e-${e}" data-act="ssh" data-host="${h(i.nombre)}" title="${T('Abrir una sesión en ', 'Open a session on ') + h(nombre)}"><i class="punto"></i><b>${h(nombre)}</b><span>${h(nota)}</span></button>`
      : `<div class="host e-${e}" title="${h(i.id)}"><i class="punto"></i><b>${h(nombre)}</b><span>${h(nota)}</span></div>`;
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
  return `<section class="panel"><h3>EBS <span class="der-n">${T('uso del sistema de ficheros', 'filesystem usage')}</span></h3>${grupos}${mods.length ? '<div class="flags">' + mods.map(x => '<span class="flag">' + h(x) + '</span>').join('') + '</div>' : ''}</section>`;
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
  oferta: {
    tag: T('📌 Puesto', '📌 Job opening'),
    titulo: T('Ingeniero/a de Sistemas Cloud (AWS)', 'Cloud Systems Engineer (AWS)'),
    sub: T('Comercio electrónico · remoto · contrato indefinido', 'E-commerce · remote · permanent, full-time'),
    txt: T('Administración de la infraestructura de una tienda online en AWS: instancias EC2 y almacenamiento EBS, redes y seguridad en la VPC, monitorización con CloudWatch y resolución de incidencias. Cada función del puesto tiene sus tickets:', 'Run an online store\'s infrastructure on AWS: EC2 instances and EBS storage, VPC networking and security, CloudWatch monitoring and incident resolution. Each duty of the role has its own tickets:'),
  },
  como: [
    T('<b>Una cuenta de AWS simulada</b>: una VPC con subredes públicas y privadas, 5 instancias, security groups, volúmenes EBS, un NAT gateway y alarmas de CloudWatch.', '<b>A simulated AWS account</b>: a VPC with public and private subnets, 5 instances, security groups, EBS volumes, a NAT gateway and CloudWatch alarms.'),
    T('<b>Arreglas con comandos reales</b>: aws ec2…, aws cloudwatch…, ssh, systemctl, df, curl… La red se comporta como la de AWS: un security group no rechaza, descarta.', '<b>You fix things with real commands</b>: aws ec2…, aws cloudwatch…, ssh, systemctl, df, curl… The network behaves like AWS: a security group does not reject, it drops.'),
    T('<b>Se comprueba el estado</b>, no el camino. Luego se valora cómo llegaste: las buenas prácticas del oficio.', '<b>The end state is checked</b>, not the path. Then how you got there is scored: the good practices of the trade.'),
  ],
  guardia: false, importar: false, caos: false,
  bienvenida: modo => modo === 'libre'
    ? [T('Laboratorio libre: la cuenta está sana y no hay ticket.', 'Free lab: the account is healthy and there is no ticket.'), T('Estás en tu equipo, con la CLI de AWS configurada. Empieza por cat ~/LEEME.md', 'You are on your workstation, with the AWS CLI configured. Start with cat ~/LEEME.md')]
    : [T('Estás en tu equipo (ops), con la CLI de AWS ya configurada para la cuenta de producción.', 'You are on your workstation (ops), with the AWS CLI already configured for the production account.'), T('Para orientarte: cat ~/LEEME.md · aws ec2 describe-instances --output table · aws cloudwatch describe-alarms --state-value ALARM', 'To get your bearings: cat ~/LEEME.md · aws ec2 describe-instances --output table · aws cloudwatch describe-alarms --state-value ALARM')],
  sesionNueva: T('Nueva sesión en tu equipo', 'New session on your workstation'),
  alertas: T('Alarmas (CloudWatch)', 'Alarms (CloudWatch)'),
  paneles: ctx => panelInstancias(ctx) + panelEbs(ctx) + panelRutas(ctx),
  experimentos: [
    ['aws ec2 describe-instances --output table', T('Mira la cuenta: qué instancias hay, en qué zona y con qué IP.', 'Look at the account: which instances there are, in which zone and with which IP.')],
    ['aws ec2 describe-security-groups --group-ids ' + ID.sg.web, T('Lee las reglas de un security group: quién puede hablar con los frontales.', 'Read a security group\'s rules: who may talk to the web servers.')],
    ['aws ec2 stop-instances --instance-ids ' + ID.inst['web-01'], T('Para un frontal y mira qué alarma salta, y qué IP pública tiene al volver a arrancarlo.', 'Stop a web server and see which alarm fires, and what public IP it gets when you start it again.')],
    ['ssh -i ~/.ssh/tienda-prod.pem ubuntu@10.0.11.30', T('Intenta entrar directamente en una IP privada. Después prueba con -J bastion.', 'Try to log straight into a private IP. Then try with -J bastion.')],
    ['aws ec2 describe-route-tables --query "RouteTables[].[Tags[0].Value,Routes[?DestinationCidrBlock==\'0.0.0.0/0\']|[0].[NatGatewayId,GatewayId,State]]" --output text', T('Por dónde sale cada subred a internet.', 'How each subnet reaches the internet.')],
    ['cat ~/LEEME.md', T('Las normas de la casa.', 'The house rules.')],
  ],
};
})(window.PUESTO = window.PUESTO || {});
