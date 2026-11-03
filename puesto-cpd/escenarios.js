// Puesto CPD · los tickets.
//
// Mismo contrato que los otros puestos: cada ticket declara sus averías (del
// catálogo, averias.js) y, si es una petición o un cambio, un objetivo. Está
// resuelto cuando no queda nada pendiente de las dos cosas y Prometheus no
// tiene ninguna alerta crítica ni de aviso. Se comprueba el ESTADO, nunca qué
// comandos se escribieron; las prácticas se juzgan con el registro.
(function (P) {
'use strict';
const U = P.u, T = P.T, C = P.cpd;

const idx = (st, re, desde) => { for (let i = desde || 0; i < st.registro.length; i++) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const ultimo = (st, re) => { for (let i = st.registro.length - 1; i >= 0; i--) if (!st.registro[i].respuesta && re.test(st.registro[i].cmd)) return i; return -1; };
const usado = (st, re) => idx(st, re) >= 0;
const antes = (st, a, b) => { const i = idx(st, a), j = idx(st, b); return i >= 0 && (j < 0 || i < j); };
const despues = (st, a, b) => { const j = ultimo(st, b); return j >= 0 && idx(st, a, j + 1) >= 0; };
const en = (st, host, re) => st.registro.some(r => !r.respuesta && r.host === host && re.test(r.cmd));
P.ayudasEscenario = { usado, antes, despues, idx, ultimo };

const MATRIZ = { 'alto|alta': 'P1', 'alto|media': 'P2', 'medio|alta': 'P2', 'alto|baja': 'P3', 'medio|media': 'P3', 'bajo|alta': 'P3', 'medio|baja': 'P4', 'bajo|media': 'P4', 'bajo|baja': 'P4' };
const SLA = { P1: 60, P2: 240, P3: 480, P4: 1440 };
P.prioridad = e => { const p = MATRIZ[e.impacto + '|' + e.urgencia]; return { p, sla: SLA[p] }; };

P.funciones = [
  { id: 'incid', titulo: T('Resolución de incidencias N2/N3 en producción', 'L2/L3 incident resolution in production'), corto: T('Incidencias', 'Incidents') },
  { id: 'web', titulo: T('Servidores web, proxies y certificados de los clientes', 'Customer web servers, proxies and certificates'), corto: 'Web · TLS' },
  { id: 'seg', titulo: T('Seguridad y bastionado: SELinux, cortafuegos, sudo y SSH', 'Security and hardening: SELinux, firewall, sudo and SSH'), corto: T('Seguridad', 'Security') },
  { id: 'parcheo', titulo: T('Parcheo y ciclo de vida en varias distribuciones', 'Patching and lifecycle across several distributions'), corto: T('Parcheo', 'Patching') },
  { id: 'auto', titulo: T('Automatización con Ansible', 'Automation with Ansible'), corto: 'Ansible' },
  { id: 'datos', titulo: T('Bases de datos, disco y copias', 'Databases, disk and backups'), corto: T('Datos', 'Data') },
  { id: 'cont', titulo: T('Contenedores en producción', 'Containers in production'), corto: 'Docker' },
];
// Alertas que impiden cerrar: todo lo que no sea informativo.
const alertas = st => P.alertasActivas(st).filter(a => a.sev !== 'info').map(a => T('Sigue activa la alerta ' + a.nombre + (a.host ? ' (' + a.host + ')' : '') + ': ' + a.res, 'Alert ' + a.nombre + (a.host ? ' (' + a.host + ')' : '') + ' is still firing: ' + a.res));
const PORTAL = 'openssl s_client -connect portal.clienteb.com:443 -servername portal.clienteb.com';

P.escenarios = [
// ============================================================================ 1
{
  id: 'INC0041877', clave: 'var-llena', tipo: 'incidente', nivel: 2, area: 'db01 · Ubuntu · PostgreSQL', funciones: ['incid', 'datos'],
  impacto: 'alto', urgencia: 'alta', de: T('ACME (Raúl Pastor, responsable de tienda)', 'ACME (Raúl Pastor, store manager)'),
  asunto: T('No se pueden guardar pedidos: «could not extend file»', 'Orders cannot be saved: "could not extend file"'),
  cuerpo: [T('Desde hace un rato la tienda da error al confirmar cualquier pedido. El mensaje habla de «No space left on device».', 'For a while now the store fails to confirm any order. The message mentions "No space left on device".'),
    T('Nota del CSC: «/var de db01 al 100 %. Hemos borrado /var/log/acme/reportd-debug.log (31 GB) con rm, pero df sigue igual. Escalamos a N2».', 'Service desk note: "/var on db01 at 100 %. We deleted /var/log/acme/reportd-debug.log (31 GB) with rm, but df shows the same. Escalating to L2".')],
  inicio: -50, abierto: -12,
  averias: [{ tipo: 'log-borrado-abierto', hace: 50 }],
  practicas: [
    { t: T('Comparaste df con du: lo que df cuenta y du no ve es un fichero borrado que sigue abierto', 'You compared df with du: what df counts and du cannot see is a deleted file still held open'), ok: st => usado(st, /^(sudo )?df\b/) && usado(st, /^(sudo )?du\b/) },
    { t: T('Encontraste con lsof qué proceso retenía el espacio antes de tocar nada', 'You found with lsof which process was holding the space before touching anything'), ok: st => antes(st, /lsof/, /systemctl (restart|stop) reportd|kill |truncate/) },
    { t: T('Quitaste el debug antes de reiniciar reportd (si no, vuelve a llenarse)', 'You removed debug before restarting reportd (otherwise it fills up again)'), ok: st => antes(st, /sed .*reportd\.conf/, /systemctl restart reportd/) },
    { t: T('Comprobaste que PostgreSQL vuelve a escribir', 'You checked that PostgreSQL can write again'), ok: st => despues(st, /psql .*(INSERT|insert)/, /systemctl restart reportd/) },
  ],
  pistas: [
    T('Entra en db01 y compara df -h con sudo du -xh --max-depth=1 /var | sort -h. Si df dice 100 % y du no suma lo mismo, el espacio lo ocupa algo que du no ve.', 'Log in to db01 and compare df -h with sudo du -xh --max-depth=1 /var | sort -h. If df says 100 % and du does not add up to the same, the space is taken by something du cannot see.'),
    T('Un fichero borrado con rm sigue ocupando sitio mientras un proceso lo tenga abierto. sudo lsof +L1 lista exactamente eso. ¿Qué proceso es, y por qué escribía tanto? cat /etc/reportd/reportd.conf', 'A file deleted with rm keeps taking space while a process has it open. sudo lsof +L1 lists exactly that. Which process is it, and why was it writing so much? cat /etc/reportd/reportd.conf'),
    T('Cambia log_level a info (sudo sed -i \'s/log_level = debug/log_level = info/\' /etc/reportd/reportd.conf) y reinicia reportd: al cerrar el fichero, el espacio vuelve. Luego prueba un INSERT con sudo -u postgres psql -d pedidos -c "...".', 'Set log_level to info (sudo sed -i \'s/log_level = debug/log_level = info/\' /etc/reportd/reportd.conf) and restart reportd: when it closes the file, the space comes back. Then try an INSERT with sudo -u postgres psql -d pedidos -c "...".'),
  ],
  causa: T('reportd seguía en log_level = debug desde el INC0039120 y generó 31 GB de log en /var. El CSC lo borró con rm, pero reportd lo mantenía abierto (lsof +L1 lo enseña como «deleted»): mientras un proceso tenga un fichero abierto, el espacio no se libera. Con /var al 100 %, PostgreSQL no podía escribir.', 'reportd had been on log_level = debug since INC0039120 and produced 31 GB of log in /var. The service desk deleted it with rm, but reportd still had it open (lsof +L1 shows it as "deleted"): while a process holds a file open, its space is not freed. With /var at 100 %, PostgreSQL could not write.'),
  solucion: T('log_level = info en /etc/reportd/reportd.conf y reinicio de reportd: al cerrar el descriptor se liberó el espacio. /var bajó al 40 % y PostgreSQL vuelve a escribir (INSERT de prueba correcto).', 'log_level = info in /etc/reportd/reportd.conf and a reportd restart: closing the descriptor freed the space. /var dropped to 40 % and PostgreSQL writes again (test INSERT OK).'),
  leccion: T('Borrar un log que un proceso tiene abierto no libera nada: sólo le quita el nombre. Por eso df y du no cuadran, y por eso lsof +L1 es la primera herramienta cuando eso pasa. Para vaciar un log en caliente se usa truncate (o se reinicia el proceso), nunca rm. Y la causa de fondo no era el disco: era un debug que nadie revirtió.', 'Deleting a log a process has open frees nothing: it only removes the name. That is why df and du disagree, and why lsof +L1 is the first tool when it happens. To empty a log in place you use truncate (or restart the process), never rm. And the root cause was not the disk: it was a debug setting nobody reverted.'),
  guion: ['amtool alert', 'ssh db01', 'df -h', 'sudo du -xh --max-depth=1 /var | sort -h', 'sudo lsof +L1', 'cat /etc/reportd/reportd.conf', 'sudo sed -i \'s/log_level = debug/log_level = info/\' /etc/reportd/reportd.conf', 'sudo systemctl restart reportd', 'df -h', 'sudo -u postgres psql -d pedidos -c "INSERT INTO prueba VALUES (1)"', 'exit'],
  trampas: [
    { cmds: ['ssh db01', 'sudo systemctl restart reportd', 'exit'], porque: T('el espacio vuelve, pero reportd sigue en debug y lo volverá a llenar', 'the space comes back, but reportd is still on debug and will fill it again') },
    { cmds: ['ssh db01', 'sudo kill 2214', 'exit'], porque: T('matar reportd libera el espacio, pero deja a ACME sin informes', 'killing reportd frees the space, but leaves ACME without reports') },
    { cmds: ['ssh db01', 'sudo truncate -s 0 /proc/2214/fd/7', 'exit'], porque: T('vaciar el descriptor libera el espacio, pero el debug sigue y lo volverá a llenar', 'emptying the descriptor frees the space, but debug is still on and will fill it again') },
  ],
},
// ============================================================================ 2
{
  id: 'INC0041869', clave: 'tienda-502', tipo: 'incidente', nivel: 2, area: 'web01 · Rocky 9 · SELinux', funciones: ['incid', 'web', 'seg'],
  impacto: 'alto', urgencia: 'media', de: T('ACME (Raúl Pastor)', 'ACME (Raúl Pastor)'),
  asunto: T('tienda.acme.es da «502 Bad Gateway» desde la migración', 'tienda.acme.es returns "502 Bad Gateway" since the migration'),
  cuerpo: [T('Desde que el sábado se migró la tienda a la VM nueva (CHG0018840) sólo vemos «502 Bad Gateway». El equipo de desarrollo dice que Tomcat arranca bien.', 'Since the store was migrated to the new VM on Saturday (CHG0018840) we only see "502 Bad Gateway". The development team says Tomcat starts fine.'),
    T('La VM nueva es Rocky 9; la vieja era un CentOS 7 sin SELinux.', 'The new VM is Rocky 9; the old one was a CentOS 7 without SELinux.')],
  inicio: -180, abierto: -25,
  averias: [{ tipo: 'selinux-booleano', hace: 180 }],
  practicas: [
    { t: T('Probaste Tomcat directamente en web01 para saber en qué capa está el fallo', 'You tried Tomcat directly on web01 to find out which layer is failing'), ok: st => usado(st, /curl .*(localhost|127\.0\.0\.1):8080/) },
    { t: T('Buscaste la denegación de SELinux (ausearch) antes de cambiar nada', 'You looked for the SELinux denial (ausearch) before changing anything'), ok: st => antes(st, /ausearch/, /setsebool|setenforce/) },
    { t: T('No desactivaste SELinux ni un momento', 'You did not switch SELinux off, not even for a moment'), ok: st => !usado(st, /setenforce (0|[Pp]ermissive)/) },
    { t: T('Comprobaste desde mgmt01 que la tienda da 200', 'You checked from mgmt01 that the store returns 200'), ok: st => despues(st, /curl .*tienda\.acme\.es/, /setsebool/) },
  ],
  pistas: [
    T('Separa capas. En web01: curl -I http://localhost (pasa por nginx) y curl -I http://localhost:8080 (Tomcat directo). Si Tomcat responde y nginx no, el problema está entre los dos.', 'Separate the layers. On web01: curl -I http://localhost (goes through nginx) and curl -I http://localhost:8080 (Tomcat directly). If Tomcat answers and nginx does not, the problem is between the two.'),
    T('El log de errores del vhost lo dice: sudo tail -n 3 /var/log/nginx/tienda.error.log. Un «13: Permission denied» al conectar, con los dos servicios bien, en Rocky huele a SELinux: sudo ausearch -m avc -ts recent.', 'The vhost error log says it: sudo tail -n 3 /var/log/nginx/tienda.error.log. A "13: Permission denied" when connecting, with both services fine, smells like SELinux on Rocky: sudo ausearch -m avc -ts recent.'),
    T('SELinux no deja a httpd_t (nginx) abrir conexiones de red salvo que lo permita un booleano: getsebool httpd_can_network_connect. Actívalo con sudo setsebool -P httpd_can_network_connect on (-P: que sobreviva al reinicio).', 'SELinux does not let httpd_t (nginx) open network connections unless a boolean allows it: getsebool httpd_can_network_connect. Turn it on with sudo setsebool -P httpd_can_network_connect on (-P: so it survives a reboot).'),
  ],
  causa: T('En la plantilla de Rocky 9 de la migración (CHG0018840) SELinux está en enforcing y el booleano httpd_can_network_connect desactivado. SELinux no deja a nginx abrir la conexión a Tomcat en el 8080 (AVC name_connect), así que nginx contesta 502 aunque los dos servicios funcionan.', 'In the Rocky 9 template used for the migration (CHG0018840) SELinux is enforcing and the httpd_can_network_connect boolean is off. SELinux does not let nginx open the connection to Tomcat on 8080 (AVC name_connect), so nginx answers 502 even though both services work.'),
  solucion: T('setsebool -P httpd_can_network_connect on, manteniendo SELinux en enforcing. La tienda responde 200 desde mgmt01.', 'setsebool -P httpd_can_network_connect on, keeping SELinux in enforcing. The store returns 200 from mgmt01.'),
  leccion: T('Un «Permission denied» entre dos servicios que funcionan por separado, en la familia Red Hat, es SELinux casi siempre. La tentación es setenforce 0: arregla la web y deja el servidor sin la capa que lo protege. Se busca la denegación (ausearch), se entiende qué permiso falta y se da sólo ése, con -P para que no se pierda en el siguiente reinicio.', 'A "Permission denied" between two services that work separately, in the Red Hat family, is nearly always SELinux. The temptation is setenforce 0: it fixes the site and leaves the server without the layer that protects it. Find the denial (ausearch), understand which permission is missing and grant only that one, with -P so it is not lost on the next reboot.'),
  guion: ['curl -I http://tienda.acme.es', 'ssh web01', 'curl -I http://localhost', 'curl -I http://localhost:8080', 'sudo tail -n 3 /var/log/nginx/tienda.error.log', 'sudo ausearch -m avc -ts recent', 'getsebool httpd_can_network_connect', 'sudo setsebool -P httpd_can_network_connect on', 'curl -I http://localhost', 'getenforce', 'exit', 'curl -I http://tienda.acme.es'],
  trampas: [
    { cmds: ['ssh web01', 'sudo setenforce 0', 'exit'], porque: T('setenforce 0 «arregla» la tienda, pero deja web01 sin SELinux', 'setenforce 0 "fixes" the store, but leaves web01 without SELinux') },
    { cmds: ['ssh web01', 'sudo setsebool httpd_can_network_connect on', 'exit'], porque: T('sin -P el cambio se pierde en el próximo reinicio', 'without -P the change is lost on the next reboot') },
  ],
},
// ============================================================================ 3
{
  id: 'INC0041881', clave: 'cert-portal', tipo: 'incidente', nivel: 2, area: 'web02 · SLES · nginx · TLS', funciones: ['incid', 'web'],
  impacto: 'alto', urgencia: 'media', de: T('Cliente B (Elena Ruiz, sistemas)', 'Cliente B (Elena Ruiz, IT)'),
  asunto: T('El portal dice «La conexión no es privada»', 'The portal says "Your connection is not private"'),
  cuerpo: [T('Desde ayer los navegadores muestran un aviso de seguridad al entrar en https://portal.clienteb.com y muchos clientes no siguen. Creemos que el certificado ha caducado.', 'Since yesterday browsers show a security warning when opening https://portal.clienteb.com and many customers stop there. We think the certificate has expired.'),
    T('Seguridad dejó la renovación en /root/renovacion de web02.', 'Security left the renewal in /root/renovacion on web02.')],
  inicio: -2016, abierto: -40,
  averias: [{ tipo: 'cert-caducado', hace: 2016 }],
  practicas: [
    { t: T('Averiguaste qué clave casa con el certificado nuevo comparando el módulo', 'You worked out which key matches the new certificate by comparing the modulus'), ok: st => usado(st, /openssl x509 .*-modulus/) && usado(st, /openssl rsa .*-modulus/) },
    { t: T('nginx -t antes de recargar', 'nginx -t before reloading'), ok: st => usado(st, /systemctl reload nginx|nginx -s reload/) && antes(st, /nginx -t/, /systemctl reload nginx|nginx -s reload/) },
    { t: T('Recargaste nginx (reload) sin reiniciarlo: el portal no se cortó', 'You reloaded nginx (reload) without restarting it: the portal never went down'), ok: st => usado(st, /systemctl reload nginx|nginx -s reload/) && !usado(st, /systemctl restart nginx/) },
    { t: T('Verificaste el certificado servido sin -k (s_client o curl)', 'You verified the served certificate without -k (s_client or curl)'), ok: st => despues(st, /openssl s_client|^curl (?!.*\s-k)(?!.*--insecure).*https:\/\/portal/, /systemctl reload nginx|nginx -s reload/) },
  ],
  pistas: [
    T('Mira qué sirve el portal: ' + PORTAL + ' | openssl x509 -noout -dates. Luego lee lo que dejó Seguridad: sudo ls -l /root/renovacion y sudo cat /root/renovacion/LEEME.txt.', 'Look at what the portal serves: ' + PORTAL + ' | openssl x509 -noout -dates. Then read what Security left: sudo ls -l /root/renovacion and sudo cat /root/renovacion/LEEME.txt.'),
    T('La clave buena es la que tiene el mismo módulo que el certificado: sudo openssl x509 -noout -modulus -in /root/renovacion/portal-2027.crt | openssl md5, y lo mismo con openssl rsa para cada clave.', 'The right key is the one with the same modulus as the certificate: sudo openssl x509 -noout -modulus -in /root/renovacion/portal-2027.crt | openssl md5, and the same with openssl rsa for each key.'),
    T('El .crt lleva el certificado y detrás la intermedia: sudo sh -c "cat portal-2027.crt intermedia.crt > /etc/nginx/ssl/portal.crt" (con rutas completas). La clave, con sudo cp. Después sudo nginx -t y sudo systemctl reload nginx.', 'The .crt holds the certificate followed by the intermediate: sudo sh -c "cat portal-2027.crt intermediate.crt > /etc/nginx/ssl/portal.crt" (with full paths). The key, with sudo cp. Then sudo nginx -t and sudo systemctl reload nginx.'),
  ],
  causa: T('El certificado de portal.clienteb.com venció sin renovarse a tiempo. La renovación estaba en /root/renovacion, con dos claves de las que sólo una correspondía al certificado nuevo.', 'The portal.clienteb.com certificate expired without being renewed in time. The renewal was in /root/renovacion, with two keys of which only one matched the new certificate.'),
  solucion: T('Clave identificada comparando el módulo (clave-b.key casa con portal-2027.crt). Instalados certificado más intermedia en portal.crt y la clave en portal.key; nginx -t correcto y reload sin corte. s_client: Verify return code 0.', 'Key identified by comparing the modulus (clave-b.key matches portal-2027.crt). Certificate plus intermediate installed in portal.crt and the key in portal.key; nginx -t OK and a reload with no downtime. s_client: Verify return code 0.'),
  leccion: T('Un certificado y su clave casan si tienen el mismo módulo: compararlo cuesta un minuto y evita tirar la web. El fichero lleva el certificado del servidor primero y la intermedia detrás, o el navegador no puede verificar la cadena. Y siempre nginx -t antes de reload: con la clave equivocada, reload falla y sigue sirviendo lo viejo; restart deja la web caída. Por cierto: sudo cat a b > fichero falla, porque la redirección la hace tu shell, no sudo.', 'A certificate and its key match when they have the same modulus: comparing it takes a minute and avoids taking the site down. The file holds the server certificate first and the intermediate after it, or the browser cannot verify the chain. And always nginx -t before reload: with the wrong key, reload fails and keeps serving the old one; restart leaves the site down. By the way: sudo cat a b > file fails, because your shell does the redirection, not sudo.'),
  guion: ['curl -I https://portal.clienteb.com', 'ssh web02', PORTAL + ' | openssl x509 -noout -dates', 'sudo ls -l /root/renovacion', 'sudo cat /root/renovacion/LEEME.txt',
    'sudo openssl x509 -noout -modulus -in /root/renovacion/portal-2027.crt | openssl md5', 'sudo openssl rsa -noout -modulus -in /root/renovacion/clave-a.key | openssl md5', 'sudo openssl rsa -noout -modulus -in /root/renovacion/clave-b.key | openssl md5',
    'sudo sh -c "cat /root/renovacion/portal-2027.crt /root/renovacion/intermedia.crt > /etc/nginx/ssl/portal.crt"', 'sudo cp /root/renovacion/clave-b.key /etc/nginx/ssl/portal.key', 'sudo nginx -t', 'sudo systemctl reload nginx',
    PORTAL + ' | grep "Verify return code"', 'exit', 'curl -I https://portal.clienteb.com'],
  trampas: [
    { cmds: ['ssh web02', 'sudo cat /root/renovacion/portal-2027.crt /root/renovacion/intermedia.crt > /etc/nginx/ssl/portal.crt', 'sudo cp /root/renovacion/clave-b.key /etc/nginx/ssl/portal.key', 'sudo systemctl reload nginx', 'exit'], porque: T('la redirección la hace tu shell sin privilegios: portal.crt no cambia y el reload falla con la clave nueva', 'your unprivileged shell does the redirection: portal.crt does not change and the reload fails with the new key') },
    { cmds: ['ssh web02', 'sudo sh -c "cat /root/renovacion/portal-2027.crt /root/renovacion/intermedia.crt > /etc/nginx/ssl/portal.crt"', 'sudo cp /root/renovacion/clave-a.key /etc/nginx/ssl/portal.key', 'sudo systemctl reload nginx', 'exit'], porque: T('con la clave equivocada el reload falla y nginx sigue sirviendo el certificado caducado', 'with the wrong key the reload fails and nginx keeps serving the expired certificate') },
    { cmds: ['ssh web02', 'sudo sh -c "cat /root/renovacion/intermedia.crt /root/renovacion/portal-2027.crt > /etc/nginx/ssl/portal.crt"', 'sudo cp /root/renovacion/clave-b.key /etc/nginx/ssl/portal.key', 'sudo systemctl restart nginx', 'exit'], porque: T('con la intermedia primero nginx compara la clave con la intermedia, no arranca y el portal se cae', 'with the intermediate first nginx compares the key against the intermediate, does not start and the portal goes down') },
    { cmds: ['ssh web02', 'sudo cp /root/renovacion/portal-2027.crt /etc/nginx/ssl/portal.crt', 'sudo cp /root/renovacion/clave-b.key /etc/nginx/ssl/portal.key', 'sudo systemctl reload nginx', 'exit'], porque: T('sin la intermedia, la cadena no se puede verificar (Verify return code 21)', 'without the intermediate, the chain cannot be verified (Verify return code 21)') },
  ],
},
// ============================================================================ 4
{
  id: 'INC0041885', clave: 'facturacion-oom', tipo: 'incidente', nivel: 1, area: 'app01 · Debian · Docker', funciones: ['incid', 'cont'],
  impacto: 'medio', urgencia: 'alta', de: T('ACME (equipo de desarrollo)', 'ACME (development team)'),
  asunto: T('Facturación no responde desde el despliegue de la 4.2.1', 'Billing does not respond since the 4.2.1 deployment'),
  cuerpo: [T('Esta mañana desplegamos la versión 4.2.1 de facturación (caché de clientes nueva). En desarrollo funciona perfectamente, pero en producción /health no contesta.', 'This morning we deployed billing version 4.2.1 (new customer cache). In development it works perfectly, but in production /health does not answer.'),
    T('En los logs no hay ningún error: arranca, carga la caché... y vuelve a empezar.', 'There is no error in the logs: it starts, loads the cache... and starts all over again.')],
  inicio: -95, abierto: -20,
  averias: [{ tipo: 'contenedor-oom', version: '4.2.1', xmx: '512m', hace: 95 }],
  practicas: [
    { t: T('Confirmaste que lo mata la memoria (OOMKilled o dmesg) antes de cambiar nada', 'You confirmed it is killed for memory (OOMKilled or dmesg) before changing anything'), ok: st => antes(st, /docker inspect|dmesg/, /sed .*docker-compose|docker compose up/) },
    { t: T('Aplicaste el cambio recreando con docker compose up -d, no con docker restart', 'You applied the change by recreating with docker compose up -d, not with docker restart'), ok: st => usado(st, /docker compose up/) && !usado(st, /docker restart/) },
    { t: T('Comprobaste /health después del cambio', 'You checked /health after the change'), ok: st => despues(st, /curl .*8090\/health/, /docker compose up/) },
  ],
  pistas: [
    T('En app01: sudo docker ps -a. Un «Restarting (137)» es un contenedor que muere con el código 137: lo mataron (SIGKILL), no se cayó por un error suyo.', 'On app01: sudo docker ps -a. A "Restarting (137)" is a container dying with exit code 137: it was killed (SIGKILL), it did not crash from its own error.'),
    T('¿Quién lo mata? sudo docker inspect -f "{{.State.OOMKilled}}" facturacion, y sudo dmesg | tail -n 3. Luego compara el heap de Java con el límite del contenedor en /opt/facturacion/docker-compose.yml.', 'Who kills it? sudo docker inspect -f "{{.State.OOMKilled}}" facturacion, and sudo dmesg | tail -n 3. Then compare the Java heap with the container limit in /opt/facturacion/docker-compose.yml.'),
    T('Sube mem_limit (sudo sed -i \'s/mem_limit: 256m/mem_limit: 1g/\' /opt/facturacion/docker-compose.yml) y recrea el contenedor desde /opt/facturacion con sudo docker compose up -d. docker restart no lee el fichero.', 'Raise mem_limit (sudo sed -i \'s/mem_limit: 256m/mem_limit: 1g/\' /opt/facturacion/docker-compose.yml) and recreate the container from /opt/facturacion with sudo docker compose up -d. docker restart does not read the file.'),
  ],
  causa: T('La 4.2.1 arranca Java con -Xmx512m (heap de 512 MB) y el contenedor tiene mem_limit 256m. Al cargar la caché, el kernel lo mata por memoria (OOM, código 137, OOMKilled=true) y Docker lo reinicia sin parar. En desarrollo funciona porque allí no hay límite.', '4.2.1 starts Java with -Xmx512m (a 512 MB heap) and the container has mem_limit 256m. When the cache loads, the kernel kills it for memory (OOM, exit code 137, OOMKilled=true) and Docker restarts it endlessly. It works in development because there is no limit there.'),
  solucion: T('mem_limit 1g en docker-compose.yml y docker compose up -d (contenedor recreado). /health responde UP.', 'mem_limit 1g in docker-compose.yml and docker compose up -d (container recreated). /health answers UP.'),
  leccion: T('Un contenedor que se reinicia sin dejar error en el log casi siempre es memoria: el kernel lo mata desde fuera (137, OOMKilled) y la aplicación no llega a escribir nada. El heap de Java tiene que caber, con margen, dentro del límite del contenedor. Y un cambio en el compose no existe hasta que se recrea el contenedor: docker restart arranca el mismo de antes.', 'A container that restarts without leaving an error in its log is nearly always memory: the kernel kills it from outside (137, OOMKilled) and the application never gets to write anything. The Java heap must fit, with room to spare, inside the container limit. And a change in the compose file does not exist until the container is recreated: docker restart starts the same old one.'),
  guion: ['amtool alert', 'ssh app01', 'sudo docker ps -a', 'sudo docker logs --tail 12 facturacion', 'sudo docker inspect -f "{{.State.OOMKilled}}" facturacion', 'sudo dmesg | tail -n 3', 'cat /opt/facturacion/docker-compose.yml', 'sudo sed -i \'s/mem_limit: 256m/mem_limit: 1g/\' /opt/facturacion/docker-compose.yml', 'cd /opt/facturacion', 'sudo docker compose up -d', 'sudo docker ps', 'curl -s http://localhost:8090/health', 'cd', 'exit'],
  trampas: [
    { cmds: ['ssh app01', 'sudo docker restart facturacion', 'exit'], porque: T('reiniciar el mismo contenedor no cambia su límite: sigue muriendo', 'restarting the same container does not change its limit: it keeps dying') },
    { cmds: ['ssh app01', 'sudo sed -i \'s/mem_limit: 256m/mem_limit: 1g/\' /opt/facturacion/docker-compose.yml', 'sudo docker restart facturacion', 'exit'], porque: T('el fichero cambia, pero docker restart no lo lee: hay que recrear con docker compose up -d', 'the file changes, but docker restart does not read it: you must recreate with docker compose up -d') },
  ],
},
// ============================================================================ 5
{
  id: 'REQ0019344', clave: 'csc-ops', tipo: 'peticion', nivel: 1, area: 'app01 · Debian · sudo', funciones: ['seg'],
  impacto: 'medio', urgencia: 'media', de: T('CSC (centro de servicios, Pablo Gil)', 'Service desk (Pablo Gil)'),
  asunto: T('Alta de usuario csc-ops en app01 para reiniciar Tomcat', 'Create user csc-ops on app01 to restart Tomcat'),
  cuerpo: [T('Para no escalar cada vez que el Tomcat de informes se queda colgado, necesitamos un usuario csc-ops en app01, con su home y bash, que pueda ejecutar systemctl restart tomcat como root.', 'So we do not have to escalate every time the reporting Tomcat hangs, we need a user csc-ops on app01, with a home and bash, who can run systemctl restart tomcat as root.'),
    T('Sólo eso: nada de sudo completo.', 'Only that: no full sudo.')],
  inicio: -60, abierto: -60,
  averias: [],
  objetivo: st => {
    const h = st.hosts.app01, u = h.extra.usuarios['csc-ops'], out = [];
    if (!u) return [T('No existe el usuario csc-ops en app01', 'There is no csc-ops user on app01')];
    if (!u.conHome) out.push(T('csc-ops no tiene home (useradd -m)', 'csc-ops has no home directory (useradd -m)'));
    if (u.shell !== '/bin/bash') out.push(T('csc-ops tiene ' + u.shell + ' como shell, no /bin/bash', 'csc-ops has ' + u.shell + ' as its shell, not /bin/bash'));
    const f = h.extra.conf['/etc/sudoers.d/csc-ops'];
    if (!f) out.push(T('No existe /etc/sudoers.d/csc-ops (sudo ignora los nombres con punto)', '/etc/sudoers.d/csc-ops does not exist (sudo ignores names with a dot)'));
    else if (f.modo !== '440') out.push(T('/etc/sudoers.d/csc-ops tiene modo ' + f.modo + ': visudo -c lo da por malo, tiene que ser 0440', '/etc/sudoers.d/csc-ops has mode ' + f.modo + ': visudo -c rejects it, it must be 0440'));
    const reglas = C.reglasDe(h, 'csc-ops');
    if (!reglas.some(r => C.permite(r, ['systemctl', 'restart', 'tomcat']))) out.push(T('csc-ops todavía no puede ejecutar systemctl restart tomcat', 'csc-ops still cannot run systemctl restart tomcat'));
    if (reglas.some(r => C.permite(r, ['systemctl', 'restart', 'nginx']) || C.permite(r, ['bash']))) out.push(T('La regla de csc-ops permite más que reiniciar Tomcat: no es mínimo privilegio', 'csc-ops\' rule allows more than restarting Tomcat: that is not least privilege'));
    return out;
  },
  practicas: [
    { t: T('Validaste sudoers con visudo -c', 'You checked sudoers with visudo -c'), ok: st => en(st, 'app01', /visudo -c/) },
    { t: T('Comprobaste lo que puede hacer con sudo -l -U csc-ops', 'You checked what it can do with sudo -l -U csc-ops'), ok: st => en(st, 'app01', /sudo -l.*csc-ops/) },
    { t: T('Comprobaste antes con getent que el usuario quedó bien (home y shell)', 'You checked with getent that the user came out right (home and shell)'), ok: st => en(st, 'app01', /getent passwd csc-ops|id csc-ops/) },
  ],
  pistas: [
    T('En Debian, useradd sin opciones no crea el home y pone /bin/sh. Usa sudo useradd -m -s /bin/bash csc-ops y compruébalo con getent passwd csc-ops.', 'On Debian, useradd with no options creates no home and sets /bin/sh. Use sudo useradd -m -s /bin/bash csc-ops and check it with getent passwd csc-ops.'),
    T('La regla va en un fichero propio, sin punto en el nombre: sudo visudo -f /etc/sudoers.d/csc-ops. visudo la valida antes de guardar y deja el modo 0440.', 'The rule goes in a file of its own, with no dot in the name: sudo visudo -f /etc/sudoers.d/csc-ops. visudo checks it before saving and sets mode 0440.'),
    T('La línea: csc-ops ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat. Después sudo visudo -c y sudo -l -U csc-ops.', 'The line: csc-ops ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat. Then sudo visudo -c and sudo -l -U csc-ops.'),
  ],
  causa: T('Petición de acceso: el CSC necesita reiniciar el Tomcat de informes sin escalar a N2.', 'Access request: the service desk needs to restart the reporting Tomcat without escalating to L2.'),
  solucion: T('Usuario csc-ops creado en app01 con home y bash. Regla en /etc/sudoers.d/csc-ops, validada con visudo, modo 0440: csc-ops ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat. Comprobado con sudo -l -U csc-ops.', 'User csc-ops created on app01 with a home and bash. Rule in /etc/sudoers.d/csc-ops, checked with visudo, mode 0440: csc-ops ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat. Checked with sudo -l -U csc-ops.'),
  leccion: T('Mínimo privilegio: el comando exacto, con su ruta completa, y nada más. Una regla por fichero en /etc/sudoers.d, siempre con visudo, porque un sudoers roto te deja sin sudo en todo el servidor. Y cuidado con los detalles que no avisan: sudo ignora los ficheros con punto en el nombre, y useradd se comporta distinto en Debian que en Rocky.', 'Least privilege: the exact command, with its full path, and nothing else. One rule per file in /etc/sudoers.d, always through visudo, because a broken sudoers leaves you without sudo on the whole server. And watch the details that give no warning: sudo ignores files with a dot in the name, and useradd behaves differently on Debian than on Rocky.'),
  guion: ['ssh app01', 'sudo useradd -m -s /bin/bash csc-ops', 'getent passwd csc-ops', 'sudo visudo -f /etc/sudoers.d/csc-ops', 'csc-ops ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat', 'sudo visudo -c', 'sudo -l -U csc-ops', 'exit'],
  trampas: [
    { cmds: ['ssh app01', 'sudo useradd csc-ops', 'sudo visudo -f /etc/sudoers.d/csc-ops', 'csc-ops ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat', 'exit'], porque: T('en Debian useradd sin -m no crea el home y deja /bin/sh', 'on Debian useradd without -m creates no home and leaves /bin/sh') },
    { cmds: ['ssh app01', 'sudo useradd -m -s /bin/bash csc-ops', 'echo \'csc-ops ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat\' | sudo tee /etc/sudoers.d/csc-ops', 'exit'], porque: T('con tee el fichero queda en 0644 y visudo -c lo da por malo', 'with tee the file ends up 0644 and visudo -c rejects it') },
    { cmds: ['ssh app01', 'sudo useradd -m -s /bin/bash csc-ops', 'sudo visudo -f /etc/sudoers.d/csc-ops', 'csc-ops ALL=(ALL) NOPASSWD: ALL', 'exit'], porque: T('ALL como comando no es mínimo privilegio', 'ALL as the command is not least privilege') },
    { cmds: ['ssh app01', 'sudo useradd -m -s /bin/bash csc-ops', 'sudo visudo -f /etc/sudoers.d/csc-ops.conf', 'csc-ops ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat', 'exit'], porque: T('sudo ignora los ficheros de /etc/sudoers.d con punto en el nombre', 'sudo ignores files in /etc/sudoers.d with a dot in the name') },
  ],
},
// ============================================================================ 6
{
  id: 'CHG0018851', clave: 'parcheo', tipo: 'cambio', nivel: 2, area: 'web01 (Rocky) · app01 (Debian)', funciones: ['parcheo'],
  impacto: 'medio', urgencia: 'media', de: T('Seguridad (gestión de vulnerabilidades)', 'Security (vulnerability management)'),
  asunto: T('Ventana de parcheo de seguridad: web01 y app01', 'Security patching window: web01 and app01'),
  cuerpo: [T('Ventana aprobada para esta mañana. Aplicad los parches de seguridad pendientes en web01 (Rocky 9) y app01 (Debian 12), kernel incluido, reiniciad si hace falta y comprobad que todo vuelve.', 'Window approved for this morning. Apply the pending security patches on web01 (Rocky 9) and app01 (Debian 12), kernel included, reboot if needed and check that everything comes back.'),
    T('Post-check obligatorio: cada servicio que corría antes, corriendo después.', 'Mandatory post-check: every service that was running before, running afterwards.')],
  inicio: -30, abierto: -30,
  averias: [{ tipo: 'servicio-a-mano', host: 'app01', servicio: 'tomcat' }, { tipo: 'parches-pendientes', host: 'web01' }, { tipo: 'parches-pendientes', host: 'app01' }],
  practicas: [
    { t: T('En app01 hiciste apt update antes de mirar o instalar', 'On app01 you ran apt update before looking or installing'), ok: st => antes(st, /apt(-get)? update/, /apt(-get)? (list|upgrade|full-upgrade|dist-upgrade)/) },
    { t: T('Comprobaste qué está habilitado antes de reiniciar app01', 'You checked what is enabled before rebooting app01'), ok: st => { const r = st.registro.findIndex(x => x.host === 'app01' && /reboot/.test(x.cmd)); return r >= 0 && st.registro.slice(0, r).some(x => x.host === 'app01' && /is-enabled|list-unit-files/.test(x.cmd)); } },
    { t: T('Preguntaste al sistema si hacía falta reiniciar (needs-restarting / reboot-required)', 'You asked the system whether a reboot was needed (needs-restarting / reboot-required)'), ok: st => usado(st, /needs-restarting/) && usado(st, /reboot-required/) },
    { t: T('Tras cada reinicio comprobaste el kernel y los servicios', 'After each reboot you checked the kernel and the services'), ok: st => ['web01', 'app01'].every(n => { const r = st.registro.map((x, i) => ({ x, i })).filter(o => o.x.host === n && /reboot/.test(o.x.cmd)).pop(); return r && st.registro.slice(r.i + 1).some(x => x.host === n && /uname -r/.test(x.cmd)) && st.registro.slice(r.i + 1).some(x => x.host === n && /systemctl (is-active|status)/.test(x.cmd)); }) },
  ],
  pistas: [
    T('Cada familia con lo suyo. En web01 (Rocky): sudo dnf updateinfo list --security y sudo dnf upgrade --security -y. En app01 (Debian): sudo apt update, apt list --upgradable y sudo apt upgrade -y.', 'Each family with its own tools. On web01 (Rocky): sudo dnf updateinfo list --security and sudo dnf upgrade --security -y. On app01 (Debian): sudo apt update, apt list --upgradable and sudo apt upgrade -y.'),
    T('¿Hace falta reiniciar? En Rocky sudo needs-restarting -r; en Debian cat /var/run/reboot-required. Antes de reiniciar, systemctl is-enabled de lo que corre: lo que se arrancó a mano no vuelve solo.', 'Is a reboot needed? On Rocky sudo needs-restarting -r; on Debian cat /var/run/reboot-required. Before rebooting, systemctl is-enabled for whatever runs: what was started by hand does not come back by itself.'),
    T('En app01 el Tomcat está «disabled»: sudo systemctl enable tomcat antes del reinicio. Después de cada sudo reboot, espera (sleep 240), vuelve a entrar y comprueba uname -r y los servicios.', 'On app01 Tomcat is "disabled": sudo systemctl enable tomcat before the reboot. After each sudo reboot, wait (sleep 240), log back in and check uname -r and the services.'),
  ],
  causa: T('Cambio planificado: avisos de seguridad pendientes (kernel, OpenSSL, OpenSSH) en un Rocky y un Debian. La sorpresa estaba en app01: su Tomcat se arrancó a mano en su día y no estaba habilitado, así que no habría vuelto tras el reinicio.', 'Planned change: pending security advisories (kernel, OpenSSL, OpenSSH) on a Rocky and a Debian host. The surprise was on app01: its Tomcat had been started by hand long ago and was not enabled, so it would not have come back after the reboot.'),
  solucion: T('web01: dnf upgrade --security y reinicio con el kernel nuevo. app01: apt update + apt upgrade, Tomcat habilitado antes de reiniciar, reinicio. Post-check: kernels nuevos y todos los servicios en marcha.', 'web01: dnf upgrade --security and a reboot onto the new kernel. app01: apt update + apt upgrade, Tomcat enabled before rebooting, reboot. Post-check: new kernels and every service running.'),
  leccion: T('Parchear es fácil; lo que falla es lo de alrededor. Cada familia tiene su gestor (dnf en Red Hat, apt en Debian, zypper en SUSE) y su forma de decir que hay que reiniciar. Antes del reinicio se mira qué está habilitado, porque lo arrancado a mano no vuelve. Y después se comprueba, no se supone: kernel nuevo y servicios en marcha.', 'Patching is easy; what fails is everything around it. Each family has its own manager (dnf on Red Hat, apt on Debian, zypper on SUSE) and its own way of saying a reboot is needed. Before rebooting, check what is enabled, because things started by hand do not come back. And afterwards check, do not assume: new kernel and services running.'),
  guion: ['ssh web01', 'sudo dnf updateinfo list --security', 'sudo dnf upgrade --security -y', 'sudo needs-restarting -r', 'systemctl is-enabled nginx tomcat', 'sudo reboot', 'sleep 240', 'ssh web01', 'uname -r', 'systemctl is-active nginx tomcat', 'exit',
    'ssh app01', 'sudo apt update', 'apt list --upgradable', 'systemctl is-enabled tomcat', 'sudo systemctl enable tomcat', 'sudo apt upgrade -y', 'cat /var/run/reboot-required', 'sudo reboot', 'sleep 240', 'ssh app01', 'uname -r', 'systemctl status tomcat', 'exit'],
  trampas: [
    { cmds: ['ssh app01', 'sudo apt update', 'sudo apt upgrade -y', 'sudo reboot', 'sleep 240'], porque: T('Tomcat no estaba habilitado: tras el reinicio no vuelve', 'Tomcat was not enabled: after the reboot it does not come back') },
    { cmds: ['ssh app01', 'sudo systemctl enable tomcat', 'sudo apt-get update', 'sudo apt-get upgrade -y', 'sudo reboot', 'sleep 240'], porque: T('apt-get upgrade deja el kernel nuevo «kept back»', 'apt-get upgrade leaves the new kernel "kept back"') },
    { cmds: ['ssh web01', 'sudo dnf upgrade --security -y', 'exit'], porque: T('el kernel nuevo está instalado, pero no se usa hasta reiniciar', 'the new kernel is installed, but it is not used until a reboot') },
  ],
},
// ============================================================================ 7
{
  id: 'CHG0018856', clave: 'ntp-ansible', tipo: 'cambio', nivel: 2, area: 'mgmt01 · Ansible · chrony', funciones: ['auto'],
  impacto: 'bajo', urgencia: 'alta', de: T('Arquitectura (estándares del CPD)', 'Architecture (datacenter standards)'),
  asunto: T('Estandarizar NTP en todo el parque con Ansible', 'Standardise NTP across the whole estate with Ansible'),
  cuerpo: [T('Varios servidores siguen con el NTP de fábrica (el pool público de su distribución) y web03 ni siquiera tiene chrony en marcha. Hay que dejarlos todos contra ntp1/ntp2.cpd.local con el playbook ~/ansible/chrony.yml.', 'Several servers still have the factory NTP setup (their distribution\'s public pool) and web03 does not even have chrony running. They must all point at ntp1/ntp2.cpd.local using the ~/ansible/chrony.yml playbook.'),
    T('Ojo: web02 se reinstaló la semana pasada.', 'Note: web02 was reinstalled last week.')],
  inicio: -4000, abierto: -60,
  averias: [{ tipo: 'sin-clave', host: 'web02' }, { tipo: 'ntp-sin-estandar', hosts: ['web01', 'web02', 'web03', 'db02'], parado: 'web03' }],
  practicas: [
    { t: T('Comprobaste la conectividad (ansible all -m ping) antes de lanzar el playbook', 'You checked connectivity (ansible all -m ping) before running the playbook'), ok: st => antes(st, /ansible all -m ping/, /ansible-playbook (?!.*--check)/) },
    { t: T('Lo simulaste con --check --diff antes de aplicarlo', 'You dry-ran it with --check --diff before applying it'), ok: st => { const p = st.hechos.playbooks; const i = p.findIndex(x => !x.check); return i > 0 && p.slice(0, i).some(x => x.check && !x.unreachable); } },
    { t: T('Una segunda pasada dio changed=0: el playbook es idempotente', 'A second run gave changed=0: the playbook is idempotent'), ok: st => { const p = st.hechos.playbooks.filter(x => !x.check); return p.length >= 2 && p[p.length - 1].changed === 0 && !p[p.length - 1].unreachable; } },
    { t: T('Comprobaste la sincronización en todo el parque al terminar', 'You checked synchronisation across the estate at the end'), ok: st => despues(st, /ansible .*(timedatectl|chronyc)/, /ansible-playbook (?!.*--check)/) },
  ],
  pistas: [
    T('Ansible se lanza desde ~/ansible (ahí está ansible.cfg con el inventario). Empieza por cd ~/ansible y ansible all -m ping: ¿llega a todos?', 'Ansible runs from ~/ansible (that is where ansible.cfg and the inventory live). Start with cd ~/ansible and ansible all -m ping: does it reach every host?'),
    T('web02 se reinstaló y no tiene la clave de mgmt01: ssh-copy-id web02 (te pedirá una contraseña). Luego otro ping.', 'web02 was reinstalled and does not have mgmt01\'s key: ssh-copy-id web02 (it will ask for a password). Then ping again.'),
    T('ansible-playbook chrony.yml --check --diff para ver qué cambiaría, después sin --check, y una segunda vez para ver changed=0. Al final: ansible all -b -m shell -a "timedatectl | grep synchronized".', 'ansible-playbook chrony.yml --check --diff to see what would change, then without --check, and a second time to see changed=0. At the end: ansible all -b -m shell -a "timedatectl | grep synchronized".'),
  ],
  causa: T('Cambio de estandarización: servidores con el NTP de fábrica y chrony parado en web03. Ansible no llegaba a web02 porque al reinstalarlo se perdió la clave pública del nodo de gestión.', 'Standardisation change: servers with the factory NTP setup and chrony stopped on web03. Ansible could not reach web02 because the management node\'s public key was lost when it was reinstalled.'),
  solucion: T('Clave de mgmt01 instalada en web02 con ssh-copy-id. chrony.yml simulado con --check --diff, aplicado y relanzado con changed=0. chrony habilitado y sincronizado en todo el parque.', 'mgmt01\'s key installed on web02 with ssh-copy-id. chrony.yml dry-run with --check --diff, applied and re-run with changed=0. chrony enabled and synchronised across the estate.'),
  leccion: T('Con Ansible se trabaja en tres tiempos: comprobar que llegas a todos, simular (--check --diff) y aplicar. Y una cuarta que demuestra que está bien hecho: la segunda pasada no cambia nada. Si un equipo está «unreachable», el playbook se aplica en los demás y ése se queda atrás: hay que arreglar el acceso y relanzar.', 'With Ansible you work in three steps: check you can reach every host, dry-run (--check --diff) and apply. And a fourth that proves it was done right: the second run changes nothing. If a host is "unreachable", the playbook applies to the rest and that one is left behind: fix the access and run it again.'),
  guion: ['cd ~/ansible', 'cat inventory.ini', 'ansible all -m ping', 'ssh-copy-id web02', 'cambiame', 'ansible all -m ping', 'ansible-playbook chrony.yml --check --diff', 'ansible-playbook chrony.yml', 'ansible-playbook chrony.yml', 'ansible all -b -m shell -a "timedatectl | grep synchronized"', 'cd'],
  trampas: [
    { cmds: ['cd ~/ansible', 'ansible-playbook chrony.yml', 'cd'], porque: T('web02 se queda «unreachable»: el playbook se aplica en los demás, no en él', 'web02 stays "unreachable": the playbook applies to the others, not to it') },
    { cmds: ['ansible-playbook chrony.yml'], porque: T('fuera de ~/ansible no se carga el inventario: no se aplica en ningún sitio', 'outside ~/ansible the inventory is not loaded: it applies nowhere') },
  ],
},
// ============================================================================ 8 (fase 2)
{
  id: 'INC0041890', clave: 'pg-hba', tipo: 'incidente', nivel: 2, area: 'db01 · PostgreSQL · pg_hba.conf', funciones: ['incid', 'datos', 'seg'],
  impacto: 'medio', urgencia: 'alta', de: T('ACME (Raúl Pastor)', 'ACME (Raúl Pastor)'),
  asunto: T('Los informes de ventas no se generan: «pg_hba.conf rejects connection»', 'Sales reports are not being generated: "pg_hba.conf rejects connection"'),
  cuerpo: [T('Desde esta mañana la aplicación de informes (el Tomcat de app01) no conecta con la base de pedidos. El error que vemos es «pg_hba.conf rejects connection for host 10.10.0.31, user informes».', 'Since this morning the reports application (app01\'s Tomcat) cannot connect to the orders database. The error we see is "pg_hba.conf rejects connection for host 10.10.0.31, user informes".'),
    T('Anoche Seguridad aplicó el bastionado SEC-2026-07 en db01.', 'Last night Security applied the SEC-2026-07 hardening on db01.')],
  inicio: -240, abierto: -30,
  averias: [{ tipo: 'pg-hba-sin-regla', hace: 240 }],
  practicas: [
    { t: T('Reprodujiste el error desde app01 antes de tocar db01', 'You reproduced the error from app01 before touching db01'), ok: st => { const i = st.registro.findIndex(r => r.host === 'app01' && /psql .*-h db01/.test(r.cmd)), j = st.registro.findIndex(r => r.host === 'db01' && /sed -i|tee/.test(r.cmd)); return i >= 0 && (j < 0 || i < j); } },
    { t: T('La regla nueva va encima del «reject» y sólo para app01 (/32)', 'The new rule sits above the "reject" and only for app01 (/32)'), ok: st => { const l = C.leer(st.hosts.db01, '/etc/postgresql/14/main/pg_hba.conf') || [], i = l.findIndex(x => /informes\s+10\.10\.0\.31\/32/.test(x)), j = l.findIndex(x => /reject\s*$/.test(x)); return i >= 0 && i < j; } },
    { t: T('Recargaste PostgreSQL (reload) sin reiniciarlo', 'You reloaded PostgreSQL (reload) without restarting it'), ok: st => usado(st, /systemctl reload postgresql|pg_reload_conf/) && !usado(st, /systemctl restart postgresql/) },
    { t: T('Comprobaste desde app01 que informes ya conecta', 'You checked from app01 that informes now connects'), ok: st => { const j = ultimo(st, /systemctl reload postgresql|pg_reload_conf/); return j >= 0 && st.registro.slice(j + 1).some(r => r.host === 'app01' && /psql .*-U informes/.test(r.cmd)); } },
  ],
  pistas: [
    T('Reprodúcelo desde donde falla: en app01, psql -h db01 -U informes -d pedidos -c "SELECT 1". El mensaje dice quién, desde dónde y a qué base.', 'Reproduce it from where it fails: on app01, psql -h db01 -U informes -d pedidos -c "SELECT 1". The message says who, from where and to which database.'),
    T('En db01: sudo cat /etc/postgresql/14/main/pg_hba.conf. Se lee de arriba abajo y gana la primera línea que coincide. ¿Hay alguna para informes antes del «reject» final?', 'On db01: sudo cat /etc/postgresql/14/main/pg_hba.conf. It is read top to bottom and the first matching line wins. Is there one for informes before the final "reject"?'),
    T('Inserta la línea encima del reject: sudo sed -i \'/reject$/i host    pedidos    informes    10.10.0.31/32    scram-sha-256\' /etc/postgresql/14/main/pg_hba.conf, y sudo systemctl reload postgresql. Añadirla al final con tee -a no sirve.', 'Insert the line above the reject: sudo sed -i \'/reject$/i host    pedidos    informes    10.10.0.31/32    scram-sha-256\' /etc/postgresql/14/main/pg_hba.conf, then sudo systemctl reload postgresql. Appending it with tee -a does not work.'),
  ],
  causa: T('El bastionado SEC-2026-07 dejó pg_hba.conf terminando en «host all all 0.0.0.0/0 reject» y se llevó por delante la línea de informes. PostgreSQL aplica la primera línea que coincide: informes desde app01 caía en el reject.', 'The SEC-2026-07 hardening left pg_hba.conf ending in "host all all 0.0.0.0/0 reject" and took the reports line with it. PostgreSQL applies the first matching line: informes from app01 fell into the reject.'),
  solucion: T('Línea «host pedidos informes 10.10.0.31/32 scram-sha-256» insertada encima del reject y reload de PostgreSQL, sin cortar conexiones. Verificado desde app01 con psql.', 'Line "host pedidos informes 10.10.0.31/32 scram-sha-256" inserted above the reject and a PostgreSQL reload, without dropping connections. Checked from app01 with psql.'),
  leccion: T('pg_hba.conf es una lista ordenada: gana la primera línea que coincide. Una regla nueva después de un reject general no hace nada. Y abre lo justo: un usuario, una base, una IP /32; nada de trust ni de redes enteras. Un cambio en el fichero no vale hasta el reload.', 'pg_hba.conf is an ordered list: the first matching line wins. A new rule after a catch-all reject does nothing. And open just enough: one user, one database, one /32 IP; no trust and no whole networks. A change in the file does not count until the reload.'),
  guion: ['amtool alert', 'ssh app01', 'psql -h db01 -U informes -d pedidos -c "SELECT 1"', 'exit', 'ssh db01', 'sudo cat /etc/postgresql/14/main/pg_hba.conf', 'sudo sed -i \'/reject$/i host    pedidos         informes        10.10.0.31/32           scram-sha-256\' /etc/postgresql/14/main/pg_hba.conf', 'sudo cat /etc/postgresql/14/main/pg_hba.conf', 'sudo systemctl reload postgresql', 'exit', 'ssh app01', 'psql -h db01 -U informes -d pedidos -c "SELECT count(*) FROM pedidos"', 'secreto', 'exit'],
  trampas: [
    { cmds: ['ssh db01', 'echo \'host    pedidos         informes        10.10.0.31/32           scram-sha-256\' | sudo tee -a /etc/postgresql/14/main/pg_hba.conf', 'sudo systemctl reload postgresql', 'exit'], porque: T('al final, detrás del reject, la regla nunca se llega a aplicar', 'at the end, after the reject, the rule is never reached') },
    { cmds: ['ssh db01', 'sudo sed -i \'/reject$/i host    pedidos         informes        10.10.0.31/32           scram-sha-256\' /etc/postgresql/14/main/pg_hba.conf', 'exit'], porque: T('sin reload PostgreSQL sigue con lo que cargó', 'without a reload PostgreSQL keeps what it loaded') },
    { cmds: ['ssh db01', 'sudo sed -i \'/reject$/i host    all             all             10.10.0.0/24            trust\' /etc/postgresql/14/main/pg_hba.conf', 'sudo systemctl reload postgresql', 'exit'], porque: T('trust para toda la red abre la base a cualquiera, sin contraseña', 'trust for the whole network opens the database to anyone, without a password') },
  ],
},
// ============================================================================ 9
{
  id: 'INC0041893', clave: 'intranet-403', tipo: 'incidente', nivel: 2, area: 'web03 · Rocky 9 · Apache · SELinux', funciones: ['incid', 'web', 'seg'],
  impacto: 'alto', urgencia: 'media', de: T('Cliente C (Jordi Vidal, desarrollo)', 'Cliente C (Jordi Vidal, development)'),
  asunto: T('La intranet nueva devuelve «403 Forbidden»', 'The new intranet returns "403 Forbidden"'),
  cuerpo: [T('El viernes publicamos la nueva intranet en web03 (rsync del repositorio a /srv/www/intranet) y desde entonces sólo da «403 Forbidden».', 'On Friday we published the new intranet on web03 (rsync from the repository to /srv/www/intranet) and since then it only returns "403 Forbidden".'),
    T('Los permisos están bien: hemos probado incluso con chmod 777 y nada.', 'The permissions are fine: we even tried chmod 777, to no avail.')],
  inicio: -4320, abierto: -35,
  averias: [{ tipo: 'selinux-etiqueta', hace: 4320 }],
  practicas: [
    { t: T('Miraste la etiqueta de los ficheros (ls -Z) antes de cambiar nada', 'You looked at the file labels (ls -Z) before changing anything'), ok: st => antes(st, /ls -[a-zA-Z]*Z/, /semanage|restorecon|chcon|setenforce/) },
    { t: T('Encontraste la denegación con ausearch', 'You found the denial with ausearch'), ok: st => usado(st, /ausearch/) },
    { t: T('El arreglo es persistente (regla fcontext), no un chcon', 'The fix is persistent (an fcontext rule), not a chcon'), ok: st => usado(st, /semanage fcontext -a/) && !usado(st, /chcon/) },
    { t: T('No desactivaste SELinux ni un momento', 'You did not switch SELinux off, not even for a moment'), ok: st => !usado(st, /setenforce (0|[Pp]ermissive)/) },
  ],
  pistas: [
    T('En web03: curl -I http://localhost (403) y sudo tail -n 2 /var/log/httpd/intranet_error.log. «Permission denied» con los permisos Unix bien, en Rocky, apunta a SELinux.', 'On web03: curl -I http://localhost (403) and sudo tail -n 2 /var/log/httpd/intranet_error.log. "Permission denied" with fine Unix permissions, on Rocky, points at SELinux.'),
    T('ls -Z /srv/www/intranet enseña la etiqueta: var_t. Apache sólo lee httpd_sys_content_t. matchpathcon /srv/www/intranet/index.html dice qué etiqueta le daría la política: también var_t, así que restorecon a secas no lo arregla.', 'ls -Z /srv/www/intranet shows the label: var_t. Apache only reads httpd_sys_content_t. matchpathcon /srv/www/intranet/index.html says which label the policy would give it: var_t too, so plain restorecon does not fix it.'),
    T('Primero la regla, luego aplicarla: sudo semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?" y sudo restorecon -Rv /srv/www.', 'First the rule, then apply it: sudo semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?" and sudo restorecon -Rv /srv/www.'),
  ],
  causa: T('La intranet se publicó en /srv/www, fuera de /var/www. Sus ficheros tienen la etiqueta var_t, que httpd no puede leer, y Apache devuelve 403 aunque los permisos Unix estén bien (AVC getattr denegado).', 'The intranet was published in /srv/www, outside /var/www. Its files carry the var_t label, which httpd cannot read, and Apache returns 403 even though Unix permissions are fine (AVC getattr denied).'),
  solucion: T('semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?" y restorecon -Rv /srv/www. SELinux en enforcing; la intranet responde 200.', 'semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?" and restorecon -Rv /srv/www. SELinux in enforcing; the intranet returns 200.'),
  leccion: T('Con SELinux, los permisos Unix son sólo la mitad: un 403 con todo en 777 es una etiqueta. restorecon devuelve lo que dice la política, así que para una ruta nueva primero se cambia la política (semanage fcontext) y luego se aplica. chcon funciona hasta el siguiente restorecon o relabel; por eso no cuenta como arreglo.', 'With SELinux, Unix permissions are only half the story: a 403 with everything at 777 is a label. restorecon restores what the policy says, so for a new path you change the policy first (semanage fcontext) and then apply it. chcon works until the next restorecon or relabel; that is why it does not count as a fix.'),
  guion: ['curl -I http://intranet.clientec.com', 'ssh web03', 'curl -I http://localhost', 'sudo tail -n 2 /var/log/httpd/intranet_error.log', 'ls -Z /srv/www/intranet', 'sudo ausearch -m avc -ts recent', 'matchpathcon /srv/www/intranet/index.html', 'sudo semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?"', 'sudo restorecon -Rv /srv/www', 'ls -Z /srv/www/intranet', 'curl -I http://localhost', 'getenforce', 'exit', 'curl -I http://intranet.clientec.com'],
  trampas: [
    { cmds: ['ssh web03', 'sudo restorecon -Rv /srv/www', 'exit'], porque: T('restorecon sin regla restaura var_t: lo que dice la política', 'restorecon without a rule restores var_t: what the policy says') },
    { cmds: ['ssh web03', 'sudo chcon -R -t httpd_sys_content_t /srv/www', 'exit'], porque: T('chcon arregla el momento, pero el próximo restorecon lo deshace', 'chcon fixes the moment, but the next restorecon undoes it') },
    { cmds: ['ssh web03', 'sudo setenforce 0', 'exit'], porque: T('sin SELinux la intranet funciona, y el servidor queda sin protección', 'without SELinux the intranet works, and the server is left unprotected') },
  ],
},
// ============================================================================ 10
{
  id: 'INC0041897', clave: 'backup-mariadb', tipo: 'incidente', nivel: 2, area: 'db02 · Rocky 9 · MariaDB', funciones: ['incid', 'datos'],
  impacto: 'alto', urgencia: 'media', de: T('Monitorización (Prometheus)', 'Monitoring (Prometheus)'),
  asunto: T('La copia nocturna de MariaDB lleva tres noches vacía', 'The nightly MariaDB backup has been empty for three nights'),
  cuerpo: [T('Salta MariaDBBackupTooSmall: las últimas copias de /backup/mariadb pesan unos bytes. El log del cron dice «OK backup completed» todas las noches.', 'MariaDBBackupTooSmall is firing: the latest copies in /backup/mariadb weigh a few bytes. The cron log says "OK backup completed" every night.'),
    T('Nota de Seguridad: el 20/09 se rotó la contraseña del usuario backup (CHG0018790). La nueva es Bk-Nov2026# (está en el gestor de contraseñas).', 'Note from Security: the backup user\'s password was rotated on 20/09 (CHG0018790). The new one is Bk-Nov2026# (it is in the password manager).')],
  inicio: -3 * 1440 + 400, abierto: -45,
  averias: [{ tipo: 'backup-credenciales', clave: 'Bk-Nov2026#', noches: 3 }],
  practicas: [
    { t: T('Leíste el log del cron en vez de fiarte del «OK»', 'You read the cron log instead of trusting the "OK"'), ok: st => usado(st, /backup-mariadb\.log/) },
    { t: T('Probaste las credenciales con mysql antes de lanzar la copia', 'You tested the credentials with mysql before running the backup'), ok: st => antes(st, /mysql --defaults-extra-file/, /backup-mariadb\.sh/) },
    { t: T('Mantuviste la contraseña nueva: no deshiciste la rotación de Seguridad', 'You kept the new password: you did not undo Security\'s rotation'), ok: st => !usado(st, /ALTER USER/i) },
    { t: T('Comprobaste que la copia nueva se puede leer (gzip -t o zcat)', 'You checked that the new copy can be read (gzip -t or zcat)'), ok: st => despues(st, /gzip -t|zcat/, /backup-mariadb\.sh/) },
  ],
  pistas: [
    T('En db02: sudo ls -lh /backup/mariadb (¿cuánto pesan?) y sudo tail -n 4 /var/log/backup-mariadb.log. El script dice «OK» incluso cuando mysqldump falla: su salida va por una tubería a gzip.', 'On db02: sudo ls -lh /backup/mariadb (how big are they?) and sudo tail -n 4 /var/log/backup-mariadb.log. The script says "OK" even when mysqldump fails: its output goes through a pipe to gzip.'),
    T('Prueba las credenciales que usa: sudo cat /root/.backup.cnf y sudo mysql --defaults-extra-file=/root/.backup.cnf -e "SELECT 1". Un 1045 es usuario o contraseña.', 'Test the credentials it uses: sudo cat /root/.backup.cnf and sudo mysql --defaults-extra-file=/root/.backup.cnf -e "SELECT 1". A 1045 is the user or the password.'),
    T('Pon la contraseña nueva entre comillas, porque en un fichero de opciones # empieza un comentario: sudo sed -i \'s/^password=.*/password="Bk-Nov2026#"/\' /root/.backup.cnf. Luego lanza la copia (sudo /usr/local/bin/backup-mariadb.sh) y compruébala con gzip -t.', 'Put the new password in quotes, because # starts a comment in an option file: sudo sed -i \'s/^password=.*/password="Bk-Nov2026#"/\' /root/.backup.cnf. Then run the backup (sudo /usr/local/bin/backup-mariadb.sh) and check it with gzip -t.'),
  ],
  causa: T('Se rotó la contraseña del usuario backup (CHG0018790) sin actualizar /root/.backup.cnf. mysqldump fallaba con 1045 y, como su salida va por una tubería a gzip, quedaba un fichero de 20 bytes y el script decía «OK».', 'The backup user\'s password was rotated (CHG0018790) without updating /root/.backup.cnf. mysqldump failed with 1045 and, because its output goes through a pipe to gzip, a 20-byte file was left and the script said "OK".'),
  solucion: T('Contraseña nueva entre comillas en /root/.backup.cnf (lleva #, que abre un comentario). Copia lanzada a mano y verificada con gzip -t y zcat.', 'New password in quotes in /root/.backup.cnf (it contains #, which starts a comment). Backup run by hand and checked with gzip -t and zcat.'),
  leccion: T('Que exista un fichero no quiere decir que haya copia: se mira el tamaño y se prueba que se puede leer. Un script con una tubería (mysqldump | gzip) dice «OK» aunque falle el primero si nadie mira su código de salida. Y los ficheros de credenciales entran en el procedimiento de rotación, o la rotación rompe lo que protege.', 'A file existing does not mean there is a backup: check the size and test that it can be read. A script with a pipe (mysqldump | gzip) says "OK" even if the first command fails unless someone checks its exit code. And credential files belong in the rotation procedure, or the rotation breaks what it protects.'),
  guion: ['amtool alert', 'ssh db02', 'cat /etc/cron.d/backup-mariadb', 'sudo tail -n 4 /var/log/backup-mariadb.log', 'sudo ls -lh /backup/mariadb', 'sudo cat /root/.backup.cnf', 'sudo mysql --defaults-extra-file=/root/.backup.cnf -e "SELECT 1"', 'sudo sed -i \'s/^password=.*/password="Bk-Nov2026#"/\' /root/.backup.cnf', 'sudo mysql --defaults-extra-file=/root/.backup.cnf -e "SELECT 1"', 'sudo /usr/local/bin/backup-mariadb.sh', 'sudo ls -lh /backup/mariadb', 'sudo gzip -t /backup/mariadb/all-2026-09-23.sql.gz', 'sudo zcat /backup/mariadb/all-2026-09-23.sql.gz | head -3', 'exit'],
  trampas: [
    { cmds: ['ssh db02', 'sudo sed -i \'s/^password=.*/password=Bk-Nov2026#/\' /root/.backup.cnf', 'sudo /usr/local/bin/backup-mariadb.sh', 'exit'], porque: T('sin comillas, # empieza un comentario y la contraseña queda en «Bk-Nov2026»', 'without quotes, # starts a comment and the password becomes "Bk-Nov2026"') },
    { cmds: ['ssh db02', 'sudo mysql -e "ALTER USER \'backup\'@\'localhost\' IDENTIFIED BY \'Bk-Oct2026!\'"', 'sudo /usr/local/bin/backup-mariadb.sh', 'exit'], porque: T('volver a la contraseña antigua arregla la copia y deshace la rotación de Seguridad', 'going back to the old password fixes the backup and undoes Security\'s rotation') },
    { cmds: ['ssh db02', 'sudo sed -i \'s/^password=.*/password="Bk-Nov2026#"/\' /root/.backup.cnf', 'exit'], porque: T('las credenciales ya funcionan, pero hoy sigue sin haber copia: hay que lanzarla', 'the credentials work now, but there is still no backup today: it must be run') },
  ],
},
// ============================================================================ 11
{
  id: 'INC0041899', clave: 'node-exporter-fw', tipo: 'incidente', nivel: 1, area: 'web01 · Rocky 9 · firewalld', funciones: ['incid', 'seg'],
  impacto: 'medio', urgencia: 'media', de: T('Monitorización (Prometheus)', 'Monitoring (Prometheus)'),
  asunto: T('Prometheus no recoge métricas de web01', 'Prometheus is not collecting metrics from web01'),
  cuerpo: [T('Desde la migración de web01 (CHG0018840) su target de node_exporter sale «down» en Prometheus y TargetDown no deja de sonar. En el propio servidor node_exporter funciona.', 'Since web01\'s migration (CHG0018840) its node_exporter target shows "down" in Prometheus and TargetDown keeps firing. On the server itself node_exporter works.')],
  inicio: -2880, abierto: -50,
  averias: [{ tipo: 'firewall-sin-puerto', host: 'web01' }],
  practicas: [
    { t: T('Comparaste: desde mgmt01 no responde y en local sí', 'You compared: from mgmt01 it does not answer, locally it does'), ok: st => st.registro.some(r => r.host === 'mgmt01' && /curl .*web01:9100/.test(r.cmd)) && st.registro.some(r => r.host === 'web01' && /curl .*localhost:9100/.test(r.cmd)) },
    { t: T('Lo hiciste persistente (--permanent) y lo aplicaste (--reload)', 'You made it persistent (--permanent) and applied it (--reload)'), ok: st => usado(st, /firewall-cmd .*--permanent .*9100|firewall-cmd .*9100.*--permanent/) && despues(st, /firewall-cmd .*--reload/, /firewall-cmd .*--permanent/) },
    { t: T('No paraste firewalld', 'You did not stop firewalld'), ok: st => !usado(st, /systemctl (stop|disable) firewalld/) },
    { t: T('Comprobaste desde mgmt01 al terminar', 'You checked from mgmt01 at the end'), ok: st => { const j = ultimo(st, /firewall-cmd/); return j >= 0 && st.registro.slice(j + 1).some(r => r.host === 'mgmt01' && /curl .*web01:9100/.test(r.cmd)); } },
  ],
  pistas: [
    T('Desde mgmt01: curl -s -m 3 http://web01:9100/metrics. ¿Timeout o refused? Luego en web01: curl -s localhost:9100/metrics | head -3.', 'From mgmt01: curl -s -m 3 http://web01:9100/metrics. Timeout or refused? Then on web01: curl -s localhost:9100/metrics | head -3.'),
    T('Si en local responde y desde fuera hay timeout, es el cortafuegos: sudo firewall-cmd --list-all. ¿Está el 9100?', 'If it answers locally and there is a timeout from outside, it is the firewall: sudo firewall-cmd --list-all. Is 9100 there?'),
    T('sudo firewall-cmd --permanent --add-port=9100/tcp y sudo firewall-cmd --reload: --permanent lo guarda, --reload lo aplica.', 'sudo firewall-cmd --permanent --add-port=9100/tcp and sudo firewall-cmd --reload: --permanent saves it, --reload applies it.'),
  ],
  causa: T('La plantilla de firewalld de la VM nueva (CHG0018840) no abre el 9100 de node_exporter: firewalld descarta los paquetes de Prometheus en silencio.', 'The new VM\'s firewalld template (CHG0018840) does not open node_exporter\'s 9100: firewalld silently drops Prometheus\' packets.'),
  solucion: T('firewall-cmd --permanent --add-port=9100/tcp y --reload: abierto en runtime y en la configuración permanente. Verificado desde mgmt01.', 'firewall-cmd --permanent --add-port=9100/tcp and --reload: open in runtime and in the permanent configuration. Checked from mgmt01.'),
  leccion: T('Un servicio que responde en local y da timeout desde fuera es un cortafuegos. firewalld tiene dos configuraciones: lo que va sin --permanent desaparece en el siguiente reload o reinicio, y lo que va sólo con --permanent no existe hasta el reload. Y parar firewalld «funciona», pero deja el servidor sin cortafuegos.', 'A service that answers locally and times out from outside is a firewall. firewalld has two configurations: anything without --permanent disappears on the next reload or reboot, and anything with --permanent alone does not exist until the reload. And stopping firewalld "works", but leaves the server without a firewall.'),
  guion: ['amtool alert', 'curl -s -m 3 http://web01:9100/metrics', 'ssh web01', 'curl -s localhost:9100/metrics | head -3', 'sudo firewall-cmd --list-all', 'sudo firewall-cmd --permanent --add-port=9100/tcp', 'sudo firewall-cmd --reload', 'sudo firewall-cmd --list-ports', 'exit', 'curl -s http://web01:9100/metrics | head -3'],
  trampas: [
    { cmds: ['ssh web01', 'sudo firewall-cmd --permanent --add-port=9100/tcp', 'exit'], porque: T('sólo --permanent: no cambia nada hasta el --reload', '--permanent alone: nothing changes until the --reload') },
    { cmds: ['ssh web01', 'sudo firewall-cmd --add-port=9100/tcp', 'exit'], porque: T('sin --permanent se pierde en el siguiente reload o reinicio', 'without --permanent it is lost on the next reload or reboot') },
    { cmds: ['ssh web01', 'sudo systemctl stop firewalld', 'exit'], porque: T('sin cortafuegos Prometheus llega, y todo lo demás también', 'without a firewall Prometheus gets in, and so does everything else') },
  ],
},
// ============================================================================ 12
{
  id: 'CHG0018860', clave: 'lvm-var', tipo: 'cambio', nivel: 2, area: 'web01 · Rocky 9 · LVM · XFS', funciones: ['datos'],
  impacto: 'medio', urgencia: 'media', de: T('Capacidad (Marta Soler)', 'Capacity (Marta Soler)'),
  asunto: T('Ampliar /var de web01 a 35 GB con el disco nuevo', 'Extend web01\'s /var to 35 GB with the new disk'),
  cuerpo: [T('/var de web01 pasa del 80 % por los logs de acceso de la tienda. Virtualización ya le ha añadido un disco de 20 GB (/dev/sdb). Hay que dejar /var en 35 GB, en caliente: la tienda no se puede parar.', 'web01\'s /var is over 80 % because of the store\'s access logs. Virtualisation has already added a 20 GB disk (/dev/sdb). /var must end up at 35 GB, online: the store cannot be stopped.')],
  inicio: -600, abierto: -40,
  averias: [{ tipo: 'var-creciendo', pct: 84 }],
  objetivo: st => {
    const h = st.hosts.web01, lv = h.extra.lvm.lvs.var, out = [];
    if (lv.tamG < 35) out.push(T('El volumen rl/var sigue en ' + lv.tamG + ' GB', 'The rl/var volume is still ' + lv.tamG + ' GB'));
    if (h.discos['/var'].tamG < 35) out.push(T('El sistema de ficheros de /var sigue en ' + h.discos['/var'].tamG + ' GB: falta agrandar el XFS', 'The /var filesystem is still ' + h.discos['/var'].tamG + ' GB: the XFS must be grown'));
    if (h.svcs.nginx.estado !== 'active' || !h.up) out.push(T('La tienda no puede pararse: nginx tiene que seguir en marcha', 'The store cannot stop: nginx must keep running'));
    return out;
  },
  practicas: [
    { t: T('Miraste el espacio libre del grupo (vgs) antes de ampliar', 'You checked the group\'s free space (vgs) before extending'), ok: st => antes(st, /\bvgs\b/, /lvextend/) },
    { t: T('Identificaste el disco nuevo con lsblk antes de usarlo', 'You identified the new disk with lsblk before using it'), ok: st => antes(st, /lsblk/, /pvcreate|vgextend/) },
    { t: T('Comprobaste con df que /var ya tiene 35 GB', 'You checked with df that /var now has 35 GB'), ok: st => despues(st, /^df\b/, /lvextend|xfs_growfs/) },
    { t: T('Sin reiniciar ni parar servicios', 'Without rebooting or stopping services'), ok: st => !usado(st, /reboot|systemctl stop/) },
  ],
  pistas: [
    T('En web01: df -h /var, lsblk y sudo vgs. ¿Cuánto libre tiene el grupo rl? ¿Llega para pasar de 20 a 35 GB?', 'On web01: df -h /var, lsblk and sudo vgs. How much free space does the rl group have? Is it enough to go from 20 to 35 GB?'),
    T('Las capas: disco → PV (sudo pvcreate /dev/sdb) → VG (sudo vgextend rl /dev/sdb) → LV → sistema de ficheros.', 'The layers: disk → PV (sudo pvcreate /dev/sdb) → VG (sudo vgextend rl /dev/sdb) → LV → filesystem.'),
    T('sudo lvextend -r -L 35G /dev/rl/var: -r agranda también el XFS. Sin -r, después sudo xfs_growfs /var (resize2fs es para ext4).', 'sudo lvextend -r -L 35G /dev/rl/var: -r grows the XFS too. Without -r, sudo xfs_growfs /var afterwards (resize2fs is for ext4).'),
  ],
  causa: T('Petición de capacidad: /var de web01 se quedaba pequeño y el grupo de volúmenes rl sólo tenía 5 GB libres.', 'Capacity request: web01\'s /var was getting too small and the rl volume group only had 5 GB free.'),
  solucion: T('pvcreate /dev/sdb, vgextend rl /dev/sdb y lvextend -r -L 35G /dev/rl/var: volumen y XFS ampliados en caliente. df: /var 35 GB.', 'pvcreate /dev/sdb, vgextend rl /dev/sdb and lvextend -r -L 35G /dev/rl/var: volume and XFS extended online. df: /var 35 GB.'),
  leccion: T('LVM son capas, y cada una se amplía con su comando: el disco se convierte en PV, el PV entra en el VG, el LV crece dentro del VG y, al final, el sistema de ficheros crece dentro del LV. Si df no cambia, falta la última capa. XFS se agranda en caliente con xfs_growfs (pero nunca encoge); ext4 usa resize2fs.', 'LVM is layers, and each one grows with its own command: the disk becomes a PV, the PV joins the VG, the LV grows inside the VG and, finally, the filesystem grows inside the LV. If df does not change, the last layer is missing. XFS grows online with xfs_growfs (but never shrinks); ext4 uses resize2fs.'),
  guion: ['ssh web01', 'df -h /var', 'lsblk', 'sudo vgs', 'sudo pvcreate /dev/sdb', 'sudo vgextend rl /dev/sdb', 'sudo lvextend -r -L 35G /dev/rl/var', 'df -h /var', 'sudo pvs', 'exit'],
  trampas: [
    { cmds: ['ssh web01', 'sudo lvextend -r -L 35G /dev/rl/var', 'exit'], porque: T('el grupo sólo tiene 5 GB libres: sin añadir el disco no hay sitio', 'the group only has 5 GB free: without adding the disk there is no room') },
    { cmds: ['ssh web01', 'sudo vgextend rl /dev/sdb', 'sudo lvextend -L 35G /dev/rl/var', 'exit'], porque: T('el volumen crece, pero el XFS no: df sigue diciendo 20 GB', 'the volume grows, but the XFS does not: df still says 20 GB') },
    { cmds: ['ssh web01', 'sudo vgextend rl /dev/sdb', 'sudo lvextend -L 35G /dev/rl/var', 'sudo resize2fs /dev/rl/var', 'exit'], porque: T('resize2fs es para ext4: en un XFS falla', 'resize2fs is for ext4: it fails on XFS') },
  ],
},
// ============================================================================ 13
{
  id: 'CHG0018862', clave: 'ssh-base', tipo: 'cambio', nivel: 3, area: 'web02 · SLES · sshd', funciones: ['seg'],
  impacto: 'medio', urgencia: 'media', de: T('Seguridad (auditoría SEC-2026-09)', 'Security (audit SEC-2026-09)'),
  asunto: T('Aplicar la línea base de SSH en web02', 'Apply the SSH baseline on web02'),
  cuerpo: [T('La auditoría marca web02 (reinstalado la semana pasada) sin la línea base de SSH. Hay que dejar en /etc/ssh/sshd_config: PermitRootLogin no, PasswordAuthentication no, X11Forwarding no y MaxAuthTries 3.', 'The audit flags web02 (reinstalled last week) as missing the SSH baseline. /etc/ssh/sshd_config must end up with: PermitRootLogin no, PasswordAuthentication no, X11Forwarding no and MaxAuthTries 3.'),
    T('Cuidado: si quitas las contraseñas y tu clave no está, te quedas fuera.', 'Careful: if you remove passwords and your key is not there, you lock yourself out.')],
  inicio: -10080, abierto: -60,
  averias: [{ tipo: 'sin-clave', host: 'web02' }],
  objetivo: st => {
    const h = st.hosts.web02, o = h.extra.sshd, f = C.leerSshd(h), out = [];
    if (f.root !== 'no' || f.passwd || f.x11 || f.maxAuth > 3) out.push(T('/etc/ssh/sshd_config de web02 todavía no tiene la línea base completa', 'web02\'s /etc/ssh/sshd_config does not have the full baseline yet'));
    else if (o.root !== 'no' || o.passwd || o.x11 || o.maxAuth > 3) out.push(T('sshd de web02 no ha recargado la configuración nueva', 'sshd on web02 has not reloaded the new configuration'));
    if (h.svcs.ssh.estado !== 'active') out.push(T('sshd no está en marcha en web02', 'sshd is not running on web02'));
    return out;
  },
  practicas: [
    { t: T('Instalaste tu clave antes de quitar las contraseñas', 'You installed your key before removing passwords'), ok: st => antes(st, /ssh-copy-id web02/, /systemctl (reload|restart) sshd?/) },
    { t: T('Validaste con sshd -t antes de recargar', 'You validated with sshd -t before reloading'), ok: st => usado(st, /systemctl (reload|restart) sshd?/) && antes(st, /sshd -t/, /systemctl (reload|restart) sshd?/) },
    { t: T('Comprobaste que entras con tu clave después del cambio', 'You checked that you get in with your key after the change'), ok: st => despues(st, /^ssh web02/, /systemctl (reload|restart) sshd?/) },
    { t: T('No te hizo falta la consola de emergencia', 'You did not need the emergency console'), ok: st => !st.hechos['console:web02'] },
  ],
  pistas: [
    T('Antes de nada: ¿entras en web02 con tu clave? ssh web02 te pide contraseña, así que no. Instálala desde mgmt01: ssh-copy-id web02.', 'First of all: do you get into web02 with your key? ssh web02 asks for a password, so no. Install it from mgmt01: ssh-copy-id web02.'),
    T('En web02, cambia las cuatro líneas de /etc/ssh/sshd_config con sed (puedes encadenar -e) y valida con sudo sshd -t antes de recargar.', 'On web02, change the four lines of /etc/ssh/sshd_config with sed (you can chain -e) and validate with sudo sshd -t before reloading.'),
    T('sudo systemctl reload sshd aplica la configuración sin cortar tu sesión. Sal y vuelve a entrar con ssh web02 para comprobar que la clave funciona. Si te quedaras fuera: console web02 desde mgmt01.', 'sudo systemctl reload sshd applies the configuration without dropping your session. Log out and back in with ssh web02 to check your key works. If you got locked out: console web02 from mgmt01.'),
  ],
  causa: T('web02 se reinstaló con la plantilla de SSH por defecto (root y contraseñas permitidos) y sin la clave del nodo de gestión.', 'web02 was reinstalled with the default SSH template (root and passwords allowed) and without the management node\'s key.'),
  solucion: T('Clave de mgmt01 instalada con ssh-copy-id; PermitRootLogin no, PasswordAuthentication no, X11Forwarding no y MaxAuthTries 3 en sshd_config; sshd -t correcto y reload. Comprobado el acceso con clave.', 'mgmt01\'s key installed with ssh-copy-id; PermitRootLogin no, PasswordAuthentication no, X11Forwarding no and MaxAuthTries 3 in sshd_config; sshd -t OK and reload. Key login checked.'),
  leccion: T('Al endurecer SSH, el orden lo es todo: primero la clave, después quitar las contraseñas. sshd -t valida antes de aplicar, reload no corta la sesión en la que estás, y se comprueba abriendo otra antes de cerrar la que tienes. Si te quedas fuera, queda la consola del hipervisor, pero eso ya es un incidente.', 'When hardening SSH, order is everything: the key first, then remove passwords. sshd -t validates before applying, reload does not drop the session you are in, and you check by opening another one before closing yours. If you lock yourself out, there is the hypervisor console, but by then it is an incident.'),
  guion: ['ssh-copy-id web02', 'cambiame', 'ssh web02', 'sudo cat /etc/ssh/sshd_config', 'sudo sed -i -e \'s/^PermitRootLogin .*/PermitRootLogin no/\' -e \'s/^PasswordAuthentication .*/PasswordAuthentication no/\' -e \'s/^X11Forwarding .*/X11Forwarding no/\' -e \'s/^MaxAuthTries .*/MaxAuthTries 3/\' /etc/ssh/sshd_config', 'sudo sshd -t', 'sudo systemctl reload sshd', 'exit', 'ssh web02', 'sudo sshd -T', 'exit'],
  trampas: [
    { cmds: ['console web02', 'sed -i -e \'s/^PermitRootLogin .*/PermitRootLogin no/\' -e \'s/^PasswordAuthentication .*/PasswordAuthentication no/\' -e \'s/^X11Forwarding .*/X11Forwarding no/\' -e \'s/^MaxAuthTries .*/MaxAuthTries 3/\' /etc/ssh/sshd_config', 'systemctl reload sshd', 'exit'], porque: T('sin tu clave en web02, quitar las contraseñas te deja fuera: ni tú ni Ansible podéis entrar', 'without your key on web02, removing passwords locks you out: neither you nor Ansible can get in') },
    { cmds: ['ssh-copy-id web02', 'cambiame', 'ssh web02', 'sudo sed -i -e \'s/^PermitRootLogin .*/PermitRootLogin no/\' -e \'s/^PasswordAuthentication .*/PasswordAuthentication no/\' -e \'s/^X11Forwarding .*/X11Forwarding no/\' -e \'s/^MaxAuthTries .*/MaxAuthTries 3/\' /etc/ssh/sshd_config', 'exit'], porque: T('el fichero cambia, pero sshd sigue con la configuración que cargó', 'the file changes, but sshd keeps the configuration it loaded') },
  ],
},
];

// ------------------------------------------------------------------ uso
P.normalizarEscenario = e => {
  e.averias = e.averias || [];
  if (!e.aplicar) e.aplicar = st => P.aplicarAverias(st, e.averias);
  e.resuelto = st => P.pendientesAverias(st, e.averias).concat(e.objetivo ? e.objetivo(st, P) : [], alertas(st));
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
