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
  [path.join(D, 'topologia.js'), path.join(LINUX, 'motor.js'), path.join(D, 'nube.js'), path.join(D, 'aws.js'), path.join(D, 'escenarios.js'), path.join(D, 'soluciones.js')]
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
  const fallanSsh = st.aws.instancias.map(i => i.nombre).filter(n => { const r = correr(P, st, ['ssh ' + n]); const ok = r.ses.host === n; correr(P, st, ['exit'], r.ses); return !ok; });
  if (fallanSsh.length) mal('ssh por el ~/.ssh/config no entra en: ' + fallanSsh.join(', '));
  const web = correr(P, st, ['curl -I http://52.18.140.66']);
  if (!/200 OK/.test(lineas(web, 0))) mal('la web no contesta desde fuera: ' + lineas(web, 0));
  const json = correr(P, st, ['aws ec2 describe-instances']);
  try { const d = JSON.parse(lineas(json, 0)); if (d.Reservations.length !== 5) mal('describe-instances no devuelve las 5 instancias'); } catch (e) { mal('describe-instances no da JSON válido: ' + e.message); }
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
  correr(P, st, ['aws ec2 start-instances --instance-ids ' + ID.inst['web-02'], 'aws ec2 wait instance-running --instance-ids ' + ID.inst['web-02']]);
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
  const r7 = correr(P, st, ['ssh web-01', 'aws ec2 describe-instances']);
  chk(/command not found/.test(lineas(r7, 1)), 'en una instancia no hay CLI de AWS');
  // Sin --security-group-ids, AWS pone el default.
  st = P.crear();
  correr(P, st, ['aws ec2 run-instances --image-id ' + ID.ami.web + ' --instance-type t3.small --subnet-id ' + ID.subred['public-c'] + ' --key-name tienda-prod --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web-03}]"', 'sleep 120']);
  const w3 = st.aws.instancias.find(i => i.nombre === 'web-03');
  chk(w3 && w3.sgs[0] === ID.sg.default && w3.estado === 'running' && !N.webSana(st, w3), 'una instancia lanzada sin security group lleva el default y no se ve desde fuera');
  if (!malos) bien('timeout frente a refused, usuario y clave, IPs privadas sólo por el bastión, IP nueva al arrancar, volumen frente a sistema de ficheros, 6 h entre cambios, regiones, CLI sólo en tu equipo, el security group default');
}

// ------------------------------------------------------------ --query y formatos
{
  let malos = 0;
  const q = (expr, esperado) => { const st = P.crear(); const r = correr(P, st, ['aws ec2 describe-instances --query "' + expr + '" --output json']); let v; try { v = JSON.parse(lineas(r, 0)); } catch (e) { v = lineas(r, 0); } if (JSON.stringify(v) !== JSON.stringify(esperado)) { mal('--query ' + expr + ' → ' + JSON.stringify(v).slice(0, 160) + ' (esperaba ' + JSON.stringify(esperado).slice(0, 120) + ')'); malos++; } };
  q('Reservations[].Instances[].Tags[?Key==`Name`]|[0].Value', null);   // el | corta la proyección: [0] es una lista y .Value de una lista es null
  q('Reservations[].Instances[].Tags[?Key==`Name`][]|[0].Value', 'bastion');
  q('Reservations[].Instances[].Tags[?Key==`Name`].Value[]', ['bastion', 'web-01', 'web-02', 'app-01', 'db-01']);
  q("Reservations[].Instances[?Placement.AvailabilityZone=='eu-west-1b'].InstanceId[]", [ID.inst['web-02'], ID.inst['db-01']]);
  q('length(Reservations[])', 5);
  q("Reservations[].Instances[].{N:Tags[?Key=='Name']|[0].Value,T:InstanceType}[?T=='t3.small'].N", []);   // el filtro se aplica a cada elemento proyectado
  q("Reservations[].Instances[].{N:Tags[?Key=='Name']|[0].Value,T:InstanceType} | [?T=='t3.small'].N", ['web-01', 'web-02']);
  q('Reservations[0].Instances[0].[InstanceId,State.Name]', [ID.inst.bastion, 'running']);
  const st = P.crear();
  const t = correr(P, st, ['aws ec2 describe-instances --query "Reservations[].Instances[].[InstanceId,InstanceType]" --output text', 'aws ec2 describe-instances --query "Reservations[].Instances[].[InstanceId,InstanceType]" --output table']);
  if (lineas(t, 0).split('\n').length !== 5 || !/\t/.test(lineas(t, 0))) { mal('--output text debería dar una línea por instancia separada por tabuladores'); malos++; }
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
  const NOMBRES = /Lucía/g;
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

console.log('\n' + (fallos ? fallos + ' fallo' + (fallos === 1 ? '' : 's') : 'Todo en orden'));
process.exit(fallos ? 1 : 0);
