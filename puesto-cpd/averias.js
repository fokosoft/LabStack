// Puesto CPD · catálogo de averías.
//
// El mismo contrato que en los otros puestos: cada tipo sabe romper el CPD
// (aplicar), decir lo que sigue roto (pendientes), arreglarse con comandos de
// verdad desde mgmt01 (arreglo), comprobar sus parámetros (validar) y qué toca
// (para no combinar dos averías sobre lo mismo). Los tickets se componen con
// esto, y es lo que más adelante permite guardias e incidencias en fichero.
(function (P) {
'use strict';
const U = P.u, T = P.T, C = P.cpd;
P.averias = {};
const def = (id, o) => { P.averias[id] = Object.assign({ id, orden: 2, condicion: false, params: {}, toca: () => [], pendientes: () => [], arreglo: () => [], validar: () => null }, o); };
const hace = a => (a.hace != null ? a.hace : 30);
const pHace = T('minutos desde que empezó la avería', 'minutes since the fault started');
const SERVIDORES = ['web01', 'web02', 'web03', 'app01', 'db01', 'db02'];
const ssh = (h, cmds) => ['ssh ' + h].concat(cmds, ['exit']);

// ------------------------------------------------------------------ disco
def('log-borrado-abierto', {
  titulo: T('Un log borrado que sigue ocupando el disco', 'A deleted log that still fills the disk'),
  descripcion: T('reportd se quedó en log_level = debug y llenó /var de db01. Alguien borró el log con rm, pero reportd lo tiene abierto: el espacio no vuelve y PostgreSQL no puede escribir.', 'reportd was left on log_level = debug and filled db01\'s /var. Someone deleted the log with rm, but reportd still has it open: the space does not come back and PostgreSQL cannot write.'),
  params: { hace: pHace }, ejemplo: { hace: 50 },
  toca: () => ['db01:/var', 'db01:reportd'],
  aplicar: (st, a) => {
    const h = st.hosts.db01, conf = h.extra.conf['/etc/reportd/reportd.conf'];
    conf.lineas = conf.lineas.map(l => /^log_level/.test(l) ? 'log_level = debug' : l);
    h.extra.reportd.nivel = 'debug';
    const libreMB = (h.discos['/var'].tamG - U.usadoG(h, '/var')) * 1024;
    h.extra.abiertos.push({ pid: h.extra.reportd.pid, proc: 'reportd', user: 'report', fd: 7, ruta: '/var/log/acme/reportd-debug.log', mb: Math.ceil(libreMB) + 64 });
    U.logSvc(h, 'reportd', -hace(a) - 40 * 1440, 'reportd[' + h.extra.reportd.pid + ']', 'log_level changed to debug (INC0039120)');
  },
  pendientes: st => {
    const h = st.hosts.db01, out = [], p = U.pctDisco(h, '/var');
    if (p >= 90) out.push(T('/var de db01 sigue al ' + p + ' %: PostgreSQL no puede escribir', 'db01\'s /var is still at ' + p + ' %: PostgreSQL cannot write'));
    if (h.svcs.reportd.estado !== 'active') out.push(T('reportd está parado: los informes de ACME no se generan', 'reportd is stopped: ACME\'s reports are not being generated'));
    else if (h.extra.reportd.nivel === 'debug') out.push(T('reportd sigue en log_level = debug: volverá a llenar el disco', 'reportd is still on log_level = debug: it will fill the disk again'));
    if (C.nivelReportd(h) === 'debug') out.push(T('/etc/reportd/reportd.conf sigue diciendo log_level = debug', '/etc/reportd/reportd.conf still says log_level = debug'));
    return out;
  },
  arreglo: () => ssh('db01', ['sudo sed -i \'s/log_level = debug/log_level = info/\' /etc/reportd/reportd.conf', 'sudo systemctl restart reportd']),
});

// ------------------------------------------------------------------ SELinux y web
def('selinux-booleano', {
  titulo: T('SELinux no deja a nginx hablar con Tomcat', 'SELinux does not let nginx talk to Tomcat'),
  descripcion: T('En la plantilla de Rocky 9 httpd_can_network_connect viene desactivado: nginx no puede abrir la conexión a Tomcat (8080) y la tienda da 502.', 'In the Rocky 9 template httpd_can_network_connect is off: nginx cannot open the connection to Tomcat (8080) and the store returns 502.'),
  params: { hace: pHace }, ejemplo: { hace: 180 },
  toca: () => ['web01:selinux'],
  aplicar: st => { st.hosts.web01.extra.se.bools.httpd_can_network_connect = { v: false, p: false }; },
  pendientes: st => {
    const h = st.hosts.web01, out = [], r = C.http(st, P.entrada, 'http://tienda.acme.es/', {});
    if (r.err || r.codigo !== 200) out.push(T('tienda.acme.es sigue sin dar 200 (' + (r.err ? r.err.msg : 'HTTP ' + r.codigo) + ')', 'tienda.acme.es still does not return 200 (' + (r.err ? r.err.msg : 'HTTP ' + r.codigo) + ')'));
    if (!C.enforcing(h)) out.push(T('SELinux de web01 no está en enforcing: desactivarlo no es una solución', 'SELinux on web01 is not in enforcing: switching it off is not a fix'));
    else if (!h.extra.se.bools.httpd_can_network_connect.p) out.push(T('httpd_can_network_connect no es persistente: el próximo reinicio devuelve el 502', 'httpd_can_network_connect is not persistent: the next reboot brings the 502 back'));
    return out;
  },
  arreglo: () => ssh('web01', ['sudo setsebool -P httpd_can_network_connect on']),
});
def('cert-caducado', {
  titulo: T('Un certificado caducado, con la renovación sin instalar', 'An expired certificate, with the renewal not installed'),
  descripcion: T('El certificado de portal.clienteb.com venció. El nuevo está en /root/renovacion de web02 con dos claves: sólo una casa con él, y hay que servirlo con la intermedia.', 'The portal.clienteb.com certificate expired. The new one is in /root/renovacion on web02 with two keys: only one matches it, and it must be served with the intermediate.'),
  params: { hace: pHace }, ejemplo: { hace: 2016 },
  toca: () => ['web02:tls'],
  aplicar: st => {
    const h = st.hosts.web02;
    h.extra.conf['/etc/nginx/ssl/portal.crt'].lineas = C.pemCert('portal-2026').concat(C.pemCert('intermedia'));
    h.extra.conf['/etc/nginx/ssl/portal.key'].lineas = C.pemClave('A');
    h.extra.nginx = { cadena: ['portal-2026', 'intermedia'], clave: 'A' };
    h.extra.dirs['/root/renovacion'] = true;
    C.ficheroBase(h, '/root/renovacion/portal-2027.crt', C.pemCert('portal-2027'), '644');
    C.ficheroBase(h, '/root/renovacion/intermedia.crt', C.pemCert('intermedia'), '644');
    C.ficheroBase(h, '/root/renovacion/clave-a.key', C.pemClave('A'), '600');
    C.ficheroBase(h, '/root/renovacion/clave-b.key', C.pemClave('B'), '600');
    C.ficheroBase(h, '/root/renovacion/LEEME.txt', [T('Renovación portal.clienteb.com (pedido CERT-2291)', 'Renewal portal.clienteb.com (order CERT-2291)'), T('- portal-2027.crt: el certificado nuevo, emitido por la CA', '- portal-2027.crt: the new certificate, issued by the CA'), T('- intermedia.crt: la intermedia de la CA (va detrás del certificado)', '- intermedia.crt: the CA intermediate (goes after the certificate)'), T('- clave-a.key / clave-b.key: generamos dos CSR con prisas y no sé cuál se envió. Comprobadlo antes de instalar.', '- clave-a.key / clave-b.key: we generated two CSRs in a hurry and I do not know which one was sent. Check before installing.'), '-- Marta (Seguridad)'], '644');
  },
  pendientes: st => {
    const h = st.hosts.web02;
    if (!h.up || h.svcs.nginx.estado !== 'active') return [T('nginx de web02 no está en marcha: el portal de Cliente B está caído', 'nginx on web02 is not running: Cliente B\'s portal is down')];
    const t = C.tlsServido(st, h, 'portal.clienteb.com');
    return t.error ? [T('portal.clienteb.com: ' + t.error, 'portal.clienteb.com: ' + t.error)] : [];
  },
  arreglo: () => ssh('web02', ['sudo sh -c "cat /root/renovacion/portal-2027.crt /root/renovacion/intermedia.crt > /etc/nginx/ssl/portal.crt"', 'sudo cp /root/renovacion/clave-b.key /etc/nginx/ssl/portal.key', 'sudo nginx -t', 'sudo systemctl reload nginx']),
});

// ------------------------------------------------------------------ contenedores
def('contenedor-oom', {
  titulo: T('Un contenedor con más heap que memoria', 'A container with more heap than memory'),
  descripcion: T('La versión nueva de facturación arranca Java con un heap mayor que el mem_limit del contenedor: el kernel lo mata (OOM, 137) y Docker lo vuelve a arrancar sin parar.', 'The new billing version starts Java with a heap bigger than the container\'s mem_limit: the kernel kills it (OOM, 137) and Docker restarts it over and over.'),
  params: { version: T('la versión que se desplegó', 'the version that was deployed'), xmx: T('el heap de Java (512m, 768m...)', 'the Java heap (512m, 768m...)'), hace: pHace }, ejemplo: { version: '4.2.1', xmx: '512m', hace: 95 },
  toca: () => ['app01:facturacion'],
  validar: (st, a) => !/^\d+[mg]$/.test(a.xmx || '') ? T('xmx tiene que ser como 512m o 1g', 'xmx must look like 512m or 1g') : !/^\d+\.\d+\.\d+$/.test(a.version || '') ? T('version tiene que ser como 4.2.1', 'version must look like 4.2.1') : null,
  aplicar: (st, a) => {
    const h = st.hosts.app01;
    h.extra.conf['/opt/facturacion/docker-compose.yml'].lineas = C.compose(a.version, '-Xmx' + a.xmx, '256m');
    C.recrear(st, h, -hace(a));
    const c = h.extra.docker.c.facturacion; c.reinicios = Math.max(1, hace(a) + 3); c.oom = true;
    for (let i = 0; i < 3; i++) h.dmesg.push('[' + (8640 + i * 41).toFixed(6).padStart(12) + '] Memory cgroup out of memory: Killed process ' + U.pid('java' + i) + ' (java) total-vm:3489212kB, anon-rss:259884kB, file-rss:21012kB, shmem-rss:0kB, UID:1000 pgtables:812kB oom_score_adj:0');
  },
  pendientes: st => {
    const h = st.hosts.app01;
    if (C.contenedorVivo(h, 'facturacion')) return [];
    return [C.contenedorReiniciando(h, 'facturacion') ? T('facturacion sigue reiniciándose (OOMKilled): el heap no cabe en mem_limit', 'facturacion keeps restarting (OOMKilled): the heap does not fit in mem_limit') : T('facturacion no está en marcha', 'facturacion is not running')];
  },
  arreglo: () => ssh('app01', ['sudo sed -i \'s/mem_limit: 256m/mem_limit: 1g/\' /opt/facturacion/docker-compose.yml', 'cd /opt/facturacion', 'sudo docker compose up -d', 'cd']),
});

// ------------------------------------------------------------------ servicios y parches
def('servicio-a-mano', {
  titulo: T('Un servicio arrancado a mano, sin habilitar', 'A service started by hand, not enabled'),
  descripcion: T('Funciona, pero nadie lo habilitó: en el próximo reinicio no vuelve.', 'It works, but nobody enabled it: on the next reboot it will not come back.'),
  orden: 1,
  params: { host: T('el servidor', 'the server'), servicio: T('el servicio', 'the service') }, ejemplo: { host: 'app01', servicio: 'tomcat' },
  toca: a => [a.host + ':' + a.servicio],
  validar: (st, a) => !st.hosts[a.host] || !st.hosts[a.host].svcs[a.servicio] ? T('ese servicio no existe en ese servidor', 'that service does not exist on that server') : null,
  aplicar: (st, a) => { st.hosts[a.host].svcs[a.servicio].enabled = false; },
  pendientes: (st, a) => {
    const s = st.hosts[a.host].svcs[a.servicio], out = [];
    if (s.estado !== 'active') out.push(T(a.servicio + ' no está en marcha en ' + a.host, a.servicio + ' is not running on ' + a.host));
    if (!s.enabled) out.push(T(a.servicio + ' de ' + a.host + ' no está habilitado: no volvería tras un reinicio', a.servicio + ' on ' + a.host + ' is not enabled: it would not come back after a reboot'));
    return out;
  },
  arreglo: a => ssh(a.host, ['sudo systemctl enable --now ' + a.servicio]),
});
// Los parches de seguridad que trae la ventana: con kernel, así que hay que reiniciar.
const PARCHES = {
  rh: [{ n: 'kernel', de: '5.14.0-427.13.1.el9_4', a: '5.14.0-427.42.1.el9_4', sec: true, imp: 'Important', aviso: 'RLSA-2026:8812', kernel: true, kernelNuevo: '5.14.0-427.42.1.el9_4.x86_64', mb: 5.1 }, { n: 'openssl-libs', de: '1:3.0.7-27.el9', a: '1:3.0.7-29.el9_4', sec: true, imp: 'Important', aviso: 'RLSA-2026:8790', mb: 2.2 }, { n: 'openssh-server', de: '8.7p1-38.el9', a: '8.7p1-38.el9_4.4', sec: true, imp: 'Moderate', aviso: 'RLSA-2026:8803', mb: 0.5 }],
  debian: [{ n: 'linux-image-amd64', de: '6.1.119-1', a: '6.1.123-1', sec: true, kernel: true, kernelNuevo: '6.1.0-29-amd64', paquete: 'linux-image-6.1.0-29-amd64' }, { n: 'openssl', de: '3.0.15-1~deb12u1', a: '3.0.16-1~deb12u1', sec: true }, { n: 'libssl3', de: '3.0.15-1~deb12u1', a: '3.0.16-1~deb12u1', sec: true }, { n: 'tzdata', de: '2024b-0+deb12u1', a: '2025a-0+deb12u1', sec: false }],
  ubuntu: [{ n: 'linux-image-generic', de: '5.15.0.125.123', a: '5.15.0.130.128', sec: true, kernel: true, kernelNuevo: '5.15.0-130-generic', paquete: 'linux-image-5.15.0-130-generic' }, { n: 'openssl', de: '3.0.2-0ubuntu1.18', a: '3.0.2-0ubuntu1.19', sec: true }],
  suse: [{ n: 'kernel-default', de: '5.14.21-150500.55.65.1', a: '5.14.21-150500.55.88.1', sec: true, imp: 'important', kernel: true, kernelNuevo: '5.14.21-150500.55.88-default' }, { n: 'libopenssl3', de: '3.0.8-150500.5.42.1', a: '3.0.8-150500.5.45.1', sec: true, imp: 'important' }],
};
C.parches = h => JSON.parse(JSON.stringify(PARCHES[C.fam(h) === 'debian' ? C.distro(h).id : C.fam(h)]));
def('parches-pendientes', {
  titulo: T('Parches de seguridad pendientes (con kernel)', 'Pending security patches (with a kernel)'),
  descripcion: T('Avisos de seguridad sin aplicar, kernel incluido: hay que parchear con el gestor de su familia y reiniciar.', 'Unapplied security advisories, kernel included: patch with the family\'s package manager and reboot.'),
  orden: 3,
  params: { host: T('el servidor', 'the server') }, ejemplo: { host: 'web01' },
  toca: a => [a.host + ':paquetes'],
  validar: (st, a) => SERVIDORES.indexOf(a.host) < 0 ? T('host: ' + SERVIDORES.join(', '), 'host: ' + SERVIDORES.join(', ')) : null,
  aplicar: (st, a) => { const h = st.hosts[a.host]; h.extra.pk.act = C.parches(h); },
  pendientes: (st, a) => {
    const h = st.hosts[a.host], out = [], k = C.parches(h).find(p => p.kernel);
    const sec = h.extra.pk.act.filter(p => p.sec).length;
    if (sec) out.push(T(a.host + ' tiene ' + sec + ' parches de seguridad sin aplicar', a.host + ' has ' + sec + ' security patches not applied'));
    else if (h.kernel !== k.kernelNuevo) out.push(T(a.host + ' sigue con el kernel viejo (' + h.kernel + '): falta reiniciar', a.host + ' is still running the old kernel (' + h.kernel + '): it needs a reboot'));
    if (h.up) Object.keys(h.svcs).forEach(u => { if (h.svcs[u].enabled && h.svcs[u].estado !== 'active') out.push(T(u + ' no volvió en ' + a.host, u + ' did not come back on ' + a.host)); });
    return out;
  },
  arreglo: (a, st) => {
    const h = st.hosts[a.host], f = C.fam(h);
    const pk = f === 'rh' ? ['sudo dnf upgrade --security -y'] : f === 'suse' ? ['sudo zypper refresh', 'sudo zypper patch -y'] : ['sudo apt update', 'sudo apt upgrade -y'];
    return ['ssh ' + a.host].concat(pk, ['sudo reboot', 'sleep 240', 'ssh ' + a.host, 'uname -r', 'exit']);
  },
});

// ------------------------------------------------------------------ acceso y Ansible
def('sin-clave', {
  titulo: T('Un servidor sin la clave de mgmt01', 'A server without mgmt01\'s key'),
  descripcion: T('Su authorized_keys no tiene la clave del nodo de gestión: ssh pide contraseña y Ansible no llega.', 'Its authorized_keys lacks the management node\'s key: ssh asks for a password and Ansible cannot reach it.'),
  orden: 1,
  params: { host: T('el servidor', 'the server') }, ejemplo: { host: 'web02' },
  toca: a => [a.host + ':clave'],
  validar: (st, a) => SERVIDORES.indexOf(a.host) < 0 ? T('host: ' + SERVIDORES.join(', '), 'host: ' + SERVIDORES.join(', ')) : null,
  aplicar: (st, a) => { st.hosts[a.host].extra.claveMgmt = false; },
  pendientes: (st, a) => st.hosts[a.host].extra.claveMgmt ? [] : [T('mgmt01 no puede entrar en ' + a.host + ' con su clave: Ansible no llega', 'mgmt01 cannot log in to ' + a.host + ' with its key: Ansible cannot reach it')],
  arreglo: a => ['ssh-copy-id ' + a.host, 'cambiame'],
});
def('ntp-sin-estandar', {
  titulo: T('Servidores con el NTP de fábrica', 'Servers with the factory NTP setup'),
  descripcion: T('chrony apunta al pool público de cada distribución (o ni siquiera está en marcha) en vez de a los NTP del CPD.', 'chrony points at each distribution\'s public pool (or is not even running) instead of the datacenter\'s NTP servers.'),
  params: { hosts: T('los servidores (lista)', 'the servers (list)'), parado: T('uno en el que además chrony está parado y deshabilitado (opcional)', 'one where chrony is also stopped and disabled (optional)') }, ejemplo: { hosts: ['web01', 'web02', 'web03', 'db02'], parado: 'web03' },
  toca: a => a.hosts.map(h => h + ':ntp'),
  validar: (st, a) => !Array.isArray(a.hosts) || !a.hosts.length || a.hosts.some(h => SERVIDORES.indexOf(h) < 0) ? T('hosts: una lista de ' + SERVIDORES.join(', '), 'hosts: a list of ' + SERVIDORES.join(', ')) : a.parado && a.hosts.indexOf(a.parado) < 0 ? T('parado tiene que estar en hosts', 'parado must be one of hosts') : null,
  aplicar: (st, a) => {
    a.hosts.forEach(n => { st.hosts[n].extra.ntpConf = 'pool'; });
    if (a.parado) { const h = st.hosts[a.parado]; P.parado(st, h, 'chrony', -4000, true); h.ntp.offset = 0.412; h.ntp.deriva = 0.0004; }
  },
  pendientes: (st, a) => [].concat(...a.hosts.map(n => {
    const h = st.hosts[n], s = h.svcs.chrony, out = [];
    if (h.extra.ntpConf !== 'estandar') out.push(T(n + ' usa el pool público, no los NTP del CPD', n + ' uses the public pool, not the datacenter NTP servers'));
    if (s.estado !== 'active' || !s.enabled) out.push(T('chrony no está habilitado y en marcha en ' + n, 'chrony is not enabled and running on ' + n));
    return out;
  })),
  arreglo: () => ['cd ~/ansible', 'ansible-playbook chrony.yml', 'cd'],
});

// ------------------------------------------------------------------ fase 2
def('pg-hba-sin-regla', {
  titulo: T('pg_hba.conf sin la regla de una aplicación', 'pg_hba.conf without an application\'s rule'),
  descripcion: T('Tras un bastionado, pg_hba.conf termina en un «reject» general y ya no tiene la línea de informes: PostgreSQL rechaza la conexión desde app01.', 'After hardening, pg_hba.conf ends in a catch-all "reject" and no longer has the reports line: PostgreSQL rejects the connection from app01.'),
  params: { hace: pHace }, ejemplo: { hace: 240 },
  toca: () => ['db01:pg_hba'],
  aplicar: st => { const h = st.hosts.db01, c = h.extra.conf['/etc/postgresql/14/main/pg_hba.conf']; c.lineas = c.lineas.filter(l => !/\binformes\b/.test(l)); h.extra.hbaCargado = C.pgHba(h); },
  pendientes: st => {
    const out = [], ip = st.hosts.app01.ip;
    if (C.pgPermite(st, ip, 'informes', 'pedidos') === 'reject') out.push(T('PostgreSQL sigue rechazando a informes desde app01', 'PostgreSQL still rejects informes from app01'));
    const r = st.hosts.db01.extra.hbaCargado || [];
    if (r.some(x => x[0] === 'host' && x[4] === 'trust')) out.push(T('pg_hba.conf tiene una regla trust: entra cualquiera sin contraseña', 'pg_hba.conf has a trust rule: anyone gets in without a password'));
    if (r.some(x => x[0] === 'host' && (x[2] === 'informes' || x[2] === 'all') && x[4] !== 'reject' && x[3] !== '10.10.0.31/32' && x[3] !== '127.0.0.1/32')) out.push(T('La regla de informes abre más de lo pedido: tiene que ser sólo app01 (10.10.0.31/32)', 'The informes rule opens more than asked: it must be app01 only (10.10.0.31/32)'));
    if (C.pgHba(st.hosts.db01).length !== r.length || JSON.stringify(C.pgHba(st.hosts.db01)) !== JSON.stringify(r)) out.push(T('pg_hba.conf cambió en disco pero PostgreSQL no lo ha recargado', 'pg_hba.conf changed on disk but PostgreSQL has not reloaded it'));
    return out;
  },
  arreglo: () => ssh('db01', ['sudo sed -i \'/reject$/i host    pedidos         informes        10.10.0.31/32           scram-sha-256\' /etc/postgresql/14/main/pg_hba.conf', 'sudo systemctl reload postgresql']),
});
def('selinux-etiqueta', {
  titulo: T('Contenido web con la etiqueta de SELinux equivocada', 'Web content with the wrong SELinux label'),
  descripcion: T('La intranet se publicó en /srv/www sin regla de SELinux: los ficheros son var_t, Apache no puede leerlos y devuelve 403 aunque los permisos Unix estén bien.', 'The intranet was published in /srv/www without an SELinux rule: the files are var_t, Apache cannot read them and returns 403 even though the Unix permissions are fine.'),
  params: { hace: pHace }, ejemplo: { hace: 4320 },
  toca: () => ['web03:selinux'],
  aplicar: st => { const se = st.hosts.web03.extra.se; se.fcontext = se.fcontext.filter(r => r.re !== '/srv/www(/.*)?'); ['/srv/www', '/srv/www/intranet', '/srv/www/intranet/index.html'].forEach(p => { se.etiquetas[p] = 'var_t'; }); },
  pendientes: st => {
    const h = st.hosts.web03, out = [], r = C.http(st, P.entrada, 'http://intranet.clientec.com/', {});
    if (r.err || r.codigo !== 200) out.push(T('intranet.clientec.com sigue sin dar 200 (' + (r.err ? r.err.msg : 'HTTP ' + r.codigo) + ')', 'intranet.clientec.com still does not return 200 (' + (r.err ? r.err.msg : 'HTTP ' + r.codigo) + ')'));
    if (!C.enforcing(h)) out.push(T('SELinux de web03 no está en enforcing', 'SELinux on web03 is not in enforcing'));
    else if (C.politica(h, '/srv/www/intranet/index.html') !== 'httpd_sys_content_t') out.push(T('La etiqueta no es persistente: sin una regla semanage fcontext, el próximo restorecon la devuelve a var_t', 'The label is not persistent: without a semanage fcontext rule, the next restorecon puts var_t back'));
    return out;
  },
  arreglo: () => ssh('web03', ['sudo semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?"', 'sudo restorecon -Rv /srv/www']),
});
def('backup-credenciales', {
  titulo: T('Copia nocturna con credenciales caducadas', 'Nightly backup with stale credentials'),
  descripcion: T('Seguridad rotó la contraseña del usuario backup de MariaDB y nadie actualizó /root/.backup.cnf: mysqldump falla con 1045, pero el script deja un .gz de 20 bytes y dice «OK».', 'Security rotated the MariaDB backup user\'s password and nobody updated /root/.backup.cnf: mysqldump fails with 1045, but the script leaves a 20-byte .gz and says "OK".'),
  params: { clave: T('la contraseña nueva (si lleva #, la lección es doble)', 'the new password (with a #, the lesson is twice as good)'), noches: T('noches seguidas fallando', 'nights in a row failing') }, ejemplo: { clave: 'Bk-Nov2026#', noches: 3 },
  toca: () => ['db02:backup'],
  validar: (st, a) => !a.clave || /["'\s]/.test(a.clave) ? T('clave sin comillas ni espacios', 'clave with no quotes or spaces') : !(a.noches >= 1 && a.noches <= 4) ? T('noches entre 1 y 4', 'noches between 1 and 4') : null,
  aplicar: (st, a) => { const h = st.hosts.db02; h.extra.mariadb.claveBackup = a.clave; h.extra.mariadb.rotada = a.clave; h.extra.copias.slice(-a.noches).forEach(c => { c.mb = 0.00002; }); },
  pendientes: (st, a) => {
    const h = st.hosts.db02, out = [], u = h.extra.copias[h.extra.copias.length - 1];
    if (h.extra.mariadb.claveBackup !== a.clave) out.push(T('La contraseña de backup ya no es la que puso Seguridad: se ha deshecho la rotación', 'The backup password is no longer the one Security set: the rotation has been undone'));
    else if (!C.authBackup(st, h)) out.push(T('/root/.backup.cnf sigue sin funcionar: la copia de esta noche volverá a fallar', '/root/.backup.cnf still does not work: tonight\'s backup will fail again'));
    if (!u || u.mb < 1) out.push(T('La última copia de db02 sigue vacía: hoy no hay copia de MariaDB', 'db02\'s latest backup is still empty: there is no MariaDB backup today'));
    return out;
  },
  arreglo: a => ssh('db02', ['sudo sed -i \'s/^password=.*/password="' + a.clave + '"/\' /root/.backup.cnf', 'sudo /usr/local/bin/backup-mariadb.sh']),
});
def('firewall-sin-puerto', {
  titulo: T('El cortafuegos no deja pasar a Prometheus', 'The firewall does not let Prometheus through'),
  descripcion: T('La plantilla de firewalld de un servidor no abre el 9100 de node_exporter: en local responde, desde mgmt01 no.', 'A server\'s firewalld template does not open node_exporter\'s 9100: it answers locally, not from mgmt01.'),
  params: { host: T('el servidor (Rocky o SUSE)', 'the server (Rocky or SUSE)') }, ejemplo: { host: 'web01' },
  toca: a => [a.host + ':firewall'],
  validar: (st, a) => !st.hosts[a.host] || !st.hosts[a.host].extra.fw ? T('host tiene que ser un servidor con firewalld: ' + C.hostsDe('rh').concat(C.hostsDe('suse')).join(', '), 'host must be a server with firewalld: ' + C.hostsDe('rh').concat(C.hostsDe('suse')).join(', ')) : null,
  aplicar: (st, a) => { const fw = st.hosts[a.host].extra.fw; ['runtime', 'perm'].forEach(k => { fw[k].puertos = fw[k].puertos.filter(p => p !== '9100/tcp'); }); },
  pendientes: (st, a) => {
    const h = st.hosts[a.host], out = [], ip = st.hosts.mgmt01.ip;
    if (h.svcs.firewalld.estado !== 'active') return [T('firewalld está parado en ' + a.host + ': el servidor se ha quedado sin cortafuegos', 'firewalld is stopped on ' + a.host + ': the server has been left without a firewall')];
    if (!C.fwPermite(st, h, 9100, ip)) out.push(T('Prometheus sigue sin llegar a ' + a.host + ':9100', 'Prometheus still cannot reach ' + a.host + ':9100'));
    else { const run = h.extra.fw.runtime; h.extra.fw.runtime = h.extra.fw.perm; const p = C.fwPermite(st, h, 9100, ip); h.extra.fw.runtime = run; if (!p) out.push(T('El 9100 está abierto sólo en runtime: el próximo reload o reinicio lo vuelve a cerrar', 'Port 9100 is open in runtime only: the next reload or reboot closes it again')); }
    return out;
  },
  arreglo: a => ssh(a.host, ['sudo firewall-cmd --permanent --add-port=9100/tcp', 'sudo firewall-cmd --reload']),
});
def('var-creciendo', {
  titulo: T('Un /var que se queda pequeño', 'A /var that is getting too small'),
  descripcion: T('Los logs de acceso crecen y /var de web01 pasa del 80 %: hay que ampliarlo (condición del cambio de LVM).', 'Access logs grow and web01\'s /var goes over 80 %: it needs to be extended (a condition for the LVM change).'),
  condicion: true, params: { pct: T('porcentaje de uso', 'usage percentage') }, ejemplo: { pct: 84 },
  toca: () => ['web01:/var'],
  validar: (st, a) => !(a.pct >= 50 && a.pct <= 95) ? T('pct entre 50 y 95', 'pct between 50 and 95') : null,
  aplicar: (st, a) => { const h = st.hosts.web01; h.logs['/var/log/nginx/tienda.access.log'] = Math.max(0, (h.discos['/var'].tamG * a.pct / 100 - U.usadoG(h, '/var') - 0.05) * 1024); },
});

// ------------------------------------------------------------------ fase 3: averías genéricas (guardias y caos)
// Lo que puede caerse, y lo que arrastra al caer: Tomcat de web01 tira la tienda, PostgreSQL los pedidos y los informes...
C.SERVICIOS_CAIBLES = [['web01', 'nginx'], ['web01', 'tomcat'], ['web02', 'nginx'], ['web03', 'httpd'], ['app01', 'docker'], ['app01', 'tomcat'], ['db01', 'postgresql'], ['db01', 'reportd'], ['db02', 'mariadb']];
P.motivos['cpd-killed'] = { result: 'signal', proceso: '(code=killed, signal=KILL)', journal: (st, h, u, m) => [{ min: m, src: 'kernel', t: 'Out of memory: Killed process ' + U.pid(h.nombre + u + m) + ' (' + U.binario(u) + ') total-vm:2841220kB, anon-rss:1712344kB' }, { min: m, src: 'systemd[1]', t: u + '.service: Main process exited, code=killed, status=9/KILL' }] };
def('servicio-caido', {
  titulo: T('Un servicio caído', 'A service down'),
  descripcion: T('El kernel mató el proceso por memoria y systemd lo dejó en failed. Arrastra lo que depende de él.', 'The kernel killed the process for memory and systemd left it in failed. It drags down whatever depends on it.'),
  params: { host: T('el servidor', 'the server'), servicio: T('el servicio', 'the service'), hace: pHace }, ejemplo: { host: 'web01', servicio: 'tomcat', hace: 25 },
  toca: a => [a.host + ':' + a.servicio],
  validar: (st, a) => !C.SERVICIOS_CAIBLES.some(x => x[0] === a.host && x[1] === a.servicio) ? T('host y servicio tienen que ser uno de: ' + C.SERVICIOS_CAIBLES.map(x => x.join('/')).join(', '), 'host and service must be one of: ' + C.SERVICIOS_CAIBLES.map(x => x.join('/')).join(', ')) : null,
  aplicar: (st, a) => P.fallar(st, a.host, a.servicio, 'cpd-killed', -hace(a)),
  pendientes: (st, a) => st.hosts[a.host].svcs[a.servicio].estado === 'active' ? [] : [T(a.servicio + ' no está en marcha en ' + a.host, a.servicio + ' is not running on ' + a.host)],
  arreglo: a => ssh(a.host, ['sudo systemctl restart ' + a.servicio]),
});
// Un log enorme y sin dueño (nadie lo tiene abierto): aquí du sí lo encuentra.
C.LOGS_GIGANTES = { web03: '/var/log/httpd/intranet_access_log.1', db02: '/var/log/mariadb/mariadb-slow.log', app01: '/var/log/informes/informes-api.log.1' };
def('log-gigante', {
  titulo: T('Un log rotado que llena el disco', 'A rotated log that fills the disk'),
  descripcion: T('Un log que ya nadie escribe ocupa casi todo el disco. du lo encuentra; se vacía con truncate o se borra.', 'A log nobody writes to any more takes up almost the whole disk. du finds it; empty it with truncate or delete it.'),
  params: { host: T('web03, db02 o app01', 'web03, db02 or app01') }, ejemplo: { host: 'web03' },
  toca: a => [a.host + ':/'],
  validar: (st, a) => !C.LOGS_GIGANTES[a.host] ? T('host: ' + Object.keys(C.LOGS_GIGANTES).join(', '), 'host: ' + Object.keys(C.LOGS_GIGANTES).join(', ')) : null,
  aplicar: (st, a) => { const h = st.hosts[a.host]; h.logs[C.LOGS_GIGANTES[a.host]] = Math.max(0, (h.discos['/'].tamG * 0.96 - U.usadoG(h, '/')) * 1024); },
  pendientes: (st, a) => { const p = U.pctDisco(st.hosts[a.host], '/'); return p >= 90 ? [T('/ de ' + a.host + ' sigue al ' + p + ' %', a.host + '\'s / is still at ' + p + ' %')] : []; },
  arreglo: a => ssh(a.host, ['sudo truncate -s 0 ' + C.LOGS_GIGANTES[a.host]]),
});
def('reloj-parado', {
  titulo: T('Un reloj que se va', 'A clock that drifts away'),
  descripcion: T('chrony parado y el reloj adelantado medio segundo: los certificados, los logs y Kerberos empiezan a fallar.', 'chrony stopped and the clock half a second ahead: certificates, logs and Kerberos start to fail.'),
  params: { host: T('el servidor', 'the server') }, ejemplo: { host: 'db01' },
  toca: a => [a.host + ':ntp'],
  validar: (st, a) => SERVIDORES.indexOf(a.host) < 0 ? T('host: ' + SERVIDORES.join(', '), 'host: ' + SERVIDORES.join(', ')) : null,
  aplicar: (st, a) => { const h = st.hosts[a.host]; P.parado(st, h, 'chrony', -300); h.ntp.offset = 0.62; h.ntp.deriva = 0.0003; },
  pendientes: (st, a) => U.ntpOk(st.hosts[a.host]) ? [] : [T('El reloj de ' + a.host + ' no está sincronizado', a.host + '\'s clock is not synchronised')],
  arreglo: (a, st) => ssh(a.host, ['sudo systemctl start ' + U.visible(st.hosts[a.host], 'chrony'), 'sudo chronyc makestep']),
});

// ------------------------------------------------------------------ campos del compositor
P.camposAveria = {
  'log-borrado-abierto': [{ k: 'hace', t: 'num', def: 50 }],
  'selinux-booleano': [{ k: 'hace', t: 'num', def: 180 }],
  'cert-caducado': [{ k: 'hace', t: 'num', def: 2016 }],
  'contenedor-oom': [{ k: 'version', t: 'texto', def: '4.2.1' }, { k: 'xmx', t: 'texto', def: '512m' }, { k: 'hace', t: 'num', def: 95 }],
  'servicio-a-mano': [{ k: 'host', t: 'opciones', opciones: SERVIDORES }, { k: 'servicio', t: 'texto' }],
  'parches-pendientes': [{ k: 'host', t: 'opciones', opciones: SERVIDORES }],
  'sin-clave': [{ k: 'host', t: 'opciones', opciones: SERVIDORES }],
  'ntp-sin-estandar': [{ k: 'hosts', t: 'lista', opciones: SERVIDORES }, { k: 'parado', t: 'opciones', opciones: SERVIDORES, opcional: true }],
  'pg-hba-sin-regla': [{ k: 'hace', t: 'num', def: 240 }],
  'selinux-etiqueta': [{ k: 'hace', t: 'num', def: 4320 }],
  'backup-credenciales': [{ k: 'clave', t: 'texto', def: 'Bk-Nov2026#' }, { k: 'noches', t: 'num', def: 3 }],
  'firewall-sin-puerto': [{ k: 'host', t: 'opciones', opciones: ['web01', 'web02', 'web03', 'db02'] }],
  'var-creciendo': [{ k: 'pct', t: 'num', def: 84 }],
  'servicio-caido': [{ k: 'host', t: 'opciones', opciones: SERVIDORES }, { k: 'servicio', t: 'texto' }, { k: 'hace', t: 'num', def: 25 }],
  'log-gigante': [{ k: 'host', t: 'opciones', opciones: ['web03', 'db02', 'app01'] }],
  'reloj-parado': [{ k: 'host', t: 'opciones', opciones: SERVIDORES }],
};

// ------------------------------------------------------------------ incidencias en fichero y compositor (fase 4)
// Lo que el cargador compartido (../puesto-linux/incidencias.js) necesita saber de este puesto:
// de cada tipo, su función del puesto, su área y dónde hay que mirar (la segunda pista).
const META = {
  'log-borrado-abierto': ['datos', T('PostgreSQL · disco', 'PostgreSQL · disk'), 'db01 (/var)'],
  'selinux-booleano': ['seg', 'SELinux', T('web01 (nginx → Tomcat)', 'web01 (nginx → Tomcat)')],
  'cert-caducado': ['web', 'TLS', 'web02 (portal.clienteb.com)'],
  'contenedor-oom': ['cont', 'Docker', 'app01 (/opt/facturacion)'],
  'servicio-a-mano': ['parcheo', 'systemd', a => a.host],
  'parches-pendientes': ['parcheo', T('Parcheo', 'Patching'), a => a.host],
  'sin-clave': ['auto', 'SSH', a => a.host],
  'ntp-sin-estandar': ['auto', 'NTP · Ansible', T('el inventario de Ansible (mgmt01)', 'the Ansible inventory (mgmt01)')],
  'pg-hba-sin-regla': ['datos', 'PostgreSQL · pg_hba', T('db01 y app01', 'db01 and app01')],
  'selinux-etiqueta': ['seg', 'SELinux', T('web03 (la intranet)', 'web03 (the intranet)')],
  'backup-credenciales': ['datos', T('MariaDB · copias', 'MariaDB · backups'), 'db02 (/backup/mariadb)'],
  'firewall-sin-puerto': ['seg', 'firewalld', a => a.host + ' (9100)'],
  'var-creciendo': ['datos', 'LVM', 'web01 (/var)'],
  'servicio-caido': ['incid', 'systemd', a => a.servicio + T(' en ', ' on ') + a.host],
  'log-gigante': ['datos', T('Disco', 'Disk'), a => a.host],
  'reloj-parado': ['incid', 'NTP', a => a.host],
};
const meta = (a, k) => { const v = META[a.tipo][k]; return typeof v === 'function' ? v(a) : v; };
P.incidenciasCfg = {
  alertas: 'amtool alert',
  pista: T('Empieza por las alertas: amtool alert. Cada una dice en qué servidor mirar; la sala del CPD también.', 'Start with the alerts: amtool alert. Each one tells you which server to look at; so does the datacenter room.'),
  funcionesDe: lista => [...new Set(lista.map(a => meta(a, 0)).filter(f => f !== 'incid'))].concat('incid'),
  areaDe: lista => [...new Set(lista.map(a => meta(a, 1)))].join(' · '),
  sitios: lista => [...new Set(lista.filter(a => !P.averias[a.tipo].condicion).map(a => meta(a, 2)))],
  mirar: /amtool|systemctl (status|--failed|is-)|journalctl|\bdf\b|\bdu\b|\bcurl\b|lsof|ausearch|getsebool|getenforce|ls -[a-zA-Z]*Z|firewall-cmd --list|openssl|docker (ps|logs|inspect)|psql|mysql .*-e|chronyc tracking|timedatectl|\bvgs\b|lsblk|ansible all -m ping|^(sudo )?cat /,
  tocar: /systemctl (start|restart|reload|stop|enable)|setsebool|semanage|restorecon|chcon|firewall-cmd .*--(add|remove|reload)|sed -i|\btee\b|^(sudo )?cp |docker (compose|restart)|truncate|^(sudo )?rm |chronyc makestep|ssh-copy-id|backup-mariadb\.sh|lvextend|ansible-playbook|dnf upgrade|apt (upgrade|full-upgrade)/,
  sinReiniciar: { t: T('No reiniciaste servidores enteros para arreglarlo', 'You did not reboot whole servers to fix it'), ok: st => !st.registro.some(r => /\breboot\b|shutdown -r/.test(r.cmd)) },
  maxHace: 10080,
  etiqueta: a => a.host ? ' (' + (a.servicio ? a.servicio + T(' en ', ' on ') : '') + a.host + ')' : '',
};
// Dónde guardan el compositor y la cola lo suyo: no se mezcla con lo de los otros puestos.
P.compositorCfg = { claveImp: 'puesto-cpd-importadas', claveBorrador: 'puesto-cpd-borrador', nuevoTipo: 'servicio-caido' };

// ------------------------------------------------------------------ uso
P.aplicarAverias = (st, lista) => lista.forEach(a => P.averias[a.tipo].aplicar(st, a));
P.pendientesAverias = (st, lista) => [].concat(...lista.filter(a => !a.soloPractica && !P.averias[a.tipo].condicion).map(a => P.averias[a.tipo].pendientes(st, a)));
P.arregloAverias = (st, lista) => [].concat(...lista.map((a, i) => ({ a, i })).filter(x => !P.averias[x.a.tipo].condicion).sort((x, y) => P.averias[x.a.tipo].orden - P.averias[y.a.tipo].orden || x.i - y.i).map(x => P.averias[x.a.tipo].arreglo(x.a, st)));
P.validarAverias = lista => {
  const st = P.crear(), errores = [], toques = {};
  if (!Array.isArray(lista) || !lista.length) return [T('una incidencia necesita al menos una avería', 'an incident needs at least one fault')];
  lista.forEach((a, i) => {
    const t = a && P.averias[a.tipo];
    if (!t) { errores.push(T('avería ' + (i + 1) + ': tipo desconocido «' + (a && a.tipo) + '»', 'fault ' + (i + 1) + ": unknown type '" + (a && a.tipo) + "'")); return; }
    const pref = T('avería ' + (i + 1) + ' (' + a.tipo + '): ', 'fault ' + (i + 1) + ' (' + a.tipo + '): ');
    const falta = (P.camposAveria[a.tipo] || []).filter(c => !c.opcional && c.def == null && (a[c.k] == null || a[c.k] === '')).map(c => c.k);
    if (falta.length) { errores.push(pref + T('falta ', 'missing ') + falta.join(', ')); return; }
    const e = t.validar(st, a);
    if (e) errores.push(pref + e);
    t.toca(a).forEach(k => { if (toques[k] != null) errores.push(T('las averías ' + (toques[k] + 1) + ' y ' + (i + 1) + ' tocan lo mismo (' + k + ')', 'faults ' + (toques[k] + 1) + ' and ' + (i + 1) + ' touch the same thing (' + k + ')')); else toques[k] = i; });
  });
  return errores;
};
})(window.PUESTO = window.PUESTO || {});
