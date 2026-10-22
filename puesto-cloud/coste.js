// Puesto Cloud · coste (fase 3): Cost Explorer, presupuesto y Elastic IPs.
//
// Cada recurso cuesta por hora mientras existe (o mientras está encendido),
// y lo que ya se ha gastado en el mes no vuelve. Los precios son aproximados
// (eu-west-1, bajo demanda): lo que importa es el orden de magnitud, que una
// m6i.4xlarge olvidada o un io2 sin usar se notan en la factura y una t3.small no.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, N = P.nube, ID = N.ID, C = N.cli;
const { OPS, ErrorAws, falla, requiere, uno, lista, iso } = C;
const MES = -(22 * 1440 + 9 * 60 + 12);       // 1 de septiembre, 00:00
const FIN_MES = MES + 30 * 1440;
N.MES = MES;
const HORA = { 't3.micro': 0.0114, 't3.small': 0.0228, 't3.medium': 0.0456, 't3.large': 0.0912, 'm6i.large': 0.107, 'm6i.xlarge': 0.214, 'm6i.4xlarge': 0.856, 'c5.4xlarge': 0.68 };
const SVC = { ec2: 'Amazon Elastic Compute Cloud - Compute', otros: 'EC2 - Other', rds: 'Amazon Relational Database Service', elb: 'Amazon Elastic Load Balancing', s3: 'Amazon Simple Storage Service', cw: 'AmazonCloudWatch', vpc: 'Amazon Virtual Private Cloud' };
N.PRESUPUESTO = 900;

P.alCrear.push(st => {
  st.aws.eips = [];
  st.aws.coste = { base: null };
  st.aws.coste.base = N.ritmo(st);   // el ritmo de la cuenta sana: la referencia de la detección de anomalías
});
// Lo que cuesta cada cosa: [servicio, $/hora, desde, hasta, etiquetas]
function partidas(st) {
  const a = st.aws, out = [], ahora = st.reloj, tags = (x, def) => Object.assign({ Entorno: 'prod' }, def || {}, (x.tags || []).reduce((o, t) => { o[t.Key] = t.Value; return o; }, {}));
  a.instancias.forEach(i => {
    const fin = i.estado === 'running' || i.estado === 'pending' ? null : (i.fin != null ? i.fin : i.iniciada);
    out.push([SVC.ec2, HORA[i.tipo] || 0.05, i.iniciada, fin, tags(i)]);
  });
  a.volumenes.concat(a.volumenesBorrados || []).forEach(v => {
    const gb = v.tam, h = (v.tipo === 'io2' ? gb * 0.142 + (v.iops || 0) * 0.072 : gb * 0.088) / 720;
    const i = a.instancias.find(x => x.id === v.inst);
    out.push([SVC.otros, h, v.creado, v.borrado != null ? v.borrado : null, tags(v, i ? tags(i) : {})]);
  });
  a.snapshots.forEach(s => out.push([SVC.otros, s.tam * 0.05 / 720, s.desde, null, { Entorno: 'prod' }]));
  a.nats.forEach(n => out.push([SVC.otros, 0.048 + 0.06, n.creado, n.estado === 'deleted' ? n.borrado : null, { Entorno: 'prod' }]));
  a.eips.forEach(e => out.push([SVC.vpc, e.inst ? 0 : 0.005, e.creado, e.liberada != null ? e.liberada : null, tags(e)]));
  if (a.elb) out.push([SVC.elb, 0.0252 + 0.008, -43000, null, { Entorno: 'prod' }]);
  if (a.rds) a.rds.instancias.forEach(x => { const k = x.multiAZ ? 2 : 1; out.push([SVC.rds, 0.188 * k + x.almacen * 0.133 * k / 720, x.creado, x.estado === 'deleted' ? x.listoEn : null, { Entorno: x.origen ? 'recuperacion' : 'prod' }]); });
  out.push([SVC.s3, 0.042, -300000, null, { Entorno: 'prod' }]);
  out.push([SVC.cw, 0.035, -300000, null, { Entorno: 'prod' }]);
  return out.map(([svc, h, desde, hasta, t]) => ({ svc, h, desde, hasta: hasta == null ? null : hasta, t }));
}
// Gasto entre dos minutos.
const gasto = (p, a, b) => { const ini = Math.max(a, p.desde), fin = Math.min(b, p.hasta == null ? Infinity : p.hasta); return fin > ini ? p.h * (fin - ini) / 60 : 0; };
N.ritmo = st => partidas(st).filter(p => p.hasta == null || p.hasta > st.reloj).reduce((x, p) => x + p.h, 0);   // $/hora ahora mismo
N.gastado = st => partidas(st).reduce((x, p) => x + gasto(p, MES, st.reloj), 0);
N.prevision = st => N.gastado(st) + N.ritmo(st) * (FIN_MES - st.reloj) / 60;
N.ritmoBase = st => st.aws.coste.base;

// Al parar o terminar, se apunta cuándo deja de costar.
const parar = N.parar, terminar = N.terminar;
N.parar = (st, i, min) => { parar(st, i, min); i.fin = min == null ? st.reloj : min; };
N.terminar = (st, i) => { terminar(st, i); i.fin = st.reloj; };
const arrancar = N.arrancar;
N.arrancar = (st, i) => { arrancar(st, i); i.iniciada = st.reloj + 1; };

// ------------------------------------------------------------------ CLI
const dia = min => U.iso(min).slice(0, 10);
const aMin = f => Math.round((Date.parse(f + 'T00:00:00Z') - Date.parse(U.iso(0) + 'Z')) / 60000);
const importe = x => ({ Amount: x.toFixed(10).replace(/0+$/, '').replace(/\.$/, ''), Unit: 'USD' });
function periodo(o) {
  const tp = (o['time-period'] || []).join(' '), m = /Start=(\d{4}-\d{2}-\d{2}),End=(\d{4}-\d{2}-\d{2})/.exec(tp);
  if (!m) falla('ValidationException', 'Time period must be specified as Start=YYYY-MM-DD,End=YYYY-MM-DD');
  return [aMin(m[1]), aMin(m[2]), m[1], m[2]];
}
OPS.ce = {
  'get-cost-and-usage': (st, o) => {
    const [a, b] = periodo(o), gran = uno(o, 'granularity') || 'MONTHLY';
    if (b <= a) falla('ValidationException', 'Start date must be before end date');
    const g = (o['group-by'] || []).join(' '), mg = /Type=(DIMENSION|TAG),Key=([^,\s]+)/.exec(g);
    const ps = partidas(st), fin = Math.min(b, st.reloj);
    const tramos = gran === 'DAILY' ? Array.from({ length: Math.ceil((b - a) / 1440) }, (_, k) => [a + k * 1440, Math.min(b, a + (k + 1) * 1440)]) : [[a, b]];
    return { datos: { GroupDefinitions: mg ? [{ Type: mg[1], Key: mg[2] }] : [], ResultsByTime: tramos.map(([x, y]) => {
      const y2 = Math.min(y, fin), r = { TimePeriod: { Start: dia(x), End: dia(y) } };
      if (!mg) r.Total = { UnblendedCost: importe(ps.reduce((s, p) => s + gasto(p, x, y2), 0)) };
      else {
        const grupos = {};
        ps.forEach(p => { const k = mg[1] === 'TAG' ? mg[2] + '$' + (p.t[mg[2]] || '') : p.svc; grupos[k] = (grupos[k] || 0) + gasto(p, x, y2); });
        r.Total = {}; r.Groups = Object.keys(grupos).sort((u, v) => grupos[v] - grupos[u]).filter(k => grupos[k] > 0.005).map(k => ({ Keys: [k], Metrics: { UnblendedCost: importe(grupos[k]) } }));
      }
      r.Estimated = true;
      return r;
    }), DimensionValueAttributes: [] } };
  },
  'get-cost-forecast': (st, o) => { const [a, b] = periodo(o); const x = N.ritmo(st) * (b - Math.max(a, st.reloj)) / 60; return { datos: { Total: importe(Math.max(0, x)), ForecastResultsByTime: [{ TimePeriod: { Start: dia(Math.max(a, st.reloj)), End: dia(b) }, MeanValue: importe(Math.max(0, x)).Amount }] } }; },
};
OPS.ce['get-cost-and-usage'].permiso = () => ({ accion: 'ce:GetCostAndUsage', recurso: '*' });
OPS.ce['get-cost-forecast'].permiso = () => ({ accion: 'ce:GetCostForecast', recurso: '*' });
OPS.budgets = {
  'describe-budgets': (st, o) => { requiere(o, 'account-id'); return { datos: { Budgets: [{ BudgetName: 'tienda-mensual', BudgetLimit: importe(N.PRESUPUESTO), CostFilters: {}, CostTypes: {}, TimeUnit: 'MONTHLY', TimePeriod: { Start: '2026-01-01T00:00:00+00:00', End: '2087-06-15T00:00:00+00:00' },
    CalculatedSpend: { ActualSpend: importe(N.gastado(st)), ForecastedSpend: importe(N.prevision(st)) }, BudgetType: 'COST', LastUpdatedTime: iso(st.reloj - 120) }] } }; },
};
OPS.budgets['describe-budgets'].permiso = () => ({ accion: 'budgets:ViewBudget', recurso: '*' });
// Elastic IPs y volúmenes sueltos.
const eipJ = e => Object.assign({ PublicIp: e.ip, AllocationId: e.id, Domain: 'vpc', PublicIpv4Pool: 'amazon', NetworkBorderGroup: 'eu-west-1' }, e.inst ? { InstanceId: e.inst, AssociationId: 'eipassoc-0' + U.hex('as' + e.id, 16) } : {}, { Tags: e.tags || [] });
Object.assign(OPS.ec2, {
  'describe-addresses': st => ({ datos: { Addresses: st.aws.eips.filter(e => e.liberada == null).map(eipJ) } }),
  'release-address': (st, o) => { requiere(o, 'allocation-id'); const e = st.aws.eips.find(x => x.id === uno(o, 'allocation-id') && x.liberada == null); if (!e) falla('InvalidAllocationID.NotFound', "The allocation ID '" + uno(o, 'allocation-id') + "' does not exist"); if (e.inst) falla('InvalidIPAddress.InUse', 'Address ' + e.ip + ' is in use.'); e.liberada = st.reloj; return { datos: undefined }; },
  'delete-volume': (st, o) => {
    requiere(o, 'volume-id'); const v = N.vol(st, uno(o, 'volume-id'));
    if (!v || v.borrado != null) falla('InvalidVolume.NotFound', "The volume '" + uno(o, 'volume-id') + "' does not exist.");
    if (v.inst && st.aws.instancias.some(i => i.id === v.inst && i.estado !== 'terminated')) falla('VolumeInUse', 'Volume ' + v.id + ' is currently attached to ' + v.inst);
    v.borrado = st.reloj; st.aws.volumenes = st.aws.volumenes.filter(x => x !== v);
    st.aws.volumenesBorrados = (st.aws.volumenesBorrados || []).concat([v]);
    return { datos: undefined };
  },
});
C.PREFIJO.ce = 'ce'; C.PREFIJO.budgets = 'budgets';
C.AYUDA.push('ce', 'budgets');

// ------------------------------------------------------------------ alarmas
N.DEFS.push({ nombre: 'billing-cost-anomaly', ns: 'AWS/CostAnomalyDetection', metrica: 'AnomalousSpend', dim: [['Monitor', 'tienda-servicios']], umbral: 1, op: 'GreaterThanOrEqualToThreshold', host: null,
  desc: T('El gasto diario se ha disparado respecto a lo normal', 'Daily spend has spiked compared to normal'),
  eval: st => { const r = N.ritmo(st) * 24, b = N.ritmoBase(st) * 24, mal = r > b * 1.3; return { estado: mal ? 'ALARM' : 'OK', valor: Math.round(r - b), sev: 'warning', res: T('gasto de ' + r.toFixed(0) + ' $/día frente a los ' + b.toFixed(0) + ' $/día habituales', 'spending ' + r.toFixed(0) + ' $/day against the usual ' + b.toFixed(0) + ' $/day') }; } });
})(window.PUESTO = window.PUESTO || {});
