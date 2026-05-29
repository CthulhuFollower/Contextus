# Contextus

Contextus es una aplicación web para crear y explorar mapas mentales desde una experiencia visual, fluida y local-first. El proyecto propone una forma más orgánica de organizar ideas: en lugar de trabajar con carpetas, listas o archivos, el usuario navega por nodos, mapas y constelaciones dentro de una interfaz inspirada en sistemas estelares.

La aplicación está construida como un sitio estático con HTML, CSS y JavaScript vanilla. Incluye soporte PWA, persistencia en el navegador, modo offline y una visualización 3D de la estrella central D0 mediante three.js y WebGL.

## Descripción

El propósito de Contextus es ayudar a estructurar pensamientos, notas y relaciones de manera espacial. Cada mapa funciona como un sistema de ideas conectado por nodos, mientras que la vista de constelación permite moverse entre distintos mapas como si fueran estrellas dentro de un universo personal.

El foco del proyecto no está en administrar ficheros, sino en construir una experiencia de exploración: crear nodos, moverlos, editarlos, acercarse, alejarse, cambiar de mapa y dejar que el espacio crezca con el uso. Por su enfoque visual e interactivo, también funciona como pieza de portafolio para mostrar habilidades de frontend, JavaScript moderno, canvas, PWA y WebGL.

## Características

- Creación, edición, movimiento y eliminación de nodos.
- Mapas mentales con relaciones visuales entre nodos.
- Vista de constelación para navegar entre múltiples mapas.
- Creación, selección, reorganización y eliminación de mapas.
- Interacción fluida con mouse, touch, drag, zoom, doble clic y gestos táctiles.
- Editor flotante para títulos y notas de nodos.
- Persistencia local-first con IndexedDB.
- Migración y compatibilidad con estados anteriores guardados en localStorage.
- Modo offline mediante service worker y Cache API.
- Instalación como PWA mediante `manifest.webmanifest`.
- Visualización 3D de la estrella central D0 con three.js y WebGL.
- Renderizado principal sobre canvas 2D.
- Diseño responsive con soporte para dispositivos móviles, pantallas táctiles y áreas seguras del viewport.

## Tecnologías

- **HTML5**: estructura principal de la aplicación en `index.html`.
- **CSS3**: estilos, layout responsive, overlays, paneles flotantes y adaptación móvil.
- **JavaScript vanilla**: lógica de interacción, estado, renderizado y persistencia.
- **Canvas 2D**: render del mapa mental, nodos, conexiones, fondos y constelación de mapas.
- **three.js**: motor 3D usado para la estrella animada.
- **WebGL**: render acelerado por GPU para la visualización estelar.
- **ES Modules**: carga modular de `motor-estrella-offline.js`.
- **Import Maps**: alias local para importar `three` desde `vendor/three/three.module.js`.
- **Service Worker**: cache del app shell y soporte offline.
- **Cache API**: almacenamiento de recursos estáticos para navegación sin conexión.
- **Web App Manifest**: configuración de PWA, iconos, tema y modo standalone.
- **IndexedDB**: almacenamiento local de snapshots, transacciones y metadatos.
- **localStorage**: lectura de estados legacy y migración hacia la persistencia actual.

## Instalación

Clona el repositorio:

```bash
git clone https://github.com/CthulhuFollower/Contextus.git
cd Contextus
```

El proyecto no incluye `package.json`, dependencias npm ni proceso de compilación. Para ejecutarlo correctamente, sí conviene servirlo por HTTP, ya que los módulos ES y el service worker funcionan mejor desde `localhost` o un origen seguro.

Con Python:

```bash
python -m http.server 8000
```

En Windows, si `python` no está disponible como comando:

```powershell
py -m http.server 8000
```

Después abre:

```text
http://localhost:8000
```

También puedes usar cualquier servidor estático equivalente.

## Uso

1. Abre la aplicación en el navegador.
2. Usa el botón `+` para agregar nodos al mapa actual.
3. Selecciona y arrastra nodos para reorganizar el mapa mental.
4. Usa scroll, pinch o gestos táctiles para hacer zoom y navegar por el espacio.
5. Haz doble clic o doble toque sobre un nodo para editar su título y nota.
6. Abre la vista de constelación para navegar entre mapas.
7. Crea nuevos mapas desde la constelación y ubícalos dentro del espacio visual.
8. Instala la aplicación como PWA desde el navegador si quieres usarla en modo standalone.

Para probar el modo offline:

1. Ejecuta o abre la aplicación una vez con conexión.
2. Espera a que el service worker registre y cachee los recursos principales.
3. Desactiva la conexión o usa el modo offline de DevTools.
4. Recarga la página y comprueba que el app shell siga disponible.

## Scripts Disponibles

El repositorio no define scripts automatizados porque no incluye `package.json`.

Comandos útiles para desarrollo local:

```bash
python -m http.server 8000
```

```powershell
py -m http.server 8000
```

No hay comandos de build, test o lint configurados actualmente en el proyecto.

## Estructura Del Proyecto

```text
.
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── motor-estrella-offline.js
├── icon.svg
├── icon-192.png
├── icon-512.png
├── apple-touch-icon.png
└── vendor/
    └── three/
        ├── three.module.js
        ├── three.core.js
        └── OrbitControls.js
```

Archivos principales:

- `index.html`: contiene la interfaz, estilos, lógica principal, render 2D, estado e interacción.
- `motor-estrella-offline.js`: módulo separado para la estrella animada basada en three.js.
- `service-worker.js`: registra el cache del app shell y resuelve navegación offline.
- `manifest.webmanifest`: define metadatos PWA, iconos, colores y modo standalone.
- `vendor/three/`: copia local de three.js usada por import maps.

## Estado Del Proyecto

Contextus está en desarrollo activo. La base funcional ya incluye mapas, nodos, navegación por constelación, persistencia local, experiencia PWA, soporte offline y visualización 3D.

Áreas que podrían seguir evolucionando:

- Accesibilidad y navegación por teclado.
- Documentación técnica más detallada.
- Pruebas automatizadas.
- Exportación/importación de datos.
- Sincronización opcional entre dispositivos.
- Optimización adicional para dispositivos de bajo rendimiento.

Como proyecto de portafolio, demuestra trabajo con interfaces interactivas, renderizado en canvas, WebGL, PWA, persistencia en navegador y diseño de experiencias frontend no convencionales.

## Demo

La aplicación está publicada en:

[https://contextus.fazpats.com/](https://contextus.fazpats.com/)

Para probar la versión en producción:

1. Abre la URL en un navegador moderno.
2. Crea, edita y mueve nodos.
3. Entra a la constelación de mapas y cambia entre sistemas.
4. Instala la PWA desde el navegador, si la opción está disponible.
5. Prueba el modo offline después de una primera carga completa.

## Contribuir

Contextus es un proyecto personal, pero se aceptan ideas, sugerencias y mejoras enfocadas.

Flujo recomendado:

1. Crea un fork del repositorio.
2. Abre una rama con un nombre descriptivo.
3. Realiza cambios pequeños y claros.
4. Prueba la aplicación localmente desde un servidor estático.
5. Abre un pull request explicando el propósito del cambio.

Son especialmente útiles las mejoras relacionadas con accesibilidad, rendimiento, experiencia móvil, persistencia, documentación y calidad visual.

## Licencia

Este repositorio no incluye actualmente un archivo de licencia. Hasta que se agregue una licencia explícita, el código debe considerarse como un proyecto personal de portafolio con todos los derechos reservados por su autor.
