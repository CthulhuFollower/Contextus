# Traspaso Tecnico: Baseline Hasta PERF-010B2A

## Estado Congelado

Este documento describe el baseline aceptado de Contextus al cerrar
PERF-010B2A. La fase siguiente no debe comenzar hasta consolidar y revisar este
baseline.

Alcance congelado:

```text
ultimo experimento aceptado: PERF-010B2A
proxima propuesta: PERF-010B2B
optimizaciones nuevas durante consolidacion: ninguna
```

Objetivo de consolidacion:

> Conservar el estado aceptado hasta PERF-010B2A sin cambiar comportamiento
> productivo, dejando pruebas, resultados, documentacion y estructura
> experimental listos para continuar.

## Arquitectura Actual

### Aplicacion Productiva

- `index.html`: interfaz existente e integracion con persistencia,
  sincronizacion local, indices y render culling.
- `runtime/`: estructuras y contratos usados directamente por la aplicacion.
- `sync/`: modelo sincronizable, mezcla causal, persistencia IndexedDB y motor
  local neutral respecto al transporte.
- `service-worker.js`: app shell offline y release critica actual.
- `sync-lab/`: laboratorio manual de dos dispositivos, fuera del app shell.

### Diagnostico Y Pruebas

- `tests/`: suite automatica con `node:test`.
- `performance/`: infraestructura experimental, laboratorios y documentacion.
- `performance/results/`: destino local de reportes generados. Los JSON crudos
  no se versionan; las conclusiones aceptadas viven en `observations.md`.

## Cambios Productivos Activos

| Cambio | Estado |
| --- | --- |
| `nodesById` | Activo |
| `childrenByParentId` | Activo |
| Eliminacion adaptativa de subarboles en lote | Activa |
| Persistencia compartida incremental | Activa |
| Aplicacion mutable controlada del motor | Activa |
| Omision de persistencia privada en cambios compartidos puros | Activa |
| Operaciones compartidas frecuentes sin captura completa | Activa |
| Parches privados incrementales y coalescidos | Activos |
| Culling lineal conservador de nodos/enlaces | Activo |
| Rechazo segmentario conservador de enlaces B1 | Activo |
| Instrumentacion PERF-009/B0/B2A | Inactiva por defecto |
| Ablaciones PERF-010B2A | Solo diagnostico; nunca productivas |

## Matriz PERF A Implementacion

Esta matriz distingue los cambios que forman parte de la ruta productiva de los
experimentos que solo dejaron mediciones o diagnosticos. `index.html` integra
los modulos productivos indicados; no contiene por si solo toda la
implementacion.

| Experimento | Estado actual | Archivos productivos principales | Verificacion principal |
| --- | --- | --- | --- |
| PERF-000 | Solo linea base | Ninguno | `performance/`, `performance/results/` |
| PERF-001 | Productivo | `index.html`, `runtime/node-index.js` | `tests/node-index.test.mjs` |
| PERF-002 | Productivo | `index.html`, `runtime/node-index.js` | `tests/children-index.test.mjs` |
| PERF-003 | Productivo | `index.html`, `runtime/batch-delete.js` | `tests/batch-delete.test.mjs` |
| PERF-004 | Solo medicion | Ninguno; infraestructura de benchmark | `tests/perf-004-infrastructure.test.mjs` |
| PERF-005 | Productivo | `index.html`, `sync/indexeddb-store.js`, `sync/local-sync-engine.js` | `tests/incremental-persistence.test.mjs` |
| PERF-006 | Productivo | `sync/merge-engine.js`, `sync/local-sync-engine.js` | `tests/mutable-merge-engine.test.mjs` |
| PERF-007A | Productivo | `index.html`, `runtime/transaction-persistence.js` | `tests/transaction-persistence.test.mjs`, `tests/perf-007a-infrastructure.test.mjs` |
| PERF-007C | Productivo | `index.html`, `runtime/transaction-persistence.js` | `tests/perf-007c-infrastructure.test.mjs` |
| PERF-007B | Productivo | `index.html`, `sync/device-patches.js`, `sync/indexeddb-store.js`, `sync/local-sync-engine.js` | `tests/private-incremental-persistence.test.mjs` |
| PERF-008A | Productivo | `sync/device-patches.js`, `sync/indexeddb-store.js` | `tests/device-patches.test.mjs`, `tests/private-incremental-persistence.test.mjs` |
| PERF-009 | Diagnostico inactivo por defecto | `index.html`, `runtime/startup-profiler.js` | `tests/perf-009-infrastructure.test.mjs` |
| PERF-010A1 | Productivo, activo por defecto | `index.html`, `runtime/render-culling.js` | `tests/render-culling.test.mjs`, `tests/perf-010a1-infrastructure.test.mjs` |
| PERF-010B0 | Diagnostico inactivo por defecto | `index.html`, `runtime/link-render-diagnostics.js` | `tests/link-render-diagnostics.test.mjs`, `tests/perf-010b0-infrastructure.test.mjs` |
| PERF-010B1 | Productivo, activo por defecto | `index.html`, `runtime/render-culling.js` | `tests/render-culling.test.mjs`, `tests/perf-010b1-infrastructure.test.mjs` |
| PERF-010B2A | Diagnostico y ablaciones inactivos por defecto | `index.html`, `runtime/link-cost-diagnostics.js` | `tests/link-cost-diagnostics.test.mjs`, `tests/perf-010b2a-infrastructure.test.mjs` |
| PERF-010B2B | No implementado | Ninguno | Ninguna |

Archivos transversales que no pertenecen a un unico PERF:

- `sync/workspace-model.js`: separacion, migracion y materializacion del
  workspace sincronizable.
- `service-worker.js`: publica el app shell productivo offline; no incluye
  laboratorios ni modulos diagnosticos dinamicos.
- `sync-lab/`: verifica manualmente sincronizacion entre dos dispositivos, pero
  no forma parte de la aplicacion productiva ni del app shell.

## Experimentos Y Decisiones

| Experimento | Decision principal |
| --- | --- |
| PERF-000 | Linea base: varias rutas eran lineales o cuadraticas. |
| PERF-001 | Adoptar `nodesById`. |
| PERF-002 | Adoptar `childrenByParentId`. |
| PERF-003 | Adoptar eliminacion adaptativa en lote. |
| PERF-004 | Medir commit, persistencia y respuesta percibida. |
| PERF-005 | Adoptar persistencia compartida incremental. |
| PERF-006 | Adoptar aplicacion mutable controlada. |
| PERF-007A | No guardar estado privado cuando no cambia. |
| PERF-007C | Evitar captura completa en edit/move frecuentes. |
| PERF-007B | Adoptar parches privados incrementales. |
| PERF-008A | Adoptar coalescing privado durable por clave. |
| PERF-009 | El cuello dominante de arranque era render del mapa activo grande. |
| PERF-010A1 | Adoptar culling lineal conservador. |
| PERF-010B0 | El costo dominante empieza despues de aceptar enlaces. |
| PERF-010B1 | Adoptar rechazo segmentario conservador. |
| PERF-010B2A | Puntos dominan normal/densa; `stroke()` domina zoom lejano. |

Detalles, tablas y riesgos viven en `observations.md`.

## Resultados Principales

### Interacciones Frecuentes Con 50,000 Nodos

La cadena PERF-005 a PERF-008A dejo edicion, movimiento, seleccion y camara con
costo proporcional al delta, no al universo completo.

Ejemplos aceptados:

```text
editar texto:
commit 327.8 ms en PERF-004 -> 1.6 ms en PERF-007C
UI     225.6 ms en PERF-004 -> 6.5 ms en PERF-007C

parches privados:
~1.03 MB por accion completa -> ~300-360 bytes por parche
1,000 cambios de camara -> 1 parche durable por clave
```

### Render De Enlaces Con 50,000 Nodos

PERF-010B1, valores p50:

| Camara | Enlaces A1 -> B1 | DrawLinks A1 -> B1 |
| --- | ---: | ---: |
| Normal | 19,780 -> 8,340 | 148.5 -> 62.4 ms |
| Densa | 35,710 -> 28,594 | 266.6 -> 198.1 ms |
| Zoom lejano | 49,999 -> 49,999 | 401.0 -> 398.6 ms |

PERF-010B2A encontro:

- 99.98% de los enlaces normales y 98.1% de los densos usan 42 segmentos.
- Todos los enlaces medidos quedaron bajo 2 px de curvatura estimada.
- Puntos organicos dominan normal/densa.
- `stroke()` domina zoom lejano.
- Una reduccion fija a ocho segmentos mejora mucho, pero es solo diagnostica y
  no constituye una politica visual segura.

## Invariantes Criticas

### Sincronizacion Y Persistencia

1. El estado compartido contiene contenido y posiciones permanentes.
2. Camara, zoom, seleccion y mapa activo permanecen privados por dispositivo.
3. Cambios concurrentes de texto conservan ambas versiones.
4. Borrados concurrentes preservan trabajo nuevo dentro de recuperaciones.
5. Operacion y cabecera se escriben atomicamente.
6. Los fast paths deben caer a captura completa si falta una precondicion.
7. La aplicacion y el motor no realizan comunicacion de red.
8. Tombstones, conflictos y recuperaciones no se descartan silenciosamente.

### Render

1. El culling debe ser conservador: aceptar elementos extra antes que ocultar
   elementos visibles.
2. B1 depende de los limites actuales de `organicPointOnLink`; si cambia esa
   geometria, debe revalidarse el margen segmentario.
3. Los flags diagnosticos no deben alterar la ruta normal.
4. Ninguna ablacion B2A puede activarse como comportamiento productivo sin un
   experimento nuevo y validacion visual.

## Flags De Diagnostico

Todos viven en query string. Los flags de diagnostico requieren
`perfStartup=1`.

| Flag | Efecto |
| --- | --- |
| `perfStartup=1` | Activa perfil de arranque y desactiva registro SW durante la medicion. |
| `perfStartupDb=<name>` | Usa una base IndexedDB aislada para el perfil. |
| `perfStartupRun=<id>` | Identifica el reporte emitido. |
| `perfRenderCulling=0` | Desactiva A1 para comparacion. |
| `perfLinkSegmentCulling=0` | Desactiva B1 para comparacion. |
| `perfDisableStarWebGL=1` | Aisla Canvas usando fallback de estrella. |
| `perfLinkDiagnostics=1` | Activa diagnostico B0. |
| `perfLinkCostDiagnostics=1` | Activa diagnostico B2A. |
| `perfLinkCostMode=<mode>` | Selecciona una ablacion B2A no productiva. |

## Verificacion Requerida

Suite completa:

```powershell
node --test tests/*.test.mjs
```

Estado al cerrar PERF-010B2A:

```text
98 pruebas aprobadas
PWA normal verificada
recarga completamente offline verificada
errores de consola: ninguno
```

Laboratorio de sincronizacion:

```text
http://localhost:8000/sync-lab/
```

Comandos y URLs de rendimiento viven en `performance/README.md`.

## Deudas Conocidas

- `index.html` sigue concentrando integracion, estado y render. Extraer mas
  codigo requiere una fase funcional separada, no mezclarla con rendimiento.
- Crear/borrar todavia puede usar captura/guardado privado completo.
- Tombstones, recuperaciones y checkpoints requieren fases posteriores.
- Clasificar 50,000 nodos/enlaces linealmente cuesta alrededor de 25-30 ms.
- Renderizar muchos enlaces visibles continua siendo costoso.
- El laboratorio actual no atribuye compositor diferido de forma fiable por
  throttling erratico de `requestAnimationFrame`.
- `performance/` conserva la estructura plana historica para no romper rutas.

## Siguiente Objetivo Recomendado

No iniciar durante consolidacion.

```text
PERF-010B2B: Geometria Adaptativa De Enlaces
```

Hipotesis:

> Enlaces con error visual y curvatura bajos pueden usar una primitiva mas
> simple, conservando la curva actual como fallback, para reducir puntos,
> comandos y complejidad de `stroke()` sin degradacion visual observable.

Restricciones:

- No mezclar batching, indice espacial ni render progresivo.
- Incluir fixtures con movimiento y curvatura media/alta.
- Definir y medir error visual antes de elegir umbrales.
- Mantener fallback de geometria actual.

## Estado Git Para Baseline

El baseline parte de:

```text
rama: main
commit previo: a664c0a Bug visual corregido.
```

Antes de continuar desde este baseline:

1. Ejecutar suite completa y PWA offline.
2. Revisar el diff productivo de `index.html`, `runtime/`, `sync/` y
   `service-worker.js`.
3. Generar reportes nuevos dentro de `performance/results/` cuando un
   experimento lo requiera.
4. Registrar conclusiones aceptadas en `observations.md`; no versionar JSON
   crudos.
