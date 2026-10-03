# Notas de desarrollo

El README de este proyecto es una landing comercial a propósito. Lo técnico va acá.

## Correr la demo

```bash
npm install
npm run dev      # http://localhost:5174
```

```bash
npm run build    # chequeo de tipos + build estático en dist/
npm run preview  # sirve dist/ para verificar el build
```

`dist/` es estático puro: se publica en Netlify, Vercel o GitHub Pages sin servidor. El build usa
rutas relativas (`base: './'`), así que también funciona servido desde un subdirectorio.

## Cómo está armado

La aplicación es **el mismo frontend del proyecto real**, sin reescribir: `public/app.js`,
`public/operations.js`, `public/persistence.js` y `public/style.css` son copias de `dist/` del
proyecto original. Vite los sirve tal cual desde `public/`; no se bundlean ni se transpilan.

Lo único que cambia respecto del original es la última línea de `public/operations.js`, que espera
a que la capa simulada esté instalada antes de arrancar la aplicación.

Todo lo nuevo vive en `src/` y está en TypeScript:

| Carpeta | Qué hace |
|---|---|
| `src/mocks/http.ts` | Reemplaza `window.fetch` para `/api/*` con el mismo router que `server.py` |
| `src/mocks/socket.ts` | Reemplaza `window.WebSocket` para la consola |
| `src/mocks/shell.ts` | Intérprete de comandos del servidor simulado |
| `src/mocks/jobs.ts` | Motor de operaciones: salida en vivo, cancelación, efectos al terminar |
| `src/mocks/store.ts` | Estado en memoria + espejo en `localStorage` |
| `src/mocks/seeds/` | Los tres escenarios y las fábricas de datos |
| `src/demo/` | Badge, pantalla de entrada, panel flotante y avisos de "operación simulada" |

Los componentes nunca saben que están contra un mock: la sustitución es a nivel de transporte, no
de servicios, así que `api()` y el WebSocket del terminal funcionan sin un solo cambio.

## Orden de arranque

Cada HTML tiene, en este orden:

1. Un `<script>` inline que crea `window.__demoLista` (una promesa).
2. Los scripts clásicos del frontend original, con `defer`.
3. `src/install.ts` como módulo, que instala los mocks y resuelve la promesa.

Hace falta porque Vite mueve los módulos al final del `<head>`, después de los scripts clásicos.

## Regenerar las capturas

Playwright no está en las dependencias para que `npm install` siga siendo liviano:

```bash
npm install -D playwright && npx playwright install chromium
npm run dev
node scripts/capturas.mjs
```

Las capturas van a `docs/screenshots/`, en el orden en que aparecen en el README.
