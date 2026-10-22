// Puesto Cloud · la plataforma de partida.
//
// Se carga ANTES que ../puesto-linux/motor.js: el motor lee esta lista en vez
// de sus 12 nodos de OpenStack. El primero es el punto de entrada (tu equipo,
// con la CLI de AWS configurada); los demás son las instancias EC2 de la
// cuenta, servidores Ubuntu de verdad para el simulador: dentro funcionan
// systemctl, journalctl, df... igual que en el Puesto Linux.
//
// Lo que no es un servidor (VPC, subredes, rutas, security groups, volúmenes,
// alarmas) vive en st.aws y lo monta nube.js.
(function (P) {
'use strict';
const KERNEL = '6.5.0-1022-aws';
const raiz = (tamG, baseG) => ({ '/': { dev: '/dev/root', tamG, baseG } });
P.topologiaInicial = [
  { n: 'ops', rol: 'ops', ip: '192.168.1.34', unidades: [], ram: 16, ramBase: 6.1, discos: { '/': { dev: '/dev/nvme0n1p2', tamG: 468, baseG: 131 } } },
  { n: 'bastion', rol: 'bastion', ip: '10.0.1.10', kernel: KERNEL, unidades: [], ram: 1, ramBase: 0.3, discos: raiz(7.6, 2.4) },
  { n: 'web-01', rol: 'web', ip: '10.0.1.21', kernel: KERNEL, unidades: ['nginx'], ram: 2, ramBase: 0.4, discos: raiz(19.2, 4.6),
    logs: { '/var/log/nginx/access.log': 140, '/var/log/nginx/access.log.1': 210, '/var/log/nginx/error.log': 2 } },
  { n: 'web-02', rol: 'web', ip: '10.0.2.21', kernel: KERNEL, unidades: ['nginx'], ram: 2, ramBase: 0.4, discos: raiz(19.2, 4.4),
    logs: { '/var/log/nginx/access.log': 132, '/var/log/nginx/access.log.1': 198, '/var/log/nginx/error.log': 2 } },
  { n: 'app-01', rol: 'app', ip: '10.0.11.30', kernel: KERNEL, unidades: ['tienda-api'], ram: 4, ramBase: 0.6, discos: raiz(19.2, 6.1),
    logs: { '/var/log/tienda-api/app.log': 64 } },
  { n: 'db-01', rol: 'db', ip: '10.0.12.40', kernel: KERNEL, unidades: ['postgresql'], ram: 8, ramBase: 0.9,
    discos: { '/': { dev: '/dev/root', tamG: 19.2, baseG: 5.2 }, '/var/lib/postgresql': { dev: '/dev/nvme1n1', tamG: 98.2, baseG: 61.4 } },
    logs: { '/var/log/postgresql/postgresql-14-main.log': 38 } },
];
})(window.PUESTO = window.PUESTO || {});
