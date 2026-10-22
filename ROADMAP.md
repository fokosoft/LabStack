# LabStack · Taller visual de infraestructura — Estado y Roadmap

> Documento vivo. Resume **lo que ya tiene** el taller y **los pasos a seguir** para mejorarlo.
> Para la documentación técnica de cómo está construido, ver [CLAUDE.md](CLAUDE.md).

---

## 1. Qué es

Un laboratorio educativo **de un solo archivo** (`Laboratorio.dc.html`) que enseña la infraestructura de sistemas de forma visual e interactiva: el alumno arrastra tecnologías, monta su stack, y la app le explica el *porqué*, valida su arquitectura y le deja experimentar. Bilingüe (ES/EN), tema claro/oscuro, sin backend.

**Público:** estudiantes de Ingeniería en Sistemas / DevOps / infraestructura, y docentes.

---

## 2. Lo que YA tenemos ✅

### Modos (9)
| Modo | Qué hace |
|---|---|
| **Libre** | Sandbox: arrastra piezas al árbol por capas, con feedback y corrección. |
| **Misión** | 11 retos con objetivos, niveles de dificultad y evaluación del stack. |
| **Quiz** | Preguntas de recuerdo activo, **adaptativo** (insiste donde fallas). |
| **Mapa** | Datacenter físico navegable (pan/zoom), con flujo animado y modo avería. |
| **Terminal** | Shell simulado con **148 comandos** y filesystem virtual. |
| **Métricas** | Dashboard en vivo (CPU/RAM/req-s/latencia) con sparklines SVG. |
| **Petición** | Waterfall de una petición HTTP salto a salto por tu stack; simula caídas por salto (5xx/timeout). |
| **Despliegue** | Simulador rolling / blue-green / canary con reparto de tráfico animado y rollback. |
| **Incidente** | Runbook de troubleshooting: síntoma → investigar → diagnosticar → arreglar, con 3 escenarios. |

### Contenido
- **16 categorías** en **6 familias de color** (física, plataforma, aplicación, datos, nube, operación).
- **~69 piezas** (router, k8s, postgres, terraform, **Kafka/RabbitMQ/NATS**, Istio, Kong, Vault, Elasticsearch… + marcos **COSO / ISO 27001 / COBIT**).
- Cada pieza con ficha completa: descripción, ideas clave, **en una frase**, **cuándo usarla**, **alternativas**, coste/CPU/RAM, y (algunas) terminal simulada.
- Cada capa con: por qué existe, qué pasa si falta, analogía.

### Rigor y análisis
- **Linter de arquitectura**: nota de robustez 0–100, detecta dependencias rotas y anti-patrones (SPOF, datos sin persistencia, sin TLS/firewall/monitorización).
- **Dimensionado**: coste €/mes, vCPU y RAM del stack; misión con **restricción de presupuesto**.
- **Modo avería / chaos**: tira una pieza y mide la resiliencia (cascada por dependencias).

### Mapa físico
- Zonas (perímetro → sala → almacenamiento/datos/nube → operación), iconos por pieza, leyenda.
- **Dependencias** dibujadas como curvas con **tráfico animado**.
- **Avisos del linter** anclados a las piezas/zonas.
- **Flujo de petición** animado salto a salto.

### Aprendizaje y progreso
- **11 misiones** con niveles (Básico/Intermedio/Avanzado) y objetivo de **redundancia (×2)**.
- **Quiz adaptativo** con repetición espaciada (persistente).
- **11 logros** persistentes + **confeti** al desbloquear (canvas-confetti desde CDN).

### Uso y persistencia
- **Autoguardado** en `localStorage` (stack, idioma, tema, logros, progreso de quiz).
- **Compartir por enlace** (`#s=…`) — el compañero abre y ve tu montaje.
- **Tour guiado** (recorrido por las capas) y **exportar** (hoja de resumen imprimible / PDF).

### Terminal (simulador casi real)
- **148 comandos**: filesystem (`ls/cd/cat/tree/grep…`), red (`ping/curl/nmap/dig/tcpdump…`), Kubernetes (`kubectl …`, `helm`), Docker (`docker …`, `compose`), Git, Terraform, Ansible, nube (`aws/gcloud/az`), bases de datos (`psql/redis-cli/mongosh/mysql`), utilidades (`stat/seq/expr/base64/htop…`) y extras (`neofetch/cowsay…`).
- **Consciente del stack**: cada comando responde según lo montado (o da el error real).
- Historial (↑/↓), autocompletado (Tab), `man`, prompt con ruta.

### Base técnica
- Formato `.dc.html` (runtime React vía `support.js`). Toda la lógica en un `class Component`.
- `renderVals()` precomputa todo (el motor de plantillas no admite ternarios/aritmética).
- **Verificación**: smoke tests en Node (instanciar `Component` con stubs) para validar sin navegador.

---

## 3. Pasos a seguir 🚧 (backlog priorizado)

Marcado con ⭐ lo que más recomiendo.

### ✅ Hecho — rediseño didáctico (fases 1 y 2)
- ✅ **Pantalla de inicio** como modo por defecto: tres puertas (Aprender / Practicar / Explorar) + «seguir donde lo dejaste».
- ✅ **Cabecera de 13 controles → 4**: marca, 3 grupos por verbo, idioma y un menú «Más» con el resto.
- ✅ **Los 6 simuladores dejan de ser modos** y pasan a ser vistas dentro de Explorar (sub-navegación en el lienzo).
- ✅ **Paneles contextuales**: la paleta solo existe donde se colocan piezas y el raíl derecho solo donde aporta. En Quiz se ocultan ambos — la paleta daba la respuesta.
- ✅ **Transversales en cinturón horizontal** (texto legible) en vez de 7 columnas verticales rotadas; libera ~40% del lienzo.
- ✅ **Capas agrupadas en los 5 planos** + densidad **Compacto / Detalle**: el stack entero cabe en una pantalla.
- ✅ **Checklist de 17 casillas → tarjeta de progreso** (porcentaje, capas, pilares y siguiente paso).
- ✅ **Rejilla por clases CSS** con puntos de ruptura propios: deja de romperse a 1280 px.

### ✅ Hecho — mapa ilustrado
- ✅ **39 arquetipos de dibujo esquemático** (`artArchetypes()`): cada pieza se dibuja como el aparato real de frente — rack con sus U, switch con puertos y LEDs, servidor con bahías, firewall como muro con llama, VPN como túnel, TLS como certificado, cinta de backup, RAM, cabina de discos, NAS, RAID con paridad…
- ✅ Nodos de 172×64 con ilustración + nombre a dos líneas + código; respetan tema claro/oscuro y el color de familia sin tocar nada (`var(--panel)` + rol de color).
- ✅ Autoencuadre al entrar (`mapAutoFit()`) con escala mínima para que el dibujo siga legible.
- Pendiente si se quiere: usar la misma ilustración en la **ficha de la pieza** y en la **paleta** (una línea: `paintArt(artKeyFor(id,cat), color)`).

### ✅ Hecho — cableado legible
- ✅ **Trazado ortogonal** con esquinas redondeadas en vez de curvas Bézier cruzadas.
- ✅ **Los cables no pasan por encima de ningún grupo**: bandeja bajo las cajas si están en la misma fila, pasillo entre filas si son contiguas, y bus por el margen si hay filas de por medio.
- ✅ **Tres lenguajes de línea** en vez de uno: camino de la petición (acento, flecha, animado) · necesita debajo (gris discontinuo) · opera sobre (violeta punteado). Con leyenda de los tres.
- ✅ Los cables salen del **borde** de cada grupo con su conector, no del centro.
- ✅ Cada cable explica al pasar por encima qué conecta y por qué (cobertura ~67%: la leyenda sigue siendo la explicación principal).

### ✅ Hecho — la simulación del mapa se entiende
- ✅ El paquete **recorre una ruta real** en ángulo recto (antes volaba en diagonal ignorando el cableado).
- ✅ **Rastro que se dibuja solo** detrás del paquete: al acabar ves el camino completo de la petición.
- ✅ **La cámara sigue** la parada activa, y solo se mueve si se está saliendo de la vista.
- ✅ El paquete es una etiqueta **GET /**, no un punto anónimo.
- ✅ Cartel con **paso n/total + nombre de la capa** + qué ocurre ahí; las paradas ya visitadas se quedan marcadas.
- ✅ Ritmo más lento (~950 ms por paso) y pausa final para leer la ruta entera.
- Pendiente si se quiere: **controles de reproducción** (pausa / paso a paso) para que el alumno marque su propio ritmo.

### ✅ Hecho — modo Kids (cuarta pestaña)
- ✅ **17 pasos partidos en DOS PARTIDAS**, porque 17 de una sentada pasan de los 8 min que aguanta esta edad.
  - **Partida 1 · La torre** (11 pisos): caminos → agenda (DNS) → repartir la cola (balanceador) → máquina → cajón → partir → jefe → cajas → jefe de las cajas (K8s) → libreta → nube.
  - **Partida 2 · Los ayudantes** (6): buzón (mensajería), portero (firewall), vigilante (monitorización), copia de seguridad, instrucciones (IaC/Terraform) y cadena de montaje (CI/CD).
- ✅ En la partida 2 la torre se muestra **entera y atenuada** de fondo: el niño ve sobre qué está trabajando aunque juegue otro día.
- ✅ Los ayudantes se dibujan **aparte y con borde discontinuo**: misma distinción visual que pila vs. transversales en la app de adultos, sin usar la palabra.
- ✅ **Tres opciones como máximo** y una sola decisión por pantalla (memoria de trabajo corta).
- ✅ Cada capa entra por una **analogía concreta**, no por su definición técnica.
- ✅ **El error no castiga**: sin rojo, sin puntuación; la opción tocada dice qué es de verdad y da una pista visual.
- ✅ La **familia se revela al responder**, no antes: así hay algo que recordar.
- ✅ **Torre que crece** y no se borra, con bloques estilo Scratch; al final queda el stack entero a la vista.
- ✅ Guía («Bit») presente toda la partida, estrellas de progreso y puente final al Mapa real.
- Pendiente si se quiere: voz en off o lectura en alto, y más rutas (una de seguridad, otra de datos).

### ✅ Hecho — contenido fuera de la lógica
- ✅ **139 KB de contenido** salen a `contenido/*.js`: piezas y fichas, pedagogía por capa, textos ES/EN, retos e incidentes, y los pasos de Kids. El fichero principal baja de **499 a 377 KB**.
- ✅ Son **ficheros de datos, no de código**: un docente añade una pieza o cambia un texto sin abrir la lógica.
- ✅ Se cargan con `<script src>`, **no con `fetch`**: la app sigue abriéndose con doble clic, sin servidor.
- ✅ Si falta un fichero, avisa en consola con un mensaje claro en vez de quedarse en blanco.
- ✅ Verificado comparando **método a método contra el original**: contenido idéntico byte a byte en ES y EN.

### ✅ Hecho — modo Puesto (guardia con tickets)
- ✅ **Cuatro terminales a la vez**, una por equipo (fw01, sw-core, web01, db01), con su prompt y su color. Historial independiente por sesión.
- ✅ **Cola de 5 tickets** con remitente, prioridad y texto de usuario real, y flujo investigar → causa → arreglo con aprendizaje al cerrar.
- ✅ La gracia didáctica: **el mismo comando contesta distinto según el equipo**. Hay que elegir dónde mirar, no sólo qué escribir. Cada ticket trae falsas pistas que descartan cosas.
- ✅ Reutiliza `execCmd` (los ~148 comandos) pasándole la sesión; no hay un segundo intérprete.
- ✅ **Los equipos salen del stack que has montado**: el nombre y la etiqueta vienen de la pieza que pusiste (Vault → `vault01`, Windows → `win01`, Redis → `cache01`). Lo que no hayas montado se queda como equipo de ejemplo, marcado.
- ✅ **Tab autocompleta** y **`man`** funcionan también en el puesto, por sesión.
- ✅ **12 tickets** cubriendo el trabajo real: 502, firewall, puertos de switch, disco, VPN, certificado caducado, bucle de capa 2, muerte por memoria, DNS interno, copia que nunca se restauró, IP duplicada y RAID degradado.

### ✅ Hecho — consola de eventos (OBM) + capa ITSM
- ✅ **Consola de eventos** con gravedad, equipo, origen, estado y filtros. 17 eventos: causas, síntomas correlados y ruido.
- ✅ **Correlación de verdad**: los síntomas cuelgan de su causa, se agrupan en la lista y reconocer o cerrar la causa se los lleva.
- ✅ **El ruido no abre incidencia**: se reconoce y se cierra. Triar es la lección.
- ✅ **Puente evento → ticket**: «Crear incidencia» abre el ticket correspondiente en el Puesto y lo anota en el histórico.
- ✅ **Capa ITSM** en el ticket: estado (Nuevo/En curso/Resuelto/Cerrado), prioridad **derivada de impacto × urgencia** (P1–P4) con su SLA, asignación e **histórico** de todo lo que has hecho.

### ✅ Hecho — el Puesto guía sin dar la respuesta
- ✅ Cada comando sugerido lleva **qué te dice** (`contenido/comandos.js`, 38 entradas por prefijo): «ss -lntp → quién está escuchando y en qué puerto; si algo no arranca, mira si el puerto ya está cogido».
- ✅ La lista avisa de **en qué sesión va a escribir**, para que pinchar no caiga en la máquina equivocada sin querer.
- ✅ El comando correcto en el equipo equivocado **avisa de que en otro sí cuenta algo** — sin decir en cuál. Deja de ser un callejón sin salida y sigue habiendo que elegir.

### ✅ Hecho — el Puesto es coherente tras resolver
- ✅ Al resolver un ticket, **los mismos comandos contestan sanos**: nginx arranca, el 200 OK vuelve, el espejo sale `[UU]`, el disco baja al 31%. 34 evidencias con su versión «ya arreglado».
- ✅ Las que sólo servían para **descartar no cambian**: ya estaban bien antes y siguen igual.
- ✅ Regla de contenido que lo impide en el futuro: una evidencia con línea de error sin su versión sana rompe el test.

### ✅ Hecho — consolidación
- ✅ **Los modos nuevos cuentan para el progreso**: 4 logros (de guardia, veterano, buen ojo, torre en pie) y 2 pasos más en la ruta, que se marcan solos al trabajar.
- ✅ **Se guarda lo que cuesta rehacer**: tickets resueltos y eventos cerrados sobreviven a recargar. Kids no, a propósito.
- ✅ **Accesibilidad en los tres modos nuevos**: regiones con nombre, cada terminal y su salida etiquetadas, filas de evento y filtros con descripción, progreso de Kids anunciado y respuestas como región viva.
- ✅ **`npm test`**: las cinco comprobaciones de una vez, con la salida entera de la que falle.
- ✅ **Fase 3, sistema visual**: 30 tamaños de letra → 11, 22 radios → 5, fuera la rejilla animada y los degradados de fondo, y la cabecera respeta el tema.

### ✅ Hecho — funciona sin internet
- ✅ **React, fuentes y confeti dentro del repo** (`vendor/`, 516 KB). La app arranca con doble clic y sin conexión.
- ✅ Las fuentes van con el **subconjunto latino** (8 ficheros, 328 KB): cubre español e inglés enteros.
- ✅ De paso, **arreglado el confeti**: la URL del CDN apuntaba a un fichero que no existe en esa versión, así que no había saltado nunca.
- ✅ Comprobado tumbando todo el DNS: arranca, se ve igual y no queda ni un error de red.
- Pendiente si se quiere: **PWA instalable** (service worker + manifest) para que desde GitHub Pages quede offline tras la primera visita.

### ✅ Hecho — Puesto Linux: réplica de un puesto real (`puesto-linux/`)
- ✅ App aparte, enlazada desde la portada: **12 nodos simulados** (OpenStack + Ceph + bastión + monitorización) con estado que cambia con el tiempo.
- ✅ **20 tickets** ligados a las cuatro funciones de la oferta: OSD caído, cuota, proyecto con usuario y rol, "No valid host", disco lleno por RabbitMQ en debug, reloj desincronizado, OSD casi lleno, certificado de la API caducado, nodo de Galera caído (y el split-brain como trampa), parche de kernel con `noout`, disco muerto con un `noout` olvidado, puerto 22 abierto fuera de Terraform, alta de un hipervisor, vaciado de un hipervisor con migración en vivo, monitores de Ceph sin quórum (con un fallo latente de tres días), VMs sin red por Open vSwitch caído, restauración de una VM borrada desde la copia nocturna, volumen de Cinder atascado en «deleting», fuga de memoria de nova-api (instalado no es corriendo) y monitor de Ceph con el disco lleno por un nivel de debug olvidado en la configuración central.
- ✅ Se resuelven **con comandos**; se comprueba el estado, no el camino. Las **buenas prácticas** se deducen del registro de comandos.
- ✅ ITSM: prioridad por impacto × urgencia, **SLA desde la apertura del ticket**, estados, registro de trabajo e **informe .md** con la cronología.
- ✅ Modos **Guardia** (sólo alertas) y **Laboratorio libre**.
- ✅ **Catálogo de averías** (fase 1 del generador): 14 tipos que rompen + 6 condiciones; los 20 tickets reescritos sobre él, sin código propio. Las averías se propagan (sin libvirt cae nova-compute) y el test comprueba que cada una se arregla sola, que encadenar arreglos resuelve cada ticket y que una combinación inventada también se resuelve.
- ✅ **Incidencias en fichero** (fase 2): formato `puesto-incidencia/1`, importar desde la cola (botón o arrastrar), validador que ensaya la solución antes de aceptar, exportar cualquier ticket como plantilla, catálogo legible en la propia cola y validador por línea de comandos (`npm run validar`).
- ✅ **Guardia generada y caos** (fase 3): 15 familias de averías coherentes, tres niveles, semilla reproducible, ensayo antes de jugar, descarga como incidencia; caos programado en el laboratorio libre con comprobación y revelado.
- ✅ **Compositor** (fase 4): `compositor.html`, un formulario sobre el catálogo (cada campo sale del esquema `P.camposAveria`), con ensayo en vivo (alertas, lo que hay que dejar arreglado, pistas, solución de referencia, prioridad y SLA). Parte de cero, de un ticket, de una importada, de una guardia generada o de un fichero; guarda en la cola, abre el ticket en el puesto o descarga el `.json`.
- ✅ **En inglés**: todo el Puesto (interfaz, 20 tickets, catálogo, guardias, solucionario y glosario, RUNBOOK y playbooks, validador y compositor) con botón EN/ES y `?lang=en`; LabStack lo abre en su mismo idioma. `ingles-test.js` falla si queda algo en español y resuelve los 20 tickets en inglés.

### Puesto Cloud (`puesto-cloud/`)

- ✅ **Fase 1**: cuenta de AWS simulada (VPC, subredes, rutas, NAT, security groups, EC2, EBS, snapshots, alarmas de CloudWatch) sobre el motor y la interfaz del Puesto Linux, CLI `aws` con JSON / text / table, `--filters` y `--query` (JMESPath), y 5 tickets en dos idiomas, con su batería de pruebas.
- Siguiente: **fase 2** IAM (usuarios, roles, políticas, `AccessDenied`), S3 (buckets, versionado, el bucket público por error), balanceador y Auto Scaling · **fase 3** RDS, coste y Terraform contra la nube simulada, guardias y caos · **fase 4** catálogo de averías y compositor, como en el Puesto Linux.
- ✅ **Solucionario** (adelantado de la fase 4): los 5 tickets paso a paso con la salida real y un glosario de 26 términos de AWS, sobre el mismo motor de página que el del Puesto Linux.
- ✅ **Solucionario** con la salida real de cada paso (generada por el simulador) y glosario de 59 términos.
- ✅ `puesto-test.js`: cada guion de referencia resuelve su ticket y cumple sus prácticas; cada arreglo a medias lo deja abierto; determinismo y mecánica.
- Pendiente si se quiere: versión en inglés; más tickets (migración en frío que falla por cuota, clave SSH comprometida que hay que rotar en la flota, snapshot de Ceph que llena un pool); guardar la sesión a medias; que el profesor cargue sus propios escenarios.

### Corto plazo (alto valor, bajo esfuerzo)

- ⭐ **Glosario / índice buscable** de términos con enlaces cruzados.
- **Tooltips enriquecidos al pasar el ratón** (mini-ficha sin clic) en paleta y mapa.
- **Undo / redo** al montar el stack.
- **Más misiones**: migración a la nube, big data / analítica, IoT-edge, recuperación ante desastres (DR).
- **Rutas de aprendizaje**: encadenar misiones + teoría en un currículum con progreso.


### Medio plazo (mejoras de producto)
- ⭐ **Modo profesor**: crear/editar misiones propias y **exportar/importar stacks como archivo** `.json`.
- **Minimapa** y **niveles de detalle (LOD)** en el mapa al hacer zoom (agrupar al alejar).
- **Pipes y redirección** en la terminal (`ls | grep`, `echo x > file`) — sube el realismo.
- **Comparador de arquitecturas** lado a lado (on-prem vs cloud) con sus notas del linter.
- **Simulador de costes más fino**: región, reservado vs on-demand, egress.
- **Accesibilidad**: navegación por teclado, roles ARIA, modo alto contraste, foco visible.
- **Responsive / móvil**: la app está pensada para escritorio; pulir tablets/móvil.

### Largo plazo (requiere backend o esfuerzo grande)
- **Backend opcional** para guardar/compartir sin depender del archivo local, y **progreso de alumnos** para el docente.
- **Multiusuario / salas** (un profe reparte un reto, ve resultados en vivo).
- **Modo examen / certificación** con puntuación global y diploma.
- **Modelo de rendimiento realista** (cuellos de botella reales, no aditivo) para el dashboard.
- ✅ HECHO **Escenarios de incidente guiados** (runbooks: "el servicio cae, diagnostica y arregla") — modo **Incidente** con 3 escenarios. Ampliable con más casos.

### Deuda técnica / mantenimiento
- **Versionado del formato de guardado** en `localStorage` (migraciones si cambia el esquema).
- **Rendimiento**: revisar el re-render en cada tecleo de inputs (buscador, terminal) — memoizar si hace falta.
- El archivo crece mucho; valorar **partir contenido/lógica** (ligado a "externalizar a JSON").

---

## 4. Ideas que creo que le faltan (mi recomendación)

1. **Contenido en datos, no en código** — es el desbloqueador nº 1: permite crecer sin miedo y abre la puerta al "modo profesor".
2. **Rutas de aprendizaje** — hoy hay piezas sueltas y misiones; falta el hilo pedagógico que lleve al alumno de 0 a experto en orden.
3. **Glosario** — un sitio único donde buscar cualquier término y saltar a su ficha.
4. **Exportar/importar stacks como archivo** — más robusto que la URL para el aula, y sin backend.
5. **Accesibilidad y móvil** — para que sea usable por todos y en cualquier dispositivo.

---

## 5. Restricciones a tener presentes
- **Sin backend** hoy: todo es client-side. Compartir por URL es pleno solo si la app está **hospedada** (GitHub Pages, etc.), no en `file://`.
- **Requiere internet** para cargar React (y el confeti) desde CDN.
- El **runtime no admite ternarios/operadores** dentro de `{{ }}`: todo estilo/valor se precomputa en `renderVals()`.
- Los simuladores (terminal, métricas, chaos) son **modelos educativos**, no ejecución/medición real.
