// Puesto Cloud · los tickets.
//
// Mismo contrato que el Puesto Linux, para que la interfaz y las pruebas sean
// las mismas: aplicar(st) rompe, resuelto(st) dice lo que falta (comprueba el
// ESTADO, nunca qué comandos se escribieron), practicas se juzgan con el
// registro, guion es una solución de referencia y trampas son arreglos a medias
// que no deben cerrarlo. Y además, en esta app: ninguna alarma de CloudWatch
// puede quedar en ALARM.
(function (P) {
'use strict';
const U = P.u, T = P.T, N = P.nube, ID = N.ID;

const idx = (st, re, desde) => { for (let i = desde || 0; i < st.registro.length; i++) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const ultimo = (st, re) => { for (let i = st.registro.length - 1; i >= 0; i--) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const usado = (st, re) => idx(st, re) >= 0;
const antes = (st, a, b) => { const i = idx(st, a), j = idx(st, b); return i >= 0 && (j < 0 || i < j); };
const despues = (st, a, b) => { const j = ultimo(st, b); return j >= 0 && idx(st, a, j + 1) >= 0; };
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
P.ayudasEscenario = { usado, antes, despues, idx, ultimo };

const MATRIZ = { 'alto|alta': 'P1', 'alto|media': 'P2', 'medio|alta': 'P2', 'alto|baja': 'P3', 'medio|media': 'P3', 'bajo|alta': 'P3', 'medio|baja': 'P4', 'bajo|media': 'P4', 'bajo|baja': 'P4' };
const SLA = { P1: 60, P2: 240, P3: 480, P4: 1440 };
P.prioridad = e => { const p = MATRIZ[e.impacto + '|' + e.urgencia]; return { p, sla: SLA[p] }; };

P.funciones = [
  { id: 'ec2', titulo: T('Administración de instancias EC2 y almacenamiento EBS', 'EC2 instance and EBS storage administration'), corto: 'EC2 · EBS' },
  { id: 'red', titulo: T('Redes y seguridad en la VPC', 'VPC networking and security'), corto: 'VPC' },
  { id: 'incid', titulo: T('Monitorización con CloudWatch y resolución de incidencias', 'CloudWatch monitoring and incident resolution'), corto: T('Incidencias', 'Incidents') },
  { id: 'iac', titulo: T('Automatización e infraestructura como código', 'Automation and infrastructure as code'), corto: 'IaC' },
];

const I = ID.inst, SG = ID.sg;
const NUEVA_IP = '198.51.100.24';
const alarmas = st => N.alarmas(st).filter(a => a.estado === 'ALARM').map(a => T('La alarma ' + a.nombre + ' sigue en ALARM', 'Alarm ' + a.nombre + ' is still in ALARM'));

P.escenarios = [
// ============================================================================ 1
{
  id: 'INC-7101', clave: 'ssh-oficina', tipo: 'incidente', nivel: 1, area: 'VPC · Security groups', funciones: ['red', 'incid'],
  impacto: 'medio', urgencia: 'media', de: T('Equipo de desarrollo (Lucía Pardo)', 'Development team (Lucía Pardo)'),
  asunto: T('No podemos entrar por SSH al bastión desde la oficina', 'We cannot SSH into the bastion from the office'),
  cuerpo: [T('Desde esta mañana, ssh bastion se queda colgado un buen rato y acaba en «Connection timed out». Ayer funcionaba perfectamente.', 'Since this morning, ssh bastion hangs for a long while and ends in "Connection timed out". It worked perfectly yesterday.'),
    T('Esta mañana han cambiado el router de la oficina; no sé si tiene algo que ver.', 'The office router was replaced this morning; not sure whether that has anything to do with it.')],
  inicio: -45, abierto: -20,
  aplicar(st) { st.aws.miIp = NUEVA_IP; },
  objetivo(st) {
    const b = N.inst(st, I.bastion);
    return N.permite(st, b, 22, { ip: st.aws.miIp }) ? [] : [T('Desde la oficina (' + st.aws.miIp + ') sigue sin llegarse al puerto 22 del bastión', 'The bastion\'s port 22 is still unreachable from the office (' + st.aws.miIp + ')')];
  },
  practicas: [
    { t: T('Averiguaste tu IP pública antes de tocar el security group', 'You found out your public IP before touching the security group'), ok: st => antes(st, /curl .*(checkip|ifconfig\.me|ipify)/, /authorize-security-group-ingress/) },
    { t: T('Abriste sólo la IP de la oficina, con /32', 'You opened only the office IP, as a /32'), ok: st => N.sg(st, SG.bastion).reglas.some(r => r.cidr === NUEVA_IP + '/32') },
    { t: T('Quitaste la regla de la IP antigua: esa IP ya no es vuestra', 'You removed the old IP\'s rule: that address is no longer yours'), ok: st => !N.sg(st, SG.bastion).reglas.some(r => r.cidr === N.OFICINA + '/32') },
    { t: T('Comprobaste con ssh que entras después del cambio', 'You checked with ssh that you get in after the change'), ok: st => despues(st, /^ssh( .*)? (ubuntu@)?(bastion|34\.248\.51\.17)\b/, /authorize-security-group-ingress/) },
  ],
  pistas: [
    T('Un «Connection timed out» (y no un «Permission denied» o un «Connection refused») significa que el paquete no llega: algo lo filtra por el camino. ¿Qué deja entrar el security group del bastión? aws ec2 describe-security-groups --group-ids ' + SG.bastion, 'A "Connection timed out" (rather than "Permission denied" or "Connection refused") means the packet never arrives: something filters it on the way. What does the bastion\'s security group let in? aws ec2 describe-security-groups --group-ids ' + SG.bastion),
    T('Compara la IP permitida con la tuya de ahora: curl -s https://checkip.amazonaws.com. Si han cambiado el router, puede haber cambiado la IP pública de la oficina.', 'Compare the allowed IP with your current one: curl -s https://checkip.amazonaws.com. If the router was replaced, the office public IP may have changed.'),
    T('aws ec2 revoke-security-group-ingress --group-id ' + SG.bastion + ' --protocol tcp --port 22 --cidr 203.0.113.10/32, y aws ec2 authorize-security-group-ingress con tu IP y /32. Después, ssh bastion.', 'aws ec2 revoke-security-group-ingress --group-id ' + SG.bastion + ' --protocol tcp --port 22 --cidr 203.0.113.10/32, then aws ec2 authorize-security-group-ingress with your IP and /32. Then ssh bastion.'),
  ],
  causa: T('El cambio de router dio a la oficina una IP pública nueva (198.51.100.24). El security group del bastión sólo deja entrar al 22 desde la antigua (203.0.113.10/32), así que AWS descarta los paquetes en silencio y ssh espera hasta el timeout.', 'The router change gave the office a new public IP (198.51.100.24). The bastion\'s security group only lets the old one (203.0.113.10/32) into port 22, so AWS silently drops the packets and ssh waits until it times out.'),
  solucion: T('Regla de la IP antigua revocada y regla nueva para 198.51.100.24/32 en tienda-bastion; comprobado con ssh bastion.', 'Old IP rule revoked and a new rule for 198.51.100.24/32 added to tienda-bastion; checked with ssh bastion.'),
  leccion: T('Un security group no rechaza: descarta. Por eso un puerto filtrado da «Connection timed out» y no «Connection refused», y esa diferencia te dice dónde mirar. La tentación es abrir el 22 a 0.0.0.0/0 «un momento»: así empiezan muchos incidentes de seguridad. Se abre lo justo (/32) y se quita lo que ya no es tuyo.', 'A security group does not reject: it drops. That is why a filtered port gives "Connection timed out" rather than "Connection refused", and that difference tells you where to look. The temptation is to open port 22 to 0.0.0.0/0 "just for a moment": that is how many security incidents start. Open just what is needed (/32) and remove what is no longer yours.'),
  guion: ['ssh bastion', 'aws ec2 describe-security-groups --group-ids ' + SG.bastion + ' --query "SecurityGroups[].IpPermissions[]"', 'curl -s https://checkip.amazonaws.com',
    'aws ec2 revoke-security-group-ingress --group-id ' + SG.bastion + ' --protocol tcp --port 22 --cidr 203.0.113.10/32',
    'aws ec2 authorize-security-group-ingress --group-id ' + SG.bastion + ' --protocol tcp --port 22 --cidr ' + NUEVA_IP + '/32', 'ssh bastion', 'exit'],
  trampas: [
    { cmds: ['aws ec2 authorize-security-group-ingress --group-id ' + SG.bastion + ' --protocol tcp --port 22 --cidr 0.0.0.0/0', 'ssh bastion', 'exit'], porque: T('abrir el 22 a todo internet te deja entrar, pero dispara la alarma de seguridad', 'opening port 22 to the whole internet gets you in, but fires the security alarm') },
    { cmds: ['aws ec2 authorize-security-group-ingress --group-id ' + SG.bastion + ' --protocol tcp --port 22 --cidr ' + NUEVA_IP], porque: T('sin /32 no es un CIDR válido: AWS lo rechaza', 'without /32 it is not a valid CIDR: AWS rejects it') },
  ],
},
// ============================================================================ 2
{
  id: 'INC-7104', clave: 'web-parada', tipo: 'incidente', nivel: 1, area: 'EC2', funciones: ['ec2', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Monitorización (CloudWatch)', 'Monitoring (CloudWatch)'),
  asunto: T('tienda-web-healthy-hosts en ALARM: sólo un frontal sirve la web', 'tienda-web-healthy-hosts in ALARM: only one web server is serving the site'),
  cuerpo: [T('La alarma tienda-web-healthy-hosts lleva desde anoche en ALARM. La web funciona, pero con un solo frontal: si web-01 cae, la tienda se queda sin web.', 'The tienda-web-healthy-hosts alarm has been in ALARM since last night. The site works, but on a single web server: if web-01 goes down, the store has no website.'),
    T('Ayer por la tarde se hicieron pruebas de carga en web-02.', 'Load tests were run on web-02 yesterday afternoon.')],
  inicio: -1110, abierto: -15,
  aplicar(st) {
    const i = N.inst(st, I['web-02']), h = st.hosts[i.host];
    P.parado(st, h, 'nginx', -1125, true);
    N.parar(st, i, -1110);
  },
  objetivo(st) {
    const i = N.inst(st, I['web-02']), h = st.hosts[i.host], out = [];
    if (i.estado !== 'running') out.push(T('web-02 está ' + i.estado, 'web-02 is ' + i.estado));
    else if (h && h.svcs.nginx.estado !== 'active') out.push(T('nginx no está corriendo en web-02', 'nginx is not running on web-02'));
    if (h && !h.svcs.nginx.enabled) out.push(T('nginx de web-02 no está habilitado: volverá a caer en el próximo reinicio', 'nginx on web-02 is not enabled: it will go down again on the next reboot'));
    return out;
  },
  practicas: [
    { t: T('Miraste el estado y el motivo de la parada antes de arrancarla', 'You checked the state and the stop reason before starting it'), ok: st => antes(st, /describe-instances/, /start-instances/) },
    { t: T('Esperaste a que estuviera running antes de entrar', 'You waited for it to be running before logging in'), ok: st => usado(st, /aws ec2 wait instance-(running|status-ok)|describe-instance-status/) },
    { t: T('Comprobaste desde fuera que web-02 sirve la web (curl a su IP pública)', 'You checked from outside that web-02 serves the site (curl to its public IP)'), ok: st => { const i = N.inst(st, I['web-02']); return !!(i && i.ipPub) && usado(st, new RegExp('curl .*' + esc(i.ipPub))); } },
    { t: T('Comprobaste que la alarma volvió a OK', 'You checked that the alarm went back to OK'), ok: st => despues(st, /describe-alarms/, /systemctl (enable|start)/) },
  ],
  pistas: [
    T('Empieza por las alarmas (aws cloudwatch describe-alarms --state-value ALARM) y por las instancias: aws ec2 describe-instances --output table. ¿Están todas running?', 'Start with the alarms (aws cloudwatch describe-alarms --state-value ALARM) and the instances: aws ec2 describe-instances --output table. Are they all running?'),
    T('StateTransitionReason dice quién y cuándo la paró. Arráncala con aws ec2 start-instances --instance-ids ' + I['web-02'] + ' y espera con aws ec2 wait instance-running --instance-ids ' + I['web-02'] + '.', 'StateTransitionReason says who stopped it and when. Start it with aws ec2 start-instances --instance-ids ' + I['web-02'] + ' and wait with aws ec2 wait instance-running --instance-ids ' + I['web-02'] + '.'),
    T('Si después sigue sin servir, entra (ssh web-02) y pregunta a systemd: systemctl status nginx. «disabled» significa que no arranca solo con la máquina: sudo systemctl enable --now nginx.', 'If it still does not serve afterwards, log in (ssh web-02) and ask systemd: systemctl status nginx. "disabled" means it does not start with the machine: sudo systemctl enable --now nginx.'),
  ],
  causa: T('web-02 se paró a mano ayer al terminar las pruebas de carga y nadie la volvió a arrancar. Además, en esas pruebas se reinstaló nginx y quedó deshabilitado: aunque la instancia arranque, nginx no lo hace solo.', 'web-02 was stopped by hand yesterday after the load tests and nobody started it again. On top of that, nginx was reinstalled during those tests and left disabled: even when the instance starts, nginx does not.'),
  solucion: T('web-02 arrancada, nginx habilitado y arrancado; tienda-web-healthy-hosts de nuevo en OK.', 'web-02 started, nginx enabled and started; tienda-web-healthy-hosts back to OK.'),
  leccion: T('Una instancia parada no gasta cómputo, pero tampoco sirve: la alarma de capacidad es la que te avisa antes de que caiga la otra. Y arrancar la instancia no basta si el servicio no está habilitado. Fíjate también en que su IP pública ha cambiado: sin una Elastic IP, cada parada te da una nueva.', 'A stopped instance costs no compute, but it does not serve either: the capacity alarm is what warns you before the other one goes down. And starting the instance is not enough if the service is not enabled. Notice too that its public IP has changed: without an Elastic IP, every stop gives you a new one.'),
  guion: ['aws cloudwatch describe-alarms --state-value ALARM --query "MetricAlarms[].[AlarmName,StateReason]" --output text',
    'aws ec2 describe-instances --filters "Name=tag:Name,Values=web-02" --query "Reservations[].Instances[].[InstanceId,State.Name,StateTransitionReason]" --output text',
    'aws ec2 start-instances --instance-ids ' + I['web-02'], 'aws ec2 wait instance-running --instance-ids ' + I['web-02'],
    'ssh web-02', 'systemctl status nginx', 'sudo systemctl enable --now nginx', 'exit',
    'curl -I http://34.245.112.83', 'aws cloudwatch describe-alarms --state-value ALARM'],
  trampas: [
    { cmds: ['aws ec2 start-instances --instance-ids ' + I['web-02'], 'aws ec2 wait instance-running --instance-ids ' + I['web-02']], porque: T('la instancia arranca, pero nginx no', 'the instance starts, but nginx does not') },
    { cmds: ['aws ec2 start-instances --instance-ids ' + I['web-02'], 'aws ec2 wait instance-running --instance-ids ' + I['web-02'], 'ssh web-02', 'sudo systemctl start nginx', 'exit'], porque: T('nginx arranca, pero sigue deshabilitado: en el próximo reinicio vuelve a caer', 'nginx starts, but stays disabled: it goes down again on the next reboot') },
  ],
},
// ============================================================================ 3
{
  id: 'INC-7108', clave: 'disco-db', tipo: 'incidente', nivel: 2, area: 'EC2 · EBS', funciones: ['ec2', 'incid'],
  impacto: 'alto', urgencia: 'media', de: T('Monitorización (CloudWatch)', 'Monitoring (CloudWatch)'),
  asunto: T('db-01-disk-data-high: el disco de PostgreSQL de db-01 al 93 %', 'db-01-disk-data-high: db-01\'s PostgreSQL disk at 93%'),
  cuerpo: [T('Salta la alarma db-01-disk-data-high: el volumen de datos de PostgreSQL está al 93 % y crece unos 2 GB al día con los pedidos.', 'The db-01-disk-data-high alarm has fired: the PostgreSQL data volume is at 93% and grows about 2 GB a day with orders.'),
    T('Si se llena, PostgreSQL se para y la tienda deja de vender. Hay que darle espacio hoy; los datos no se pueden borrar.', 'If it fills up, PostgreSQL stops and the store stops selling. It needs more room today; the data cannot be deleted.')],
  inicio: -180, abierto: -30,
  aplicar(st) { st.hosts['db-01'].discos['/var/lib/postgresql'].baseG = 91.3; },
  objetivo(st) {
    const h = st.hosts['db-01'], v = N.vol(st, ID.vol['db-01-datos']);
    if (!h) return [T('db-01 no existe', 'db-01 does not exist')];
    const p = U.pctDisco(h, '/var/lib/postgresql');
    if (p < 80) return [];
    return [v.visible > 100 && h.discos['/var/lib/postgresql'].tamG < v.visible * 0.9
      ? T('El volumen ya mide ' + v.visible + ' GiB, pero el sistema de ficheros sigue con el tamaño antiguo: /var/lib/postgresql al ' + p + ' % (df -h)', 'The volume is already ' + v.visible + ' GiB, but the filesystem still has the old size: /var/lib/postgresql at ' + p + '% (df -h)')
      : T('/var/lib/postgresql sigue al ' + p + ' %', '/var/lib/postgresql is still at ' + p + '%')];
  },
  practicas: [
    { t: T('Hiciste un snapshot del volumen antes de modificarlo', 'You took a snapshot of the volume before modifying it'), ok: st => antes(st, /create-snapshot/, /modify-volume/) },
    { t: T('Ampliaste con cabeza: entre 150 y 400 GiB', 'You resized sensibly: between 150 and 400 GiB'), ok: st => { const v = N.vol(st, ID.vol['db-01-datos']); return v.tam >= 150 && v.tam <= 400; } },
    { t: T('Comprobaste que el disco ya había crecido antes de ampliar el sistema de ficheros', 'You checked that the disk had grown before resizing the filesystem'), ok: st => { const m = idx(st, /modify-volume/), r = idx(st, /resize2fs/), k = idx(st, /describe-volumes-modifications|lsblk/, m + 1); return m >= 0 && r > m && k > m && k < r; } },
    { t: T('Comprobaste con df -h que el espacio llegó a PostgreSQL', 'You checked with df -h that the space reached PostgreSQL'), ok: st => despues(st, /^df\b/, /resize2fs/) },
  ],
  pistas: [
    T('Entra en db-01 (ssh db-01) y compara df -h con lsblk: df mide el sistema de ficheros, lsblk el disco. Desde tu equipo, aws ec2 describe-volumes --filters Name=attachment.instance-id,Values=' + I['db-01'] + ' te dice qué volumen es.', 'Log into db-01 (ssh db-01) and compare df -h with lsblk: df measures the filesystem, lsblk the disk. From your workstation, aws ec2 describe-volumes --filters Name=attachment.instance-id,Values=' + I['db-01'] + ' tells you which volume it is.'),
    T('Primero un snapshot (normas de la casa): aws ec2 create-snapshot --volume-id VOL --description "...". Luego aws ec2 modify-volume --volume-id VOL --size 200. Un volumen sólo se puede modificar una vez cada 6 horas: elige bien el tamaño.', 'First a snapshot (house rules): aws ec2 create-snapshot --volume-id VOL --description "...". Then aws ec2 modify-volume --volume-id VOL --size 200. A volume can only be modified once every 6 hours: choose the size carefully.'),
    T('Cuando aws ec2 describe-volumes-modifications diga optimizing, el disco ya es más grande, pero el sistema de ficheros no: en db-01, sudo resize2fs /dev/nvme1n1 (no tiene particiones). Comprueba con df -h.', 'When aws ec2 describe-volumes-modifications says optimizing, the disk is already bigger, but the filesystem is not: on db-01, sudo resize2fs /dev/nvme1n1 (it has no partitions). Check with df -h.'),
  ],
  causa: T('Crecimiento normal: el volumen de datos de PostgreSQL (100 GiB) se ha quedado pequeño con el ritmo de pedidos.', 'Normal growth: the PostgreSQL data volume (100 GiB) has become too small for the order volume.'),
  solucion: T('Snapshot de seguridad, volumen ampliado a 200 GiB con modify-volume y sistema de ficheros ampliado en caliente con resize2fs, sin parar PostgreSQL.', 'Safety snapshot, volume grown to 200 GiB with modify-volume and filesystem grown online with resize2fs, without stopping PostgreSQL.'),
  leccion: T('En EBS, ampliar un disco son dos pasos: el volumen (en AWS) y el sistema de ficheros (dentro de la máquina). Si sólo haces el primero, df no cambia y la alarma sigue. Se hace en caliente, sin parar la base de datos, pero el snapshot va antes: un modify-volume no se deshace, y no puedes repetirlo hasta dentro de 6 horas.', 'On EBS, growing a disk takes two steps: the volume (in AWS) and the filesystem (inside the machine). Do only the first and df does not change and the alarm stays. It is done online, without stopping the database, but the snapshot comes first: a modify-volume cannot be undone, and you cannot repeat it for 6 hours.'),
  guion: ['aws cloudwatch describe-alarms --state-value ALARM', 'ssh db-01', 'df -h', 'lsblk', 'exit',
    'aws ec2 describe-volumes --filters Name=attachment.instance-id,Values=' + I['db-01'] + ' --query "Volumes[].[VolumeId,Size,Attachments[0].Device]" --output table',
    'aws ec2 create-snapshot --volume-id ' + ID.vol['db-01-datos'] + ' --description "' + T('INC-7108 antes de ampliar', 'INC-7108 before resizing') + '"',
    'aws ec2 modify-volume --volume-id ' + ID.vol['db-01-datos'] + ' --size 200', 'aws ec2 describe-volumes-modifications --volume-ids ' + ID.vol['db-01-datos'],
    'ssh db-01', 'lsblk', 'sudo resize2fs /dev/nvme1n1', 'df -h', 'exit'],
  trampas: [
    { cmds: ['aws ec2 modify-volume --volume-id ' + ID.vol['db-01-datos'] + ' --size 200', 'sleep 120'], porque: T('el volumen crece, pero el sistema de ficheros no: df sigue al 93 %', 'the volume grows, but the filesystem does not: df is still at 93%') },
  ],
},
// ============================================================================ 4
{
  id: 'INC-7112', clave: 'nat-blackhole', tipo: 'incidente', nivel: 2, area: 'VPC · NAT', funciones: ['red', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Atención al cliente', 'Customer support'),
  asunto: T('Los pagos fallan: «Error al contactar con la pasarela»', 'Payments are failing: "Error contacting the payment gateway"'),
  cuerpo: [T('Desde hace una hora los clientes llenan el carrito pero el pago falla con «Error al contactar con la pasarela». La alarma tienda-api-payment-errors está en ALARM.', 'For the last hour customers can fill their carts but payment fails with "Error contacting the payment gateway". The tienda-api-payment-errors alarm is in ALARM.'),
    T('Anoche Redes sustituyó el NAT gateway por uno nuevo (el viejo estaba en una sola zona). Dicen que lo dejaron todo listo.', 'Last night the network team replaced the NAT gateway with a new one (the old one sat in a single zone). They say everything was left ready.')],
  inicio: -60, abierto: -10,
  aplicar(st) {
    st.aws.nats.unshift({ id: ID.natViejo, nombre: 'tienda-nat-old', subred: ID.subred['public-b'], estado: 'deleted', ipPub: '34.250.18.95', ipPriv: '10.0.2.140', creado: -400000, borrado: -60 });
    st.aws.nats.find(n => n.id === ID.nat).creado = -95;
    N.rt(st, ID.rtPriv).rutas.find(r => r.dest === '0.0.0.0/0').nat = ID.natViejo;
  },
  objetivo(st) {
    const out = [], r = N.rutaDefecto(st, ID.subred['private-a']);
    if (r && r.gw === ID.igw) out.push(T('La tabla de rutas privada sale por el internet gateway: la API y la base de datos no deben tener ruta directa a internet', 'The private route table goes out through the internet gateway: the API and the database must not have a direct route to the internet'));
    if (!N.ipSalida(st, N.inst(st, I['app-01']))) out.push(T('app-01 sigue sin salida a internet', 'app-01 still has no internet egress'));
    return out;
  },
  practicas: [
    { t: T('Comprobaste la salida desde app-01 antes de tocar nada', 'You checked egress from app-01 before touching anything'), ok: st => antes(st, /curl .*pasarela/, /(replace|create|delete)-route/) },
    { t: T('Leíste la tabla de rutas: la ruta en blackhole era el problema', 'You read the route table: the blackhole route was the problem'), ok: st => antes(st, /describe-route-tables/, /(replace|create)-route/) },
    { t: T('Comprobaste qué NAT gateway está available antes de apuntar a él', 'You checked which NAT gateway is available before pointing at it'), ok: st => antes(st, /describe-nat-gateways/, /(replace|create)-route/) },
    { t: T('Comprobaste desde app-01 que los pagos vuelven a salir', 'You checked from app-01 that payments go out again'), ok: st => despues(st, /curl .*pasarela/, /(replace|create)-route/) },
  ],
  pistas: [
    T('Entra en app-01 y prueba lo mismo que hace la API: curl -sI https://api.pasarela-pagos.example. Un timeout es un problema de red, no de la aplicación.', 'Log into app-01 and try what the API does: curl -sI https://api.pasarela-pagos.example. A timeout is a network problem, not an application one.'),
    T('app-01 está en una subred privada: sale a internet por el NAT gateway que diga su tabla de rutas. aws ec2 describe-route-tables --route-table-ids ' + ID.rtPriv + ': ¿en qué estado está la ruta 0.0.0.0/0?', 'app-01 sits in a private subnet: it reaches the internet through whatever NAT gateway its route table says. aws ec2 describe-route-tables --route-table-ids ' + ID.rtPriv + ': what state is the 0.0.0.0/0 route in?'),
    T('aws ec2 describe-nat-gateways te dice cuál está available. Luego: aws ec2 replace-route --route-table-id ' + ID.rtPriv + ' --destination-cidr-block 0.0.0.0/0 --nat-gateway-id NAT', 'aws ec2 describe-nat-gateways tells you which one is available. Then: aws ec2 replace-route --route-table-id ' + ID.rtPriv + ' --destination-cidr-block 0.0.0.0/0 --nat-gateway-id NAT'),
  ],
  causa: T('Al sustituir el NAT gateway, Redes creó el nuevo y borró el viejo, pero la tabla de rutas privada seguía apuntando al viejo. La ruta por defecto quedó en blackhole: las instancias privadas perdieron la salida a internet y tienda-api dejó de llegar a la pasarela de pagos.', 'When replacing the NAT gateway, the network team created the new one and deleted the old one, but the private route table still pointed at the old one. The default route became a blackhole: the private instances lost internet egress and tienda-api could no longer reach the payment gateway.'),
  solucion: T('Ruta 0.0.0.0/0 de tienda-private reemplazada para que apunte al NAT nuevo (replace-route); comprobado con curl desde app-01.', 'The 0.0.0.0/0 route in tienda-private replaced to point at the new NAT (replace-route); checked with curl from app-01.'),
  leccion: T('Una ruta a un recurso que ya no existe no da error: queda en «blackhole» y el tráfico desaparece. Al sustituir un NAT gateway, primero se cambia la ruta y después se borra el viejo. Y nunca se «arregla» sacando la red privada por el internet gateway: sin IP pública no saldría, y con ella la base de datos quedaría a la vista.', 'A route to a resource that no longer exists raises no error: it becomes a "blackhole" and the traffic vanishes. When replacing a NAT gateway, change the route first and delete the old one afterwards. And never "fix" it by sending the private network out through the internet gateway: without a public IP it would not get out, and with one the database would be exposed.'),
  guion: ['aws cloudwatch describe-alarms --state-value ALARM', 'ssh app-01', 'curl -sI https://api.pasarela-pagos.example', 'exit',
    'aws ec2 describe-route-tables --route-table-ids ' + ID.rtPriv, 'aws ec2 describe-nat-gateways --query "NatGateways[].[NatGatewayId,State,SubnetId]" --output table',
    'aws ec2 replace-route --route-table-id ' + ID.rtPriv + ' --destination-cidr-block 0.0.0.0/0 --nat-gateway-id ' + ID.nat,
    'ssh app-01', 'curl -sI https://api.pasarela-pagos.example', 'exit'],
  trampas: [
    { cmds: ['aws ec2 replace-route --route-table-id ' + ID.rtPriv + ' --destination-cidr-block 0.0.0.0/0 --gateway-id ' + ID.igw], porque: T('sin IP pública tampoco sale por el internet gateway, y además expone la red privada', 'without a public IP it cannot get out through the internet gateway either, and it exposes the private network') },
  ],
},
// ============================================================================ 5
{
  id: 'REQ-7120', clave: 'tercer-frontal', tipo: 'peticion', nivel: 2, area: 'EC2', funciones: ['ec2'],
  impacto: 'medio', urgencia: 'media', de: T('Negocio (campaña Black Friday)', 'Business (Black Friday campaign)'),
  asunto: T('Un tercer frontal web para el Black Friday', 'A third web server for Black Friday'),
  cuerpo: [T('El viernes esperamos el triple de tráfico. Necesitamos un tercer frontal igual que los que hay: misma imagen, mismo tamaño, pero en una zona de disponibilidad distinta de las otras dos.', 'We expect three times the traffic on Friday. We need a third web server just like the existing ones: same image, same size, but in an availability zone different from the other two.'),
    T('Llamadlo web-03. Cuando esté sirviendo la web, cerrad el ticket.', 'Call it web-03. Close the ticket once it is serving the site.')],
  inicio: 0, abierto: 0,
  aplicar() {},
  objetivo(st) {
    const is = st.aws.instancias.filter(i => i.nombre === 'web-03' && i.estado !== 'terminated');
    if (!is.length) return [T('No hay ninguna instancia llamada web-03 (etiqueta Name)', 'There is no instance named web-03 (Name tag)')];
    if (is.length > 1) return [T('Hay ' + is.length + ' instancias llamadas web-03: deja sólo una', 'There are ' + is.length + ' instances named web-03: keep only one')];
    const i = is[0], s = N.subred(st, i.subred), out = [];
    if (i.ami !== ID.ami.web) out.push(T('web-03 no usa la AMI de los frontales', 'web-03 does not use the web servers\' AMI'));
    if (i.tipo !== 't3.small') out.push(T('web-03 es ' + i.tipo + ' y los frontales son t3.small', 'web-03 is a ' + i.tipo + ' and the web servers are t3.small'));
    if (!s.publica) out.push(T('web-03 está en una subred privada: desde internet no se le puede llegar', 'web-03 is in a private subnet: it cannot be reached from the internet'));
    if (s.az === 'eu-west-1a' || s.az === 'eu-west-1b') out.push(T('web-03 está en ' + s.az + ', la misma zona que otro frontal', 'web-03 is in ' + s.az + ', the same zone as another web server'));
    if (i.sgs.length !== 1 || i.sgs[0] !== SG.web) out.push(T('web-03 debería llevar sólo el security group tienda-web', 'web-03 should carry only the tienda-web security group'));
    if (i.clave !== N.CLAVE) out.push(T('web-03 no tiene la clave tienda-prod: nadie podrá entrar por SSH', 'web-03 does not have the tienda-prod key: nobody will be able to SSH in'));
    if (!out.length && !N.webSana(st, i)) out.push(T('web-03 todavía no sirve la web desde internet', 'web-03 does not serve the site from the internet yet'));
    return out;
  },
  practicas: [
    { t: T('Copiaste la configuración de un frontal existente antes de lanzar', 'You copied an existing web server\'s configuration before launching'), ok: st => antes(st, /describe-instances/, /run-instances/) },
    { t: T('Buscaste la subred de la zona libre antes de lanzar', 'You looked up the free zone\'s subnet before launching'), ok: st => antes(st, /describe-subnets/, /run-instances/) },
    { t: T('Le pusiste la etiqueta Name al lanzarla, no después', 'You tagged it with Name at launch, not afterwards'), ok: st => usado(st, /run-instances.*tag-specifications.*web-03/) },
    { t: T('Comprobaste desde fuera que sirve la web', 'You checked from outside that it serves the site'), ok: st => { const i = st.aws.instancias.find(x => x.nombre === 'web-03' && x.estado !== 'terminated'); return !!(i && i.ipPub) && usado(st, new RegExp('curl .*' + esc(i.ipPub))); } },
  ],
  pistas: [
    T('Mira cómo está hecho web-01: aws ec2 describe-instances --filters "Name=tag:Name,Values=web-01". Te interesan ImageId, InstanceType, SecurityGroups y KeyName.', 'See how web-01 is built: aws ec2 describe-instances --filters "Name=tag:Name,Values=web-01". You want ImageId, InstanceType, SecurityGroups and KeyName.'),
    T('web-01 está en eu-west-1a y web-02 en eu-west-1b. aws ec2 describe-subnets --filters "Name=tag:Name,Values=public-*" te da la subred pública de la zona c.', 'web-01 is in eu-west-1a and web-02 in eu-west-1b. aws ec2 describe-subnets --filters "Name=tag:Name,Values=public-*" gives you the public subnet in zone c.'),
    T('aws ec2 run-instances --image-id AMI --instance-type t3.small --subnet-id SUBNET --security-group-ids SG --key-name tienda-prod --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]". Después, aws ec2 wait instance-running y un curl -I a su IP pública.', 'aws ec2 run-instances --image-id AMI --instance-type t3.small --subnet-id SUBNET --security-group-ids SG --key-name tienda-prod --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]". Then aws ec2 wait instance-running and a curl -I to its public IP.'),
  ],
  causa: T('Petición de capacidad: no había nada roto.', 'Capacity request: nothing was broken.'),
  solucion: T('web-03 lanzada desde la AMI de los frontales, t3.small, en public-c (eu-west-1c), con tienda-web y la clave tienda-prod; sirve la web.', 'web-03 launched from the web servers\' AMI, t3.small, in public-c (eu-west-1c), with tienda-web and the tienda-prod key; it serves the site.'),
  leccion: T('Tres frontales en tres zonas de disponibilidad: si cae una zona entera, la tienda sigue. Lanzar «igual que» otra es copiar su AMI, tipo, red, security group y clave; si olvidas el security group, AWS pone el default y la web no se ve desde fuera. Y sin etiqueta Name, dentro de un mes nadie sabrá qué es esa instancia.', 'Three web servers in three availability zones: if a whole zone goes down, the store keeps going. Launching one "just like" another means copying its AMI, type, network, security group and key; forget the security group and AWS uses the default one, and the site is not visible from outside. And without a Name tag, in a month nobody will know what that instance is.'),
  guion: ['aws ec2 describe-instances --filters "Name=tag:Name,Values=web-01" --query "Reservations[].Instances[].[ImageId,InstanceType,SubnetId,KeyName,SecurityGroups[0].GroupId]" --output text',
    'aws ec2 describe-subnets --filters "Name=tag:Name,Values=public-*" --query "Subnets[].[Tags[0].Value,SubnetId,AvailabilityZone]" --output table',
    'aws ec2 run-instances --image-id ' + ID.ami.web + ' --instance-type t3.small --subnet-id ' + ID.subred['public-c'] + ' --security-group-ids ' + SG.web + ' --key-name tienda-prod --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]"',
    'aws ec2 wait instance-running --filters "Name=tag:Name,Values=web-03"', 'curl -I http://34.245.112.83'],
  trampas: [
    { cmds: ['aws ec2 run-instances --image-id ' + ID.ami.web + ' --instance-type t3.small --subnet-id ' + ID.subred['public-c'] + ' --key-name tienda-prod --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]"', 'sleep 120'], porque: T('sin --security-group-ids AWS pone el default: la web no se ve desde fuera', 'without --security-group-ids AWS uses the default one: the site is not visible from outside') },
    { cmds: ['aws ec2 run-instances --image-id ' + ID.ami.web + ' --instance-type t3.small --subnet-id ' + ID.subred['public-a'] + ' --security-group-ids ' + SG.web + ' --key-name tienda-prod --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]"', 'sleep 120'], porque: T('en la misma zona que web-01 no aporta nada si cae esa zona', 'in the same zone as web-01 it adds nothing if that zone goes down') },
  ],
},
];

// ------------------------------------------------------------------ uso
P.normalizarEscenario = e => {
  e.resuelto = st => (e.objetivo ? e.objetivo(st, P) : []).concat(alarmas(st));
  return e;
};
P.escenarios.forEach(P.normalizarEscenario);
P.importadas = P.importadas || [];
P.escenario = id => P.escenarios.concat(P.importadas).find(e => e.id === id || e.clave === id);
P.preparar = function (e) {
  const st = P.crear();
  if (e) { st.inicioFallo = e.inicio || 0; e.aplicar(st, P); st.alertasDesde = {}; P.refrescarAlertas(st); }
  return st;
};
P.evaluar = function (st, e) {
  return { pendientes: e.resuelto(st, P), practicas: e.practicas.map(x => ({ t: x.t, ok: !!x.ok(st) })) };
};
P.guionDe = (e, st) => typeof e.guion === 'function' ? e.guion(st) : e.guion;

})(window.PUESTO = window.PUESTO || {});
