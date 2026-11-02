// La sala (sala.js): el stack dibujado como datacenter isométrico.
//
// Lo que se comprueba es lo que haría mentir al dibujo sin romper la app:
// una pieza colocada que no aparece en la sala, un recorrido que se salta una
// capa o la visita fuera de orden, un paso sin texto, un número NaN en el SVG.
const fs = require('fs'), path = require('path');
const R = __dirname;

class DCLogic { constructor(){ this.props = {}; } setState(p){ Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); } }
const store = {};
global.localStorage = { getItem:k=>(k in store?store[k]:null), setItem:(k,v)=>{store[k]=String(v)}, removeItem:k=>{delete store[k]} };
global.window = { location:{ hash:'', search:'', pathname:'/', href:'file:///x' }, addEventListener(){}, removeEventListener(){} };
global.document = { addEventListener(){}, removeEventListener(){}, createElement:()=>({ style:{}, click(){}, setAttribute(){}, appendChild(){} }), body:{ appendChild(){}, removeChild(){} }, head:{ appendChild(){} }, querySelectorAll:()=>[], getElementById:()=>null };
global.history = { replaceState(){} };
global.navigator = { clipboard:{ writeText(){ return Promise.resolve(); } } };
['piezas','capas','textos','retos','kids','tickets','eventos','comandos'].forEach(n => new Function('window', fs.readFileSync(path.join(R, 'contenido', n + '.js'), 'utf8'))(global.window));
new Function('window', fs.readFileSync(path.join(R, 'sala.js'), 'utf8'))(global.window);
global.React = { createElement:(...a)=>({ a }), Fragment:'F' };
let timers = [];
global.setTimeout = (f) => { timers.push(f); return timers.length; }; global.clearTimeout = () => {};
global.setInterval = () => 0; global.clearInterval = () => {};
global.Blob = function(){}; global.URL = { createObjectURL:()=>'blob:x', revokeObjectURL(){} };
const src = fs.readFileSync(path.join(R, 'Laboratorio.dc.html'), 'utf8');
const code = src.match(/<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/)[1];
const Component = new Function('DCLogic','StreamableLogic','React','localStorage','window','document','history','navigator', code + '\nreturn Component;')(DCLogic, DCLogic, global.React, global.localStorage, global.window, global.document, global.history, global.navigator);

const S = global.window.LABSTACK_SALA;
let fail = 0, ok = 0;
function check(cond, msg){ if (cond) ok++; else { fail++; console.error('  FAIL ' + msg); } }
function nuevo(placed, lang){ const c = new Component(); c.props = {}; c.setState({ mode:'map', lang: lang || 'es', placed: placed || {} }); return c; }

const base = new Component();
const blocks = base.blocks(), meta = base.layerMeta();
const presets = base.presets().map(p => [p.id, p.placed]);
// Todo el catálogo a la vez: el peor caso de racks y placas.
const todo = {}; blocks.forEach(b => (todo[b.cat] = todo[b.cat] || []).push(b.id));
presets.push(['catálogo entero', todo]);
presets.push(['sólo lógica', { contenedores:['docker'], orquestacion:['k8s'] }]);
presets.push(['sólo red', { red:['router'] }]);

console.log('— cada pieza colocada está en la sala —');
for (const [id, placed] of presets) {
  for (const lang of ['es', 'en']) {
    const c = nuevo(placed, lang), e = c.salaEscena();
    const dibujadas = new Set([...e.svg.matchAll(/data-pieza="([^"]+)"/g)].map(m => m[1]));
    const faltan = Object.keys(placed).flatMap(cat => placed[cat]).filter(p => !dibujadas.has(p));
    check(!faltan.length, id + ' [' + lang + ']: faltan ' + faltan.join(', '));
    check(!/NaN|undefined|Infinity/.test(e.svg), id + ' [' + lang + ']: el SVG tiene NaN/undefined');
    check(e.svg === nuevo(placed, lang).salaEscena().svg, id + ': dos escenas iguales para lo mismo');
  }
  console.log('  ok  ' + id);
}

console.log('— el recorrido —');
for (const [id, placed] of presets) {
  const e = nuevo(placed).salaEscena(), cats = e.paradas.map(p => p.cat);
  check(cats[0] === 'entrada', id + ': empieza en Internet');
  const orden = cats.slice(1).map(c => S.RECORRIDO.indexOf(c));
  check(orden.every((v, i) => v >= 0 && (i === 0 || v > orden[i - 1])), id + ': fuera de orden ' + cats.join('>'));
  // Toda capa del recorrido que esté colocada tiene parada (la sala no se salta ninguna).
  const saltadas = S.RECORRIDO.filter(c => (placed[c] || []).length && cats.indexOf(c) < 0);
  check(!saltadas.length, id + ': se salta ' + saltadas.join(', '));
  check(e.tramos.length === e.paradas.length - 1, id + ': un tramo entre cada par de paradas');
  check(e.tramos.every(t => t.pts.length >= 2 && t.pts.every(p => isFinite(p[0]) && isFinite(p[1]))), id + ': tramos con puntos válidos');
  check(e.paradas.every(p => p.caja.length === 4 && p.caja[2] > p.caja[0] && p.caja[3] > p.caja[1]), id + ': cada parada tiene caja para la cámara');
  check(cats.slice(1).every(c => meta[c] && meta[c].flow && meta[c].flow.es && meta[c].flow.en), id + ': cada parada tiene texto de flujo');
}
console.log('  ok  orden, tramos y textos en ' + presets.length + ' montajes');

console.log('— lo físico abajo, lo lógico encima —');
{
  const e = nuevo(todo).salaEscena();
  check(e.placas.join() === S.PLACAS.join(), 'el catálogo entero tiene todas las placas, en orden: ' + e.placas.join());
  const ops = blocks.filter(b => ['monitorizacion','cicd','iac','gobernanza'].includes(b.cat)).map(b => b.id);
  check(ops.every(id => e.ops.includes(id)), 'la operación vive en su puesto, no en un rack');
  check(!e.ops.includes('firewall') && !e.ops.includes('vpn'), 'firewall y VPN van en el rack de red, no en el puesto');
  const sl = nuevo({ contenedores:['docker'] }).salaEscena();
  check(/iso-fantasma/.test(sl.svg), 'contenedores sin servidores: se dibuja el hueco vacío');
  const sr = nuevo({ red:['router'] }).salaEscena();
  check(!/iso-fantasma/.test(sr.svg), 'sin capas lógicas no hace falta el hueco');
  const raro = S.escena({ piezas:[{ id:'x', cat:'red', code:'<b>', name:'a"b<c' }], cats:{}, textos:{} });
  check(!/<b>|a"b/.test(raro.svg), 'los textos se escapan');
}
console.log('  ok  placas, puesto de operación, huecos y escape');

console.log('— el modo mapa —');
for (const lang of ['es', 'en']) {
  const c = nuevo({}, lang); // vacío: la sala enseña el ejemplo
  let v = c.renderVals();
  check(v.map.isSala && !v.map.isPlano, lang + ': la sala es la vista por defecto');
  check(v.map.viewTabs.length === 2 && v.map.salaLegend.length === 5, lang + ': selector de vista y leyenda');
  timers = [];
  c.runSalaFlow();
  const n = c.salaEscena().paradas.length, vistos = [];
  for (let i = 0; i < n + 1 && c.state.flowing; i++) {
    v = c.renderVals();
    check(v.map.captionShow && v.map.caption && v.map.stepName, lang + ': paso ' + (i + 1) + ' sin texto');
    // El último paso se queda en pantalla durante la pausa final: se cuenta una vez.
    if (vistos[vistos.length - 1] !== v.map.stepLabel) vistos.push(v.map.stepLabel);
    // El último temporizador es el del recorrido (antes puede ir el del aviso de logro).
    const f = timers.pop(); timers = []; if (f) f();
  }
  check(vistos.length === n && vistos[n - 1] === n + ' / ' + n, lang + ': recorre las ' + n + ' paradas (' + vistos.join(', ') + ')');
  c.setMapView('plano'); v = c.renderVals();
  check(v.map.isPlano && !c.state.flowing, lang + ': cambiar a esquema para el recorrido');
}
console.log('  ok  vista por defecto, recorrido y cambio de vista');

console.log('\n' + (fail ? fail + ' fallos' : 'Todo OK') + ' (' + ok + ' comprobaciones)');
process.exit(fail ? 1 : 0);
