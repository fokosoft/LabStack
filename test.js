// Lanza todas las comprobaciones de una vez.
//
//   npm test        (o: node test.js)
//
// Son nueve y es fácil dejarse alguna al correrlas a mano. Si una falla, se ve
// su salida entera y el proceso termina con código distinto de cero, para que
// sirva también en un gancho de commit o en integración continua.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const SUITES = [
  ['smoke.js', 'renderVals en los 12 modos y bindings de la plantilla'],
  ['content-test.js', 'contenido: referencias cruzadas, traducciones y coherencia'],
  ['kids-test.js', 'modo Kids: las dos partidas de principio a fin'],
  ['desk-test.js', 'Puesto: los 12 tickets, pistas y coherencia tras resolver'],
  ['events-test.js', 'consola de eventos: correlación, triaje y puente al ticket'],
  ['puesto-linux/puesto-test.js', 'Puesto Linux: 20 tickets resueltos con comandos, trampas y solucionario'],
  ['puesto-cloud/nube-test.js', 'Puesto Cloud: la cuenta, 15 tickets, 90 guardias, el catálogo de averías, ficheros y compositor, en dos idiomas'],
  ['puesto-devops/devops-test.js', 'Puesto DevOps: el clúster, Helm, GitOps, 15 tickets, 90 guardias, el catálogo, ficheros y compositor, en dos idiomas'],
  ['puesto-linux/ingles-test.js', 'Puesto Linux en inglés: nada en español y los 20 tickets se resuelven igual'],
];

let fallos = 0;
const t0 = Date.now();
console.log('LabStack — comprobaciones\n');

for (const [file, desc] of SUITES) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) { console.error('  ✕ ' + file.padEnd(30) + 'no existe'); fallos++; continue; }
  const t = Date.now();
  try {
    execFileSync(process.execPath, [full], { stdio: 'pipe' });
    console.log('  ✓ ' + file.padEnd(30) + desc + '  (' + (Date.now() - t) + ' ms)');
  } catch (e) {
    fallos++;
    console.error('\n  ✕ ' + file.padEnd(30) + desc);
    const out = ((e.stdout || '') + (e.stderr || '')).toString().trimEnd();
    console.error(out.split('\n').map(l => '      ' + l).join('\n') + '\n');
  }
}

console.log('\n' + (fallos
  ? fallos + ' de ' + SUITES.length + ' comprobaciones fallan'
  : 'Las ' + SUITES.length + ' comprobaciones pasan') + '  (' + (Date.now() - t0) + ' ms)');
process.exit(fallos ? 1 : 0);
