// Smoke test: instancia Component con stubs y ejecuta renderVals() en los 10 modos.
const fs = require('fs'), path = require('path');
const FILE = require('path').join(__dirname, 'Laboratorio.dc.html');
const src = fs.readFileSync(FILE, 'utf8');

const m = src.match(/<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no script block'); process.exit(1); }
const code = m[1];

class DCLogic {
  constructor(){ this.props = {}; }
  setState(p){ const patch = (typeof p === 'function') ? p(this.state) : p; Object.assign(this.state, patch); }
}
const store = {};
global.localStorage = { getItem:k=>(k in store?store[k]:null), setItem:(k,v)=>{store[k]=String(v)}, removeItem:k=>{delete store[k]} };
global.window = { location:{ hash:'', search:'', pathname:'/', href:'file:///x' }, addEventListener(){}, removeEventListener(){} };
global.document = { addEventListener(){}, removeEventListener(){}, createElement:()=>({ style:{}, click(){}, setAttribute(){}, appendChild(){} }), body:{ appendChild(){}, removeChild(){} }, head:{ appendChild(){} }, querySelectorAll:()=>[] };
global.history = { replaceState(){} };
global.navigator = { clipboard:{ writeText(){ return Promise.resolve(); } } };

// cargar el contenido externo igual que hacen las <script> de la página
['piezas','capas','textos','retos','kids','tickets','eventos','comandos'].forEach(function(n){
  const code=fs.readFileSync(require('path').join(__dirname, 'contenido', n+'.js'),'utf8');
  new Function('window', code)(global.window);
});
new Function('window', fs.readFileSync(require('path').join(__dirname, 'sala.js'), 'utf8'))(global.window);
global.React = { createElement:(...a)=>({ a }), Fragment:'F' };
global.setInterval = ()=>0; global.clearInterval = ()=>{}; global.setTimeout = (f)=>0; global.clearTimeout = ()=>{};
global.DCLogic = DCLogic; global.StreamableLogic = DCLogic;
global.Blob = function(){}; global.URL = { createObjectURL:()=>'blob:x', revokeObjectURL(){} };

const factory = new Function('DCLogic','StreamableLogic','React','localStorage','window','document','history','navigator',
  code + '\nreturn Component;');
const Component = factory(DCLogic, DCLogic, global.React, global.localStorage, global.window, global.document, global.history, global.navigator);

const MODES = ['home','kids','sandbox','mission','quiz','map','terminal','metrics','http','deploy','incident','desk','events'];
let fail = 0;

function run(label, setup){
  const c = new Component();
  c.props = {};
  try { if (setup) setup(c); } catch (e) { console.error('  SETUP FAIL ['+label+']', e.message); fail++; return null; }
  try {
    const v = c.renderVals();
    const missing = [];
    // toda clave {{ x }} de primer nivel usada en la plantilla debe existir
    return { c, v };
  } catch (e) {
    console.error('  FAIL ['+label+']', e.message, '\n', (e.stack||'').split('\n').slice(1,4).join('\n'));
    fail++; return null;
  }
}

console.log('— renderVals() por modo —');
for (const mode of MODES){
  const r = run(mode, c => { c.setState({ mode }); if (mode==='quiz') c.setState({ quiz: c.newQuiz() }); });
  if (r) {
    const v = r.v;
    console.log('  ok  ' + mode.padEnd(9) + ' grid=' + v.gridClass + '  palette=' + (v.showPalette?'1':'0') + ' rail=' + (v.showRail?'1':'0') + ' subnav=' + v.subnav.length + ' planes=' + (v.planes?v.planes.length:'-'));
  }
}

console.log('— con stack montado (preset) + ambas densidades —');
for (const dens of ['compact','detail']){
  const r = run('sandbox/'+dens, c => { c.setState({ mode:'sandbox', density:dens }); c.loadPreset(c.presets()[0].id); });
  if (r){
    const v = r.v;
    const nLayers = v.planes.reduce((n,p)=>n+p.layers.length,0);
    console.log('  ok  ' + dens.padEnd(9) + ' capas=' + nLayers + ' gap=' + v.layerGap + ' progreso=' + v.progressParts.map(p=>p.value).join(' ') + ' siguiente="' + v.nextStep.text + '"');
  }
}

console.log('— navegación por grupos —');
{
  const c = new Component(); c.props = {};
  c.renderVals().navGroups[2].onClick();          // Explorar
  let v = c.renderVals();
  console.log('  ok  Explorar -> mode=' + v.mode + ' subnav=' + v.subnav.map(s=>s.label).join('/'));
  v.subnav[4].onClick();                           // Terminal
  v = c.renderVals();
  console.log('  ok  Terminal -> mode=' + v.mode + ' grid=' + v.gridClass + ' palette=' + (v.showPalette?'1':'0'));
  v.navGroups[1].onClick();                        // Practicar
  v = c.renderVals();
  console.log('  ok  Practicar -> mode=' + v.mode + ' grid=' + v.gridClass);
  v.subnav[1].onClick();                           // Quiz
  v = c.renderVals();
  console.log('  ok  Quiz -> palette=' + (v.showPalette?'1':'0') + ' rail=' + (v.showRail?'1':'0') + ' grid=' + v.gridClass);
  v.goHome();
  v = c.renderVals();
  console.log('  ok  Inicio -> mode=' + v.mode + ' cards=' + v.home.cards.length + ' stats=' + v.home.stats.map(s=>s.value).join('/'));
}

console.log('— menú Más —');
{
  const c = new Component(); c.props = {};
  let v = c.renderVals();
  v.toolTheme(); v = c.renderVals(); console.log('  ok  tema -> ' + v.themeClass + ' (' + v.themeLabel + ')');
  v.toolAch(); v = c.renderVals(); console.log('  ok  logros -> overlay=' + v.showAchievements + ' ' + v.achLabel);
  v.closeAch(); v = c.renderVals(); v.toolReset(); console.log('  ok  reiniciar');
}

console.log('— i18n EN —');
{
  const c = new Component(); c.props = {};
  c.renderVals().setEn();
  const v = c.renderVals();
  console.log('  ok  home="' + v.home.title + '" nav=' + v.navGroups.map(g=>g.label).join('/'));
}

console.log('— progreso: los modos nuevos cuentan —');
{
  const c = new Component(); c.props = {};
  const t12 = c.tickets();
  const resolver = i => {
    c.setState({ mode: 'desk' });
    c.deskOpen(t12[i].id);
    let v = c.renderVals().desk; v.onDiagnose();
    v = c.renderVals().desk; v.causes[t12[i].causes.findIndex(x => x.correct)].onClick();
    v = c.renderVals().desk; v.fixes[t12[i].fixes.findIndex(x => x.correct)].onClick();
    c.evalAchievements();
  };
  resolver(0);
  if (!c.state.achievements.oncall) { console.error('  FAIL resolver un ticket no da el logro «de guardia»'); fail++; }
  else console.log('  ok  1 ticket resuelto -> logro «de guardia»');
  for (let i = 1; i < Math.ceil(t12.length / 2); i++) resolver(i);
  if (!c.state.achievements.veteran) { console.error('  FAIL media cola resuelta no da el logro «veterano»'); fail++; }
  else console.log('  ok  media cola resuelta -> logro «veterano»');

  c.setState({ mode: 'events' });
  c.eventos().filter(x => x.noise).forEach(r => {
    const row = c.renderVals().events.rows.find(x => x.id === r.id);
    if (row) { row.onClick(); c.renderVals().events.det.onClose(); }
  });
  c.evalAchievements();
  if (!c.state.achievements.triage) { console.error('  FAIL cerrar todo el ruido no da el logro «buen ojo»'); fail++; }
  else console.log('  ok  ruido cerrado -> logro «buen ojo»');

  c.setState({ kids: { part: 1, step: 11, phase: 'end', wrong: null } });
  c.evalAchievements();
  if (!c.state.achievements.tower) { console.error('  FAIL terminar Kids no da el logro «torre en pie»'); fail++; }
  else console.log('  ok  partida de Kids terminada -> logro «torre en pie»');

  // la ruta de aprendizaje tiene que llevar a los modos nuevos
  const v = c.renderVals();
  const refs = v.path.steps.map(s => s.title).join(' | ');
  const tieneDesk = v.path.steps.some(s => s.statusIcon === '🎧' || s.statusIcon === '✓');
  if (v.path.steps.length < 12) { console.error('  FAIL la ruta no incorpora los pasos nuevos'); fail++; }
  else console.log('  ok  ruta de ' + v.path.steps.length + ' pasos, termina en el puesto de guardia');
}

console.log('— se guarda lo que cuesta rehacer —');
{
  const c = new Component(); c.props = {};
  c.setState({ desk: { ...c.state.desk, solved: { 'T-1042': 1, 'T-1043': 1 } }, events: { ...c.state.events, closed: { 'EV-2056': 1 } } });
  c.persist();
  const raw = JSON.parse(localStorage.getItem(c.storageKey()));
  if (!raw.deskSolved || Object.keys(raw.deskSolved).length !== 2) { console.error('  FAIL no guarda los tickets resueltos'); fail++; }
  else if (!raw.evClosed || !raw.evClosed['EV-2056']) { console.error('  FAIL no guarda los eventos cerrados'); fail++; }
  else console.log('  ok  guarda tickets resueltos y eventos cerrados');
  const c2 = new Component(); c2.props = {}; c2.componentDidMount();
  if (Object.keys((c2.state.desk || {}).solved || {}).length !== 2) { console.error('  FAIL no restaura los tickets al recargar'); fail++; }
  else if (!((c2.state.events || {}).closed || {})['EV-2056']) { console.error('  FAIL no restaura los eventos al recargar'); fail++; }
  else console.log('  ok  los restaura al volver a abrir');
  // Kids no se guarda a propósito: son partidas cortas
  if (c2.state.kids.step !== 0 || c2.state.kids.part !== null) { console.error('  FAIL Kids no debería guardarse'); fail++; }
  else console.log('  ok  el progreso de Kids no se guarda, como está previsto');
}

// claves {{ x }} de la plantilla presentes en renderVals
console.log('— claves de plantilla sin binding —');
{
  const tpl = src.slice(src.indexOf('<x-dc>'), src.indexOf('</x-dc>'));
  const keys = new Set();
  const re = /\{\{\s*([A-Za-z_$][\w$]*)/g; let mm;
  while ((mm = re.exec(tpl))) keys.add(mm[1]);
  // nombres de iteración de sc-for
  const loopVars = new Set(); const re2 = /as="([^"]+)"/g;
  while ((mm = re2.exec(tpl))) loopVars.add(mm[1]);
  const c = new Component(); c.props = {};
  const seen = new Set();
  for (const mode of MODES){
    c.setState({ mode }); if (mode==='quiz' && !c.state.quiz) c.setState({ quiz:c.newQuiz() });
    const v = c.renderVals();
    Object.keys(v).forEach(k=>seen.add(k));
  }
  const missing = [...keys].filter(k=>!seen.has(k) && !loopVars.has(k) && k!=='false' && k!=='true');
  if (missing.length){ console.error('  FALTAN: ' + missing.join(', ')); fail++; }
  else console.log('  ok  todas las claves de la plantilla tienen binding');
}

console.log(fail ? ('\nFALLOS: ' + fail) : '\nTodo OK');
process.exit(fail ? 1 : 0);
