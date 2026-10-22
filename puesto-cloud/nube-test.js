// Comprueba el Puesto Cloud sin navegador.
//
//   node puesto-cloud/nube-test.js
//
// Como en el Puesto Linux, lo importante no es que arranque: es que cada ticket
// se resuelva con comandos de verdad, que los arreglos a medias NO lo cierren,
// que la red se comporte como la de AWS (un security group descarta, no
// rechaza) y que el mismo guion dé siempre lo mismo.
const fs = require('fs'), path = require('path');
const D = __dirname, LINUX = path.join(D, '..', 'puesto-linux');
function cargar(idioma) {
  const win = { PUESTO: { idioma } };
  [path.join(D, 'topologia.js'), path.join(LINUX, 'motor.js'), path.join(D, 'nube.js'), path.join(D, 'aws.js'), path.join(D, 'servicios.js'), path.join(D, 'rds.js'), path.join(D, 'asg.js'), path.join(D, 'coste.js'), path.join(D, 'terraform.js'), path.join(D, 'averias.js'), path.join(D, 'escenarios.js'), path.join(LINUX, 'incidencias.js'), path.join(D, 'guardia.js'), path.join(D, 'soluciones.js')]
    .forEach(f => new Function('window', fs.readFileSync(f, 'utf8'))(win));
  return win.PUESTO;
}
const P = cargar('es'), N = P.nube, ID = N.ID;

let fallos = 0;
const mal = m => { console.error('  ✕ ' + m); fallos++; };
const bien = m => console.log('  ✓ ' + m);
function correr(P, st, cmds, ses) {
  ses = ses || P.nuevaSesion();
  const salida = [];
  cmds.forEach(c => { const r = P.ejecutar(st, ses, c); salida.push({ cmd: c, host: ses.host, lineas: r.lineas }); P.expulsar(st, ses); });
  return { ses, salida, texto: salida.map(x => '$ ' + x.cmd + '\n' + x.lineas.map(l => l.t).join('\n')).join('\n') };
}
const lineas = (r, i) => r.salida[i].lineas.map(l => l.t).join('\n');

console.log('Puesto Cloud · Ingeniería de sistemas en AWS\n');

// ------------------------------------------------------------ plataforma sana
console.log('  plataforma de partida:');
{
  const st = P.crear();
  const al = P.alertasActivas(st);
  if (al.length) mal('la cuenta sana ya tiene alarmas: ' + al.map(a => a.nombre).join(', '));
  const ins = st.aws.instancias.filter(i => i.estado !== 'running');
  if (ins.length) mal('instancias que no están running al empezar: ' + ins.map(i => i.nombre).join(', '));
  // por el ~/.ssh/config, se entra en todas
  const fallanSsh = st.aws.instancias.filter(i => i.host).map(i => i.nombre).filter(n => { const r = correr(P, st, ['ssh ' + n]); const ok = r.ses.host === n; correr(P, st, ['exit'], r.ses); return !ok; });
  if (fallanSsh.length) mal('ssh por el ~/.ssh/config no entra en: ' + fallanSsh.join(', '));
  const web = correr(P, st, ['curl -I http://52.18.140.66']);
  if (!/200 OK/.test(lineas(web, 0))) mal('la web no contesta desde fuera: ' + lineas(web, 0));
  const json = correr(P, st, ['aws ec2 describe-instances']);
  try { const d = JSON.parse(lineas(json, 0)); if (d.Reservations.length !== st.aws.instancias.length) mal('describe-instances no devuelve todas las instancias'); } catch (e) { mal('describe-instances no da JSON válido: ' + e.message); }
  if (!fallos) bien('sana: cero alarmas, 5 instancias running, ssh entra en todas por el bastión, la web contesta y la CLI da JSON válido');
}

// ------------------------------------------------------------ red y discos
console.log('\n  mecánica de la nube:');
{
  let malos = 0;
  const chk = (cond, m) => { if (!cond) { mal(m); malos++; } };
  // Un security group descarta (timeout); un servicio parado rechaza (refused).
  let st = P.crear();
  P.parar(st, st.hosts['web-01'], 'nginx');
  const r1 = correr(P, st, ['curl -I http://52.18.140.66']);
  chk(/Connection refused/.test(lineas(r1, 0)), 'con nginx parado, curl debería dar Connection refused: ' + lineas(r1, 0));
  st = P.crear(); st.aws.miIp = '198.51.100.24';
  const r2 = correr(P, st, ['ssh bastion', 'ssh -i ~/.ssh/tienda-prod.pem ubuntu@52.18.140.66']);
  chk(/timed out/.test(lineas(r2, 0)), 'el SG del bastión debería dar timeout a una IP no permitida: ' + lineas(r2, 0));
  chk(/timed out/.test(lineas(r2, 1)), 'web-01 no deja entrar al 22 desde internet: timeout esperado');
  // Usuario y clave
  st = P.crear();
  const r3 = correr(P, st, ['ssh ubuntu@34.248.51.17', 'ssh -i ~/.ssh/tienda-prod.pem ec2-user@34.248.51.17', 'ssh -i ~/.ssh/tienda-prod.pem ubuntu@34.248.51.17']);
  chk(/Permission denied/.test(lineas(r3, 0)) && /Permission denied/.test(lineas(r3, 1)) && r3.ses.host === 'bastion', 'sin clave o con otro usuario debería dar Permission denied, y con ambos entrar');
  // Desde tu equipo no hay ruta a una IP privada; saltando por el bastión, sí.
  st = P.crear();
  const r4 = correr(P, st, ['ssh -i ~/.ssh/tienda-prod.pem ubuntu@10.0.11.30', 'ssh -J bastion ubuntu@10.0.11.30', 'ssh -J bastion -i ~/.ssh/tienda-prod.pem ubuntu@10.0.11.30']);
  chk(/timed out/.test(lineas(r4, 0)), 'desde tu equipo no hay ruta a una IP privada: ' + lineas(r4, 0));
  chk(/Permission denied/.test(lineas(r4, 1)), 'saltando sin -i, ssh no usa la clave del proyecto: ' + lineas(r4, 1));
  chk(r4.ses.host === 'app-01', 'saltando por el bastión y con la clave, se entra en una IP privada');
  // Parar y arrancar cambia la IP pública; las alarmas lo notan.
  st = P.crear();
  const ip0 = N.inst(st, ID.inst['web-02']).ipPub;
  correr(P, st, ['aws ec2 stop-instances --instance-ids ' + ID.inst['web-02'], 'sleep 60']);
  chk(P.alertasActivas(st).some(a => a.nombre === 'tienda-web-healthy-hosts'), 'parar web-02 debería disparar tienda-web-healthy-hosts');
  correr(P, st, ['aws ec2 start-instances --instance-ids ' + ID.inst['web-02'], 'aws ec2 wait instance-running --instance-ids ' + ID.inst['web-02'], 'aws elbv2 wait target-in-service --target-group-arn ' + ID.tg]);
  chk(N.inst(st, ID.inst['web-02']).ipPub && N.inst(st, ID.inst['web-02']).ipPub !== ip0 && !P.alertasActivas(st).length, 'al arrancar, nueva IP pública y la alarma vuelve a OK');
  // EBS: el volumen y el sistema de ficheros son dos cosas; 6 horas entre cambios.
  st = P.crear();
  const v = ID.vol['db-01-datos'];
  const r5 = correr(P, st, ['aws ec2 modify-volume --volume-id ' + v + ' --size 150', 'aws ec2 modify-volume --volume-id ' + v + ' --size 300', 'ssh db-01', 'df -h', 'sudo resize2fs /dev/nvme1n1', 'df -h', 'sudo resize2fs /dev/nvme1n1']);
  chk(/VolumeModificationRateExceeded/.test(lineas(r5, 1)), 'una segunda modificación antes de 6 h debería fallar');
  const dfDatos = t => t.split('\n').find(l => /postgresql/.test(l)) || '';
  chk(/ 99G /.test(dfDatos(lineas(r5, 3))) && / 148G /.test(dfDatos(lineas(r5, 5))), 'df no cambia hasta resize2fs, y después sí: ' + dfDatos(lineas(r5, 3)) + ' → ' + dfDatos(lineas(r5, 5)));
  chk(/Nothing to do/.test(lineas(r5, 6)), 'resize2fs dos veces: la segunda no hace nada');
  // Otra región: la cuenta está vacía allí.
  const r6 = correr(P, st, ['aws ec2 describe-instances --region us-east-1']);
  chk(/"Reservations": \[\]/.test(lineas(r6, 0)), 'en otra región no hay instancias');
  // La CLI sólo en tu equipo.
  st = P.crear();
  const r7 = correr(P, st, ['ssh db-01', 'aws ec2 describe-instances']);
  chk(/'aws' not found/.test(lineas(r7, 1)), 'en una instancia sin rol no hay CLI de AWS');
  // Sin --security-group-ids, AWS pone el default.
  st = P.crear();
  correr(P, st, ['aws ec2 run-instances --image-id ' + ID.ami.web + ' --instance-type t3.small --subnet-id ' + ID.subred['public-c'] + ' --key-name tienda-prod --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]"', 'sleep 120']);
  const w3 = st.aws.instancias.find(i => i.nombre === 'web-03');
  chk(w3 && w3.sgs[0] === ID.sg.default && w3.estado === 'running' && !N.webSana(st, w3), 'una instancia lanzada sin security group lleva el default y no se ve desde fuera');
  if (!malos) bien('timeout frente a refused, usuario y clave, IPs privadas sólo por el bastión, IP nueva al arrancar, volumen frente a sistema de ficheros, 6 h entre cambios, regiones, CLI sólo en tu equipo, el security group default');
}

// ------------------------------------------------------------ IAM, S3 y balanceador
{
  let malos = 0;
  const chk = (cond, m) => { if (!cond) { mal(m); malos++; } };
  // IAM: el rol de la API puede con sus facturas y con nada más; tu usuario, con todo.
  let st = P.crear();
  const r1 = correr(P, st, ['ssh app-01', 'aws ec2 describe-instances', 'aws s3 cp /etc/hostname s3://tienda-facturas/x.txt', 'aws s3 cp /etc/hostname s3://tienda-config/x.txt', 'exit', 'ssh db-01', 'aws s3 ls']);
  chk(/UnauthorizedOperation/.test(lineas(r1, 1)), 'el rol de la API no debería poder describir instancias');
  chk(/^upload:/.test(lineas(r1, 2)) && /AccessDenied/.test(lineas(r1, 3)), 'el rol de la API escribe en tienda-facturas y en ningún otro bucket');
  chk(/'aws' not found/.test(lineas(r1, 6)), 'una instancia sin rol no tiene CLI');
  chk(P.nube.evaluar(st, { usuario: 'sre-ops' }, 'iam:DeleteUser', 'arn:aws:iam::123456789012:user/x').dec === 'allowed', 'sre-ops es administrador');
  chk(P.nube.evaluar(st, { usuario: 'lucia.pardo' }, 'ec2:TerminateInstances', '*').dec === 'implicitDeny', 'ReadOnlyAccess no deja terminar instancias');
  const r2 = correr(P, st, ['aws iam create-access-key --user-name lucia.pardo', 'aws iam create-access-key --user-name lucia.pardo']);
  chk(/LimitExceeded/.test(lineas(r2, 1)), 'un usuario no puede tener más de dos claves');
  // S3: público, firmado, privado.
  st = P.crear();
  const url = 'https://tienda-catalogo-backups.s3.eu-west-1.amazonaws.com/catalogo-2026-09-20.sql.gz';
  const r3 = correr(P, st, ['curl -sI ' + url, 'aws s3 presign s3://tienda-catalogo-backups/catalogo-2026-09-20.sql.gz --expires-in 120']);
  chk(/403/.test(lineas(r3, 0)), 'un bucket privado da 403 desde fuera');
  const firmada = lineas(r3, 1).trim();
  chk(/200 OK/.test(lineas(correr(P, st, ['curl -sI "' + firmada + '"']), 0)), 'una URL firmada da acceso aunque el bucket sea privado');
  correr(P, st, ['sleep 240']);
  chk(/403/.test(lineas(correr(P, st, ['curl -sI "' + firmada + '"']), 0)), 'una URL firmada caduca');
  // Versionado: borrar deja un marcador; la versión anterior sigue ahí.
  st = P.crear();
  correr(P, st, ['aws s3 rm s3://tienda-config/precios.json']);
  const b = P.nube.bucket(st, 'tienda-config');
  chk(!P.nube.objetoActual(b, 'precios.json') && b.objetos['precios.json'].length === 3, 'en un bucket versionado, borrar deja un marcador y conserva las versiones');
  // Balanceador: fail-open y health checks.
  st = P.crear();
  P.nube.tg(st).hc.path = '/healthz';
  correr(P, st, ['sleep 60']);
  const r4 = correr(P, st, ['curl -I http://' + ID.albDns + '/', 'aws elbv2 describe-target-health --target-group-arn ' + ID.tg]);
  chk(/200 OK/.test(lineas(r4, 0)) && /ResponseCodeMismatch/.test(lineas(r4, 1)), 'con todos los destinos mal, el ALB sigue sirviendo (fail-open) y dice por qué están mal');
  P.parar(st, st.hosts['web-01'], 'nginx'); P.parar(st, st.hosts['web-02'], 'nginx');
  chk(/503/.test(lineas(correr(P, st, ['curl -I http://' + ID.albDns + '/']), 0)), 'sin nadie que sirva, el ALB da 503');
  // Regiones: lo que está en otra región no existe para la CLI si no la nombras.
  st = P.preparar(P.escenario('INC-7146'));
  const malo = st.aws.instancias.find(i => i.malicia).id;
  const r5 = correr(P, st, ['aws ec2 describe-instances --query "Reservations[].Instances[].InstanceId" --output text', 'aws ec2 terminate-instances --instance-ids ' + malo]);
  chk(lineas(r5, 0).indexOf(malo) < 0 && /InvalidInstanceID.NotFound/.test(lineas(r5, 1)), 'una instancia de us-east-1 no aparece ni se puede terminar sin --region');
  if (!malos) bien('IAM (rol frente a usuario, denegación implícita, dos claves como mucho), S3 (público, URL firmada que caduca, versionado), balanceador (fail-open, motivo del health check, 503) y regiones');
}

// ------------------------------------------------------------ RDS, Auto Scaling, coste y Terraform
{
  let malos = 0;
  const chk = (cond, m) => { if (!cond) { mal(m); malos++; } };
  let st = P.crear();
  chk(!P.nube.derivaTf(st).cambios, 'la cuenta sana no debería tener deriva respecto a Terraform');
  chk(P.nube.prevision(st) < P.nube.PRESUPUESTO && !P.alertasActivas(st).length, 'la cuenta sana cabe en su presupuesto y no tiene gasto anómalo');
  // Auto Scaling repone lo que muere.
  const w = st.aws.instancias.find(i => i.asg && i.estado === 'running');
  correr(P, st, ['aws ec2 terminate-instances --instance-ids ' + w.id, 'sleep 180']);
  chk(st.aws.instancias.filter(i => i.asg && i.estado === 'running').length === 2, 'el grupo de Auto Scaling debería reponer una instancia terminada');
  // Lo terminado deja de costar.
  st = P.preparar(P.escenario('INC-7162'));
  const r0 = P.nube.ritmo(st);
  correr(P, st, ['aws ec2 terminate-instances --instance-ids ' + st.aws.instancias.find(i => i.nombre === 'carga-01').id, 'sleep 60']);
  chk(P.nube.ritmo(st) < r0 - 0.8, 'terminar la m6i.4xlarge debería bajar el gasto por hora');
  // RDS: un cambio sin --apply-immediately queda pendiente.
  st = P.crear();
  correr(P, st, ['aws rds modify-db-instance --db-instance-identifier tienda-pedidos --allocated-storage 200', 'sleep 600']);
  chk(P.nube.rds(st, 'tienda-pedidos').almacen === 100 && P.nube.rds(st, 'tienda-pedidos').pendientes.almacen === 200, 'sin --apply-immediately, el almacenamiento debería quedar pendiente');
  if (!malos) bien('RDS (cambios pendientes sin --apply-immediately), Auto Scaling (se repone solo), coste (lo terminado deja de cobrar; la cuenta sana cabe en el presupuesto) y Terraform (sin deriva de partida)');
}

// ------------------------------------------------------------ --query y formatos
{
  let malos = 0;
  const q = (expr, esperado) => { const st = P.crear(); const r = correr(P, st, ['aws ec2 describe-instances --query "' + expr + '" --output json']); let v; try { v = JSON.parse(lineas(r, 0)); } catch (e) { v = lineas(r, 0); } if (JSON.stringify(v) !== JSON.stringify(esperado)) { mal('--query ' + expr + ' → ' + JSON.stringify(v).slice(0, 160) + ' (esperaba ' + JSON.stringify(esperado).slice(0, 120) + ')'); malos++; } };
  q('Reservations[].Instances[].Tags[?Key==`Name`]|[0].Value', null);   // el | corta la proyección: [0] es una lista y .Value de una lista es null
  q('Reservations[].Instances[].Tags[?Key==`Name`][]|[0].Value', 'bastion');
  q('Reservations[].Instances[].Tags[?Key==`Name`].Value[]', ['bastion', 'web-01', 'web-02', 'app-01', 'db-01', 'tienda-worker', 'tienda-worker']);
  q("Reservations[].Instances[?Placement.AvailabilityZone=='eu-west-1b'].InstanceId[]", P.crear().aws.instancias.filter(i => P.nube.subred(P.crear(), i.subred).az === 'eu-west-1b').map(i => i.id));
  q('length(Reservations[])', P.crear().aws.instancias.length);
  q("Reservations[].Instances[].{N:Tags[?Key=='Name']|[0].Value,T:InstanceType}[?T=='t3.small'].N", []);   // el filtro se aplica a cada elemento proyectado
  q("Reservations[].Instances[].{N:Tags[?Key=='Name']|[0].Value,T:InstanceType} | [?T=='t3.small'].N", ['web-01', 'web-02']);
  q('Reservations[0].Instances[0].[InstanceId,State.Name]', [ID.inst.bastion, 'running']);
  const st = P.crear();
  const t = correr(P, st, ['aws ec2 describe-instances --query "Reservations[].Instances[].[InstanceId,InstanceType]" --output text', 'aws ec2 describe-instances --query "Reservations[].Instances[].[InstanceId,InstanceType]" --output table']);
  if (lineas(t, 0).split('\n').length !== st.aws.instancias.length ||!/\t/.test(lineas(t, 0))) { mal('--output text debería dar una línea por instancia separada por tabuladores'); malos++; }
  if (!/DescribeInstances/.test(lineas(t, 1)) || !/^\+[-+]+\+$/m.test(lineas(t, 1))) { mal('--output table debería pintar una tabla con el nombre de la operación'); malos++; }
  if (!malos) bien('--query: proyecciones, filtros, índices, |, multiselect, length(); --output text y table');
}

// ------------------------------------------------------------ tickets
console.log('\n  tickets (guion de referencia, prácticas y trampas):');
function probarTickets(P, etiqueta) {
  let malos = 0;
  P.escenarios.forEach(e => {
    const st = P.preparar(e), antes = e.resuelto(st, P);
    if (!antes.length) { mal(etiqueta + e.id + ': nace resuelto'); malos++; }
    const ab = -(e.abierto || 0), sla = P.prioridad(e).sla;
    if (ab > sla / 2) { mal(etiqueta + e.id + ': nace con más de medio SLA gastado'); malos++; }
    if (e.pistas.length !== 3) { mal(etiqueta + e.id + ': no tiene exactamente 3 pistas'); malos++; }
    const r = correr(P, st, P.guionDe(e, st)), ev = P.evaluar(st, e);
    if (ev.pendientes.length) { mal(etiqueta + e.id + ': su guion no lo resuelve: ' + ev.pendientes.join(' · ')); malos++; }
    const flojas = ev.practicas.filter(x => !x.ok);
    if (flojas.length) { mal(etiqueta + e.id + ': su guion no cumple sus prácticas: ' + flojas.map(x => x.t).join(' · ')); malos++; }
    const st2 = P.preparar(e), r2 = correr(P, st2, P.guionDe(e, st2));
    if (r.texto !== r2.texto) { mal(etiqueta + e.id + ': el guion no da la misma salida dos veces'); malos++; }
    (e.trampas || []).forEach(t => {
      const s3 = P.preparar(e); correr(P, s3, t.cmds);
      if (!e.resuelto(s3, P).length) { mal(etiqueta + e.id + ': la trampa «' + t.porque + '» lo deja resuelto'); malos++; }
    });
  });
  return malos;
}
if (!probarTickets(P, '')) bien(P.escenarios.length + ' tickets: cada guion lo resuelve y cumple sus prácticas, es determinista, y ' + P.escenarios.reduce((a, e) => a + (e.trampas || []).length, 0) + ' arreglos a medias lo dejan abierto');

// ------------------------------------------------------------ inglés
console.log('\n  en inglés:');
{
  const E = cargar('en');
  let malos = probarTickets(E, '[en] ');
  const ES = /[áéíóúñ¿¡«»]|(^|[^a-zA-Z\-_./])(el|los|las|que|para|con|sin|una|del|está|hay|pero|sigue|todavía|antes|después|nada|cada|desde|tiene)(?=$|[^a-zA-Z\-_./])/i;
  const NOMBRES = /Lucía|Óscar/g;
  const raros = [];
  const mira = (donde, s) => { if (typeof s === 'string' && ES.test(s.replace(NOMBRES, ''))) raros.push(donde + ': ' + s.slice(0, 120)); };
  E.escenarios.forEach(e => {
    ['asunto', 'de', 'causa', 'solucion', 'leccion', 'area'].forEach(k => mira(e.id + '.' + k, e[k]));
    e.cuerpo.concat(e.pistas).forEach((x, i) => mira(e.id + ' texto ' + i, x));
    e.practicas.forEach(p => mira(e.id + ' práctica', p.t));
    (e.trampas || []).forEach(t => mira(e.id + ' trampa', t.porque));
    const st = E.preparar(e);
    e.resuelto(st, E).forEach(x => mira(e.id + ' pendiente', x));
    E.alertasActivas(st).forEach(a => mira(e.id + ' alarma', a.res));
    correr(E, st, E.guionDe(e, st)).salida.forEach(x => x.lineas.forEach(l => mira(e.id + ' $ ' + x.cmd, l.t)));
  });
  E.funciones.forEach(f => mira('función', f.titulo));
  const st = E.crear();
  ['ops', 'web-01'].forEach(h => Object.keys(E.vfs(st, st.hosts[h]).f).forEach(f => E.correrEn(st, h, 'cat ' + f).lineas.forEach(l => mira(h + ':' + f, l.t))));
  E.correrEn(st, 'ops', 'help').lineas.forEach(l => mira('help', l.t));
  E.correrEn(st, 'ops', 'aws help').lineas.forEach(l => mira('aws help', l.t));
  raros.slice(0, 20).forEach(x => mal('[en] parece español: ' + x));
  malos += raros.length;
  if (!malos) bien('los ' + E.escenarios.length + ' tickets se resuelven igual en inglés y nada de lo que se ve está en español');
}

// ------------------------------------------------------------ guardias y caos
console.log('\n  guardias y caos:');
{
  let malos = 0;
  const SEMILLAS = 30;
  [1, 2, 3].forEach(nivel => {
    let fallan = 0; const combos = new Set();
    for (let s = 1; s <= SEMILLAS; s++) {
      const g = P.generarGuardia(nivel, s * 7919);
      if (!g.ok) { mal('nivel ' + nivel + ', semilla ' + s * 7919 + ': no sale una guardia jugable'); fallan++; continue; }
      const e = g.escenario, st = P.preparar(e);
      if (!P.alertasActivas(st).length) { mal(e.id + ': nace sin ninguna alarma: en guardia nadie la vería'); fallan++; }
      if (e.guardia.familias.length !== nivel) { mal(e.id + ': nivel ' + nivel + ' con ' + e.guardia.familias.length + ' averías'); fallan++; }
      const r = correr(P, st, P.guionDe(e, st)), ev = P.evaluar(st, e);
      if (ev.pendientes.length || ev.practicas.some(x => !x.ok)) { mal(e.id + ': su arreglo no la cierra: ' + ev.pendientes.concat(ev.practicas.filter(x => !x.ok).map(x => x.t)).join(' · ')); fallan++; }
      const g2 = P.generarGuardia(nivel, s * 7919);
      if (JSON.stringify(g2.escenario.guardia) !== JSON.stringify(e.guardia)) { mal(e.id + ': la misma semilla no da la misma guardia'); fallan++; }
      combos.add(e.guardia.familias.slice().sort().join('+'));
    }
    malos += fallan;
    if (!fallan) bien('nivel ' + nivel + ' (' + P.nivelesGuardia[nivel].toLowerCase() + '): ' + SEMILLAS + ' semillas, todas con alarmas y cerradas por su arreglo; ' + combos.size + ' combinaciones distintas');
  });
  // Caos: nada antes de su minuto, alarma después, y se arregla.
  const st = P.crear(), provocadas = [];
  for (let k = 0; k < 3; k++) { const c = P.provocarCaos(st, 4242 + k, provocadas.map(x => x.averias[0])); if (c) provocadas.push(c); }
  if (provocadas.length < 3) { mal('el caos no consigue programar tres averías distintas'); malos++; }
  if (P.alertasActivas(st).length) { mal('el caos rompe algo antes de su minuto'); malos++; }
  correr(P, st, ['sleep ' + 60 * 8]);
  if (!P.pendientesCaos(st, provocadas).length || !P.alertasActivas(st).length) { mal('después de su minuto, el caos debería haber roto algo visible'); malos++; }
  provocadas.forEach(c => correr(P, st, c.familia.arreglo(st, c.params)));
  correr(P, st, ['sleep 120']);
  if (P.pendientesCaos(st, provocadas).length || P.alertasActivas(st).length) { mal('el arreglo de lo provocado por el caos no deja la cuenta sana: ' + P.pendientesCaos(st, provocadas).concat(P.alertasActivas(st).map(a => a.nombre)).join(' · ')); malos++; }
  if (!malos) bien('el caos programa ' + provocadas.length + ' averías (' + provocadas.map(c => c.familia.id).join(', ') + '): nada antes de su minuto, alarmas después, y sus arreglos dejan la cuenta sana');
}

// ------------------------------------------------------------ solucionario
// Cada paso nombra un trozo de su comando del guion: si alguien cambia un
// guion y no el solucionario, esto falla.
console.log('\n  solucionario:');
function probarSolucionario(P, etiqueta) {
  let malos = 0;
  const ids = new Set(P.glosario.map(g => g.id));
  if (ids.size !== P.glosario.length) { mal(etiqueta + 'el glosario tiene ids repetidos'); malos++; }
  P.escenarios.forEach(e => {
    const s = P.soluciones[e.id];
    if (!s) { mal(etiqueta + e.id + ': no está en el solucionario'); malos++; return; }
    const guion = P.guionDe(e, P.preparar(e));
    if (s.pasos.length !== guion.length) { mal(etiqueta + e.id + ': el solucionario tiene ' + s.pasos.length + ' pasos y el guion ' + guion.length); malos++; return; }
    s.pasos.forEach((p, i) => {
      if (guion[i].indexOf(p[0]) < 0) { mal(etiqueta + e.id + ' paso ' + (i + 1) + ': «' + p[0] + '» no está en «' + guion[i] + '»'); malos++; }
      if (['diag', 'arreglo', 'comprobar', ''].indexOf(p[1]) < 0 || !p[2]) { mal(etiqueta + e.id + ' paso ' + (i + 1) + ': sin fase válida o sin explicación'); malos++; }
    });
    if (!s.pasos.some(p => p[1] === 'comprobar')) { mal(etiqueta + e.id + ': el solucionario no termina comprobando nada'); malos++; }
    (s.terminos || []).forEach(t => { if (!ids.has(t)) { mal(etiqueta + e.id + ': término de glosario inexistente «' + t + '»'); malos++; } });
  });
  return malos;
}
{
  const E = cargar('en');
  const ES = /[áéíóúñ¿¡«»]|(^|[^a-zA-Z\-_./])(el|los|las|que|para|con|sin|una|del|está|hay|pero|sigue|antes|después|nada|cada|desde|tiene)(?=$|[^a-zA-Z\-_./])/i;
  const raros = [];
  Object.keys(E.soluciones).forEach(id => E.soluciones[id].pasos.forEach((p, i) => { if (ES.test(p[2])) raros.push(id + ' paso ' + (i + 1)); }));
  E.glosario.forEach(g => { if (ES.test(g.t) || ES.test(g.d)) raros.push('glosario ' + g.id); });
  [E.solucionarioCfg.buscar, E.solucionarioCfg.silencio].forEach(x => { if (ES.test(x)) raros.push('cfg: ' + x); });
  raros.forEach(x => mal('[en] el solucionario parece español: ' + x));
  if (!(probarSolucionario(P, '') + probarSolucionario(E, '[en] ') + raros.length)) bien(P.escenarios.length + ' tickets con sus pasos alineados con el guion, cada uno con fase y explicación, en los dos idiomas; ' + P.glosario.length + ' términos de glosario');
}

// ------------------------------------------------------------ catálogo de averías (fase 4)
// Las tres promesas del catálogo del Puesto Linux, en la nube: cada avería, sola,
// rompe algo y su arreglo deja la cuenta sana; los tickets hechos sólo de averías
// se cierran encadenando sus arreglos; y una combinación inventada también.
console.log('\n  catálogo de averías:');
const ALARMAS = 'aws cloudwatch describe-alarms --state-value ALARM';
const ES_TXT = /[áéíóúñ¿¡«»]|(^|[^a-zA-Z\-_./])(el|los|las|que|para|con|sin|una|del|está|hay|pero|sigue|antes|después|nada|cada|desde|tiene)(?=$|[^a-zA-Z\-_./])/i;
for (const [Q, et] of [[P, ''], [cargar('en'), '[en] ']]) {
  const tipos = Object.keys(Q.averias), rompen = tipos.filter(t => !Q.averias[t].condicion);
  let malos = 0;
  tipos.forEach(t => {
    const a = Object.assign({ tipo: t }, Q.averias[t].ejemplo), v = Q.validarAverias([a]);
    if (v.length) { mal(et + t + ': su ejemplo no valida: ' + v.join(' | ')); malos++; return; }
    const st = Q.crear(); Q.aplicarAverias(st, [a]); Q.refrescarAlertas(st);
    if (et && [Q.averias[t].titulo, Q.averias[t].descripcion].some(x => ES_TXT.test(x))) { mal(et + t + ': el título o la descripción parecen español'); malos++; }
    if (Q.averias[t].condicion) return;
    const antes = Q.pendientesAverias(st, [a]);
    if (!antes.length) { mal(et + t + ': aplicada sola no rompe nada'); malos++; return; }
    if (et && antes.some(x => ES_TXT.test(x))) { mal(et + t + ': lo pendiente parece español: ' + antes.join(' | ')); malos++; }
    const r = correr(Q, st, Q.arregloAverias(st, [a]));
    const raros = r.salida.filter(x => x.lineas.some(l => /: command not found|^An error occurred/.test(l.t)));
    if (raros.length) { mal(et + t + ': su arreglo falla en ' + raros.map(x => x.cmd).join(', ')); malos++; }
    Q.refrescarAlertas(st);
    const quedan = Q.pendientesAverias(st, [a]).concat(Q.alertasActivas(st).map(x => x.nombre));
    if (quedan.length) { mal(et + t + ': su arreglo no la arregla: ' + quedan.join(' | ')); malos++; }
  });
  if (!malos) bien(et + tipos.length + ' tipos de avería (' + rompen.length + ' que rompen, ' + (tipos.length - rompen.length) + ' condición): cada una, sola, rompe algo y su arreglo deja la cuenta sana y sin alarmas');
}
{
  // Cada parámetro tiene su campo en el compositor, y cada campo es un parámetro.
  const sinCampo = [];
  Object.keys(P.averias).forEach(t => {
    const c = P.camposAveria[t], ks = (c || []).map(x => x.k), ps = Object.keys(P.averias[t].params);
    if (!c) { sinCampo.push(t + ' (sin campos)'); return; }
    ps.filter(k => ks.indexOf(k) < 0).forEach(k => sinCampo.push(t + '.' + k));
    ks.filter(k => ps.indexOf(k) < 0).forEach(k => sinCampo.push(t + '.' + k + ' (campo sin parámetro)'));
  });
  if (sinCampo.length) mal('parámetros que el compositor no puede editar: ' + sinCampo.join(', '));
  else bien('el compositor tiene un campo para cada parámetro de los ' + Object.keys(P.averias).length + ' tipos');

  // Los tickets hechos sólo de averías se cierran encadenando sus arreglos, sin su guion.
  const compuestos = P.escenarios.filter(e => !e.objetivo && e.averias.some(a => !P.averias[a.tipo].condicion));
  let malos = 0;
  compuestos.forEach(e => {
    const st = P.preparar(e);
    correr(P, st, [ALARMAS].concat(P.arregloAverias(st, e.averias), [ALARMAS]));
    const q = e.resuelto(st, P);
    if (q.length) { mal(e.id + ': encadenar los arreglos de sus averías no lo cierra: ' + q.join(' | ')); malos++; }
  });
  if (!malos) bien(compuestos.length + ' tickets hechos sólo de averías se cierran encadenando los arreglos del catálogo, sin su guion');

  // Una combinación que no está en ningún ticket.
  const inventada = [{ tipo: 'ruta-rota', modo: 'igw', hace: 20 }, { tipo: 'servicio-caido', instancia: 'web-01', servicio: 'nginx', deshabilitado: true, hace: 15 },
    { tipo: 'bucket-publico', bucket: 'tienda-facturas', hace: 30 }, { tipo: 'rds-lleno', hace: 10 }, { tipo: 'sg-abierto', sg: 'db', puerto: 5432 }];
  const v = P.validarAverias(inventada);
  if (v.length) mal('la combinación inventada no valida: ' + v.join(' | '));
  else {
    const st = P.crear(); P.aplicarAverias(st, inventada); P.refrescarAlertas(st);
    const al = P.alertasActivas(st).length, antes = P.pendientesAverias(st, inventada).length;
    correr(P, st, P.arregloAverias(st, inventada)); P.refrescarAlertas(st);
    const q = P.pendientesAverias(st, inventada).concat(P.alertasActivas(st).map(x => x.nombre));
    if (!al || !antes || q.length) mal('la combinación inventada: ' + al + ' alarmas, ' + antes + ' pendientes, y tras arreglar quedan: ' + q.join(' | '));
    else bien('una combinación inventada de 5 averías valida, dispara ' + al + ' alarmas y se cierra encadenando sus arreglos');
  }
  // El validador: lo que debe rechazar.
  const rechazos = [
    [[{ tipo: 'kaboom' }], /desconocido/], [[{ tipo: 'bucket-publico' }], /falta bucket/], [[{ tipo: 'instancia-parada', instancia: 'web-09' }], /instancia/],
    [[{ tipo: 'sg-abierto', sg: 'web', puerto: 22 }, { tipo: 'deriva-terraform', puertos: [8080] }], /tocan lo mismo/],
    [[{ tipo: 'health-check', ruta: '/health' }], /no rompería/], [[{ tipo: 'deriva-terraform', puertos: [443] }], /no habría deriva/], [[{ tipo: 'ip-oficina', nueva: N.OFICINA }], /no cambiaría/],
  ].filter(([l, re]) => !P.validarAverias(l).some(x => re.test(x)));
  if (rechazos.length) rechazos.forEach(([l]) => mal('el validador acepta ' + JSON.stringify(l)));
  else bien('el validador rechaza tipos inventados, parámetros que faltan, recursos que no existen, dos averías sobre lo mismo y averías que no romperían nada');
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
    if (r.escenario.pistas.length !== 3) { mal(et + d.id + ': no tiene tres pistas'); malos++; }
  });
  // Una incidencia sin textos didácticos: se generan, y en inglés no queda nada en español.
  const d = { formato: 'puesto-incidencia/1', id: 'EXT-900', asunto: 'Noche movida', cuerpo: ['Todo a la vez.'], impacto: 'alto', urgencia: 'alta',
    averias: [{ tipo: 'clave-filtrada', intrusas: 2, hace: 30 }, { tipo: 'disco-lleno', usadoG: 90, hace: 60 }, { tipo: 'recursos-olvidados', instancia: true, hace: 20000 }] };
  const r = Q.cargarIncidencia(d);
  if (!r.ok) { mal(et + 'una incidencia sin textos didácticos no se acepta: ' + r.errores.join(' | ')); malos++; }
  else {
    const e = r.escenario, txt = e.pistas.concat(e.causa, e.solucion, e.leccion, e.area, e.practicas.map(p => p.t));
    if (et && txt.some(x => ES_TXT.test(x.replace(/aws [^·]*/g, '')))) { mal(et + 'lo generado parece español: ' + txt.filter(x => ES_TXT.test(x)).join(' | ')); malos++; }
    if (e.funciones.join() !== 'iam,ec2,coste,incid') { mal(et + 'funciones derivadas: ' + e.funciones.join()); malos++; }
    const st = Q.preparar(e); correr(Q, st, Q.guionDe(e, st));
    if (!e.practicas.every(p => p.ok(st))) { mal(et + 'su propio guion no cumple sus buenas prácticas: ' + e.practicas.filter(p => !p.ok(st)).map(p => p.t).join(' | ')); malos++; }
  }
  if (!malos) bien(et + ex.length + ' tickets exportados como plantilla se reimportan y su solución generada los cierra; una incidencia sin textos los genera y su guion cumple sus prácticas');
}
{
  // Rechazos del cargador.
  const base = { formato: 'puesto-incidencia/1', asunto: 'x', cuerpo: ['y'], impacto: 'medio', urgencia: 'media', averias: [{ tipo: 'precios-vacios' }] };
  const casos = [
    ['{ esto no es json', /JSON/], [Object.assign({}, base, { formato: 'otro/1' }), /formato/], [Object.assign({}, base, { id: 'INC-7101' }), /ya es un ticket/],
    [Object.assign({}, base, { averias: [{ tipo: 'pedido-borrado' }] }), /No rompe nada/], [Object.assign({}, base, { hace: 50000 }), /43200/],
    [Object.assign({}, base, { impacto: 'alto', urgencia: 'alta', abiertoHace: 50, hace: 60 }), /SLA/],
  ].filter(([d, re]) => { const r = P.cargarIncidencia(typeof d === 'string' ? d : JSON.stringify(d)); return r.ok || !r.errores.some(x => re.test(x)); });
  if (casos.length) casos.forEach(([d]) => mal('el cargador acepta o no explica: ' + (typeof d === 'string' ? d : JSON.stringify(d))));
  else bien('rechaza JSON roto, otro formato, el id de un ticket, lo que no rompe nada, más de un mes y un P1 que nace con medio SLA gastado');

  // Las guardias generadas también son incidencias en fichero, y cada familia se dice con el catálogo.
  let malos = 0;
  P.familias.forEach(f => { for (let s = 1; s <= 5; s++) { const v = P.validarAverias(f.crear(P.azar(s))); if (v.length) { mal('la familia ' + f.id + ' no se dice con el catálogo: ' + v.join(' | ')); malos++; break; } } });
  [1, 2, 3].forEach(n => [7, 1234, 98765].forEach(s => {
    const g = P.generarGuardia(n, s), r = g.ok && P.cargarIncidencia(Object.assign({}, g.def));
    if (!r || !r.ok) { mal('la guardia ' + n + '/' + s + ' como fichero no se acepta: ' + (r ? r.errores.join(' | ') : 'no se genera')); malos++; }
  }));
  if (!malos) bien(P.familias.length + ' familias se dicen con el catálogo, y 9 guardias generadas se aceptan como fichero');
}

// ------------------------------------------------------------ compositor
console.log('\n  compositor:');
{
  const win = { PUESTO: { idioma: 'es' } };
  [path.join(D, 'topologia.js'), path.join(LINUX, 'motor.js'), path.join(D, 'nube.js'), path.join(D, 'aws.js'), path.join(D, 'servicios.js'), path.join(D, 'rds.js'), path.join(D, 'asg.js'), path.join(D, 'coste.js'), path.join(D, 'terraform.js'), path.join(D, 'averias.js'), path.join(D, 'escenarios.js'), path.join(LINUX, 'incidencias.js'), path.join(D, 'guardia.js')]
    .forEach(f => new Function('window', fs.readFileSync(f, 'utf8'))(win));
  const Q = win.PUESTO, els = {}, almacen = {};
  const el = () => ({ innerHTML: '', textContent: '', classList: { add() {}, toggle() {} }, querySelector: () => null });
  const documento = { querySelector: s => els[s] || (els[s] = el()), querySelectorAll: () => [], addEventListener() {}, body: el() };
  const ls = { getItem: k => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: k => { delete almacen[k]; } };
  new Function('window', 'document', 'localStorage', 'location', fs.readFileSync(path.join(LINUX, 'compositor.js'), 'utf8'))(win, documento, ls, {});
  const C = Q.compositor, html = () => els['#vista'].innerHTML;
  let malos = 0;
  Object.keys(Q.averias).forEach(t => {
    C.cargar({ asunto: 'x', cuerpo: ['y'], averias: [Object.assign({ tipo: t }, JSON.parse(JSON.stringify(Q.averias[t].ejemplo)))] }, t);
    const falta = (Q.camposAveria[t] || []).filter(c => html().indexOf('data-k="' + c.k + '"') < 0).map(c => c.k);
    if (falta.length) { mal('el compositor no pinta ' + t + '.' + falta.join(', ')); malos++; }
    if (!Q.averias[t].condicion && !C.est.res.ok) { mal('el ejemplo de ' + t + ' no sale jugable en el compositor: ' + C.est.res.errores.join(' | ')); malos++; }
  });
  Q.exportables().forEach(e => {
    C.cargar(Q.exportarIncidencia(e), e.id);
    const id = C.guardarEnCola(), g = JSON.parse(almacen['puesto-cloud-importadas'] || '[]').find(x => x.id === id);
    if (!C.est.res.ok || !C.est.vista || !g || !Q.cargarIncidencia(g).ok) { mal('partir de ' + e.id + ' y guardarlo no da una incidencia jugable: ' + (C.est.res.errores || []).join(' | ')); malos++; }
  });
  if (almacen['puesto-linux-importadas'] || almacen['puesto-linux-borrador']) { mal('el compositor de la nube escribe en la cola del Puesto Linux'); malos++; }
  const gd = JSON.parse(JSON.stringify(Q.generarGuardia(3, 4242).def));
  C.cargar(gd, 'guardia');
  if (!C.est.res.ok) { mal('una guardia de nivel 3 no sale jugable en el compositor: ' + C.est.res.errores.join(' | ')); malos++; }
  C.cargar({ asunto: 'x', cuerpo: [''], averias: [{ tipo: 'bucket-publico' }] }, 'a medias');
  if (!C.est.res.errores.some(x => /falta bucket/.test(x))) { mal('con el ticket a medias, el ensayo no avisa del bucket sin elegir'); malos++; }
  if (!malos) bien('pinta los ' + Object.keys(Q.averias).length + ' tipos con un control por campo; ' + Q.exportables().length + ' tickets y una guardia de nivel 3 cargan, se guardan en su propia cola y siguen siendo jugables');
}

console.log('\n' + (fallos ? fallos + ' fallo' + (fallos === 1 ? '' : 's') : 'Todo en orden'));
process.exit(fallos ? 1 : 0);
