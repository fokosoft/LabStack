// Puesto Cloud · Auto Scaling (fase 3): los workers de envíos.
//
// tienda-workers mantiene siempre su capacidad deseada: si una instancia
// muere, lanza otra con su launch template. Si no puede (una AMI que ya no
// existe, un security group borrado), no se rinde ni avisa a gritos: lo apunta
// en su historial de actividad y lo reintenta. Mirar ese historial es el oficio.
(function (P) {
'use strict';
const U = P.u, T = P.T, L = U.L, N = P.nube, ID = N.ID, C = N.cli;
const { OPS, ErrorAws, falla, requiere, uno, lista, iso } = C;
const idDe = (pref, sem) => pref + '-0' + U.hex('nube:' + sem, 16);
ID.lt = idDe('lt', 'worker');
ID.ami.worker1 = idDe('ami', 'worker-2026-06');
ID.ami.worker2 = idDe('ami', 'worker-2026-09');
const GRUPO = 'tienda-workers';
const actId = (st, n) => U.uuid('act' + n + ':' + st.aws.asg.actN);

P.alCrear.push(st => {
  const a = st.aws;
  a.amis.push({ id: ID.ami.worker1, nombre: 'tienda-worker-2026-06-01', desc: T('Worker de envíos (junio)', 'Shipping worker (June)'), creado: -160000, propia: true, unidades: [] },
    { id: ID.ami.worker2, nombre: 'tienda-worker-2026-09-15', desc: T('Worker de envíos (septiembre, parches incluidos)', 'Shipping worker (September, patches included)'), creado: -11500, propia: true, unidades: [] });
  a.asg = {
    actN: 0, workersN: 0,
    grupos: [{ nombre: GRUPO, lt: ID.lt, version: '$Default', min: 2, max: 6, deseado: 2, subredes: [ID.subred['private-a'], ID.subred['private-b']], creado: -150000, reintento: 0 }],
    lts: [{ id: ID.lt, nombre: 'tienda-worker', creado: -150000, defecto: 1,
      versiones: [{ n: 1, desc: T('Worker inicial', 'Initial worker'), creada: -150000, datos: { ImageId: ID.ami.worker1, InstanceType: 't3.medium', SecurityGroupIds: [ID.sg.app], IamInstanceProfile: { Name: 'tienda-api-role' } } }] }],
    actividades: [],
  };
  [0, 1].forEach(k => lanzarWorker(st, a.asg.grupos[0], { ImageId: ID.ami.worker1, InstanceType: 't3.medium', SecurityGroupIds: [ID.sg.app] }, -150000 + k, true));
});
N.asg = st => st.aws.asg.grupos[0];
N.lt = (st, id) => st.aws.asg.lts.find(l => l.id === id || l.nombre === id);
// Una instancia del grupo: sin sistema operativo que simular (nadie entra en un worker).
function lanzarWorker(st, g, datos, min, yaCorriendo) {
  const a = st.aws, n = ++a.asg.workersN, sub = N.subred(st, g.subredes[n % g.subredes.length]);
  const usados = a.instancias.filter(i => i.estado !== 'terminated').map(i => i.ipPriv);
  let ip = null; for (let k = 50; k < 250 && !ip; k++) { const c = sub.cidr.split('.').slice(0, 3).join('.') + '.' + k; if (usados.indexOf(c) < 0) ip = c; }
  const i = { id: idDe('i', 'worker-' + n), nombre: 'tienda-worker', tipo: datos.InstanceType, subred: sub.id, sgs: (datos.SecurityGroupIds || [ID.sg.default]).slice(), ipPriv: ip, ipPub: null, ami: datos.ImageId,
    clave: null, estado: yaCorriendo ? 'running' : 'pending', lanzada: min, iniciada: yaCorriendo ? min : min + 1, motivo: '', host: null, listoEn: yaCorriendo ? null : min + 1,
    perfil: datos.IamInstanceProfile ? datos.IamInstanceProfile.Name : null, asg: g.nombre, tags: [{ Key: 'aws:autoscaling:groupName', Value: g.nombre }] };
  a.instancias.push(i);
  return i;
}
N.workersVivos = st => st.aws.instancias.filter(i => i.asg === GRUPO && (i.estado === 'running' || i.estado === 'pending'));
const actividad = (st, desc, causa, ok, msg) => { st.aws.asg.actN++; st.aws.asg.actividades.unshift({ id: actId(st, desc), desc, causa, ok, msg: msg || '', min: st.reloj }); };
N.actividadAsg = actividad;
function datosLt(st, g) {
  const lt = N.lt(st, g.lt), v = g.version === '$Latest' ? lt.versiones[lt.versiones.length - 1] : g.version === '$Default' ? lt.versiones.find(x => x.n === lt.defecto) : lt.versiones.find(x => String(x.n) === String(g.version));
  return v ? v.datos : null;
}
N.datosLtAsg = datosLt;
// Cada minuto el grupo mira cuántas tiene y cuántas quiere.
P.ticks.push(st => {
  const a = st.aws; if (!a || !a.asg) return;
  const g = N.asg(st), vivos = N.workersVivos(st);
  if (vivos.length < g.deseado && st.reloj >= g.reintento) {
    const d = datosLt(st, g), ami = d && N.ami(st, d.ImageId);
    const causa = 'At ' + U.iso(st.reloj) + 'Z an instance was started in response to a difference between desired and actual capacity, increasing the capacity from ' + vivos.length + ' to ' + g.deseado + '.';
    if (!ami) { actividad(st, 'Launching a new EC2 instance.  Status Reason: The image id \'[' + (d ? d.ImageId : '?') + ']\' does not exist. Launching EC2 instance failed.', causa, false, 'The image id \'[' + (d ? d.ImageId : '?') + ']\' does not exist. Launching EC2 instance failed.'); g.reintento = st.reloj + 2; }
    else for (let k = vivos.length; k < g.deseado; k++) { const i = lanzarWorker(st, g, d, st.reloj); actividad(st, 'Launching a new EC2 instance: ' + i.id, causa, true); }
  } else if (vivos.length > g.deseado) {
    vivos.slice(g.deseado).forEach(i => { N.terminar(st, i); actividad(st, 'Terminating EC2 instance: ' + i.id, 'At ' + U.iso(st.reloj) + 'Z a user request explicitly set group desired capacity changing the desired capacity from ' + vivos.length + ' to ' + g.deseado + '.', true); });
  }
});

// ------------------------------------------------------------------ CLI
const grupoDe = (st, o) => { requiere(o, 'auto-scaling-group-name'); const g = st.aws.asg.grupos.find(x => x.nombre === uno(o, 'auto-scaling-group-name')); return g || falla('ValidationError', 'AutoScalingGroup name not found - AutoScalingGroup ' + uno(o, 'auto-scaling-group-name') + ' not found'); };
const grupoJ = (st, g) => { const lt = N.lt(st, g.lt); return { AutoScalingGroupName: g.nombre, AutoScalingGroupARN: 'arn:aws:autoscaling:eu-west-1:' + ID.cuenta + ':autoScalingGroup:' + U.uuid('asg' + g.nombre) + ':autoScalingGroupName/' + g.nombre,
  LaunchTemplate: { LaunchTemplateId: lt.id, LaunchTemplateName: lt.nombre, Version: g.version }, MinSize: g.min, MaxSize: g.max, DesiredCapacity: g.deseado, DefaultCooldown: 300,
  AvailabilityZones: g.subredes.map(s => N.subred(st, s).az), LoadBalancerNames: [], TargetGroupARNs: [], HealthCheckType: 'EC2', HealthCheckGracePeriod: 300,
  Instances: N.workersVivos(st).map(i => ({ InstanceId: i.id, InstanceType: i.tipo, AvailabilityZone: N.subred(st, i.subred).az, LifecycleState: i.estado === 'running' ? 'InService' : 'Pending', HealthStatus: 'Healthy', LaunchTemplate: { LaunchTemplateId: lt.id, LaunchTemplateName: lt.nombre, Version: String(lt.versiones.find(v => v.datos.ImageId === i.ami) ? lt.versiones.find(v => v.datos.ImageId === i.ami).n : 1) }, ProtectedFromScaleIn: false })),
  CreatedTime: iso(g.creado).replace('+00:00', '.000Z'), VPCZoneIdentifier: g.subredes.join(','), Tags: [{ Key: 'Name', Value: 'tienda-worker', PropagateAtLaunch: true, ResourceId: g.nombre, ResourceType: 'auto-scaling-group' }] }; };
OPS.autoscaling = {
  'describe-auto-scaling-groups': (st, o) => { const ns = o['auto-scaling-group-names'] || []; return { datos: { AutoScalingGroups: st.aws.asg.grupos.filter(g => !ns.length || ns.indexOf(g.nombre) >= 0).map(g => grupoJ(st, g)) }, resumen: d => d.AutoScalingGroups.map(g => ({ Name: g.AutoScalingGroupName, Min: g.MinSize, Desired: g.DesiredCapacity, Max: g.MaxSize, InService: g.Instances.filter(i => i.LifecycleState === 'InService').length })) }; },
  'describe-scaling-activities': (st, o) => { const g = grupoDe(st, o), n = +(uno(o, 'max-items') || 20); return { datos: { Activities: st.aws.asg.actividades.slice(0, n).map(x => Object.assign({ ActivityId: x.id, AutoScalingGroupName: g.nombre, Description: x.desc, Cause: x.causa, StartTime: iso(x.min).replace('+00:00', '.000Z'), EndTime: iso(x.min + (x.ok ? 1 : 0)).replace('+00:00', '.000Z'), StatusCode: x.ok ? 'Successful' : 'Failed' }, x.msg ? { StatusMessage: x.msg } : {}, { Progress: 100, Details: '{"Subnet ID":"' + g.subredes[0] + '","Availability Zone":"eu-west-1a"}', AutoScalingGroupARN: grupoJ(st, g).AutoScalingGroupARN })) } }; },
  'update-auto-scaling-group': (st, o) => {
    const g = grupoDe(st, o), min = uno(o, 'min-size'), max = uno(o, 'max-size'), des = uno(o, 'desired-capacity');
    const nmin = min != null ? +min : g.min, nmax = max != null ? +max : g.max, ndes = des != null ? +des : Math.min(Math.max(g.deseado, nmin), nmax);
    if (nmin > nmax || ndes < nmin || ndes > nmax) falla('ValidationError', 'Desired capacity:' + ndes + ' must be between the specified min size:' + nmin + ' and max size:' + nmax);
    const ltm = /LaunchTemplateId=([^,\s]+)(,Version=([^,\s]+))?/.exec((o['launch-template'] || []).join(' '));
    if (ltm) { if (!N.lt(st, ltm[1])) falla('ValidationError', 'The specified launch template, with template ID ' + ltm[1] + ', does not exist.'); g.lt = ltm[1]; g.version = ltm[3] || '$Default'; g.reintento = 0; }
    g.min = nmin; g.max = nmax; g.deseado = ndes;
    return { datos: undefined };
  },
  'set-desired-capacity': (st, o) => { const g = grupoDe(st, o); requiere(o, 'desired-capacity'); const d = +uno(o, 'desired-capacity'); if (d < g.min || d > g.max) falla('ValidationError', 'New SetDesiredCapacity value ' + d + ' is below min value ' + g.min + ' for the AutoScalingGroup.'); g.deseado = d; return { datos: undefined }; },
};
const ltDe = (st, o) => { const id = uno(o, 'launch-template-id') || uno(o, 'launch-template-name'); if (!id) throw new ErrorAws(null, 'aws: error: one of the arguments --launch-template-id --launch-template-name is required'); const lt = N.lt(st, id); return lt || falla('InvalidLaunchTemplateId.NotFound', 'The specified launch template, with template ID ' + id + ', does not exist.'); };
const verJ = (lt, v) => ({ LaunchTemplateId: lt.id, LaunchTemplateName: lt.nombre, VersionNumber: v.n, VersionDescription: v.desc, CreateTime: iso(v.creada).replace('+00:00', '.000Z'), CreatedBy: 'arn:aws:iam::' + ID.cuenta + ':user/sre-ops', DefaultVersion: v.n === lt.defecto, LaunchTemplateData: v.datos });
Object.assign(OPS.ec2, {
  'describe-launch-templates': (st, o) => { const ns = o['launch-template-names'] || []; return { datos: { LaunchTemplates: st.aws.asg.lts.filter(l => !ns.length || ns.indexOf(l.nombre) >= 0).map(l => ({ LaunchTemplateId: l.id, LaunchTemplateName: l.nombre, CreateTime: iso(l.creado).replace('+00:00', '.000Z'), CreatedBy: 'arn:aws:iam::' + ID.cuenta + ':user/sre-ops', DefaultVersionNumber: l.defecto, LatestVersionNumber: l.versiones.length })) } }; },
  'describe-launch-template-versions': (st, o) => { const lt = ltDe(st, o), vs = (o.versions || []).map(String); return { datos: { LaunchTemplateVersions: lt.versiones.slice().reverse().filter(v => !vs.length || vs.indexOf(String(v.n)) >= 0 || (vs.indexOf('$Default') >= 0 && v.n === lt.defecto) || (vs.indexOf('$Latest') >= 0 && v.n === lt.versiones.length)).map(v => verJ(lt, v)) } }; },
  'create-launch-template-version': (st, o) => {
    const lt = ltDe(st, o); requiere(o, 'launch-template-data');
    let datos; try { datos = JSON.parse((o['launch-template-data'] || []).join(' ')); } catch (e) { falla('InvalidLaunchTemplateData', 'The launch template data is not valid JSON'); }
    const base = uno(o, 'source-version') ? lt.versiones.find(v => String(v.n) === String(uno(o, 'source-version'))) : null;
    if (uno(o, 'source-version') && !base) falla('InvalidLaunchTemplateId.VersionNotFound', 'Could not find launch template version ' + uno(o, 'source-version') + ' for template ' + lt.id + '.');
    const v = { n: lt.versiones.length + 1, desc: (o['version-description'] || []).join(' '), creada: st.reloj, datos: Object.assign({}, base ? JSON.parse(JSON.stringify(base.datos)) : {}, datos) };
    lt.versiones.push(v);
    return { datos: { LaunchTemplateVersion: verJ(lt, v) } };
  },
  'modify-launch-template': (st, o) => {
    const lt = ltDe(st, o), d = uno(o, 'default-version');
    if (d) { if (!lt.versiones.some(v => String(v.n) === String(d))) falla('InvalidLaunchTemplateId.VersionNotFound', 'Could not find launch template version ' + d + '.'); lt.defecto = +d; st.aws.asg.grupos.filter(g => g.lt === lt.id).forEach(g => { g.reintento = 0; }); }
    return { datos: { LaunchTemplate: { LaunchTemplateId: lt.id, LaunchTemplateName: lt.nombre, DefaultVersionNumber: lt.defecto, LatestVersionNumber: lt.versiones.length } } };
  },
  'deregister-image': (st, o) => { requiere(o, 'image-id'); const k = st.aws.amis.findIndex(a => a.id === uno(o, 'image-id') && a.propia); if (k < 0) falla('InvalidAMIID.NotFound', "The image id '[" + uno(o, 'image-id') + "]' does not exist"); st.aws.amis.splice(k, 1); return { datos: undefined }; },
});
C.PREFIJO.autoscaling = 'autoscaling';
C.AYUDA.push('autoscaling');

// ------------------------------------------------------------------ alarmas
N.DEFS.push({ nombre: 'tienda-workers-inservice', ns: 'AWS/AutoScaling', metrica: 'GroupInServiceInstances', dim: [['AutoScalingGroupName', GRUPO]], umbral: 2, op: 'LessThanThreshold', host: null,
  desc: T('Hay menos workers de envíos de los necesarios', 'There are fewer shipping workers than needed'),
  eval: st => { const g = N.asg(st), n = st.aws.instancias.filter(i => i.asg === GRUPO && i.estado === 'running').length; return { estado: n < g.min ? 'ALARM' : 'OK', valor: n, sev: n ? 'warning' : 'critical', res: T('tienda-workers: ' + n + ' de ' + g.min + ' workers en servicio; los envíos se acumulan', 'tienda-workers: ' + n + ' of ' + g.min + ' workers in service; shipments are piling up') }; } });
})(window.PUESTO = window.PUESTO || {});
