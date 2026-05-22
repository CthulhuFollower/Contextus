# Contextus

Contextus es una herramienta personal de gestión de mapas mentales diseñada como una experiencia digital inmersiva, no como un gestor tradicional de ficheros. Su propuesta es convertir las ideas en un espacio vivo: una constelación que crece con el uso, donde los mapas, nodos y relaciones se sienten como estrellas, sistemas y trayectorias dentro de un entorno de exploración.

La aplicación ya está disponible en producción como PWA en [contextus.fazpats.com](https://contextus.fazpats.com/). Funciona en el navegador, soporta modo offline después de la primera carga y utiliza una visualización sensorial basada en canvas, WebGL y three.js para representar la estrella central D0 y la navegación entre mapas.

## Descripción

Contextus nace como una alternativa más orgánica para pensar, ordenar y expandir ideas. En lugar de presentar carpetas, archivos o listas rígidas, propone una interfaz espacial donde cada pensamiento puede abrir nuevas conexiones y cada mapa puede formar parte de una constelación mayor.

El objetivo principal del proyecto es que organizar información se sienta como explorar un sistema en crecimiento: mover nodos, acercarse, alejarse, editar ideas, crear nuevos mapas y navegar entre ellos dentro de una atmósfera visual continua. La experiencia está pensada para ser fluida, táctil y expresiva, especialmente útil como pieza de portafolio para desarrollo web, frontend creativo y programación general.

## Características

- Mapa mental interactivo con nodos conectados, edición de títulos y notas.
- Experiencia visual orgánica: estrellas, brillo, movimiento, profundidad y crecimiento progresivo.
- Visualización 3D de la estrella D0 con three.js y WebGL.
- Navegación inmersiva entre mapas mediante una constelación visual.
- Interacción fluida con mouse, touch, drag, zoom y gestos de exploración.
- PWA instalable con `manifest.webmanifest`.
- Modo offline mediante `service-worker.js` y Cache API.
- Persistencia local-first con IndexedDB y migración desde localStorage.
- Aplicación estática sin backend obligatorio ni proceso de build.
- Diseño responsive con soporte para móviles, pantallas táctiles y áreas seguras del viewport.

## Tecnologías

- **HTML5**: estructura principal de la aplicación en `index.html`.
- **CSS3**: interfaz responsive, overlays, paneles flotantes, animaciones visuales y adaptación móvil.
- **JavaScript vanilla**: lógica de interacción, render, persistencia y estado de la aplicación.
- **Canvas 2D**: renderizado del mapa mental, fondo, nodos, enlaces y constelación de mapas.
- **three.js**: motor 3D para la estrella animada D0 y efectos WebGL.
- **WebGL**: renderizado acelerado por GPU para la experiencia estelar.
- **ES Modules e Import Maps**: carga modular de `three` y del motor de estrella offline.
- **Service Worker**: cacheo del app shell y soporte offline.
- **Web App Manifest**: configuración PWA, iconos, nombre, tema e instalación.
- **IndexedDB**: almacenamiento local de snapshots, transacciones y metadatos.
- **localStorage**: compatibilidad y migración de estados anteriores.
- **PWA**: ejecución instalable, local-first y preparada para uso sin conexión.

## Instalación

Clona el repositorio:

```bash
git clone https://github.com/CthulhuFollower/Contextus.git
cd Contextus
```

Contextus no requiere instalación de dependencias ni paso de compilación. Es una aplicación web estática, pero debe servirse por HTTP para que los módulos, el service worker y el comportamiento PWA funcionen correctamente.

Opción con Python:

```bash
python -m http.server 8000
```

En Windows también puedes usar:

```powershell
py -m http.server 8000
```

Opción con Node.js:

```bash
npx serve .
```

Después abre:

```text
http://localhost:8000
```

## Uso

1. Abre la aplicación en el navegador.
2. Usa el botón `+` para crear nuevos nodos en el mapa activo.
3. Arrastra nodos para reorganizar ideas y conexiones.
4. Haz zoom o desplázate por el canvas para explorar el mapa.
5. Haz doble clic o doble toque sobre un nodo para editar su título y nota.
6. Abre la constelación de mapas para navegar entre sistemas, crear nuevos mapas o reorganizarlos.
7. Instala la PWA desde el navegador si quieres usarla como aplicación independiente.

Para probar el modo offline:

1. Abre la aplicación una vez con conexión.
2. Espera a que el service worker registre y cachee el app shell.
3. Desactiva la conexión o usa el modo offline en DevTools.
4. Recarga la página y verifica que la aplicación siga disponible.

## Estado del proyecto

Contextus está en desarrollo activo. El proyecto ya cuenta con una experiencia funcional en producción, persistencia local, navegación entre mapas, visualización 3D y soporte PWA, pero sigue evolucionando como producto personal y pieza de portafolio.

Es especialmente relevante para mostrar habilidades de:

- Desarrollo frontend con JavaScript moderno.
- Diseño de experiencias interactivas en canvas y WebGL.
- Construcción de PWAs offline-first.
- Arquitectura local-first con persistencia en navegador.
- Cuidado visual, interacción táctil y experiencia de usuario.

## Demo

La versión publicada puede probarse aquí:

[https://contextus.fazpats.com/](https://contextus.fazpats.com/)

Para validar la versión en producción:

1. Abre la URL en un navegador moderno.
2. Crea, edita y mueve nodos dentro del mapa.
3. Abre la constelación de mapas y navega entre sistemas.
4. Instala la PWA desde el navegador.
5. Prueba el comportamiento offline después de una primera carga completa.

## Contribuir

Contextus es un proyecto personal, pero las ideas, sugerencias y mejoras son bienvenidas.

Para proponer cambios:

1. Crea un fork del repositorio.
2. Abre una rama descriptiva.
3. Realiza cambios pequeños y enfocados.
4. Prueba la aplicación localmente.
5. Abre un pull request explicando el objetivo del cambio.

Áreas interesantes para contribuir incluyen mejoras de accesibilidad, rendimiento, persistencia, interacción móvil, documentación y experiencia visual.

## Licencia

Este repositorio aún no incluye un archivo de licencia. Hasta que se agregue una licencia explícita, el proyecto debe considerarse como código de portafolio personal con todos los derechos reservados por su autor.
