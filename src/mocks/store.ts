// El "disco" de la demo: todo lo que el backend real guardaría en .devpanel/,
// mantenido en memoria y espejado en localStorage para que sobreviva al refresh.
import type { Disco, Escenario, Estado, Job, Registro } from './tipos';
import { ESCENARIOS, ORDEN, POR_DEFECTO } from './seeds/escenarios';

const CLAVE_DATOS = 'demo-devpanel-datos';
const CLAVE_OPCIONES = 'demo-devpanel-opciones';

export interface Opciones {
  escenario: string;
  /** Porcentaje de llamadas que fallan a propósito (0 = nunca). */
  fallas: number;
  latencia: boolean;
}

export interface Datos {
  escenario: string;
  usuario: string;
  records: Record<string, Registro>;
  discos: Record<string, Disco>;
  status: Estado;
  historial: Job[];
  jobs: Record<string, Job>;      // jobs vivos por id
  activos: Record<string, string>; // proyecto -> job id
}

export const opciones: Opciones = leerOpciones();
export let datos: Datos = leerDatos();

function leerOpciones(): Opciones {
  const base: Opciones = { escenario: POR_DEFECTO, fallas: 0, latencia: true };
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_OPCIONES) || 'null');
    if (crudo && typeof crudo === 'object') {
      if (typeof crudo.escenario === 'string' && crudo.escenario in ESCENARIOS) base.escenario = crudo.escenario;
      if (typeof crudo.fallas === 'number') base.fallas = Math.min(100, Math.max(0, crudo.fallas));
      if (typeof crudo.latencia === 'boolean') base.latencia = crudo.latencia;
    }
  } catch { /* opciones por defecto */ }
  return base;
}

export function guardarOpciones() {
  try { localStorage.setItem(CLAVE_OPCIONES, JSON.stringify(opciones)); } catch { /* sin espacio: queda en memoria */ }
}

function desdeEscenario(id: string): Datos {
  const e: Escenario = (ESCENARIOS[id] || ESCENARIOS[POR_DEFECTO])();
  return {
    escenario: e.id, usuario: e.usuario,
    records: structuredClone(e.records), discos: structuredClone(e.discos),
    status: structuredClone(e.status), historial: structuredClone(e.historial),
    jobs: {}, activos: {},
  };
}

function leerDatos(): Datos {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_DATOS) || 'null');
    if (crudo && typeof crudo === 'object' && crudo.records && crudo.escenario === opciones.escenario) {
      // Los jobs vivos no sobreviven a un refresh: el proceso ya no existe.
      return { ...crudo, jobs: {}, activos: {} } as Datos;
    }
  } catch { /* semilla limpia */ }
  return desdeEscenario(opciones.escenario);
}

let pendiente = 0;
export function guardar() {
  clearTimeout(pendiente);
  pendiente = setTimeout(() => {
    try {
      const { jobs, activos, ...resto } = datos;
      void jobs; void activos;   // no se persisten: son estado de proceso
      localStorage.setItem(CLAVE_DATOS, JSON.stringify(resto));
    } catch { /* cuota llena: la demo sigue funcionando en memoria */ }
  }, 150) as unknown as number;
}

/** Vuelve a los datos semilla del escenario actual (botón «Reiniciar demo»). */
export function reiniciar(escenario = opciones.escenario) {
  opciones.escenario = escenario in ESCENARIOS ? escenario : POR_DEFECTO;
  datos = desdeEscenario(opciones.escenario);
  guardarOpciones();
  try { localStorage.removeItem(CLAVE_DATOS); } catch { /* nada que limpiar */ }
  guardar();
}

export const escenarios = () => ORDEN.map(id => ESCENARIOS[id]());
export const hayDatosGuardados = () => {
  try { return !!localStorage.getItem(CLAVE_DATOS); } catch { return false; }
};
