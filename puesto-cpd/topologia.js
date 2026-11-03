// Puesto CPD · la plataforma de partida.
//
// Se carga ANTES que ../puesto-linux/motor.js: el motor lee esta lista en vez
// de sus 12 nodos de OpenStack. Un CPD de hosting gestionado de verdad: siete
// servidores, tres clientes y cuatro distribuciones a la vez (Rocky, Debian,
// Ubuntu y SLES), que es justo lo que obliga a saber en qué familia estás
// antes de escribir dnf o apt.
//
// El primero, mgmt01, es el punto de entrada: el nodo de gestión, con Ansible,
// Prometheus y tu clave SSH. Lo que corre en cada servidor (las webs de los
// clientes, los contenedores, las bases de datos) lo monta servicios.js.
(function (P) {
'use strict';
const EL9 = '5.14.0-427.13.1.el9_4.x86_64', DEB = '6.1.0-28-amd64';
P.topologiaInicial = [
  { n: 'mgmt01', rol: 'mgmt', distro: 'debian', ip: '10.10.0.10', kernel: DEB, unidades: ['prometheus', 'alertmanager'], ram: 8, ramBase: 1.6,
    discos: { '/': { dev: '/dev/mapper/vg0-root', tamG: 40, baseG: 11.2 } } },
  { n: 'web01', rol: 'web', distro: 'rocky', ip: '10.10.0.21', kernel: EL9, unidades: ['firewalld', 'nginx', 'tomcat', 'node_exporter'], ram: 8, ramBase: 0.9,
    discos: { '/': { dev: '/dev/mapper/rl-root', tamG: 30, baseG: 6.4 }, '/var': { dev: '/dev/mapper/rl-var', tamG: 20, baseG: 7.6 } } },
  { n: 'web02', rol: 'web', distro: 'sles', ip: '10.10.0.22', kernel: '5.14.21-150500.55.65-default', unidades: ['firewalld', 'nginx', 'node_exporter'], ram: 4, ramBase: 0.8,
    discos: { '/': { dev: '/dev/sda2', tamG: 40, baseG: 9.1 } } },
  { n: 'web03', rol: 'web', distro: 'rocky', ip: '10.10.0.23', kernel: EL9, unidades: ['firewalld', 'httpd', 'node_exporter'], ram: 4, ramBase: 0.7,
    discos: { '/': { dev: '/dev/mapper/rl-root', tamG: 30, baseG: 5.2 } } },
  { n: 'app01', rol: 'app', distro: 'debian', ip: '10.10.0.31', kernel: DEB, unidades: ['containerd', 'docker', 'tomcat', 'node_exporter'], ram: 16, ramBase: 1.4,
    discos: { '/': { dev: '/dev/mapper/vg0-root', tamG: 60, baseG: 21.4 } } },
  { n: 'db01', rol: 'db', distro: 'ubuntu', ip: '10.10.0.41', kernel: '5.15.0-125-generic', unidades: ['postgresql', 'reportd', 'node_exporter'], ram: 16, ramBase: 1.2,
    discos: { '/': { dev: '/dev/mapper/vg0-root', tamG: 30, baseG: 7.7 }, '/var': { dev: '/dev/mapper/vg0-var', tamG: 50, baseG: 18.6 } } },
  { n: 'db02', rol: 'db', distro: 'rocky', ip: '10.10.0.42', kernel: EL9, unidades: ['firewalld', 'mariadb', 'crond', 'node_exporter'], ram: 8, ramBase: 0.9,
    discos: { '/': { dev: '/dev/mapper/rl-root', tamG: 30, baseG: 5.9 }, '/backup': { dev: '/dev/mapper/rl-backup', tamG: 200, baseG: 61.2 } } },
];
})(window.PUESTO = window.PUESTO || {});
