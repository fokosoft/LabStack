// Puesto CPD · lo que corre en el CPD: las aplicaciones de los clientes.
//
// Tres clientes, y cada uno con lo suyo:
//   ACME       la tienda (nginx → Tomcat en web01), facturación (Docker en app01)
//              y la base de datos de pedidos (PostgreSQL en db01, con reportd)
//   Cliente B  el portal de clientes con HTTPS (nginx en web02, SLES)
//   Cliente C  la intranet (Apache en web03, con SELinux)
// y las copias de MariaDB en db02.
//
// Una sola fuente de verdad: C.http() recorre lo mismo que una petición de
// verdad (¿el equipo está encendido? ¿el cortafuegos deja pasar? ¿algo escucha
// en ese puerto? ¿SELinux deja a nginx hablar con Tomcat? ¿el certificado es
// válido?). De ahí salen curl, las sondas de Prometheus, las alertas y el panel
// de aplicaciones, así que arreglar algo lo arregla en todas partes a la vez.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, C = P.cpd;
const DOM = 'cpd.local';
Object.assign(U.DESC, {
  nginx: 'The nginx HTTP and reverse proxy server', tomcat: 'Apache Tomcat Web Application Container', httpd: 'The Apache HTTP Server',
  docker: 'Docker Application Container Engine', containerd: 'containerd container runtime', postgresql: 'PostgreSQL RDBMS',
  reportd: 'ACME reportd report generator', mariadb: 'MariaDB 10.11 database server', crond: 'Command Scheduler',
  node_exporter: 'Prometheus Node Exporter', firewalld: 'firewalld - dynamic firewall daemon',
});
const RSS = { tomcat: 0.9, nginx: 0.05, httpd: 0.08, docker: 0.12, containerd: 0.06, postgresql: 1.6, reportd: 0.3, mariadb: 1.1, prometheus: 1.2, node_exporter: 0.02, firewalld: 0.04 };
P.rssUnidad = (st, h, u) => RSS[u] != null ? RSS[u] : null;
P.roles = {
  mgmt: T('Gestión: Ansible, Prometheus y Alertmanager', 'Management: Ansible, Prometheus and Alertmanager'),
  web: T('Servidor web de clientes', 'Customer web server'), app: T('Aplicaciones (Docker y Tomcat)', 'Applications (Docker and Tomcat)'), db: T('Base de datos', 'Database'),
};

// ------------------------------------------------------------------ aplicaciones
// Lo que ve el panel y lo que vigila Prometheus (las sondas salen de mgmt01).
C.apps = [
  { id: 'tienda', cliente: 'ACME', nombre: T('Tienda online', 'Online store'), url: 'http://tienda.acme.es/', host: 'web01', pila: 'nginx → Tomcat' },
  { id: 'facturacion', cliente: 'ACME', nombre: T('Facturación', 'Billing'), url: 'http://app01.' + DOM + ':8090/health', host: 'app01', pila: 'Docker · Java' },
  { id: 'pedidos', cliente: 'ACME', nombre: T('Base de pedidos', 'Orders database'), host: 'db01', pila: 'PostgreSQL 14', bd: true },
  { id: 'portal', cliente: 'Cliente B', nombre: T('Portal de clientes', 'Customer portal'), url: 'https://portal.clienteb.com/', host: 'web02', pila: 'nginx · TLS' },
  { id: 'intranet', cliente: 'Cliente C', nombre: 'Intranet', url: 'http://intranet.clientec.com/', host: 'web03', pila: 'Apache · SELinux' },
  { id: 'backup', cliente: 'CPD', nombre: T('Copias de MariaDB', 'MariaDB backups'), host: 'db02', pila: 'mysqldump · cron', copias: true },
];
const NOMBRES = { 'tienda.acme.es': 'web01', 'www.tienda.acme.es': 'web01', 'portal.clienteb.com': 'web02', 'intranet.clientec.com': 'web03' };
C.resolver = (st, n, origen) => {
  if (!n) return null;
  if (n === 'localhost' || n === '127.0.0.1') return origen;
  const x = n.replace('.' + DOM, '');
  if (st.hosts[x]) return x;
  if (NOMBRES[n]) return NOMBRES[n];
  const h = Object.values(st.hosts).find(y => y.ip === n);
  return h ? h.nombre : null;
};

// ------------------------------------------------------------------ certificados
// Un PEM de mentira pero con forma de PEM: el cuerpo lleva el id, así que
// cat cert intermedia > fichero da una cadena que openssl y nginx entienden.
const D = 1440;
C.CERT = {
  'portal-2026': { cn: 'portal.clienteb.com', emisor: 'TrustLine RSA DV CA 2024', desde: -366 * D, hasta: -1.4 * D, clave: 'A', serie: '04:8E:1A:7C:33:D2:91:0F' },
  'portal-2027': { cn: 'portal.clienteb.com', emisor: 'TrustLine RSA DV CA 2024', desde: -2 * D, hasta: 431 * D, clave: 'B', serie: '0B:5F:22:E0:91:4A:6D:18' },
  'intermedia': { cn: 'TrustLine RSA DV CA 2024', emisor: 'TrustLine Root CA', desde: -900 * D, hasta: 2400 * D, ca: true, serie: '7A:01:9C:44:EE:20:13:55' },
};
const fechaCert = min => { const d = new Date(Date.UTC(2026, 8, 23, 9, 12) + Math.round(min) * 60000); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + String(d.getUTCDate()).padStart(2, ' ') + ' ' + U.p2(d.getUTCHours()) + ':' + U.p2(d.getUTCMinutes()) + ':' + U.p2(d.getUTCSeconds()) + ' ' + d.getUTCFullYear() + ' GMT'; };
C.fechaCert = fechaCert;
const cuerpo = (id, n) => { const out = [], h = U.hex('pem:' + id, n * 64); for (let i = 0; i < n; i++) out.push((i ? '' : 'MIIG') + h.slice(i * 64, i * 64 + (i ? 64 : 60)).replace(/[0-9]/g, c => 'AbCdEfGhIj'[c])); return out; };
C.pemCert = id => ['-----BEGIN CERTIFICATE-----'].concat(cuerpo(id, 3), ['-----END CERTIFICATE-----']);
C.pemClave = id => ['-----BEGIN PRIVATE KEY-----'].concat(cuerpo('k' + id, 4), ['-----END PRIVATE KEY-----']);
const PRIMERAS = {};
Object.keys(C.CERT).forEach(id => { PRIMERAS[C.pemCert(id)[1]] = { tipo: 'cert', id }; });
['A', 'B'].forEach(k => { PRIMERAS[C.pemClave(k)[1]] = { tipo: 'clave', id: k }; });
C.parsePem = lineas => { const out = []; (lineas || []).forEach((l, i) => { const t = typeof l === 'string' ? l : l.t; if (/^-----BEGIN /.test(t)) { const sig = lineas[i + 1], x = PRIMERAS[typeof sig === 'string' ? sig : sig && sig.t]; out.push(x || { tipo: /KEY/.test(t) ? 'clave' : 'cert', id: null }); } }); return out; };
C.md5 = txt => U.hex('md5:' + txt, 32);
C.modulo = (tipo, id) => tipo === 'cert' ? (C.CERT[id] && C.CERT[id].clave ? 'mod' + C.CERT[id].clave : 'mod-' + id) : 'mod' + id;
C.textoModulo = m => 'Modulus=' + U.hex(m, 96).toUpperCase() + U.hex(m + 'b', 160).toUpperCase();
const sujeto = c => 'CN = ' + c.cn;
C.leerPem = (st, h, ruta) => { const fs = P.vfs(st, h), f = fs.f[ruta]; return f ? C.parsePem(f.lineas() || []) : null; };

// ------------------------------------------------------------------ estado inicial
P.alCrear.push(st => {
  const H = st.hosts;
  // web01: la tienda de ACME. nginx hace de proxy hacia Tomcat en el 8080.
  C.ficheroBase(H.web01, '/etc/nginx/nginx.conf', ['user nginx;', 'worker_processes auto;', 'error_log /var/log/nginx/error.log;', 'events { worker_connections 1024; }', 'http {', '    include /etc/nginx/conf.d/*.conf;', '}']);
  C.ficheroBase(H.web01, '/etc/nginx/conf.d/tienda.conf', ['server {', '    listen 80;', '    server_name tienda.acme.es www.tienda.acme.es;', '    access_log /var/log/nginx/tienda.access.log;', '    error_log  /var/log/nginx/tienda.error.log;', '    location / {', '        proxy_pass http://127.0.0.1:8080;', '        proxy_set_header Host $host;', '    }', '}']);
  H.web01.extra.se.bools.httpd_can_network_connect = { v: true, p: true };
  C.fwAbre(H.web01, ['http'], ['9100/tcp']);
  H.web01.extra.privados['/var/log/nginx'] = '711';
  // web02: el portal de Cliente B, con su certificado y la intermedia.
  C.ficheroBase(H.web02, '/etc/nginx/nginx.conf', ['user nginx;', 'worker_processes auto;', 'events { worker_connections 1024; }', 'http {', '    include /etc/nginx/vhosts.d/*.conf;', '}']);
  C.ficheroBase(H.web02, '/etc/nginx/vhosts.d/portal.conf', ['server {', '    listen 80;', '    server_name portal.clienteb.com;', '    return 301 https://$host$request_uri;', '}', 'server {', '    listen 443 ssl http2;', '    server_name portal.clienteb.com;', '    ssl_certificate     /etc/nginx/ssl/portal.crt;', '    ssl_certificate_key /etc/nginx/ssl/portal.key;', '    root /srv/www/portal;', '}']);
  C.ficheroBase(H.web02, '/etc/nginx/ssl/portal.crt', C.pemCert('portal-2027').concat(C.pemCert('intermedia')));
  C.ficheroBase(H.web02, '/etc/nginx/ssl/portal.key', C.pemClave('B'), '600');
  H.web02.extra.nginx = { cadena: ['portal-2027', 'intermedia'], clave: 'B' };
  C.fwAbre(H.web02, ['http', 'https'], ['9100/tcp']);
  // web03: la intranet de Cliente C, en /srv/www con su regla de SELinux.
  C.ficheroBase(H.web03, '/etc/httpd/conf.d/intranet.conf', ['<VirtualHost *:80>', '    ServerName intranet.clientec.com', '    DocumentRoot /srv/www/intranet', '    ErrorLog /var/log/httpd/intranet_error.log', '    <Directory /srv/www/intranet>', '        Require all granted', '    </Directory>', '</VirtualHost>']);
  C.ficheroBase(H.web03, '/srv/www/intranet/index.html', ['<!doctype html>', '<title>Intranet Cliente C</title>', '<h1>Intranet de Cliente C</h1>']);
  H.web03.extra.se.fcontext.push({ re: '/srv/www(/.*)?', tipo: 'httpd_sys_content_t' });
  H.web03.extra.privados['/var/log/httpd'] = '700';
  C.fwAbre(H.web03, ['http'], ['9100/tcp']);
  // app01: facturación en Docker, y un Tomcat con la API de informes.
  C.ficheroBase(H.app01, '/opt/facturacion/docker-compose.yml', C.compose('4.1.3', '-Xmx192m', '256m'));
  H.app01.extra.docker = { c: {} };
  C.recrear(st, H.app01, -12 * D);
  H.app01.extra.docker.c['facturacion-redis'] = { imagen: 'redis:7.2-alpine', id: U.hex('redis', 12), cfg: { mem: 128, xmx: 0 }, estado: 'running', desde: -40 * D, reinicios: 0, oom: false, puertos: '6379/tcp' };
  // db01: los pedidos de ACME. reportd genera informes y escribe su log en /var.
  C.ficheroBase(H.db01, '/etc/reportd/reportd.conf', ['# ACME reportd', 'listen = 127.0.0.1:7070', 'db_host = localhost', 'db_name = pedidos', 'log_file = /var/log/acme/reportd.log', 'log_level = info']);
  C.ficheroBase(H.db01, '/etc/postgresql/14/main/pg_hba.conf', ['# TYPE  DATABASE        USER            ADDRESS                 METHOD', 'local   all             postgres                                peer', 'local   all             all                                     peer', 'host    all             all             127.0.0.1/32            scram-sha-256', 'host    pedidos         pedidos         10.10.0.0/24            scram-sha-256', 'host    pedidos         informes        10.10.0.31/32           scram-sha-256', T('# Bastionado (SEC-2026-07): todo lo que no esté arriba, fuera', '# Hardening (SEC-2026-07): anything not listed above is rejected'), 'host    all             all             0.0.0.0/0               reject'], '640', 'postgres', 'postgres');
  H.db01.extra.usuarios.postgres = { uid: 114, home: '/var/lib/postgresql', shell: '/bin/bash', grupos: ['postgres', 'ssl-cert'] };
  H.db01.extra.usuarios.report = { uid: 1002, home: '/opt/reportd', shell: '/usr/sbin/nologin', grupos: ['report'] };
  H.db01.extra.privados['/var/lib/postgresql'] = '700';
  H.db01.extra.reportd = { nivel: 'info', pid: 2214 };
  H.db01.extra.abiertos = [];
  H.db01.logs['/var/log/acme/reportd.log'] = 46;
  H.db01.logs['/var/log/postgresql/postgresql-14-main.log'] = 12;
  H.db01.logs['/var/lib/postgresql/14/main/base/16384/pedidos.dat'] = 11.2 * 1024;
  H.db01.discos['/var'].baseG = 7.2;
  // db02: MariaDB y su copia nocturna.
  C.ficheroBase(H.db02, '/etc/cron.d/backup-mariadb', [T('# Copia nocturna de todas las bases (CHG0017702)', '# Nightly backup of every database (CHG0017702)'), '30 2 * * * root /usr/local/bin/backup-mariadb.sh >> /var/log/backup-mariadb.log 2>&1']);
  C.ficheroBase(H.db02, '/usr/local/bin/backup-mariadb.sh', ['#!/bin/bash', 'set -u', 'DEST=/backup/mariadb', 'F=$DEST/all-$(date +%F).sql.gz', 'mysqldump --defaults-extra-file=/root/.backup.cnf --all-databases --single-transaction | gzip > "$F"', 'echo "OK backup completed: $F"'], '750');
  C.ficheroBase(H.db02, '/root/.backup.cnf', ['[client]', 'user=backup', 'password="Bk-Oct2026!"'], '600');
  H.db02.extra.mariadb = { claveBackup: 'Bk-Oct2026!' };
  H.db02.extra.copias = [-3, -2, -1].map(d => ({ dia: d, mb: 41.6 + d * 0.3 }));
  C.fwAbre(H.db02, ['mysql'], ['9100/tcp']);
  // mgmt01: el puesto. Ansible, la documentación del equipo y Prometheus.
  C.ficheroBase(H.mgmt01, U.HOME + '/LEEME.md', C.leeme(), '644', 'admin');
  C.ficheroBase(H.mgmt01, U.HOME + '/ansible/ansible.cfg', ['[defaults]', 'inventory = inventory.ini', 'remote_user = admin', 'host_key_checking = False', 'stdout_callback = default'], '644', 'admin');
  C.ficheroBase(H.mgmt01, U.HOME + '/ansible/inventory.ini', ['[web]', 'web01', 'web02', 'web03', '', '[app]', 'app01', '', '[db]', 'db01', 'db02'], '644', 'admin');
  C.ficheroBase(H.mgmt01, U.HOME + '/ansible/chrony.yml', C.playbookChrony(), '644', 'admin');
  C.ficheroBase(H.mgmt01, U.HOME + '/ansible/templates/chrony.conf.j2', ['# {{ ansible_managed }}', 'server ntp1.cpd.local iburst', 'server ntp2.cpd.local iburst', 'driftfile /var/lib/chrony/drift', 'makestep 1.0 3', 'rtcsync'], '644', 'admin');
  Object.values(H).forEach(h => { h.extra.ntpConf = 'estandar'; });
  // Lo que vigila Prometheus: node_exporter en todos, y las webs desde fuera.
  Object.values(H).forEach(h => { if (h.svcs.node_exporter) h.logs['/var/log/node_exporter.log'] = 0.2; });
});

// ------------------------------------------------------------------ peticiones HTTP
// Lo que escucha en cada puerto de cada equipo.
C.ESCUCHA = {
  mgmt01: { 9090: 'prometheus', 9093: 'alertmanager' },
  web01: { 80: 'nginx', 8080: 'tomcat', 9100: 'node_exporter' },
  web02: { 80: 'nginx', 443: 'nginx', 9100: 'node_exporter' },
  web03: { 80: 'httpd', 9100: 'node_exporter' },
  app01: { 8080: 'tomcat', 8090: 'docker:facturacion', 9100: 'node_exporter' },
  db01: { 5432: 'postgresql', 9100: 'node_exporter' },
  db02: { 3306: 'mariadb', 9100: 'node_exporter' },
};
const err = (code, msg) => ({ err: { code, msg } });
const resp = (codigo, server, tipo, cuerpo, extra) => Object.assign({ codigo, server, tipo, cuerpo: cuerpo || [] }, extra || {});
const TEXTO = { 200: 'OK', 301: 'Moved Permanently', 403: 'Forbidden', 404: 'Not Found', 502: 'Bad Gateway', 503: 'Service Unavailable' };
const pagina = (codigo, server) => ['<html>', '<head><title>' + codigo + ' ' + TEXTO[codigo] + '</title></head>', '<body>', '<center><h1>' + codigo + ' ' + TEXTO[codigo] + '</h1></center>', '<hr><center>' + server + '</center>', '</body>', '</html>'];
// rastro: la petición deja huella (log de errores, AVC). Las alertas y el panel
// preguntan sin dejarla, para no ensuciar los logs cada vez que se pinta.
C.http = (st, origen, url, o) => {
  o = o || {};
  const m = /^(https?):\/\/([^/:]+)(?::(\d+))?(\/[^\s]*)?$/.exec(url || '');
  if (!m) return err(3, 'URL rejected: Malformed input to a URL function');
  const esquema = m[1], nombre = m[2], puerto = +(m[3] || (esquema === 'https' ? 443 : 80)), ruta = m[4] || '/';
  const hn = C.resolver(st, nombre, origen);
  if (!hn) return err(6, 'Could not resolve host: ' + nombre);
  const h = st.hosts[hn], de = st.hosts[origen];
  if (!h.up) return err(7, 'Failed to connect to ' + nombre + ' port ' + puerto + ' after 3060 ms: No route to host');
  if (origen !== hn && !C.fwPermite(st, h, puerto, de ? de.ip : '')) return err(28, (o.max ? 'Connection timed out after ' + (o.max * 1000 + 1) + ' milliseconds' : 'Failed to connect to ' + nombre + ' port ' + puerto + ' after 130271 ms: Connection timed out'));
  const quien = (C.ESCUCHA[hn] || {})[puerto];
  const vivo = quien && (/^docker:/.test(quien) ? C.contenedorVivo(h, quien.slice(7)) : h.svcs[quien] && h.svcs[quien].estado === 'active');
  if (!vivo) {
    if (quien && /^docker:/.test(quien) && C.contenedorReiniciando(h, quien.slice(7))) return err(56, 'Recv failure: Connection reset by peer');
    return err(7, 'Failed to connect to ' + nombre + ' port ' + puerto + ' after 0 ms: Connection refused');
  }
  const ctx = { st, h, nombre, puerto, ruta, esquema, o, origen, origenIp: hn === origen ? '127.0.0.1' : (de ? de.ip : '') };
  if (quien === 'nginx' && hn === 'web01') return C.tienda(ctx);
  if (quien === 'nginx' && hn === 'web02') return C.portal(ctx);
  if (quien === 'httpd') return C.intranet(ctx);
  if (quien === 'tomcat') return resp(200, 'Apache-Coyote/1.1', 'text/html;charset=UTF-8', hn === 'web01' ? ['<!doctype html><html><head><title>Tienda ACME</title></head>', '<body><h1>Tienda ACME</h1><p>Catálogo de otoño</p></body></html>'] : ['{"service":"informes-api","status":"UP"}'], { tomcat: true });
  if (quien === 'docker:facturacion') return resp(200, '', 'application/json', ['{"status":"UP","version":"' + C.contenedor(h, 'facturacion').version + '","db":"UP"}']);
  if (quien === 'node_exporter') return resp(200, '', 'text/plain; version=0.0.4', ['# HELP node_load1 1m load average.', '# TYPE node_load1 gauge', 'node_load1 0.31', '# HELP node_filesystem_avail_bytes Filesystem space available to non-root users in bytes.']);
  if (quien === 'prometheus') return resp(302, '', 'text/html', ['<a href="/graph">Found</a>.']);
  if (quien === 'postgresql' || quien === 'mariadb') return err(52, 'Empty reply from server');
  return resp(200, '', 'text/plain', ['OK']);
};
C.tienda = x => {
  const { st, h, o } = x;
  // nginx → Tomcat por 127.0.0.1:8080. SELinux decide si httpd_t puede abrir esa conexión.
  if (C.enforcing(h) && !C.bool(h, 'httpd_can_network_connect')) {
    if (o.rastro) { C.avc(st, h, 'name_connect', 'nginx', 'dest=8080', 'system_u:object_r:http_cache_port_t:s0', 'tcp_socket'); C.errorWeb(st, h, '/var/log/nginx/tienda.error.log', '[crit] ' + U.pid('web01nginx') + '#0: *' + (900 + st.reloj) + ' connect() to 127.0.0.1:8080 failed (13: Permission denied) while connecting to upstream, client: ' + x.origenIp + ', server: tienda.acme.es, request: "GET / HTTP/1.1", upstream: "http://127.0.0.1:8080/", host: "' + x.nombre + '"'); }
    return resp(502, 'nginx/1.20.1', 'text/html', pagina(502, 'nginx/1.20.1'));
  }
  if (h.svcs.tomcat.estado !== 'active') {
    if (o.rastro) C.errorWeb(st, h, '/var/log/nginx/tienda.error.log', '[error] ' + U.pid('web01nginx') + '#0: *' + (900 + st.reloj) + ' connect() failed (111: Connection refused) while connecting to upstream, server: tienda.acme.es, upstream: "http://127.0.0.1:8080/"');
    return resp(502, 'nginx/1.20.1', 'text/html', pagina(502, 'nginx/1.20.1'));
  }
  return resp(200, 'nginx/1.20.1', 'text/html;charset=UTF-8', ['<!doctype html><html><head><title>Tienda ACME</title></head>', '<body><h1>Tienda ACME</h1><p>Catálogo de otoño</p></body></html>']);
};
C.portal = x => {
  const { st, h, puerto, o } = x;
  if (puerto === 80) return resp(301, 'nginx/1.21.5', 'text/html', pagina(301, 'nginx/1.21.5'), { cab: ['Location: https://portal.clienteb.com/'] });
  const tls = C.tlsServido(st, h, x.nombre);
  if (tls.error && !o.inseguro) return Object.assign(err(60, tls.error), { tls });
  return resp(200, 'nginx/1.21.5', 'text/html', ['<!doctype html><html><head><title>Portal Cliente B</title></head>', '<body><h1>Portal de clientes</h1></body></html>'], { tls, http2: true });
};
// Lo que el navegador comprueba: el certificado del servidor, su fecha, su nombre y la cadena hasta una raíz conocida.
C.tlsServido = (st, h, nombre) => {
  const n = h.extra.nginx, hoja = C.CERT[n.cadena[0]];
  const out = { cadena: n.cadena.slice(), hoja: n.cadena[0], codigo: 0, texto: 'ok' };
  if (!hoja) { out.error = 'SSL certificate problem: unable to get local issuer certificate'; out.codigo = 20; out.texto = 'unable to get local issuer certificate'; return out; }
  if (hoja.ca) { out.error = 'SSL: no alternative certificate subject name matches target host name \'' + nombre + '\''; out.codigo = 62; out.texto = 'hostname mismatch'; return out; }
  if (st.reloj > hoja.hasta) { out.error = 'SSL certificate problem: certificate has expired'; out.codigo = 10; out.texto = 'certificate has expired'; return out; }
  if (n.cadena.indexOf('intermedia') < 0) { out.error = 'SSL certificate problem: unable to get local issuer certificate'; out.codigo = 21; out.texto = 'unable to verify the first certificate'; return out; }
  if (nombre && nombre !== hoja.cn && /\./.test(nombre) && !st.hosts[nombre.replace('.' + DOM, '')]) { out.error = 'SSL: no alternative certificate subject name matches target host name \'' + nombre + '\''; out.codigo = 62; out.texto = 'hostname mismatch'; }
  return out;
};
C.intranet = x => {
  const { st, h, o } = x, doc = '/srv/www/intranet/index.html', tipo = C.tipo(h, doc);
  if (C.enforcing(h) && ['httpd_sys_content_t', 'httpd_sys_rw_content_t'].indexOf(tipo) < 0) {
    if (o.rastro) { C.avc(st, h, 'getattr', 'httpd', 'path="' + doc + '" dev="dm-0" ino=' + (33600 + 17), 'unconfined_u:object_r:' + tipo + ':s0', 'file'); C.errorWeb(st, h, '/var/log/httpd/intranet_error.log', '[core:error] [pid ' + U.pid('web03httpd') + ':tid ' + U.pid('t') + '] (13)Permission denied: [client ' + x.origenIp + '] AH00035: access to /index.html denied (filesystem path \'' + doc + '\') because search permissions are missing on a component of the path'); }
    return resp(403, 'Apache/2.4.57 (Rocky Linux)', 'text/html; charset=iso-8859-1', ['<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">', '<html><head>', '<title>403 Forbidden</title>', '</head><body>', '<h1>Forbidden</h1>', '<p>You don\'t have permission to access this resource.</p>', '</body></html>']);
  }
  return resp(200, 'Apache/2.4.57 (Rocky Linux)', 'text/html; charset=UTF-8', C.leer(h, doc) || []);
};
C.errorWeb = (st, h, ruta, t) => {
  const w = h.extra.errWeb = h.extra.errWeb || {};
  const l = w[ruta] = w[ruta] || [];
  const linea = U.iso(st.reloj).replace('T', ' ').replace(/-/g, '/') + ' ' + t;
  if (l.length && l[l.length - 1].slice(19) === linea.slice(19)) return;
  l.push(linea); if (l.length > 30) l.shift();
  if (h.logs[ruta] == null) h.logs[ruta] = 0.01;
};
P.generadoresLog.push((st, h, p) => {
  if (h.extra.errWeb && h.extra.errWeb[p]) return h.extra.errWeb[p].slice();
  if (/\/(tienda|portal|intranet)[._](error|access)\.log$/.test(p) || /nginx\/error\.log$/.test(p)) return [];
  return null;
});
// La sonda de Prometheus (blackbox) pide cada minuto: deja su rastro, como las de verdad.
P.ticks.push(st => { C.apps.filter(a => a.url).forEach(a => C.http(st, P.entrada, a.url, { rastro: true })); });

// ------------------------------------------------------------------ curl
U.cmd('curl', { ayuda: T('pide una URL (curl -I http://tienda.acme.es)', 'request a URL (curl -I http://tienda.acme.es)'), grupo: T('Red', 'Network'), fn: ctx => {
  const a = ctx.args, url = a.find((x, i) => /^https?:\/\//.test(x) || (/^[\w.-]+(:\d+)?(\/.*)?$/.test(x) && x[0] !== '-' && ['-m', '--max-time', '-o', '-w', '-H', '-X', '--connect-timeout', '-u', '-d'].indexOf(a[i - 1]) < 0));
  if (!url) return [L("curl: try 'curl --help' or 'curl --manual' for more information", 'err')];
  const full = /^https?:\/\//.test(url) ? url : 'http://' + url;
  const flags = a.filter(x => /^-[a-zA-Z]+$/.test(x)).join('');
  const cab = flags.indexOf('I') >= 0 || a.indexOf('--head') >= 0, silencio = flags.indexOf('s') >= 0, verbose = flags.indexOf('v') >= 0, ins = flags.indexOf('k') >= 0 || a.indexOf('--insecure') >= 0;
  const mi = a.findIndex(x => x === '-m' || x === '--max-time' || x === '--connect-timeout'), max = mi >= 0 ? +a[mi + 1] : null;
  const wi = a.indexOf('-w'), formato = wi >= 0 ? a[wi + 1] : null, aNull = a.indexOf('/dev/null') >= 0;
  const r = C.http(ctx.st, ctx.h.nombre, full, { inseguro: ins, max, rastro: true });
  const out = [];
  if (verbose) {
    const m = /^(https?):\/\/([^/:]+)(?::(\d+))?/.exec(full), hn = C.resolver(ctx.st, m[2], ctx.h.nombre), ip = hn ? ctx.st.hosts[hn].ip : '?';
    out.push(L('*   Trying ' + ip + ':' + (m[3] || (m[1] === 'https' ? 443 : 80)) + '...', 'dim'));
    if (r.tls) { const c = C.CERT[r.tls.hoja]; if (c) { out.push(L('* Server certificate:', 'dim')); out.push(L('*  subject: CN=' + c.cn, 'dim')); out.push(L('*  start date: ' + fechaCert(c.desde), 'dim')); out.push(L('*  expire date: ' + fechaCert(c.hasta), ctx.st.reloj > c.hasta ? 'rojo' : 'dim')); out.push(L('*  issuer: CN=' + c.emisor, 'dim')); } }
  }
  if (r.err) {
    if (formato) out.push(L(formato.replace(/%\{http_code\}/g, '000').replace(/\\n/g, '')));
    if (!silencio || flags.indexOf('S') >= 0 || verbose) out.push(L('curl: (' + r.err.code + ') ' + r.err.msg, 'err'));
    if (r.err.code === 60 && !silencio) { out.push(L('More details here: https://curl.se/docs/sslcerts.html', 'err')); }
    return { lineas: out, minutos: r.err.code === 28 && !max ? 3 : 1 };
  }
  if (formato) { out.push(L(formato.replace(/%\{http_code\}/g, String(r.codigo)).replace(/\\n/g, ''))); if (aNull) return out; }
  if (cab || verbose) {
    const v = r.http2 ? 'HTTP/2 ' + r.codigo : 'HTTP/1.1 ' + r.codigo + ' ' + TEXTO[r.codigo];
    out.push(L((verbose ? '< ' : '') + v, r.codigo >= 400 ? 'rojo' : r.codigo >= 300 ? 'ambar' : 'verde'));
    [(r.server ? 'Server: ' + r.server : null), 'Date: ' + U.larga(ctx.st.reloj).replace(/^(\w+) (\d+)-(\d+)-(\d+) (.*) UTC$/, '$1, $4 ' + 'Sep $2 $5 GMT'), 'Content-Type: ' + r.tipo, 'Connection: keep-alive'].concat(r.cab || []).filter(Boolean).forEach(x => out.push(L((verbose ? '< ' : '') + x)));
    if (cab) return out;
  }
  if (!aNull) r.cuerpo.forEach(x => out.push(L(x)));
  return out;
} });

// ------------------------------------------------------------------ openssl
const opensslX509 = (pems, a, st) => {
  const c = pems.find(x => x.tipo === 'cert');
  if (!c) return [L('unable to load certificate', 'err'), L('40C7B5E5B37F0000:error:1608010C:STORE routines:ossl_store_handle_load_result:unsupported:../crypto/store/store_result.c:151:', 'err')];
  const x = C.CERT[c.id], out = [];
  if (a.indexOf('-subject') >= 0) out.push(L('subject=' + sujeto(x)));
  if (a.indexOf('-issuer') >= 0) out.push(L('issuer=CN = ' + x.emisor));
  if (a.indexOf('-dates') >= 0 || a.indexOf('-startdate') >= 0) out.push(L('notBefore=' + fechaCert(x.desde)));
  if (a.indexOf('-dates') >= 0 || a.indexOf('-enddate') >= 0) out.push(L('notAfter=' + fechaCert(x.hasta), st && st.reloj > x.hasta ? 'rojo' : 'out'));
  if (a.indexOf('-serial') >= 0) out.push(L('serial=' + x.serie.replace(/:/g, '')));
  if (a.indexOf('-modulus') >= 0) out.push(L(C.textoModulo(C.modulo('cert', c.id))));
  if (a.indexOf('-text') >= 0) out.push(L('Certificate:'), L('    Data:'), L('        Serial Number: ' + x.serie), L('        Issuer: CN = ' + x.emisor), L('        Validity'), L('            Not Before: ' + fechaCert(x.desde)), L('            Not After : ' + fechaCert(x.hasta)), L('        Subject: ' + sujeto(x)));
  if (a.indexOf('-noout') < 0) C.pemCert(c.id).forEach(t => out.push(L(t)));
  return out;
};
const opensslClave = (pems, a) => {
  const k = pems.find(x => x.tipo === 'clave');
  if (!k) return [L('Could not read private key from file', 'err')];
  return a.indexOf('-modulus') >= 0 ? [L(C.textoModulo(C.modulo('clave', k.id)))] : a.indexOf('-check') >= 0 ? [L('RSA key ok')] : [L('writing RSA key')].concat(C.pemClave(k.id).map(t => L(t)));
};
U.cmd('openssl', { ayuda: T('certificados: x509 -noout -dates -in · s_client -connect host:443', 'certificates: x509 -noout -dates -in · s_client -connect host:443'), grupo: 'TLS', fn: ctx => {
  const a = ctx.args, sub = a[0], fs = P.vfs(ctx.st, ctx.h), ii = a.indexOf('-in');
  const leer = () => {
    if (ii < 0) return { err: [L(T('(sin -in, openssl espera el PEM por una tubería: … | openssl x509 -noout -dates)', '(without -in, openssl expects the PEM from a pipe: … | openssl x509 -noout -dates)'), 'dim')] };
    const p = U.ruta(ctx.ses.cwd, a[ii + 1] || '', ctx.ses), f = fs.f[p];
    if (!f) return { err: [L("Could not open file or uri for loading: " + (a[ii + 1] || ''), 'err'), L('40C7B5E5B37F0000:error:80000002:system library:file_open:No such file or directory', 'err')] };
    if (f.priv && !ctx.sudo) return { err: [L("Could not open file or uri for loading: " + a[ii + 1], 'err'), L('40C7B5E5B37F0000:error:8000000D:system library:file_open:Permission denied', 'err')] };
    return { pems: C.parsePem(f.lineas() || []) };
  };
  if (sub === 'x509') { const r = leer(); return r.err || opensslX509(r.pems, a, ctx.st); }
  if (sub === 'rsa' || sub === 'pkey') { const r = leer(); return r.err || opensslClave(r.pems, a); }
  if (sub === 'md5' || sub === 'sha256') return [L('(stdin)= ' + C.md5(''))];
  if (sub === 's_client') {
    const c = a[a.indexOf('-connect') + 1] || '', [n, pt] = c.split(':'), sn = a.indexOf('-servername') >= 0 ? a[a.indexOf('-servername') + 1] : n;
    const hn = C.resolver(ctx.st, n, ctx.h.nombre), h = hn && ctx.st.hosts[hn];
    if (!h) return [L('BIO_lookup_ex: system lib', 'err'), L('connect:errno=2', 'err')];
    if (!h.up || !h.svcs.nginx || h.svcs.nginx.estado !== 'active' || +pt !== 443) return [L(ctx.h.ip.replace(/\.\d+$/, '') + ': connect:errno=111', 'err')];
    const t = C.tlsServido(ctx.st, h, sn), hoja = C.CERT[t.hoja];
    const out = [L('CONNECTED(00000003)')];
    t.cadena.forEach((id, i) => { const x = C.CERT[id]; if (x) out.push(L('depth=' + (t.cadena.length - 1 - i) + ' ' + sujeto(x))); });
    if (t.codigo) out.push(L('verify error:num=' + t.codigo + ':' + t.texto, 'rojo'));
    out.push(L('---'), L('Certificate chain'));
    t.cadena.forEach((id, i) => { const x = C.CERT[id]; if (x) { out.push(L(' ' + i + ' s:' + sujeto(x))); out.push(L('   i:CN = ' + x.emisor)); out.push(L('   v:NotBefore: ' + fechaCert(x.desde) + '; NotAfter: ' + fechaCert(x.hasta), ctx.st.reloj > x.hasta ? 'rojo' : 'out')); } });
    out.push(L('---'), L('Server certificate'));
    C.pemCert(t.hoja).forEach(x => out.push(L(x)));
    if (hoja) { out.push(L('subject=' + sujeto(hoja))); out.push(L('issuer=CN = ' + hoja.emisor)); }
    out.push(L('---'), L('SSL handshake has read 4127 bytes and written 389 bytes'), L('Verification: ' + (t.codigo ? 'Failed' : 'OK')), L('---'), L('New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384'), L('    Verify return code: ' + t.codigo + ' (' + t.texto + ')', t.codigo ? 'rojo' : 'verde'), L('---'), L('DONE'));
    return out;
  }
  return [L('Invalid command \'' + (sub || '') + '\'; type "help" for a list.', 'err')];
} });
// Detrás de un |: lo que imprime s_client o un cat de un .crt se puede volver a leer.
P.filtros.openssl = (lineas, a, ctx) => {
  const sub = a[0];
  if (sub === 'md5' || sub === 'sha256') return [L('MD5(stdin)= ' + C.md5(lineas.map(l => l.t).join('\n')))];
  const pems = C.parsePem(lineas.map(l => l.t));
  if (sub === 'x509') return opensslX509(pems, a, ctx.st);
  if (sub === 'rsa' || sub === 'pkey') return opensslClave(pems, a);
  return [L('Invalid command \'' + (sub || '') + '\'', 'err')];
};

// ------------------------------------------------------------------ nginx y Apache
// nginx -t: la cadena del .crt empieza por el certificado del servidor, y su clave tiene que casar con él.
C.nginxTest = (st, h) => {
  const conf = h.nombre === 'web02' ? { crt: '/etc/nginx/ssl/portal.crt', key: '/etc/nginx/ssl/portal.key' } : null;
  if (!conf) return { ok: true };
  const fs = P.vfs(st, h);
  if (!fs.f[conf.crt]) return { ok: false, msg: 'nginx: [emerg] cannot load certificate "' + conf.crt + '": BIO_new_file() failed (SSL: error:80000002:system library::No such file or directory)' };
  if (!fs.f[conf.key]) return { ok: false, msg: 'nginx: [emerg] cannot load certificate key "' + conf.key + '": BIO_new_file() failed (SSL: error:80000002:system library::No such file or directory)' };
  const certs = C.parsePem(fs.f[conf.crt].lineas()).filter(x => x.tipo === 'cert'), k = C.parsePem(fs.f[conf.key].lineas()).find(x => x.tipo === 'clave');
  if (!certs.length || !certs[0].id) return { ok: false, msg: 'nginx: [emerg] cannot load certificate "' + conf.crt + '": PEM_read_bio_X509_AUX() failed (SSL: error:0480006C:PEM routines::no start line:Expecting: TRUSTED CERTIFICATE)' };
  if (!k || !k.id) return { ok: false, msg: 'nginx: [emerg] cannot load certificate key "' + conf.key + '": PEM_read_bio_PrivateKey() failed (SSL: error:1E08010C:DECODER routines::unsupported)' };
  if (C.modulo('cert', certs[0].id) !== C.modulo('clave', k.id)) return { ok: false, msg: 'nginx: [emerg] SSL_CTX_use_PrivateKey("' + conf.key + '") failed (SSL: error:05800074:x509 certificate routines::key values mismatch)' };
  return { ok: true, cadena: certs.map(x => x.id), clave: k.id };
};
U.cmd('nginx', { ayuda: T('nginx -t: comprueba la configuración antes de recargar', 'nginx -t: check the configuration before reloading'), grupo: T('Servicios', 'Services'), donde: ['web01', 'web02'], fn: ctx => {
  const a = ctx.args;
  if (a.indexOf('-t') >= 0 || a.indexOf('-T') >= 0) {
    if (!ctx.sudo) return [L('nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)', 'err'), L('nginx: [emerg] open() "/run/nginx.pid" failed (13: Permission denied)', 'err'), L('nginx: configuration file /etc/nginx/nginx.conf test failed', 'err'), L(U.SUDO, 'dim')];
    const t = C.nginxTest(ctx.st, ctx.h);
    if (!t.ok) return [L(t.msg, 'err'), L('nginx: configuration file /etc/nginx/nginx.conf test failed', 'err')];
    ctx.st.hechos['nginxT:' + ctx.h.nombre] = ctx.st.reloj;
    return [L('nginx: the configuration file /etc/nginx/nginx.conf syntax is ok'), L('nginx: configuration file /etc/nginx/nginx.conf test is successful', 'verde')];
  }
  if (a.indexOf('-v') >= 0 || a.indexOf('-V') >= 0) return [L('nginx version: nginx/' + (ctx.h.nombre === 'web01' ? '1.20.1' : '1.21.5'))];
  if (a[0] === '-s' && a[1] === 'reload') { const d = U.sinRoot(ctx, ['nginx: [alert] kill(' + U.pid(ctx.h.nombre + 'nginx') + ', 1) failed (1: Operation not permitted)']); if (d) return d; return P.recargar.nginx(ctx.st, ctx.h) ? [L(C.nginxTest(ctx.st, ctx.h).msg, 'err')] : []; }
  return [L(T('(en el simulador: nginx -t, nginx -v, nginx -s reload)', '(in the simulator: nginx -t, nginx -v, nginx -s reload)'), 'dim')];
} });
// reload: si la configuración nueva no vale, nginx sigue con la vieja y el reload falla.
P.recargar.nginx = (st, h) => {
  const t = C.nginxTest(st, h);
  if (!t.ok) { U.logSvc(h, 'nginx', st.reloj, 'nginx[' + U.pid(h.nombre + 'nginx') + ']', t.msg.replace(/^nginx: /, '')); U.logSvc(h, 'nginx', st.reloj, 'systemd[1]', 'nginx.service: Control process exited, code=exited, status=1/FAILURE'); U.logSvc(h, 'nginx', st.reloj, 'systemd[1]', 'Reload failed for The nginx HTTP and reverse proxy server.'); return 'conf'; }
  if (t.cadena) { h.extra.nginx.cadena = t.cadena; h.extra.nginx.clave = t.clave; }
  U.logSvc(h, 'nginx', st.reloj, 'systemd[1]', 'Reloading The nginx HTTP and reverse proxy server...'); U.logSvc(h, 'nginx', st.reloj, 'systemd[1]', 'Reloaded The nginx HTTP and reverse proxy server.');
  st.hechos['nginxReload:' + h.nombre] = st.reloj;
  return null;
};
P.reglas.push((st, h, u) => (u === 'nginx' && !C.nginxTest(st, h).ok) ? 'nginx-conf' : null);
P.motivos['nginx-conf'] = { result: 'exit-code', proceso: '(code=exited, status=1/FAILURE)', journal: (st, h, u, m) => [{ min: m, src: 'nginx[' + U.pid(h.nombre + 'nginx' + m) + ']', t: C.nginxTest(st, h).msg.replace(/^nginx: /, '') }, { min: m, src: 'nginx[' + U.pid(h.nombre + 'nginx' + m) + ']', t: 'nginx: configuration file /etc/nginx/nginx.conf test failed' }] };
// Al arrancar (restart), nginx carga lo que haya en los ficheros.
P.alArrancar.push((st, h, u) => { if (u === 'nginx' && h.extra.nginx) { const t = C.nginxTest(st, h); if (t.ok && t.cadena) { h.extra.nginx.cadena = t.cadena; h.extra.nginx.clave = t.clave; } } });
U.cmd('apachectl', { ayuda: T('apachectl configtest: comprueba la configuración', 'apachectl configtest: check the configuration'), grupo: T('Servicios', 'Services'), donde: ['web03'], fn: ctx => ctx.args[0] === 'configtest' || ctx.args[0] === '-t' ? [L('Syntax OK', 'verde')] : [L(T('(en el simulador: apachectl configtest)', '(in the simulator: apachectl configtest)'), 'dim')] });

// ------------------------------------------------------------------ Docker (app01)
// El compose manda: docker compose up -d recrea con lo que dice el fichero;
// docker restart vuelve a arrancar el mismo contenedor, con su configuración vieja.
C.compose = (version, xmx, mem) => ['services:', '  facturacion:', '    image: registry.acme.local/facturacion:' + version, '    container_name: facturacion', '    restart: unless-stopped', '    ports:', '      - "8090:8080"', '    environment:', '      JAVA_TOOL_OPTIONS: "' + xmx + '"', '      DB_HOST: db01.cpd.local', '    mem_limit: ' + mem, '    depends_on:', '      - redis', '  redis:', '    image: redis:7.2-alpine', '    container_name: facturacion-redis', '    restart: unless-stopped', '    mem_limit: 128m'];
const aMB = v => { const m = /^(\d+(?:\.\d+)?)\s*([kmgKMG])?/.exec(String(v || '')); if (!m) return 0; return parseFloat(m[1]) * ({ k: 1 / 1024, m: 1, g: 1024 }[(m[2] || 'm').toLowerCase()]); };
C.leerCompose = h => {
  const l = C.leer(h, '/opt/facturacion/docker-compose.yml') || [], txt = l.join('\n');
  const img = /image:\s*registry\.acme\.local\/facturacion:([\w.]+)/.exec(txt), xmx = /-Xmx(\d+[mMgG])/.exec(txt), mem = /facturacion:[\s\S]*?mem_limit:\s*(\S+)/.exec(txt);
  return { version: img ? img[1] : '?', xmx: xmx ? aMB(xmx[1]) : 0, xmxTxt: xmx ? xmx[1] : '', mem: mem ? aMB(mem[1]) : 0, memTxt: mem ? mem[1] : '' };
};
// La JVM necesita su heap más un 25 % (metaspace, hilos, buffers).
C.cabe = cfg => !cfg.mem || cfg.xmx * 1.25 <= cfg.mem;
C.contenedor = (h, n) => (h.extra.docker && h.extra.docker.c[n]) || null;
C.contenedorVivo = (h, n) => { const c = C.contenedor(h, n); return !!(c && h.svcs.docker.estado === 'active' && c.estado === 'running' && C.cabe(c.cfg)); };
C.contenedorReiniciando = (h, n) => { const c = C.contenedor(h, n); return !!(c && h.svcs.docker.estado === 'active' && c.estado === 'running' && !C.cabe(c.cfg)); };
C.recrear = (st, h, min) => {
  const cf = C.leerCompose(h), c = h.extra.docker.c.facturacion;
  const nuevo = { imagen: 'registry.acme.local/facturacion:' + cf.version, version: cf.version, id: U.hex('fact' + cf.version + cf.xmx + cf.mem + (min == null ? st.reloj : min), 12), cfg: { mem: cf.mem, xmx: cf.xmx, memTxt: cf.memTxt, xmxTxt: cf.xmxTxt }, estado: 'running', desde: min == null ? st.reloj : min, reinicios: 0, oom: false, puertos: '0.0.0.0:8090->8080/tcp' };
  h.extra.docker.c.facturacion = nuevo;
  return !c || c.id !== nuevo.id;
};
P.ticks.push(st => { const h = st.hosts.app01; if (!h.up || h.svcs.docker.estado !== 'active') return; Object.keys(h.extra.docker.c).forEach(n => { const c = h.extra.docker.c[n]; if (c.estado === 'running' && !C.cabe(c.cfg)) { c.reinicios++; c.oom = true; h.dmesg.push('[' + (8800 + st.reloj * 60).toFixed(6).padStart(12) + '] Memory cgroup out of memory: Killed process ' + U.pid('java' + st.reloj) + ' (java) total-vm:3489212kB, anon-rss:' + Math.round(c.cfg.mem * 1015) + 'kB, file-rss:21012kB, shmem-rss:0kB, UID:1000 pgtables:812kB oom_score_adj:0'); if (h.dmesg.length > 12) h.dmesg.shift(); } }); });
const estadoDocker = (st, c) => {
  if (c.estado !== 'running') return 'Exited (0) ' + U.hace(st.reloj - c.desde).replace(' ago', '') + ' ago';
  if (!C.cabe(c.cfg)) return 'Restarting (137) ' + (5 + (st.reloj % 4) * 11) + ' seconds ago';
  const m = st.reloj - c.desde; return 'Up ' + (m < 60 ? (m < 1 ? 'Less than a second' : m + ' minutes') : m < 1440 ? Math.floor(m / 60) + ' hours' : Math.floor(m / 1440) + ' days');
};
const logsJava = c => ['Picked up JAVA_TOOL_OPTIONS: ' + c.cfg.xmxTxt.replace(/^/, '-Xmx').replace('-Xmx-Xmx', '-Xmx'), '', '  .   ____          _            __ _ _', ' /\\\\ / ___\'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\', ' :: Spring Boot ::               (v3.3.4)', '', '2026-09-23 INFO 1 --- [main] c.a.f.FacturacionApplication : Starting FacturacionApplication v' + c.version + ' using Java 17.0.12', '2026-09-23 INFO 1 --- [main] c.a.f.FacturacionApplication : No active profile set, falling back to 1 default profile: "default"', '2026-09-23 INFO 1 --- [main] c.a.f.cache.ClientesCache    : Loading customer cache (184233 records)...'];
U.cmd('docker', { ayuda: T('contenedores: ps -a · logs · inspect · compose up -d', 'containers: ps -a · logs · inspect · compose up -d'), grupo: 'Docker', donde: ['app01'], fn: ctx => {
  const st = ctx.st, h = ctx.h, a = ctx.args, sub = a[0], D2 = h.extra.docker;
  if (!ctx.sudo) return [L('permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.46/containers/json": dial unix /var/run/docker.sock: connect: permission denied', 'err'), L(T('(admin no está en el grupo docker: usa sudo)', '(admin is not in the docker group: use sudo)'), 'dim')];
  if (h.svcs.docker.estado !== 'active') return [L('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?', 'err')];
  const nombre = a.slice(1).filter(x => x[0] !== '-' && !/\{\{/.test(x)).pop(), c = nombre && D2.c[nombre];
  const noHay = () => [L('Error response from daemon: No such container: ' + nombre, 'err')];
  if (sub === 'ps') {
    const todos = a.indexOf('-a') >= 0;
    const out = [L('CONTAINER ID   IMAGE                                    COMMAND                  CREATED        STATUS                         PORTS                    NAMES')];
    Object.keys(D2.c).forEach(n => { const x = D2.c[n], e = estadoDocker(st, x); if (!todos && /^Exited/.test(e)) return; out.push(L(x.id.slice(0, 12) + '   ' + x.imagen.padEnd(40) + ' ' + (/redis/.test(n) ? '"docker-entrypoint.s…"' : '"java -jar /app.jar"  ').padEnd(24) + ' ' + U.edad(st.reloj - x.desde).padEnd(14) + ' ' + e.padEnd(30) + ' ' + x.puertos.padEnd(24) + ' ' + n, /Restarting/.test(e) ? 'rojo' : 'out')); });
    return out;
  }
  if (sub === 'logs') { if (!c) return noHay(); if (/redis/.test(nombre)) return [L('1:M 23 Sep 2026 09:00:01.112 * Ready to accept connections tcp')]; const n = C.cabe(c.cfg) ? 1 : 3; let out = []; for (let i = 0; i < n; i++) out = out.concat(logsJava(c).map(t => L(t))); if (C.cabe(c.cfg)) out.push(L('2026-09-23 INFO 1 --- [main] c.a.f.FacturacionApplication : Started FacturacionApplication in 9.81 seconds')); const t = a.indexOf('--tail'); return t >= 0 ? out.slice(-(+a[t + 1] || 10)) : out; }
  if (sub === 'inspect') {
    if (!c) return noHay();
    const fi = a.findIndex(x => x === '-f' || x === '--format'), f = fi >= 0 ? a[fi + 1] : null;
    const v = { '.State.OOMKilled': String(!!c.oom && !C.cabe(c.cfg)), '.State.Status': C.cabe(c.cfg) ? 'running' : 'restarting', '.RestartCount': String(c.reinicios), '.HostConfig.Memory': String(Math.round(c.cfg.mem * 1048576)), '.State.ExitCode': C.cabe(c.cfg) ? '0' : '137', '.Config.Image': c.imagen };
    if (f) return [L(f.replace(/\{\{\s*([.\w]+)\s*\}\}/g, (m, k) => v[k] != null ? v[k] : '<no value>'))];
    return ['[', '    {', '        "Id": "' + c.id + U.hex(c.id, 52) + '",', '        "State": {', '            "Status": "' + v['.State.Status'] + '",', '            "Restarting": ' + !C.cabe(c.cfg) + ',', '            "OOMKilled": ' + v['.State.OOMKilled'] + ',', '            "ExitCode": ' + v['.State.ExitCode'], '        },', '        "RestartCount": ' + c.reinicios + ',', '        "Image": "' + c.imagen + '",', '        "HostConfig": {', '            "Memory": ' + v['.HostConfig.Memory'] + ',', '            "RestartPolicy": { "Name": "unless-stopped" }', '        }', '    }', ']'].map(t => L(t));
  }
  if (sub === 'restart' || sub === 'start') { if (!c) return noHay(); c.estado = 'running'; c.desde = st.reloj; return [L(nombre)]; }
  if (sub === 'stop') { if (!c) return noHay(); c.estado = 'exited'; c.desde = st.reloj; return [L(nombre)]; }
  if (sub === 'stats') return [L('CONTAINER ID   NAME                CPU %     MEM USAGE / LIMIT     MEM %     NET I/O')].concat(Object.keys(D2.c).map(n => { const x = D2.c[n], usa = C.cabe(x.cfg) ? Math.round(x.cfg.xmx * 1.1 || 9.4) : Math.round(x.cfg.mem * 0.99); return L(x.id.slice(0, 12) + '   ' + n.padEnd(19) + ' ' + (C.cabe(x.cfg) ? '0.41%' : '187.20%').padEnd(9) + ' ' + (usa + 'MiB / ' + Math.round(x.cfg.mem) + 'MiB').padEnd(21) + ' ' + (Math.round(usa / x.cfg.mem * 100) + '%').padEnd(9) + ' 1.2MB / 880kB', C.cabe(x.cfg) ? 'out' : 'rojo'); }));
  if (sub === 'images') return [L('REPOSITORY                          TAG       IMAGE ID       CREATED        SIZE'), L('registry.acme.local/facturacion     4.2.1     ' + U.hex('img421', 12) + '   6 days ago     412MB'), L('registry.acme.local/facturacion     4.1.3     ' + U.hex('img413', 12) + '   7 weeks ago    398MB'), L('redis                               7.2-alpine ' + U.hex('redis-img', 12) + '  2 months ago   40.7MB')];
  if (sub === 'compose') {
    const fi = a.indexOf('-f'), dir = fi >= 0 ? U.ruta(ctx.ses.cwd, a[fi + 1], ctx.ses).replace(/\/[^/]+$/, '') : ctx.ses.cwd;
    if (dir !== '/opt/facturacion') return [L('no configuration file provided: not found', 'err'), L(T('(el compose de facturación está en /opt/facturacion: cd /opt/facturacion o docker compose -f /opt/facturacion/docker-compose.yml …)', '(the billing compose file is in /opt/facturacion: cd /opt/facturacion or docker compose -f /opt/facturacion/docker-compose.yml …)'), 'dim')];
    const s2 = a[fi >= 0 ? 3 : 1];
    if (s2 === 'up') { const r = C.recrear(st, h); return [L('[+] Running 2/2'), L(' ✔ Container facturacion-redis  Running', 'verde'), L(' ✔ Container facturacion        ' + (r ? 'Recreated' : 'Running'), 'verde')]; }
    if (s2 === 'ps') return [L('NAME                IMAGE                                    SERVICE       STATUS')].concat(Object.keys(D2.c).map(n => L(n.padEnd(19) + ' ' + D2.c[n].imagen.padEnd(40) + ' ' + (n === 'facturacion' ? 'facturacion' : 'redis').padEnd(13) + ' ' + estadoDocker(st, D2.c[n]))));
    if (s2 === 'config') return (C.leer(h, '/opt/facturacion/docker-compose.yml') || []).map(t => L(t));
    if (s2 === 'restart') { Object.values(D2.c).forEach(x => { x.desde = st.reloj; }); return [L('[+] Restarting 2/2'), L(' ✔ Container facturacion-redis  Started'), L(' ✔ Container facturacion        Started')]; }
    return [L('Usage:  docker compose [OPTIONS] COMMAND')];
  }
  return [L('Usage:  docker [OPTIONS] COMMAND'), L(T('(en el simulador: ps, logs, inspect, restart, stats, images, compose up -d)', '(in the simulator: ps, logs, inspect, restart, stats, images, compose up -d)'), 'dim')];
} });

// ------------------------------------------------------------------ db01: reportd, ficheros abiertos y PostgreSQL
// Un fichero borrado que un proceso aún tiene abierto sigue ocupando sitio:
// df lo cuenta y du no. Eso es h.extra.abiertos.
const usadoMotor = U.usadoG;
U.usadoG = (h, m) => { const base = usadoMotor(h, m); const ab = (h.extra.abiertos || []).filter(x => U.montaje(h, x.ruta) === m).reduce((s, x) => s + x.mb, 0); return Math.min(h.discos[m].tamG, base + ab / 1024); };
C.nivelReportd = h => { const l = (C.leer(h, '/etc/reportd/reportd.conf') || []).find(x => /^\s*log_level\s*=/.test(x)); return l ? l.split('=')[1].trim() : 'info'; };
C.logReportd = h => h.extra.reportd.nivel === 'debug' ? '/var/log/acme/reportd-debug.log' : '/var/log/acme/reportd.log';
C.pidReportd = h => h.extra.reportd.pid;
// reportd lee su configuración al arrancar, y al parar cierra lo que tenía abierto.
P.alArrancar.push((st, h, u) => { if (u === 'reportd') { h.extra.reportd.nivel = C.nivelReportd(h); h.extra.reportd.pid = U.pid('reportd' + st.reloj); } });
P.alParar.push((st, h, u) => { if (u === 'reportd') h.extra.abiertos = (h.extra.abiertos || []).filter(x => x.proc !== 'reportd'); });
P.alApagar.push((st, h) => { if (h.extra.abiertos) h.extra.abiertos = []; });
// En debug escribe sin parar (25 MB por minuto), hasta que no quepa más.
P.ticks.push(st => { const h = st.hosts.db01; if (!h.up || h.svcs.reportd.estado !== 'active' || h.extra.reportd.nivel !== 'debug') return; if (U.pctDisco(h, '/var') >= 100) return; const p = C.logReportd(h), fantasma = (h.extra.abiertos || []).find(x => x.proc === 'reportd' && x.ruta === p); if (fantasma) fantasma.mb += 25; else h.logs[p] = (h.logs[p] || 0) + 25; });
C.varLlena = h => U.pctDisco(h, '/var') >= 100;
// rm de un log que un proceso tiene abierto: el nombre desaparece, el espacio no.
const rmMotor = P.comandos.rm.fn;
P.comandos.rm.fn = ctx => {
  const h = ctx.h;
  if (!ctx.sudo || h.nombre !== 'db01' || h.svcs.reportd.estado !== 'active') return rmMotor(ctx);
  const actual = C.logReportd(h), fs = P.vfs(ctx.st, h), rutas = [].concat(...ctx.args.filter(x => x[0] !== '-').map(r => U.glob(fs, ctx.ses.cwd, r, ctx.ses)));
  if (rutas.indexOf(actual) >= 0 && h.logs[actual] != null) { h.extra.abiertos.push({ pid: C.pidReportd(h), proc: 'reportd', user: 'report', fd: 7, ruta: actual, mb: h.logs[actual] }); }
  return rmMotor(ctx);
};
const truncMotor = P.comandos.truncate.fn;
P.comandos.truncate.fn = ctx => {
  const p = ctx.args.find(x => /^\/proc\/\d+\/fd\/\d+$/.test(x));
  if (!p) return truncMotor(ctx);
  const [, pid, fd] = /^\/proc\/(\d+)\/fd\/(\d+)$/.exec(p), x = (ctx.h.extra.abiertos || []).find(y => String(y.pid) === pid && String(y.fd) === fd);
  if (!ctx.sudo) return [L("truncate: cannot open '" + p + "' for writing: Permission denied", 'err'), L(U.SUDO, 'dim')];
  if (!x) return [L("truncate: cannot open '" + p + "' for writing: No such file or directory", 'err')];
  x.mb = 0; ctx.st.hechos['truncateFd:' + ctx.h.nombre] = true;
  return [];
};
U.cmd('lsof', { ayuda: T('ficheros abiertos (sudo lsof +L1: los borrados que siguen ocupando)', 'open files (sudo lsof +L1: deleted files still using space)'), fn: ctx => {
  const h = ctx.h, ab = h.extra.abiertos || [], cab = L('COMMAND     PID     USER   FD   TYPE DEVICE     SIZE/OFF NLINK    NODE NAME');
  const fila = x => L(x.proc.padEnd(10) + String(x.pid).padStart(5) + ' ' + x.user.padStart(8) + '   ' + (x.fd + 'w').padEnd(4) + ' REG  253,2 ' + String(Math.round(x.mb * 1048576)).padStart(14) + '     0 ' + (1308733 + x.fd) + ' ' + x.ruta + ' (deleted)', x.mb > 1024 ? 'rojo' : 'out');
  if (!ctx.sudo) return [L(T('(sin sudo, lsof sólo ve tus procesos: los de otros usuarios no salen)', '(without sudo, lsof only sees your own processes: other users\' do not show up)'), 'dim')];
  if (ctx.args.indexOf('+L1') >= 0) return [cab].concat(ab.map(fila));
  const pi = ctx.args.indexOf('-p');
  const vivos = Object.keys(h.svcs).filter(u => h.svcs[u].estado === 'active').map(u => L(U.binario(u).slice(0, 9).padEnd(10) + String(U.pid(h.nombre + u + h.svcs[u].desde)).padStart(5) + '     root  cwd    DIR  253,0         4096     2       2 /'));
  if (pi >= 0) return [cab].concat(ab.filter(x => String(x.pid) === ctx.args[pi + 1]).map(fila));
  return [cab].concat(vivos, ab.map(fila));
} });
U.cmd('kill', { fn: ctx => {
  const pid = ctx.args.filter(x => /^\d+$/.test(x))[0], h = ctx.h;
  if (!pid) return [L('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]', 'err')];
  const u = Object.keys(h.svcs).find(x => h.svcs[x].estado === 'active' && (String(U.pid(h.nombre + x + h.svcs[x].desde)) === pid || (x === 'reportd' && String(h.extra.reportd.pid) === pid)));
  if (!u) return [L('bash: kill: (' + pid + ') - No such process', 'err')];
  if (!ctx.sudo) return [L('bash: kill: (' + pid + ') - Operation not permitted', 'err'), L(U.SUDO, 'dim')];
  P.parar(ctx.st, h, u); U.logSvc(h, u, ctx.st.reloj, 'systemd[1]', u + '.service: Main process exited, code=killed, status=15/TERM');
  return [];
} });
P.comandos.pkill = { fn: () => [L(T('(usa kill con el PID, o mejor systemctl stop)', '(use kill with the PID, or better systemctl stop)'), 'dim')] };
// psql: por socket local en db01 (como postgres) o por red con -h.
C.pgHba = h => (C.leer(h, '/etc/postgresql/14/main/pg_hba.conf') || []).map(l => l.trim()).filter(l => l && l[0] !== '#').map(l => l.split(/\s+/));
C.pgPermite = (st, ipOrigen, usuario, bd) => {
  const reglas = st.hosts.db01.extra.hbaCargado || C.pgHba(st.hosts.db01);
  for (const r of reglas) {
    if (r[0] !== 'host') continue;
    const okBd = r[1] === 'all' || r[1] === bd, okU = r[2] === 'all' || r[2] === usuario;
    const [red, bits] = r[3].split('/'), b = +bits;
    const enRed = b === 0 || (b === 32 ? red === ipOrigen : b === 24 ? ipOrigen.split('.').slice(0, 3).join('.') === red.split('.').slice(0, 3).join('.') : false);
    if (okBd && okU && enRed) return r[4];
  }
  return 'reject';
};
P.alArrancar.push((st, h, u) => { if (u === 'postgresql') h.extra.hbaCargado = C.pgHba(h); });
P.recargar.postgresql = (st, h) => { h.extra.hbaCargado = C.pgHba(h); U.logSvc(h, 'postgresql', st.reloj, 'systemd[1]', 'Reloading PostgreSQL RDBMS...'); U.logSvc(h, 'postgresql', st.reloj, 'systemd[1]', 'Reloaded PostgreSQL RDBMS.'); return null; };
P.alCrear.push(st => { st.hosts.db01.extra.hbaCargado = C.pgHba(st.hosts.db01); });
C.sql = (st, h, sql) => {
  const s = (sql || '').trim().replace(/;$/, '');
  if (/^select 1$/i.test(s)) return [' ?column? ', '----------', '        1', '(1 row)', ''];
  if (/^select count\(\*\) from pedidos$/i.test(s)) return [' count  ', '--------', ' 184233', '(1 row)', ''];
  if (/^insert into/i.test(s)) return C.varLlena(h) ? ['ERROR:  could not extend file "base/16384/16402": No space left on device', 'HINT:  Check free disk space.'] : ['INSERT 0 1'];
  if (/^select pg_reload_conf\(\)$/i.test(s)) { P.recargar.postgresql(st, h); return [' pg_reload_conf ', '----------------', ' t', '(1 row)', '']; }
  if (/^\\l$/.test(s)) return ['                              List of databases', '   Name    |  Owner   | Encoding |   Collate   |    Ctype', '-----------+----------+----------+-------------+-------------', ' pedidos   | pedidos  | UTF8     | es_ES.UTF-8 | es_ES.UTF-8', ' postgres  | postgres | UTF8     | es_ES.UTF-8 | es_ES.UTF-8', '(2 rows)', ''];
  return ['ERROR:  ' + T('(el simulador entiende SELECT 1, SELECT count(*) FROM pedidos, INSERT INTO ..., SELECT pg_reload_conf() y \\l)', '(the simulator understands SELECT 1, SELECT count(*) FROM pedidos, INSERT INTO ..., SELECT pg_reload_conf() and \\l)')];
};
U.cmd('psql', { ayuda: T('PostgreSQL: psql -h db01 -U usuario -d base -c "SELECT 1"', 'PostgreSQL: psql -h db01 -U user -d db -c "SELECT 1"'), grupo: T('Bases de datos', 'Databases'), fn: ctx => {
  const a = ctx.args, op = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const host = op('-h'), usuario = op('-U') || ctx.como || ctx.ses.usuario || 'admin', bd = op('-d') || usuario, sql = op('-c');
  const db = ctx.st.hosts.db01;
  const fin = l => { const out = l.map(t => L(t, /^(ERROR|FATAL)/.test(t) ? 'err' : 'out')); return out; };
  if (!host) {
    if (ctx.h.nombre !== 'db01') return [L('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory', 'err'), L('\tIs the server running locally and accepting connections on that socket?', 'err')];
    if (db.svcs.postgresql.estado !== 'active') return [L('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory', 'err')];
    if (ctx.como !== 'postgres') return [L('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  role "' + usuario + '" does not exist', 'err'), L(T('(por socket local se entra como el usuario del sistema postgres: sudo -u postgres psql ...)', '(over the local socket you log in as the system user postgres: sudo -u postgres psql ...)'), 'dim')];
    return sql ? fin(C.sql(ctx.st, db, sql)) : [L(T('(sin -c no hay sesión interactiva en el simulador: añade -c "SELECT 1")', '(without -c there is no interactive session in the simulator: add -c "SELECT 1")'), 'dim')];
  }
  const hn = C.resolver(ctx.st, host, ctx.h.nombre);
  if (hn !== 'db01') return [L('psql: error: connection to server at "' + host + '", port 5432 failed: Connection refused', 'err')];
  if (!db.up || db.svcs.postgresql.estado !== 'active') return [L('psql: error: connection to server at "' + host + '" (' + db.ip + '), port 5432 failed: Connection refused', 'err'), L('\tIs the server running on that host and accepting TCP/IP connections?', 'err')];
  const ip = ctx.h.nombre === 'db01' ? '127.0.0.1' : ctx.h.ip, metodo = C.pgPermite(ctx.st, ip, usuario, bd);
  if (metodo === 'reject') return [L('psql: error: connection to server at "' + host + '" (' + db.ip + '), port 5432 failed: FATAL:  pg_hba.conf rejects connection for host "' + ip + '", user "' + usuario + '", database "' + bd + '", SSL encryption', 'err')];
  ctx.ses.pendiente = { prompt: 'Password for user ' + usuario + ': ', oculto: true, responder: () => ({ lineas: sql ? fin(C.sql(ctx.st, db, sql)) : [L(T('(sin -c no hay sesión interactiva en el simulador)', '(without -c there is no interactive session in the simulator)'), 'dim')] }) };
  return { lineas: [], minutos: 0 };
} });
P.generadoresLog.push((st, h, p) => {
  if (h.nombre === 'db01' && /postgresql-14-main\.log$/.test(p)) return C.varLlena(h) ? [U.iso(st.reloj - 3).replace('T', ' ') + '.112 UTC [' + U.pid('pgw') + '] pedidos@pedidos ERROR:  could not extend file "base/16384/16402": No space left on device', U.iso(st.reloj - 3).replace('T', ' ') + '.112 UTC [' + U.pid('pgw') + '] pedidos@pedidos HINT:  Check free disk space.', U.iso(st.reloj - 2).replace('T', ' ') + '.540 UTC [' + U.pid('pgc') + '] LOG:  could not write to file "pg_wal/xlogtemp.' + U.pid('pgc') + '": No space left on device'] : [U.iso(st.reloj - 4).replace('T', ' ') + '.002 UTC [' + U.pid('pgck') + '] LOG:  checkpoint complete: wrote 412 buffers (2.5%); 0 WAL file(s) added, 0 removed, 1 recycled'];
  if (h.nombre === 'db01' && /\/acme\/reportd(-debug)?\.log$/.test(p)) return /debug/.test(p) ? [U.sello(st.reloj - 1) + ' reportd[' + C.pidReportd(h) + ']: DEBUG query plan for informe_ventas_diarias: Seq Scan on pedidos (cost=0.00..18421.33 rows=184233)', U.sello(st.reloj - 1) + ' reportd[' + C.pidReportd(h) + ']: DEBUG row 18842/184233 serialized (412 bytes)'] : [U.sello(st.reloj - 30) + ' reportd[' + C.pidReportd(h) + ']: INFO informe_ventas_diarias generated in 4.1s'];
  return null;
});

// ------------------------------------------------------------------ chrony y Ansible
// El chrony estándar del CPD apunta a los NTP internos. El que trae cada distribución, al pool público.
C.chronyConf = h => h.extra.ntpConf === 'estandar'
  ? ['# Ansible managed', 'server ntp1.cpd.local iburst', 'server ntp2.cpd.local iburst', 'driftfile /var/lib/chrony/drift', 'makestep 1.0 3', 'rtcsync']
  : ['# Use public servers from the pool.ntp.org project.', 'pool ' + ({ rocky: '2.rocky.pool.ntp.org', debian: '2.debian.pool.ntp.org', ubuntu: 'ntp.ubuntu.com', sles: '2.suse.pool.ntp.org' })[h.extra.distro] + ' iburst', 'driftfile /var/lib/chrony/drift', 'makestep 1.0 3', 'rtcsync'];
U.cmd('chronyc', { ayuda: 'NTP: chronyc tracking / sources', fn: ctx => {
  const h = ctx.h, sub = ctx.args[0] || 'tracking';
  if (!(h.svcs.chrony && h.svcs.chrony.estado === 'active')) return [L('506 Cannot talk to daemon', 'err')];
  const off = h.ntp.offset, us = (off >= 0 ? '+' : '-') + Math.round(Math.abs(off) * 1e6) + 'us', est = h.extra.ntpConf === 'estandar';
  if (sub === 'sources') return [L('MS Name/IP address         Stratum Poll Reach LastRx Last sample'), L('===============================================================================')].concat(est ? [L('^* ntp1.cpd.local                2   6   377    23   ' + us + '[' + us + '] +/-  812us', Math.abs(off) >= 0.05 ? 'rojo' : 'out'), L('^- ntp2.cpd.local                2   6   377    41   +121us[ +124us] +/- 1203us')] : [L('^* 162.159.200.123               3  10   377   612   ' + us + '[' + us + '] +/-   18ms', Math.abs(off) >= 0.05 ? 'rojo' : 'out'), L('^- 193.145.15.15                 2  10   377   488   +1203us[+1203us] +/-   24ms')]);
  if (sub === 'tracking') return [L('Reference ID    : ' + (est ? '0A0A0005 (ntp1.cpd.local)' : 'A29FC87B (162.159.200.123)')), L('Stratum         : ' + (est ? 3 : 4)), L('System time     : ' + Math.abs(off).toFixed(9) + ' seconds ' + (off >= 0 ? 'fast' : 'slow') + ' of NTP time', Math.abs(off) >= 0.05 ? 'rojo' : 'verde'), L('Leap status     : Normal')];
  if (sub === 'makestep') { const d = U.sinRoot(ctx, ['501 Not authorised']); if (d) return d; h.ntp.offset = 0.000011; return [L('200 OK')]; }
  return [L('Unrecognized command', 'err')];
} });
C.playbookChrony = () => ['---', '- name: ' + T('NTP estándar del CPD (chrony contra ntp1/ntp2.cpd.local)', 'Datacenter standard NTP (chrony against ntp1/ntp2.cpd.local)'), '  hosts: all', '  become: true', '  vars:', "    chrony_conf: \"{{ '/etc/chrony/chrony.conf' if ansible_os_family == 'Debian' else '/etc/chrony.conf' }}\"", "    chrony_svc: \"{{ 'chrony' if ansible_os_family == 'Debian' else 'chronyd' }}\"", '  tasks:', '    - name: ' + T('chrony.conf con los NTP internos', 'chrony.conf with the internal NTP servers'), '      ansible.builtin.template:', '        src: templates/chrony.conf.j2', '        dest: "{{ chrony_conf }}"', '      notify: restart chrony', '    - name: ' + T('chrony habilitado y en marcha', 'chrony enabled and running'), '      ansible.builtin.service:', '        name: "{{ chrony_svc }}"', '        state: started', '        enabled: true', '  handlers:', '    - name: restart chrony', '      ansible.builtin.service:', '        name: "{{ chrony_svc }}"', '        state: restarted'];
C.inventario = st => {
  const l = C.leer(st.hosts.mgmt01, U.HOME + '/ansible/inventory.ini') || [];
  const g = { all: [] }; let act = null;
  l.forEach(x => { const t = x.trim(); if (!t || t[0] === '#') return; const m = /^\[([\w-]+)\]$/.exec(t); if (m) { act = m[1]; g[act] = g[act] || []; return; } const n = t.split(/\s+/)[0]; if (act) g[act].push(n); if (g.all.indexOf(n) < 0) g.all.push(n); });
  return g;
};
const alcanzable = (st, n) => { const h = st.hosts[n]; if (!h) return 'Failed to connect to the host via ssh: ssh: Could not resolve hostname ' + n + ': Name or service not known'; if (!h.up) return 'Failed to connect to the host via ssh: ssh: connect to host ' + n + ' port 22: No route to host'; if (!h.extra.claveMgmt) return 'Failed to connect to the host via ssh: admin@' + n + ': Permission denied (publickey,password).'; return null; };
const sinInventario = () => [L('[WARNING]: No inventory was parsed, only implicit localhost is available', 'ambar'), L('[WARNING]: provided hosts list is empty, only localhost is available. Note that the implicit localhost does not match \'all\'', 'ambar'), L(T('(ansible.cfg está en ~/ansible: haz cd ~/ansible, o pasa -i ~/ansible/inventory.ini)', '(ansible.cfg lives in ~/ansible: cd ~/ansible, or pass -i ~/ansible/inventory.ini)'), 'dim')];
const objetivo = (st, patron, lim) => { const g = C.inventario(st); let hs = []; (patron || 'all').split(/[:,]/).forEach(p => { hs = hs.concat(g[p] || (g.all.indexOf(p) >= 0 ? [p] : [])); }); if (lim) hs = hs.filter(n => lim.split(/[:,]/).indexOf(n) >= 0); return hs.filter((x, i) => hs.indexOf(x) === i); };
const enAnsible = ctx => ctx.ses.cwd === U.HOME + '/ansible' || ctx.args.indexOf('-i') >= 0;
U.cmd('ansible', { ayuda: T('órdenes sueltas: ansible all -m ping', 'ad-hoc commands: ansible all -m ping'), grupo: 'Ansible', donde: ['mgmt01'], fn: ctx => {
  const st = ctx.st, a = ctx.args;
  if (!enAnsible(ctx)) return sinInventario();
  const mi = a.indexOf('-m'), mod = mi >= 0 ? a[mi + 1] : 'command', ai = a.indexOf('-a'), arg = ai >= 0 ? a[ai + 1] : '';
  const hs = objetivo(st, a.find((x, i) => x[0] !== '-' && ['-m', '-a', '-i', '-l', '-u'].indexOf(a[i - 1]) < 0));
  const out = [];
  hs.forEach(n => {
    const e = alcanzable(st, n);
    if (e) { out.push(L(n + ' | UNREACHABLE! => {', 'rojo'), L('    "changed": false,', 'rojo'), L('    "msg": "' + e + '",', 'rojo'), L('    "unreachable": true', 'rojo'), L('}', 'rojo')); return; }
    if (mod === 'ping') { out.push(L(n + ' | SUCCESS => {', 'verde'), L('    "changed": false,', 'verde'), L('    "ping": "pong"', 'verde'), L('}', 'verde')); return; }
    if (mod === 'shell' || mod === 'command') {
      const r = P.correrEn(st, n, arg, { sudo: a.indexOf('-b') >= 0 || a.indexOf('--become') >= 0 });
      out.push(L(n + ' | ' + (r.fallo ? 'FAILED | rc=1' : 'CHANGED | rc=0') + ' >>', r.fallo ? 'rojo' : 'ambar'));
      r.lineas.forEach(l => out.push(L(l.t, l.c === 'err' ? 'rojo' : 'out')));
      return;
    }
    out.push(L(n + ' | FAILED! => { "msg": "' + T('(el simulador sólo tiene los módulos ping, shell y command)', '(the simulator only has the ping, shell and command modules)') + '" }', 'rojo'));
  });
  return { lineas: out, minutos: 1 };
} });
U.cmd('ansible-playbook', { ayuda: T('aplica un playbook (--check --diff para simular)', 'apply a playbook (--check --diff to dry-run)'), grupo: 'Ansible', donde: ['mgmt01'], fn: ctx => {
  const st = ctx.st, a = ctx.args, pb = a.find(x => /\.ya?ml$/.test(x));
  if (!pb) return [L('usage: ansible-playbook [-h] [--version] [-v] [--check] [--diff] ... playbook [playbook ...]', 'err')];
  if (!enAnsible(ctx)) return sinInventario().concat([L('PLAY [' + T('NTP estándar del CPD (chrony contra ntp1/ntp2.cpd.local)', 'Datacenter standard NTP (chrony against ntp1/ntp2.cpd.local)') + '] ***********************************'), L('skipping: no hosts matched')]);
  const ruta = U.ruta(U.HOME + '/ansible', pb, ctx.ses);
  if (!C.leer(st.hosts.mgmt01, ruta)) return [L('ERROR! the playbook: ' + pb + ' could not be found', 'err')];
  if (!/chrony\.yml$/.test(ruta)) return [L(T('(en este CPD el único playbook es chrony.yml)', '(in this datacenter the only playbook is chrony.yml)'), 'dim')];
  const check = a.indexOf('--check') >= 0 || a.indexOf('-C') >= 0, diff = a.indexOf('--diff') >= 0 || a.indexOf('-D') >= 0;
  const li = a.indexOf('-l') >= 0 ? a.indexOf('-l') : a.indexOf('--limit'), lim = li >= 0 ? a[li + 1] : null;
  const hs = objetivo(st, 'all', lim), out = [], recap = {};
  const tarea = t => { out.push(L('')); out.push(L('TASK [' + t + '] ' + '*'.repeat(Math.max(3, 60 - t.length)))); };
  out.push(L('PLAY [' + T('NTP estándar del CPD (chrony contra ntp1/ntp2.cpd.local)', 'Datacenter standard NTP (chrony against ntp1/ntp2.cpd.local)') + '] ***********************************'));
  tarea('Gathering Facts');
  const vivos = [];
  hs.forEach(n => { const e = alcanzable(st, n); recap[n] = { ok: 0, changed: 0, unreachable: 0 }; if (e) { recap[n].unreachable = 1; out.push(L('fatal: [' + n + ']: UNREACHABLE! => {"changed": false, "msg": "' + e + '", "unreachable": true}', 'rojo')); } else { recap[n].ok++; vivos.push(n); out.push(L('ok: [' + n + ']', 'verde')); } });
  tarea(T('chrony.conf con los NTP internos', 'chrony.conf with the internal NTP servers'));
  const cambian = [];
  vivos.forEach(n => {
    const h = st.hosts[n], cambia = h.extra.ntpConf !== 'estandar'; recap[n].ok++;
    if (!cambia) { out.push(L('ok: [' + n + ']', 'verde')); return; }
    recap[n].changed++; cambian.push(n); out.push(L('changed: [' + n + ']', 'ambar'));
    if (diff) { const antes = C.chronyConf(h), ahora = C.chronyConf({ extra: { ntpConf: 'estandar', distro: h.extra.distro } }), dest = C.fam(h) === 'debian' ? '/etc/chrony/chrony.conf' : '/etc/chrony.conf'; out.push(L('--- before: ' + dest)); out.push(L('+++ after: /home/admin/.ansible/tmp/ansible-local/chrony.conf.j2')); antes.forEach(x => { if (ahora.indexOf(x) < 0) out.push(L('-' + x, 'rojo')); }); ahora.forEach(x => { if (antes.indexOf(x) < 0) out.push(L('+' + x, 'verde')); }); }
    if (!check) h.extra.ntpConf = 'estandar';
  });
  tarea(T('chrony habilitado y en marcha', 'chrony enabled and running'));
  vivos.forEach(n => {
    const h = st.hosts[n], s = h.svcs.chrony, cambia = s.estado !== 'active' || !s.enabled; recap[n].ok++;
    if (!cambia) { out.push(L('ok: [' + n + ']', 'verde')); return; }
    recap[n].changed++; out.push(L('changed: [' + n + ']', 'ambar'));
    if (!check) { s.enabled = true; if (s.estado !== 'active') { s.limite = false; P.arrancar(st, h, 'chrony'); } }
  });
  if (cambian.length) {
    out.push(L('')); out.push(L('RUNNING HANDLER [restart chrony] ' + '*'.repeat(28)));
    cambian.forEach(n => { const h = st.hosts[n]; recap[n].ok++; recap[n].changed++; out.push(L('changed: [' + n + ']', 'ambar')); if (!check) { P.reiniciarUnidad(st, h, 'chrony'); h.ntp.offset = Math.sign(h.ntp.offset || 1) * Math.min(Math.abs(h.ntp.offset), 0.02); } });
  }
  out.push(L('')); out.push(L('PLAY RECAP ' + '*'.repeat(62)));
  hs.forEach(n => { const r = recap[n]; out.push(L(n.padEnd(26) + ': ok=' + r.ok + '    changed=' + r.changed + '    unreachable=' + r.unreachable + '    failed=0    skipped=0    rescued=0    ignored=0', r.unreachable ? 'rojo' : r.changed ? 'ambar' : 'verde')); });
  st.hechos.playbooks.push({ pb: 'chrony.yml', check, changed: hs.reduce((s, n) => s + recap[n].changed, 0), unreachable: hs.reduce((s, n) => s + recap[n].unreachable, 0), min: st.reloj });
  return { lineas: out, minutos: check ? 1 : 2 };
} });

// ------------------------------------------------------------------ mgmt01: la documentación del equipo
C.leeme = () => [T('# CPD · normas del equipo de sistemas (N2/N3)', '# Datacenter · systems team rules (L2/L3)'), '',
  T('Todo empieza en mgmt01: desde aquí entras por ssh a cada servidor (con tu clave) y lanzas Ansible.', 'Everything starts on mgmt01: from here you ssh into each server (with your key) and run Ansible.'), '',
  T('## El parque', '## The estate'),
  '  mgmt01  Debian 12     ' + T('gestión: Ansible, Prometheus, Alertmanager', 'management: Ansible, Prometheus, Alertmanager'),
  '  web01   Rocky 9       ' + T('tienda.acme.es (nginx → Tomcat 8080). SELinux enforcing, firewalld', 'tienda.acme.es (nginx → Tomcat 8080). SELinux enforcing, firewalld'),
  '  web02   SLES 15 SP5   ' + T('portal.clienteb.com (nginx + TLS)', 'portal.clienteb.com (nginx + TLS)'),
  '  web03   Rocky 9       ' + T('intranet.clientec.com (Apache). SELinux enforcing', 'intranet.clientec.com (Apache). SELinux enforcing'),
  '  app01   Debian 12     ' + T('facturación en Docker (/opt/facturacion), Tomcat de informes', 'billing in Docker (/opt/facturacion), reporting Tomcat'),
  '  db01    Ubuntu 22.04  ' + T('PostgreSQL 14 (pedidos de ACME) y reportd', 'PostgreSQL 14 (ACME orders) and reportd'),
  '  db02    Rocky 9       ' + T('MariaDB y su copia nocturna (/backup/mariadb)', 'MariaDB and its nightly backup (/backup/mariadb)'), '',
  T('## Normas', '## Rules'),
  T('- Antes de escribir dnf o apt, mira qué hay: hostnamectl. Cada familia tiene su gestor de paquetes.', '- Before typing dnf or apt, check what is there: hostnamectl. Each family has its own package manager.'),
  T('- SELinux se queda en enforcing. setenforce 0 no es una solución: es apagar la alarma.', '- SELinux stays in enforcing. setenforce 0 is not a fix: it is switching the alarm off.'),
  T('- firewalld: lo que no lleva --permanent se pierde en el siguiente reload o reinicio.', '- firewalld: anything without --permanent is lost on the next reload or reboot.'),
  T('- nginx -t antes de cualquier reload. Y reload, no restart, si la web está sirviendo.', '- nginx -t before any reload. And reload, not restart, while the site is serving.'),
  T('- No se borra un log que un proceso tiene abierto: el espacio no vuelve. Se vacía con truncate, o se reinicia el proceso.', '- Do not delete a log a process has open: the space does not come back. Empty it with truncate, or restart the process.'),
  T('- Sudo con mínimo privilegio: una regla por fichero en /etc/sudoers.d, validada con visudo.', '- Least-privilege sudo: one rule per file in /etc/sudoers.d, checked with visudo.'),
  T('- Antes de reiniciar: systemctl is-enabled de lo que corre. Lo arrancado a mano no vuelve solo.', '- Before rebooting: systemctl is-enabled for whatever is running. Things started by hand do not come back by themselves.'),
  T('- Ansible: --check --diff antes de aplicar, y una segunda pasada tiene que dar changed=0.', '- Ansible: --check --diff before applying, and a second run must give changed=0.'), '',
  T('## Monitorización', '## Monitoring'),
  T('  Alertas activas: amtool alert. Las sondas de las webs salen de aquí, de mgmt01.', '  Active alerts: amtool alert. The website probes run from here, from mgmt01.')];

// ------------------------------------------------------------------ alertas (Prometheus + blackbox desde mgmt01)
C.salud = (st, a) => {
  if (a.url) {
    const r = C.http(st, P.entrada, a.url, {});
    if (r.err) return { ok: false, corto: r.err.code === 60 ? 'TLS' : r.err.code === 28 ? 'timeout' : r.err.code === 56 ? 'reset' : r.err.code === 7 ? 'refused' : 'error', msg: r.err.msg };
    return r.codigo < 400 ? { ok: true, corto: String(r.codigo) } : { ok: false, corto: String(r.codigo), msg: 'HTTP ' + r.codigo };
  }
  if (a.bd) { const h = st.hosts[a.host]; if (!h.up || h.svcs.postgresql.estado !== 'active') return { ok: false, corto: 'down', msg: 'PostgreSQL down' }; return C.varLlena(h) ? { ok: false, corto: T('sin escritura', 'no writes'), msg: T('no puede escribir: /var lleno', 'cannot write: /var is full') } : { ok: true, corto: 'OK' }; }
  if (a.copias) { const c = st.hosts.db02.extra.copias, u = c[c.length - 1]; return u && u.mb > 1 ? { ok: true, corto: U.tam(u.mb) } : { ok: false, corto: u ? U.tam(u.mb) : '—', msg: T('la última copia está vacía', 'the latest backup is empty') }; }
  return { ok: true, corto: 'OK' };
};
P.detectores.push((st, add) => {
  C.apps.forEach(a => {
    if (!a.url) return;
    const r = C.http(st, P.entrada, a.url, {});
    if (r.err && r.err.code === 60 && /expired/.test(r.err.msg)) add('SSLCertExpired', 'critical', a.host, a.url.replace(/\/$/, '') + T(': el certificado caducó', ': the certificate has expired'));
    else if (r.err) add('BlackboxProbeFailed', 'critical', a.host, a.url.replace(/\/$/, '') + ': ' + r.err.msg.slice(0, 70));
    else if (r.codigo >= 400) add('BlackboxProbeHttpFailure', 'critical', a.host, a.url.replace(/\/$/, '') + ' → HTTP ' + r.codigo);
  });
  const app = st.hosts.app01;
  if (app.up && app.svcs.docker.estado === 'active') Object.keys(app.extra.docker.c).forEach(n => { if (C.contenedorReiniciando(app, n)) add('ContainerRestarting', 'warning', 'app01', n + T(' se reinicia sin parar (' + app.extra.docker.c[n].reinicios + ' veces)', ' keeps restarting (' + app.extra.docker.c[n].reinicios + ' times)'), 'ContainerRestarting|' + n); });
  Object.values(st.hosts).forEach(h => {
    if (!h.up || !h.svcs.node_exporter) return;
    const des = st.hosts[P.entrada];
    if (h.svcs.node_exporter.estado !== 'active' || !C.fwPermite(st, h, 9100, des.ip)) add('TargetDown', 'warning', h.nombre, h.nombre + ':9100 node_exporter' + T(' no responde a Prometheus', ' is not answering Prometheus'));
  });
});
U.cmd('amtool', { ayuda: T('alertas activas (amtool alert)', 'active alerts (amtool alert)'), grupo: T('Monitorización', 'Monitoring'), donde: ['mgmt01'], fn: ctx => {
  const al = P.alertasActivas(ctx.st);
  if (!al.length) return [L('Alertname                 Starts At                Summary'), L(T('(ninguna alerta activa)', '(no active alerts)'), 'dim')];
  return [L('Alertname                 Starts At                Summary')].concat(al.map(a => L(a.nombre.padEnd(25) + ' ' + U.iso(a.desde).replace('T', ' ').slice(0, 16) + ' UTC     ' + (a.host ? a.host + ' · ' : '') + a.res, a.sev === 'critical' ? 'rojo' : a.sev === 'warning' ? 'ambar' : 'out')));
} });
P.comandos.amtool.completar = () => ['alert'];
P.comandos.docker.completar = (st, ses, pal) => pal.length ? ['facturacion', 'facturacion-redis', '-a', 'up', '-d', '--tail'] : ['ps', 'logs', 'inspect', 'restart', 'stats', 'images', 'compose'];
P.comandos['firewall-cmd'].completar = () => ['--list-all', '--list-ports', '--permanent', '--add-port=', '--add-service=', '--reload', '--state'];
P.comandos.dnf.completar = () => ['check-update', 'updateinfo', 'list', '--security', 'upgrade', '-y', 'history'];
P.comandos.ansible.completar = () => ['all', 'web', 'app', 'db', '-m', 'ping', 'shell', '-a', '-b'];
P.comandos['ansible-playbook'].completar = () => ['chrony.yml', '--check', '--diff', '-l'];
})(window.PUESTO = window.PUESTO || {});
