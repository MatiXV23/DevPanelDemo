// Motor de operaciones simuladas. Reproduce el ciclo del backend real: un job por
// proyecto, salida que aparece línea a línea, cancelación, y los efectos que deja
// al terminar (versión desplegada, backup nuevo, logs descargados).
import { datos, guardar } from './store';
import { ErrorApi } from './red';
import { guion, type ContextoSalida } from './salidas';
import { hace, diaArchivo } from './seeds/fabricas';
import type { Config, Destino, Job } from './tipos';

const ahora = () => hace(0);

let secuencia = 0;
const nuevoId = () => (Date.now().toString(16) + (++secuencia).toString(16)).padStart(16, '0').slice(-16);

/** Líneas emitidas hasta ahora por cada job vivo (el cliente las pide por offset). */
const buffers: Record<string, string[]> = {};
const temporizadores: Record<string, number> = {};

export function lineasDe(jobId: string): string[] {
  return buffers[jobId] || [];
}

function destinoDe(config: Config, id: string | null | undefined): Destino | null {
  if (!id) return null;
  const d = config.targets.find(t => t.id === id);
  if (!d) throw new ErrorApi(404, 'No se encontró el destino.');
  return d;
}

function contexto(config: Config, destino: Destino | null, version: string, backup: string): ContextoSalida {
  return {
    proyecto: config.name,
    destino: destino?.name || 'tu equipo',
    host: destino?.host || '',
    version, backup,
    carpeta: config.workspace,
    rama: datos.discos[Object.keys(datos.records).find(k => datos.records[k].config === config) || '']?.git.branch || 'main',
  };
}

const ETIQUETAS: Record<string, (d: Destino | null, c: Config) => string> = {
  deploy: d => d?.deployLabel || `Deploy a ${d?.name || ''}`,
  backup: d => `Backup de ${d?.name || ''}`,
  restore: d => `Restaurar en ${d?.name || ''}`,
  'restore-local': () => 'Restaurar en local',
  logs: d => `Descargar logs de ${d?.name || ''}`,
  ssh: d => `${d?.host || 'remoto'}`,
  action: (_d, c) => c.name,
};

export function iniciar(pid: string, body: Record<string, unknown>): Job {
  const registro = datos.records[pid];
  if (!registro) throw new ErrorApi(404, 'No se encontró el proyecto.');
  if (datos.activos[pid]) {
    throw new ErrorApi(409, 'Ya hay una operación en curso para este proyecto. Esperá a que termine o cancelala.');
  }
  const config = registro.config;
  const kind = String(body.kind || '');
  if (!['deploy', 'backup', 'restore', 'restore-local', 'logs', 'action', 'ssh'].includes(kind)) {
    throw new ErrorApi(422, 'Operación desconocida.');
  }
  const destino = destinoDe(config, body.target as string | undefined);
  if (['deploy', 'backup', 'restore', 'logs', 'ssh'].includes(kind) && !destino) {
    throw new ErrorApi(422, 'Elegí un destino.');
  }

  // La frase de confirmación se valida igual que en el backend real.
  if (kind === 'restore' || (kind === 'action' && body.phrase !== undefined)) {
    if (kind === 'restore' && body.phrase !== config.phrase) {
      throw new ErrorApi(403, 'La frase de confirmación no coincide.');
    }
  }

  const version = String(body.version || '');
  const backup = String(body.backup || '');
  let etiqueta = ETIQUETAS[kind]?.(destino, config) || 'Operación';
  let comando = 'scripts/deploy.sh';

  if (kind === 'action') {
    const todas = [...config.actions, ...(destino?.actions || [])];
    const accion = todas.find(a => a.id === body.action);
    if (!accion) throw new ErrorApi(404, 'No se encontró la acción.');
    etiqueta = accion.label;
    comando = `${accion.script}${accion.args ? ' ' + accion.args : ''}`;
  } else if (kind === 'ssh') {
    const texto = String(body.command || '').trim();
    if (!texto) throw new ErrorApi(422, 'Escribí un comando.');
    etiqueta = `${destino?.host}: ${texto}`;
    comando = `ssh ${destino?.host} -- ${texto}`;
  } else {
    const script = { deploy: destino?.deploy, backup: destino?.backup, restore: destino?.restore, 'restore-local': config.restoreLocal, logs: destino?.logs }[kind];
    if (!script) throw new ErrorApi(422, 'Este destino no tiene el script configurado.');
    comando = `${script}${version ? ' ' + version : ''}${backup ? ' backups/' + backup : ''}`;
  }

  // Un deploy sobre un destino sin conexión conocida falla, como pasaría de verdad.
  const sinSsh = !!destino && !destino.host;
  const fallara = sinSsh && kind !== 'restore-local' && kind !== 'action';

  const job: Job = {
    id: nuevoId(), project: pid, target: destino?.id ?? null, targetName: destino?.name ?? null,
    kind, label: etiqueta, command: comando, status: 'running', exitCode: null,
    startedAt: ahora(), finishedAt: null, durationMs: null, version, backup, dropped: 0, total: 0,
  };

  datos.jobs[job.id] = job;
  datos.activos[pid] = job.id;
  buffers[job.id] = [];

  const pasos = guion(kind, contexto(config, destino, version, backup), fallara);
  if (sinSsh) {
    pasos.splice(4, pasos.length, { texto: '→ Conectando por SSH', pausa: 600 },
      { texto: '  ssh: Could not resolve hostname: nodename nor servname provided', pausa: 120 },
      { texto: '', pausa: 40 },
      { texto: 'ERROR: el destino no tiene usuario@host configurado.', pausa: 0 });
  }
  reproducir(job, pasos.slice(), fallara || sinSsh);
  guardar();
  // La capa de demo usa esto para explicar, una sola vez, qué haría la app real.
  window.dispatchEvent(new CustomEvent('demo:job', {
    detail: { kind, label: etiqueta, command: comando, host: destino?.host || '', destino: destino?.name || 'tu equipo' },
  }));
  return publico(job);
}

function reproducir(job: Job, pasos: { texto: string; pausa?: number }[], fallara: boolean) {
  const paso = () => {
    const actual = pasos.shift();
    if (actual === undefined) return terminar(job, fallara ? 1 : 0);
    buffers[job.id].push(actual.texto);
    job.total = buffers[job.id].length;
    temporizadores[job.id] = setTimeout(paso, actual.pausa ?? 120) as unknown as number;
  };
  temporizadores[job.id] = setTimeout(paso, 200) as unknown as number;
}

function terminar(job: Job, codigo: number) {
  delete temporizadores[job.id];
  if (job.status !== 'running') return;
  job.status = codigo === 0 ? 'ok' : 'error';
  job.exitCode = codigo;
  job.finishedAt = ahora();
  job.durationMs = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
  cerrar(job);
}

export function cancelar(jobId: string) {
  const job = datos.jobs[jobId];
  if (!job || job.status !== 'running') throw new ErrorApi(409, 'La operación ya terminó.');
  clearTimeout(temporizadores[jobId]);
  delete temporizadores[jobId];
  buffers[jobId].push('', '✕ Operación cancelada: se envió SIGTERM al proceso.');
  job.status = 'cancelled';
  job.exitCode = 143;
  job.finishedAt = ahora();
  job.durationMs = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
  cerrar(job);
  return { ok: true };
}

/** Efectos de un job terminado sobre el "disco": estado, backups, logs, historial. */
function cerrar(job: Job) {
  delete datos.activos[job.project];
  const disco = datos.discos[job.project];
  const config = datos.records[job.project]?.config;

  if (job.status === 'ok' && disco && config) {
    if (job.kind === 'deploy' && job.target) {
      datos.status.deployed[job.project] ||= {};
      datos.status.deployed[job.project][job.target] = { version: job.version, at: job.finishedAt!, job: job.id };
      datos.status.remote[job.project] ||= {};
      datos.status.remote[job.project][job.target] = { version: job.version, checkedAt: job.finishedAt!, ok: true };
    }
    if (job.kind === 'backup' && job.target) {
      const destino = config.targets.find(t => t.id === job.target);
      const origen = destino?.backupLabel || job.target;
      const archivo = `${origen}-${diaArchivo(0)}${config.backupExtension || '.sql.gz'}`;
      if (!disco.backups.some(b => b.file === archivo)) {
        disco.backups.unshift({
          file: archivo, origin: origen, knownOrigin: true,
          size: 38_000_000 + Math.floor(Math.random() * 40_000_000),
          modified: job.finishedAt!, extras: !!config.extrasSuffix,
        });
      }
    }
    if (job.kind === 'logs') {
      // El script trae el día de hoy desde el servidor.
      const hoy = `${diaArchivo(0)}.log`;
      if (!disco.logs[hoy]) {
        disco.logs[hoy] = JSON.stringify({ time: ahora().slice(0, 19), user: 'sistema', type: 'info', message: 'Archivo descargado desde el servidor' }) + '\n';
      }
    }
  }

  job._lineas = buffers[job.id].slice();
  datos.historial.unshift(publico(job));
  if (datos.historial.length > 200) datos.historial.length = 200;
  guardar();
}

/** Los mismos campos que expone el backend (nunca el proceso ni el buffer completo). */
export function publico(job: Job): Job {
  const { _lineas, ...resto } = job;
  void _lineas;
  return { ...resto };
}

export function activos(): Record<string, Job> {
  const salida: Record<string, Job> = {};
  for (const [pid, id] of Object.entries(datos.activos)) {
    if (datos.jobs[id]) salida[pid] = publico(datos.jobs[id]);
  }
  return salida;
}

export function instantanea(jobId: string, offset: number) {
  const vivo = datos.jobs[jobId];
  if (vivo) {
    const todas = buffers[jobId] || [];
    const desde = Math.max(0, Math.min(offset, todas.length));
    return { ...publico(vivo), lines: todas.slice(desde), next: todas.length, reset: offset > todas.length };
  }
  const guardado = datos.historial.find(j => j.id === jobId);
  if (!guardado) throw new ErrorApi(404, 'No se encontró la operación.');
  const todas = guardado._lineas || [];
  return { ...publico(guardado), lines: todas.slice(Math.max(0, offset)), next: todas.length, reset: false };
}

/** Corta todo lo que esté corriendo (al reiniciar la demo o cambiar de escenario). */
export function detenerTodo() {
  for (const id of Object.keys(temporizadores)) clearTimeout(temporizadores[id]);
  for (const id of Object.keys(temporizadores)) delete temporizadores[id];
  for (const id of Object.keys(buffers)) delete buffers[id];
}
