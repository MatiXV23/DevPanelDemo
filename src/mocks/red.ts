// Simulación de la capa de red: latencia, fallos esporádicos y el formato exacto
// de respuesta que espera el cliente (JSON con {error, fields} cuando algo sale mal).
import { opciones } from './store';

export class ErrorApi extends Error {
  constructor(public status: number, mensaje: string, public fields: [string, string][] = []) {
    super(mensaje);
  }
}

/** Latencia realista: rápida para lecturas, más lenta para escrituras y SSH. */
export function demora(ruta: string, metodo: string): number {
  if (!opciones.latencia) return 0;
  const base = ruta.includes('/ssh') ? 900 : metodo === 'GET' ? 200 : 320;
  const rango = ruta.includes('/ssh') ? 700 : 280;
  return Math.round(base + Math.random() * rango);
}

const CAIDAS = [
  [503, 'El servidor local no respondió a tiempo. Tus cambios siguen en el formulario: volvé a intentar.'],
  [500, 'No se pudo completar la operación (OSError). Revisá permisos y rutas; no se confirmó ningún cambio.'],
  [409, 'El proyecto cambió en otra pestaña. Recargá los datos antes de guardar; tu borrador se conserva.'],
] as const;

/** Decide si esta llamada debe fallar a propósito. Las lecturas fallan la mitad de seguido. */
export function debeFallar(metodo: string): ErrorApi | null {
  if (!opciones.fallas) return null;
  const probabilidad = metodo === 'GET' ? opciones.fallas / 2 : opciones.fallas;
  if (Math.random() * 100 >= probabilidad) return null;
  const [status, mensaje] = CAIDAS[Math.floor(Math.random() * CAIDAS.length)];
  return new ErrorApi(status, mensaje);
}

export function json(valor: unknown, status = 200): Response {
  return new Response(JSON.stringify(valor), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function error(e: unknown): Response {
  if (e instanceof ErrorApi) return json({ error: e.message, fields: e.fields }, e.status);
  const mensaje = e instanceof Error ? e.message : 'Error desconocido';
  return json({ error: `No se pudo completar la operación (${mensaje}).`, fields: [] }, 500);
}

export const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
