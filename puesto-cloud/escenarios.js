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
const idMalo = k => 'i-0' + U.hex('malo:' + k, 16);   // las instancias que lanza el atacante (INC-7146)
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
P.ayudasEscenario = { usado, antes, despues, idx, ultimo };

const MATRIZ = { 'alto|alta': 'P1', 'alto|media': 'P2', 'medio|alta': 'P2', 'alto|baja': 'P3', 'medio|media': 'P3', 'bajo|alta': 'P3', 'medio|baja': 'P4', 'bajo|media': 'P4', 'bajo|baja': 'P4' };
const SLA = { P1: 60, P2: 240, P3: 480, P4: 1440 };
P.prioridad = e => { const p = MATRIZ[e.impacto + '|' + e.urgencia]; return { p, sla: SLA[p] }; };

P.funciones = [
  { id: 'ec2', titulo: T('Administración de instancias EC2 y almacenamiento EBS', 'EC2 instance and EBS storage administration'), corto: 'EC2 · EBS' },
  { id: 'red', titulo: T('Redes y seguridad en la VPC', 'VPC networking and security'), corto: 'VPC' },
  { id: 'incid', titulo: T('Monitorización con CloudWatch y resolución de incidencias', 'CloudWatch monitoring and incident resolution'), corto: T('Incidencias', 'Incidents') },
  { id: 'iam', titulo: T('Seguridad, identidades y almacenamiento (IAM, S3)', 'Security, identities and storage (IAM, S3)'), corto: 'IAM · S3' },
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
    'curl -I http://34.245.112.83', 'aws elbv2 wait target-in-service --target-group-arn ' + ID.tg, 'aws cloudwatch describe-alarms --state-value ALARM'],
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
    T('Llamadlo web-03. Cuando el balanceador le esté mandando tráfico, cerrad el ticket.', 'Call it web-03. Close the ticket once the load balancer is sending it traffic.')],
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
    const tg = N.tg(st), t = tg.targets.find(x => x.id === i.id);
    if (!t) out.push(T('web-03 no está registrada en el target group tienda-web-tg: el balanceador no le manda tráfico', 'web-03 is not registered in the tienda-web-tg target group: the load balancer sends it no traffic'));
    else if (N.salud(st, tg, t).estado !== 'healthy') out.push(T('El balanceador todavía no da por sana a web-03 (' + N.salud(st, tg, t).estado + ')', 'The load balancer does not consider web-03 healthy yet (' + N.salud(st, tg, t).estado + ')'));
    return out;
  },
  practicas: [
    { t: T('Copiaste la configuración de un frontal existente antes de lanzar', 'You copied an existing web server\'s configuration before launching'), ok: st => antes(st, /describe-instances/, /run-instances/) },
    { t: T('Buscaste la subred de la zona libre antes de lanzar', 'You looked up the free zone\'s subnet before launching'), ok: st => antes(st, /describe-subnets/, /run-instances/) },
    { t: T('Le pusiste la etiqueta Name al lanzarla, no después', 'You tagged it with Name at launch, not afterwards'), ok: st => usado(st, /run-instances.*tag-specifications.*web-03/) },
    { t: T('Le diste el mismo rol que a los demás frontales (tienda-web-role)', 'You gave it the same role as the other web servers (tienda-web-role)'), ok: st => { const i = st.aws.instancias.find(x => x.nombre === 'web-03' && x.estado !== 'terminated'); return !!(i && i.perfil === 'tienda-web-role'); } },
    { t: T('Comprobaste desde fuera que sirve la web', 'You checked from outside that it serves the site'), ok: st => { const i = st.aws.instancias.find(x => x.nombre === 'web-03' && x.estado !== 'terminated'); return !!(i && i.ipPub) && usado(st, new RegExp('curl .*' + esc(i.ipPub))); } },
  ],
  pistas: [
    T('Mira cómo está hecho web-01: aws ec2 describe-instances --filters "Name=tag:Name,Values=web-01". Te interesan ImageId, InstanceType, SecurityGroups y KeyName.', 'See how web-01 is built: aws ec2 describe-instances --filters "Name=tag:Name,Values=web-01". You want ImageId, InstanceType, SecurityGroups and KeyName.'),
    T('web-01 está en eu-west-1a y web-02 en eu-west-1b. aws ec2 describe-subnets --filters "Name=tag:Name,Values=public-*" te da la subred pública de la zona c.', 'web-01 is in eu-west-1a and web-02 in eu-west-1b. aws ec2 describe-subnets --filters "Name=tag:Name,Values=public-*" gives you the public subnet in zone c.'),
    T('aws ec2 run-instances --image-id AMI --instance-type t3.small --subnet-id SUBNET --security-group-ids SG --key-name tienda-prod --iam-instance-profile Name=tienda-web-role --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]". Cuando esté running, regístrala en el balanceador: aws elbv2 register-targets --target-group-arn TG --targets Id=INSTANCIA, y espera con aws elbv2 wait target-in-service.', 'aws ec2 run-instances --image-id AMI --instance-type t3.small --subnet-id SUBNET --security-group-ids SG --key-name tienda-prod --iam-instance-profile Name=tienda-web-role --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]". Once it is running, register it with the load balancer: aws elbv2 register-targets --target-group-arn TG --targets Id=INSTANCE, and wait with aws elbv2 wait target-in-service.'),
  ],
  causa: T('Petición de capacidad: no había nada roto.', 'Capacity request: nothing was broken.'),
  solucion: T('web-03 lanzada desde la AMI de los frontales, t3.small, en public-c (eu-west-1c), con tienda-web, la clave tienda-prod y el rol tienda-web-role; registrada en tienda-web-tg y sana.', 'web-03 launched from the web servers\' AMI, t3.small, in public-c (eu-west-1c), with tienda-web, the tienda-prod key and the tienda-web-role role; registered in tienda-web-tg and healthy.'),
  leccion: T('Tres frontales en tres zonas de disponibilidad: si cae una zona entera, la tienda sigue. Lanzar «igual que» otra es copiar su AMI, tipo, red, security group, clave y rol; si olvidas el security group, AWS pone el default y la web no se ve desde fuera. Una instancia nueva no recibe tráfico hasta que la registras en el balanceador y pasa sus health checks. Y sin etiqueta Name, dentro de un mes nadie sabrá qué es.', 'Three web servers in three availability zones: if a whole zone goes down, the store keeps going. Launching one "just like" another means copying its AMI, type, network, security group, key and role; forget the security group and AWS uses the default one, and the site is not visible from outside. A new instance gets no traffic until you register it with the load balancer and it passes its health checks. And without a Name tag, in a month nobody will know what it is.'),
  guion: ['aws ec2 describe-instances --filters "Name=tag:Name,Values=web-01" --query "Reservations[].Instances[].[ImageId,InstanceType,SubnetId,KeyName,SecurityGroups[0].GroupId,IamInstanceProfile.Arn]" --output text',
    'aws ec2 describe-subnets --filters "Name=tag:Name,Values=public-*" --query "Subnets[].[Tags[0].Value,SubnetId,AvailabilityZone]" --output table',
    'aws ec2 run-instances --image-id ' + ID.ami.web + ' --instance-type t3.small --subnet-id ' + ID.subred['public-c'] + ' --security-group-ids ' + SG.web + ' --key-name tienda-prod --iam-instance-profile Name=tienda-web-role --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]"',
    'aws ec2 wait instance-running --filters "Name=tag:Name,Values=web-03"', 'curl -I http://34.245.112.83',
    'aws elbv2 register-targets --target-group-arn ' + ID.tg + ' --targets Id=' + N.idLanzada(1), 'aws elbv2 wait target-in-service --target-group-arn ' + ID.tg,
    'aws elbv2 describe-target-health --target-group-arn ' + ID.tg + ' --query "TargetHealthDescriptions[].[Target.Id,TargetHealth.State]" --output text'],
  trampas: [
    { cmds: ['aws ec2 run-instances --image-id ' + ID.ami.web + ' --instance-type t3.small --subnet-id ' + ID.subred['public-c'] + ' --key-name tienda-prod --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]"', 'sleep 120'], porque: T('sin --security-group-ids AWS pone el default: la web no se ve desde fuera', 'without --security-group-ids AWS uses the default one: the site is not visible from outside') },
    { cmds: ['aws ec2 run-instances --image-id ' + ID.ami.web + ' --instance-type t3.small --subnet-id ' + ID.subred['public-a'] + ' --security-group-ids ' + SG.web + ' --key-name tienda-prod --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]"', 'sleep 120'], porque: T('en la misma zona que web-01 no aporta nada si cae esa zona', 'in the same zone as web-01 it adds nothing if that zone goes down') },
  ],
},
// ============================================================================ 6
{
  id: 'INC-7130', clave: 'facturas-iam', tipo: 'incidente', nivel: 2, area: 'IAM · S3', funciones: ['iam', 'incid'],
  impacto: 'alto', urgencia: 'media', de: T('Administración (facturación)', 'Accounting (billing)'),
  asunto: T('Las facturas de hoy no aparecen: tienda-api no puede subirlas a S3', 'Today\'s invoices are missing: tienda-api cannot upload them to S3'),
  cuerpo: [T('Desde ayer por la tarde no se genera ni una factura en el bucket tienda-facturas. La alarma tienda-api-invoice-errors está en ALARM y el log de la API dice «AccessDenied».', 'Since yesterday afternoon not a single invoice has been written to the tienda-facturas bucket. The tienda-api-invoice-errors alarm is in ALARM and the API log says "AccessDenied".'),
    T('Ayer Seguridad estuvo «ajustando permisos» de las aplicaciones. No ha habido ningún despliegue.', 'Yesterday the security team was "tightening permissions" on the applications. There has been no deployment.')],
  inicio: -1050, abierto: -40,
  aplicar(st) {
    const p = st.aws.iam.politicas[ID.pol.api];
    p.versiones.push({ id: 'v2', doc: N.POL_API_V2_MALA, creada: -1052 });
    p.defecto = 'v2';
  },
  objetivo(st) {
    const out = [], r = N.iam.rol(st, 'tienda-api-role');
    if (N.evaluar(st, { rol: 'tienda-api-role' }, 's3:PutObject', 'arn:aws:s3:::tienda-facturas/facturas/2026/09/F-2026-092301.pdf').dec !== 'allowed') out.push(T('tienda-api-role sigue sin poder escribir facturas en tienda-facturas', 'tienda-api-role still cannot write invoices to tienda-facturas'));
    const anchas = r.politicas.filter(a => /AdministratorAccess|AmazonS3FullAccess|PowerUserAccess/.test(a));
    if (anchas.length) out.push(T('tienda-api-role tiene una política demasiado amplia (' + anchas.map(a => a.split('/').pop()).join(', ') + '): sólo necesita su bucket', 'tienda-api-role has an overly broad policy (' + anchas.map(a => a.split('/').pop()).join(', ') + '): it only needs its bucket'));
    return out;
  },
  practicas: [
    { t: T('Reprodujiste el error desde app-01, con las credenciales del rol', 'You reproduced the error from app-01, with the role\'s credentials'), ok: st => antes(st, /s3 cp .*tienda-facturas/, /set-default-policy-version|attach-role-policy|detach-role-policy/) },
    { t: T('Comparaste la versión nueva de la política con la anterior', 'You compared the new policy version with the previous one'), ok: st => usado(st, /get-policy-version .*v1/) && usado(st, /get-policy-version .*v2/) },
    { t: T('Volviste a la versión buena en vez de abrir más permisos', 'You went back to the good version instead of opening up more permissions'), ok: st => usado(st, /set-default-policy-version/) && !usado(st, /attach-role-policy/) },
    { t: T('Comprobaste desde app-01 que la subida ya funciona', 'You checked from app-01 that the upload works now'), ok: st => despues(st, /s3 cp .*tienda-facturas/, /set-default-policy-version|attach-role-policy/) },
  ],
  pistas: [
    T('Entra en app-01 y haz lo mismo que la API, con sus mismas credenciales: aws sts get-caller-identity te dice quién eres, y aws s3 cp /etc/hostname s3://tienda-facturas/pruebas/prueba.txt reproduce el error. Lee entero el mensaje de AccessDenied: dice la acción y el recurso.', 'Log into app-01 and do what the API does, with the same credentials: aws sts get-caller-identity tells you who you are, and aws s3 cp /etc/hostname s3://tienda-facturas/pruebas/prueba.txt reproduces the error. Read the whole AccessDenied message: it names the action and the resource.'),
    T('Desde tu equipo: aws iam list-attached-role-policies --role-name tienda-api-role, y de su política propia, aws iam list-policy-versions --policy-arn ' + ID.pol.api + '. ¿Cuándo cambió? Compara v1 y v2 con aws iam get-policy-version.', 'From your workstation: aws iam list-attached-role-policies --role-name tienda-api-role, and for its own policy, aws iam list-policy-versions --policy-arn ' + ID.pol.api + '. When did it change? Compare v1 and v2 with aws iam get-policy-version.'),
    T('En v2 el recurso es arn:aws:s3:::tienda-facturas (el bucket), no arn:aws:s3:::tienda-facturas/* (sus objetos). Vuelve a la buena: aws iam set-default-policy-version --policy-arn ' + ID.pol.api + ' --version-id v1.', 'In v2 the resource is arn:aws:s3:::tienda-facturas (the bucket), not arn:aws:s3:::tienda-facturas/* (its objects). Go back to the good one: aws iam set-default-policy-version --policy-arn ' + ID.pol.api + ' --version-id v1.'),
  ],
  causa: T('Al «ajustar» la política tienda-api-facturas, Seguridad creó una versión v2 que da PutObject sobre arn:aws:s3:::tienda-facturas (el bucket) en vez de arn:aws:s3:::tienda-facturas/* (los objetos de dentro). PutObject actúa sobre objetos, así que ya no casaba con nada y todas las subidas se denegaban.', 'When "tightening" the tienda-api-facturas policy, the security team created a version v2 that grants PutObject on arn:aws:s3:::tienda-facturas (the bucket) instead of arn:aws:s3:::tienda-facturas/* (the objects inside it). PutObject acts on objects, so it no longer matched anything and every upload was denied.'),
  solucion: T('Versión por defecto de tienda-api-facturas devuelta a v1 con set-default-policy-version; comprobado subiendo un fichero desde app-01.', 'tienda-api-facturas default version set back to v1 with set-default-policy-version; checked by uploading a file from app-01.'),
  leccion: T('En IAM, si nada lo permite, está denegado. El mensaje de AccessDenied te da la acción y el recurso exactos: compáralos con la política. Las políticas gestionadas guardan versiones, así que volver atrás es un comando. Y la tentación de «darle AmazonS3FullAccess y ya» es justo lo contrario del mínimo privilegio: la API podría borrar los backups.', 'In IAM, whatever nothing allows is denied. The AccessDenied message gives you the exact action and resource: compare them with the policy. Managed policies keep versions, so going back is one command. And the temptation to "just give it AmazonS3FullAccess" is the exact opposite of least privilege: the API could then delete the backups.'),
  guion: ['aws cloudwatch describe-alarms --state-value ALARM', 'ssh app-01', 'aws sts get-caller-identity', 'aws s3 cp /etc/hostname s3://tienda-facturas/pruebas/prueba.txt', 'exit',
    'aws iam list-attached-role-policies --role-name tienda-api-role', 'aws iam list-policy-versions --policy-arn ' + ID.pol.api,
    'aws iam get-policy-version --policy-arn ' + ID.pol.api + ' --version-id v2', 'aws iam get-policy-version --policy-arn ' + ID.pol.api + ' --version-id v1',
    'aws iam set-default-policy-version --policy-arn ' + ID.pol.api + ' --version-id v1',
    'ssh app-01', 'aws s3 cp /etc/hostname s3://tienda-facturas/pruebas/prueba.txt', 'exit'],
  trampas: [
    { cmds: ['aws iam attach-role-policy --role-name tienda-api-role --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess'], porque: T('las subidas vuelven, pero la API puede tocar todos los buckets: lo contrario del mínimo privilegio', 'uploads work again, but the API can touch every bucket: the opposite of least privilege') },
  ],
},
// ============================================================================ 7
{
  id: 'INC-7134', clave: 'bucket-publico', tipo: 'incidente', nivel: 2, area: 'S3 · Seguridad', funciones: ['iam', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Seguridad (Security Hub)', 'Security (Security Hub)'),
  asunto: T('Security Hub: el bucket tienda-catalogo-backups es público', 'Security Hub: the tienda-catalogo-backups bucket is public'),
  cuerpo: [T('Security Hub marca como crítico que tienda-catalogo-backups se puede leer desde internet, y la alarma tienda-s3-public-bucket está en ALARM. En ese bucket están las copias del catálogo y de los clientes.', 'Security Hub flags as critical that tienda-catalogo-backups can be read from the internet, and the tienda-s3-public-bucket alarm is in ALARM. That bucket holds the catalogue and customer backups.'),
    T('Ayer Compras pidió compartir el último backup del catálogo con un proveedor. Cerradlo ya y avisad de si había algo sensible a la vista.', 'Yesterday Purchasing asked to share the latest catalogue backup with a supplier. Lock it down now and tell us whether anything sensitive was exposed.')],
  inicio: -1260, abierto: -10,
  aplicar(st) {
    const b = N.bucket(st, 'tienda-catalogo-backups');
    b.bloqueo = { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false };
    b.politica = { Version: '2012-10-17', Statement: [{ Sid: 'CompartirProveedor', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::tienda-catalogo-backups/*' }] };
  },
  objetivo(st) {
    const b = N.bucket(st, 'tienda-catalogo-backups'), out = [];
    if (N.s3Publico(b)) out.push(T('tienda-catalogo-backups sigue siendo público', 'tienda-catalogo-backups is still public'));
    else if (!b.bloqueo || !b.bloqueo.BlockPublicPolicy || !b.bloqueo.RestrictPublicBuckets) out.push(T('tienda-catalogo-backups no está protegido: sin el bloqueo de acceso público, cualquiera puede volver a publicarlo con una política', 'tienda-catalogo-backups is not protected: without the public access block, anyone can make it public again with a policy'));
    return out;
  },
  practicas: [
    { t: T('Miraste qué había dentro antes de cerrarlo: tienes que poder decir qué se expuso', 'You looked at what was inside before closing it: you must be able to say what was exposed'), ok: st => antes(st, /s3 ls .*tienda-catalogo-backups|list-object/, /put-public-access-block|delete-bucket-policy/) },
    { t: T('Leíste la política que lo abría', 'You read the policy that opened it'), ok: st => antes(st, /get-bucket-policy/, /put-public-access-block|delete-bucket-policy/) },
    { t: T('Quitaste la política, además de bloquear el acceso público', 'You removed the policy, as well as blocking public access'), ok: st => !N.bucket(st, 'tienda-catalogo-backups').politica },
    { t: T('Comprobaste desde fuera, con curl, que ya da 403', 'You checked from outside, with curl, that it now returns 403'), ok: st => despues(st, /curl .*tienda-catalogo-backups/, /put-public-access-block|delete-bucket-policy/) },
  ],
  pistas: [
    T('aws s3api get-bucket-policy-status --bucket tienda-catalogo-backups lo confirma, y aws s3api get-bucket-policy --bucket tienda-catalogo-backups te dice por qué: mira el Principal.', 'aws s3api get-bucket-policy-status --bucket tienda-catalogo-backups confirms it, and aws s3api get-bucket-policy --bucket tienda-catalogo-backups tells you why: look at the Principal.'),
    T('Antes de cerrar, apunta qué se veía: aws s3 ls s3://tienda-catalogo-backups/. Y compruébalo como lo haría cualquiera: curl -sI https://tienda-catalogo-backups.s3.eu-west-1.amazonaws.com/FICHERO', 'Before closing it, note what was visible: aws s3 ls s3://tienda-catalogo-backups/. And check it the way anyone could: curl -sI https://tienda-catalogo-backups.s3.eu-west-1.amazonaws.com/FILE'),
    T('aws s3api delete-bucket-policy --bucket tienda-catalogo-backups y aws s3api put-public-access-block --bucket tienda-catalogo-backups --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true". Para el proveedor, una URL firmada: aws s3 presign.', 'aws s3api delete-bucket-policy --bucket tienda-catalogo-backups and aws s3api put-public-access-block --bucket tienda-catalogo-backups --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true". For the supplier, a presigned URL: aws s3 presign.'),
  ],
  causa: T('Para compartir un fichero con un proveedor, alguien desactivó el bloqueo de acceso público del bucket y le puso una política con Principal "*" y s3:GetObject sobre todo su contenido: no sólo el catálogo, también clientes-2026-09-20.csv.gz, con datos personales.', 'To share a file with a supplier, someone turned off the bucket\'s public access block and gave it a policy with Principal "*" and s3:GetObject on everything inside: not just the catalogue but also clientes-2026-09-20.csv.gz, with personal data.'),
  solucion: T('Política del bucket borrada y bloqueo de acceso público activado con sus cuatro opciones; comprobado con curl (403). Queda notificar la posible exposición de los datos de clientes.', 'Bucket policy deleted and public access block turned on with all four settings; checked with curl (403). The possible exposure of customer data still has to be reported.'),
  leccion: T('Un bucket público es una fuga, no una configuración. Para compartir un fichero con alguien de fuera se usa una URL firmada que caduca (aws s3 presign), nunca una política con Principal "*". El bloqueo de acceso público es la red de seguridad: con él activo, ni una política así puede abrir el bucket. Y cerrar no basta: hay que saber qué estuvo a la vista y durante cuánto tiempo.', 'A public bucket is a leak, not a setting. To share a file with an outsider you use a presigned URL that expires (aws s3 presign), never a policy with Principal "*". The public access block is the safety net: with it on, not even such a policy can open the bucket. And closing it is not enough: you need to know what was visible and for how long.'),
  guion: ['aws cloudwatch describe-alarms --state-value ALARM', 'aws s3api get-bucket-policy-status --bucket tienda-catalogo-backups',
    'aws s3api get-bucket-policy --bucket tienda-catalogo-backups --query Policy --output text', 'aws s3 ls s3://tienda-catalogo-backups/',
    'curl -sI https://tienda-catalogo-backups.s3.eu-west-1.amazonaws.com/clientes-2026-09-20.csv.gz',
    'aws s3api delete-bucket-policy --bucket tienda-catalogo-backups',
    'aws s3api put-public-access-block --bucket tienda-catalogo-backups --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"',
    'curl -sI https://tienda-catalogo-backups.s3.eu-west-1.amazonaws.com/clientes-2026-09-20.csv.gz'],
  trampas: [
    { cmds: ['aws s3api put-public-access-block --bucket tienda-catalogo-backups --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"'], porque: T('bloquear sólo las ACL no frena una política pública: el bucket sigue abierto', 'blocking only ACLs does not stop a public policy: the bucket stays open') },
    { cmds: ['aws s3api delete-bucket-policy --bucket tienda-catalogo-backups'], porque: T('sin la política ya no es público, pero sin el bloqueo cualquiera puede volver a abrirlo', 'without the policy it is no longer public, but without the block anyone can open it again') },
  ],
},
// ============================================================================ 8
{
  id: 'INC-7138', clave: 'precios-version', tipo: 'incidente', nivel: 2, area: 'S3', funciones: ['ec2', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Atención al cliente', 'Customer support'),
  asunto: T('La tienda enseña todos los precios a 0 €', 'The store shows every price as €0'),
  cuerpo: [T('Desde hace media hora la web muestra los productos a 0 € y «sin stock». La alarma tienda-prices-config está en ALARM.', 'For the last half hour the site has shown products at €0 and "out of stock". The tienda-prices-config alarm is in ALARM.'),
    T('La web lee los precios de s3://tienda-config/precios.json. El pipeline de precios ha subido una versión nueva esta mañana.', 'The site reads prices from s3://tienda-config/precios.json. The pricing pipeline uploaded a new version this morning.')],
  inicio: -25, abierto: -8,
  aplicar(st) {
    const b = N.bucket(st, 'tienda-config');
    b.objetos['precios.json'].unshift(N.verS3('precios-413', N.PRECIOS_MALOS, -25));
  },
  objetivo(st) {
    const v = N.objetoActual(N.bucket(st, 'tienda-config'), 'precios.json');
    if (!v) return [T('precios.json no existe: la web no tiene precios', 'precios.json does not exist: the site has no prices')];
    return v.contenido.some(l => /"productos": 0\b/.test(l)) ? [T('precios.json sigue trayendo 0 productos', 'precios.json still has 0 products')]
      : v.contenido.some(l => /"version": 412/.test(l)) ? [] : [T('precios.json no es la última versión buena (la 412)', 'precios.json is not the last good version (412)')];
  },
  practicas: [
    { t: T('Miraste el contenido de precios.json antes de tocar nada', 'You looked at the contents of precios.json before touching anything'), ok: st => antes(st, /s3 cp s3:\/\/tienda-config\/precios\.json -|get-object .*precios\.json/, /copy-object/) },
    { t: T('Listaste las versiones para encontrar la última buena', 'You listed the versions to find the last good one'), ok: st => antes(st, /list-object-versions/, /copy-object/) },
    { t: T('Comprobaste el contenido de la versión antigua antes de restaurarla', 'You checked the old version\'s contents before restoring it'), ok: st => antes(st, /get-object .*--version-id/, /copy-object/) },
    { t: T('Restauraste copiando la versión buena encima, sin borrar ninguna', 'You restored by copying the good version on top, without deleting any'), ok: st => usado(st, /copy-object/) && !usado(st, /delete-object|s3 rm/) },
  ],
  pistas: [
    T('Mira qué hay ahora: aws s3 cp s3://tienda-config/precios.json - (el guion final lo saca por pantalla).', 'Look at what is there now: aws s3 cp s3://tienda-config/precios.json - (the final dash prints it to the screen).'),
    T('El bucket tiene versionado: nada se pierde al sobrescribir. aws s3api list-object-versions --bucket tienda-config --prefix precios.json. Para ver una versión concreta: aws s3api get-object --bucket tienda-config --key precios.json --version-id ID /dev/stdout', 'The bucket is versioned: nothing is lost when overwritten. aws s3api list-object-versions --bucket tienda-config --prefix precios.json. To see a specific version: aws s3api get-object --bucket tienda-config --key precios.json --version-id ID /dev/stdout'),
    T('Para restaurar, copia la versión buena sobre la actual: aws s3api copy-object --bucket tienda-config --key precios.json --copy-source "tienda-config/precios.json?versionId=ID". La mala sigue en el historial, por si hay que estudiarla.', 'To restore, copy the good version over the current one: aws s3api copy-object --bucket tienda-config --key precios.json --copy-source "tienda-config/precios.json?versionId=ID". The bad one stays in the history, in case it needs studying.'),
  ],
  causa: T('El pipeline de precios subió una versión 413 de precios.json generada con un catálogo vacío: 0 productos. La web la leyó tal cual.', 'The pricing pipeline uploaded a version 413 of precios.json generated from an empty catalogue: 0 products. The site read it as it was.'),
  solucion: T('Versión 412 restaurada copiándola sobre la actual con copy-object; la 413 queda en el historial del bucket para investigar el pipeline.', 'Version 412 restored by copying it over the current one with copy-object; 413 stays in the bucket\'s history so the pipeline can be investigated.'),
  leccion: T('El versionado de S3 convierte un «lo hemos sobrescrito» en un «volvemos a la anterior». Se restaura copiando la versión buena encima, no borrando la mala: así no pierdes la prueba de qué falló. Y sin versionado, la única salida habría sido un backup, si lo hubiera.', 'S3 versioning turns "we overwrote it" into "we go back to the previous one". You restore by copying the good version on top, not by deleting the bad one: that way you keep the evidence of what went wrong. Without versioning, the only way out would have been a backup, if there was one.'),
  guion: st => {
    const vs = N.bucket(st, 'tienda-config').objetos['precios.json'], buena = vs[1].id;
    return ['aws cloudwatch describe-alarms --state-value ALARM', 'aws s3 cp s3://tienda-config/precios.json -',
      'aws s3api list-object-versions --bucket tienda-config --prefix precios.json --query "Versions[].[VersionId,LastModified,Size,IsLatest]" --output table',
      'aws s3api get-object --bucket tienda-config --key precios.json --version-id ' + buena + ' /dev/stdout',
      'aws s3api copy-object --bucket tienda-config --key precios.json --copy-source "tienda-config/precios.json?versionId=' + buena + '"',
      'aws s3 cp s3://tienda-config/precios.json -'];
  },
  trampas: [
    { cmds: ['aws s3 rm s3://tienda-config/precios.json'], porque: T('borrar en un bucket versionado deja un marcador de borrado: la web se queda sin precios', 'deleting in a versioned bucket leaves a delete marker: the site is left with no prices at all') },
  ],
},
// ============================================================================ 9
{
  id: 'INC-7142', clave: 'health-check', tipo: 'incidente', nivel: 2, area: 'ELB', funciones: ['ec2', 'incid'],
  impacto: 'medio', urgencia: 'alta', de: T('Monitorización (CloudWatch)', 'Monitoring (CloudWatch)'),
  asunto: T('tienda-alb-unhealthy-hosts: el balanceador da por malos los dos frontales', 'tienda-alb-unhealthy-hosts: the load balancer marks both web servers as unhealthy'),
  cuerpo: [T('Desde el despliegue de las 8:30 están en ALARM tienda-alb-unhealthy-hosts y tienda-web-healthy-hosts: el balanceador dice que no tiene ni un frontal sano.', 'Since the 8:30 deployment, tienda-alb-unhealthy-hosts and tienda-web-healthy-hosts have been in ALARM: the load balancer says it does not have a single healthy web server.'),
    T('Lo raro es que la web carga con normalidad. El despliegue fue del equipo de plataforma, que cambió «la configuración del target group».', 'The odd thing is that the site loads normally. The deployment was done by the platform team, who changed "the target group configuration".')],
  inicio: -42, abierto: -12,
  aplicar(st) {
    const tg = N.tg(st);
    tg.hc.path = '/healthz'; tg.cambiado = -42;
    tg.targets.forEach(t => { tg.salud[t.id] = { real: 'unhealthy', desde: -41, antes: 'healthy', razon: 'Target.ResponseCodeMismatch', desc: 'Health checks failed with these codes: [404]' }; });
  },
  objetivo(st) {
    const tg = N.tg(st), malos = tg.targets.filter(t => { const i = st.aws.instancias.find(x => x.id === t.id); return i && i.estado === 'running' && N.salud(st, tg, t).estado !== 'healthy'; });
    return malos.length ? [T(malos.length + ' destino' + (malos.length > 1 ? 's' : '') + ' de tienda-web-tg sin pasar el health check', malos.length + ' target' + (malos.length > 1 ? 's' : '') + ' in tienda-web-tg not passing the health check')] : [];
  },
  practicas: [
    { t: T('Leíste el motivo exacto con describe-target-health antes de cambiar nada', 'You read the exact reason with describe-target-health before changing anything'), ok: st => antes(st, /describe-target-health/, /modify-target-group/) },
    { t: T('Comprobaste desde dentro de un frontal qué contesta cada ruta', 'You checked from inside a web server what each path returns'), ok: st => antes(st, /curl .*localhost\/health/, /modify-target-group/) },
    { t: T('Comprobaste que la web seguía sirviendo a través del balanceador (fail-open)', 'You checked that the site was still served through the load balancer (fail-open)'), ok: st => usado(st, /curl .*elb\.amazonaws\.com/) },
    { t: T('Esperaste a que los destinos pasaran a healthy y lo comprobaste', 'You waited for the targets to become healthy and checked it'), ok: st => despues(st, /wait target-in-service|describe-target-health/, /modify-target-group/) },
  ],
  pistas: [
    T('aws elbv2 describe-target-groups --names tienda-web-tg te da el ARN y la configuración del health check. aws elbv2 describe-target-health --target-group-arn ARN te dice el motivo exacto por el que cada destino está mal.', 'aws elbv2 describe-target-groups --names tienda-web-tg gives you the ARN and the health check configuration. aws elbv2 describe-target-health --target-group-arn ARN tells you the exact reason each target is unhealthy.'),
    T('«Health checks failed with these codes: [404]»: el balanceador pide una ruta que no existe. Entra en un frontal y pruébalo tú: curl -I http://localhost/healthz y curl -I http://localhost/health.', '"Health checks failed with these codes: [404]": the load balancer is asking for a path that does not exist. Log into a web server and try it yourself: curl -I http://localhost/healthz and curl -I http://localhost/health.'),
    T('aws elbv2 modify-target-group --target-group-arn ARN --health-check-path /health, y aws elbv2 wait target-in-service --target-group-arn ARN hasta que estén sanos.', 'aws elbv2 modify-target-group --target-group-arn ARN --health-check-path /health, then aws elbv2 wait target-in-service --target-group-arn ARN until they are healthy.'),
  ],
  causa: T('El despliegue cambió la ruta del health check del target group a /healthz, pero nginx sólo sirve /health. Todos los health checks recibían un 404 y el balanceador marcó como malos a los dos frontales. La web seguía cargando porque, cuando todos los destinos están mal, el ALB no corta: reparte entre todos («fail-open»).', 'The deployment changed the target group\'s health check path to /healthz, but nginx only serves /health. Every health check got a 404 and the load balancer marked both web servers unhealthy. The site kept loading because, when every target is unhealthy, the ALB does not cut off: it spreads traffic across all of them ("fail-open").'),
  solucion: T('Ruta del health check de tienda-web-tg devuelta a /health con modify-target-group; los dos destinos vuelven a healthy.', 'tienda-web-tg health check path set back to /health with modify-target-group; both targets are healthy again.'),
  leccion: T('Que la web cargue no significa que esté bien: con todos los destinos en unhealthy, el ALB reparte igual a ciegas, y en cuanto un frontal falle de verdad le seguirá mandando tráfico. El motivo de describe-target-health (Target.ResponseCodeMismatch, Target.Timeout…) te dice dónde mirar. Y un health check se comprueba igual que lo hace el balanceador: con curl a esa misma ruta.', 'The site loading does not mean it is fine: with every target unhealthy, the ALB distributes blindly, and once a web server really fails it will keep sending it traffic. The reason in describe-target-health (Target.ResponseCodeMismatch, Target.Timeout…) tells you where to look. And you test a health check the way the load balancer does: with curl to that same path.'),
  guion: ['aws cloudwatch describe-alarms --state-value ALARM', 'aws elbv2 describe-target-groups --names tienda-web-tg --query "TargetGroups[].[TargetGroupArn,HealthCheckPath,Matcher.HttpCode]" --output text',
    'aws elbv2 describe-target-health --target-group-arn ' + ID.tg, 'curl -I http://' + ID.albDns + '/',
    'ssh web-01', 'curl -I http://localhost/healthz', 'curl -I http://localhost/health', 'exit',
    'aws elbv2 modify-target-group --target-group-arn ' + ID.tg + ' --health-check-path /health',
    'aws elbv2 wait target-in-service --target-group-arn ' + ID.tg,
    'aws elbv2 describe-target-health --target-group-arn ' + ID.tg + ' --query "TargetHealthDescriptions[].[Target.Id,TargetHealth.State]" --output text'],
  trampas: [
    { cmds: ['ssh web-01', 'sudo systemctl restart nginx', 'exit', 'ssh web-02', 'sudo systemctl restart nginx', 'exit', 'sleep 180'], porque: T('reiniciar nginx no cambia la ruta que pide el balanceador', 'restarting nginx does not change the path the load balancer asks for') },
  ],
},
// ============================================================================ 10
{
  id: 'INC-7146', clave: 'clave-filtrada', tipo: 'incidente', nivel: 3, area: 'IAM · Seguridad', funciones: ['iam', 'incid'],
  impacto: 'alto', urgencia: 'alta', de: T('Seguridad (aviso de GitHub)', 'Security (GitHub alert)'),
  asunto: T('Una clave de acceso de AWS publicada en GitHub', 'An AWS access key published on GitHub'),
  cuerpo: [T('El escaneo de secretos de GitHub ha encontrado la clave de acceso ' + ID.clave.ci + ' en un commit público del repositorio tienda-scripts, subido hace 40 minutos. Están en ALARM iam-access-key-exposed y guardduty-high-severity.', 'GitHub secret scanning has found the access key ' + ID.clave.ci + ' in a public commit of the tienda-scripts repository, pushed 40 minutes ago. iam-access-key-exposed and guardduty-high-severity are in ALARM.'),
    T('Hay que cortarla ya y averiguar qué han hecho con ella. Ojo: si es la del pipeline de despliegue, el pipeline necesita seguir funcionando.', 'It must be cut off now and we need to find out what was done with it. Careful: if it is the deployment pipeline\'s key, the pipeline needs to keep working.')],
  inicio: -40, abierto: -6,
  aplicar(st) {
    const a = st.aws, u = N.iam.usuario(st, 'ci-deploy');
    a.iam.filtrada = { usuario: 'ci-deploy', clave: ID.clave.ci };
    u.claves[0].uso = { min: -22, svc: 'ec2', region: 'us-east-1' };
    for (let k = 1; k <= 3; k++) {
      a.instancias.push({ id: idMalo(k), nombre: '', tipo: 'c5.4xlarge', region: 'us-east-1', az: 'us-east-1' + 'abc'[k - 1], subred: 'subnet-0' + U.hex('use1-sub' + k, 16), vpc: 'vpc-0' + U.hex('use1-vpc', 16),
        sgs: ['sg-0' + U.hex('use1-sg', 16)], ipPriv: '172.31.' + (20 + k) + '.' + (40 + k * 7), ipPub: '3.' + (80 + k) + '.' + (11 * k) + '.' + (200 + k), ami: 'ami-0' + U.hex('xmrig', 16),
        clave: null, estado: 'running', lanzada: -21, iniciada: -21, motivo: '', host: null, listoEn: null, perfil: null, malicia: true });
    }
  },
  objetivo(st) {
    const out = [], u = N.iam.usuario(st, 'ci-deploy');
    const k = u.claves.find(x => x.id === ID.clave.ci);
    if (k && k.estado === 'Active') out.push(T('La clave filtrada ' + ID.clave.ci + ' sigue activa', 'The leaked key ' + ID.clave.ci + ' is still active'));
    if (!u.claves.some(x => x.id !== ID.clave.ci && x.estado === 'Active')) out.push(T('ci-deploy no tiene ninguna clave activa nueva: el pipeline de despliegue se ha quedado sin credenciales', 'ci-deploy has no new active key: the deployment pipeline has been left without credentials'));
    const malas = st.aws.instancias.filter(i => i.malicia && i.estado !== 'terminated' && i.estado !== 'shutting-down');
    if (malas.length) out.push(T('Siguen vivas ' + malas.length + ' instancias que no son vuestras', malas.length + ' instances that are not yours are still alive'));
    return out;
  },
  practicas: [
    { t: T('Desactivaste la clave filtrada antes de nada más', 'You deactivated the leaked key before anything else'), ok: st => { const i = idx(st, /update-access-key .*Inactive|delete-access-key/); return i >= 0 && [/terminate-instances/, /create-access-key/].every(re => { const j = idx(st, re); return j < 0 || i < j; }); } },
    { t: T('Miraste dónde y cuándo se usó la clave por última vez', 'You checked where and when the key was last used'), ok: st => usado(st, /get-access-key-last-used/) },
    { t: T('Buscaste recursos en la región que delataba el último uso', 'You looked for resources in the region the last use gave away'), ok: st => usado(st, /--region us-east-1/) },
    { t: T('Borraste la clave filtrada, después de crear la nueva', 'You deleted the leaked key, after creating the new one'), ok: st => { const u = N.iam.usuario(st, 'ci-deploy'); return !u.claves.some(x => x.id === ID.clave.ci) && antes(st, /create-access-key/, /delete-access-key/); } },
  ],
  pistas: [
    T('¿De quién es la clave y qué se ha hecho con ella? aws iam get-access-key-last-used --access-key-id ' + ID.clave.ci + ' te da el usuario, el servicio y la región del último uso.', 'Whose key is it and what was done with it? aws iam get-access-key-last-used --access-key-id ' + ID.clave.ci + ' gives you the user, the service and the region of its last use.'),
    T('Córtala ya: aws iam update-access-key --user-name ci-deploy --access-key-id ' + ID.clave.ci + ' --status Inactive. Luego mira la región del último uso: aws ec2 describe-instances --region us-east-1. La tienda no tiene nada allí.', 'Cut it off now: aws iam update-access-key --user-name ci-deploy --access-key-id ' + ID.clave.ci + ' --status Inactive. Then look at the region of the last use: aws ec2 describe-instances --region us-east-1. The store has nothing there.'),
    T('aws ec2 terminate-instances --region us-east-1 --instance-ids ... para las que no son vuestras. Para el pipeline: aws iam create-access-key --user-name ci-deploy, y cuando la nueva esté puesta, aws iam delete-access-key de la filtrada.', 'aws ec2 terminate-instances --region us-east-1 --instance-ids ... for the ones that are not yours. For the pipeline: aws iam create-access-key --user-name ci-deploy, and once the new one is in place, aws iam delete-access-key for the leaked one.'),
  ],
  causa: T('Un script del pipeline con la clave de ci-deploy escrita dentro se subió a un repositorio público. En 18 minutos alguien la encontró y la usó para lanzar tres c5.4xlarge en us-east-1, una región que la tienda no usa, a minar criptomonedas. La política del pipeline le permite lanzar instancias, y en cualquier región.', 'A pipeline script with the ci-deploy key written inside it was pushed to a public repository. Within 18 minutes someone found it and used it to launch three c5.4xlarge instances in us-east-1, a region the store does not use, to mine cryptocurrency. The pipeline\'s policy lets it launch instances, in any region.'),
  solucion: T('Clave filtrada desactivada al momento, instancias intrusas de us-east-1 terminadas, clave nueva para el pipeline y la filtrada borrada.', 'Leaked key deactivated at once, the intruding instances in us-east-1 terminated, a new key for the pipeline and the leaked one deleted.'),
  leccion: T('Una clave publicada se usa en minutos: primero se corta (Inactive), después se investiga. get-access-key-last-used te dice por dónde ha andado, y los atacantes eligen regiones que no miras. Para no dejar sin servicio a quien la usaba legítimamente, se crea la nueva antes de borrar la vieja. Y la causa de fondo es tener claves de larga duración: un pipeline debería usar un rol.', 'A published key gets used within minutes: cut it off first (Inactive), investigate afterwards. get-access-key-last-used tells you where it has been, and attackers pick regions you do not watch. So as not to cut off whoever used it legitimately, create the new key before deleting the old one. And the root cause is long-lived keys: a pipeline should use a role.'),
  guion: ['aws cloudwatch describe-alarms --state-value ALARM', 'aws iam update-access-key --user-name ci-deploy --access-key-id ' + ID.clave.ci + ' --status Inactive',
    'aws iam get-access-key-last-used --access-key-id ' + ID.clave.ci,
    'aws ec2 describe-instances --region us-east-1 --query "Reservations[].Instances[].[InstanceId,InstanceType,State.Name,LaunchTime]" --output table',
    'aws ec2 terminate-instances --region us-east-1 --instance-ids ' + [1, 2, 3].map(idMalo).join(' '),
    'aws iam create-access-key --user-name ci-deploy', 'aws iam delete-access-key --user-name ci-deploy --access-key-id ' + ID.clave.ci,
    'aws iam list-access-keys --user-name ci-deploy', 'aws cloudwatch describe-alarms --state-value ALARM'],
  trampas: [
    { cmds: ['aws iam delete-access-key --user-name ci-deploy --access-key-id ' + ID.clave.ci], porque: T('la clave queda cortada, pero las instancias del atacante siguen minando y el pipeline se queda sin credenciales', 'the key is cut off, but the attacker\'s instances keep mining and the pipeline is left without credentials') },
    { cmds: ['aws iam update-access-key --user-name ci-deploy --access-key-id ' + ID.clave.ci + ' --status Inactive', 'aws ec2 describe-instances', 'aws iam create-access-key --user-name ci-deploy'], porque: T('mirar sólo en eu-west-1 no encuentra lo que se lanzó en otra región', 'looking only in eu-west-1 does not find what was launched in another region') },
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
