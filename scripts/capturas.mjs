/**
 * Genera las capturas de docs/screenshots navegando la demo de verdad.
 *
 * Playwright no está en las dependencias del proyecto para que `npm install` siga siendo
 * liviano. Para correr este script:
 *
 *   npm install -D playwright && npx playwright install chromium
 *   npm run dev            (en otra terminal)
 *   node scripts/capturas.mjs
 *
 * Variables opcionales: URL (por defecto http://localhost:5174) y PW (ruta a playwright).
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = resolve(RAIZ, 'docs/screenshots');
const URL_BASE = process.env.URL || 'http://localhost:5174';
import { createRequire } from 'node:module';
const { chromium } = process.env.PW
  ? createRequire(import.meta.url)(process.env.PW)
  : await import('playwright');

const esperar = ms => new Promise(r => setTimeout(r, ms));

await mkdir(DESTINO, { recursive: true });

const navegador = await chromium.launch();
const contexto = await navegador.newContext({
  viewport: { width: 1480, height: 940 },
  deviceScaleFactor: 2,
  locale: 'es-UY',
  timezoneId: 'America/Montevideo',
});
const pagina = await contexto.newPage();

/** Entra con un escenario sin pasar por la pantalla de selección. */
async function entrarComo(escenario) {
  await pagina.goto(`${URL_BASE}/projects.html`, { waitUntil: 'domcontentloaded' });
  await pagina.evaluate(id => {
    localStorage.clear();
    localStorage.setItem('demo-devpanel-opciones', JSON.stringify({ escenario: id, fallas: 0, latencia: false }));
    localStorage.setItem('demo-devpanel-entro', '1');
    localStorage.setItem('demo-devpanel-avisos', JSON.stringify(['job:deploy', 'job:backup', 'job:restore', 'job:logs', 'job:action']));
  }, escenario);
  await pagina.goto(`${URL_BASE}/projects.html`, { waitUntil: 'networkidle' });
  await esperar(900);
}

async function capturar(nombre) {
  await esperar(500);
  await pagina.screenshot({ path: resolve(DESTINO, `${nombre}.png`) });
  console.log('✓', `${nombre}.png`);
}

/** Navega por la ruta interna de la aplicación. */
const ir = async pagina_ => {
  await pagina.evaluate(p => navigate(p), pagina_);
  await esperar(1100);
};

// --- 1 · Pantalla de entrada ------------------------------------------------
await pagina.goto(`${URL_BASE}/projects.html`, { waitUntil: 'domcontentloaded' });
await pagina.evaluate(() => localStorage.clear());
await pagina.goto(`${URL_BASE}/projects.html`, { waitUntil: 'networkidle' });
await pagina.waitForSelector('.demo-tarjeta');
await capturar('01-entrada');

// --- 2 · Todos los proyectos ------------------------------------------------
await entrarComo('equipo');
await capturar('02-proyectos');

// --- 3 · Panel con deploy en vivo -------------------------------------------
await pagina.evaluate(() => selectProject('mutualista', 'panel'));
await esperar(1200);
await capturar('03-panel');

await pagina.evaluate(() => startJob({ kind: 'deploy', target: 'staging', version: 'v3.2.0' }));
await esperar(3600);
await pagina.evaluate(() => document.querySelector('#execution')?.scrollIntoView({ block: 'center' }));
await capturar('04-deploy-en-vivo');
await pagina.waitForFunction(() => !jobs['mutualista'], null, { timeout: 30000 });
await esperar(800);

// --- 4 · Versiones por destino ----------------------------------------------
await ir('versions');
await capturar('05-versiones');

// --- 5 · Backups -------------------------------------------------------------
await ir('panel');
await pagina.evaluate(() => document.querySelector('[data-action="refresh-backups"]')?.scrollIntoView({ block: 'center' }));
await esperar(700);
await capturar('06-backups');

// --- 6 · Logs con el visor cargado ------------------------------------------
await ir('logs');
await pagina.evaluate(() => {
  document.querySelectorAll('.log-check').forEach((c, i) => { if (i < 2) c.checked = true; });
  document.querySelector('[data-action="filter-logs"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await esperar(1800);
await pagina.evaluate(() => document.querySelector('.log-viewer')?.scrollIntoView({ block: 'center' }));
await capturar('07-logs');

// --- 7 · Consola remota ------------------------------------------------------
await ir('console');
await pagina.evaluate(() => document.querySelector('[data-action="terminal-connect"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await esperar(2000);
for (const comando of ['pm2 status', 'cat VERSION', 'df -h']) {
  await pagina.evaluate(texto => {
    const s = terminalFor(state.project, dest().id);
    const cod = new TextEncoder();
    for (const ch of texto) s.ws.send(cod.encode(ch));
    s.ws.send(cod.encode('\r'));
  }, comando);
  await esperar(900);
}
await capturar('08-consola');

// --- 8 · Configuración -------------------------------------------------------
await ir('settings');
await pagina.evaluate(() => {
  state.configTab = 'targets';
  render();
});
await esperar(900);
await capturar('09-configuracion');

// --- 9 · Panel de la demo ----------------------------------------------------
await ir('panel');
await pagina.evaluate(() => document.querySelector('.demo-fab')?.click());
await esperar(600);
await capturar('10-panel-demo');

await navegador.close();
console.log(`\nCapturas en ${DESTINO}`);
