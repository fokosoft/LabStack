// Puesto DevOps · la plataforma de partida.
//
// Se carga ANTES que ../puesto-linux/motor.js: el motor lee esta lista en vez
// de sus 12 nodos de OpenStack. El primero es el punto de entrada (tu equipo,
// con kubectl configurado contra el clúster de producción); los demás son los
// nodos del clúster, servidores Ubuntu de verdad para el simulador: dentro
// funcionan systemctl status kubelet, journalctl -u containerd, df...
//
// Lo que no es un servidor (Deployments, pods, Services, ConfigMaps, eventos)
// vive en st.k8s y lo monta cluster.js.
(function (P) {
'use strict';
const KERNEL = '6.8.0-45-generic';
P.topologiaInicial = [
  { n: 'ops', rol: 'ops', ip: '192.168.1.52', unidades: [], ram: 16, ramBase: 5.4, discos: { '/': { dev: '/dev/nvme0n1p2', tamG: 468, baseG: 142 } } },
  { n: 'cp-01', rol: 'cp', ip: '10.30.0.10', kernel: KERNEL, unidades: ['containerd', 'kubelet'], ram: 8, ramBase: 2.1,
    discos: { '/': { dev: '/dev/sda2', tamG: 78, baseG: 19.4 }, '/var/lib/etcd': { dev: '/dev/sdb', tamG: 48, baseG: 3.1 } }, logs: { '/var/log/containers/kube-apiserver-cp-01.log': 64 } },
  { n: 'worker-01', rol: 'worker', ip: '10.30.0.21', kernel: KERNEL, unidades: ['containerd', 'kubelet'], ram: 16, ramBase: 1.2, discos: { '/': { dev: '/dev/sda2', tamG: 98, baseG: 31.8 } } },
  { n: 'worker-02', rol: 'worker', ip: '10.30.0.22', kernel: KERNEL, unidades: ['containerd', 'kubelet'], ram: 16, ramBase: 1.2, discos: { '/': { dev: '/dev/sda2', tamG: 98, baseG: 29.6 } } },
  { n: 'worker-03', rol: 'worker', ip: '10.30.0.23', kernel: KERNEL, unidades: ['containerd', 'kubelet'], ram: 16, ramBase: 1.2, discos: { '/': { dev: '/dev/sda2', tamG: 98, baseG: 30.2 } } },
];
})(window.PUESTO = window.PUESTO || {});
