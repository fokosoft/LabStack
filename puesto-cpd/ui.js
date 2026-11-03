// Puesto CPD · lo que cambia en la interfaz del Puesto (../puesto-linux/app.js).
//
// La interfaz es la misma: cola, terminal, ticket, ITSM, pistas, cierre e
// informe. Aquí sólo va lo propio del CPD: la oferta, la bienvenida, los
// experimentos y los paneles de la izquierda. El primero es el que da sentido
// al puesto: los clientes y sus aplicaciones, con el estado que ve Prometheus.
// Se carga antes que app.js.
(function (P) {
'use strict';
const T = P.T, U = P.u, C = P.cpd;
const ETQ = { rocky: 'Rocky 9', debian: 'Debian 12', ubuntu: 'Ubuntu 22.04', sles: 'SLES 15' };

function panelApps({ st, h }) {
  const grupos = {};
  C.apps.forEach(a => { (grupos[a.cliente] = grupos[a.cliente] || []).push(a); });
  const filas = Object.keys(grupos).map(cl => `<p class="grupo-t">${h(cl)}</p>` + grupos[cl].map(a => {
    const s = C.salud(st, a), e = s.ok ? 'ok' : 'fallo';
    const tit = (a.url ? a.url + ' · ' : '') + a.pila + ' · ' + a.host + (s.msg ? ' · ' + s.msg : '');
    const dentro = `<i class="punto"></i><b>${h(a.nombre)}</b><span>${h(a.host + ' · ' + s.corto)}</span>`;
    return a.url ? `<button class="host ancho e-${e}" data-act="escribir" data-cmd="${h('curl -I ' + a.url)}" title="${h(tit)}">${dentro}</button>` : `<div class="host ancho e-${e}" title="${h(tit)}">${dentro}</div>`;
  }).join('')).join('');
  const malas = C.apps.filter(a => !C.salud(st, a).ok).length;
  return `<section class="panel"><h3>${T('Clientes y aplicaciones', 'Customers and applications')} <span class="der-n">${malas ? malas + T(' con fallo', ' failing') : T('todo bien', 'all good')}</span></h3>${filas}</section>`;
}
function panelServidores({ st, h }) {
  const filas = P.topologia.map(d => {
    const x = st.hosts[d.n], e = P.estadoHost(st, x);
    const corre = Object.keys(x.svcs).filter(u => ['ssh', 'chrony', 'node_exporter', 'firewalld', 'containerd', 'crond', 'alertmanager'].indexOf(u) < 0);
    const nota = !x.up ? T('reiniciando…', 'rebooting…') : ETQ[d.distro] + (corre.length ? ' · ' + corre[0] : '');
    return `<button class="host ancho e-${e}" data-act="ssh" data-host="${h(d.n)}" title="${h(T('Abrir una sesión en ', 'Open a session on ') + d.n + ' · ' + x.ip + ' · ' + C.distro(x).bonito)}"><i class="punto"></i><b>${h(d.n)}</b><span>${h(nota)}</span></button>`;
  }).join('');
  const arriba = Object.values(st.hosts).filter(x => x.up).length;
  return `<section class="panel"><h3>${T('Servidores', 'Servers')} <span class="der-n">${arriba}/${P.topologia.length} up</span></h3>${filas}</section>`;
}
function panelDiscos({ st, h }) {
  const vigilados = [['db01', '/var'], ['db02', '/backup'], ['web01', '/var'], ['app01', '/']];
  const barras = vigilados.map(([n, m]) => {
    const x = st.hosts[n], pc = U.pctDisco(x, m);
    return `<div class="osd ${pc >= 95 ? 'caido' : pc >= 80 ? 'lleno' : ''}" title="${h(n + ' ' + m + ' · ' + x.discos[m].tamG + 'G')}"><b>${h(n)}</b><span class="osd-bar"><i style="width:${pc}%"></i></span><em>${pc} %</em></div>`;
  }).join('');
  return `<section class="panel"><h3>${T('Disco', 'Disk')} <span class="der-n">/var · /backup · /</span></h3>${barras}</section>`;
}

// La sala: una miniatura en vivo en la columna izquierda y, al tocarla, a pantalla grande.
let salaAbierta = false, ultimoSt = null;
function pintarSala() {
  const c = typeof document !== 'undefined' && document.getElementById('cs-cuerpo');
  if (c && ultimoSt) c.innerHTML = C.salaSvg(ultimoSt);
}
function abrirSala() {
  if (salaAbierta || !ultimoSt) return;
  salaAbierta = true;
  const v = document.createElement('div');
  v.className = 'cs-velo'; v.id = 'cs-velo';
  v.innerHTML = '<div class="cs-caja" role="dialog" aria-label="' + T('Sala del CPD', 'Datacenter room') + '"><div class="cs-cab"><b>' + T('Sala del CPD', 'Datacenter room') + '</b><span>' + T('estado en vivo · toca un servidor para abrir una sesión, o una aplicación para pedirla con curl', 'live state · tap a server to open a session, or an application to request it with curl') + '</span><button data-act="salaCerrar">' + T('Cerrar', 'Close') + '</button></div><div class="cs-cuerpo" id="cs-cuerpo"></div></div>';
  document.body.appendChild(v);
  pintarSala();
}
function cerrarSala() { const v = document.getElementById('cs-velo'); if (v) v.remove(); salaAbierta = false; }
if (typeof document !== 'undefined') {
  document.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('[data-act]');
    if (ev.target.id === 'cs-velo') { cerrarSala(); return; }
    if (!b) return;
    if (b.dataset.act === 'salaVer') abrirSala();
    else if (b.dataset.act === 'salaCerrar') cerrarSala();
    else if (salaAbierta && (b.dataset.act === 'ssh' || b.dataset.act === 'escribir') && b.closest('#cs-velo')) setTimeout(cerrarSala, 0);
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && salaAbierta) cerrarSala(); });
}
function panelSala({ st }) {
  ultimoSt = st;
  if (salaAbierta) setTimeout(pintarSala, 0);
  return `<section class="panel"><h3>${T('Sala del CPD', 'Datacenter room')} <span class="der-n">${T('ampliar', 'enlarge')} ⤢</span></h3><button class="cs-panel" data-act="salaVer" title="${T('Ver la sala a pantalla grande', 'See the room full size')}" aria-label="${T('Ver la sala a pantalla grande', 'See the room full size')}">${C.salaSvg(st)}</button></section>`;
}

P.ui = {
  clave: 'puesto-cpd-v1',
  claveImp: P.compositorCfg.claveImp,
  oferta: {
    tag: T('📌 Puesto', '📌 Job opening'),
    titulo: T('Técnico/a de Sistemas Linux N2/N3', 'Linux Systems Engineer (L2/L3)'),
    sub: T('Proveedor de servicios gestionados · CPD propio · guardias', 'Managed services provider · own datacenter · on-call'),
    txt: T('Administrar el CPD de un proveedor de hosting gestionado: servidores Linux de varias familias (Rocky, Debian, Ubuntu y SUSE) en los que corren las aplicaciones de los clientes. Resolver incidencias N2/N3, mantener la seguridad y el bastionado, parchear sin romper nada y automatizar con Ansible. Cada función del puesto tiene sus tickets:', 'Run a managed hosting provider\'s datacenter: Linux servers from several families (Rocky, Debian, Ubuntu and SUSE) running the customers\' applications. Resolve L2/L3 incidents, keep security and hardening in place, patch without breaking anything and automate with Ansible. Each duty of the role has its own tickets:'),
  },
  como: [
    T('<b>Un CPD simulado</b>: siete servidores de cuatro distribuciones y tres clientes con lo suyo (una tienda con nginx y Tomcat, un portal con HTTPS, una intranet con SELinux, facturación en Docker, PostgreSQL y MariaDB con sus copias), Prometheus vigilándolo todo y Ansible desde el nodo de gestión. La sala del CPD los enseña en sus racks, en vivo.', '<b>A simulated datacenter</b>: seven servers from four distributions and three customers with their own things (a store on nginx and Tomcat, a portal with HTTPS, an intranet with SELinux, billing in Docker, PostgreSQL and MariaDB with their backups), Prometheus watching everything and Ansible from the management node. The datacenter room shows them in their racks, live.'),
    T('<b>Arreglas con comandos reales</b>: ssh, curl, systemctl, journalctl, dnf, apt, zypper, getsebool, ausearch, firewall-cmd, openssl, docker, psql, lsof, visudo, ansible-playbook… Y cada familia con lo suyo: dnf no existe en Debian.', '<b>You fix things with real commands</b>: ssh, curl, systemctl, journalctl, dnf, apt, zypper, getsebool, ausearch, firewall-cmd, openssl, docker, psql, lsof, visudo, ansible-playbook… And each family with its own: dnf does not exist on Debian.'),
    T('<b>Se comprueba el estado</b>, no el camino. Luego se valora cómo llegaste: las buenas prácticas del oficio.', '<b>The end state is checked</b>, not the path. Then how you got there is scored: the good practices of the trade.'),
  ],
  guardia: true, importar: true, caos: true,
  bienvenida: modo => modo === 'guardia'
    ? [T('Te ha saltado la guardia. No hay ticket: sólo lo que ve Prometheus.', 'You have been paged. There is no ticket: only what Prometheus sees.'), T('Estás en mgmt01. Para orientarte: amtool alert · la sala del CPD · los paneles de la izquierda', 'You are on mgmt01. To get your bearings: amtool alert · the datacenter room · the panels on the left')]
    : modo === 'libre'
    ? [T('Laboratorio libre: el CPD está sano y no hay ticket.', 'Free lab: the datacenter is healthy and there is no ticket.'), T('Estás en mgmt01, el nodo de gestión. Empieza por cat ~/LEEME.md', 'You are on mgmt01, the management node. Start with cat ~/LEEME.md')]
    : [T('Estás en mgmt01, el nodo de gestión: desde aquí entras por ssh a cada servidor y lanzas Ansible.', 'You are on mgmt01, the management node: from here you ssh into each server and run Ansible.'), T('Para orientarte: amtool alert · cat ~/LEEME.md · los paneles de la izquierda (toca un servidor para abrir una sesión)', 'To get your bearings: amtool alert · cat ~/LEEME.md · the panels on the left (tap a server to open a session)')],
  sesionNueva: T('Nueva sesión en mgmt01', 'New session on mgmt01'),
  alertas: T('Alertas (Prometheus)', 'Alerts (Prometheus)'),
  paneles: ctx => panelSala(ctx) + panelApps(ctx) + panelServidores(ctx) + panelDiscos(ctx),
  experimentos: [
    ['cat ~/LEEME.md', T('El parque y las normas del equipo.', 'The estate and the team\'s rules.')],
    ['curl -I http://tienda.acme.es', T('La tienda de ACME vista desde fuera, como la ve la sonda de Prometheus.', 'ACME\'s store seen from outside, as the Prometheus probe sees it.')],
    ['curl -m 3 http://web01:8080', T('Tomcat desde mgmt01: el cortafuegos de web01 lo descarta (timeout). Desde el propio web01, curl localhost:8080 sí responde.', 'Tomcat from mgmt01: web01\'s firewall drops it (timeout). From web01 itself, curl localhost:8080 does answer.')],
    ['ssh web01', T('Entra en un Rocky: getenforce, getsebool httpd_can_network_connect, sudo firewall-cmd --list-all. Prueba a apagar el booleano (sin -P) y pide la tienda.', 'Log into a Rocky host: getenforce, getsebool httpd_can_network_connect, sudo firewall-cmd --list-all. Try switching the boolean off (without -P) and request the store.')],
    ['hostnamectl', T('En qué sistema estás. Repítelo en cada servidor antes de escribir dnf, apt o zypper.', 'Which system you are on. Repeat it on every server before typing dnf, apt or zypper.')],
    ['openssl s_client -connect portal.clienteb.com:443 -servername portal.clienteb.com | openssl x509 -noout -dates', T('Las fechas del certificado que sirve el portal de Cliente B.', 'The dates of the certificate Cliente B\'s portal is serving.')],
    ['ssh app01', T('Facturación: sudo docker ps, sudo docker stats --no-stream, cat /opt/facturacion/docker-compose.yml.', 'Billing: sudo docker ps, sudo docker stats --no-stream, cat /opt/facturacion/docker-compose.yml.')],
    ['ssh db01', T('PostgreSQL y reportd: df -h, sudo lsof +L1, sudo -u postgres psql -d pedidos -c "SELECT count(*) FROM pedidos".', 'PostgreSQL and reportd: df -h, sudo lsof +L1, sudo -u postgres psql -d pedidos -c "SELECT count(*) FROM pedidos".')],
    ['ssh web03', T('La intranet: ls -Z /srv/www/intranet y matchpathcon /srv/www/intranet/index.html. ¿De dónde sale esa etiqueta? sudo semanage fcontext -l -C', 'The intranet: ls -Z /srv/www/intranet and matchpathcon /srv/www/intranet/index.html. Where does that label come from? sudo semanage fcontext -l -C')],
    ['ssh web02', T('Un SUSE: zypper list-patches, y nginx -t con sudo.', 'A SUSE host: zypper list-patches, and nginx -t with sudo.')],
    ['cd ~/ansible', T('Desde aquí: ansible all -m ping y ansible-playbook chrony.yml --check --diff.', 'From here: ansible all -m ping and ansible-playbook chrony.yml --check --diff.')],
    ['amtool alert', T('Lo que ve Prometheus ahora mismo.', 'What Prometheus sees right now.')],
  ],
};
})(window.PUESTO = window.PUESTO || {});
