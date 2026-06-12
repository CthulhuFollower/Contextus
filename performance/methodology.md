# Metodologia De Rendimiento

## Objetivo

Medir primero, optimizar despues. Cada cambio de rendimiento debe responder una
hipotesis concreta y compararse contra una linea base reproducible.

El Lote 1 mide las rutas algorítmicas del mapa mental. No mide IndexedDB,
sincronizacion, WebGL ni la experiencia visual completa del navegador.

## Flujo Experimental

1. Registrar una observacion verificable.
2. Formular una hipotesis y una metrica de exito.
3. Ejecutar y conservar la linea base.
4. Realizar un cambio aislado.
5. Repetir exactamente las mismas mediciones.
6. Comparar tiempos, crecimiento, memoria e invariantes.
7. Adoptar, ajustar o descartar el cambio.
8. Registrar la decision en `observations.md`.

## Datos De Prueba

`dataset-generator.js` produce datos determinísticos sin depender del navegador.
La linea base principal usa un arbol balanceado de factor 4 y notas de 100
caracteres. La infraestructura tambien admite arboles estrella, cadenas
profundas, distribuciones mixtas y otros tamaños de nota.

Los tamaños oficiales iniciales son:

- 1,000 nodos: uso ya considerable.
- 10,000 nodos: universo grande.
- 50,000 nodos: prueba de crecimiento y limites.

## Que Se Mide

- Generacion del conjunto de datos.
- Tamaño serializado del mapa.
- Busqueda de nodos y mapas al final de los arreglos.
- Busqueda de hijos.
- Recorrido completo de descendientes.
- Dibujo de enlaces con un contexto Canvas simulado.
- Eliminacion de un subarbol.

`baseline-algorithms.js` conserva deliberadamente los algoritmos actuales de
`index.html`. Es una referencia medible, no una alternativa de produccion.

## Protocolo

- Ejecutar con Node y `--expose-gc`.
- Cerrar cargas pesadas ajenas antes de medir.
- Conservar version de Node, V8, sistema y configuracion dentro del JSON.
- Ejecutar un calentamiento fuera de las muestras antes de registrar tiempos.
- Comparar p50 y p95; no decidir usando solo una ejecucion.
- Usar el mismo equipo y la misma configuracion para comparar antes/despues.
- Tratar la memoria de Node como aproximacion relativa, no como consumo exacto
  del navegador.

El ejecutor acumula los resultados en un `blackhole` para que el motor no pueda
eliminar trabajo cuyo resultado parezca inutil.

## Limites De Seguridad

Los algoritmos cuadráticos pueden congelar una medicion grande sin aportar
informacion adicional. El ejecutor omite una prueba cuando sus comparaciones
estimadas superan `maxWork` y registra `guarded-skip`.

Una omision protegida significa: el algoritmo conocido excede el presupuesto de
trabajo para ese tamaño. No significa que el tiempo sea cero ni que la prueba
haya pasado.

El presupuesto inicial es 150,000,000 comparaciones primitivas. Puede elevarse
de forma consciente con `--max-work`, preferiblemente en una ejecucion aislada.

## Interpretacion

Los tiempos absolutos dependen del equipo. La señal principal es la forma de
crecimiento:

- Si multiplicar nodos por 10 multiplica tiempo cerca de 10, el comportamiento
  observado es aproximadamente lineal.
- Si lo multiplica cerca de 100, aparece comportamiento cuadrático.
- Superar 16.7 ms implica que una operacion sincrona puede consumir por si sola
  todo el presupuesto de un cuadro a 60 FPS.

Las pruebas de Canvas usan un contexto simulado. Aislan el costo de la logica y
las busquedas; el navegador añadirá el costo real de rasterizacion.

## Lote 2: Persistencia Y Respuesta Percibida

PERF-004 inicia una linea base separada para el recorrido que ocurre despues de
una accion compartida. No sustituye las mediciones de algoritmos del mapa
mental; busca saber cuanto cuesta convertir un cambio local en estado durable.

El recorrido medido es:

1. Capturar o clonar el workspace actual.
2. Separar el estado privado del dispositivo.
3. Registrar y aplicar la operacion compartida.
4. Persistir el estado compartido.
5. Persistir el estado privado.
6. Observar cuando el hilo principal y un cuadro vuelven a estar disponibles.

### Metricas De Tiempo

- `captureWorkspaceMs`: costo de obtener una copia del workspace posterior a la
  accion. En Node es una copia equivalente; no aisla trabajo del DOM.
- `captureDeviceMs`: costo de derivar el snapshot privado.
- `recordSharedChangeMs`: motor compartido completo, incluida la llamada al
  store correspondiente.
- `indexedDbSharedMs` o `sharedStoreMs`: tiempo observado dentro del store para
  el commit compartido.
- `saveDeviceStateMs`: guardado privado completo, incluida su llamada al store.
- `indexedDbDeviceMs` o `deviceStoreMs`: tiempo observado dentro del store para
  el snapshot privado.
- `commitCompleteMs`: desde el inicio de captura hasta terminar ambos guardados.
- `uiTaskResponseMs`: tiempo hasta que una tarea `setTimeout(0)` programada al
  comenzar puede ejecutarse. Aproxima cuanto permanece bloqueado el hilo.
- `firstFrameResponseMs`: tiempo hasta el primer `requestAnimationFrame`
  programado al comenzar.
- `postCommitFrameMs`: tiempo hasta el primer cuadro solicitado despues de que
  el commit completo termina.
- `serializationMs`: costo diagnostico de serializar snapshots y operaciones
  despues del commit; no esta incluido en `commitCompleteMs`.

### Interpretacion De Respuesta UI

`commitCompleteMs`, `uiTaskResponseMs` y `postCommitFrameMs` no son
intercambiables:

- Una escritura asincrona puede mantener el commit pendiente y permitir que la
  UI responda antes.
- Trabajo sincrono previo a la escritura bloquea tanto la tarea como el cuadro.
- Un cuadro posterior al commit incluye espera de planificacion del navegador.

Las pruebas automatizadas pueden ejecutarse con la pestana en segundo plano. En
ese estado, el navegador puede limitar `requestAnimationFrame` y producir
valores atipicos. Para decisiones de renderizado se debe repetir con la pestana
visible y complementar con perfiles de dispositivos modestos.

### Bytes Y Comparaciones

Los bytes reportados son la suma de `JSON.stringify()` para snapshot compartido,
snapshot privado y operaciones. Sirven para comparar crecimiento y cambios
relativos; IndexedDB usa structured clone y su consumo fisico puede diferir.

Cada optimizacion de este lote debe cambiar una sola causa estructural, conservar
los mismos escenarios y comparar contra `performance/results/perf-004-node.json`
y `performance/results/perf-004-browser.json`.

### Checkpoints Y Recuperacion

Los commits incrementales y checkpoints se miden por separado:

- El commit normal debe ser proporcional al delta.
- El checkpoint puede ser proporcional al snapshot completo, pero debe ser
  infrecuente y recuperable ante interrupciones.

Para aceptar un cambio de persistencia se debe verificar:

1. La operacion y sus metadatos se escriben atomicamente.
2. Un reinicio despues de guardar una operacion reconstruye el estado exacto.
3. Un fallo durante publicacion conserva el checkpoint anterior.
4. Un reinicio despues de publicar y antes de limpiar tolera operaciones
   redundantes.
5. Operaciones posteriores al checkpoint tambien se reproducen.
6. El crecimiento de checkpoints permanece acotado.
7. La migracion desde la version durable anterior no pierde datos.

### Mutacion Controlada

Una optimizacion mutable solo puede aceptarse si:

1. Produce el mismo resultado que la variante pura.
2. Mantiene idempotencia y convergencia.
3. Valida errores conocidos antes de modificar estado.
4. La referencia mutable permanece bajo propiedad exclusiva del motor.
5. Las APIs publicas de lectura siguen entregando copias cuando el consumidor
   no debe modificar el estado interno.
6. Se mide memoria transitoria ademas de latencia.

### Contrato De Persistencia Por Transaccion

Cada tipo de transaccion de la interfaz debe declarar explicitamente si cambia
estado compartido y si cambia estado privado. Un tipo nuevo no puede usar una
clasificacion por defecto: debe incorporarse al contrato y a sus pruebas.

PERF-007A compara dos rutas bajo el mismo conjunto de datos:

- Ruta anterior: deriva y guarda el `DeviceSnapshot` completo despues de cada
  cambio compartido.
- Ruta por contrato: omite derivacion y guardado privado cuando la accion no
  modifica seleccion, camara, mapa activo, vista o aliases locales.

Para aceptar la omision se debe verificar:

1. La operacion compartida sigue siendo durable.
2. No existe ninguna llamada a `saveDevice`.
3. Los bytes privados escritos son cero.
4. El `DeviceSnapshot` permanece identico.
5. La aplicacion reconstruye el mismo estado despues de reiniciar.

### Operaciones Compartidas Sin Captura Completa

PERF-007C permite una ruta rapida solamente cuando el motor esta inicializado,
los `syncId` requeridos existen y el payload contiene el delta completo. La
operacion construida debe ser equivalente a la traduccion basada en snapshot.

Si falta cualquier precondicion, la transaccion debe volver explicitamente a
la captura completa anterior. Para aceptar la ruta rapida se debe verificar:

1. Cero llamadas a captura completa en la ruta normal.
2. Fallback a captura completa con identidad o payload incompletos.
3. Operacion equivalente a la traduccion anterior.
4. Estado observable de la interfaz equivalente al snapshot compartido.
5. Reconstruccion exacta despues de reiniciar.
6. Idempotencia, convergencia y persistencia incremental intactas.

### Parches Privados Incrementales

PERF-007B conserva `device-current` como checkpoint privado inicial y agrega un
log `devicePatches` con una cabecera `privatePersistenceHead`. No introduce
compactacion, rotacion ni checkpoints privados nuevos durante interacciones
normales, para medir sin ocultar el costo real del crecimiento del log.

Cada parche tiene un aplicador explicito y modifica solamente su campo:

- `setActiveMap`: cambia solamente `activeMapSyncId`.
- `setSelectedNode`: cambia solamente la seleccion del mapa indicado.
- `setMapCamera`: cambia solamente camara y zoom del mapa indicado.
- `setConstellationView`: cambia solamente la vista de constelacion.

Los parches de una misma transaccion se guardan junto con revisiones
consecutivas y la cabecera privada dentro de una sola transaccion IndexedDB.
El motor los aplica optimistamente en memoria antes de esperar persistencia,
para que interacciones rapidas posteriores comparen contra el estado mas
reciente.

Para aceptar persistencia privada incremental se debe verificar:

1. Las interacciones normales realizan cero escrituras de `device-current`.
2. Los bytes escritos son proporcionales al parche, no al universo completo.
3. Revision, parches y cabecera privada se escriben atomicamente.
4. Campos omitidos permanecen intactos.
5. Replay ordenado y duplicado-seguro reconstruye exactamente el estado.
6. Un guardado privado completo establece una base nueva y limpia solamente
   los parches ya representados.
7. El crecimiento y tiempo de reinicio sin compactacion quedan medidos y se
   tratan como un experimento posterior separado.

### Coalescing Durable Privado

PERF-008A trata los parches privados como asignaciones de estado. Cada parche
se identifica por una clave estructural:

- `activeMap`
- `constellationView`
- `mapCamera:<mapSyncId>`
- `selectedNode:<mapSyncId>`

Una escritura nueva reemplaza inmediatamente el valor durable anterior de la
misma clave. Dentro de la misma transaccion se lee el registro anterior, se
calcula la diferencia de bytes, se escribe el reemplazo y se actualiza
`privatePersistenceHead`.

La revision global permanece monotona aunque el registro anterior desaparezca.
La cabecera representa el store actual:

- `patchCount`: cantidad actual de claves.
- `patchBytes`: bytes logicos actuales, descontando registros reemplazados.
- `revision`: ultima revision emitida por el dispositivo.

La migracion desde PERF-007B lee el historial append-only en orden, conserva el
ultimo parche por clave, recalcula cantidad y bytes, y conserva la revision
maxima. No crea un checkpoint privado nuevo.

Para aceptar el coalescing se debe verificar:

1. Reemplazar una clave sigue siendo durable inmediatamente.
2. Camara y seleccion del mismo mapa no se pisan.
3. Varios mapas conservan una camara y seleccion independientes.
4. Un aborto conserva parche y cabecera anteriores.
5. El replay reconstruye exactamente el ultimo estado.
6. La latencia interactiva de PERF-007B no regresa.
7. El crecimiento depende de claves estructurales y no de interacciones.

### Linea Base De Arranque Completo

PERF-009 es diagnostico. No introduce lazy loading, particionado, indices
persistidos ni culling. Separa el arranque en tres niveles:

1. Persistencia y motor.
2. Materializacion e hidratacion de la aplicacion.
3. Primer frame con datos y siguiente frame que confirma UI usable.

La medicion del navegador debe usar un origen controlado sin service workers
anteriores y un iframe visible. Un iframe oculto o una pestana en segundo plano
pueden provocar throttling de `requestAnimationFrame` y producir conclusiones
falsas.

Cada perfil registra spans, marcas y memoria cuando el navegador la expone.
Los spans anidados no son tiempos exclusivos y no deben sumarse directamente.
El tiempo hasta UI usable se mide con el primer `requestAnimationFrame`
posterior al frame inicial para incluir trabajo de rasterizacion/compositor que
no aparece dentro de las funciones JavaScript.

La comparacion minima incluye:

- 1,000, 10,000 y 50,000 nodos.
- Un mapa activo grande y el mismo universo repartido entre mapas menores.
- Checkpoint limpio, operaciones compartidas pendientes y parches privados
  estructurales.
- Primera navegacion y navegaciones repetidas.

La siguiente optimizacion debe atacar el mayor bloque medido, no una prioridad
definida antes de observar los resultados.

### Culling Lineal Conservador

PERF-010A1 mide solamente el costo y beneficio de clasificar linealmente el
mapa activo antes de dibujarlo. No modifica `updateNodes()`, simulacion,
interaccion, datos, nivel de detalle, cache, render progresivo ni introduce
indices espaciales.

La clasificacion trabaja en coordenadas de pantalla y debe ser conservadora:
es preferible dibujar elementos adicionales que ocultar etiquetas, halos o
enlaces visibles. Los nodos consideran cuerpo, seleccion, etiqueta y el halo
amplio de la estrella central. Los enlaces se conservan cuando su bounding box
ampliado intersecta el viewport, incluso si ambos extremos quedan fuera.

El laboratorio compara la ruta base y la ruta con culling sobre el mismo
universo y camara. Para aislar Canvas del renderer de la estrella, usa su
fallback 2D, retira cada iframe y espera dos frames fuera de la medicion antes
de iniciar la muestra siguiente.

Las camaras minimas son:

- `normal`: pocos nodos visibles.
- `dense`: miles de nodos y muchos enlaces visibles.
- `zoom-out`: casi todo visible.
- `empty`: ningun elemento visible.

Para aceptar PERF-010A1 se debe verificar:

1. Conteos de nodos y enlaces totales, considerados y dibujados.
2. Culling antes de construir geometria o llamar `drawNode()`.
3. Etiquetas, halos y enlaces cercanos al borde permanecen visibles.
4. Mejora fuerte con pocos elementos visibles.
5. Regresion acotada cuando casi todo es visible.
6. Costo aislado de clasificacion suficiente para decidir si hace falta un
   indice espacial posterior.

### Diagnostico Detallado De Enlaces

PERF-010B0 no cambia rechazo, cantidad de segmentos, estilos ni dibujo. Activa
una variante instrumentada de `drawLinks()` solamente durante el primer frame
del laboratorio y conserva intacta la ruta normal. El modulo diagnostico se
importa dinamicamente solo cuando `perfLinkDiagnostics=1`.

La medicion separa:

- Clasificacion de nodos y seleccion de candidatos de enlace.
- Resolucion/proyeccion de extremos.
- Generacion de puntos organicos.
- Construccion del path principal.
- Llamada a `stroke()`.
- Path y `stroke()` adicional de enlaces activos.
- Tiempo posterior al primer frame.

Despues de generar la geometria existente, una prueba diagnostica verifica si
la polilinea muestreada intersecta un viewport ampliado. Esta prueba no decide
que se dibuja: solo estima candidatos probablemente visibles e invisibles para
cuantificar el potencial de un rechazo anterior mas preciso.

Los tiempos internos incluyen el costo de temporizadores y de la prueba
diagnostica. Por eso sirven para atribucion relativa, pero el `drawLinks` total
de B0 no debe compararse directamente como regresion contra PERF-010A1.

Para aceptar PERF-010B0 se debe verificar:

1. La ruta normal no carga ni ejecuta el diagnostico.
2. El laboratorio conserva exactamente el resultado visual actual.
3. Tiempos atribuidos y no atribuidos quedan separados.
4. Se cuentan candidatos, enlaces visibles aproximados, segmentos, comandos y
   llamadas a `stroke()`.
5. El resultado permite priorizar rechazo, simplificacion o render progresivo
   sin implementar ninguno todavia.

### Rechazo Geometrico Conservador De Enlaces

PERF-010B1 compara la ruta productiva A1 contra una segunda prueba barata antes
de generar puntos organicos. Solo los enlaces que ya sobrevivieron al bounding
box A1 pasan por la prueba source-target contra un viewport ampliado.

El margen segmentario se deriva de la geometria actual:

```text
12 px visuales
+ velocidad maxima proyectada L1 * (18 normal + 6 tangencial)
+ zoom * 4
```

Esto es conservador porque cada desplazamiento organico usa como maximo 18
unidades normales y 6 tangenciales; la curva cuadratica permanece dentro de la
envolvente convexa de sus puntos de control. La prueba debe aceptar enlaces de
mas antes que ocultar uno visible.

La matriz oficial usa 50,000 nodos y las mismas camaras `normal`, `dense`,
`zoom-out` y `empty` de A1. Compara:

- enlaces aceptados por bounding box;
- enlaces rechazados por segmento;
- enlaces finalmente dibujados;
- costo de clasificacion;
- `drawLinks()` productivo;
- primer frame JavaScript.

Para aceptar PERF-010B1 se debe verificar:

1. Cero falsos negativos en pruebas deterministicas de curvas, cruces y zooms.
2. Reduccion fuerte de candidatos y `drawLinks()` en camara normal.
3. Mejora moderada en camara densa.
4. Regresion no significativa cuando todos los enlaces son visibles.
5. Ninguna simplificacion, agrupacion, cache o render progresivo mezclado.

### Diagnostico De Costo Por Enlace Visible

PERF-010B2A mantiene B1 activo y no cambia la ruta productiva. Instrumenta
solamente el primer frame del laboratorio y compara las siguientes ablaciones
no productivas:

- `current`: geometria y dibujo actuales.
- `points-only`: genera puntos sin emitir comandos Canvas.
- `path-no-stroke`: genera puntos y paths sin llamar `stroke()`.
- `straight`: reemplaza temporalmente cada curva por una linea.
- `reduced-segments`: limita temporalmente cada curva a ocho segmentos.
- `uniform-batch`: conserva puntos y paths, pero usa un solo estilo y stroke.
- `no-active`: elimina el tratamiento especial del enlace seleccionado.

Cada modo recibe exactamente los enlaces aceptados por B1. El orden de modos
rota entre muestras para reducir sesgo de calentamiento. Las metricas se
agregan por buckets, no por enlace:

- longitud proyectada: `<25`, `25-100`, `100-500`, `>=500` px;
- segmentos originales: `18`, `19-29`, `30-41`, `42`;
- desviacion estimada por velocidad: `<2`, `2-12`, `>=12` px.

Se miden resolucion de extremos, generacion de puntos, construccion de path,
`stroke()`, comandos, estilos y llamadas. Los tiempos absolutos incluyen
instrumentacion y sirven para atribucion relativa.

El siguiente `requestAnimationFrame` se conserva como observacion, pero no se
usa para atribuir compositor mientras el laboratorio visible presente
throttling erratico. Para aceptar B2A se debe obtener:

1. Conteos B1 identicos entre variantes.
2. Atribucion estable del costo sin activar cambios productivos.
3. Distribucion por longitud, segmentos y curvatura.
4. Una recomendacion concreta para B2B, 010C o 010A2.
5. Limitaciones de medicion registradas explicitamente.
