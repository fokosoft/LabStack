// Comprueba el Puesto CPD sin navegador.
//
//   node puesto-cpd/cpd-test.js
//
// Como en los otros puestos, lo importante no es que arranque: es que cada
// ticket se resuelva con comandos de verdad, que los arreglos a medias NO lo
// cierren y que el CPD se comporte como uno de verdad. SELinux sin -P se
// pierde al reiniciar, un fichero borrado pero abierto sigue ocupando disco,
// sudo no alcanza a la redirección, docker restart no lee el compose, y cada
// familia de Linux tiene su gestor de paquetes.
const fs = require('fs'), path = require('path');
const D = __dirname, LINUX = path.join(D, '..', 'puesto-linux');
function cargar(idioma) {
  const win = { PUESTO: { idioma } };
  [path.join(D, 'topologia.js'), path.join(LINUX, 'motor.js'), path.join(D, 'sistema.js'), path.join(D, 'servicios.js'), path.join(D, 'operacion.js'), path.join(D, 'averias.js'), path.join(D, 'escenarios.js'), path.join(LINUX, 'incidencias.js'), path.join(D, 'guardia.js'), path.join(D, 'soluciones.js'), path.join(D, 'sala-cpd.js'), path.join(D, 'ui.js')]
    .forEach(f => new Function('window', fs.readFileSync(f, 'utf8'))(win));
  return win.PUESTO;
}
const P = cargar('es'), C = P.cpd, U = P.u;

let fallos = 0;
const mal = m => { console.error('  ✕ ' + m); fallos++; };
const bien = m => console.log('  ✓ ' + m);
function correr(P, st, cmds, ses) {
  ses = ses || P.nuevaSesion();
  const salida = [];
  cmds.forEach(c => { const r = P.ejecutar(st, ses, c); salida.push({ cmd: c, lineas: r.lineas }); P.expulsar(st, ses); });
  return { ses, salida, texto: salida.map(x => '$ ' + x.cmd + '\n' + x.lineas.map(l => l.t).join('\n')).join('\n') };
}
const texto = (r, i) => r.salida[i].lineas.map(l => l.t).join('\n');
const tienda = st => { const r = C.http(st, 'mgmt01', 'http://tienda.acme.es/', {}); return r.err ? 'err' + r.err.code : r.codigo; };

console.log('Puesto CPD · Sistemas Linux N2/N3\n');

// ------------------------------------------------------------ el CPD sano
console.log('  CPD de partida:');
{
  const st = P.crear(), n0 = fallos;
  const al = P.alertasActivas(st);
  if (al.length) mal('el CPD sano ya tiene alertas: ' + al.map(a => a.nombre + '/' + a.host).join(', '));
  C.apps.forEach(a => { if (!C.salud(st, a).ok) mal('la aplicación ' + a.id + ' no está sana al empezar: ' + C.salud(st, a).msg); });
  P.avanzar(st, 30);
  if (P.alertasActivas(st).length) mal('al dejar pasar media hora aparecen alertas: ' + P.alertasActivas(st).map(a => a.nombre).join(', '));
  const r = correr(P, st, ['ssh web01', 'cat /etc/os-release', 'dnf check-update', 'apt update', 'exit', 'ssh app01', 'apt list --upgradable', 'dnf check-update', 'exit', 'ssh web02', 'zypper list-patches', 'exit', 'ssh web01', 'systemctl status chronyd', 'exit', 'ssh app01', 'systemctl status chrony', 'exit']);
  if (!/Rocky Linux 9\.4/.test(texto(r, 1))) mal('web01 no dice ser Rocky en /etc/os-release');
  if (!/command not found/.test(texto(r, 3)) || /command not found/.test(texto(r, 2))) mal('dnf y apt no respetan la familia en web01 (Rocky)');
  if (/command not found/.test(texto(r, 6)) || !/command not found/.test(texto(r, 7))) mal('apt y dnf no respetan la familia en app01 (Debian)');
  if (/command not found/.test(texto(r, 10))) mal('zypper no existe en web02 (SUSE)');
  if (!/chronyd\.service/.test(texto(r, 13)) || !/● chrony\.service/.test(texto(r, 16))) mal('el servicio de hora no se llama chronyd en Rocky y chrony en Debian');
  if (fallos === n0) bien('sin alertas, seis aplicaciones sanas, y cada distribución con su gestor de paquetes y sus nombres de servicio');
}

// ------------------------------------------------------------ la mecánica
console.log('\n  el CPD se comporta como un CPD:');
{
  const n0 = fallos;
  // 1. Un cortafuegos descarta (timeout); un puerto sin nadie escuchando se rechaza (refused).
  let st = P.crear();
  let r = correr(P, st, ['curl -m 3 http://web01:8080', 'ssh web01', 'curl -I http://localhost:8080', 'sudo systemctl stop tomcat', 'curl -I http://localhost:8080', 'curl -I http://localhost', 'exit']);
  if (!/\(28\)/.test(texto(r, 0))) mal('desde mgmt01, Tomcat de web01 tendría que dar timeout (lo filtra firewalld)');
  if (!/200/.test(texto(r, 2)) || !/Connection refused/.test(texto(r, 4)) || !/502/.test(texto(r, 5))) mal('Tomcat parado no da refused en local y 502 a través de nginx');
  // 2. SELinux: sin -P se pierde al reiniciar; setenforce 0 lo «arregla».
  st = P.crear(); st.hosts.web01.extra.se.bools.httpd_can_network_connect = { v: false, p: false };
  if (tienda(st) !== 502) mal('sin el booleano, la tienda no da 502');
  correr(P, st, ['ssh web01', 'sudo setsebool httpd_can_network_connect on', 'exit']);
  if (tienda(st) !== 200) mal('setsebool sin -P no arregla la tienda en el momento');
  correr(P, st, ['ssh web01', 'sudo reboot', 'sleep 300']);
  if (tienda(st) !== 502) mal('tras reiniciar, un setsebool sin -P debería perderse');
  correr(P, st, ['ssh web01', 'sudo setenforce 0', 'exit']);
  if (tienda(st) !== 200 || C.enforcing(st.hosts.web01)) mal('setenforce 0 debería «arreglar» la tienda dejando SELinux en permissive');
  // 3. Etiquetas: restorecon sigue la política; chcon dura hasta el siguiente restorecon.
  st = P.crear(); const w3 = st.hosts.web03; w3.extra.se.fcontext = [];
  const intranet = () => { const x = C.http(st, 'mgmt01', 'http://intranet.clientec.com/', {}); return x.codigo; };
  if (intranet() !== 403) mal('sin la regla fcontext, /srv/www es var_t y la intranet tendría que dar 403');
  correr(P, st, ['ssh web03', 'sudo chcon -R -t httpd_sys_content_t /srv/www', 'exit']);
  if (intranet() !== 200) mal('chcon debería arreglarlo en el momento');
  correr(P, st, ['ssh web03', 'sudo restorecon -Rv /srv/www', 'exit']);
  if (intranet() !== 403) mal('restorecon sin la regla fcontext debería devolver var_t (y el 403)');
  r = correr(P, st, ['ssh web03', 'sudo semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?"', 'sudo restorecon -Rv /srv/www', 'exit']);
  if (intranet() !== 200 || !/Relabeled \/srv\/www\/intranet\/index\.html/.test(texto(r, 2))) mal('semanage fcontext + restorecon -Rv no arregla la intranet de forma persistente');
  // 4. firewalld: --permanent sin --reload no aplica; sin --permanent se pierde al recargar.
  st = P.crear(); const w1 = st.hosts.web01;
  r = correr(P, st, ['ssh web01', 'sudo firewall-cmd --permanent --add-port=8080/tcp', 'exit', 'curl -m 3 http://web01:8080']);
  if (!/\(28\)/.test(texto(r, 3))) mal('--permanent sin --reload no debería abrir nada todavía');
  r = correr(P, st, ['ssh web01', 'sudo firewall-cmd --reload', 'exit', 'curl -I http://web01:8080']);
  if (!/200/.test(texto(r, 3))) mal('tras --reload, lo guardado con --permanent debería aplicarse');
  correr(P, st, ['ssh web01', 'sudo firewall-cmd --add-port=9999/tcp', 'sudo firewall-cmd --reload', 'exit']);
  if (w1.extra.fw.runtime.puertos.indexOf('9999/tcp') >= 0) mal('un puerto abierto sin --permanent tendría que perderse con --reload');
  // 5. Un log borrado que reportd tiene abierto sigue ocupando disco.
  st = P.crear(); const db = st.hosts.db01; db.logs['/var/log/acme/reportd.log'] = 9000;
  const p0 = U.pctDisco(db, '/var');
  correr(P, st, ['ssh db01', 'sudo rm /var/log/acme/reportd.log', 'exit']);
  if (U.pctDisco(db, '/var') < p0) mal('borrar un log abierto no debería liberar espacio');
  r = correr(P, st, ['ssh db01', 'sudo lsof +L1', 'sudo systemctl restart reportd', 'exit']);
  if (!/reportd\.log \(deleted\)/.test(texto(r, 1)) || U.pctDisco(db, '/var') >= p0) mal('lsof +L1 debería enseñar el borrado, y reiniciar reportd liberar el espacio');
  // 6. sudo no alcanza a la redirección; sh -c y tee sí.
  st = P.crear();
  r = correr(P, st, ['ssh web02', 'sudo cat /etc/hostname > /etc/nginx/ssl/prueba.txt', 'sudo sh -c "cat /etc/hostname > /etc/nginx/ssl/prueba.txt"', 'echo hola | sudo tee /etc/nginx/ssl/otra.txt', 'sudo cat /etc/nginx/ssl/otra.txt', 'exit']);
  if (!/Permission denied/.test(texto(r, 1))) mal('sudo cat > fichero de root tendría que fallar: la redirección la hace tu shell');
  if (!C.leer(st.hosts.web02, '/etc/nginx/ssl/prueba.txt') || !/hola/.test(texto(r, 4))) mal('sudo sh -c "…>…" y | sudo tee tendrían que escribir el fichero');
  // 7. nginx: reload con la clave equivocada falla y sigue sirviendo; restart lo deja caído.
  st = P.crear(); const w2 = st.hosts.web02;
  r = correr(P, st, ['ssh web02', 'sudo sh -c "cat /etc/nginx/ssl/portal.crt > /tmp/x"', 'echo x | sudo tee /etc/nginx/ssl/portal.key', 'sudo nginx -t', 'sudo systemctl reload nginx', 'exit']);
  if (!/test failed/.test(texto(r, 3)) || w2.svcs.nginx.estado !== 'active' || !C.salud(st, C.apps.find(a => a.id === 'portal')).ok) mal('un reload con la clave rota tendría que fallar y dejar el portal sirviendo');
  correr(P, st, ['ssh web02', 'sudo systemctl restart nginx', 'exit']);
  if (w2.svcs.nginx.estado !== 'failed') mal('un restart con la clave rota tendría que dejar nginx en failed');
  // 8. Docker: restart no lee el compose; compose up -d sí.
  st = P.crear(); P.aplicarAverias(st, [{ tipo: 'contenedor-oom', version: '4.2.1', xmx: '512m', hace: 30 }]);
  correr(P, st, ['ssh app01', 'sudo sed -i \'s/mem_limit: 256m/mem_limit: 1g/\' /opt/facturacion/docker-compose.yml', 'sudo docker restart facturacion', 'exit']);
  if (C.contenedorVivo(st.hosts.app01, 'facturacion')) mal('docker restart no debería aplicar el compose nuevo');
  r = correr(P, st, ['ssh app01', 'cd /opt/facturacion', 'sudo docker compose up -d', 'exit']);
  if (!C.contenedorVivo(st.hosts.app01, 'facturacion') || !/Recreated/.test(texto(r, 2))) mal('docker compose up -d tendría que recrear el contenedor con el límite nuevo');
  // 9. apt: sin update no ve nada; apt-get upgrade deja el kernel kept back.
  st = P.crear(); P.aplicarAverias(st, [{ tipo: 'parches-pendientes', host: 'app01' }]);
  r = correr(P, st, ['ssh app01', 'apt list --upgradable', 'sudo apt-get update', 'sudo apt-get upgrade -y', 'exit']);
  if (/linux-image/.test(texto(r, 1))) mal('sin apt update, apt list --upgradable no debería ver nada');
  if (!/kept back/.test(texto(r, 3)) || st.hosts.app01.kernelNuevo) mal('apt-get upgrade tendría que dejar el kernel kept back');
  // 10. useradd según la familia, y sudoers con punto.
  st = P.crear();
  correr(P, st, ['ssh app01', 'sudo useradd pepe', 'exit', 'ssh web01', 'sudo useradd pepe', 'exit']);
  const pd = st.hosts.app01.extra.usuarios.pepe, pr = st.hosts.web01.extra.usuarios.pepe;
  if (!pd || pd.conHome || pd.shell !== '/bin/sh' || !pr || !pr.conHome || pr.shell !== '/bin/bash') mal('useradd sin opciones: en Debian sin home y /bin/sh, en Rocky con home y bash');
  r = correr(P, st, ['ssh app01', 'sudo useradd -m -s /bin/bash ana', 'sudo visudo -f /etc/sudoers.d/ana.conf', 'ana ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat', 'sudo -l -U ana', 'sudo visudo -f /etc/sudoers.d/ana', 'ana ALL=(root) NOPASSWD: /usr/bin/systemctl restart tomcat', 'exit', 'ssh ana@app01', 'x', 'sudo systemctl restart tomcat', 'sudo systemctl restart nginx', 'exit']);
  if (!/not allowed to run sudo/.test(texto(r, 4))) mal('sudo debería ignorar /etc/sudoers.d/ana.conf (lleva punto)');
  if (texto(r, 10).trim() || !/Sorry, user ana is not allowed to execute '\/usr\/bin\/systemctl restart nginx'/.test(texto(r, 11))) mal('ana debería poder reiniciar tomcat y no nginx');
  // 11. Ansible: fuera de ~/ansible no hay inventario; la segunda pasada no cambia nada.
  st = P.crear(); P.aplicarAverias(st, [{ tipo: 'ntp-sin-estandar', hosts: ['web01', 'db02'] }]);
  r = correr(P, st, ['ansible all -m ping', 'cd ~/ansible', 'ansible-playbook chrony.yml --check', 'ansible-playbook chrony.yml', 'ansible-playbook chrony.yml', 'cd']);
  if (!/No inventory was parsed/.test(texto(r, 0))) mal('fuera de ~/ansible, ansible no debería encontrar el inventario');
  if (st.hechos.playbooks[0].changed === 0 || st.hechos.playbooks[1].changed === 0 || st.hechos.playbooks[2].changed !== 0) mal('el playbook tendría que cambiar en --check y la primera vez, y nada la segunda');
  // 12. LVM: sin sitio en el grupo no crece; un LV más grande no agranda el XFS hasta xfs_growfs.
  st = P.crear(); const w = st.hosts.web01;
  r = correr(P, st, ['ssh web01', 'sudo lvextend -L 35G /dev/rl/var', 'sudo vgextend rl /dev/sdb', 'sudo lvextend -L 35G /dev/rl/var', 'df -h /var', 'sudo resize2fs /dev/rl/var', 'sudo xfs_growfs /var', 'df -h /var', 'exit']);
  if (!/Insufficient free space/.test(texto(r, 1))) mal('lvextend sin sitio en el grupo tendría que fallar');
  if (!/ 20G /.test(texto(r, 4)) || !/Bad magic number/.test(texto(r, 5)) || !/ 35G /.test(texto(r, 7)) || w.extra.lvm.lvs.var.tamG !== 35) mal('el XFS no debería crecer hasta xfs_growfs (y resize2fs no sirve en XFS)');
  // 13. MariaDB: # sin comillas es un comentario; el script dice OK aunque mysqldump falle.
  st = P.crear(); P.aplicarAverias(st, [{ tipo: 'backup-credenciales', clave: 'Bk-Nov2026#', noches: 1 }]);
  r = correr(P, st, ['ssh db02', 'sudo /usr/local/bin/backup-mariadb.sh', 'sudo sed -i \'s/^password=.*/password=Bk-Nov2026#/\' /root/.backup.cnf', 'sudo mysql --defaults-extra-file=/root/.backup.cnf -e "SELECT 1"', 'sudo sed -i \'s/^password=.*/password="Bk-Nov2026#"/\' /root/.backup.cnf', 'sudo mysql --defaults-extra-file=/root/.backup.cnf -e "SELECT 1"', 'exit']);
  if (!/1045/.test(texto(r, 1)) || !/OK backup completed/.test(texto(r, 1))) mal('el script tendría que decir OK aunque mysqldump falle con 1045');
  if (!/1045/.test(texto(r, 3)) || !/\| 1 \|/.test(texto(r, 5))) mal('sin comillas, # tendría que cortar la contraseña; con comillas, valer');
  // 14. SSH: quitar las contraseñas sin la clave deja fuera; la consola sigue entrando.
  st = P.crear(); P.aplicarAverias(st, [{ tipo: 'sin-clave', host: 'web02' }]);
  r = correr(P, st, ['ssh web02', 'x', 'sudo sed -i \'s/^PasswordAuthentication .*/PasswordAuthentication no/\' /etc/ssh/sshd_config', 'sudo systemctl reload sshd', 'exit', 'ssh web02', 'console web02', 'whoami', 'exit']);
  if (!/Permission denied \(publickey\)/.test(texto(r, 5)) || !/^root$/m.test(texto(r, 7))) mal('sin clave y sin contraseñas, ssh tendría que dejarte fuera y la consola seguir entrando');
  // 15. La sala se dibuja en el estado de cada ticket: los siete servidores, sus aplicaciones, sin NaN.
  P.escenarios.forEach(e => {
    const s2 = P.preparar(e), svg = C.salaSvg(s2);
    if (/NaN|undefined/.test(svg)) mal('la sala de ' + e.id + ' tiene NaN o undefined');
    P.topologia.forEach(d => { if (svg.indexOf('data-host="' + d.n + '"') < 0) mal('la sala de ' + e.id + ' no dibuja ' + d.n); });
    C.apps.forEach(a => { if (svg.indexOf(C.salud(s2, a).ok ? 'var(--ok)' : 'var(--bad)') < 0) mal('la sala de ' + e.id + ' no pinta el estado de ' + a.id); });
  });
  if (fallos === n0) bien('LVM (sin sitio no crece, el XFS hasta xfs_growfs), la copia que dice OK sin serlo, # en un fichero de opciones, el bloqueo de SSH y la consola, la sala en el estado de cada ticket, timeout frente a refused, SELinux (-P, setenforce, chcon frente a fcontext), firewalld (runtime frente a permanente), ficheros borrados pero abiertos, sudo y la redirección, nginx (reload frente a restart), docker (restart frente a compose up), apt kept back, useradd según la familia, sudoers con punto e idempotencia en Ansible');
}

// ------------------------------------------------------------ tickets
function probarTickets(P, etiqueta) {
  let malos = 0;
  if (P.escenarios.length !== 13) { mal(etiqueta + 'se esperaban 13 tickets y hay ' + P.escenarios.length); malos++; }
  P.escenarios.forEach(e => {
    const st = P.preparar(e), antes = e.resuelto(st, P), al = P.alertasActivas(st);
    if (!antes.length) { mal(etiqueta + e.id + ': nace resuelto'); malos++; return; }
    if (e.tipo === 'incidente' && !al.length) { mal(etiqueta + e.id + ': un incidente sin alertas'); malos++; }
    const pr = P.prioridad(e);
    if (e.tipo === 'incidente' && -e.abierto >= pr.sla / 2) { mal(etiqueta + e.id + ': nace con más de medio SLA gastado'); malos++; }
    if (!e.pistas || e.pistas.length !== 3) { mal(etiqueta + e.id + ': no tiene exactamente 3 pistas'); malos++; }
    if (!e.funciones.every(f => P.funciones.some(x => x.id === f))) { mal(etiqueta + e.id + ': función desconocida'); malos++; }
    const g = P.guionDe(e, st), r = correr(P, st, g);
    const raros = r.salida.filter(x => x.lineas.some(l => /: command not found|unknown command|Unknown command|^Usage:|^usage:/.test(l.t)));
    if (raros.length) { mal(etiqueta + e.id + ': su guion usa comandos que no existen: ' + raros.map(x => x.cmd).join(', ')); malos++; }
    const q = e.resuelto(st, P);
    if (q.length) { mal(etiqueta + e.id + ': su guion no lo resuelve: ' + q.join(' | ')); malos++; }
    const np = e.practicas.filter(p => !p.ok(st));
    if (np.length) { mal(etiqueta + e.id + ': su guion no cumple sus prácticas: ' + np.map(p => p.t).join(' | ')); malos++; }
    const st2 = P.preparar(e), r2 = correr(P, st2, P.guionDe(e, st2));
    if (r2.texto !== r.texto) { mal(etiqueta + e.id + ': el mismo guion da salidas distintas'); malos++; }
    (e.trampas || []).forEach((t, i) => {
      const s3 = P.preparar(e), cmds = typeof t.cmds === 'function' ? t.cmds(s3) : t.cmds;
      correr(P, s3, cmds);
      if (t.practicas) { const pr3 = e.practicas.map(p => p.ok(s3)); if (!t.practicas.some(k => !pr3[k])) { mal(etiqueta + e.id + ' trampa ' + (i + 1) + ': debería fallar la práctica ' + t.practicas.join(',')); malos++; } }
      else if (!e.resuelto(s3, P).length) { mal(etiqueta + e.id + ' trampa ' + (i + 1) + ' lo cierra: ' + t.porque); malos++; }
    });
  });
  return malos;
}
console.log('\n  tickets:');
{
  const E = cargar('en');
  if (!(probarTickets(P, '') + probarTickets(E, '[en] '))) bien(P.escenarios.length + ' tickets: nacen rotos (los incidentes con alertas), su guion los cierra con todas sus prácticas, siempre igual, y sus ' + P.escenarios.reduce((s, e) => s + (e.trampas || []).length, 0) + ' trampas no los cierran; en los dos idiomas');
}

// ------------------------------------------------------------ guardias y caos
console.log('\n  guardias y caos:');
{
  const n0 = fallos;
  P.familias.forEach(f => { if (!f.leccion || !f.titulo) mal('la familia ' + f.id + ' no tiene título o lección'); for (let s = 1; s <= 5; s++) { const e = P.validarAverias(f.crear(P.azar(s))); if (e.length) mal('la familia ' + f.id + ' no valida con la semilla ' + s + ': ' + e.join(' | ')); } });
  [1, 2, 3].forEach(n => {
    if (!P.familias.some(f => f.nivel === n)) mal('no hay familias de nivel ' + n);
    for (let s = 1; s <= 30; s++) {
      const semilla = s * 7919, g = P.generarGuardia(n, semilla);
      if (!g.ok) { mal('nivel ' + n + ' semilla ' + semilla + ': no sale una guardia jugable'); continue; }
      // El generador descarta en silencio lo que no se cierra: así se escondía el fallo de httpd. Aquí no se descarta nada.
      if (g.intentos !== 1) mal('nivel ' + n + ' semilla ' + semilla + ': el generador tuvo que descartar ' + (g.intentos - 1) + ' noches');
      const e = g.escenario, st = P.preparar(e);
      if (!P.alertasActivas(st).length) mal('guardia ' + e.id + ': sin alertas, no se puede jugar');
      if (e.guardia.familias.length !== n || P.familias.find(f => f.id === e.guardia.familias[0]).nivel !== n) mal('guardia ' + e.id + ': no es de nivel ' + n);
      if (P.validarAverias(e.def.averias).length) mal('guardia ' + e.id + ': su fichero no valida');
      const r = correr(P, st, P.guionDe(e, st));
      if (e.resuelto(st, P).length) mal('guardia ' + e.id + ': su guion no la cierra: ' + e.resuelto(st, P)[0]);
      const np = e.practicas.filter(p => !p.ok(st)); if (np.length) mal('guardia ' + e.id + ': su guion no cumple ' + np[0].t);
      if (s % 5 === 0) { const g2 = P.generarGuardia(n, semilla), st2 = P.preparar(g2.escenario), r2 = correr(P, st2, P.guionDe(g2.escenario, st2)); if (r2.texto !== r.texto) mal('guardia ' + e.id + ': la misma semilla da otra noche'); }
    }
  });
  let caos = 0;
  for (let s = 1; s <= 20; s++) {
    const st = P.crear(), c = P.provocarCaos(st, s * 101, []);
    if (!c) { mal('el caos ' + s + ' no provoca nada'); continue; }
    if (P.pendientesCaos(st, [c]).length) mal('el caos ' + s + ' rompe antes de tiempo');
    P.avanzar(st, 6);
    if (!P.pendientesCaos(st, [c]).length) { mal('el caos ' + s + ' (' + c.familia.id + ') no rompe nada'); continue; }
    correr(P, st, c.familia.arreglo(st, c.params));
    if (P.pendientesCaos(st, [c]).length) mal('el caos ' + s + ' (' + c.familia.id + '): su arreglo no lo cierra'); else caos++;
  }
  if (fallos === n0) bien(P.familias.length + ' familias; 90 guardias (30 semillas × 3 niveles): jugables, con alertas, de su nivel, válidas como fichero, cerradas por su guion con sus prácticas y la misma noche con la misma semilla; ' + caos + ' caos que rompen a su hora y se arreglan');
}

// ------------------------------------------------------------ catálogo de averías
console.log('\n  catálogo de averías:');
{
  const n0 = fallos;
  Object.keys(P.averias).forEach(id => {
    const t = P.averias[id];
    if (!t.ejemplo) { mal(id + ': sin ejemplo'); return; }
    Object.keys(t.params).forEach(k => { if (!(P.camposAveria[id] || []).some(c => c.k === k)) mal(id + ': el parámetro ' + k + ' no tiene campo en el compositor'); });
    const a = Object.assign({ tipo: id }, t.ejemplo), st = P.crear();
    const e = P.validarAverias([a]); if (e.length) { mal(id + ': su ejemplo no valida: ' + e.join(' | ')); return; }
    t.aplicar(st, a);
    if (!t.condicion && !t.pendientes(st, a).length) mal(id + ': aplicado no rompe nada');
    correr(P, st, P.arregloAverias(st, [a]));
    if (t.condicion) return;
    const q = t.pendientes(st, a), al = P.alertasActivas(st).filter(x => x.sev !== 'info');
    if (q.length) mal(id + ': su arreglo no lo deja sano: ' + q.join(' | '));
    if (al.length) mal(id + ': tras su arreglo siguen alertas: ' + al.map(x => x.nombre + '/' + x.host).join(', '));
  });
  // No sólo el ejemplo: cada avería con cada servidor posible. El ejemplo de servicio-caido es Tomcat,
  // y por eso nadie vio que en web03 systemctl no encontraba httpd.
  const SRV = ['web01', 'web02', 'web03', 'app01', 'db01', 'db02'];
  const todas = C.SERVICIOS_CAIBLES.map(([host, servicio]) => ({ tipo: 'servicio-caido', host, servicio, hace: 25 }))
    .concat(Object.keys(C.LOGS_GIGANTES).map(host => ({ tipo: 'log-gigante', host })), SRV.map(host => ({ tipo: 'reloj-parado', host })), SRV.map(host => ({ tipo: 'sin-clave', host })), SRV.map(host => ({ tipo: 'parches-pendientes', host })), ['web01', 'web02', 'web03', 'db02'].map(host => ({ tipo: 'firewall-sin-puerto', host })));
  todas.forEach(a => {
    const st = P.crear(), et = a.tipo + ' en ' + a.host + (a.servicio ? ' (' + a.servicio + ')' : '');
    if (P.validarAverias([a]).length) { mal(et + ': no valida'); return; }
    P.aplicarAverias(st, [a]);
    if (!P.pendientesAverias(st, [a]).length) mal(et + ': no rompe nada');
    correr(P, st, P.arregloAverias(st, [a]));
    const q = P.pendientesAverias(st, [a]), al = P.alertasActivas(st).filter(x => x.sev !== 'info');
    if (q.length || al.length) mal(et + ': su arreglo no lo cierra: ' + q.concat(al.map(x => x.nombre)).join(' | '));
  });
  // Cada servicio responde por el nombre que tiene en su servidor.
  { const st = P.crear(); P.topologia.forEach(d => { const h = st.hosts[d.n]; Object.keys(h.svcs).forEach(u => { const v = U.visible(h, u); if (U.unidad(h, v) !== u) mal(d.n + ': systemctl no encuentra ' + v); }); }); }
  P.escenarios.filter(e => !e.objetivo).forEach(e => {
    const st = P.preparar(e); correr(P, st, P.arregloAverias(st, e.averias));
    const q = e.resuelto(st, P); if (q.length) mal(e.id + ': encadenar los arreglos de sus averías no lo cierra: ' + q.join(' | '));
  });
  const mezcla = [{ tipo: 'selinux-booleano' }, { tipo: 'contenedor-oom', version: '4.3.0', xmx: '768m' }, { tipo: 'cert-caducado' }, { tipo: 'pg-hba-sin-regla' }, { tipo: 'backup-credenciales', clave: 'Nueva#2026', noches: 2 }, { tipo: 'firewall-sin-puerto', host: 'web03' }];
  const ve = P.validarAverias(mezcla);
  if (ve.length) mal('una combinación inventada no valida: ' + ve.join(' | '));
  else { const st = P.crear(); P.aplicarAverias(st, mezcla); if (!P.alertasActivas(st).length) mal('la combinación inventada no levanta alertas'); correr(P, st, P.arregloAverias(st, mezcla)); const q = P.pendientesAverias(st, mezcla); if (q.length) mal('la combinación inventada no se cierra encadenando arreglos: ' + q.join(' | ')); }
  if (P.validarAverias([{ tipo: 'selinux-booleano' }, { tipo: 'selinux-booleano' }]).length !== 1) mal('el validador no rechaza dos averías sobre lo mismo');
  if (!P.validarAverias([{ tipo: 'no-existe' }]).length || !P.validarAverias([{ tipo: 'parches-pendientes' }]).length) mal('el validador no rechaza un tipo desconocido o un parámetro que falta');
  if (fallos === n0) bien(Object.keys(P.averias).length + ' tipos de avería: cada uno rompe algo y su arreglo lo deja sano y sin alertas; los tickets de sólo averías se cierran encadenando arreglos, y una combinación inventada de seis también');
}

// ------------------------------------------------------------ incidencias en fichero
console.log('\n  incidencias en fichero:');
for (const [Q, et] of [[P, ''], [cargar('en'), '[en] ']]) {
  let malos = 0;
  const ex = Q.exportables();
  ex.forEach(e => {
    const d = Q.exportarIncidencia(e), r = Q.cargarIncidencia(JSON.stringify(d));
    if (!r.ok) { mal(et + e.id + ' exportado no se acepta al reimportarlo: ' + r.errores.join(' | ')); malos++; return; }
    const st = Q.preparar(r.escenario);
    correr(Q, st, Q.guionDe(r.escenario, st));
    const q = r.escenario.resuelto(st, Q);
    if (q.length) { mal(et + d.id + ': su solución generada no lo cierra: ' + q.join(' | ')); malos++; }
  });
  // Una incidencia sin textos didácticos: se generan, y su guion cumple sus prácticas.
  const d = { formato: 'puesto-incidencia/1', id: 'EXT-900', asunto: 'Noche movida', cuerpo: ['Todo a la vez.'], impacto: 'alto', urgencia: 'alta',
    averias: [{ tipo: 'servicio-caido', host: 'db01', servicio: 'postgresql', hace: 30 }, { tipo: 'log-gigante', host: 'web03' }, { tipo: 'firewall-sin-puerto', host: 'db02' }] };
  const r = Q.cargarIncidencia(d);
  if (!r.ok) { mal(et + 'una incidencia sin textos didácticos no se acepta: ' + r.errores.join(' | ')); malos++; }
  else {
    const e = r.escenario;
    if (e.funciones.join() !== 'datos,seg,incid') { mal(et + 'funciones derivadas: ' + e.funciones.join()); malos++; }
    if (et && e.pistas.concat(e.causa, e.solucion, e.leccion, e.area, e.practicas.map(p => p.t)).some(x => /[áéíóúñ]|\b(el|los|las|que|para|con|en)\b/.test(x.replace(/(sudo |ssh |amtool|curl )[^·]*/g, '')))) { mal(et + 'lo generado parece español: ' + e.pistas.join(' | ')); malos++; }
    const st = Q.preparar(e); correr(Q, st, Q.guionDe(e, st));
    if (e.resuelto(st, Q).length) { mal(et + 'su guion generado no la cierra: ' + e.resuelto(st, Q).join(' | ')); malos++; }
    if (!e.practicas.every(p => p.ok(st))) { mal(et + 'su propio guion no cumple sus buenas prácticas: ' + e.practicas.filter(p => !p.ok(st)).map(p => p.t).join(' | ')); malos++; }
  }
  if (!malos) bien(et + ex.length + ' tickets exportados como plantilla se reimportan y su solución generada los cierra; una incidencia sin textos los genera y su guion cumple sus prácticas');
}
{
  const base = { formato: 'puesto-incidencia/1', asunto: 'x', cuerpo: ['y'], impacto: 'medio', urgencia: 'media', averias: [{ tipo: 'selinux-booleano' }] };
  const casos = [
    ['{ esto no es json', /JSON/], [Object.assign({}, base, { formato: 'otro/1' }), /formato/], [Object.assign({}, base, { id: 'INC-7101', averias: [{ tipo: 'no-existe' }] }), /tipo desconocido/],
    [Object.assign({}, base, { averias: [{ tipo: 'var-creciendo', pct: 70 }] }), /No rompe nada/], [Object.assign({}, base, { hace: 50000 }), /10080/],
    [Object.assign({}, base, { averias: [{ tipo: 'servicio-caido', host: 'web02', servicio: 'mariadb' }] }), /host y servicio/],
    [Object.assign({}, base, { impacto: 'alto', urgencia: 'alta', abiertoHace: 50, hace: 60 }), /SLA/],
  ].filter(([d, re]) => { const r = P.cargarIncidencia(typeof d === 'string' ? d : JSON.stringify(d)); return r.ok || !r.errores.some(x => re.test(x)); });
  if (casos.length) casos.forEach(([d]) => mal('el cargador acepta o no explica: ' + (typeof d === 'string' ? d : JSON.stringify(d))));
  else bien('rechaza JSON roto, otro formato, una avería desconocida, lo que no rompe nada, más de una semana, un servicio que no está en ese servidor y un P1 que nace con medio SLA gastado');
  let malos = 0;
  [1, 2, 3].forEach(n => [7, 1234, 98765].forEach(s => {
    const g = P.generarGuardia(n, s), r = g.ok && P.cargarIncidencia(Object.assign({}, g.def));
    if (!r || !r.ok) { mal('la guardia ' + n + '/' + s + ' como fichero no se acepta: ' + (r ? r.errores.join(' | ') : 'no se genera')); malos++; }
  }));
  if (!malos) bien('9 guardias generadas se aceptan como fichero');
}

// ------------------------------------------------------------ compositor
console.log('\n  compositor:');
{
  const win = { PUESTO: { idioma: 'es' } };
  [path.join(D, 'topologia.js'), path.join(LINUX, 'motor.js'), path.join(D, 'sistema.js'), path.join(D, 'servicios.js'), path.join(D, 'operacion.js'), path.join(D, 'averias.js'), path.join(D, 'escenarios.js'), path.join(LINUX, 'incidencias.js'), path.join(D, 'guardia.js')]
    .forEach(f => new Function('window', fs.readFileSync(f, 'utf8'))(win));
  const Q = win.PUESTO, els = {}, almacen = {};
  const el = () => ({ innerHTML: '', textContent: '', classList: { add() {}, toggle() {} }, querySelector: () => null });
  const documento = { querySelector: s => els[s] || (els[s] = el()), querySelectorAll: () => [], addEventListener() {}, body: el() };
  const ls = { getItem: k => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: k => { delete almacen[k]; } };
  new Function('window', 'document', 'localStorage', 'location', fs.readFileSync(path.join(LINUX, 'compositor.js'), 'utf8'))(win, documento, ls, {});
  const K = Q.compositor, html = () => els['#vista'].innerHTML;
  let malos = 0;
  Object.keys(Q.averias).forEach(t => {
    K.cargar({ asunto: 'x', cuerpo: ['y'], averias: [Object.assign({ tipo: t }, JSON.parse(JSON.stringify(Q.averias[t].ejemplo)))] }, t);
    const falta = (Q.camposAveria[t] || []).filter(c => html().indexOf('data-k="' + c.k + '"') < 0).map(c => c.k);
    if (falta.length) { mal('el compositor no pinta ' + t + '.' + falta.join(', ')); malos++; }
    if (!Q.averias[t].condicion && !K.est.res.ok) { mal('el ejemplo de ' + t + ' no sale jugable en el compositor: ' + K.est.res.errores.join(' | ')); malos++; }
  });
  Q.exportables().forEach(e => {
    K.cargar(Q.exportarIncidencia(e), e.id);
    const id = K.guardarEnCola(), g = JSON.parse(almacen['puesto-cpd-importadas'] || '[]').find(x => x.id === id);
    if (!K.est.res.ok || !K.est.vista || !g || !Q.cargarIncidencia(g).ok) { mal('partir de ' + e.id + ' y guardarlo no da una incidencia jugable: ' + (K.est.res.errores || []).join(' | ')); malos++; }
  });
  if (Object.keys(almacen).some(k => !/^puesto-cpd-/.test(k))) { mal('el compositor del CPD escribe en la cola de otro puesto: ' + Object.keys(almacen).join(', ')); malos++; }
  K.cargar(JSON.parse(JSON.stringify(Q.generarGuardia(3, 4242).def)), 'guardia');
  if (!K.est.res.ok) { mal('una guardia de nivel 3 no sale jugable en el compositor: ' + K.est.res.errores.join(' | ')); malos++; }
  K.cargar({ asunto: 'x', cuerpo: [''], averias: [{ tipo: 'firewall-sin-puerto' }] }, 'a medias');
  if (!K.est.res.errores.some(x => /falta host/.test(x))) { mal('con el ticket a medias, el ensayo no avisa del host sin elegir'); malos++; }
  if (!malos) bien('pinta los ' + Object.keys(Q.averias).length + ' tipos con un control por campo; ' + Q.exportables().length + ' tickets y una guardia de nivel 3 cargan, se guardan en su propia cola y siguen siendo jugables');
}

// ------------------------------------------------------------ inglés
console.log('\n  en inglés:');
{
  const E = cargar('en'), raros = [];
  const ES = /[áéíóúñ¿¡«»]|(^|[^a-zA-Z\-_./])(el|los|las|que|para|con|sin|una|del|está|hay|pero|sigue|antes|después|nada|cada|desde|tiene)(?=$|[^a-zA-Z\-_./])/i;
  const mira = (donde, t) => { if (t && ES.test(String(t).replace(/Raúl Pastor|Elena Ruiz|Pablo Gil|Catálogo de otoño|Intranet de Cliente C|Portal de clientes|facturaci[oó]n|clave-[ab]\.key|renovacion|pedidos|informes|prueba/g, ''))) raros.push(donde + ': ' + String(t).slice(0, 90)); };
  E.escenarios.forEach(e => {
    ['asunto', 'de', 'area', 'causa', 'solucion', 'leccion'].forEach(k => mira(e.id + '.' + k, e[k]));
    e.cuerpo.concat(e.pistas).forEach((x, i) => mira(e.id + ' texto ' + i, x));
    e.practicas.forEach((p, i) => mira(e.id + ' práctica ' + i, p.t));
    const st = E.preparar(e);
    e.resuelto(st, E).forEach(x => mira(e.id + ' pendiente', x));
    E.alertasActivas(st).forEach(a => mira(e.id + ' alerta', a.res));
    const r = correr(E, st, E.guionDe(e, st));
    r.salida.forEach(x => x.lineas.forEach(l => mira(e.id + ' $ ' + x.cmd, l.t)));
  });
  E.funciones.forEach(f => mira('función ' + f.id, f.titulo));
  Object.values(E.averias).forEach(t => { mira('avería ' + t.id, t.titulo); mira('avería ' + t.id, t.descripcion); });
  E.glosario.forEach(g => { mira('glosario ' + g.id, g.t); mira('glosario ' + g.id, g.d); });
  E.familias.forEach(f => { mira('familia ' + f.id, f.titulo); mira('familia ' + f.id, f.leccion); });
  [1, 2, 3].forEach(n => { const g = E.generarGuardia(n, 11); g.escenario.pistas.concat(g.escenario.causa, g.escenario.asunto, g.escenario.practicas.map(p => p.t), E.ui.bienvenida('guardia')).forEach(x => mira('guardia ' + n, x)); const st = E.preparar(g.escenario); E.alertasActivas(st).forEach(a => mira('guardia ' + n + ' alerta', a.res)); correr(E, st, E.guionDe(g.escenario, st)).salida.forEach(x => x.lineas.forEach(l => mira('guardia ' + n + ' $ ' + x.cmd, l.t))); });
  const st = E.crear(), r = correr(E, st, ['cat ~/LEEME.md', 'cat ~/ansible/chrony.yml', 'help', 'ssh web01', 'help', 'apt update', 'exit', 'ssh app01', 'docker ps', 'visudo -f /etc/sudoers.d/x', 'exit']);
  r.salida.forEach(x => x.lineas.forEach(l => mira('$ ' + x.cmd, l.t)));
  [E.ui.oferta.titulo, E.ui.oferta.sub, E.ui.oferta.txt, E.ui.sesionNueva, E.ui.alertas].concat(E.ui.como, E.ui.bienvenida('libre'), E.ui.bienvenida('ticket'), E.ui.experimentos.map(x => x[1])).forEach((x, i) => mira('ui ' + i, x));
  raros.forEach(x => mal('[en] parece español: ' + x));
  if (!raros.length) bien('en inglés no queda nada en español: tickets, pistas, prácticas, alertas, catálogo, glosario, ficheros, interfaz y la salida de los ' + E.escenarios.length + ' guiones');
}

// ------------------------------------------------------------ solucionario
console.log('\n  solucionario:');
function probarSolucionario(P, etiqueta) {
  let malos = 0;
  const ids = new Set(P.glosario.map(g => g.id));
  if (ids.size !== P.glosario.length) { mal(etiqueta + 'ids repetidos en el glosario'); malos++; }
  P.escenarios.forEach(e => {
    const s = P.soluciones[e.id];
    if (!s) { mal(etiqueta + e.id + ': no está en el solucionario'); malos++; return; }
    const guion = P.guionDe(e, P.preparar(e));
    if (s.pasos.length !== guion.length) { mal(etiqueta + e.id + ': el solucionario tiene ' + s.pasos.length + ' pasos y el guion ' + guion.length); malos++; return; }
    s.pasos.forEach((p, i) => {
      if (guion[i].indexOf(p[0]) < 0) { mal(etiqueta + e.id + ' paso ' + (i + 1) + ': «' + p[0] + '» no está en «' + guion[i] + '»'); malos++; }
      if (['diag', 'arreglo', 'comprobar', ''].indexOf(p[1]) < 0 || !p[2]) { mal(etiqueta + e.id + ' paso ' + (i + 1) + ': sin fase válida o sin explicación'); malos++; }
    });
    if (!s.pasos.some(p => p[1] === 'comprobar')) { mal(etiqueta + e.id + ': no termina comprobando nada'); malos++; }
    (s.terminos || []).forEach(t => { if (!ids.has(t)) { mal(etiqueta + e.id + ': término de glosario inexistente «' + t + '»'); malos++; } });
  });
  return malos;
}
{
  const E = cargar('en');
  if (!(probarSolucionario(P, '') + probarSolucionario(E, '[en] '))) bien(P.escenarios.length + ' tickets con sus pasos alineados con el guion, en los dos idiomas; ' + P.glosario.length + ' términos de glosario');
}

console.log(fallos ? '\n' + fallos + ' fallos' : '\nTodo OK');
process.exit(fallos ? 1 : 0);
