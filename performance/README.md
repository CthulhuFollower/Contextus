# Rendimiento

Esta carpeta contiene experimentos reproducibles para medir Contextus antes de
optimizarlo. No forma parte del app shell ni modifica el comportamiento de
produccion.

Estado consolidado actual:

```text
alcance congelado: PERF-010B2A
siguiente experimento propuesto: PERF-010B2B, no iniciado
```

Antes de continuar desde una conversacion o sesion nueva:

- Leer `HANDOFF.md` para conocer arquitectura, invariantes y siguiente objetivo.
- Leer `results/README.md` para conocer la politica de resultados generados.
- Consultar `observations.md` para decisiones y `methodology.md` para protocolo.

## Ejecutar La Linea Base

```powershell
node --expose-gc performance/benchmark-runner.js
```

El comando mide universos de 1,000, 10,000 y 50,000 nodos con notas de 100
caracteres y escribe el resultado crudo en `performance/results/baseline.json`.

Opciones utiles:

```powershell
node --expose-gc performance/benchmark-runner.js --sizes=1000,10000 --note-size=5000
node --expose-gc performance/benchmark-runner.js --max-work=300000000
node --expose-gc performance/benchmark-runner.js --output=performance/results/otra-maquina.json
```

Lee `methodology.md` antes de comparar resultados y registra las conclusiones
en `observations.md`.

## Ejecutar PERF-001

```powershell
node --expose-gc performance/perf-001-runner.js
```

Este experimento compara `nodes.find(...)` contra `nodesById.get(...)`, mide el
costo de reconstruir el indice, su memoria aproximada y el efecto aislado sobre
`drawLinks()`.

## Ejecutar PERF-002

```powershell
node --expose-gc performance/perf-002-runner.js
```

Este experimento compara `nodes.filter(...)` contra `childrenByParentId`, mide
recorridos de descendientes, eliminacion de subarboles, reconstruccion y memoria.

## Ejecutar PERF-003

```powershell
node --expose-gc performance/perf-003-runner.js
```

Este experimento compara miles de eliminaciones con `splice()`, compactacion
estable en lote y la estrategia híbrida adoptada para hojas y subarboles
pequeños, medianos y grandes.

## Ejecutar PERF-004

Linea base del motor y clonados en Node:

```powershell
node --expose-gc performance/perf-004-runner.js
```

Linea base de IndexedDB y respuesta real de la UI:

```powershell
py -m http.server 8765 --bind 127.0.0.1
```

Despues, abrir:

```text
http://127.0.0.1:8765/performance/perf-004-browser.html
```

El laboratorio acepta `sizes` y `scenarios` en la URL. Por ejemplo:

```text
http://127.0.0.1:8765/performance/perf-004-browser.html?sizes=10000&scenarios=edit-text,delete-large
```

Salidas locales esperadas:

- `performance/results/perf-004-node.json`
- `performance/results/perf-004-browser.json`

## Ejecutar PERF-005

Comparacion de persistencia incremental y costo de checkpoints en Node:

```powershell
node --expose-gc performance/perf-005-runner.js
```

Desde un servidor local sin un service worker antiguo registrado, abrir:

```text
http://127.0.0.1:8766/performance/perf-005-browser.html
http://127.0.0.1:8766/performance/perf-005-recovery-browser.html
```

La primera pagina mide commits incrementales, respuesta UI y checkpoints. La
segunda verifica recuperacion real con IndexedDB y adopcion automatica de v2.

Salidas locales esperadas:

- `performance/results/perf-005-node.json`
- `performance/results/perf-005-browser.json`

## Ejecutar PERF-006

Comparacion entre aplicacion pura y mutable, commits y memoria en Node:

```powershell
node --expose-gc performance/perf-006-runner.js
```

Medicion de aplicacion, commit y respuesta UI en un origen local limpio:

```text
http://127.0.0.1:8767/performance/perf-006-browser.html
```

Salidas locales esperadas:

- `performance/results/perf-006-node.json`
- `performance/results/perf-006-browser.json`

## Ejecutar PERF-007A

Comparacion de la ruta anterior contra el contrato que omite persistencia
privada en cambios exclusivamente compartidos:

```powershell
node --expose-gc performance/perf-007a-runner.js
```

Medicion de commit, bytes privados y respuesta UI en navegador:

```text
http://127.0.0.1:8768/performance/perf-007a-browser.html
```

Salidas locales esperadas:

- `performance/results/perf-007a-node.json`
- `performance/results/perf-007a-browser.json`

## Ejecutar PERF-007C

Comparacion entre la ruta con captura completa y la ruta rapida construida
directamente desde el delta:

```powershell
node --expose-gc performance/perf-007c-runner.js
```

Medicion de commit y respuesta UI en navegador:

```text
http://127.0.0.1:8769/performance/perf-007c-browser.html
```

Salidas locales esperadas:

- `performance/results/perf-007c-node.json`
- `performance/results/perf-007c-browser.json`

## Ejecutar PERF-007B

Comparacion entre guardar el `DeviceSnapshot` completo y persistir parches
privados incrementales:

```powershell
node --expose-gc performance/perf-007b-runner.js
```

Medicion de commit, respuesta UI y crecimiento de 1,000 parches en navegador:

```text
http://127.0.0.1:8771/performance/perf-007b-browser.html
http://127.0.0.1:8771/performance/perf-007b-recovery-browser.html
```

La segunda pagina verifica adopcion de IndexedDB v3 a v4, atomicidad, replay
exacto tras reinicio y establecimiento de una nueva base privada mediante un
guardado completo existente.

Salidas locales esperadas:

- `performance/results/perf-007b-node.json`
- `performance/results/perf-007b-browser.json`

## Ejecutar PERF-008A

Medicion de reemplazos coalescidos y crecimiento estructural en Node:

```powershell
node --expose-gc performance/perf-008a-runner.js
```

Medicion con IndexedDB real y verificacion de migracion v4 a v5:

```text
http://127.0.0.1:8772/performance/perf-008a-browser.html
http://127.0.0.1:8772/performance/perf-008a-recovery-browser.html
```

La pagina de recuperacion crea un log append-only compatible con PERF-007B,
actualiza la base, verifica el ultimo valor por clave y aborta un reemplazo para
comprobar que parche y cabecera anteriores permanecen intactos.

Salidas locales esperadas:

- `performance/results/perf-008a-node.json`
- `performance/results/perf-008a-browser.json`

## Ejecutar PERF-009

Linea base aislada de motor, materializacion e indices en Node:

```powershell
node --expose-gc performance/perf-009-runner.js
```

Linea base de arranque completo con la aplicacion real:

```powershell
node performance/perf-009-server.mjs --port=8773
```

Despues, abrir:

```text
http://127.0.0.1:8773/performance/perf-009-browser.html?report=1
```

El laboratorio desregistra service workers del origen de medicion, usa bases
IndexedDB temporales, abre `index.html` en un iframe visible y guarda el reporte
automaticamente. Conviene ejecutarlo en un puerto dedicado porque mide el
primer frame y el tiempo hasta que la UI vuelve a recibir otro frame.

Escenarios:

- `clean`: checkpoint sin logs pendientes.
- `pending-shared`: checkpoint con 200 operaciones compartidas pendientes.
- `structural-private`: ultimo parche privado por clave estructural.

Topologias:

- `single-map`: todos los nodos dentro del mapa activo.
- `many-maps`: el mismo total repartido entre mapas menores.

Salidas locales esperadas:

- `performance/results/perf-009-node.json`
- `performance/results/perf-009-browser.json`

## Ejecutar PERF-010A1

Clasificacion lineal aislada para 1,000, 10,000 y 50,000 nodos:

```powershell
node --expose-gc performance/perf-010a1-runner.js
```

Medicion del primer frame real de un mapa activo de 50,000 nodos:

```powershell
node performance/perf-server.mjs --port 8779 --output performance/results/perf-010a1-browser.json
```

Despues, abrir:

```text
http://127.0.0.1:8779/performance/perf-010a1-browser.html?sizes=50000&cameras=normal,dense,zoom-out,empty&modes=baseline,culled&report=1
```

El laboratorio desregistra service workers, usa bases IndexedDB temporales,
mantiene el iframe visible, desactiva solamente el WebGL de la estrella central
y espera dos frames entre muestras. Esto aisla el costo Canvas del mapa mental
sin cambiar la aplicacion normal.

Salidas locales esperadas:

- `performance/results/perf-010a1-node.json`
- `performance/results/perf-010a1-browser.json`

## Ejecutar PERF-010B0

Diagnostico detallado de los enlaces que sobreviven a PERF-010A1:

```powershell
node performance/perf-server.mjs --port 8783 --output performance/results/perf-010b0-browser.json
```

Despues, abrir:

```text
http://127.0.0.1:8783/performance/perf-010b0-browser.html?sizes=50000&cameras=normal,dense,zoom-out,empty&report=1
```

El diagnostico se importa y ejecuta solamente dentro del perfil B0. La prueba
de interseccion de la polilinea ocurre despues de generar la geometria actual y
no cambia que enlaces se dibujan.

Resultado oficial:

- `performance/results/perf-010b0-browser.json`

## Ejecutar PERF-010B1

Comparacion productiva entre el bounding box de A1 y una segunda prueba
segmentaria conservadora antes de generar la curva:

```powershell
node performance/perf-server.mjs --port 8786 --output performance/results/perf-010b1-browser.json
```

Despues, abrir:

```text
http://127.0.0.1:8786/performance/perf-010b1-browser.html?sizes=50000&cameras=normal,dense,zoom-out,empty&modes=a1,b1&report=1
```

El modo `a1` desactiva explicitamente `perfLinkSegmentCulling`; el modo `b1`
lo activa. Ambos conservan la misma ruta de culling A1, fixture, camara y
geometria productiva. B1 solamente rechaza enlaces antes de generar puntos.

Resultado oficial:

- `performance/results/perf-010b1-browser.json`

## Ejecutar PERF-010B2A

Diagnostico de costo por enlace visible con B1 activo y ablaciones no
productivas:

```powershell
node performance/perf-server.mjs --port 8789 --output performance/results/perf-010b2a-browser.json
```

Despues, abrir:

```text
http://127.0.0.1:8789/performance/perf-010b2a-browser.html?sizes=50000&cameras=normal,dense,zoom-out&modes=current,points-only,path-no-stroke,straight,reduced-segments,uniform-batch,no-active&samples=3&report=1
```

El laboratorio rota deterministicamente el orden de los modos entre muestras
para reducir sesgo de calentamiento. Las variantes distintas de `current` son
instrumentos diagnosticos: alteran o eliminan dibujo y no deben activarse en
produccion.

Medicion focalizada usada para auditar los retrasos erraticos del siguiente
frame:

```text
http://127.0.0.1:8790/performance/perf-010b2a-browser.html?sizes=50000&cameras=dense&modes=current,reduced-segments,straight,uniform-batch&samples=5&report=1
```

Resultados:

- `performance/results/perf-010b2a-browser.json`
- `performance/results/perf-010b2a-dense-focus-browser.json`
