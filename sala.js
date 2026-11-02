// La sala: el stack dibujado como un datacenter en perspectiva isométrica.
//
// Dos mitades:
//  · escena(datos) es pura (sin DOM): recibe las piezas colocadas y devuelve
//    el SVG como texto, las paradas del recorrido y sus tramos. Corre en Node,
//    que es donde la prueban sala-test.js y smoke.js.
//  · sync(el, escena, estado) es el único que toca el DOM: inyecta el SVG una
//    vez y, después, sólo cambia clases, mueve el paquete y la cámara.
//
// Lo que la vista enseña, y por eso está dibujada así:
//  · lo físico está en el suelo (racks con sus equipos por delante) y lo
//    lógico flota encima, en placas apiladas: el hipervisor, el SO, los
//    contenedores y Kubernetes «corren sobre» los servidores, no al lado;
//  · los cables van por una bandeja aérea y cada tipo tiene su color: la red
//    de servicio, la de almacenamiento, el túnel a la nube;
//  · la operación (monitorización, CI/CD, IaC…) es un puesto aparte que actúa
//    sobre todo lo demás, no una capa más de la pila.
//
// Proyección: x avanza hacia abajo a la derecha, y hacia abajo a la izquierda,
// z hacia arriba. Las caras visibles de una caja son la superior, la +y (la
// frontal de los racks: ahí van los equipos) y la +x.
(function () {
  var C = Math.cos(Math.PI / 6), U = 56;
  var RACK_H = 2.4, U_ALTO = 0.17, BANDEJA = 2.78, PLACA0 = 3.55, PLACA_PASO = 0.9;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f(n) { return Math.round(n * 10) / 10; }

  // Qué equipo físico dibuja cada pieza: cuántas U ocupa y con qué frontal.
  var EQUIPO = {
    router: ['router', 1], switch: ['switch', 1], lb: ['appliance', 1], dns: ['appliance', 1], kong: ['appliance', 1], vlan: ['patch', 1],
    firewall: ['firewall', 1], vpn: ['appliance', 1],
    baremetal: ['server', 2], rack: ['server', 1, 3], hcinode: ['hci', 2, 2],
    san: ['shelf', 3], nas: ['nas', 2], raid: ['shelf', 2], objstore: ['nas', 2],
    backup: ['tape', 3], veeam: ['server', 2], velero: ['appliance', 1], snapshot: ['appliance', 1], replication: ['appliance', 1]
  };
  // Capas lógicas que flotan sobre los servidores, de abajo arriba.
  var PLACAS = ['virtualizacion', 'hci', 'so', 'contenedores', 'mensajeria', 'orquestacion'];
  // Lo que sí es hardware dentro de una categoría lógica.
  var FISICO_EN = { hci: { hcinode: 1 } };
  var OPS = ['monitorizacion', 'cicd', 'iac', 'seguridad', 'gobernanza'];
  var PERIMETRO = { firewall: 1, vpn: 1 };
  // Orden del recorrido de una petición (sólo las capas que tienen texto de flujo).
  var RECORRIDO = ['red', 'computo', 'virtualizacion', 'hci', 'so', 'contenedores', 'orquestacion', 'datos', 'almacenamiento', 'nube'];

  function escena(d) {
    var piezas = d.piezas || [], cats = d.cats || {}, T = d.textos || {};
    var por = {}; piezas.forEach(function (p) { (por[p.cat] = por[p.cat] || []).push(p); });
    var color = function (cat) { return (cats[cat] && cats[cat].color) || '#64748b'; };
    var nombre = function (cat) { return (cats[cat] && cats[cat].name) || cat; };

    // ---------- límites y proyección ----------
    var bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    function ext(x, y) { if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x > bx1) bx1 = x; if (y > by1) by1 = y; }
    function P(x, y, z) { var p = [(x - y) * C * U, (x + y) * 0.5 * U - (z || 0) * U]; ext(p[0], p[1]); return p; }
    function pts(a) { return a.map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' '); }
    function poly(a, attrs) { return '<polygon points="' + pts(a) + '" ' + attrs + '/>'; }
    function linea(a, attrs) { return '<polyline points="' + pts(a) + '" fill="none" ' + attrs + '/>'; }
    // Caja: [cara +x, cara +y, tapa], en ese orden para que la tapa quede encima.
    function caja(x, y, z, w, dd, h, cls, extra) {
      extra = extra || '';
      return poly([P(x + w, y, z), P(x + w, y + dd, z), P(x + w, y + dd, z + h), P(x + w, y, z + h)], 'class="' + cls + '-r" ' + extra) +
        poly([P(x, y + dd, z), P(x + w, y + dd, z), P(x + w, y + dd, z + h), P(x, y + dd, z + h)], 'class="' + cls + '-f" ' + extra) +
        poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + dd, z + h), P(x, y + dd, z + h)], 'class="' + cls + '-t" ' + extra);
    }
    // Texto pegado a un plano: frontal (+y, eje x y z) o suelo (ejes x e y).
    function textoFrente(x, y, z, txt, attrs) { var p = P(x, y, z); return '<text transform="matrix(' + f(C) + ',0.5,0,1,' + f(p[0]) + ',' + f(p[1]) + ')" ' + attrs + '>' + esc(txt) + '</text>'; }
    function textoSuelo(x, y, z, txt, attrs) { var p = P(x, y, z); return '<text transform="matrix(' + f(C) + ',0.5,' + f(-C) + ',0.5,' + f(p[0]) + ',' + f(p[1]) + ')" ' + attrs + '>' + esc(txt) + '</text>'; }
    function titulo(p) { return '<title>' + esc(p.name + ' · ' + nombre(p.cat)) + '</title>'; }

    // ---------- reparto en racks ----------
    // Una fila de racks a lo largo de x. Cada grupo llena racks de 12 U.
    function enRacks(lista, cap) {
      var racks = [], act = null;
      lista.forEach(function (it) {
        if (!act || act.usado + it.u > cap) { act = { items: [], usado: 0 }; racks.push(act); }
        act.items.push(it); act.usado += it.u;
      });
      return racks;
    }
    function equipos(lista) {
      var out = [];
      lista.forEach(function (p) {
        var e = EQUIPO[p.id] || ['appliance', 1], n = e[2] || 1;
        for (var i = 0; i < n; i++) out.push({ p: p, tipo: e[0], u: e[1], copia: i });
      });
      return out;
    }
    var red = (por.red || []).slice(), perimetro = (por.seguridad || []).filter(function (p) { return PERIMETRO[p.id]; });
    // De arriba abajo, en el orden en que los cruza una petición.
    var ordenRed = ['router', 'vpn', 'firewall', 'dns', 'lb', 'kong', 'switch', 'vlan'];
    var redRack = red.concat(perimetro).sort(function (a, b) { return ordenRed.indexOf(a.id) - ordenRed.indexOf(b.id); });
    var computo = (por.computo || []).concat((por.hci || []).filter(function (p) { return FISICO_EN.hci[p.id]; }));
    var grupos = [
      { id: 'red', cat: 'red', racks: enRacks(equipos(redRack), 11), etiqueta: T.red },
      { id: 'computo', cat: 'computo', racks: enRacks(equipos(computo), 11), etiqueta: T.computo, fantasma: !computo.length },
      { id: 'almacenamiento', cat: 'almacenamiento', racks: enRacks(equipos(por.almacenamiento || []), 11), etiqueta: T.almacenamiento },
      { id: 'backup', cat: 'backup', racks: enRacks(equipos(por.backup || []), 11), etiqueta: T.backup }
    ].filter(function (g) { return g.racks.length || g.fantasma; });
    // Placas lógicas: sólo las que tienen alguna pieza que no sea hardware.
    var placas = PLACAS.map(function (cat) {
      var ls = (por[cat] || []).filter(function (p) { return !(FISICO_EN[cat] && FISICO_EN[cat][p.id]); });
      return ls.length ? { cat: cat, piezas: ls } : null;
    }).filter(Boolean);
    if (!placas.length) grupos = grupos.filter(function (g) { return !g.fantasma; });
    var gc = grupos.filter(function (g) { return g.id === 'computo'; })[0];
    if (gc && gc.fantasma) gc.racks = [{ items: [], usado: 0, fantasma: true }];

    // Posiciones: x de cada rack, con un hueco mayor entre grupos.
    var x = 0, pos = {};
    grupos.forEach(function (g, gi) {
      if (gi) x += (placas.length && (g.id === 'computo' || grupos[gi - 1].id === 'computo')) ? 0.95 : 0.55;
      g.x0 = x; g.rx = [];
      g.racks.forEach(function () { g.rx.push(x); x += 1.18; });
      g.x1 = x - 0.18; pos[g.id] = g;
    });
    var largo = Math.max(x - 0.18, 3);

    var capas = { suelo: '', fondo: '', racks: '', bandeja: '', pilares: '', placas: '', puesto: '', tramos: '', paquete: '' };
    var marcas = {}; // cat → caja en pantalla (para la cámara)
    function marca(cat, ptsList) {
      var m = marcas[cat] || (marcas[cat] = [1e9, 1e9, -1e9, -1e9]);
      ptsList.forEach(function (p) { if (p[0] < m[0]) m[0] = p[0]; if (p[1] < m[1]) m[1] = p[1]; if (p[0] > m[2]) m[2] = p[0]; if (p[1] > m[3]) m[3] = p[1]; });
    }

    // ---------- suelo técnico ----------
    var sx0 = -0.7, sx1 = largo + 0.7, sy0 = -0.9, sy1 = 4.6;
    capas.suelo += caja(sx0, sy0, -0.16, sx1 - sx0, sy1 - sy0, 0.16, 'iso-suelo');
    var rej = '';
    for (var gx = Math.ceil(sx0); gx <= sx1; gx++) rej += 'M' + pts([P(gx, sy0, 0)]) + 'L' + pts([P(gx, sy1, 0)]);
    for (var gy = Math.ceil(sy0); gy <= sy1; gy++) rej += 'M' + pts([P(sx0, gy, 0)]) + 'L' + pts([P(sx1, gy, 0)]);
    capas.suelo += '<path d="' + rej + '" class="iso-rejilla"/>';

    // ---------- racks ----------
    var LED = ['#22c55e', '#22c55e', '#22c55e', '#f59e0b'];
    function frontal(xr, it, zTop, col) {
      var h = it.u * U_ALTO - 0.025, z0 = zTop - h, yF = 1.03, x0 = xr + 0.07, x1 = xr + 0.93, s = '';
      var F = function (u, v) { return P(x0 + u * (x1 - x0), yF, z0 + v * h); };
      var cuerpo = [F(0, 0), F(1, 0), F(1, 1), F(0, 1)];
      s += poly(cuerpo, 'class="iso-equipo" style="fill:' + col + '"');
      s += poly(cuerpo, 'class="iso-equipo-luz"');
      var t = it.tipo, i;
      if (t === 'switch' || t === 'patch') {
        var filas = it.u > 1 ? 2 : 2, n = 12;
        for (var r = 0; r < filas; r++) for (i = 0; i < n; i++) {
          var u0 = 0.06 + i * 0.062, v0 = 0.18 + r * 0.38;
          s += poly([F(u0, v0), F(u0 + 0.045, v0), F(u0 + 0.045, v0 + 0.26), F(u0, v0 + 0.26)], 'class="iso-puerto"');
        }
      } else if (t === 'router' || t === 'appliance' || t === 'firewall') {
        for (i = 0; i < 4; i++) { var a = 0.07 + i * 0.075; s += poly([F(a, 0.28), F(a + 0.055, 0.28), F(a + 0.055, 0.72), F(a, 0.72)], 'class="iso-puerto"'); }
        if (t === 'firewall') for (i = 0; i < 3; i++) s += linea([F(0.42 + i * 0.08, 0.15), F(0.42 + i * 0.08, 0.85)], 'class="iso-rejilla-eq"');
      } else if (t === 'server' || t === 'hci') {
        var bahias = t === 'hci' ? 6 : 4;
        for (i = 0; i < bahias; i++) { var b = 0.05 + i * 0.07; s += poly([F(b, 0.14), F(b + 0.055, 0.14), F(b + 0.055, 0.86), F(b, 0.86)], 'class="iso-bahia"'); }
        for (i = 0; i < 5; i++) s += linea([F(0.5 + i * 0.05, 0.2), F(0.5 + i * 0.05, 0.8)], 'class="iso-rejilla-eq"');
      } else if (t === 'shelf' || t === 'nas') {
        var cols = t === 'shelf' ? 12 : 8;
        for (i = 0; i < cols; i++) { var c = 0.04 + i * (0.66 / cols); s += poly([F(c, 0.1), F(c + 0.66 / cols - 0.012, 0.1), F(c + 0.66 / cols - 0.012, 0.9), F(c, 0.9)], 'class="iso-bahia"'); }
      } else if (t === 'tape') {
        s += poly([F(0.06, 0.25), F(0.6, 0.25), F(0.6, 0.75), F(0.06, 0.75)], 'class="iso-ventana"');
        for (i = 0; i < 6; i++) s += linea([F(0.1 + i * 0.08, 0.32), F(0.1 + i * 0.08, 0.68)], 'class="iso-cinta"');
      }
      // LED de estado y código de la pieza.
      var led = F(0.95, 0.5);
      s += '<circle cx="' + f(led[0]) + '" cy="' + f(led[1]) + '" r="1.7" fill="' + LED[(it.p.id.length + it.copia) % 4] + '" class="iso-led"/>';
      if (it.copia === 0) s += textoFrente(x0 + 0.72 * (x1 - x0), yF, z0 + h * 0.5 - 0.035, it.p.code, 'class="iso-cod"');
      return '<g data-pieza="' + esc(it.p.id) + '" data-cat="' + esc(it.p.cat) + '" class="iso-pieza">' + titulo(it.p) + s + '</g>';
    }
    grupos.forEach(function (g) {
      var col = color(g.cat);
      g.racks.forEach(function (rk, ri) {
        var xr = g.rx[ri], s = '';
        if (rk.fantasma) {
          s += poly([P(xr, 0, 0), P(xr + 1, 0, 0), P(xr + 1, 1, 0), P(xr, 1, 0)], 'class="iso-fantasma"');
          s += textoSuelo(xr + 0.12, 0.62, 0.01, T.sinServidores || '?', 'class="iso-fantasma-txt"');
          marca(g.cat, [P(xr, 0, 0), P(xr + 1, 1, 0), P(xr, 0, RACK_H)]);
          capas.racks += '<g data-cat="' + g.cat + '" class="iso-grupo">' + s + '</g>';
          return;
        }
        s += caja(xr, 0, 0, 1, 1, RACK_H, 'iso-rack');
        // Hueco interior del rack y raíles.
        s += poly([P(xr + 0.05, 1.002, 0.1), P(xr + 0.95, 1.002, 0.1), P(xr + 0.95, 1.002, RACK_H - 0.08), P(xr + 0.05, 1.002, RACK_H - 0.08)], 'class="iso-hueco"');
        var z = RACK_H - 0.14;
        rk.items.forEach(function (it) { s += frontal(xr, it, z, col); z -= it.u * U_ALTO; });
        // Patas y franja de color de la categoría en la base.
        s += poly([P(xr, 1.004, 0), P(xr + 1, 1.004, 0), P(xr + 1, 1.004, 0.07), P(xr, 1.004, 0.07)], 'style="fill:' + col + '" class="iso-franja"');
        marca(g.cat, [P(xr, 0, RACK_H), P(xr + 1, 1, 0), P(xr + 1, 0, RACK_H), P(xr, 1, 0)]);
        capas.racks += '<g data-cat="' + g.cat + '" class="iso-grupo">' + s + '</g>';
      });
      var pr = P((g.x0 + g.x1) / 2, 1.5, 0);
      capas.suelo += '<text x="' + f(pr[0] - 12) + '" y="' + f(pr[1] + 12) + '" text-anchor="middle" class="iso-rotulo" style="fill:' + col + '">' + esc(String(g.etiqueta || nombre(g.cat)).toUpperCase()) + '</text>';
    });

    // ---------- bandeja de cables ----------
    var tramosRed = [], cables = '';
    if (grupos.length > 1) {
      var bx = grupos[0].rx[0] + 0.5, ex = grupos[grupos.length - 1].rx[grupos[grupos.length - 1].rx.length - 1] + 0.5;
      capas.bandeja += caja(bx - 0.2, 0.28, BANDEJA - 0.04, ex - bx + 0.4, 0.44, 0.04, 'iso-bandeja');
      // Red de servicio: del rack de red a cada servidor. Almacenamiento: de los
      // servidores a cabinas y backup, por su propia red (y su propio color).
      var gR = pos.red, gC = pos.computo, gA = pos.almacenamiento, gB = pos.backup;
      function bajadas(xs, yy, cls) { xs.forEach(function (xx) { cables += linea([P(xx + 0.5, yy, RACK_H), P(xx + 0.5, yy, BANDEJA)], cls); }); }
      if (gR && gC && !gC.fantasma) {
        var xs = gR.rx.concat(gC.rx);
        cables += linea([P(xs[0] + 0.5, 0.42, BANDEJA), P(xs[xs.length - 1] + 0.5, 0.42, BANDEJA)], 'class="iso-cable iso-cable-red"');
        bajadas(xs, 0.42, 'class="iso-cable iso-cable-red"');
      }
      var dest = [].concat(gA ? gA.rx : [], gB ? gB.rx : []);
      if (gC && !gC.fantasma && dest.length) {
        var xs2 = gC.rx.concat(dest);
        cables += linea([P(xs2[0] + 0.5, 0.58, BANDEJA), P(xs2[xs2.length - 1] + 0.5, 0.58, BANDEJA)], 'class="iso-cable iso-cable-alm"');
        bajadas(xs2, 0.58, 'class="iso-cable iso-cable-alm"');
      }
      capas.bandeja += cables;
    }

    // ---------- internet y nube ----------
    var gRed = pos.red || grupos[0];
    var xEntrada = gRed ? gRed.rx[0] + 0.5 : 0;
    var Z_AC = RACK_H + 0.3, internet = [xEntrada - 4.7, 1.0, Z_AC];
    var pI = P(internet[0], internet[1], internet[2]);
    capas.fondo += '<g class="iso-internet">' +
      '<circle cx="' + f(pI[0]) + '" cy="' + f(pI[1]) + '" r="24" class="iso-globo"/>' +
      '<ellipse cx="' + f(pI[0]) + '" cy="' + f(pI[1]) + '" rx="10" ry="24" class="iso-meridiano"/>' +
      '<path d="M' + f(pI[0] - 24) + ' ' + f(pI[1]) + 'h48M' + f(pI[0] - 20) + ' ' + f(pI[1] - 11) + 'h40M' + f(pI[0] - 20) + ' ' + f(pI[1] + 11) + 'h40" class="iso-meridiano"/>' +
      '<text x="' + f(pI[0]) + '" y="' + f(pI[1] + 40) + '" class="iso-etq" text-anchor="middle">' + esc(T.internet || 'Internet') + '</text></g>';
    ext(pI[0] - 30, pI[1] - 30); ext(pI[0] + 60, pI[1] + 46);
    marca('entrada', [[pI[0] - 30, pI[1] - 30], [pI[0] + 30, pI[1] + 46]]);
    // Acometida: del globo baja al techo del rack de red.
    var acometida = [internet, [internet[0], 0.5, Z_AC], [xEntrada, 0.5, Z_AC], [xEntrada, 0.5, RACK_H]];
    if (gRed) capas.fondo += linea(acometida.map(function (q) { return P(q[0], q[1], q[2]); }), 'class="iso-cable iso-cable-ext"');

    var nube = null;
    if (por.nube && por.nube.length) {
      nube = [largo + 1.1, -2.2, 5.0];
      var pN = P(nube[0], nube[1], nube[2]), cx = pN[0], cy = pN[1];
      var chips = por.nube.map(function (p, i) {
        var w = 46, xx = cx - (por.nube.length * (w + 6) - 6) / 2 + i * (w + 6);
        return '<g data-pieza="' + esc(p.id) + '" data-cat="nube" class="iso-pieza">' + titulo(p) + '<rect x="' + f(xx) + '" y="' + f(cy + 8) + '" width="' + w + '" height="18" rx="6" class="iso-chip" style="stroke:' + color('nube') + '"/>' +
          '<text x="' + f(xx + w / 2) + '" y="' + f(cy + 21) + '" text-anchor="middle" class="iso-chip-txt">' + esc(p.code) + '</text></g>';
      }).join('');
      var ancho = Math.max(170, por.nube.length * 52 + 40);
      capas.fondo += '<g data-cat="nube" class="iso-grupo"><path d="M' + f(cx - ancho / 2) + ' ' + f(cy + 30) +
        'q-26 0 -26 -24q0 -24 30 -24q8 -30 44 -26q20 -24 54 -10q36 -8 46 22q' + f(ancho / 2 - 70) + ' 0 ' + f(ancho / 2 - 60) + ' 24' +
        'q4 38 -30 38z" class="iso-nube" style="stroke:' + color('nube') + '"/>' +
        '<text x="' + f(cx) + '" y="' + f(cy - 12) + '" text-anchor="middle" class="iso-etq">' + esc(nombre('nube')) + '</text>' + chips + '</g>';
      ext(cx - ancho / 2 - 30, cy - 64); ext(cx + ancho / 2 + 10, cy + 40);
      marca('nube', [[cx - ancho / 2 - 26, cy - 60], [cx + ancho / 2 + 8, cy + 40]]);
      // Túnel cifrado desde el rack de red, por encima de todo.
      if (gRed) capas.bandeja += linea([P(xEntrada, 0.5, BANDEJA + 0.5), P(xEntrada, -2.2, BANDEJA + 0.5), P(nube[0], -2.2, BANDEJA + 0.5), P(nube[0], -2.2, nube[2] - 0.5)], 'class="iso-cable iso-cable-nube"');
    }

    // ---------- placas lógicas sobre los servidores ----------
    var zPlaca = {};
    var datosPlaca = null;
    if (gc && placas.length) {
      var pmid = (gc.x0 + gc.x1) / 2, pw = Math.max(gc.x1 - gc.x0 + 0.3, 2.5), px0 = pmid - pw / 2, px1 = pmid + pw / 2;
      // «Corre sobre»: pilares discontinuos de las esquinas, del rack a la última placa.
      var ztop = PLACA0 + (placas.length - 1) * PLACA_PASO;
      [[px0, 1.15], [px1, 1.15], [px1, -0.15]].forEach(function (q) {
        capas.pilares += linea([P(q[0], q[1], RACK_H), P(q[0], q[1], ztop)], 'class="iso-pilar"');
      });
      placas.forEach(function (pl, i) {
        var z = PLACA0 + i * PLACA_PASO, col = color(pl.cat), s = '';
        zPlaca[pl.cat] = z;
        s += caja(px0, -0.15, z, px1 - px0, 1.3, 0.07, 'iso-placa', 'style="--c:' + col + '"');
        // Una pieza = un cubo sobre la placa.
        var n = pl.piezas.length, paso = Math.min(0.62, (px1 - px0 - 0.3) / n);
        pl.piezas.forEach(function (p, k) {
          var cx = px0 + 0.2 + k * paso, w = Math.min(0.42, paso - 0.12);
          s += '<g data-pieza="' + esc(p.id) + '" data-cat="' + esc(pl.cat) + '" class="iso-pieza">' + titulo(p) +
            caja(cx, 0.3, z + 0.07, w, 0.42, 0.24, 'iso-cubo', 'style="--c:' + col + '"') +
            textoFrente(cx + 0.04, 0.72, z + 0.07 + 0.08, p.code, 'class="iso-cod iso-cod-cubo"') + '</g>';
        });
        // Rótulo de la placa a su izquierda, en plano: se lee sin girar la cabeza.
        var pl0 = P(px0, 1.15, z);
        s += '<text x="' + f(pl0[0] - 10) + '" y="' + f(pl0[1] + 4) + '" text-anchor="end" class="iso-etq-placa" style="fill:' + col + '">' + esc(nombre(pl.cat)) + '</text>';
        ext(pl0[0] - 10 - nombre(pl.cat).length * 6.6, pl0[1] - 10);
        marca(pl.cat, [P(px0, -0.15, z + 0.4), P(px1, 1.15, z), P(px0, 1.15, z), P(px1, -0.15, z + 0.4)]);
        capas.placas += '<g data-cat="' + pl.cat + '" class="iso-grupo">' + s + '</g>';
      });
    }
    // Bases de datos: sobre el almacenamiento, porque es ahí donde escriben.
    if (por.datos && por.datos.length) {
      var gDA = pos.almacenamiento || pos.computo || grupos[grupos.length - 1];
      var dx0 = gDA ? gDA.x0 - 0.15 : 0, dx1 = gDA ? gDA.x1 + 0.15 : 1.5;
      if (dx1 - dx0 < por.datos.length * 0.55 + 0.3) dx1 = dx0 + por.datos.length * 0.55 + 0.3;
      var zd = PLACA0, cold = color('datos'), s2 = '';
      s2 += caja(dx0, -0.15, zd, dx1 - dx0, 1.3, 0.07, 'iso-placa', 'style="--c:' + cold + '"');
      [[dx0, 1.15], [dx1, 1.15]].forEach(function (q) { capas.pilares += linea([P(q[0], q[1], RACK_H), P(q[0], q[1], zd)], 'class="iso-pilar"'); });
      var paso2 = (dx1 - dx0 - 0.2) / por.datos.length;
      por.datos.forEach(function (p, k) {
        var cxx = dx0 + 0.1 + paso2 * (k + 0.5), cyy = 0.5, r = Math.min(0.2, paso2 / 2 - 0.04), hh = 0.42;
        var b = P(cxx, cyy, zd + 0.07), tp = P(cxx, cyy, zd + 0.07 + hh), rx = r * C * U * Math.SQRT2, ry = r * 0.5 * U * Math.SQRT2;
        s2 += '<g data-pieza="' + esc(p.id) + '" data-cat="datos" class="iso-pieza">' + titulo(p) +
          '<path d="M' + f(b[0] - rx) + ' ' + f(tp[1]) + 'V' + f(b[1]) + 'A' + f(rx) + ' ' + f(ry) + ' 0 0 0 ' + f(b[0] + rx) + ' ' + f(b[1]) + 'V' + f(tp[1]) + 'Z" class="iso-cil" style="--c:' + cold + '"/>' +
          '<ellipse cx="' + f(tp[0]) + '" cy="' + f(tp[1]) + '" rx="' + f(rx) + '" ry="' + f(ry) + '" class="iso-cil-tapa" style="--c:' + cold + '"/>' +
          '<path d="M' + f(b[0] - rx) + ' ' + f((b[1] + tp[1]) / 2) + 'A' + f(rx) + ' ' + f(ry) + ' 0 0 0 ' + f(b[0] + rx) + ' ' + f((b[1] + tp[1]) / 2) + '" class="iso-cil-aro"/>' +
          '<text x="' + f(b[0]) + '" y="' + f(b[1] + ry + 12) + '" text-anchor="middle" class="iso-chip-txt">' + esc(p.code) + '</text></g>';
      });
      var dl = P(dx1, -0.15, zd);
      s2 += '<text x="' + f(dl[0] + 10) + '" y="' + f(dl[1] + 4) + '" class="iso-etq-placa" style="fill:' + cold + '">' + esc(nombre('datos')) + '</text>';
      ext(dl[0] + 10 + nombre('datos').length * 6.6, dl[1]);
      marca('datos', [P(dx0, -0.15, zd + 0.6), P(dx1, 1.15, zd), P(dx0, 1.15, zd), P(dx1, -0.15, zd + 0.6)]);
      capas.placas += '<g data-cat="datos" class="iso-grupo">' + s2 + '</g>';
      datosPlaca = { x: (dx0 + dx1) / 2, z: zd };
    }

    // ---------- puesto de operación ----------
    var ops = [];
    OPS.forEach(function (cat) { (por[cat] || []).forEach(function (p) { if (!(cat === 'seguridad' && PERIMETRO[p.id])) ops.push(p); }); });
    if (ops.length) {
      var ox = 0.1, oy = 3.0, ow = Math.max(2.4, Math.min(largo - 0.2, 0.5 + ops.length * 0.42)), s3 = '';
      s3 += caja(ox, oy, 0, ow, 0.8, 0.5, 'iso-mesa');
      ops.forEach(function (p, k) {
        var mx = ox + 0.15 + k * ((ow - 0.3) / ops.length), mw = Math.min(0.34, (ow - 0.3) / ops.length - 0.06), col = color(p.cat);
        var g = '';
        if (p.cat === 'monitorizacion') {
          // Una pantalla con su gráfica: lo que mira quien opera.
          g += caja(mx, oy + 0.12, 0.5, mw, 0.05, 0.36, 'iso-monitor');
          var sF = function (u, v) { return P(mx + 0.03 + u * (mw - 0.06), oy + 0.171, 0.54 + v * 0.28); };
          g += poly([sF(0, 0), sF(1, 0), sF(1, 1), sF(0, 1)], 'class="iso-pantalla"');
          g += linea([sF(0.05, 0.3), sF(0.25, 0.55), sF(0.45, 0.4), sF(0.65, 0.75), sF(0.95, 0.6)], 'class="iso-grafica" style="stroke:' + col + '"');
        } else {
          g += caja(mx, oy + 0.3, 0.5, mw, 0.3, 0.2, 'iso-cubo', 'style="--c:' + col + '"');
        }
        g += textoFrente(mx + 0.02, oy + 0.8, 0.14, p.code, 'class="iso-cod iso-cod-mesa" style="fill:' + col + '"');
        s3 += '<g data-pieza="' + esc(p.id) + '" data-cat="' + esc(p.cat) + '" class="iso-pieza">' + titulo(p) + g + '</g>';
      });
      capas.puesto += '<g class="iso-grupo iso-ops">' + s3 + '</g>';
      var po = P(ox + ow / 2, oy + 0.95, 0);
      capas.suelo += '<text x="' + f(po[0] - 12) + '" y="' + f(po[1] + 14) + '" text-anchor="middle" class="iso-rotulo iso-rotulo-ops">' + esc(String(T.operacion || 'Operación').toUpperCase()) + '</text>';
      // «Opera sobre»: punteado del puesto a la fila de racks.
      capas.puesto = linea([P(ox + ow / 2, oy, 0.5), P(ox + ow / 2, 1.4, 0.5), P(ox + ow / 2, 1.4, RACK_H)], 'class="iso-cable iso-cable-ops"') + capas.puesto;
    }

    // ---------- recorrido de la petición ----------
    var presentes = RECORRIDO.filter(function (cat) { return (por[cat] || []).length; });
    var ancla = {};
    var xServ = gc && !gc.fantasma ? gc.rx[0] + 0.5 : (gc ? gc.x0 + 0.5 : xEntrada);
    if (pos.red) ancla.red = [pos.red.rx[0] + 0.5, 0.5, RACK_H];
    if (gc) ancla.computo = [xServ, 0.5, RACK_H];
    Object.keys(zPlaca).forEach(function (cat) { ancla[cat] = [xServ, 0.5, zPlaca[cat] + 0.07]; });
    if (datosPlaca) ancla.datos = [datosPlaca.x, 0.5, datosPlaca.z + 0.07];
    if (pos.almacenamiento) ancla.almacenamiento = [pos.almacenamiento.rx[0] + 0.5, 0.5, RACK_H];
    if (nube) ancla.nube = nube;
    // hci sin placa (sólo nodos físicos): su parada es la de los servidores.
    if (!ancla.hci && (por.hci || []).length && ancla.computo) ancla.hci = ancla.computo;
    var paradas = [{ cat: 'entrada', p3: internet }];
    presentes.forEach(function (cat) { if (ancla[cat]) paradas.push({ cat: cat, p3: ancla[cat] }); });
    var zTop = Math.max.apply(null, [RACK_H].concat(Object.keys(zPlaca).map(function (k) { return zPlaca[k]; })));
    // Cada tramo sigue ejes, como un cable: sube, avanza y baja.
    function camino(a, b, desde) {
      if (desde === 'entrada') return acometida.slice();
      var q = [a];
      if (Math.abs(a[0] - b[0]) < 0.01) { q.push(b); return q; }
      if (b === nube) { q.push([a[0], a[1], BANDEJA + 0.5 > a[2] ? BANDEJA + 0.5 : a[2]]); q.push([a[0], -2.2, q[q.length - 1][2]]); q.push([b[0], -2.2, q[q.length - 1][2]]); q.push([b[0], -2.2, b[2] - 0.5]); return q; }
      var zz = (a[2] > RACK_H + 0.01 || b[2] > RACK_H + 0.01) ? Math.max(a[2], b[2]) : BANDEJA;
      if (a[2] !== zz) q.push([a[0], a[1], zz]);
      q.push([b[0], b[1], zz]);
      if (b[2] !== zz) q.push(b);
      return q;
    }
    var tramos = [];
    for (var i = 1; i < paradas.length; i++) {
      var q3 = camino(paradas[i - 1].p3, paradas[i].p3, paradas[i - 1].cat), q2 = q3.map(function (q) { return P(q[0], q[1], q[2]); });
      var lon = 0; for (var k = 1; k < q2.length; k++) lon += Math.hypot(q2[k][0] - q2[k - 1][0], q2[k][1] - q2[k - 1][1]);
      tramos.push({ pts: q2.map(function (p) { return [f(p[0]), f(p[1])]; }), lon: Math.round(lon) });
      capas.tramos += '<polyline points="' + pts(q2) + '" data-tramo="' + (i - 1) + '" class="iso-tramo" style="stroke-dasharray:' + Math.ceil(lon) + ';stroke-dashoffset:' + Math.ceil(lon) + '"/>';
    }
    var pp = paradas.map(function (pa) { var p = P(pa.p3[0], pa.p3[1], pa.p3[2]); var m = marcas[pa.cat]; return { cat: pa.cat, p: [f(p[0]), f(p[1])], caja: m ? m.map(f) : [f(p[0] - 80), f(p[1] - 60), f(p[0] + 80), f(p[1] + 60)] }; });
    capas.paquete = '<g class="iso-paquete"><circle r="13" class="iso-paquete-halo"/><rect x="-21" y="-9" width="42" height="18" rx="9" class="iso-paquete-cuerpo"/><text y="4" text-anchor="middle" class="iso-paquete-txt">GET /</text></g>';
    void zTop;

    var m = 34, vista = [f(bx0 - m), f(by0 - m), f(bx1 - bx0 + 2 * m), f(by1 - by0 + 2 * m)];
    var svg = '<svg class="sala" viewBox="' + vista.join(' ') + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
      '<g class="iso-capa-suelo">' + capas.suelo + '</g>' +
      '<g class="iso-capa-fondo">' + capas.fondo + '</g>' +
      '<g class="iso-capa-racks">' + capas.racks + '</g>' +
      '<g class="iso-capa-bandeja">' + capas.bandeja + '</g>' +
      '<g class="iso-capa-pilares">' + capas.pilares + '</g>' +
      '<g class="iso-capa-placas">' + capas.placas + '</g>' +
      '<g class="iso-capa-puesto">' + capas.puesto + '</g>' +
      '<g class="iso-capa-tramos">' + capas.tramos + '</g>' +
      capas.paquete + '</svg>';
    // La firma decide cuándo hay que reinyectar: sólo si cambia lo dibujado.
    var firma = svg.length + ':' + piezas.map(function (p) { return p.id; }).join(',') + ':' + (d.lang || '');
    return { svg: svg, firma: firma, vista: vista, paradas: pp, tramos: tramos, racks: grupos.reduce(function (n, g) { return n + g.racks.length; }, 0), placas: placas.map(function (p) { return p.cat; }), ops: ops.map(function (p) { return p.id; }) };
  }

  // ---------- la parte viva: sólo clases, paquete y cámara ----------
  function suave(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function quieto() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function animar(el, clave, ms, paso) {
    var tok = (el[clave] = (el[clave] || 0) + 1);
    if (quieto() || !ms) { paso(1); return; }
    var t0 = null;
    function fr(ts) { if (el[clave] !== tok) return; if (t0 === null) t0 = ts; var t = Math.min(1, (ts - t0) / ms); paso(suave(t)); if (t < 1) requestAnimationFrame(fr); }
    requestAnimationFrame(fr);
  }
  function enCamino(ptsL, t) {
    var L = [0], i;
    for (i = 1; i < ptsL.length; i++) L[i] = L[i - 1] + Math.hypot(ptsL[i][0] - ptsL[i - 1][0], ptsL[i][1] - ptsL[i - 1][1]);
    var obj = t * L[L.length - 1];
    for (i = 1; i < ptsL.length; i++) if (L[i] >= obj) { var k = (obj - L[i - 1]) / ((L[i] - L[i - 1]) || 1); return [ptsL[i - 1][0] + (ptsL[i][0] - ptsL[i - 1][0]) * k, ptsL[i - 1][1] + (ptsL[i][1] - ptsL[i - 1][1]) * k]; }
    return ptsL[ptsL.length - 1];
  }
  function encuadre(esc, paso) {
    var v = esc.vista.map(Number);
    if (paso < 0 || !esc.paradas[paso]) return v;
    var c = esc.paradas[paso].caja, cx = (c[0] + c[2]) / 2, cy = (c[1] + c[3]) / 2;
    // Acerca, pero nunca más de ×1,45: la parada se ve con su contexto.
    var w = Math.max(c[2] - c[0] + 260, v[2] / 1.45), h = Math.max(c[3] - c[1] + 220, v[3] / 1.45);
    var r = v[2] / v[3]; if (w / h < r) w = h * r; else h = w / r;
    // Un poco por debajo del centro: abajo está el rótulo del paso.
    return [cx - w / 2, cy - h * 0.42, w, h];
  }
  function sync(el, esc, est) {
    if (!el || !esc) return;
    if (el.__firma !== esc.firma) {
      el.innerHTML = esc.svg; el.__firma = esc.firma; el.__paso = -1; el.__vb = esc.vista.map(Number); el.__sel = undefined;
    }
    var svg = el.firstElementChild; if (!svg) return;
    var paso = est.flujo ? est.paso : -1;
    svg.classList.toggle('flujo', !!est.flujo);
    var activa = paso >= 0 && esc.paradas[paso] ? esc.paradas[paso].cat : null, vistas = {};
    esc.paradas.forEach(function (p, i) { if (i <= paso) vistas[p.cat] = 1; });
    svg.querySelectorAll('[data-cat]').forEach(function (n) { var c = n.getAttribute('data-cat'); n.classList.toggle('is-on', c === activa); n.classList.toggle('is-visto', !!vistas[c]); });
    if (el.__sel !== est.sel) { el.__sel = est.sel; svg.querySelectorAll('[data-pieza]').forEach(function (n) { n.classList.toggle('is-sel', n.getAttribute('data-pieza') === est.sel); }); }
    if (el.__paso === paso) return;
    var antes = el.__paso; el.__paso = paso;
    svg.querySelectorAll('[data-tramo]').forEach(function (n) { n.classList.toggle('is-on', +n.getAttribute('data-tramo') < paso); });
    var pq = svg.querySelector('.iso-paquete');
    if (pq) {
      if (paso < 0) pq.style.opacity = 0;
      else {
        pq.style.opacity = 1;
        var tr = paso > 0 && antes === paso - 1 ? esc.tramos[paso - 1] : null;
        var fin = esc.paradas[paso].p;
        if (tr) animar(el, '__tokP', 780, function (t) { var p = enCamino(tr.pts, t); pq.setAttribute('transform', 'translate(' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ')'); });
        else pq.setAttribute('transform', 'translate(' + fin[0] + ' ' + fin[1] + ')');
      }
    }
    // Cámara: interpola el viewBox (más nítido que escalar un div).
    var de = el.__vb || esc.vista.map(Number), a = encuadre(esc, paso);
    animar(el, '__tokC', 820, function (t) {
      var v = de.map(function (x, i) { return x + (a[i] - x) * t; });
      el.__vb = v; svg.setAttribute('viewBox', v.map(function (x) { return x.toFixed(1); }).join(' '));
    });
  }

  var S = { escena: escena, sync: sync, RECORRIDO: RECORRIDO, PLACAS: PLACAS };
  if (typeof window !== 'undefined') window.LABSTACK_SALA = S;
  if (typeof module !== 'undefined') module.exports = S;
})();
