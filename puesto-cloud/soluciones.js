// Puesto Cloud · solucionario: por qué se hace cada paso, y el glosario.
//
// La página es la del Puesto Linux (../puesto-linux/solucionario.js): ejecuta
// el `guion` de cada ticket en el simulador y pinta la salida real. Aquí sólo
// va lo que un comando no dice: la fase y el porqué de cada paso.
//
// Cada paso es [trozo, fase, explicación]. El trozo no es el comando entero
// (los ids de AWS son largos y ya están en el guion): es un fragmento que tiene
// que aparecer en el comando de esa posición. nube-test.js lo comprueba, así
// que si alguien cambia un guion, el solucionario deja de pasar hasta que se
// actualice.
//
//   fase: 'diag' (mirar) · 'arreglo' (cambiar algo) · 'comprobar' · '' (moverse)
(function (P) {
'use strict';
const T = P.T;

P.solucionarioCfg = {
  buscar: T('Buscar un término: blackhole, NAT, snapshot…', 'Search for a term: blackhole, NAT, snapshot…'),
  silencio: T('(no devuelve nada: en la CLI de AWS y en Linux, el silencio suele significar que ha ido bien)', '(no output: in the AWS CLI and in Linux, silence usually means it worked)'),
};

P.soluciones = {
'INC-7101': {
  terminos: ['timeout-refused', 'security-group', 'cidr', 'ip-publica', 'bastion'],
  pasos: [
    ['ssh bastion', 'diag', T('Reproduce el problema antes de tocar nada: se queda colgado y acaba en «Connection timed out». Un timeout (no un «refused» ni un «Permission denied») significa que el paquete no llega: algo lo descarta por el camino.', 'Reproduce the problem before touching anything: it hangs and ends in "Connection timed out". A timeout (not "refused" nor "Permission denied") means the packet never arrives: something drops it on the way.')],
    ['describe-security-groups', 'diag', T('El security group del bastión sólo deja entrar al 22 desde 203.0.113.10/32, la «Oficina Madrid». Todo lo demás se descarta en silencio.', 'The bastion\'s security group only lets 203.0.113.10/32, the "Madrid office", into port 22. Everything else is silently dropped.')],
    ['checkip', 'diag', T('Tu IP pública hoy es 198.51.100.24: el router nuevo trajo una IP nueva. Ahí está la diferencia.', 'Your public IP today is 198.51.100.24: the new router brought a new IP. There is the difference.')],
    ['revoke-security-group-ingress', 'arreglo', T('Quita la regla de la IP vieja. Esa dirección ya no es vuestra: mañana puede ser de otro.', 'Remove the old IP\'s rule. That address is no longer yours: tomorrow it may belong to someone else.')],
    ['authorize-security-group-ingress', 'arreglo', T('Abre el 22 sólo a la IP nueva, con /32: una única dirección. Nada de 0.0.0.0/0, ni «un momento».', 'Open port 22 to the new IP only, with /32: a single address. No 0.0.0.0/0, not even "for a moment".')],
    ['ssh bastion', 'comprobar', T('Ahora entra a la primera: el cambio funciona y no has abierto nada de más.', 'Now it gets in at once: the change works and nothing extra was opened.')],
    ['exit', '', T('De vuelta a tu equipo.', 'Back to your workstation.')],
  ],
},
'INC-7104': {
  terminos: ['cloudwatch', 'ec2-estados', 'ip-publica', 'enable-now', 'proxyjump'],
  pasos: [
    ['describe-alarms', 'diag', T('Una alarma: tienda-web-healthy-hosts, sólo 1 de 2 frontales sirve la web. La web funciona, pero sin red de seguridad.', 'One alarm: tienda-web-healthy-hosts, only 1 of 2 web servers is serving the site. The site works, but with no safety net.')],
    ['describe-instances', 'diag', T('web-02 está stopped, y StateTransitionReason dice «User initiated» ayer por la tarde: alguien la paró al acabar las pruebas de carga. No se cayó: la pararon.', 'web-02 is stopped, and StateTransitionReason says "User initiated" yesterday afternoon: someone stopped it after the load tests. It did not crash: it was stopped.')],
    ['start-instances', 'arreglo', T('pending: AWS la arranca. Sin Elastic IP, recibirá una IP pública distinta de la que tenía.', 'pending: AWS starts it. Without an Elastic IP, it will get a different public IP from the one it had.')],
    ['wait instance-running', '', T('Espera a que esté running antes de intentar entrar: si no, ssh se queda en timeout.', 'Wait until it is running before trying to log in: otherwise ssh times out.')],
    ['ssh web-02', '', T('Por el ~/.ssh/config: salta por el bastión hasta su IP privada, que no cambia al parar y arrancar.', 'Through ~/.ssh/config: it jumps through the bastion to its private IP, which does not change on stop and start.')],
    ['systemctl status nginx', 'diag', T('inactive (dead) y disabled: la instancia arrancó, nginx no. En las pruebas se reinstaló y quedó deshabilitado.', 'inactive (dead) and disabled: the instance started, nginx did not. It was reinstalled during the tests and left disabled.')],
    ['enable --now nginx', 'arreglo', T('Lo habilita (arrancará con la máquina) y lo arranca ahora, en una sola orden. Sólo start lo dejaría roto para el próximo reinicio.', 'Enables it (it will start with the machine) and starts it now, in a single command. start alone would leave it broken for the next reboot.')],
    ['exit', '', T('De vuelta a tu equipo.', 'Back to your workstation.')],
    ['curl -I', 'comprobar', T('Desde fuera, contra su IP pública nueva: 200 OK. Es lo que ve un cliente.', 'From outside, against its new public IP: 200 OK. It is what a customer sees.')],
    ['describe-alarms', 'comprobar', T('Ninguna alarma en ALARM: los dos frontales vuelven a servir.', 'No alarm in ALARM: both web servers are serving again.')],
  ],
},
'INC-7108': {
  terminos: ['cloudwatch', 'ebs', 'snapshot', 'modify-volume', 'resize2fs'],
  pasos: [
    ['describe-alarms', 'diag', T('db-01-disk-data-high: el disco de datos de PostgreSQL al 93 %.', 'db-01-disk-data-high: PostgreSQL\'s data disk at 93%.')],
    ['ssh db-01', '', T('A mirar el disco desde dentro.', 'To look at the disk from the inside.')],
    ['df -h', 'diag', T('/var/lib/postgresql, 99G al 93 %. Es el volumen de datos (/dev/nvme1n1), no la raíz.', '/var/lib/postgresql, 99G at 93%. It is the data volume (/dev/nvme1n1), not the root.')],
    ['lsblk', 'diag', T('nvme1n1 mide 100G y no tiene particiones: el sistema de ficheros ocupa el disco entero. Eso decide cómo se amplía después.', 'nvme1n1 is 100G and has no partitions: the filesystem takes up the whole disk. That decides how it is grown later.')],
    ['exit', '', T('De vuelta a tu equipo: el volumen se amplía desde AWS.', 'Back to your workstation: the volume is grown from AWS.')],
    ['describe-volumes', 'diag', T('El volumen de datos de db-01: /dev/sdf, 100 GiB. Ese es el que hay que ampliar, y su id es el que necesitas.', 'db-01\'s data volume: /dev/sdf, 100 GiB. That is the one to grow, and its id is the one you need.')],
    ['create-snapshot', 'arreglo', T('Primero el seguro: un snapshot. Un modify-volume no se deshace, y si algo sale mal, esto es lo que te salva.', 'Insurance first: a snapshot. A modify-volume cannot be undone, and if something goes wrong, this is what saves you.')],
    ['modify-volume', 'arreglo', T('200 GiB: el doble da años de margen al ritmo actual. Elige bien: no podrás volver a modificarlo en 6 horas.', '200 GiB: double gives years of headroom at the current rate. Choose carefully: you will not be able to modify it again for 6 hours.')],
    ['describe-volumes-modifications', 'comprobar', T('optimizing: para el sistema operativo el disco ya mide 200 GiB, aunque AWS siga optimizándolo por detrás. Ya se puede seguir.', 'optimizing: for the operating system the disk is already 200 GiB, even though AWS keeps optimising it behind the scenes. You can carry on.')],
    ['ssh db-01', '', T('Otra vez dentro: falta la segunda mitad.', 'Back inside: the second half is missing.')],
    ['lsblk', 'comprobar', T('nvme1n1 ya mide 200G. Pero df seguiría diciendo 99G: el disco ha crecido, el sistema de ficheros no.', 'nvme1n1 is now 200G. But df would still say 99G: the disk has grown, the filesystem has not.')],
    ['resize2fs', 'arreglo', T('Amplía el ext4 en caliente hasta el tamaño del disco, sin desmontar ni parar PostgreSQL. Sin particiones, no hace falta growpart.', 'Grows the ext4 filesystem online to the size of the disk, without unmounting or stopping PostgreSQL. With no partitions, growpart is not needed.')],
    ['df -h', 'comprobar', T('197G, al 47 %. La alarma se apaga en el siguiente minuto.', '197G, at 47%. The alarm clears within the next minute.')],
    ['exit', '', T('De vuelta a tu equipo.', 'Back to your workstation.')],
  ],
},
'INC-7112': {
  terminos: ['cloudwatch', 'subred', 'nat', 'tabla-rutas', 'blackhole'],
  pasos: [
    ['describe-alarms', 'diag', T('tienda-api-payment-errors: la API no consigue hablar con la pasarela de pagos.', 'tienda-api-payment-errors: the API cannot talk to the payment gateway.')],
    ['ssh app-01', '', T('A probar desde donde está la API.', 'To test from where the API lives.')],
    ['pasarela', 'diag', T('Timeout al salir a internet desde app-01. No es la aplicación: es la red.', 'Timeout going out to the internet from app-01. It is not the application: it is the network.')],
    ['exit', '', T('De vuelta a tu equipo: la red se mira desde AWS.', 'Back to your workstation: the network is examined from AWS.')],
    ['describe-route-tables', 'diag', T('La ruta 0.0.0.0/0 de tienda-private apunta a un NAT gateway y está en «blackhole»: su destino ya no existe.', 'tienda-private\'s 0.0.0.0/0 route points at a NAT gateway and is in "blackhole": its target no longer exists.')],
    ['describe-nat-gateways', 'diag', T('Dos NAT: el viejo (deleted), al que apunta la ruta, y el nuevo (available), al que no apunta nadie. Redes creó el nuevo y borró el viejo sin cambiar la ruta.', 'Two NATs: the old one (deleted), which the route points at, and the new one (available), which nothing points at. The network team created the new one and deleted the old one without changing the route.')],
    ['replace-route', 'arreglo', T('Cambia el destino de la ruta por defecto al NAT nuevo. No contesta nada: en la CLI, el silencio es éxito.', 'Changes the default route\'s target to the new NAT. It prints nothing: in the CLI, silence is success.')],
    ['ssh app-01', '', T('Otra vez en app-01, para comprobarlo donde duele.', 'Back on app-01, to check it where it hurts.')],
    ['pasarela', 'comprobar', T('200 OK: los pagos vuelven a salir. La alarma se apaga sola.', '200 OK: payments go out again. The alarm clears by itself.')],
    ['exit', '', T('De vuelta a tu equipo.', 'Back to your workstation.')],
  ],
},
'REQ-7120': {
  terminos: ['ami', 'tipo-instancia', 'az', 'default-sg', 'etiquetas', 'jmespath'],
  pasos: [
    ['describe-instances', 'diag', T('La receta de web-01, sacada con --query: AMI, t3.small, su subred, la clave tienda-prod y el security group tienda-web.', 'web-01\'s recipe, extracted with --query: AMI, t3.small, its subnet, the tienda-prod key and the tienda-web security group.')],
    ['describe-subnets', 'diag', T('Las subredes públicas: a, b y c. web-01 está en la a y web-02 en la b, así que web-03 va a public-c.', 'The public subnets: a, b and c. web-01 is in a and web-02 in b, so web-03 goes to public-c.')],
    ['run-instances', 'arreglo', T('Misma AMI y mismo tipo, la subred de la zona c, el security group de los frontales, la clave, y la etiqueta Name desde el principio. Sin --security-group-ids, AWS le pondría el default.', 'Same AMI and type, the zone-c subnet, the web servers\' security group, the key, and the Name tag from the start. Without --security-group-ids, AWS would give it the default one.')],
    ['wait instance-running', '', T('Un minuto: pending → running. La AMI ya trae nginx habilitado, así que arranca sirviendo.', 'One minute: pending → running. The AMI already ships nginx enabled, so it boots serving.')],
    ['curl -I', 'comprobar', T('La IP pública de web-03 contesta 200 OK desde internet: está lista para el viernes.', 'web-03\'s public IP answers 200 OK from the internet: it is ready for Friday.')],
  ],
},
};

P.glosario = [
  { id: 'vpc', t: 'VPC', d: T('Tu red privada dentro de AWS (aquí, 10.0.0.0/16). Todo lo demás (subredes, rutas, security groups, instancias) vive dentro de una.', 'Your private network inside AWS (here, 10.0.0.0/16). Everything else (subnets, routes, security groups, instances) lives inside one.') },
  { id: 'subred', t: T('Subred pública / privada', 'Public / private subnet'), d: T('Un trozo de la VPC en una zona. Es pública si su tabla de rutas sale por el internet gateway, y privada si sale por un NAT (o no sale). Lo decide la ruta, no el nombre.', 'A slice of the VPC in one zone. It is public if its route table goes out through the internet gateway, and private if it goes out through a NAT (or not at all). The route decides, not the name.') },
  { id: 'security-group', t: 'Security group', d: T('Un cortafuegos con estado pegado a cada instancia: lista lo que puede entrar (puerto y origen, por CIDR o por otro security group). Lo que no está permitido se descarta en silencio.', 'A stateful firewall attached to each instance: it lists what may come in (port and source, by CIDR or by another security group). Whatever is not allowed is silently dropped.') },
  { id: 'default-sg', t: T('Security group default', 'Default security group'), d: T('El que tiene toda VPC y el que AWS pone si lanzas una instancia sin indicar otro. Sólo deja entrar a sus propios miembros: una web lanzada con él no se ve desde fuera.', 'The one every VPC has, and the one AWS uses if you launch an instance without naming another. It only lets its own members in: a web server launched with it is invisible from outside.') },
  { id: 'timeout-refused', t: T('Timeout frente a refused', 'Timeout vs refused'), d: T('«Connection timed out»: el paquete no llega (un security group, una ruta, una máquina apagada). «Connection refused»: llega a la máquina y no hay nadie escuchando en ese puerto. Distinguirlos te dice dónde mirar.', '"Connection timed out": the packet never arrives (a security group, a route, a machine that is off). "Connection refused": it reaches the machine and nobody is listening on that port. Telling them apart tells you where to look.') },
  { id: 'cidr', t: 'CIDR (/32, 0.0.0.0/0)', d: T('Una dirección con su máscara. /32 es una única IP; 0.0.0.0/0 es todo internet. En AWS una IP suelta no vale: hay que escribir 198.51.100.24/32.', 'An address with its mask. /32 is a single IP; 0.0.0.0/0 is the whole internet. AWS does not accept a bare IP: you write 198.51.100.24/32.') },
  { id: 'ip-publica', t: T('IP pública y Elastic IP', 'Public IP and Elastic IP'), d: T('La IP pública de una instancia se pierde al pararla: al arrancar le toca otra. Si algo depende de esa IP (DNS, una regla), se usa una Elastic IP, que es tuya hasta que la sueltas.', 'An instance\'s public IP is lost when you stop it: it gets another one on start. If something depends on that IP (DNS, a rule), you use an Elastic IP, which is yours until you release it.') },
  { id: 'bastion', t: T('Bastión', 'Bastion'), d: T('La única máquina con SSH abierto desde fuera (y sólo a la oficina). Para entrar en las demás se salta por ella.', 'The only machine with SSH open from outside (and only to the office). You jump through it to reach the others.') },
  { id: 'proxyjump', t: 'ProxyJump (ssh -J)', d: T('ssh -J bastion ubuntu@10.0.11.30 entra en una IP privada pasando por el bastión. En ~/.ssh/config se deja escrito para no repetirlo: ssh app-01 y listo.', 'ssh -J bastion ubuntu@10.0.11.30 reaches a private IP by going through the bastion. ~/.ssh/config writes it down so you do not repeat it: just ssh app-01.') },
  { id: 'key-pair', t: T('Par de claves y usuario', 'Key pair and user'), d: T('La instancia se lanza con la parte pública de una clave; entras con la privada (-i tienda-prod.pem) y con el usuario de la AMI: ubuntu en Ubuntu. Otro usuario u otra clave: Permission denied (publickey).', 'The instance is launched with the public half of a key; you log in with the private half (-i tienda-prod.pem) and the AMI\'s user: ubuntu on Ubuntu. Another user or key: Permission denied (publickey).') },
  { id: 'igw', t: 'Internet gateway', d: T('La puerta entre la VPC e internet, en los dos sentidos. Sólo sirve a instancias con IP pública.', 'The door between the VPC and the internet, both ways. It only serves instances with a public IP.') },
  { id: 'nat', t: 'NAT gateway', d: T('Deja que las instancias privadas salgan a internet (actualizaciones, una API externa) sin que nadie de fuera pueda entrar. Vive en una subred pública y tiene su propia IP.', 'Lets private instances go out to the internet (updates, an external API) without anyone outside being able to get in. It lives in a public subnet and has its own IP.') },
  { id: 'tabla-rutas', t: T('Tabla de rutas', 'Route table'), d: T('Dice por dónde sale el tráfico de cada subred. La ruta 0.0.0.0/0 es la de «todo lo demás»: hacia el internet gateway, un NAT o ninguna parte.', 'Says where each subnet\'s traffic goes. The 0.0.0.0/0 route is the "everything else" one: to the internet gateway, a NAT or nowhere.') },
  { id: 'blackhole', t: T('Ruta en blackhole', 'Blackhole route'), d: T('Una ruta cuyo destino ya no existe (un NAT borrado, una interfaz que se fue). AWS no da error: el tráfico simplemente desaparece. Se arregla con replace-route.', 'A route whose target no longer exists (a deleted NAT, an interface that went away). AWS raises no error: the traffic simply vanishes. You fix it with replace-route.') },
  { id: 'ec2-estados', t: T('Estados de una instancia', 'Instance states'), d: T('pending → running → stopping → stopped, y terminated (sin vuelta atrás). Parada no gasta cómputo pero sí disco, y al arrancar cambia de IP pública. StateTransitionReason dice quién y cuándo.', 'pending → running → stopping → stopped, and terminated (no way back). Stopped costs no compute but still pays for disk, and gets a new public IP on start. StateTransitionReason says who and when.') },
  { id: 'ami', t: 'AMI', d: T('La imagen desde la que nace una instancia: sistema operativo y lo que se le haya instalado. Los frontales salen de la misma AMI, por eso son iguales.', 'The image an instance is born from: the operating system and whatever was installed on it. The web servers come from the same AMI, which is why they are identical.') },
  { id: 'tipo-instancia', t: T('Tipo de instancia', 'Instance type'), d: T('El tamaño de la máquina: t3.small son 2 vCPU y 2 GiB; m6i.large, 2 vCPU y 8 GiB. Cambiarlo exige pararla.', 'The size of the machine: t3.small is 2 vCPUs and 2 GiB; m6i.large, 2 vCPUs and 8 GiB. Changing it requires stopping it.') },
  { id: 'az', t: T('Zona de disponibilidad', 'Availability zone'), d: T('Un centro de datos (o varios) dentro de la región: eu-west-1a, 1b, 1c. Repartir réplicas entre zonas es lo que hace que la caída de una no tumbe el servicio.', 'A data centre (or several) within the region: eu-west-1a, 1b, 1c. Spreading replicas across zones is what keeps one zone\'s failure from taking the service down.') },
  { id: 'ebs', t: T('Volumen EBS', 'EBS volume'), d: T('El disco de red de una instancia. Lo ve el sistema como /dev/nvme…; su tamaño (lsblk) y el del sistema de ficheros que lleva dentro (df) son dos cosas distintas.', 'An instance\'s network disk. The system sees it as /dev/nvme…; its size (lsblk) and the size of the filesystem inside it (df) are two different things.') },
  { id: 'modify-volume', t: 'modify-volume', d: T('Cambia tamaño o tipo de un volumen en caliente: modifying → optimizing → completed. En optimizing el disco ya es más grande. Sólo se puede hacer una vez cada 6 horas, y nunca para encoger.', 'Changes a volume\'s size or type online: modifying → optimizing → completed. In optimizing the disk is already bigger. It can only be done once every 6 hours, and never to shrink.') },
  { id: 'resize2fs', t: 'resize2fs / growpart', d: T('Lo que falta después de ampliar el volumen: resize2fs agranda el sistema de ficheros ext4 hasta el tamaño del disco. Si el disco tiene particiones (la raíz), antes growpart agranda la partición.', 'What is left after growing the volume: resize2fs grows the ext4 filesystem to the size of the disk. If the disk has partitions (the root), growpart grows the partition first.') },
  { id: 'snapshot', t: 'Snapshot', d: T('Una copia de un volumen en un momento dado, guardada en S3. Se hace antes de tocar un disco: es el «deshacer» que modify-volume no tiene.', 'A copy of a volume at a point in time, stored in S3. You take one before touching a disk: it is the "undo" that modify-volume does not have.') },
  { id: 'cloudwatch', t: T('Alarma de CloudWatch', 'CloudWatch alarm'), d: T('Vigila una métrica contra un umbral: OK, ALARM o INSUFFICIENT_DATA (no llegan datos, por ejemplo con la instancia parada). Es el termómetro: se mira antes y se comprueba después.', 'Watches a metric against a threshold: OK, ALARM or INSUFFICIENT_DATA (no data arriving, for example while the instance is stopped). It is the thermometer: look at it before, check it after.') },
  { id: 'jmespath', t: '--query (JMESPath)', d: T('Recorta la respuesta JSON de la CLI: Reservations[].Instances[].[InstanceId,State.Name]. [] proyecta sobre una lista, [?Key==`Name`] filtra y | corta la proyección. Con --output text o table se lee de un vistazo.', 'Trims the CLI\'s JSON response: Reservations[].Instances[].[InstanceId,State.Name]. [] projects over a list, [?Key==`Name`] filters and | stops the projection. With --output text or table it reads at a glance.') },
  { id: 'etiquetas', t: T('Etiquetas (Name)', 'Tags (Name)'), d: T('Pares clave-valor en cada recurso. Name es el nombre que ves en todas partes; sin él, una instancia es un i-0… que nadie sabrá qué es dentro de un mes. Se ponen al lanzar (--tag-specifications).', 'Key-value pairs on every resource. Name is the name you see everywhere; without it, an instance is an i-0… nobody will recognise in a month. You set them at launch (--tag-specifications).') },
  { id: 'enable-now', t: 'systemctl enable --now', d: T('Habilita un servicio (arrancará con la máquina) y lo arranca ya, de una vez. start sólo lo arranca ahora: tras el próximo reinicio vuelve a estar caído.', 'Enables a service (it will start with the machine) and starts it right away, in one go. start only starts it now: after the next reboot it is down again.') },
];
})(window.PUESTO = window.PUESTO || {});
