# Base local de sincronizacion

Esta carpeta contiene la primera fase del motor de sincronizacion de Contextus. No realiza peticiones de red ni vincula dispositivos reales.

## Separacion de estado

- `SharedSnapshot` contiene mapas, nodos, texto, relaciones, posiciones permanentes, versiones, tombstones, conflictos y recuperaciones.
- `DeviceSnapshot` contiene mapa activo, seleccion, camaras, zoom, vista de constelacion y alias numericos locales.
- Los mapas y nodos usan `syncId` global para sincronizacion. Los IDs numericos se conservan solamente para la interfaz existente.

## Modulos

- `workspace-model.js`: migracion, separacion y reconstruccion del estado de la aplicacion.
- `merge-engine.js`: aplicacion idempotente de operaciones, mezcla causal, conflictos, borrados y recuperaciones.
- `local-sync-engine.js`: interfaz neutral respecto al transporte, bundles y compactacion.
- `indexeddb-store.js`: IndexedDB v5, operaciones y parches privados
  incrementales, y checkpoints publicables atomicamente.
- `device-patches.js`: contrato, validacion, aplicacion y replay de parches
  privados.

## Interfaz del motor

`LocalSyncEngine` expone:

- `initialize()`
- `recordSharedChange(type, target, payload)`
- `recordDevicePatches(patches)`
- `saveDeviceState(deviceState)`
- `getManifest()`
- `exportBundle(peerManifest)`
- `importBundle(bundle)`
- `compact()`
- `getConflicts()`
- `resolveFieldConflict(conflictId, value)`
- `getRecoveries()`

Un bundle contiene operaciones faltantes o un snapshot compartido completo cuando el historial requerido ya fue compactado.

## Persistencia Compartida

- Cada cambio pequeño guarda solamente la operacion y una cabecera atomica con
  revision, secuencia y checkpoint padre.
- Al iniciar, se carga el checkpoint activo y se reproducen las operaciones
  posteriores de forma idempotente.
- La compactacion publica primero un checkpoint nuevo y limpia las operaciones
  representadas solamente despues del exito.
- Un corte entre publicacion y limpieza deja operaciones redundantes, pero no
  pierde estado.
- Se conservan el checkpoint dinamico activo y el anterior. Checkpoints
  dinamicos mas antiguos se retiran despues de confirmar la publicacion.
- `shared-current` permanece temporalmente como respaldo de adopcion de la
  generacion anterior.

## Persistencia Privada

- `device-current` es el checkpoint privado inicial.
- `devicePatches` conserva el ultimo cambio incremental por clave estructural:
  mapa activo, vista de constelacion, camara por mapa y seleccion por mapa.
- `privatePersistenceHead` conserva revision, cantidad y bytes representados.
- Cada reemplazo y la cabecera se escriben atomicamente y se reproducen al
  iniciar.
- La revision global avanza en cada escritura, mientras `patchCount` y
  `patchBytes` representan solamente las claves actualmente guardadas.
- Cada tipo de parche tiene un aplicador explicito; un campo omitido nunca
  reemplaza ni elimina otros campos privados.
- IndexedDB v4 se migra automaticamente desde el historial append-only al
  ultimo valor por clave, conservando la revision maxima.
- Un guardado privado completo existente establece una base nueva y limpia los
  parches ya representados.
- PERF-008A acota el log por estructura, aproximadamente `2 + mapas * 2`, sin
  crear checkpoints privados durante interacciones normales.

## Aplicacion De Operaciones

- `applyOperation()` conserva una API pura que devuelve una copia aplicada.
- `applyOperationMutable()` se usa internamente sobre el snapshot propiedad del
  motor para evitar clonar el universo completo en cada cambio.
- Las APIs publicas de lectura y exportacion continúan clonando el estado antes
  de entregarlo fuera del motor.

## Contrato De Persistencia De La Interfaz

`runtime/transaction-persistence.js` declara si cada transaccion de la interfaz
modifica estado compartido y/o privado. Los tipos desconocidos fallan hasta que
se tome una decision explicita.

| Transaccion | Compartido | Privado | Ruta compartida rapida | Parches privados rapidos |
| --- | --- | --- | --- | --- |
| `editNode` | si | no | si | no |
| `moveNode` | si | no | si | no |
| `moveConstellationMap` | si | no | si | no |
| `createMap` | si | si | no | no |
| `deleteMapAndSelectFallback` | si | si | no | no |
| `createNode` | si | si | no | no |
| `deleteNodeTree` | si | si | no | no |
| `switchMap` | no | si | no | si |
| `updateViewFrame` | no | si | no | si |

PERF-007A omite derivar y guardar `DeviceSnapshot` para las tres transacciones
exclusivamente compartidas. PERF-007C construye sus operaciones directamente
desde el payload y los `syncId` existentes, sin capturar el workspace completo.
Si falta cualquier precondicion, la interfaz vuelve a la ruta completa.
PERF-007B persiste `switchMap` y `updateViewFrame` mediante parches privados
incrementales. Crear y borrar conservan el guardado privado completo por ahora.

## Verificacion

Ejecutar las pruebas puras:

```powershell
node --test tests/sync-engine.test.mjs
```

Abrir el laboratorio desde un servidor local:

```text
http://localhost:8000/sync-lab/
```

El laboratorio utiliza bases IndexedDB separadas y no modifica el universo normal de Contextus.
