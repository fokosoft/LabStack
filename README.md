# LabStack · Taller visual de infraestructura

Laboratorio educativo **de un solo archivo** para aprender la infraestructura de sistemas de forma visual e interactiva: arrastra tecnologías, monta tu stack por capas y la app te explica el *porqué*, valida tu arquitectura y te deja experimentar. Bilingüe (ES/EN), tema claro/oscuro, sin backend.

## Cómo ejecutarlo

Abre **`Laboratorio.dc.html`** en un navegador moderno. No requiere instalación, ni servidor, **ni conexión a internet**: React, las fuentes y el resto van en `vendor/`.

> Para el flujo completo de "compartir por enlace" conviene servirlo (p. ej. GitHub Pages) en lugar de abrirlo como `file://`.

## Qué incluye

- **Una sola puerta de entrada** y **4 grupos** en vez de un menú de nueve modos:
  - **Aprender** — monta tu stack por capas, agrupadas en los 5 planos (física → plataforma → aplicación → datos → nube), con densidad **Compacto / Detalle**.
  - **Practicar** — retos con objetivos y presupuesto + quiz adaptativo.
  - **Explorar** — 8 vistas del stack que has montado: Mapa · Petición · Despliegue · Métricas · Terminal · Incidente · **Eventos** (consola tipo OBM con correlación) · **Puesto** (ITSM con 12 tickets y cuatro terminales a la vez).
  - **Kids** — para peques: dos partidas cortas (la torre, 11 pisos; los ayudantes, 6), una capa cada vez, con dibujos y sin forma de equivocarse del todo.
- **~69 tecnologías** en 16 categorías (6 familias de color) con fichas educativas + mensajería (Kafka/RabbitMQ/NATS) + marcos de gobierno (COSO / ISO 27001 / COBIT).
- **Linter de arquitectura** (robustez, anti-patrones), **dimensionado** (coste/CPU/RAM) y **modo avería** (resiliencia).
- **11 misiones** con niveles, **quiz adaptativo**, **ruta de aprendizaje** guiada, **logros** y **glosario** buscable.
- **Simuladores**: petición HTTP salto a salto, despliegue rolling/blue-green/canary, e incidentes de troubleshooting guiados.
- **Terminal simulada** (~148 comandos, filesystem virtual) y **dashboard de métricas** en vivo.
- **Modo profesor** (contenido en JSON importable/exportable) y **exportar/importar stacks**.
- Accesibilidad (foco visible, Escape, `prefers-reduced-motion`) y responsive.

## Puesto Linux: réplica de un puesto real

Una segunda app, en **`puesto-linux/index.html`** (también enlazada desde la portada), **en español y en inglés** (botón EN/ES o `?lang=en`): el día a día de un puesto de *Administrador/a de Sistemas Linux* sobre una plataforma simulada de **12 nodos**: bastión, 3 controladores OpenStack, 4 hipervisores, 3 nodos Ceph y monitorización.

- **20 tickets** repartidos entre las cuatro funciones de la oferta: despliegue y mantenimiento de OpenStack, administración de Ceph, automatización con Ansible y Terraform, y resolución de incidencias.
- **Se arreglan con comandos reales**, no eligiendo respuestas: `ssh`, `systemctl`, `journalctl`, `ceph`, `openstack`, `nova-manage`, `ansible-playbook`, `terraform`, `amtool`… con `sudo`, tuberías, `&&`, Tab y varias pestañas.
- La plataforma **cambia con el tiempo**: un OSD caído pasa a *out* a los 10 minutos, un reinicio sin `noout` mueve datos, chrony corrige despacio, un RabbitMQ en *debug* llena el disco.
- Al cerrar: tiempo frente al **SLA** (prioridad por impacto × urgencia), **buenas prácticas** detectadas en lo que hiciste, causa raíz y un **informe descargable** en Markdown con la cronología.
- **Guardia generada**: tres niveles (*tranquila*, una avería; *movida*, dos; *infierno*, tres y alguna gorda) combinando al azar 15 familias de averías coherentes. Sin ticket, sólo alertas. Cada guardia sale de una **semilla**: con el mismo número, la misma noche, para repetirla o comparar con un compañero. Toda guardia se ensaya antes de jugarla y al cerrarla se puede descargar como incidencia `.json`. También puede tocar un ticket del puesto al azar, incluidas las incidencias importadas.
- **Laboratorio libre con caos**: la plataforma sana y un botón que rompe algo al azar en los próximos minutos, sin decir qué. Luego, «¿está todo arreglado?» y «revelar qué era».
- **Compositor de incidencias** (`puesto-linux/compositor.html`, para el profesor): se eligen averías del catálogo con desplegables (nodo, servicio, OSD, proyecto…), o familias enteras, y se escribe el ticket. A la derecha, el puesto la ensaya mientras escribes: qué alertas verá quien la juegue, qué tendrá que dejar arreglado y si su solución de referencia la cierra. Se guarda en la cola, se prueba en el puesto con un clic o se descarga como `.json` para repartirla.
- **Catálogo de averías** (`puesto-linux/averias.js`): 14 tipos de avería (servicio caído, disco lleno, reloj desfasado, disco muerto, flag olvidado, certificado caducado…) con los que se construyen todos los tickets. Se combinan y se propagan solas, y cada una trae su arreglo de referencia: es la base para generar incidencias nuevas.
- **Incidencias propias en fichero**: un profesor o un compañero escribe un `.json` que combina averías del catálogo y lo importa desde la cola (botón o arrastrando el fichero). Antes de aceptarlo, el Puesto lo aplica y **ensaya su solución**: si nadie podría arreglarlo, no entra y dice por qué. Hay dos ejemplos en `puesto-linux/incidencias/`, cualquier ticket del puesto se descarga como plantilla, y se valida también sin navegador: `npm run validar -- mi-incidencia.json` (`npm run catalogo` lista los tipos de avería y sus parámetros).
- **Solucionario** (`puesto-linux/soluciones.html`): cómo se resuelve cada ticket paso a paso, con la salida real de cada comando, lo que *no* lo arregla, y un glosario de 59 términos. Se puede imprimir.

### Formato de una incidencia

```json
{
  "formato": "puesto-incidencia/1",
  "id": "EXT-001",
  "asunto": "Noche movida: varias alertas a la vez",
  "cuerpo": ["Lo que cuenta quien abre el ticket."],
  "impacto": "alto", "urgencia": "alta",
  "hace": 30, "abiertoHace": 10,
  "averias": [
    { "tipo": "servicio-parado", "nodo": "cmp03", "servicio": "libvirtd", "hace": 120, "deshabilitado": true },
    { "tipo": "reloj-desfasado", "nodo": "ceph01", "segundos": 0.4, "hace": 200 }
  ]
}
```

Opcionales: `tipo` (incidente, peticion, cambio), `nivel` (1-3), `de`, `area`, `funciones`, `pistas` (exactamente 3), `causa`, `solucion`, `leccion`, `autor`. Lo que falte se genera a partir de las averías.

## Puesto Cloud: el mismo puesto, en AWS

Una tercera app, en **`puesto-cloud/index.html`** (en español y en inglés): el puesto de *Ingeniero/a de Sistemas Cloud (AWS)* de una tienda online, sobre una cuenta de AWS simulada.

- **Una cuenta entera para romper**: una VPC con subredes públicas y privadas, 5 instancias EC2 detrás de un balanceador, security groups, volúmenes EBS, un NAT gateway, usuarios, roles y políticas de IAM, buckets de S3 y alarmas de CloudWatch.
- **La CLI de verdad**: `aws ec2 describe-instances`, `authorize-security-group-ingress`, `modify-volume`, `replace-route`, `run-instances`, `aws cloudwatch describe-alarms`… con salida JSON, `--output table`, `--filters` y `--query`. Y dentro de las instancias, `ssh`, `systemctl`, `df`, `curl`, `resize2fs`.
- **La red se comporta como la de AWS**: un security group no rechaza, descarta (y por eso `ssh` se queda colgado); a las IP privadas sólo se llega saltando por el bastión; una ruta a un NAT borrado es un *blackhole*; ampliar un volumen no amplía el sistema de ficheros.
- **Solucionario** (`puesto-cloud/soluciones.html`): cada ticket paso a paso, con la salida real de cada comando, lo que no lo arregla y un glosario de 58 términos de AWS.
- **15 tickets**: los de las fases 1 y 2 y, además, la base de pedidos de RDS sin espacio, recuperar un pedido borrado restaurando la base «a un momento», los workers de Auto Scaling que no se reponen porque alguien borró su AMI, la factura que dobla el presupuesto por restos de unas pruebas de carga, y reglas añadidas a mano que Terraform detecta. Fases 1 y 2: el SSH que deja de funcionar al cambiar la IP de la oficina, un frontal parado, el disco de PostgreSQL al 93 %, los pagos que fallan por un NAT gateway mal sustituido, un tercer frontal en otra zona y detrás del balanceador, las facturas que no se suben por una política de IAM mal «ajustada», un bucket con datos de clientes abierto a internet, los precios a 0 € que se arreglan con el versionado de S3, un balanceador que da por malos a todos (y aun así la web carga) y una clave de acceso publicada en GitHub con la que alguien ya está minando criptomonedas en otra región.
- **Incidencias propias**: un catálogo de 16 averías de la nube para combinar en un fichero `.json` o en el **compositor** (`puesto-cloud/compositor.html`); antes de aceptarla, el puesto la ensaya sobre una cuenta nueva y comprueba que tiene arreglo. Cualquier ticket se puede descargar como plantilla.
- **Guardias y caos**: noches de averías al azar (11 familias, tres niveles, con semilla) y un botón que rompe algo sin avisar en el laboratorio libre.
- **RDS, Auto Scaling, coste y Terraform**: `aws rds`, `aws autoscaling`, `aws ce` y `terraform plan / apply` contra la misma cuenta simulada.
- **IAM de verdad**: las instancias hablan con AWS con su rol, y cada orden se evalúa contra las políticas de quien la lanza. Un `AccessDenied` dice exactamente qué acción y qué recurso faltan.

Comparte motor e interfaz con el Puesto Linux: no es una copia.

> Simulador educativo independiente, sin relación con Amazon Web Services. AWS y los nombres de sus servicios son marcas de Amazon.com, Inc. o sus filiales.

## Puesto DevOps: Kubernetes en producción

Una cuarta app, en **`puesto-devops/index.html`** (en español y en inglés): el puesto de *Ingeniero/a DevOps (Kubernetes)* de una plataforma de pagos, sobre un clúster de Kubernetes simulado.

- **Un clúster que reconcilia de verdad**: un control plane y tres workers con la plataforma de pagos (api-pagos, web-checkout, antifraude, liquidaciones) y su monitorización. Cada minuto corre el bucle de los controladores: el rolling update con maxSurge y maxUnavailable, el scheduler que suma *requests*, el kubelet que descarga imágenes, lee el ConfigMap al arrancar, reinicia con backoff y mata por OOM.
- **kubectl de verdad**: `get`, `describe` con sus eventos, `logs --previous`, `top`, `rollout status / history / undo / restart`, `set image / resources`, `scale`, `cordon / uncordon / drain`, `apply -f`, `diff -f`, `patch` y `exec`, con las tablas y los errores de kubectl. Y en los nodos, `systemctl status kubelet` y `crictl ps`.
- **El repositorio es la verdad**: los manifiestos de producción están en `~/k8s`; `kubectl diff` enseña la deriva y los tickets se cierran sin dejarla.
- **Fase 2 — alrededor de las cargas**: volúmenes (StorageClass, PVC que crece en caliente y no encoge), Ingress y cert-manager (renovación, certificados caducados, `curl -v`), la HPA (que sube, se estabiliza y gana a `kubectl scale`), RBAC (`kubectl auth can-i --as`), NetworkPolicies (un timeout no es un refused) y Helm (`history`, `rollback`, `pending-upgrade`, values).
- **Fase 3 — GitOps, CI y guardias**: Argo CD (aplicaciones Synced/OutOfSync, sincronización manual o automática con self-heal), `git show / revert / push` sobre el repositorio de manifiestos, los pipelines de CI con `glab ci`, nodos que se caen (el kubelet, el swap, el desalojo de pods a los 5 minutos), y **guardias y caos**: noches de averías al azar con semilla (10 familias, tres niveles) y un botón que rompe algo sin avisar en el laboratorio libre.
- **Fase 4 — incidencias propias**: un catálogo de 18 averías de Kubernetes para combinar en un fichero `.json` o en el **compositor** (`puesto-devops/compositor.html`); antes de aceptarla, el puesto la aplica sobre un clúster nuevo (en orden, con el tiempo corriendo entre una avería y la siguiente) y comprueba que tiene arreglo. 14 de los 15 tickets se pueden descargar como plantilla.
- **15 tickets**. Los 3 de la fase 3: una versión rota que Argo CD vuelve a desplegar cada vez que alguien hace `rollout undo` (se arregla con `git revert`), un worker que no vuelve del parcheo porque el kubelet no arranca con swap, y un pipeline en rojo porque nadie sincronizó la aplicación en Argo CD. Los 6 de la fase 2: Prometheus sin espacio con el PR de ampliación fusionado pero sin aplicar, el certificado del checkout caducado porque su emisor cambió de nombre, la HPA que no escala en plena campaña porque alguien bajó su máximo, el pipeline de CI sin permisos tras mover los runners de namespace, todos los pagos a revisión manual por una NetworkPolicy de la versión siguiente y el parche de seguridad de ingress-nginx con el release de Helm colgado en `pending-upgrade`. Y los 6 de la fase 1: un pod en CrashLoopBackOff porque alguien renombró una clave del ConfigMap (y sólo se notó al reiniciarse un nodo), una versión que no despliega por una etiqueta de imagen equivocada, antifraude muriendo por OOMKilled tras un «ajuste de costes», liquidaciones en Pending por un nodo que se quedó en cordon tras un mantenimiento, un Service sin endpoints por un selector que no casa, y un rollout atascado porque la versión nueva cambió su endpoint de salud.
- **Solucionario** (`puesto-devops/soluciones.html`): cada ticket paso a paso, con la salida real de cada comando, lo que no lo arregla y un glosario de 54 términos.

Comparte motor e interfaz con los otros dos puestos. Están las cuatro fases: el mismo recorrido que el Puesto Linux y el Puesto Cloud.

> Simulador educativo independiente, sin relación con la Cloud Native Computing Foundation ni con el proyecto Kubernetes. Kubernetes es una marca registrada de The Linux Foundation.

## Estructura

| Archivo | Descripción |
|---|---|
| `Laboratorio.dc.html` | La aplicación (plantilla `<x-dc>` + lógica `class Component`). |
| `events-test.js` | Recorre la consola de eventos: correlación, triaje del ruido y el puente evento → incidencia. |
| `desk-test.js` | Recorre el modo Puesto: resuelve los 12 tickets y comprueba que la evidencia sólo aparece en el equipo correcto. |
| `test.js` + `package.json` | `npm test` lanza las seis comprobaciones de una vez. No hay nada que instalar. |
| `puesto-linux/` | **Puesto Linux**, la app de práctica profesional: motor de la plataforma, comandos, escenarios, interfaz y su test. |
| `content-test.js` | Valida el contenido: `node content-test.js` comprueba referencias entre ficheros, ids repetidos y que ES y EN estén completos. |
| `vendor/` | React, fuentes (subconjunto latino) y confeti, en local. Es lo que permite abrirla sin internet. |
| `contenido/` | **El contenido, editable sin tocar la lógica**: `piezas.js` (tecnologías y fichas), `capas.js` (pedagogía por capa), `textos.js` (interfaz ES/EN), `retos.js` (misiones e incidentes), `kids.js` (modo Kids), `tickets.js` y `eventos.js` (Puesto y consola), `comandos.js` (qué te dice cada comando). |
| `support.js` | Motor del formato `.dc.html`, generado por Claude Design (carga React desde `vendor/`). **Generado — no editar.** |
| `fokosoft.png` | Logo. |
| `ROADMAP.md` | Estado del proyecto y plan de mejoras. |
| `CLAUDE.md` | Guía técnica de la arquitectura del código. |

## Créditos

© 2026 **FOKO SOFT**

## Licencia

**MIT + Commons Clause** (ver [`LICENSE`](LICENSE)). En la práctica:

- ✅ Puedes usarlo, copiarlo, modificarlo y compartirlo, gratis, también en clase.
- ✅ Puedes publicar tus propias versiones, manteniendo el aviso de licencia.
- ❌ No puedes **venderlo**, ni cobrar por un producto o servicio cuyo valor venga, total o sustancialmente, de este software (incluido alojarlo o dar soporte de pago sobre él).

Para un uso comercial, pregunta: se puede hablar.

Los ficheros de `vendor/` (React, las fuentes Inter y JetBrains Mono, canvas-confetti) conservan sus propias licencias: ver [`vendor/LICENCIAS.md`](vendor/LICENCIAS.md). `support.js` es el motor que genera Claude Design (Anthropic) al exportar la app y no está cubierto por esta licencia.
