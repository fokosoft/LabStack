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
    ['wait target-in-service', '', T('El balanceador necesita ver /health sano tres veces seguidas (unos 2 minutos) antes de mandarle tráfico. Esto espera a que lo haga.', 'The load balancer needs to see /health succeed three times in a row (about 2 minutes) before sending it traffic. This waits for that.')],
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
  terminos: ['ami', 'tipo-instancia', 'az', 'default-sg', 'etiquetas', 'perfil-instancia', 'target-group', 'health-check'],
  pasos: [
    ['describe-instances', 'diag', T('La receta de web-01, sacada con --query: AMI, t3.small, su subred, la clave tienda-prod, el security group tienda-web y su perfil de instancia (tienda-web-role).', 'web-01\'s recipe, extracted with --query: AMI, t3.small, its subnet, the tienda-prod key, the tienda-web security group and its instance profile (tienda-web-role).')],
    ['describe-subnets', 'diag', T('Las subredes públicas: a, b y c. web-01 está en la a y web-02 en la b, así que web-03 va a public-c.', 'The public subnets: a, b and c. web-01 is in a and web-02 in b, so web-03 goes to public-c.')],
    ['run-instances', 'arreglo', T('Misma AMI y mismo tipo, la subred de la zona c, el security group de los frontales, la clave, el mismo rol y la etiqueta Name desde el principio. Sin --security-group-ids, AWS le pondría el default.', 'Same AMI and type, the zone-c subnet, the web servers\' security group, the key, the same role and the Name tag from the start. Without --security-group-ids, AWS would give it the default one.')],
    ['wait instance-running', '', T('Un minuto: pending → running. La AMI ya trae nginx habilitado, así que arranca sirviendo.', 'One minute: pending → running. The AMI already ships nginx enabled, so it boots serving.')],
    ['curl -I', 'comprobar', T('La IP pública de web-03 contesta 200 OK desde internet. Pero los clientes entran por el balanceador, y ese todavía no sabe que existe.', 'web-03\'s public IP answers 200 OK from the internet. But customers come in through the load balancer, and that does not know it exists yet.')],
    ['register-targets', 'arreglo', T('La añade al target group tienda-web-tg: a partir de ahora el balanceador le hace health checks.', 'Adds it to the tienda-web-tg target group: from now on the load balancer health-checks it.')],
    ['wait target-in-service', '', T('Tres health checks seguidos con 200 (unos 2 minutos) y pasa de initial a healthy: empieza a recibir tráfico.', 'Three health checks in a row with 200 (about 2 minutes) and it goes from initial to healthy: it starts receiving traffic.')],
    ['describe-target-health', 'comprobar', T('Tres destinos healthy: web-03 ya está en el reparto para el viernes.', 'Three healthy targets: web-03 is in the rotation for Friday.')],
  ],
},
'INC-7130': {
  terminos: ['iam-rol', 'perfil-instancia', 'politica-iam', 'version-politica', 'minimo-privilegio', 'implicit-deny'],
  pasos: [
    ['describe-alarms', 'diag', T('tienda-api-invoice-errors: las facturas no se suben a S3.', 'tienda-api-invoice-errors: invoices are not being uploaded to S3.')],
    ['ssh app-01', '', T('A probar con las mismas credenciales que la API: las del rol de la instancia.', 'To test with the same credentials as the API: the instance role\'s.')],
    ['get-caller-identity', 'diag', T('Eres assumed-role/tienda-api-role/i-…: la CLI de la instancia usa el rol, no claves guardadas en un fichero.', 'You are assumed-role/tienda-api-role/i-…: the instance\'s CLI uses the role, not keys stored in a file.')],
    ['s3 cp /etc/hostname', 'diag', T('AccessDenied, y el mensaje lo dice todo: no está permitido s3:PutObject sobre arn:aws:s3:::tienda-facturas/pruebas/prueba.txt porque ninguna política lo permite.', 'AccessDenied, and the message says it all: s3:PutObject on arn:aws:s3:::tienda-facturas/pruebas/prueba.txt is not allowed because no policy allows it.')],
    ['exit', '', T('De vuelta a tu equipo: IAM se mira con tus permisos.', 'Back to your workstation: IAM is examined with your permissions.')],
    ['list-attached-role-policies', 'diag', T('El rol lleva tienda-api-facturas (la suya) y la del agente de CloudWatch.', 'The role carries tienda-api-facturas (its own) and the CloudWatch agent one.')],
    ['list-policy-versions', 'diag', T('Hay una v2, creada ayer por la tarde y por defecto. Coincide con el «ajuste de permisos».', 'There is a v2, created yesterday afternoon and set as default. It matches the "permission tightening".')],
    ['--version-id v2', 'diag', T('El recurso es arn:aws:s3:::tienda-facturas: el bucket, no sus objetos. PutObject actúa sobre objetos, así que no casa con nada.', 'The resource is arn:aws:s3:::tienda-facturas: the bucket, not its objects. PutObject acts on objects, so it matches nothing.')],
    ['--version-id v1', 'diag', T('La v1 separaba bien: PutObject y GetObject sobre tienda-facturas/*, ListBucket sobre el bucket.', 'v1 got it right: PutObject and GetObject on tienda-facturas/*, ListBucket on the bucket.')],
    ['set-default-policy-version', 'arreglo', T('Vuelve a la v1 sin dar un permiso más. La v2 queda guardada para que Seguridad vea qué se torció.', 'Goes back to v1 without granting a single extra permission. v2 stays saved so the security team can see what went wrong.')],
    ['ssh app-01', '', T('Otra vez en app-01, para comprobarlo con el rol.', 'Back on app-01, to check it with the role.')],
    ['s3 cp /etc/hostname', 'comprobar', T('upload: la subida funciona. La alarma se apaga en el minuto siguiente.', 'upload: the upload works. The alarm clears within the next minute.')],
    ['exit', '', T('De vuelta a tu equipo.', 'Back to your workstation.')],
  ],
},
'INC-7134': {
  terminos: ['bucket', 'politica-bucket', 'bloqueo-publico', 'presign'],
  pasos: [
    ['describe-alarms', 'diag', T('tienda-s3-public-bucket: tienda-catalogo-backups se puede leer desde internet.', 'tienda-s3-public-bucket: tienda-catalogo-backups can be read from the internet.')],
    ['get-bucket-policy-status', 'diag', T('IsPublic: true. Confirmado.', 'IsPublic: true. Confirmed.')],
    ['get-bucket-policy', 'diag', T('Principal "*" y s3:GetObject sobre todo el bucket: cualquiera, sin credenciales, puede bajarse cualquier fichero.', 'Principal "*" and s3:GetObject on the whole bucket: anyone, without credentials, can download any file.')],
    ['s3 ls', 'diag', T('Qué estaba a la vista: el catálogo y clientes-2026-09-20.csv.gz, con datos personales. Esto hay que notificarlo.', 'What was exposed: the catalogue and clientes-2026-09-20.csv.gz, with personal data. This has to be reported.')],
    ['curl -sI', 'diag', T('200 OK desde fuera, sin firmar nada: lo mismo que vería cualquiera que conociese la URL.', '200 OK from outside, without signing anything: what anyone who knew the URL would see.')],
    ['delete-bucket-policy', 'arreglo', T('Quita la política que lo abría.', 'Removes the policy that opened it.')],
    ['put-public-access-block', 'arreglo', T('Las cuatro opciones del bloqueo de acceso público: ni ACL ni políticas públicas, ahora ni en el futuro.', 'All four public access block settings: no public ACLs or policies, now or in the future.')],
    ['curl -sI', 'comprobar', T('403 Forbidden: cerrado. Al proveedor se le manda una URL firmada que caduca (aws s3 presign).', '403 Forbidden: closed. The supplier gets a presigned URL that expires (aws s3 presign).')],
  ],
},
'INC-7138': {
  terminos: ['bucket', 'versionado'],
  pasos: [
    ['describe-alarms', 'diag', T('tienda-prices-config: la web no puede cargar los precios.', 'tienda-prices-config: the site cannot load the prices.')],
    ['s3 cp s3://tienda-config/precios.json -', 'diag', T('Versión 413 con "productos": 0. El fichero existe, pero vacío de contenido útil.', 'Version 413 with "productos": 0. The file exists, but with nothing useful in it.')],
    ['list-object-versions', 'diag', T('El bucket tiene versionado: la 413 (la actual, de esta mañana) y debajo las anteriores. La de anoche es la buena.', 'The bucket is versioned: 413 (the current one, from this morning) and the earlier ones below it. Last night\'s is the good one.')],
    ['get-object', 'diag', T('Antes de restaurarla, mírala: versión 412, 1873 productos.', 'Before restoring it, look at it: version 412, 1873 products.')],
    ['copy-object', 'arreglo', T('Copia la 412 encima: pasa a ser la versión actual. La 413 sigue en el historial, como prueba del fallo del pipeline.', 'Copies 412 on top: it becomes the current version. 413 stays in the history, as evidence of the pipeline failure.')],
    ['s3 cp s3://tienda-config/precios.json -', 'comprobar', T('Versión 412, 1873 productos. La alarma se apaga en el siguiente minuto.', 'Version 412, 1873 products. The alarm clears within the next minute.')],
  ],
},
'INC-7142': {
  terminos: ['alb', 'target-group', 'health-check', 'fail-open'],
  pasos: [
    ['describe-alarms', 'diag', T('Dos alarmas: tienda-alb-unhealthy-hosts (2 destinos mal) y tienda-web-healthy-hosts (0 sanos).', 'Two alarms: tienda-alb-unhealthy-hosts (2 bad targets) and tienda-web-healthy-hosts (0 healthy).')],
    ['describe-target-groups', 'diag', T('El ARN del target group y su health check: pide /healthz y espera un 200.', 'The target group ARN and its health check: it asks for /healthz and expects a 200.')],
    ['describe-target-health', 'diag', T('Los dos unhealthy con Target.ResponseCodeMismatch: «Health checks failed with these codes: [404]». La máquina contesta, pero no lo que se espera.', 'Both unhealthy with Target.ResponseCodeMismatch: "Health checks failed with these codes: [404]". The machine answers, but not what is expected.')],
    ['curl -I http://tienda-alb', 'diag', T('200 OK a través del balanceador: con todos los destinos mal, el ALB reparte igual («fail-open»). Por eso «la web carga».', '200 OK through the load balancer: with every target unhealthy, the ALB distributes anyway ("fail-open"). That is why "the site loads".')],
    ['ssh web-01', '', T('A pedir lo mismo que pide el balanceador, desde dentro.', 'To ask for what the load balancer asks for, from the inside.')],
    ['localhost/healthz', 'diag', T('404: esa ruta no existe en nginx.', '404: that path does not exist in nginx.')],
    ['localhost/health', 'diag', T('200: la ruta buena es /health. El despliegue cambió el nombre en el target group, no en nginx.', '200: the right path is /health. The deployment changed the name in the target group, not in nginx.')],
    ['exit', '', T('De vuelta a tu equipo.', 'Back to your workstation.')],
    ['modify-target-group', 'arreglo', T('Health check de vuelta a /health.', 'Health check back to /health.')],
    ['wait target-in-service', '', T('Tres aciertos seguidos (unos 2 minutos) hasta que los dos pasan a healthy.', 'Three successes in a row (about 2 minutes) until both become healthy.')],
    ['describe-target-health', 'comprobar', T('Los dos healthy. Las alarmas se apagan.', 'Both healthy. The alarms clear.')],
  ],
},
'INC-7146': {
  terminos: ['clave-acceso', 'iam-usuario', 'region', 'guardduty', 'minimo-privilegio'],
  pasos: [
    ['describe-alarms', 'diag', T('iam-access-key-exposed y guardduty-high-severity: la clave está fuera y ya se ha usado para algo grave.', 'iam-access-key-exposed and guardduty-high-severity: the key is out and has already been used for something serious.')],
    ['update-access-key', 'arreglo', T('Lo primero, cortarla: Inactive. No se borra todavía: inactiva se puede investigar (y reactivar si hiciera falta).', 'First, cut it off: Inactive. Not deleted yet: an inactive key can still be investigated (and reactivated if needed).')],
    ['get-access-key-last-used', 'diag', T('Es de ci-deploy, y su último uso fue EC2 en us-east-1 hace 22 minutos. La tienda no tiene nada en us-east-1.', 'It belongs to ci-deploy, and its last use was EC2 in us-east-1 22 minutes ago. The store has nothing in us-east-1.')],
    ['--region us-east-1', 'diag', T('Tres c5.4xlarge lanzadas hace 21 minutos y sin etiqueta Name: no son vuestras. Son las que GuardDuty ve minando.', 'Three c5.4xlarge launched 21 minutes ago with no Name tag: not yours. They are the ones GuardDuty sees mining.')],
    ['terminate-instances', 'arreglo', T('Fuera, en su región: con --region us-east-1, o AWS diría que no existen.', 'Gone, in their region: with --region us-east-1, or AWS would say they do not exist.')],
    ['create-access-key', 'arreglo', T('La clave nueva para el pipeline (el secreto sólo se ve ahora). Se pone en el gestor de secretos del CI, nunca en un script.', 'The new key for the pipeline (the secret is only shown now). It goes into the CI\'s secret store, never into a script.')],
    ['delete-access-key', 'arreglo', T('Con la nueva en su sitio, la filtrada se borra.', 'With the new one in place, the leaked one is deleted.')],
    ['list-access-keys', 'comprobar', T('ci-deploy tiene una sola clave, la nueva, activa.', 'ci-deploy has a single key, the new one, active.')],
    ['describe-alarms', 'comprobar', T('Ninguna alarma en ALARM. Queda lo de fondo: que el pipeline use un rol en vez de claves de larga duración.', 'No alarm in ALARM. The root issue remains: the pipeline should use a role instead of long-lived keys.')],
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
  { id: 'iam-usuario', t: T('Usuario de IAM', 'IAM user'), d: T('Una identidad con credenciales propias de larga duración (contraseña, claves de acceso). Para personas, mejor con grupos; para máquinas, mejor un rol.', 'An identity with its own long-lived credentials (password, access keys). For people, better through groups; for machines, better a role.') },
  { id: 'iam-rol', t: T('Rol de IAM', 'IAM role'), d: T('Una identidad sin contraseña ni claves fijas: quien la asume recibe credenciales temporales. Es como una instancia, una Lambda o un pipeline deberían hablar con AWS.', 'An identity with no password or fixed keys: whoever assumes it gets temporary credentials. It is how an instance, a Lambda or a pipeline should talk to AWS.') },
  { id: 'perfil-instancia', t: T('Perfil de instancia', 'Instance profile'), d: T('Lo que une un rol a una instancia EC2. Con él, la CLI y los SDK de la máquina obtienen credenciales solos: aws sts get-caller-identity dice assumed-role/ROL/i-…', 'What ties a role to an EC2 instance. With it, the machine\'s CLI and SDKs get credentials by themselves: aws sts get-caller-identity says assumed-role/ROLE/i-…') },
  { id: 'politica-iam', t: T('Política de IAM', 'IAM policy'), d: T('Un documento JSON con sentencias Effect / Action / Resource. Se adjunta a usuarios, grupos o roles. Ojo con Resource: arn:aws:s3:::bucket es el bucket; arn:aws:s3:::bucket/* son sus objetos.', 'A JSON document with Effect / Action / Resource statements. It is attached to users, groups or roles. Watch the Resource: arn:aws:s3:::bucket is the bucket; arn:aws:s3:::bucket/* are its objects.') },
  { id: 'version-politica', t: T('Versiones de una política', 'Policy versions'), d: T('Las políticas propias guardan hasta cinco versiones, y una es la de por defecto. Volver atrás es set-default-policy-version, sin reescribir nada.', 'Customer policies keep up to five versions, and one is the default. Going back is set-default-policy-version, without rewriting anything.') },
  { id: 'implicit-deny', t: T('Denegación implícita', 'Implicit deny'), d: T('En IAM, lo que ninguna política permite está denegado. Un Deny explícito gana siempre a cualquier Allow. simulate-principal-policy te dice qué decide IAM sin probarlo de verdad.', 'In IAM, whatever no policy allows is denied. An explicit Deny always wins over any Allow. simulate-principal-policy tells you what IAM decides without actually trying it.') },
  { id: 'minimo-privilegio', t: T('Mínimo privilegio', 'Least privilege'), d: T('Dar sólo los permisos que hacen falta, sobre los recursos que hacen falta. AmazonS3FullAccess «para que funcione» le da a la API poder para borrar todos los buckets.', 'Grant only the permissions needed, on the resources needed. AmazonS3FullAccess "to make it work" gives the API the power to delete every bucket.') },
  { id: 'clave-acceso', t: T('Clave de acceso', 'Access key'), d: T('AKIA… + un secreto: credenciales de larga duración de un usuario. Si se publican, se cortan al momento (Inactive), se investiga su último uso y se rota: nueva antes de borrar la vieja.', 'AKIA… plus a secret: a user\'s long-lived credentials. If they are published, cut them off at once (Inactive), investigate their last use and rotate them: the new one before deleting the old one.') },
  { id: 'region', t: T('Región', 'Region'), d: T('AWS está partido en regiones independientes (eu-west-1, us-east-1…). La CLI mira sólo la región configurada: lo que se lanzó en otra no aparece si no pones --region.', 'AWS is split into independent regions (eu-west-1, us-east-1…). The CLI only looks at the configured region: whatever was launched in another one does not show up unless you pass --region.') },
  { id: 'guardduty', t: 'GuardDuty', d: T('El detector de amenazas de AWS: analiza el tráfico y la actividad de la cuenta. CryptoCurrency:EC2/BitcoinTool.B significa que una instancia habla con pools de minería.', 'AWS\'s threat detector: it analyses the account\'s traffic and activity. CryptoCurrency:EC2/BitcoinTool.B means an instance is talking to mining pools.') },
  { id: 'bucket', t: 'Bucket (S3)', d: T('Un contenedor de objetos con nombre único en todo AWS. Los objetos se direccionan por clave (facturas/2026/09/F-…pdf); las «carpetas» son sólo prefijos.', 'A container of objects with a name unique across AWS. Objects are addressed by key (facturas/2026/09/F-…pdf); "folders" are just prefixes.') },
  { id: 'politica-bucket', t: T('Política de bucket', 'Bucket policy'), d: T('Una política pegada al bucket que dice quién puede hacer qué con él. Con Principal "*" y s3:GetObject, cualquiera de internet puede leerlo.', 'A policy attached to the bucket saying who can do what with it. With Principal "*" and s3:GetObject, anyone on the internet can read it.') },
  { id: 'bloqueo-publico', t: T('Bloqueo de acceso público', 'Block Public Access'), d: T('Cuatro interruptores (BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets) que impiden que un bucket sea público por mucho que lo diga una ACL o una política. Encendidos, son la red de seguridad.', 'Four switches (BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets) that stop a bucket from being public whatever an ACL or a policy says. Switched on, they are the safety net.') },
  { id: 'presign', t: T('URL firmada (presign)', 'Presigned URL'), d: T('aws s3 presign genera una URL que da acceso a un único objeto durante un tiempo. Es la forma de compartir un fichero con alguien de fuera sin abrir el bucket.', 'aws s3 presign generates a URL that grants access to a single object for a limited time. It is how you share a file with an outsider without opening the bucket.') },
  { id: 'versionado', t: T('Versionado de S3', 'S3 versioning'), d: T('Con él, sobrescribir no destruye: cada subida es una versión nueva y las anteriores siguen ahí. Se restaura copiando la buena encima. Borrar deja un «marcador de borrado», no borra.', 'With it, overwriting does not destroy: every upload is a new version and the previous ones stay. You restore by copying the good one on top. Deleting leaves a "delete marker"; it does not delete.') },
  { id: 'alb', t: T('Balanceador de aplicación (ALB)', 'Application Load Balancer (ALB)'), d: T('Recibe las peticiones HTTP de los clientes en un nombre DNS y las reparte entre los destinos sanos de un target group. Los clientes no ven las instancias.', 'Receives clients\' HTTP requests on a DNS name and spreads them across the healthy targets of a target group. Clients never see the instances.') },
  { id: 'target-group', t: 'Target group', d: T('La lista de destinos (instancias) a los que el balanceador manda tráfico, con su health check. Una instancia nueva no recibe nada hasta que se registra (register-targets).', 'The list of targets (instances) the load balancer sends traffic to, with its health check. A new instance gets nothing until it is registered (register-targets).') },
  { id: 'health-check', t: 'Health check', d: T('La petición que el balanceador hace a cada destino (aquí, GET /health cada 30 s). Tres aciertos seguidos para entrar (healthy), dos fallos para salir. describe-target-health da el motivo de cada fallo.', 'The request the load balancer makes to each target (here, GET /health every 30 s). Three successes in a row to get in (healthy), two failures to drop out. describe-target-health gives the reason for each failure.') },
  { id: 'fail-open', t: 'Fail-open', d: T('Si TODOS los destinos están unhealthy, el ALB no deja de servir: reparte entre todos igual. La web carga, pero a ciegas: es una avería escondida, no un «está bien».', 'If ALL targets are unhealthy, the ALB does not stop serving: it spreads traffic across all of them anyway. The site loads, but blindly: it is a hidden fault, not an "all fine".') },
  { id: 'enable-now', t: 'systemctl enable --now', d: T('Habilita un servicio (arrancará con la máquina) y lo arranca ya, de una vez. start sólo lo arranca ahora: tras el próximo reinicio vuelve a estar caído.', 'Enables a service (it will start with the machine) and starts it right away, in one go. start only starts it now: after the next reboot it is down again.') },
];
})(window.PUESTO = window.PUESTO || {});
