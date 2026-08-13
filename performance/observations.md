# Diario De Observaciones De Rendimiento

Este documento conserva las pruebas, resultados, interpretaciones y decisiones
de cada experimento. Los resultados crudos se generan localmente en
`performance/results/`, pero no se versionan. Las rutas citadas documentan el
destino esperado de cada runner.

## Plantilla

### PERF-XXX: Nombre

- Fecha:
- Estado: propuesta | linea base | aceptado | descartado
- Observacion:
- Hipotesis:
- Cambio aislado:
- Datos y entorno:
- Resultados:
- Interpretacion:
- Decision:
- Riesgos o preguntas pendientes:

## PERF-000: Linea Base De Arreglos

- Fecha: 2026-06-10
- Estado: linea base
- Observacion: las rutas centrales buscan nodos, hijos y mapas recorriendo
  arreglos completos. Algunas operaciones anidan estos recorridos.
- Hipotesis: el costo sera lineal para busquedas individuales y cuadrático para
  recorrer descendientes o dibujar enlaces a medida que crece el mapa.
- Cambio aislado: ninguno; esta prueba documenta el comportamiento previo a los
  indices.
- Datos y entorno:
  - Arbol balanceado de factor 4, con 1,000, 10,000 y 50,000 nodos.
  - Cada nodo contiene una nota de 100 caracteres.
  - Node v22.20.0, V8 12.4.254.21-node.33, Windows x64.
  - CPU AMD Ryzen 5 9600X 6-Core Processor.
  - Commit de referencia `a664c0ad96f0d2178c2643645da873d65583b6d8`.
  - El arbol de trabajo estaba modificado por la fase local de sincronizacion y
    por esta infraestructura.
  - Resultado crudo: `performance/results/baseline.json`.
- Resultados principales, tiempos en milisegundos:

| Operacion | p50 1k | p95 1k | p50 10k | p95 10k | 50k |
| --- | ---: | ---: | ---: | ---: | --- |
| Buscar nodo al final | 0.004 | 0.007 | 0.036 | 0.049 | 0.206 p50 |
| Buscar hijos | 0.004 | 0.008 | 0.043 | 0.053 | 0.217 p50 |
| Descendientes, balanceado | 4.470 | 6.646 | 182.901 | 187.351 | Protegida: 2,500 M comparaciones |
| Descendientes, cadena | 1.445 | 2.694 | 166.745 | 167.116 | Protegida: 2,500 M comparaciones |
| Dibujar enlaces | 4.680 | 6.797 | 74.953 | 77.583 | Protegida: 1,562.5 M comparaciones |
| Borrar primer subarbol | 1.717 | 1.751 | 86.787 | 109.095 | Protegida: 1,092.3 M comparaciones |
| Buscar mapa al final | 0.004 | 0.007 | 0.037 | 0.049 | 0.182 p50 |

- Crecimiento observado al pasar de 1,000 a 10,000 nodos:

| Operacion | Multiplicador p50 |
| --- | ---: |
| Buscar nodo | 9.1x |
| Buscar hijos | 10.0x |
| Descendientes, balanceado | 40.9x |
| Descendientes, cadena | 115.4x |
| Dibujar enlaces | 16.0x |
| Borrar primer subarbol | 50.6x |
| Buscar mapa | 9.7x |

- Tamaño y memoria aproximada:

| Nodos | JSON serializado | Heap adicional aproximado |
| ---: | ---: | ---: |
| 1,000 | 0.47 MiB | 0.59 MiB |
| 10,000 | 4.78 MiB | 5.37 MiB |
| 50,000 | 24.12 MiB | 23.81 MiB |

- Interpretacion:
  - Las busquedas individuales muestran crecimiento lineal. Todavia son rapidas
    en este equipo, pero se ejecutan muchas veces dentro de otras rutas.
  - Recorrer descendientes confirma comportamiento cuadrático. A 10,000 nodos
    ya bloquea el hilo principal aproximadamente entre 167 y 187 ms.
  - Dibujar enlaces supera ampliamente un cuadro de 16.7 ms a 10,000 nodos,
    incluso sin incluir rasterizacion real del navegador.
  - Borrar un subarbol grande tambien produce una pausa visible a 10,000 nodos.
  - Ejecutar los casos cuadráticos completos a 50,000 nodos excederia el
    presupuesto experimental sin añadir evidencia útil; las omisiones
    protegidas son fallos de escalabilidad documentados.
  - El tamaño base crece de forma aproximadamente lineal, pero 50,000 nodos con
    notas cortas ya representan 24.12 MiB antes de metadatos de sincronizacion,
    tombstones, recuperaciones y copias transitorias.
- Decision: usar esta medicion para evaluar PERF-001 (`nodesById`) y PERF-002
  (`childrenByParentId`) por separado.
- Riesgos o preguntas pendientes:
  - El contexto Canvas simulado no incluye rasterizacion real ni representa
    directamente el rendimiento movil.
  - `baseline-algorithms.js` replica las rutas actuales para aislarlas de DOM y
    Canvas. Debe permanecer congelado como referencia, salvo correcciones al
    propio metodo de medicion.
  - Falta medir perfiles reales del navegador y dispositivos modestos despues
    de que los indices reduzcan primero el costo algorítmico conocido.

## PERF-001: Indice `nodesById`

- Fecha: 2026-06-10
- Estado: aceptado
- Observacion: `getNodeById()` recorria el arreglo completo y `drawLinks()` lo
  invocaba dos veces por enlace.
- Hipotesis: mantener un `Map` derivado por ID reducira la busqueda de nodos de
  `O(N)` a `O(1)` y eliminara el componente cuadrático de `drawLinks()`, con un
  aumento de memoria y costo de reconstruccion moderados.
- Cambio aislado:
  - `nodes` permanece como fuente canónica.
  - `nodesById` existe solo en memoria y no se persiste ni sincroniza.
  - El indice se reconstruye al aplicar o cambiar de mapa.
  - La creacion y eliminacion de nodos actualizan el indice incrementalmente.
  - `getNodeById()` consulta `nodesById.get(id)`.
  - Se añadieron inspecciones y pruebas para detectar duplicados, referencias
    faltantes, obsoletas o distintas.
- Datos y entorno:
  - Mismos tamaños, forma de arbol, notas y equipo usados por PERF-000.
  - Resultados crudos: `performance/results/perf-001.json` y
    `performance/results/perf-001-repeat.json`.
  - Cada medicion compara el camino anterior y el indexado dentro del mismo
    proceso.
- Resultados principales, primera ejecucion:

| Operacion | 1k p50 | 10k p50 | 50k p50 |
| --- | ---: | ---: | ---: |
| Reconstruir `nodesById` | 0.039 ms | 0.343 ms | 2.041 ms |
| Buscar nodo, arreglo | 0.003898 ms | 0.005611 ms | 0.037664 ms |
| Buscar nodo, indice | 0.0000066 ms | 0.0000129 ms | 0.0000105 ms |
| Dibujar enlaces, arreglo | 4.345 ms | 72.766 ms | Protegida: 1,562.5 M comparaciones |
| Dibujar enlaces, indice | 3.666 ms | 37.513 ms | 215.199 ms |

- Repeticion de estabilidad:

| Operacion | 10k p50 | 50k p50 |
| --- | ---: | ---: |
| Reconstruir `nodesById` | 0.353 ms | 2.038 ms |
| Dibujar enlaces, arreglo | 72.479 ms | Protegida |
| Dibujar enlaces, indice | 37.281 ms | 188.695 ms |

- Memoria aproximada del indice:

| Nodos | Memoria adicional | Bytes por nodo |
| ---: | ---: | ---: |
| 1,000 | 0.023 MiB | 24.3 |
| 10,000 | 0.437 MiB | 45.9 |
| 50,000 | 1.750 MiB | 36.7 |

- Interpretacion:
  - A 10,000 nodos, `drawLinks()` mejora aproximadamente 48% y 1.94x.
  - El camino indexado permite medir 50,000 enlaces sin ejecutar mas de mil
    millones de comparaciones de busqueda.
  - La reconstruccion es lineal y barata: aproximadamente 2 ms p50 a 50,000
    nodos en este equipo.
  - La memoria adicional a 50,000 nodos es aproximadamente 1.75 MiB, cerca del
    7.4% del heap base medido en PERF-000.
  - En mapas pequeños la mejora es moderada porque domina la geometria de las
    curvas, no la busqueda de extremos.
  - PERF-001 elimina un componente cuadrático importante, pero el render sigue
    fuera del presupuesto de 16.7 ms a 10,000 y 50,000 enlaces. Será necesario
    estudiar renderizado/culling en un lote posterior.
- Decision: aceptar `nodesById` en produccion. Continuar con PERF-002
  (`childrenByParentId`) como experimento separado.
- Verificacion funcional:
  - 22 pruebas automatizadas superadas.
  - Creacion y borrado de nodos comprobados en navegador.
  - Creacion y entrada a un segundo mapa comprobadas en navegador.
  - Recarga normal y recarga completamente offline comprobadas sin errores de
    consola.
- Riesgos o preguntas pendientes:
  - El benchmark usa un contexto Canvas simulado y no incluye rasterizacion.
  - Los microtiempos de una sola consulta dependen fuertemente de JIT; la
    evidencia principal es el efecto sobre `drawLinks()` y su complejidad.
  - Los datos legacy con IDs duplicados conservan temporalmente el comportamiento
    previo de devolver la primera coincidencia, pero la inspeccion los marca como
    una violacion de integridad.

## PERF-002: Indice `childrenByParentId`

- Fecha: 2026-06-10
- Estado: aceptado
- Observacion: `getChildren()` recorria todos los nodos y `getDescendants()`
  repetia ese recorrido por cada nodo visitado. El borrado de subarboles dependia
  de ese recorrido cuadrático.
- Hipotesis: mantener un `Map` derivado de `parentId` a hijos reducira
  `getChildren()` a `O(1)` y el recorrido completo de descendientes a `O(N)`,
  con memoria y reconstruccion moderadas.
- Cambio aislado:
  - `nodes` permanece como fuente canónica.
  - `childrenByParentId` existe solo en memoria y no se persiste ni sincroniza.
  - Cada bucket conserva el mismo orden que devolvia `nodes.filter(...)`.
  - El indice se reconstruye al aplicar o cambiar de mapa.
  - Crear y borrar nodos actualiza el indice incrementalmente.
  - `getChildren()` y `getDescendants()` consultan el nuevo indice.
  - Se añadieron inspecciones para detectar buckets faltantes, obsoletos,
    reordenados o con referencias distintas.
- Datos y entorno:
  - Mismos tamaños, forma de arbol, notas y equipo usados por PERF-000.
  - La comparacion parte del estado posterior a PERF-001, por lo que ambos
    caminos de borrado ya utilizan `nodesById`.
  - Resultados crudos: `performance/results/perf-002.json` y
    `performance/results/perf-002-repeat.json`.
- Resultados principales, primera ejecucion:

| Operacion | 1k p50 | 10k p50 | 50k p50 |
| --- | ---: | ---: | ---: |
| Reconstruir `childrenByParentId` | 0.058 ms | 0.241 ms | 0.842 ms |
| Buscar hijos, arreglo | 0.004226 ms | 0.042739 ms | 0.222951 ms |
| Buscar hijos, indice | 0.0000072 ms | 0.0000082 ms | 0.0000080 ms |
| Descendientes balanceados, arreglo | 4.507 ms | 150.415 ms | Protegida: 2,500 M comparaciones |
| Descendientes balanceados, indice | 0.070 ms | 0.286 ms | 1.710 ms |
| Descendientes en cadena, arreglo | 1.353 ms | 146.575 ms | Protegida: 2,500 M comparaciones |
| Descendientes en cadena, indice | 0.055 ms | 0.261 ms | 1.683 ms |
| Borrar primer subarbol, arreglo | 1.712 ms | 85.034 ms | Protegida: 1,092.3 M comparaciones |
| Borrar primer subarbol, indice | 0.211 ms | 2.187 ms | 867.766 ms |

- Repeticion de estabilidad:

| Operacion | 10k p50 | 50k p50 |
| --- | ---: | ---: |
| Reconstruir `childrenByParentId` | 0.247 ms | 0.947 ms |
| Descendientes balanceados, indice | 0.357 ms | 1.995 ms |
| Descendientes en cadena, indice | 0.260 ms | 1.934 ms |
| Borrar primer subarbol, indice | 2.157 ms | 884.182 ms |

- Mejoras observadas a 10,000 nodos:

| Operacion | Aceleracion p50 |
| --- | ---: |
| Descendientes balanceados | 525.6x |
| Descendientes en cadena | 560.9x |
| Borrar primer subarbol | 38.9x |

- Memoria aproximada del indice:

| Nodos | Memoria adicional | Bytes por nodo |
| ---: | ---: | ---: |
| 1,000 | 0.050 MiB | 52.7 |
| 10,000 | 0.586 MiB | 61.4 |
| 50,000 | 2.821 MiB | 59.2 |

- Interpretacion:
  - `getChildren()` deja de crecer con el total de nodos.
  - Recorrer 50,000 descendientes completos ahora tarda aproximadamente entre
    1.7 y 2.0 ms p50, frente a un camino anterior protegido por estimar 2,500
    millones de comparaciones.
  - La reconstruccion es lineal y cuesta menos de 1 ms p50 a 50,000 nodos.
  - `childrenByParentId` usa aproximadamente 2.82 MiB a 50,000 nodos. Sumado a
    `nodesById`, ambos indices representan aproximadamente 4.57 MiB o 19% del
    heap base medido en PERF-000.
  - A 10,000 nodos, borrar un subarbol mejora de forma importante y queda cerca
    de 2 ms.
  - A 50,000 nodos, encontrar el subarbol tarda cerca de 2 ms, pero borrarlo
    tarda entre 0.87 y 0.88 segundos p50 y supera un segundo p95. El cuello de
    botella restante son los filtros y miles de `splice()` sobre arreglos, no el
    recorrido del arbol.
- Decision: aceptar `childrenByParentId` en produccion. No optimizar el borrado
  por lote dentro de PERF-002; registrarlo como experimento posterior separado.
- Verificacion funcional:
  - 27 pruebas automatizadas superadas.
  - Creacion de relaciones padre-hijo y borrado comprobados en navegador.
  - Creacion y entrada a otro mapa comprobadas en navegador.
  - Recarga normal y recarga completamente offline comprobadas sin errores.
- Riesgos o preguntas pendientes:
  - Los buckets del indice son estructuras internas y los consumidores no deben
    mutarlos.
  - La memoria depende de la forma del arbol; una cadena profunda crea muchos
    buckets pequeños y puede costar mas que el arbol balanceado medido.
  - Debe medirse por separado reemplazar eliminaciones repetidas con
    reconstruccion/filtrado en lote, conservando orden e invariantes.

## PERF-003: Eliminacion De Subarboles En Lote

- Fecha: 2026-06-10
- Estado: aceptado
- Observacion: despues de PERF-002, encontrar un subarbol de 50,000 nodos tarda
  cerca de 2 ms, pero eliminar subarboles grandes todavía podia tardar cerca de
  un segundo por ejecutar miles de `splice()` y actualizaciones incrementales.
- Hipotesis: compactar `nodes` y `links` una sola vez y reconstruir ambos indices
  reducira el borrado grande a `O(N + E)`. Para no penalizar hojas, una estrategia
  híbrida debe conservar el camino incremental en borrados pequeños.
- Cambio aislado:
  - Se añadió compactacion estable en el mismo arreglo mediante dos punteros.
  - `nodes` y `links` conservan identidad y orden relativo de supervivientes.
  - La compactacion reconstruye `nodesById` y `childrenByParentId` una sola vez.
  - La estrategia adoptada usa eliminacion incremental para menos de 128 nodos y
    compactacion en lote desde 128 nodos.
  - El umbral es una constante explicita y comprobada por pruebas.
  - Persistencia, sincronizacion y formato de datos no cambiaron.
- Datos y entorno:
  - Mismos tamaños, notas y equipo usados por experimentos anteriores.
  - Escenarios medidos: hoja, subarbol cercano al 1%, cercano al 25% y cercano
    al 50%.
  - Resultados crudos: `performance/results/perf-003.json` y
    `performance/results/perf-003-repeat.json`.
- Tamaños reales de los escenarios a 50,000 nodos:

| Escenario | Nodos eliminados | Porcentaje |
| --- | ---: | ---: |
| Hoja | 1 | 0.002% |
| Cercano al 1% | 341 | 0.682% |
| Mediano | 17,232 | 34.464% |
| Grande | 32,767 | 65.534% |

- Resultados principales a 50,000 nodos:

| Escenario | PERF-002 p50 | Estrategia adoptada p50 | Adoptada p95 | Aceleracion |
| --- | ---: | ---: | ---: | ---: |
| Hoja | 1.525 ms | 1.503 ms | 1.511 ms | 1.0x |
| Cercano al 1% | 56.633 ms | 8.276 ms | 9.049 ms | 6.8x |
| Mediano | 472.121 ms | 7.991 ms | 9.309 ms | 59.1x |
| Grande | 225.280 ms | 10.765 ms | 10.948 ms | 20.9x |

- Repeticion de estabilidad a 50,000 nodos:

| Escenario | PERF-002 p50 | Estrategia adoptada p50 | Adoptada p95 |
| --- | ---: | ---: | ---: |
| Hoja | 1.463 ms | 1.410 ms | 1.566 ms |
| Cercano al 1% | 54.802 ms | 6.422 ms | 8.026 ms |
| Mediano | 461.796 ms | 5.572 ms | 7.703 ms |
| Grande | 204.759 ms | 9.759 ms | 9.782 ms |

- Comportamiento a 10,000 nodos:
  - Hojas y subarboles de 85 nodos permanecen en el camino incremental y tardan
    aproximadamente entre 0.35 y 0.72 ms p50.
  - Subarboles medianos y grandes usan lote y tardan aproximadamente entre 1.1
    y 1.2 ms p50.
- Memoria aproximada a 50,000 nodos:
  - El camino incremental de una hoja genera aproximadamente 0.004 MiB
    transitorios; aplicar lote siempre generaria aproximadamente 7 MiB.
  - La estrategia híbrida protege ese caso y permanece cerca de 0.005 MiB.
  - En borrados desde 341 nodos, reconstruir indices genera aproximadamente
    entre 9 y 15 MiB transitorios según el tamaño del subarbol.
  - Despues de GC no se observa memoria adicional retenida. Los valores son una
    aproximacion de Node y deben validarse posteriormente en navegador/movil.
- Interpretacion:
  - Usar compactacion siempre perjudicaria hojas en mapas grandes; la estrategia
    híbrida evita esa regresion.
  - Desde 341 eliminaciones en el universo de 50,000 nodos, lote reduce de forma
    clara el tiempo total.
  - Los borrados medianos y grandes quedan debajo del objetivo de 30 ms p95 y,
    en estas mediciones, tambien debajo de un cuadro de 16.7 ms.
  - PERF-003 elimina el cuello de botella cuadrático por desplazamientos
    repetidos sin cambiar contratos visibles.
- Decision: aceptar la estrategia híbrida con umbral inicial de 128 nodos.
  Mantener el umbral documentado y volver a medirlo si cambia la estructura de
  indices o aparecen datos reales que justifiquen ajustarlo.
- Verificacion funcional:
  - 32 pruebas automatizadas superadas.
  - Creacion y borrado de nodos comprobados en navegador.
  - Apertura de constelacion y creacion de mapa comprobadas en navegador.
  - Recarga normal y recarga completamente offline comprobadas sin errores.
- Riesgos o preguntas pendientes:
  - La reconstruccion en lote crea presión transitoria de memoria.
  - El costo depende de la distribucion de supervivientes dentro de los arreglos;
    por eso el benchmark conserva varios tamaños de subarbol.
  - Aún falta medir la duración completa del commit/persistencia que ocurre
    despues del borrado; PERF-003 aisla las colecciones en memoria.

## PERF-004: Linea Base De Commit, Persistencia Y Respuesta UI

- Fecha: 2026-06-10
- Estado: linea base
- Observacion: PERF-003 redujo el borrado de colecciones en memoria, pero no
  media el trabajo posterior de captura, sincronizacion, persistencia ni el
  tiempo hasta que la interfaz vuelve a responder.
- Hipotesis: el commit actual crece con el universo completo incluso para una
  edicion pequena, porque captura, clona y persiste snapshots completos.
- Cambio aislado:
  - Se agrego instrumentacion; no se optimizo produccion.
  - Node mide clonados, motor de sincronizacion, stores en memoria,
    serializacion diagnostica y bytes representados.
  - El laboratorio de navegador mide el mismo recorrido con IndexedDB real,
    una tarea de UI programada al comenzar y el primer cuadro posterior.
  - Los escenarios son editar texto, mover, crear, borrar una hoja y borrar un
    subarbol grande.
- Datos y entorno:
  - Arbol balanceado de factor 4, notas de 100 caracteres y 1,000, 10,000 y
    50,000 nodos.
  - Node v22.20.0, Windows x64 y CPU AMD Ryzen 5 9600X 6-Core Processor.
  - Navegador Chromium 149, 12 hilos logicos reportados y 32 GiB de memoria
    reportada.
  - Resultados crudos: `performance/results/perf-004-node.json` y
    `performance/results/perf-004-browser.json`.
- Linea base Node, p50:

| Escenario | Commit 1k | Commit 10k | Commit 50k | Bytes 50k |
| --- | ---: | ---: | ---: | ---: |
| Editar texto | 15.63 ms | 100.84 ms | 557.07 ms | 18.02 MB |
| Mover nodo | 14.51 ms | 95.98 ms | 520.11 ms | 18.02 MB |
| Crear nodo | 11.77 ms | 100.85 ms | 523.48 ms | 18.02 MB |
| Borrar hoja | 8.97 ms | 106.31 ms | 522.11 ms | 18.02 MB |
| Borrar subarbol grande | 9.62 ms | 209.09 ms | 1,399.34 ms | 24.52 MB |

- Linea base de navegador, p50:

| Nodos | Escenario | Commit completo | UI responde | Cuadro post-commit | Bytes |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1,000 | Editar texto | 6.8 ms | 5.0 ms | 17.0 ms | 0.35 MB |
| 1,000 | Borrar subarbol grande | 7.9 ms | 5.5 ms | 19.2 ms | 0.45 MB |
| 10,000 | Editar texto | 57.1 ms | 39.7 ms | 64.9 ms | 3.57 MB |
| 10,000 | Mover nodo | 48.4 ms | 30.6 ms | 56.1 ms | 3.57 MB |
| 10,000 | Crear nodo | 54.4 ms | 35.9 ms | 75.4 ms | 3.57 MB |
| 10,000 | Borrar hoja | 53.9 ms | 34.6 ms | 71.3 ms | 3.57 MB |
| 10,000 | Borrar subarbol grande | 184.0 ms | 143.3 ms | 196.1 ms | 5.18 MB |
| 50,000 | Editar texto | 327.8 ms | 225.6 ms | 369.3 ms | 18.02 MB |
| 50,000 | Mover nodo | 286.9 ms | 194.1 ms | 326.5 ms | 18.02 MB |
| 50,000 | Crear nodo | 368.0 ms | 255.8 ms | 418.1 ms | 18.02 MB |
| 50,000 | Borrar hoja | 322.4 ms | 218.8 ms | 366.1 ms | 18.02 MB |
| 50,000 | Borrar subarbol grande | 1,429.8 ms | 1,317.6 ms | 1,483.0 ms | 24.52 MB |

- Desglose representativo del navegador, p50:

| Caso | Captura compartida | Motor compartido | Escritura IndexedDB compartida | Guardado privado |
| --- | ---: | ---: | ---: | ---: |
| Editar texto, 10k | 16.4 ms | 29.8 ms | 19.7 ms | 9.5 ms |
| Editar texto, 50k | 82.6 ms | 156.7 ms | 97.7 ms | 61.7 ms |
| Borrar grande, 50k | 31.6 ms | 1,324.5 ms | 149.7 ms | 58.8 ms |

- Interpretacion:
  - El costo de un cambio pequeno crece aproximadamente con el total de nodos,
    no con el tamano del cambio. Una edicion de texto termina moviendo cerca de
    18 MB cuando existen 50,000 nodos.
  - IndexedDB es costoso, pero no es el unico cuello de botella. Captura,
    clonados internos, aplicacion del motor, devolucion de snapshots y guardado
    privado tambien crecen con el universo.
  - A 10,000 nodos, los cambios pequenos ya superan el presupuesto de un cuadro
    y retrasan la respuesta de UI entre 30 y 40 ms p50.
  - A 50,000 nodos, los cambios pequenos retrasan la respuesta de UI entre 194
    y 256 ms p50. Esto es perceptible aunque la operacion conceptual sea local.
  - PERF-003 dejo el borrado de colecciones grandes cerca de 10 ms, pero el
    commit posterior de ese borrado llega a 1.43 s en navegador. El cuello de
    botella dominante ya esta fuera de las colecciones del mapa mental.
  - Borrar un subarbol grande aumenta el snapshot compartido porque los
    tombstones conservan el contenido eliminado. En 50,000 nodos, el estado
    representado sube de unos 18.02 MB a 24.52 MB.
  - El commit puede seguir esperando IndexedDB mientras la tarea de UI ya tuvo
    oportunidad de ejecutarse. Por eso `UI responde` puede ser menor que
    `Commit completo`; ambas metricas describen problemas distintos.
- Decision: aceptar esta linea base como inicio del lote de persistencia y
  sincronizacion. No mezclar todavia varias optimizaciones. La siguiente
  hipotesis debe atacar un solo costo estructural y repetir exactamente estas
  mediciones.
- Riesgos o preguntas pendientes:
  - La captura de Node clona un workspace equivalente, pero no aisla
    `syncActiveMapInMemory()` de la aplicacion real.
  - La serializacion diagnostica se mide despues del commit y no forma parte de
    `Commit completo`; sus bytes aproximan JSON, no el formato interno exacto
    de IndexedDB.
  - El laboratorio no incluye DOM, Canvas ni interaccion humana real. Mide la
    ruta de commit y la disponibilidad del hilo principal.
  - `requestAnimationFrame` puede sufrir valores atipicos si el laboratorio
    queda en segundo plano. `UI responde` es la senal automatizada mas estable;
    los cuadros deben repetirse con la pestana visible antes de una decision
    centrada en renderizado.
  - A 50,000 nodos se usan dos muestras por escenario para limitar costo. Los
    cambios futuros deben repetir la prueba y comparar p50, p95 y distribucion.

## PERF-005: Persistencia Compartida Incremental

- Fecha: 2026-06-10
- Estado: aceptado
- Observacion: PERF-004 demostro que cada cambio compartido pequeno escribia un
  snapshot completo. A 50,000 nodos, editar texto escribia cerca de 17 MB y la
  escritura IndexedDB tardaba aproximadamente 98 ms p50.
- Hipotesis: guardar solamente la operacion y metadatos atomicos reducira los
  bytes y tiempo de IndexedDB a un costo proporcional al cambio. Los snapshots
  completos pueden reservarse para checkpoints ocasionales.
- Cambio aislado:
  - `commitShared()` ya no escribe el snapshot compartido completo.
  - La operacion se guarda junto con revision, secuencia, bytes y checkpoint
    padre dentro de una sola transaccion.
  - IndexedDB sube a version 3.
  - El arranque carga el checkpoint activo y reproduce operaciones pendientes.
  - Una base IndexedDB v2 se adopta automaticamente como checkpoint v3.
  - La compactacion publica primero el checkpoint y limpia operaciones despues.
  - Un corte entre publicacion y limpieza conserva operaciones redundantes que
    pueden reproducirse de forma idempotente.
  - Se conservan solamente el checkpoint dinamico activo y el inmediatamente
    anterior. `shared-current` permanece como respaldo temporal de adopcion.
  - El umbral usa bytes incrementales en memoria y deja de serializar toda la
    cola para decidir si debe compactar.
  - Guardado privado y clonados completos del motor no cambiaron.
- Datos y entorno:
  - Mismos tamaños, escenarios y equipo de PERF-004.
  - La prueba de navegador se ejecuto en un origen local limpio, sin un service
    worker antiguo controlando los modulos.
  - Resultados crudos: `performance/results/perf-005-node.json` y
    `performance/results/perf-005-browser.json`.
- Escritura compartida incremental en navegador, p50:

| Nodos | Escenario | PERF-004 snapshot | PERF-005 escritura | IndexedDB antes | IndexedDB despues |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1,000 | Editar texto | 335,648 B | 1,028 B | 2.3 ms | 0.8 ms |
| 10,000 | Editar texto | 3,376,807 B | 1,036 B | 19.7 ms | 0.9 ms |
| 50,000 | Editar texto | 16,992,575 B | 1,036 B | 97.7 ms | 0.9 ms |
| 50,000 | Mover nodo | 16,992,355 B | 932 B | 97.4 ms | 0.8 ms |
| 50,000 | Crear nodo | 16,993,401 B | 1,111 B | 108.6 ms | 1.0 ms |
| 50,000 | Borrar hoja | 16,992,436 B | 883 B | 99.6 ms | 1.0 ms |
| 50,000 | Borrar subarbol grande | 23,168,446 B | 322,703 B | 149.7 ms | 15.5 ms |

- Efecto en commit y respuesta UI de navegador, p50:

| Nodos | Escenario | Commit antes | Commit despues | Mejora | UI antes | UI despues | Mejora |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | Editar texto | 57.1 ms | 39.7 ms | 30.5% | 39.7 ms | 22.2 ms | 44.1% |
| 10,000 | Mover nodo | 48.4 ms | 32.5 ms | 32.9% | 30.6 ms | 15.8 ms | 48.4% |
| 50,000 | Editar texto | 327.8 ms | 221.8 ms | 32.3% | 225.6 ms | 141.7 ms | 37.2% |
| 50,000 | Mover nodo | 286.9 ms | 192.7 ms | 32.8% | 194.1 ms | 103.9 ms | 46.5% |
| 50,000 | Crear nodo | 368.0 ms | 221.8 ms | 39.7% | 255.8 ms | 135.1 ms | 47.2% |
| 50,000 | Borrar hoja | 322.4 ms | 197.5 ms | 38.7% | 218.8 ms | 109.5 ms | 50.0% |
| 50,000 | Borrar subarbol grande | 1,429.8 ms | 1,107.9 ms | 22.5% | 1,317.6 ms | 989.8 ms | 24.9% |

- Costo ocasional de checkpoint en navegador, p50:

| Nodos | Editar texto | Borrar subarbol grande |
| ---: | ---: | ---: |
| 1,000 | 7.1 ms | 6.7 ms |
| 10,000 | 49.1 ms | 72.5 ms |
| 50,000 | 239.3 ms | 357.4 ms |

- Recuperacion verificada:
  - Reinicio despues de guardar solamente una operacion.
  - Interrupcion simulada durante publicacion de checkpoint.
  - Reinicio despues de publicar y antes de limpiar operaciones.
  - Reinicio con operaciones pendientes posteriores a un checkpoint.
  - Operacion, revision, secuencia y checkpoint padre almacenados juntos.
  - Adopcion automatica de una base IndexedDB v2.
  - Reconstruccion exacta del snapshot compartido en todos los casos.
- Interpretacion:
  - Para editar, mover, crear y borrar una hoja, los bytes compartidos ya no
    crecen con el numero total de nodos. Permanecen cerca de 1 KB desde 1,000
    hasta 50,000 nodos.
  - Borrar un subarbol grande sigue generando una operacion grande porque
    contiene miles de IDs eliminados. Ese costo es proporcional al delta, no al
    snapshot completo, y debe estudiarse por separado.
  - IndexedDB deja de ser el costo dominante de los cambios pequeños. A 50,000
    nodos baja de aproximadamente 98-109 ms a cerca de 1 ms p50.
  - El commit completo y la respuesta UI mejoran claramente, pero siguen fuera
    de un presupuesto interactivo a 50,000 nodos. La mayor parte restante
    corresponde a captura, clonados, aplicacion y devolucion del snapshot.
  - Los checkpoints siguen siendo pausas grandes y deben ejecutarse de forma
    poco frecuente y, posteriormente, fuera de la ruta interactiva.
- Decision: aceptar PERF-005. La persistencia compartida incremental resuelve el
  costo estructural propuesto y conserva recuperacion ante cortes. El siguiente
  experimento debe atacar clonados completos del motor sin mezclar guardado
  privado, tombstones ni renderizado.
- Riesgos o preguntas pendientes:
  - IndexedDB usa structured clone; los bytes logicos reportados no equivalen
    exactamente al espacio fisico del navegador.
  - El checkpoint de 50,000 nodos todavia puede bloquear cientos de
    milisegundos.
  - `shared-current` mantiene una copia adicional temporal hasta que una fase
    posterior retire respaldos de generaciones anteriores.
  - La operacion de borrado grande conserva una lista extensa de IDs y todavia
    bloquea cerca de un segundo principalmente dentro del motor.
  - La prueba de navegador automatizada no reemplaza perfiles en dispositivos
    modestos.

## PERF-006: Aplicacion Mutable Controlada Del Motor

- Fecha: 2026-06-11
- Estado: aceptado
- Observacion: despues de PERF-005, `recordSharedChange()` todavia clonaba el
  snapshot compartido completo dentro de `applyOperation()` y devolvia otra
  copia completa al consumidor.
- Hipotesis: aplicar operaciones sobre el snapshot privado del motor y dejar de
  devolver una copia completa reducira latencia y memoria sin cambiar reglas de
  mezcla, convergencia ni persistencia.
- Cambio aislado:
  - `applyOperation()` conserva su contrato puro para consumidores externos y
    pruebas.
  - `applyOperationMutable()` aplica sobre una referencia controlada y conserva
    la identidad del snapshot raiz.
  - El motor usa la variante mutable al registrar cambios, reconstruir desde el
    log e importar operaciones.
  - `recordSharedChange()` devuelve solamente la operacion pequeña; ya no clona
    ni devuelve el snapshot completo.
  - La interfaz existente conserva una referencia al snapshot interno del motor
    despues de cada cambio.
  - Persistencia, checkpoints, guardado privado y formato de tombstones no
    cambiaron.
- Datos y entorno:
  - Mismos tamaños, escenarios y equipo de PERF-005.
  - Resultados crudos: `performance/results/perf-006-node.json` y
    `performance/results/perf-006-browser.json`.
- Aplicacion aislada en navegador, p50:

| Nodos | Escenario | Aplicacion pura | Aplicacion mutable |
| ---: | --- | ---: | ---: |
| 10,000 | Editar texto | 9.1 ms | 0.3 ms |
| 10,000 | Mover nodo | 6.1 ms | 0.1 ms |
| 50,000 | Editar texto | 41.6 ms | 0.7 ms |
| 50,000 | Mover nodo | 40.2 ms | 0.6 ms |
| 50,000 | Crear nodo | 33.7 ms | 0.6 ms |
| 50,000 | Borrar hoja | 38.6 ms | 6.5 ms |
| 50,000 | Borrar subarbol grande | 805.2 ms | 684.9 ms |

- Efecto sobre commit y respuesta UI de navegador, p50:

| Nodos | Escenario | Commit PERF-005 | Commit PERF-006 | Mejora | UI PERF-005 | UI PERF-006 | Mejora |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | Editar texto | 39.7 ms | 25.6 ms | 35.5% | 22.2 ms | 14.1 ms | 36.5% |
| 10,000 | Mover nodo | 32.5 ms | 24.6 ms | 24.3% | 15.8 ms | 12.3 ms | 22.2% |
| 50,000 | Editar texto | 221.8 ms | 139.2 ms | 37.2% | 141.7 ms | 77.0 ms | 45.7% |
| 50,000 | Mover nodo | 192.7 ms | 126.8 ms | 34.2% | 103.9 ms | 74.8 ms | 28.0% |
| 50,000 | Crear nodo | 221.8 ms | 115.6 ms | 47.9% | 135.1 ms | 72.7 ms | 46.2% |
| 50,000 | Borrar hoja | 197.5 ms | 131.6 ms | 33.4% | 109.5 ms | 75.2 ms | 31.3% |
| 50,000 | Borrar subarbol grande | 1,107.9 ms | 915.3 ms | 17.4% | 989.8 ms | 859.5 ms | 13.2% |

- Memoria transitoria aproximada de aplicacion en Node, 50,000 nodos:

| Escenario | Aplicacion pura | Aplicacion mutable |
| --- | ---: | ---: |
| Editar texto | 37.52 MB | 0.006 MB |
| Mover nodo | 37.51 MB | 0.005 MB |
| Crear nodo | 38.14 MB | 0.61 MB |
| Borrar hoja | 38.81 MB | 1.24 MB |
| Borrar subarbol grande | 63.22 MB | 22.36 MB |

- Verificacion:
  - La aplicacion mutable produce el mismo snapshot que la aplicacion pura.
  - Conserva identidad del snapshot raiz.
  - Operaciones duplicadas siguen siendo idempotentes.
  - La validacion de workspace ocurre antes de mutar.
  - Pruebas existentes de conflictos, recuperaciones, compactacion,
    persistencia incremental y convergencia permanecen vigentes.
- Interpretacion:
  - En cambios pequeños, aplicar la operacion deja de crecer de forma relevante
    con el tamaño total del universo.
  - El costo de `recordSharedChange()` queda cerca de 1-4 ms para cambios
    pequeños con 50,000 nodos.
  - La memoria transitoria retirada es significativa: editar o mover deja de
    crear aproximadamente 37.5 MB por operacion.
  - El commit completo todavia crece porque captura el workspace completo,
    deriva/guarda el estado privado y conserva otros clonados fuera de la
    aplicacion compartida.
  - El borrado grande mejora poco en proporcion. Su costo dominante es recorrer
    miles de nodos, crear tombstones y conservar datos eliminados.
- Decision: aceptar PERF-006. La aplicacion mutable controlada elimina el clonado
  completo de la ruta compartida sin alterar resultados observables.
- Riesgos o preguntas pendientes:
  - El snapshot interno mutable no debe exponerse a consumidores que puedan
    modificarlo arbitrariamente. Las APIs de lectura publica continúan
    devolviendo copias.
  - `mergeSharedSnapshots()` conserva semantica pura y todavia clona snapshots
    completos al importar un bundle con snapshot.
  - Captura de workspace y guardado privado siguen siendo costos lineales.
  - Borrados grandes y checkpoints mantienen pausas visibles.

## PERF-007A: Omitir Persistencia Privada En Cambios Compartidos

- Fecha: 2026-06-11
- Estado: aceptado
- Observacion: despues de PERF-005 y PERF-006, editar texto y mover nodos o
  mapas todavia derivaba y guardaba el `DeviceSnapshot` completo aunque esas
  acciones no cambian estado privado.
- Hipotesis: clasificar las transacciones por su efecto real y omitir
  persistencia privada en acciones exclusivamente compartidas eliminara bytes
  y trabajo lineal sin alterar estado privado ni durabilidad compartida.
- Cambio aislado:
  - Se agrego un contrato cerrado para los nueve tipos actuales.
  - `editNode`, `moveNode` y `moveConstellationMap` registran la operacion
    compartida, pero no derivan ni guardan `DeviceSnapshot`.
  - Las otras seis transacciones conservan su comportamiento anterior.
  - Tipos desconocidos fallan hasta recibir una clasificacion explicita.
  - `captureWorkspaceState()` completo permanece sin cambios para PERF-007C.
- Datos y entorno:
  - Universos de 1,000, 10,000 y 50,000 nodos.
  - Comparacion directa entre ruta anterior y ruta por contrato.
  - Resultados crudos: `performance/results/perf-007a-node.json` y
    `performance/results/perf-007a-browser.json`.
- Commit Node, p50:

| Nodos | Escenario | Ruta anterior | Ruta por contrato | Reduccion | Bytes privados evitados |
| ---: | --- | ---: | ---: | ---: | ---: |
| 10,000 | Editar texto | 39.9 ms | 26.6 ms | 33.4% | 188,203 |
| 10,000 | Mover nodo | 39.1 ms | 26.4 ms | 32.6% | 188,203 |
| 10,000 | Mover mapa | 39.1 ms | 28.6 ms | 27.0% | 188,203 |
| 50,000 | Editar texto | 212.1 ms | 143.3 ms | 32.5% | 1,028,203 |
| 50,000 | Mover nodo | 223.4 ms | 138.0 ms | 38.2% | 1,028,203 |
| 50,000 | Mover mapa | 228.6 ms | 126.4 ms | 44.7% | 1,028,203 |

- Commit y respuesta UI en navegador, p50:

| Nodos | Escenario | Commit anterior | Commit contrato | UI anterior | UI contrato | UI contrato p95 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 10,000 | Editar texto | 26.9 ms | 15.5 ms | 18.8 ms | 15.9 ms | 16.7 ms |
| 10,000 | Mover nodo | 21.1 ms | 9.2 ms | 11.5 ms | 9.4 ms | 9.8 ms |
| 10,000 | Mover mapa | 21.0 ms | 9.1 ms | 11.3 ms | 9.3 ms | 10.7 ms |
| 50,000 | Editar texto | 163.5 ms | 91.7 ms | 102.3 ms | 88.6 ms | 97.2 ms |
| 50,000 | Mover nodo | 136.5 ms | 58.9 ms | 78.0 ms | 64.1 ms | 67.8 ms |
| 50,000 | Mover mapa | 140.6 ms | 58.7 ms | 79.5 ms | 55.8 ms | 73.3 ms |

- Verificacion:
  - Las tres acciones producen exactamente una escritura compartida y cero
    escrituras privadas.
  - Los bytes privados escritos son cero.
  - El `DeviceSnapshot` permanece identico.
  - La prueba del contrato extrae los tipos emitidos realmente por
    `index.html`, por lo que una transaccion nueva exige una decision explicita.
  - Las 50 pruebas automaticas pasan, incluida reconstruccion tras reinicio.
  - La PWA carga y recarga sin servidor con el nuevo modulo en el app shell.
- Interpretacion:
  - La escritura privada completa era un costo lineal real y evitable.
  - El efecto sobre commit es fuerte, especialmente para movimientos.
  - La respuesta UI mejora menos que el commit porque la captura completa del
    workspace ocurre antes de la escritura asincrona y sigue bloqueando el hilo.
  - PERF-007A no alcanza el objetivo de UI menor a 50 ms p95 en 50,000 nodos.
    Ese resultado no invalida el cambio: identifica con mayor precision el
    costo que debe retirar PERF-007C.
- Decision: aceptar PERF-007A. El contrato elimina trabajo conceptualmente
  incorrecto, reduce bytes y latencia, y conserva las invariantes privadas.

## PERF-007C: Operaciones Compartidas Sin Captura Completa

- Fecha: 2026-06-11
- Estado: aceptado
- Observacion: despues de PERF-007A, `captureWorkspaceState()` consumia entre
  49.7 y 82.3 ms p50 por accion en 50,000 nodos, mientras
  `recordSharedChange()` consumia entre 1.7 y 8 ms.
- Hipotesis: `editNode`, `moveNode` y `moveConstellationMap` ya contienen el
  delta compartido necesario y pueden confirmarse sin sincronizar, recorrer ni
  clonar el workspace completo.
- Cambio aislado:
  - El contrato marca solamente esas tres transacciones como `fastShared`.
  - La operacion se construye desde payload y `syncId` existentes.
  - Los nodos del mapa activo se resuelven desde `nodesById`; no se consulta la
    copia potencialmente desactualizada dentro de `maps`.
  - Si el motor no esta inicializado, falta identidad o el payload es
    insuficiente, se conserva explicitamente el fallback de captura completa.
  - Crear y borrar mapas/nodos, acciones privadas y checkpoints no cambiaron.
- Datos y entorno:
  - Universos de 1,000, 10,000 y 50,000 nodos.
  - Siete muestras de navegador para cada escenario de 50,000 nodos.
  - Resultados crudos: `performance/results/perf-007c-node.json` y
    `performance/results/perf-007c-browser.json`.
- Commit Node con 50,000 nodos:

| Escenario | Con captura p50 | Ruta rapida p50 | Ruta rapida p95 |
| --- | ---: | ---: | ---: |
| Editar texto | 136.35 ms | 0.97 ms | 1.28 ms |
| Mover nodo | 140.28 ms | 0.93 ms | 1.11 ms |
| Mover mapa | 128.51 ms | 0.14 ms | 0.17 ms |

- Commit y respuesta UI en navegador con 50,000 nodos:

| Escenario | Commit con captura p50 | Commit rapido p50 | Commit rapido p95 | UI con captura p50 | UI rapida p50 | UI rapida p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Editar texto | 88.5 ms | 1.6 ms | 2.8 ms | 92.6 ms | 6.5 ms | 24.1 ms |
| Mover nodo | 59.2 ms | 1.5 ms | 3.2 ms | 64.4 ms | 6.9 ms | 7.5 ms |
| Mover mapa | 57.5 ms | 1.0 ms | 1.1 ms | 60.3 ms | 6.5 ms | 8.0 ms |

- Verificacion:
  - La ruta normal realiza cero capturas completas.
  - Identidad o payload incompletos activan el fallback completo.
  - Cada operacion rapida es equivalente a la traduccion anterior.
  - Estado visual observable y snapshot compartido reconstruido coinciden.
  - Reinicio, idempotencia, convergencia y persistencia incremental permanecen.
  - Las 55 pruebas automaticas pasan.
  - La PWA carga y recarga sin servidor con el nuevo app shell.
- Interpretacion:
  - La captura completa era el costo dominante de estas acciones frecuentes.
  - La preparacion del delta queda por debajo de 0.03 ms p95 en Node.
  - El commit ya depende del delta y de la escritura incremental, no del numero
    total de nodos.
  - PERF-007C cumple los criterios: UI p95 menor a 50 ms y commit p95 menor a
    60 ms para los tres escenarios con 50,000 nodos.
- Decision: aceptar PERF-007C. La ruta rapida elimina el bloqueo lineal sin
  ampliar el alcance a transacciones con efectos privados o estructurales.

## PERF-007B: Parches Privados Incrementales

- Fecha: 2026-06-11
- Estado: aceptado
- Observacion: seleccionar, mover camara, cambiar zoom, mover la vista de
  constelacion o cambiar mapa todavia capturaba el workspace y guardaba el
  `DeviceSnapshot` completo. Con 50,000 nodos, cada interaccion representaba
  aproximadamente 1.03 MB y bloqueaba la UI entre 92 y 112 ms p50.
- Hipotesis: persistir parches privados reproducibles sobre `device-current`
  reducira costo y bytes a una magnitud proporcional al cambio, sin mezclar
  compactacion privada dentro del experimento.
- Cambio aislado:
  - IndexedDB sube a version 4 y agrega `devicePatches`.
  - `device-current` permanece como checkpoint privado inicial.
  - `privatePersistenceHead` conserva revision, cantidad y bytes del log.
  - `setActiveMap`, `setSelectedNode`, `setMapCamera` y
    `setConstellationView` tienen aplicadores explicitos.
  - `updateViewFrame` y `switchMap` generan solamente los parches realmente
    modificados y evitan captura completa en la ruta normal.
  - Parches y revisiones consecutivas se escriben atomicamente.
  - El motor aplica parches optimistamente antes de esperar IndexedDB, para que
    interacciones rapidas posteriores observen el estado mas reciente.
  - Crear, borrar, aliases, contadores y compactacion privada no cambiaron.
- Datos y entorno:
  - Universos de 1,000, 10,000 y 50,000 nodos.
  - Resultados crudos: `performance/results/perf-007b-node.json` y
    `performance/results/perf-007b-browser.json`.
- Commit y respuesta UI en navegador con 50,000 nodos:

| Escenario | Snapshot p50 | Parche p50 | Parche p95 | UI snapshot p50 | UI parche p50 | UI parche p95 | Bytes snapshot | Bytes parche |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Seleccionar nodo | 114.6 ms | 1.0 ms | 1.2 ms | 92.0 ms | 0.3 ms | 0.3 ms | 1,028,458 | 314 |
| Camara/zoom | 128.3 ms | 1.1 ms | 1.2 ms | 112.3 ms | 0.3 ms | 0.4 ms | 1,028,474 | 362 |
| Vista constelacion | 129.7 ms | 0.9 ms | 1.2 ms | 102.0 ms | 0.2 ms | 0.3 ms | 1,028,472 | 346 |
| Mapa activo | 134.9 ms | 1.1 ms | 1.2 ms | 112.3 ms | 0.3 ms | 0.5 ms | 1,028,485 | 308 |

- Crecimiento medido sin compactacion:

| Entorno | Interacciones | Parches | Bytes del log | Escritura total | Reinicio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Node | 1,000 | 1,000 | 314,483 | 22.4 ms | 446.8 ms |
| Navegador | 1,000 | 1,000 | 299,590 | 412.1 ms | 173.4 ms |

- Verificacion:
  - Interacciones privadas normales realizan cero escrituras de
    `device-current`.
  - Campos omitidos permanecen intactos y cada parche modifica solamente su
    campo permitido.
  - Replay ordenado y duplicado-seguro reconstruye exactamente el ultimo
    estado despues de 1,000 cambios.
  - Un fallo de transaccion no avanza el checkpoint ni el log durable.
  - Un guardado privado completo establece una nueva base y limpia parches
    representados.
  - Adopcion real de IndexedDB v3 a v4 verificada.
  - Las 64 pruebas automaticas pasan.
  - La PWA carga y recarga sin servidor con el nuevo app shell.
- Interpretacion:
  - Las cuatro acciones privadas dejan de crecer con el numero total de nodos.
  - El commit p95 queda debajo de 1.3 ms y la respuesta UI p95 debajo de 0.5 ms
    en los cuatro escenarios de 50,000 nodos.
  - Los bytes por interaccion bajan de aproximadamente 1.03 MB a 308-362 bytes.
  - No compactar durante PERF-007B permite observar la deuda real: 1,000
    parches agregan cerca de 300 KB y 173 ms al reinicio del navegador.
  - El crecimiento es lineal y controlable, pero requiere una politica
    posterior de checkpoint/compactacion privada fuera de la ruta interactiva.
- Decision: aceptar PERF-007B. Resuelve el costo estructural de las
  interacciones privadas normales y conserva recuperacion exacta. La
  compactacion privada se tratara como experimento separado.
- Riesgos o preguntas pendientes:
  - IndexedDB usa structured clone; bytes logicos no equivalen al espacio
    fisico exacto.
  - Camara y zoom pueden generar parches a alta frecuencia. Debe estudiarse
    coalescing antes o junto con compactacion privada.
  - Crear y borrar todavia usan guardado privado completo.

## PERF-008A: Coalescing Durable Privado

- Fecha: 2026-06-11
- Estado: aceptado
- Observacion: PERF-007B redujo cada interaccion privada a unos cientos de
  bytes, pero el log seguia creciendo con cada gesto. En navegador, 1,000
  cambios de camara producian 1,000 parches y aproximadamente 300 KB.
- Hipotesis: como los parches privados representan asignaciones de estado,
  conservar solamente el ultimo valor durable por clave reducira crecimiento
  de `O(interacciones)` a `O(mapas)` sin introducir checkpoints ni regresar la
  latencia interactiva.
- Cambio aislado:
  - Cada parche recibe una clave estructural: `activeMap`,
    `constellationView`, `mapCamera:<mapSyncId>` o
    `selectedNode:<mapSyncId>`.
  - IndexedDB sube a version 5 y `devicePatches` usa `patchKey` como clave
    primaria.
  - Cada commit lee el registro anterior, lo reemplaza y actualiza revision,
    cantidad y diferencia de bytes dentro de una sola transaccion.
  - La revision global permanece monotona aunque se reemplace una entrada.
  - El motor conserva solamente los ultimos parches en memoria.
  - La migracion v4 a v5 coalesce automaticamente el historial append-only,
    recalcula la cabecera y conserva la revision maxima.
  - No se agregaron checkpoints, tareas idle ni limpieza adicional.
- Datos y entorno:
  - Universos de 1,000, 10,000 y 50,000 nodos.
  - Resultados crudos: `performance/results/perf-008a-node.json` y
    `performance/results/perf-008a-browser.json`.
- Reemplazo durable en navegador con 50,000 nodos:

| Escenario | Commit p50 | Commit p95 | UI p50 | UI p95 | Bytes escritos | Bytes retenidos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Seleccionar nodo | 0.5 ms | 0.6 ms | 0.1 ms | 0.1 ms | 353 | 281 |
| Camara/zoom | 0.6 ms | 0.7 ms | 0.1 ms | 0.2 ms | 409 | 337 |
| Vista constelacion | 0.5 ms | 0.6 ms | 0.0 ms | 0.1 ms | 394 | 322 |
| Mapa activo | 0.5 ms | 0.6 ms | 0.0 ms | 0.1 ms | 338 | 266 |

- Crecimiento tras 1,000 interacciones en navegador:

| Patron | Parches PERF-007B | Parches PERF-008A | Bytes PERF-007B | Bytes PERF-008A | Revision |
| --- | ---: | ---: | ---: | ---: | ---: |
| Camara de un mapa | 1,000 | 1 | 299,590 | 355 | 1,000 |
| Camara de tres mapas | 1,000 | 3 | 299,590 | 1,071 | 1,000 |
| Mezcla intercalada de ocho claves | 1,000 | 8 | 299,590 | 2,618 | 1,000 |

- Reinicio con universo de 50,000 nodos:

| Caso | Reinicio navegador |
| --- | ---: |
| PERF-007B, 1,000 parches | 173.4 ms |
| PERF-008A, una clave | 219.2 ms |
| PERF-008A, tres claves | 176.2 ms |
| PERF-008A, ocho claves | 220.2 ms |

- Verificacion:
  - 1,000 cambios de una camara producen un registro durable.
  - Camaras de tres mapas producen tres registros.
  - Camara y seleccion del mismo mapa no se pisan.
  - La mezcla intercalada conserva las ocho claves y sus ultimos valores.
  - Un aborto IndexedDB restaura parche y cabecera anteriores.
  - Migracion real v4 a v5 conserva revision maxima, recalcula cantidad/bytes y
    reproduce exactamente el estado final.
  - Las 70 pruebas automaticas pasan.
  - La PWA carga y recarga sin servidor con el nuevo app shell.
- Interpretacion:
  - El almacenamiento privado deja de crecer con la cantidad historica de
    interacciones y queda acotado por la estructura del workspace.
  - Reemplazar una entrada IndexedDB no regresa la latencia de PERF-007B; los
    cuatro escenarios quedan debajo de 0.7 ms p95 de commit.
  - El objetivo de reinicio menor a 30-50 ms no se cumple. Reducir de 1,000
    parches a entre 1 y 8 no mejora el arranque de forma observable.
  - El costo dominante del reinicio de 50,000 nodos esta en cargar, clonar y
    reconstruir el universo, no en reproducir el log privado.
- Decision: aceptar PERF-008A. Resuelve completamente la deuda de crecimiento
  que introdujo PERF-007B. PERF-008B deja de ser urgente: publicar un nuevo
  checkpoint privado no atacaria el cuello de arranque medido y queda como
  mantenimiento posterior.
- Riesgos o preguntas pendientes:
  - `patchBytes` representa bytes logicos, no uso fisico exacto de IndexedDB.
  - El costo total de 1,000 escrituras aumenta de 412 ms a 523-551 ms en
    navegador porque cada reemplazo lee el valor anterior; la latencia por
    interaccion sigue debajo del objetivo.
  - Hace falta un experimento separado para identificar el costo dominante del
    arranque de universos grandes.

## PERF-009: Linea Base De Arranque Completo

- Fecha: 2026-06-11
- Estado: aceptado
- Objetivo: identificar el bloque dominante del arranque real antes de
  optimizarlo.
- Cambio aislado:
  - Se agrego un profiler opcional y desactivado por defecto.
  - IndexedDB, `LocalSyncEngine.initialize()`, `materializeWorkspace()`,
    restauracion, indices y primer frame reportan fases separadas.
  - El laboratorio abre la aplicacion real con bases IndexedDB aisladas y
    elimina cada base temporal despues de medir.
  - El modo diagnostico no registra service worker, para evitar mezclar una
    reparacion critica del app shell con el arranque de datos.
  - No se cambio ningun algoritmo de carga o renderizado.
- Escenarios:
  - Checkpoint limpio.
  - 200 operaciones compartidas pendientes.
  - Parches privados estructurales coalescidos.
  - Un mapa grande frente al mismo total repartido entre mapas menores.
- Resultados crudos:
  - `performance/results/perf-009-node.json`
  - `performance/results/perf-009-browser.json`

### Tiempo Hasta Estado Listo Y UI Usable

Valores agregados entre los tres escenarios del navegador:

| Nodos | Topologia | Workspace listo p50 | UI usable p50 | UI usable p95 |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | Un mapa activo | 56.2 ms | 197.3 ms | 445.1 ms |
| 1,000 | Muchos mapas | 45.1 ms | 122.8 ms | 218.4 ms |
| 10,000 | Un mapa activo | 113.8 ms | 5,510.2 ms | 7,048.7 ms |
| 10,000 | Muchos mapas | 120.1 ms | 199.6 ms | 230.1 ms |
| 50,000 | Un mapa activo | 345.7 ms | 14,959.4 ms | 20,851.5 ms |
| 50,000 | Muchos mapas | 380.8 ms | 465.6 ms | 560.4 ms |

### Desglose De 50,000 Nodos

Medianas agregadas; los spans son anidados y no deben sumarse:

| Fase | Un mapa activo | Muchos mapas |
| --- | ---: | ---: |
| Lectura IndexedDB | 100.3 ms | 168.8 ms |
| Inicializacion del motor | 200.3 ms | 249.3 ms |
| Materializacion del workspace | 79.0 ms | 74.4 ms |
| Workspace listo | 345.7 ms | 380.8 ms |
| Primer frame JavaScript | 794.3 ms | 66.4 ms |
| UI usable | 14,959.4 ms | 465.6 ms |

- Interpretacion:
  - Persistencia, clonados y materializacion siguen siendo costos lineales
    relevantes: el estado interno tarda aproximadamente 350-380 ms en quedar
    listo con 50,000 nodos.
  - No son el bloqueo dominante para un mapa activo grande.
  - Reproducir 200 operaciones compartidas agrega alrededor de 2-12 ms p50.
    Los parches privados estructurales tampoco cambian materialmente el
    arranque. PERF-008B sigue sin ser urgente.
  - Repartir 50,000 nodos entre 50 mapas de 1,000 conserva el costo de cargar y
    materializar el universo, pero mantiene el primer frame cerca de 66 ms y
    la UI usable cerca de 466 ms.
  - Un mapa activo de 50,000 nodos presenta pausas altamente variables. El
    primer frame JavaScript alcanza 14.4 s p95; `drawLinks` llega a 7.8 s p95 y
    `drawNodes` a 14.0 s p95.
  - El siguiente `requestAnimationFrame` tambien puede demorarse hasta 18.5 s
    p95 despues del frame. Esto indica trabajo de rasterizacion/compositor o
    presion del canvas que no queda contenido dentro de los spans JavaScript.
- Decision:
  - Aceptar PERF-009 como linea base diagnostica.
  - PERF-010 debe atacar renderizado/culling del mapa activo. Es el mayor
    bloque medido y determina la diferencia entre 0.47 s y 15 s con el mismo
    universo total.
  - La optimizacion de clonados/particionado de arranque queda registrada para
    despues: puede reducir los 350-380 ms hasta workspace listo, pero no
    resolvera por si sola el bloqueo de mapas activos grandes.
- Verificacion:
  - 73 pruebas automaticas pasan.
  - El profiler queda inactivo en la ruta normal.
  - El app shell incluye el nuevo modulo de profiler.
  - La linea base se repitio con iframe visible y origen sin service worker
    anterior para evitar throttling y cache mezclada.
- Riesgos o preguntas pendientes:
  - `performance.memory` es orientativo y puede variar por GC.
  - Primera navegacion y navegaciones repetidas muestran alta variabilidad en
    Canvas; PERF-010 debe conservar p50/p95 y medir frame posterior.
  - El costo fisico de IndexedDB y el structured clone pueden variar entre
    navegadores y dispositivos.

## PERF-010A1: Culling Lineal Conservador

- Fecha: 2026-06-11
- Estado: aceptado con deuda medida
- Objetivo: determinar cuanto bloqueo proviene de procesar y rasterizar
  elementos fuera del viewport antes de introducir indices espaciales, LOD,
  cache o render progresivo.
- Cambio aislado:
  - Se agrego clasificacion lineal conservadora antes de `drawLinks()` y
    `drawNode()`.
  - Los nodos consideran cuerpo, seleccion, etiqueta y halo de la estrella
    central.
  - Los enlaces usan bounding box ampliado; puede conservar enlaces extra para
    evitar falsos negativos visuales.
  - Se reutilizan los arrays de salida y el camino caliente no crea bounds por
    cada elemento.
  - `updateNodes()`, simulacion, interaccion y modelo de datos permanecen
    intactos.
- Resultados crudos:
  - `performance/results/perf-010a1-node.json`
  - `performance/results/perf-010a1-browser.json`

### Clasificacion Aislada En Node

| Nodos | Camara normal p50 | Camara densa p50 | Zoom lejano p50 | Viewport vacio p50 |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 0.334 ms | 0.076 ms | 0.184 ms | 0.042 ms |
| 10,000 | 1.495 ms | 1.203 ms | 1.451 ms | 1.015 ms |
| 50,000 | 9.332 ms | 6.590 ms | 8.183 ms | 7.006 ms |

### Primer Frame Real Con 50,000 Nodos

Valores p50 del navegador; `UI usable` conserva p95 en los resultados crudos
porque Canvas sigue mostrando variabilidad.

| Camara | Nodos dibujados | Enlaces dibujados | Frame base | Frame culled | Mejora frame | UI base | UI culled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal | 4 | 19,780 | 673.9 ms | 265.4 ms | 60.6% | 1,117.1 ms | 815.7 ms |
| Densa | 1,558 | 35,710 | 635.5 ms | 400.3 ms | 37.0% | 1,191.2 ms | 1,102.4 ms |
| Zoom lejano | 50,000 | 49,999 | 969.8 ms | 938.9 ms | 3.2% | 1,418.5 ms | 1,371.3 ms |
| Vacia | 0 | 0 | 544.1 ms | 68.6 ms | 87.4% | 945.7 ms | 512.4 ms |

- Interpretacion:
  - Procesar y rasterizar nodos invisibles era un costo importante. Con pocos
    elementos visibles, el primer frame baja entre 60.6% y 87.4%.
  - El culling es conservador y retiene muchos enlaces: 19,780 en una camara
    normal y 35,710 en una camara densa. `drawLinks` todavia cuesta 139.4 ms y
    268.3 ms p50 respectivamente.
  - Cuando todo es visible, el culling no promete una mejora material y no
    produce una regresion grande en la mediana.
  - La clasificacion lineal cuesta aproximadamente 29-30 ms p50 en el navegador
    con 50,000 nodos. Es mucho menor que dibujar todo, pero por si sola excede
    el presupuesto de un frame fluido.
- Decision:
  - Aceptar PERF-010A1 y mantenerlo activo. Es una mejora estructural segura
    cuando parte del mapa queda fuera de vista.
  - PERF-010A2 queda justificado para reducir el costo de clasificacion con un
    indice espacial medido.
  - PERF-010B tambien queda justificado: el costo dominante restante en
    camaras normales y densas es construir y dibujar demasiados enlaces.
- Verificacion:
  - Tests unitarios cubren etiquetas cercanas al borde, halo de estrella
    central, enlaces que cruzan el viewport y reutilizacion de arrays.
  - La ruta base y la ruta culled se revisaron visualmente sobre el mismo mapa
    sin diferencias observables.
  - El laboratorio desactiva solamente el WebGL de la estrella y espera dos
    frames entre muestras para evitar contaminar la medicion Canvas.
- Riesgos o preguntas pendientes:
  - `UI usable` conserva variabilidad alta por rasterizacion/compositor; el
    primer frame JavaScript es la metrica mas estable para comparar A1.
  - El bounding box conservador de enlaces dibuja trabajo extra de forma
    intencional.
  - El culling no reduce `updateNodes()` ni la simulacion de elementos fuera de
    vista.

## PERF-010B0: Diagnostico Detallado De Enlaces

- Fecha: 2026-06-11
- Estado: aceptado
- Objetivo: identificar por que tantos enlaces sobreviven al culling y que
  bloques dominan `drawLinks()` antes de cambiar la geometria.
- Cambio aislado:
  - La ruta normal de `drawLinks()` permanece intacta.
  - El laboratorio importa una variante instrumentada solamente con
    `perfLinkDiagnostics=1`.
  - Se miden seleccion, resolucion, puntos, paths, `stroke()` y frame posterior.
  - Una prueba posterior sobre la polilinea ya generada estima interseccion con
    un viewport ampliado, pero no decide que se dibuja.
- Resultado crudo:
  - `performance/results/perf-010b0-browser.json`

### Candidatos Y Geometria Con 50,000 Nodos

Valores p50. `Visible aproximado` significa que la polilinea muestreada
intersecta el viewport ampliado; no es una prueba raster exacta.

| Camara | Candidatos | Visible aproximado | Candidatos extra | Segmentos extra | Segmentos generados | Comandos path | Strokes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal | 19,780 | 8,241 | 11,539 (58.3%) | 484,638 (58.3%) | 830,752 | 870,312 | 19,780 |
| Densa | 35,710 | 27,673 | 8,037 (22.5%) | 325,477 (22.0%) | 1,480,467 | 1,551,887 | 35,710 |
| Zoom lejano | 49,999 | 49,999 | 0 | 0 | 1,705,541 | 1,805,539 | 49,999 |
| Vacia | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Desglose Diagnostico De DrawLinks

Valores p50. El total B0 incluye temporizadores y la prueba diagnostica, por lo
que no sustituye los tiempos productivos de PERF-010A1.

| Camara | Seleccionar candidatos | Resolver extremos | Generar puntos | Prueba visible | Construir paths | Stroke | DrawLinks B0 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal | 5.8 ms | 21.4 ms | 65.8 ms | 17.3 ms | 60.4 ms | 18.2 ms | 199.0 ms |
| Densa | 6.1 ms | 33.9 ms | 98.3 ms | 16.3 ms | 87.2 ms | 34.9 ms | 292.9 ms |
| Zoom lejano | 6.7 ms | 44.8 ms | 111.2 ms | 6.2 ms | 118.1 ms | 170.2 ms | 470.7 ms |
| Vacia | 4.7 ms | 0.0 ms | 0.0 ms | 0.0 ms | 0.0 ms | 0.0 ms | 0.2 ms |

- Interpretacion:
  - Seleccionar candidatos no es el cuello dominante: queda entre 4.7 y 6.7
    ms p50. El costo aparece despues de aceptar enlaces.
  - En camara normal, un rechazo geometrico mejor tiene alto retorno potencial:
    aproximadamente 58% de enlaces y segmentos aceptados no intersectan el
    viewport ampliado segun la geometria ya generada.
  - En camara densa, B1 puede retirar cerca de 22% del trabajo, pero la mayoria
    de enlaces realmente cruza la vista.
  - En zoom lejano, B1 no puede ayudar: todos los enlaces son visibles. Generar
    puntos, construir paths y `stroke()` concentran el costo, justificando B2.
  - La prueba visible de B0 ocurre demasiado tarde para ser una optimizacion:
    ya pago la generacion de puntos. B1 necesita un rechazo barato anterior a
    construir la curva.
- Decision:
  - Aceptar PERF-010B0 como diagnostico y retirar cualquier expectativa de que
    seleccionar candidatos sea el problema principal.
  - PERF-010B1 se ejecuto despues como segunda prueba conservadora barata antes
    de generar puntos y quedo aceptado.
  - Mantener PERF-010B2 inmediatamente despues. Es necesario para camara densa
    y zoom lejano, donde la mayor parte o todos los enlaces son visibles.
- Verificacion:
  - El modulo diagnostico no se carga en la ruta normal.
  - Pruebas cubren interseccion interior, cruce, rechazo, atribucion y resumen.
  - El laboratorio conserva culling A1, aislamiento WebGL y espera entre
    muestras.
- Riesgos o preguntas pendientes:
  - La polilinea muestreada es una aproximacion diagnostica de las curvas
    cuadraticas dibujadas; B1 debe seguir siendo mas conservador.
  - El fixture sintetico no produjo enlaces activos visibles, por lo que el
    segundo path de seleccion no quedo estresado.
  - El siguiente `requestAnimationFrame` presento throttling erratico incluso
    con viewport vacio. No se usa para decidir B1/B2; los conteos y tiempos
    JavaScript internos fueron reproducibles.

## PERF-010B1: Rechazo Geometrico Conservador De Enlaces

- Fecha: 2026-06-11
- Estado: aceptado y activo
- Objetivo: retirar falsos positivos del bounding box antes de generar puntos,
  paths y strokes.
- Cambio aislado:
  - Despues del bounding box A1, probar el segmento source-target contra un
    viewport ampliado por un margen derivado de la curvatura maxima actual.
  - Mantener geometria, segmentos, estilos, simulacion y dibujo sin cambios.
  - Conservar `perfLinkSegmentCulling=0` para comparar o diagnosticar A1.
- Resultado crudo:
  - `performance/results/perf-010b1-browser.json`

### Primer Frame Productivo Con 50,000 Nodos

Valores p50; los p95 completos permanecen en el resultado crudo.

| Camara | Enlaces A1 | Enlaces B1 | Rechazados | Clasificar A1 | Clasificar B1 | DrawLinks A1 | DrawLinks B1 | Frame A1 | Frame B1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal | 19,780 | 8,340 | 11,440 (57.8%) | 28.2 ms | 25.8 ms | 148.5 ms | 62.4 ms | 288.0 ms | 202.4 ms |
| Densa | 35,710 | 28,594 | 7,116 (19.9%) | 26.1 ms | 27.5 ms | 266.6 ms | 198.1 ms | 379.7 ms | 336.0 ms |
| Zoom lejano | 49,999 | 49,999 | 0 | 25.9 ms | 24.1 ms | 401.0 ms | 398.6 ms | 999.6 ms | 1,002.9 ms |
| Vacia | 0 | 0 | 0 | 21.7 ms | 23.7 ms | 0.2 ms | 0.1 ms | 62.6 ms | 62.6 ms |

- Interpretacion:
  - En camara normal, B1 elimina 57.8% de los enlaces aceptados por A1 y baja
    `drawLinks()` 58.0%. El frame JavaScript baja 29.7%.
  - En camara densa, elimina 19.9% y baja `drawLinks()` 25.7%; B2 sigue siendo
    necesario porque permanecen 28,594 enlaces realmente relevantes.
  - B1 conserva mas enlaces que la prueba visible aproximada de B0: 8,340
    frente a 8,241 en normal y 28,594 frente a 27,673 en densa. El rechazo
    mantiene margen conservador medible.
  - En zoom lejano no rechaza ningun enlace y la diferencia de frame es -0.3%,
    dentro de variabilidad normal. B1 no intenta resolver este caso.
  - La segunda prueba no introduce una regresion medible de clasificacion:
    queda alrededor de 24-28 ms p50 con 50,000 nodos.
- Decision:
  - Aceptar y activar PERF-010B1 por defecto.
  - Mantener el interruptor `perfLinkSegmentCulling=0` para diagnostico.
  - Ejecutar PERF-010B2 a continuacion para reducir costo por enlace visible,
    especialmente en camara densa y zoom lejano.
- Verificacion:
  - Pruebas cubren falsos positivos de bounding box, cruces con extremos fuera,
    velocidades, seis niveles de zoom y 4,500 curvas deterministicas.
  - El margen conserva la curva espacial B2B porque su desviacion maxima actual
    es 12 px y queda dentro del margen segmentario.
  - Suite completa y recarga PWA offline verificadas con B1 activo.
- Riesgos o preguntas pendientes:
  - B1 depende del limite actual de curvatura de `spatial-quad`. Si cambian las
    constantes de bend, debe actualizarse y volver a validarse el margen.
  - Zoom lejano continua cerca de un segundo porque todos los enlaces son
    visibles; corresponde a PERF-010B2, no a un rechazo mas agresivo.

## PERF-010B2A: Diagnostico De Costo Por Enlace Visible

- Fecha: 2026-06-11
- Estado: aceptado como diagnostico
- Objetivo: identificar por que los enlaces que sobreviven a B1 siguen siendo
  caros, sin activar simplificacion ni agrupacion en produccion.
- Cambio aislado:
  - Cargar instrumentacion solamente con `perfLinkCostDiagnostics=1`.
  - Mantener B1 activo y entregar exactamente los mismos enlaces a cada modo.
  - Rotar deterministicamente el orden de ablaciones entre muestras.
  - Agregar resultados por longitud, segmentos y curvatura, sin guardar una
    metrica por enlace.
- Resultados crudos:
  - `performance/results/perf-010b2a-browser.json`
  - `performance/results/perf-010b2a-dense-focus-browser.json`

### Costo Actual Instrumentado Con 50,000 Nodos

Valores p50. Los tiempos absolutos incluyen instrumentacion; sirven para
atribucion relativa dentro de B2A.

| Camara | Enlaces B1 | Segmentos | Generar puntos | Construir path | Stroke | DrawLinks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal | 8,340 | 350,272 | 32.2 ms | 7.1 ms | 9.2 ms | 72.2 ms |
| Densa | 28,594 | 1,192,222 | 97.8 ms | 21.7 ms | 39.7 ms | 232.4 ms |
| Zoom lejano | 49,999 | 1,705,541 | 114.2 ms | 26.6 ms | 157.5 ms | 382.3 ms |

- En normal y densa, generar puntos organicos es el mayor bloque interno.
- En zoom lejano, `stroke()` pasa a ser el bloque dominante y supera la
  generacion de puntos.
- Construir comandos de path es medible, pero no es el bloque principal.

### Ablaciones No Productivas

`DrawLinks` p50 sobre los mismos enlaces B1:

| Camara | Actual | Linea recta | Ocho segmentos | Un stroke uniforme |
| --- | ---: | ---: | ---: | ---: |
| Normal | 72.2 ms | 19.0 ms (-73.7%) | 38.4 ms (-46.8%) | 55.0 ms (-23.8%) |
| Densa | 232.4 ms | 68.8 ms (-70.4%) | 98.9 ms (-57.4%) | 157.5 ms (-32.2%) |
| Zoom lejano | 382.3 ms | 96.6 ms (-74.7%) | 172.4 ms (-54.9%) | 234.0 ms (-38.8%) |

- Limitar a ocho segmentos reduce segmentos aproximadamente 81.0% en normal,
  80.8% en densa y 76.5% en zoom lejano. Reduce puntos, paths y tambien el
  costo de `stroke()`.
- Agrupar temporalmente todo en un stroke reduce el bloque `stroke()` de 9.2 a
  2.2 ms, de 39.7 a 7.3 ms y de 157.5 a 10.3 ms respectivamente. Confirma que
  una llamada por enlace es costosa, especialmente con zoom lejano.
- La linea recta marca el limite inferior diagnostico: reducir la complejidad
  geometrica completa ofrece cerca de 70-75% de mejora.
- `no-active` no permite atribuir una mejora real: normal tiene cero enlaces
  activos y densa/zoom solo uno. Las diferencias observadas quedan dentro de
  variabilidad entre muestras.

### Distribucion Geometrica

- El maximo actual de 42 segmentos se usa en:
  - 8,338 de 8,340 enlaces normales: 99.98%.
  - 28,046 de 28,594 enlaces densos: 98.1%.
  - 26,228 de 49,999 enlaces con zoom lejano: 52.5%.
- Todos los enlaces medidos quedaron en el bucket de curvatura estimada menor
  a 2 px.
- Por tanto, la ruta actual asigna casi siempre el maximo de detalle por
  longitud proyectada, incluso cuando la curva visible tiene muy poca
  desviacion.

### Veredicto Y Decision

- El costo dominante no es unico:
  - normal/densa: puntos y exceso de segmentos;
  - zoom lejano: `stroke()` y complejidad rasterizable por enlace.
- PERF-010B2B debe empezar por una geometria adaptativa basada en error visual o
  curvatura, no por un limite fijo ingenuo de segmentos.
- La primera variante productiva a evaluar debe usar una primitiva mas simple
  para enlaces de curvatura baja y conservar la curva actual como fallback.
- Si despues permanece alto `stroke()`, evaluar batching compatible y acotado
  por estilo en un experimento separado.
- PERF-010A2 sigue siendo util, pero clasificar visibilidad no es el mayor
  bloque frente a los enlaces aceptados.
- PERF-010C no queda descartado, pero este laboratorio no puede atribuir
  compositor diferido: el siguiente `requestAnimationFrame` presento retrasos
  aleatorios de 15-25 segundos en modos distintos. La medicion focalizada
  demostro que esos retrasos no corresponden de forma estable a una ablacion.

- Verificacion:
  - Los siete modos recibieron conteos B1 identicos en las tres camaras.
  - Pruebas cubren aislamiento por flag, modos permitidos, rotacion y buckets.
  - Ninguna ablacion se activo en la ruta normal.
  - Suite completa: 98 pruebas aprobadas.
  - Carga normal y recarga completamente offline verificadas sin errores.
- Riesgos o preguntas pendientes:
  - El fixture de primer frame no ejercita curvatura media o alta. B2B debe
    incluir una prueba visual/controlada de movimiento antes de elegir umbrales.
  - Los tiempos B2A incluyen temporizadores por enlace; usar diferencias
    relativas, no reemplazar con ellos los tiempos productivos de B1.
  - Medir compositor requiere un laboratorio distinto o trazas del navegador.

## PERF-010B2B: Geometria Adaptativa De Enlaces

- Fecha: 2026-07-01
- Aceptacion visual/productiva: 2026-08-11
- Estado: aceptado como cambio productivo. `spatial-quad` reemplaza la
  geometria organica segmentada en la ruta normal de D0.
- Hipotesis:
  - Una curva espacial estable con una sola Bezier cuadratica puede reemplazar
    la geometria organica actual de 18-42 segmentos, mejorando apariencia y
    reduciendo segmentos, comandos y costo de dibujo.
- Alcance propuesto:
  - Comparar `current` contra `spatial-quad`.
  - Mantener la ruta productiva normal intacta durante el diagnostico.
  - Medir escenarios estatico, movimiento medio y movimiento alto.
  - Activar cambios productivos solo despues de resultados y validacion visual.
  - No mezclar batching, indice espacial ni render progresivo.
- Algoritmos propuestos:
  - `current`: por cada enlace visible, resolver extremos, calcular
    `S = clamp(floor(distancia / 10), 18, 42)`, generar `S + 1` puntos con
    `organicPointOnLink()`, construir una polilinea suavizada con muchos
    `quadraticCurveTo()` y hacer `stroke()` por enlace. Complejidad temporal:
    `O(L * S)`. Memoria temporal: `O(S)` por enlace.
  - `spatial-quad`: por cada enlace visible, resolver extremos, calcular
    tangente y normal, elegir una curvatura estable por identidad
    `(from, to)`, crear un punto de control cerca del centro y dibujar una sola
    Bezier cuadratica. La velocidad del nodo no deforma la geometria; la
    animacion queda reservada para brillo/opacidad. Complejidad temporal:
    `O(L)`. Memoria temporal: `O(1)` por enlace.
- Metricas propuestas:
  - Enlaces dibujados.
  - Segmentos generados.
  - Segmentos y comandos ahorrados.
  - `drawLinks` p50/p95.
  - Frame completo.
  - Desviacion visual de la curva espacial.
  - Fidelidad visual.
- Criterios propuestos:
  - Mejora medible en segmentos, comandos y `drawLinks`.
  - Animacion visualmente mas limpia al mover nodos.
  - Sin perdida de legibilidad de relaciones padre-hijo.
  - Produccion solo despues de cerrar resultados, interpretacion y decision.
- Codigo local:
  - `runtime/link-adaptive-geometry.js`.
  - `runtime/link-adaptive-diagnostics.js`.
  - `performance/perf-010b2b-browser.html`.
  - `performance/perf-010b2b-browser.js`.
  - `performance/perf-010b2b-core.js`.
- Datos y entorno:
  - Navegador: Edge headless via DevTools Protocol.
  - Fixture: 50,000 nodos; camaras normal, densa y zoom lejano.
  - Movimiento: `none`, `medium`, `high`.
  - Muestras: 3 por combinacion.
  - Resultado crudo: `performance/results/perf-010b2b-browser.json`.

### Resultados B2B

Valores p50. Los tiempos absolutos pertenecen a esta corrida headless y no deben
compararse directamente contra B2A; la comparacion valida es `current` contra
`spatial-quad` dentro de la misma corrida.

| Camara | Movimiento | Enlaces | Draw actual | Draw spatial | Mejora draw | Frame actual | Frame spatial | Mejora frame |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal | none | 8,340 | 57.8 ms | 19.0 ms | 67.1% | 203.8 ms | 165.0 ms | 19.0% |
| Normal | medium | 8,383 | 54.0 ms | 20.1 ms | 62.8% | 208.3 ms | 174.0 ms | 16.5% |
| Normal | high | 8,536 | 54.4 ms | 20.1 ms | 63.1% | 208.0 ms | 185.5 ms | 10.8% |
| Densa | none | 28,594 | 564.1 ms | 336.0 ms | 40.4% | 718.5 ms | 506.4 ms | 29.5% |
| Densa | medium | 28,799 | 537.1 ms | 326.5 ms | 39.2% | 691.2 ms | 485.0 ms | 29.8% |
| Densa | high | 29,682 | 531.5 ms | 320.6 ms | 39.7% | 690.7 ms | 481.3 ms | 30.3% |
| Zoom lejano | none | 49,999 | 426.7 ms | 187.2 ms | 56.1% | 899.2 ms | 638.6 ms | 29.0% |
| Zoom lejano | medium | 49,999 | 433.4 ms | 184.9 ms | 57.3% | 913.5 ms | 661.5 ms | 27.6% |
| Zoom lejano | high | 49,999 | 434.0 ms | 193.2 ms | 55.5% | 923.7 ms | 657.6 ms | 28.8% |

| Camara | Movimiento | Segmentos actual | Segmentos spatial | Comandos actual | Comandos spatial | Desv. spatial p95/max |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Normal | none | 350,272 | 8,340 | 366,952 | 25,020 | 12.0/12.0 px |
| Normal | medium | 352,078 | 8,383 | 368,844 | 25,149 | 12.0/12.0 px |
| Normal | high | 358,504 | 8,536 | 375,576 | 25,608 | 12.0/12.0 px |
| Densa | none | 1,192,222 | 28,594 | 1,249,410 | 85,782 | 12.0/12.0 px |
| Densa | medium | 1,200,738 | 28,799 | 1,258,380 | 86,400 | 12.0/12.0 px |
| Densa | high | 1,237,404 | 29,682 | 1,296,812 | 89,049 | 12.0/12.0 px |
| Zoom lejano | none | 1,705,541 | 49,999 | 1,805,539 | 149,997 | 12.0/12.0 px |
| Zoom lejano | medium | 1,705,541 | 49,999 | 1,805,583 | 150,000 | 12.0/12.0 px |
| Zoom lejano | high | 1,705,541 | 49,999 | 1,805,583 | 150,000 | 12.0/12.0 px |

### Interpretacion B2B

- `spatial-quad` reduce segmentos alrededor de 97-98% porque cada enlace pasa a
  una sola curva cuadratica.
- `drawLinks` mejora entre 39.2% y 67.1% p50 en las nueve combinaciones medidas.
- El frame completo mejora entre 10.8% y 30.3% p50.
- El costo de generar geometria baja de 27.8-135.2 ms a 2.6-11.8 ms p50.
- En camara densa y zoom lejano `stroke()` sigue siendo alto; esto confirma que
  batching por estilo podria seguir siendo util despues, pero no debe mezclarse
  con B2B.
- La desviacion visual maxima de la curva espacial queda acotada a 12 px por el
  algoritmo actual de bend. La validacion visual manual aprobo el arco frente a
  la geometria anterior.

### Decision B2B

- Decision productiva: aceptar `spatial-quad` como renderer de enlaces D0 por
  defecto.
- La geometria anterior de 18-42 segmentos queda retirada de la ruta normal.
- Mantener B1 activo; su margen conserva la desviacion maxima actual de
  `spatial-quad`.
- El siguiente cuello de botella probable es `stroke()` en camara densa y zoom
  lejano. Debe tratarse como otro experimento, sin mezclarlo con B2B.

### Verificacion B2B

- Suite completa: 106 pruebas aprobadas.
- PWA/offline verificada el 2026-08-12 con perfil limpio de Edge.
- Cache activo: `contextus-app-shell-v30-perf-010b2b-spatial-links`.
- `runtime/link-adaptive-geometry.js` cacheado y recarga offline sin errores de
  consola.

## Proximos Experimentos Registrados

### PERF-008B: Checkpoint Privado Fuera De Interaccion

- Objetivo: publicar una nueva base privada recuperable cuando mantenimiento o
  migraciones lo requieran.
- Prioridad: baja mientras el log permanezca acotado por PERF-008A.
- Restriccion: no presentarlo como solucion al arranque de 50,000 nodos; los
  datos muestran que ese costo esta fuera del replay privado.

### PERF-010A2: Indice Espacial Para Clasificacion

- Objetivo: reducir los aproximadamente 29-30 ms p50 que cuesta clasificar
  linealmente un mapa activo de 50,000 nodos.
- Restriccion: demostrar que actualizar/consultar el indice cuesta menos que
  recorrer el mapa y conservar exactamente las reglas conservadoras de A1.

### PERF-010B2C: Agrupacion De Stroke En Enlaces

- Objetivo: reducir el costo restante de `stroke()` cuando hay muchos enlaces
  visibles en camara densa y zoom lejano.
- Restriccion: no cambiar la geometria `spatial-quad` aceptada ni mezclar indice
  espacial o render progresivo.

### PERF-011: Borrados Grandes Y Tombstones Compactos

- Objetivo: reducir tiempo, memoria y bytes de operaciones/tombstones al borrar
  miles de nodos sin destruir contenido concurrente recuperable.
- Restriccion: conservar recuperaciones completas y semantica causal antes de
  cambiar el formato durable.

### PERF-012: Checkpoints Compartidos Fuera De La Ruta Interactiva

- Objetivo: impedir que crear y publicar un checkpoint compartido de cientos de
  milisegundos bloquee una accion del usuario.
- Restriccion: conservar durabilidad, recuperacion ante cortes y limites del
  log. No mezclar limpieza de tombstones.

### PERF-013: Particionado Y Clonados De Arranque

- Objetivo: reducir los aproximadamente 350-380 ms necesarios para dejar listo
  un universo de 50,000 nodos mediante menos clonados o carga por mapa.
- Restriccion: conservar reconstruccion, convergencia, migracion y arranque
  offline exactos. No mezclar con culling.
