// Puesto CPD · la sala: el CPD dibujado en racks, con su estado en vivo.
//
// La misma proyección isométrica que la sala de LabStack (../sala.js), pero
// pintando ESTE CPD: cada servidor es un equipo en su rack, con su
// distribución y un LED que sale de P.estadoHost; encima de cada rack flotan
// las aplicaciones de los clientes con lo que les responde la sonda (C.salud).
// Es una función pura del estado: se vuelve a pintar tras cada comando, así
// que nunca contradice a la terminal. Tocar un servidor abre una sesión en él
// (data-act="ssh", que ya entiende app.js).
(function (P) {
'use strict';
const U = P.u, T = P.T, C = P.cpd;
const CO = Math.cos(Math.PI / 6), S = 52, RACK_H = 2.6, UA = 0.17;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = n => Math.round(n * 10) / 10;
const DISTRO = { rocky: ['#10b981', 'Rocky 9'], debian: ['#d70a53', 'Debian 12'], ubuntu: ['#e95420', 'Ubuntu 22.04'], sles: ['#30ba78', 'SLES 15'] };
const ESTADO = { ok: '#22c55e', reserva: '#22c55e', aviso: '#f59e0b', fallo: '#ef4444', caido: '#475569' };
// Qué hay en cada rack, de arriba abajo, y qué aplicaciones flotan encima.
const RACKS = [
  { id: 'gestion', etq: T('Gestión', 'Management'), equipos: [{ tipo: 'switch', n: 'sw-core' }, { tipo: 'fw', n: 'fw-perimetro' }, { host: 'mgmt01' }], apps: [] },
  { id: 'web', etq: T('Web · clientes', 'Web · customers'), equipos: [{ host: 'web01' }, { host: 'web02' }, { host: 'web03' }], apps: ['tienda', 'portal', 'intranet'] },
  { id: 'datos', etq: T('Aplicaciones y datos', 'Applications and data'), equipos: [{ host: 'app01' }, { host: 'db01' }, { host: 'db02' }, { tipo: 'cabina', n: 'backup' }], apps: ['facturacion', 'informes', 'pedidos', 'backup'] },
];

C.salaSvg = st => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const ext = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const Pt = (x, y, z) => { const p = [(x - y) * CO * S, (x + y) * 0.5 * S - (z || 0) * S]; ext(p[0], p[1]); return p; };
  const pts = a => a.map(p => f(p[0]) + ',' + f(p[1])).join(' ');
  const poly = (a, at) => '<polygon points="' + pts(a) + '" ' + at + '/>';
  const caja = (x, y, z, w, d, h, cls) => poly([Pt(x + w, y, z), Pt(x + w, y + d, z), Pt(x + w, y + d, z + h), Pt(x + w, y, z + h)], 'class="' + cls + '-r"') + poly([Pt(x, y + d, z), Pt(x + w, y + d, z), Pt(x + w, y + d, z + h), Pt(x, y + d, z + h)], 'class="' + cls + '-f"') + poly([Pt(x, y, z + h), Pt(x + w, y, z + h), Pt(x + w, y + d, z + h), Pt(x, y + d, z + h)], 'class="' + cls + '-t"');
  const texto = (x, y, z, t, at) => { const p = Pt(x, y, z); return '<text transform="matrix(' + f(CO) + ',0.5,0,1,' + f(p[0]) + ',' + f(p[1]) + ')" ' + at + '>' + esc(t) + '</text>'; };
  const alertas = P.alertasActivas(st);
  let suelo = '', racks = '', cables = '', tags = '';
  const PASO = 3.7, xs = RACKS.map((r, i) => i * PASO);
  // Suelo técnico.
  suelo += caja(-0.7, -0.8, -0.14, xs[xs.length - 1] + 1.7, 3.2, 0.14, 'cs-suelo');
  let rej = '';
  for (let gx = 0; gx <= xs[xs.length - 1] + 1; gx++) rej += 'M' + pts([Pt(gx, -0.8, 0)]) + 'L' + pts([Pt(gx, 2.4, 0)]);
  for (let gy = 0; gy <= 2; gy++) rej += 'M' + pts([Pt(-0.7, gy, 0)]) + 'L' + pts([Pt(xs[xs.length - 1] + 1, gy, 0)]);
  suelo += '<path d="' + rej + '" class="cs-rejilla"/>';
  // Internet y el cable de entrada hasta el rack web, por la bandeja.
  const gI = Pt(-2.2, 0.6, 3.3);
  suelo += '<g class="cs-internet"><circle cx="' + f(gI[0]) + '" cy="' + f(gI[1]) + '" r="20" class="cs-globo"/><ellipse cx="' + f(gI[0]) + '" cy="' + f(gI[1]) + '" rx="8" ry="20" class="cs-meridiano"/><path d="M' + f(gI[0] - 20) + ' ' + f(gI[1]) + 'h40" class="cs-meridiano"/><text x="' + f(gI[0]) + '" y="' + f(gI[1] + 34) + '" text-anchor="middle" class="cs-etq">Internet</text></g>';
  const BAND = RACK_H + 0.3;
  cables += '<polyline points="' + pts([Pt(-2.2, 0.6, 3.3), Pt(-2.2, 0.5, BAND), Pt(xs[1] + 0.5, 0.5, BAND), Pt(xs[1] + 0.5, 0.5, RACK_H)]) + '" class="cs-cable cs-cable-ext"/>';
  cables += '<polyline points="' + pts([Pt(xs[0] + 0.5, 0.42, RACK_H), Pt(xs[0] + 0.5, 0.42, BAND), Pt(xs[2] + 0.5, 0.42, BAND), Pt(xs[2] + 0.5, 0.42, RACK_H)]) + '" class="cs-cable"/>';
  cables += '<polyline points="' + pts([Pt(xs[1] + 0.5, 0.58, BAND), Pt(xs[1] + 0.5, 0.58, RACK_H)]) + '" class="cs-cable"/>';
  RACKS.forEach((r, i) => {
    const xr = xs[i];
    let s = caja(xr, 0, 0, 1, 1, RACK_H, 'cs-rack');
    s += poly([Pt(xr + 0.05, 1.002, 0.1), Pt(xr + 0.95, 1.002, 0.1), Pt(xr + 0.95, 1.002, RACK_H - 0.08), Pt(xr + 0.05, 1.002, RACK_H - 0.08)], 'class="cs-hueco"');
    let z = RACK_H - 0.14;
    r.equipos.forEach(e => {
      const u = e.host ? 3 : e.tipo === 'cabina' ? 3 : 1, h = u * UA - 0.03, zb = z - h, x0e = xr + 0.07, x1e = xr + 0.93, yF = 1.03;
      const F = (a, b) => Pt(x0e + a * (x1e - x0e), yF, zb + b * h);
      const cuerpo = [F(0, 0), F(1, 0), F(1, 1), F(0, 1)];
      if (e.host) {
        const x = st.hosts[e.host], est = P.estadoHost(st, x), d = DISTRO[x.extra.distro], suyas = alertas.filter(a => a.host === e.host);
        let g = poly(cuerpo, 'class="cs-equipo' + (est === 'caido' ? ' cs-apagado' : '') + '"');
        g += poly([F(0, 0), F(0.035, 0), F(0.035, 1), F(0, 1)], 'style="fill:' + d[0] + '"');
        for (let k = 0; k < 4; k++) { const b = 0.08 + k * 0.06; g += poly([F(b, 0.15), F(b + 0.045, 0.15), F(b + 0.045, 0.85), F(b, 0.85)], 'class="cs-bahia"'); }
        g += texto(x0e + 0.36 * (x1e - x0e), yF, zb + h * 0.5 + 0.005, e.host, 'class="cs-nombre"');
        g += texto(x0e + 0.36 * (x1e - x0e), yF, zb + h * 0.18, x.up ? d[1] : T('reiniciando…', 'rebooting…'), 'class="cs-distro"');
        const led = F(0.93, 0.5);
        if (est === 'fallo' || est === 'aviso') g += '<circle cx="' + f(led[0]) + '" cy="' + f(led[1]) + '" r="7" class="cs-halo" style="fill:' + ESTADO[est] + '"/>';
        g += '<circle cx="' + f(led[0]) + '" cy="' + f(led[1]) + '" r="2.6" style="fill:' + ESTADO[est] + '"/>';
        const tit = e.host + ' · ' + C.distro(x).bonito + ' · ' + x.ip + (suyas.length ? ' · ' + suyas.map(a => a.nombre).join(', ') : '');
        s += '<g class="cs-host" data-act="ssh" data-host="' + e.host + '"><title>' + esc(tit + ' — ' + T('toca para abrir una sesión', 'tap to open a session')) + '</title>' + g + '</g>';
      } else {
        s += poly(cuerpo, 'class="cs-equipo cs-red"');
        if (e.tipo === 'cabina') {
          for (let k = 0; k < 10; k++) { const b = 0.04 + k * 0.066; s += poly([F(b, 0.12), F(b + 0.05, 0.12), F(b + 0.05, 0.88), F(b, 0.88)], 'class="cs-bahia"'); }
          const pc = U.pctDisco(st.hosts.db02, '/backup');
          s += texto(x0e + 0.72 * (x1e - x0e), yF, zb + h * 0.42, '/backup ' + pc + '%', 'class="cs-distro"');
        } else {
          for (let k = 0; k < (e.tipo === 'switch' ? 12 : 4); k++) { const b = 0.06 + k * (e.tipo === 'switch' ? 0.055 : 0.07); s += poly([F(b, 0.25), F(b + 0.04, 0.25), F(b + 0.04, 0.75), F(b, 0.75)], 'class="cs-puerto"'); }
          s += texto(x0e + 0.74 * (x1e - x0e), yF, zb + h * 0.3, e.tipo === 'switch' ? 'SW' : 'FW', 'class="cs-distro"');
        }
      }
      z -= u * UA;
    });
    s += poly([Pt(xr, 1.004, 0), Pt(xr + 1, 1.004, 0), Pt(xr + 1, 1.004, 0.06), Pt(xr, 1.004, 0.06)], 'class="cs-franja"');
    racks += s;
    const pe = Pt(xr + 0.5, 1.55, 0);
    suelo += '<text x="' + f(pe[0] - 10) + '" y="' + f(pe[1] + 12) + '" text-anchor="middle" class="cs-rotulo">' + esc(String(r.etq).toUpperCase()) + '</text>';
    // Las aplicaciones de los clientes, flotando sobre su rack, con lo que les responde la sonda.
    const top = Pt(xr + 0.5, 0.5, RACK_H + 0.5);
    r.apps.forEach((id, k) => {
      const a = C.apps.find(x => x.id === id), sa = C.salud(st, a), y = top[1] - 22 - k * 24, w = 158, etq = (a.cliente === 'CPD' ? '' : a.cliente.replace('Cliente ', '') + ' · ') + a.nombre;
      const col = sa.ok ? 'var(--ok)' : 'var(--bad)';
      tags += '<g class="cs-app' + (sa.ok ? '' : ' cs-app-mal') + '"' + (a.url ? ' data-act="escribir" data-cmd="' + esc('curl -I ' + a.url) + '"' : '') + '><title>' + esc(a.cliente + ' · ' + a.nombre + ' · ' + a.pila + (sa.msg ? ' · ' + sa.msg : '')) + '</title><rect x="' + f(top[0] - w / 2) + '" y="' + f(y - 9) + '" width="' + w + '" height="19" rx="9.5" class="cs-chip" style="stroke:' + col + '"/>' +
        '<circle cx="' + f(top[0] - w / 2 + 10) + '" cy="' + f(y + 0.5) + '" r="3.4" style="fill:' + col + '"/><text x="' + f(top[0] - w / 2 + 19) + '" y="' + f(y + 4) + '" class="cs-chip-txt">' + esc(etq.length > 22 ? etq.slice(0, 21) + '…' : etq) + '</text>' +
        '<text x="' + f(top[0] + w / 2 - 8) + '" y="' + f(y + 4) + '" text-anchor="end" class="cs-chip-cod" style="fill:' + col + '">' + esc(sa.corto) + '</text></g>';
      ext(top[0] - w / 2, y - 12); ext(top[0] + w / 2, y + 12);
    });
    if (r.apps.length) tags = '<line x1="' + f(top[0]) + '" y1="' + f(top[1] - 12) + '" x2="' + f(top[0]) + '" y2="' + f(Pt(xr + 0.5, 0.5, RACK_H)[1]) + '" class="cs-guia"/>' + tags;
  });
  const m = 26, vb = [f(x0 - m), f(y0 - m), f(x1 - x0 + 2 * m), f(y1 - y0 + 2 * m)].join(' ');
  return '<svg class="cs-sala" viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + suelo + cables + racks + tags + '</svg>';
};

// Estilos de la sala (claro y oscuro, con las variables de estilos.css).
if (typeof document !== 'undefined') {
  const css = document.createElement('style');
  css.textContent = [
    '.cs-sala{width:100%;height:100%;display:block;font-family:Inter,system-ui,sans-serif}',
    '.cs-sala text{pointer-events:none}',
    '.cs-suelo-t{fill:var(--panel-2)}.cs-suelo-f{fill:var(--border)}.cs-suelo-r{fill:var(--border-strong)}',
    '.cs-rejilla{fill:none;stroke:var(--border);stroke-width:1}',
    '.cs-rack-t{fill:#3b4658}.cs-rack-f{fill:#1f2937}.cs-rack-r{fill:#151c28}.cs-rack-t,.cs-rack-f,.cs-rack-r{stroke:rgba(0,0,0,.35);stroke-width:.6}',
    '.cs-hueco{fill:#0b1019}.cs-franja{fill:var(--accent);opacity:.8}',
    '.cs-equipo{fill:#2b3648;stroke:rgba(255,255,255,.2);stroke-width:.6}.cs-red{fill:#26324a}.cs-apagado{fill:#151b26;opacity:.7}',
    '.cs-bahia{fill:#0b1220;stroke:rgba(255,255,255,.22);stroke-width:.35}.cs-puerto{fill:#0b1220;stroke:rgba(56,189,248,.5);stroke-width:.4}',
    '.cs-nombre{font-family:"JetBrains Mono",monospace;font-size:8.5px;font-weight:700;fill:#f1f5f9}',
    '.cs-distro{font-family:"JetBrains Mono",monospace;font-size:6.5px;fill:#94a3b8}',
    '.cs-host{cursor:pointer}.cs-host:hover .cs-equipo{fill:#3a4a63}',
    '.cs-halo{opacity:.35;animation:csLatido 1.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}',
    '@keyframes csLatido{0%,100%{opacity:.15}50%{opacity:.55}}',
    '.cs-cable{fill:none;stroke:#3b82f6;stroke-width:1.8;stroke-linejoin:round;stroke-dasharray:8 4;animation:csFlujo 1.2s linear infinite}.cs-cable-ext{stroke:var(--accent);stroke-width:2.2}',
    '@keyframes csFlujo{to{stroke-dashoffset:-12}}',
    '.cs-globo{fill:var(--panel);stroke:var(--accent);stroke-width:2}.cs-meridiano{fill:none;stroke:var(--accent);stroke-width:1.1;opacity:.6}',
    '.cs-etq{font-size:11px;font-weight:700;fill:var(--muted)}',
    '.cs-rotulo{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;letter-spacing:.08em;fill:var(--muted);paint-order:stroke;stroke:var(--panel-2);stroke-width:3px}',
    '.cs-guia{stroke:var(--faint);stroke-width:1.2;stroke-dasharray:3 4}',
    '.cs-chip{fill:var(--panel);stroke-width:1.4}.cs-app{cursor:pointer}.cs-app:hover .cs-chip{fill:var(--panel-2)}',
    '.cs-app-mal .cs-chip{fill:var(--bad-tint)}',
    '.cs-chip-txt{font-size:9.5px;font-weight:600;fill:var(--text)}.cs-chip-cod{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700}',
    '@media (prefers-reduced-motion: reduce){.cs-halo,.cs-cable{animation:none}}',
    '.cs-panel{display:block;width:100%;aspect-ratio:4/3;border:0;padding:0;background:none;cursor:zoom-in}',
    '.cs-velo{position:fixed;inset:0;z-index:40;background:rgba(2,6,23,.55);display:flex;align-items:center;justify-content:center;padding:28px}',
    '.cs-caja{position:relative;width:min(1100px,100%);height:min(760px,100%);background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden}',
    '.cs-cab{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)}.cs-cab b{font-size:15px}.cs-cab span{color:var(--muted);font-size:12px}',
    '.cs-cab button{margin-left:auto;border:1px solid var(--border);background:var(--panel-2);border-radius:99px;padding:5px 12px}',
    '.cs-cuerpo{flex:1;min-height:0;padding:10px}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);
}
})(window.PUESTO = window.PUESTO || {});
