// Interfaz propia de la demo: badge, pantalla de entrada con perfiles y botón flotante.
// Vive fuera de #app, así que sobrevive a los render() de la aplicación.
import './estilos.css';
import { escenarios, guardarOpciones, hayDatosGuardados, opciones, reiniciar } from '../mocks/store';
import { detenerTodo } from '../mocks/jobs';
import type { Escenario } from '../mocks/tipos';

const ICONOS = {
  terminal: 'm4 5 7 7-7 7m10 0h6',
  check: 'm5 12 4 4L19 6',
  ajustes: 'M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2zM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  cerrar: 'm6 6 12 12M6 18 18 6',
  flecha: 'M4 12h16m-6-6 6 6-6 6',
  refrescar: 'M20 8a8 8 0 1 0 0 8m0-13v5h-5',
};

const icono = (n: keyof typeof ICONOS) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONOS[n]}"/></svg>`;

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const CLAVE_ENTRO = 'demo-devpanel-entro';
const yaEntro = () => { try { return !!localStorage.getItem(CLAVE_ENTRO); } catch { return false; } };
const marcarEntrada = () => { try { localStorage.setItem(CLAVE_ENTRO, '1'); } catch { /* da igual */ } };

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export function montarBadge() {
  const badge = document.createElement('div');
  badge.className = 'demo-badge';
  badge.textContent = 'DEMO';
  badge.title = 'Versión de demostración: no hay servidor, todo corre en tu navegador.';
  document.body.appendChild(badge);
}

// ---------------------------------------------------------------------------
// Pantalla de entrada
// ---------------------------------------------------------------------------

/** Muestra las tarjetas de perfil y resuelve cuando el visitante elige uno. */
export function pantallaEntrada(): Promise<void> {
  return new Promise(resolver => {
    const lista = escenarios();
    const capa = document.createElement('div');
    capa.className = 'demo-entrada';
    capa.innerHTML = `
      <div class="demo-entrada-caja">
        <div class="marca"><span class="brand-mark">${icono('terminal')}</span>
          <span>DevOps<span style="font-weight:400;color:#9da99f"> Panel</span></span>
          <span class="badge green" style="margin-left:6px">DEMO</span></div>
        <h1>Elegí con qué escenario querés probar</h1>
        <p class="bajada">Cada perfil arranca con sus propios proyectos, servidores, backups e historial.
          Todo corre en tu navegador: no hay servidor detrás y nada sale de tu equipo.
          Podés cambiar de escenario en cualquier momento desde el botón de abajo a la derecha.</p>
        <div class="rejilla">
          ${lista.map(e => tarjeta(e)).join('')}
        </div>
        <div class="pie">
          <span>Los datos son ficticios.</span>
          <span>Los cambios que hagas quedan guardados en este navegador.</span>
          <span>Podés reiniciar la demo cuando quieras.</span>
        </div>
      </div>`;

    capa.addEventListener('click', evento => {
      const boton = (evento.target as HTMLElement).closest<HTMLElement>('[data-escenario]');
      if (!boton) return;
      reiniciar(boton.dataset.escenario!);
      marcarEntrada();
      capa.remove();
      resolver();
    });

    document.body.appendChild(capa);
  });
}

function tarjeta(e: Escenario): string {
  return `
    <article class="demo-tarjeta">
      <div class="avatar-grande">${esc(e.nombre.slice(0, 2))}</div>
      <h2>${esc(e.nombre)}</h2>
      <div class="perfil">${esc(e.perfil)}</div>
      <p class="resumen">${esc(e.resumen)}</p>
      <ul>${e.puedeHacer.map(x => `<li>${icono('check')}<span>${esc(x)}</span></li>`).join('')}</ul>
      <button type="button" class="btn primary" data-escenario="${esc(e.id)}">
        Entrar como ${esc(e.nombre)} ${icono('flecha')}
      </button>
    </article>`;
}

// ---------------------------------------------------------------------------
// Botón flotante
// ---------------------------------------------------------------------------

export function montarPanel() {
  const actual = escenarios().find(e => e.id === opciones.escenario) || escenarios()[0];

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'demo-fab';
  boton.setAttribute('aria-expanded', 'false');
  boton.innerHTML = `<span class="punto"></span><span class="texto">${esc(actual.nombre)} · ${esc(actual.perfil)}</span>${icono('ajustes')}`;

  const panel = document.createElement('div');
  panel.className = 'demo-panel';
  panel.hidden = true;
  panel.innerHTML = contenidoPanel(actual);

  boton.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    boton.setAttribute('aria-expanded', String(!panel.hidden));
  });

  document.addEventListener('click', evento => {
    const dentro = (evento.target as HTMLElement).closest('.demo-panel,.demo-fab');
    if (!dentro && !panel.hidden) { panel.hidden = true; boton.setAttribute('aria-expanded', 'false'); }
  });

  panel.addEventListener('click', evento => {
    const objetivo = evento.target as HTMLElement;

    const cambio = objetivo.closest<HTMLElement>('[data-cambiar]');
    if (cambio) {
      if (cambio.dataset.cambiar === opciones.escenario) { panel.hidden = true; return; }
      detenerTodo();
      reiniciar(cambio.dataset.cambiar!);
      location.reload();
      return;
    }

    if (objetivo.closest('[data-reiniciar]')) {
      detenerTodo();
      reiniciar();
      location.reload();
      return;
    }

    if (objetivo.closest('[data-cerrar-panel]')) {
      panel.hidden = true;
      boton.setAttribute('aria-expanded', 'false');
    }
  });

  panel.addEventListener('change', evento => {
    const objetivo = evento.target as HTMLInputElement;
    if (objetivo.id === 'demo-fallas') {
      opciones.fallas = objetivo.checked ? 18 : 0;
      guardarOpciones();
      avisar(objetivo.checked
        ? 'Errores simulados activados: algunas llamadas van a fallar a propósito.'
        : 'Errores simulados desactivados.');
    }
    if (objetivo.id === 'demo-latencia') {
      opciones.latencia = objetivo.checked;
      guardarOpciones();
      avisar(objetivo.checked ? 'Latencia de red simulada activada.' : 'Respuestas instantáneas.');
    }
  });

  document.body.append(boton, panel);
}

function contenidoPanel(actual: Escenario): string {
  const lista = escenarios();
  return `
    <header>
      <h2>Panel de la demo</h2>
      <button type="button" class="btn ghost icon-only" data-cerrar-panel aria-label="Cerrar">${icono('cerrar')}</button>
    </header>

    <div class="demo-seccion">
      <h3>Escenario actual</h3>
      ${lista.map(e => `
        <button type="button" class="demo-perfil ${e.id === actual.id ? 'activo' : ''}" data-cambiar="${esc(e.id)}">
          <span class="project-symbol">${esc(e.nombre.slice(0, 2))}</span>
          <span><b>${esc(e.nombre)}</b><span>${esc(e.perfil)}</span></span>
          ${e.id === actual.id ? icono('check') : ''}
        </button>`).join('')}
    </div>

    <div class="demo-seccion">
      <h3>Qué probar acá</h3>
      <ul class="demo-sugerencias">${actual.sugerencias.map(s => `<li><span>${esc(s)}</span></li>`).join('')}</ul>
    </div>

    <div class="demo-seccion">
      <h3>Comportamiento simulado</h3>
      <div class="demo-fila">
        <div><label for="demo-latencia">Latencia de red</label><p>Las respuestas tardan entre 200 y 600 ms, como un servidor real.</p></div>
        <input type="checkbox" id="demo-latencia" ${opciones.latencia ? 'checked' : ''}>
      </div>
      <div class="demo-fila">
        <div><label for="demo-fallas">Errores aleatorios</label><p>Una de cada cinco llamadas falla, para ver cómo avisa el panel.</p></div>
        <input type="checkbox" id="demo-fallas" ${opciones.fallas ? 'checked' : ''}>
      </div>
    </div>

    <div class="demo-seccion">
      <h3>Datos</h3>
      <div class="demo-fila">
        <div><p style="max-width:230px">Volvé a los datos originales de este escenario. Se pierde todo lo que hayas creado o borrado.</p></div>
        <button type="button" class="btn" data-reiniciar>${icono('refrescar')} Reiniciar</button>
      </div>
      ${hayDatosGuardados() ? '<p class="tiny subtle" style="margin-top:10px">Tus cambios están guardados en este navegador.</p>' : ''}
    </div>`;
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

/** Usa el toast de la aplicación si ya está disponible; si no, uno propio. */
export function avisar(mensaje: string) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = mensaje;
    toast.classList.remove('hidden');
    clearTimeout((avisar as unknown as { t?: number }).t);
    (avisar as unknown as { t?: number }).t = setTimeout(() => toast.classList.add('hidden'), 4000) as unknown as number;
  }
}

export const necesitaEntrada = () => !yaEntro() && !hayDatosGuardados();
