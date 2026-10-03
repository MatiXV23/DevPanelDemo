// Router de la API simulada. Reemplaza window.fetch para /api/*, con las mismas rutas,
// los mismos cuerpos y los mismos códigos de error que server.py, para que el frontend
// original funcione sin un solo cambio.
import { datos, guardar } from './store';
import { ErrorApi, debeFallar, demora, error, esperar, json } from './red';
import { activos, cancelar, iniciar, instantanea } from './jobs';
import { explorar, inspeccionar } from './workspace';
import { sondear } from './ssh';
import { hace } from './seeds/fabricas';
import type { ArchivoLog, Config, Registro } from './tipos';

const TOKEN = 'demo-token-sin-servidor';
const RUTA_DATOS = '/Users/demo/DevPanel/.devpanel/projects.json';
const ID_VALIDO = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const VERSION_VALIDA = /^v?\d+\.\d+\.\d+([-+][A-Za-z0-9.-]+)?$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estado() {
  return {
    schemaVersion: 1,
    storeId: 'demo',
    records: structuredClone(datos.records),
    csrfToken: TOKEN,
    storagePath: RUTA_DATOS,
    user: datos.usuario,
    jobs: activos(),
    status: structuredClone(datos.status),
  };
}

function proyecto(pid: string): Registro {
  const registro = datos.records[pid];
  if (!registro) throw new ErrorApi(404, 'No se encontró el proyecto.');
  return registro;
}

/** Las mismas reglas que validate_config en server.py, en lo que el frontend puede romper. */
function validar(config: unknown): Config {
  const errores: [string, string][] = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new ErrorApi(422, 'La configuración debe ser un objeto JSON.');
  }
  const c = config as Config;
  if (!c.name?.trim()) errores.push(['name', 'Escribí un nombre.']);
  if (!c.workspace?.trim()) errores.push(['workspace', 'La ruta del workspace es obligatoria.']);
  else if (!c.workspace.startsWith('/') && !c.workspace.startsWith('~/')) {
    errores.push(['workspace', 'Usá una ruta absoluta o que empiece con ~/.']);
  }
  if (c.github && !/^https:\/\/github\.com\/[^\s/?#]+\/[^\s/?#]+\/?$/.test(c.github)) {
    errores.push(['github', 'Ingresá una URL de repositorio de GitHub válida.']);
  }
  if (c.phraseEnv && !/^[A-Z_][A-Z0-9_]*$/.test(c.phraseEnv)) {
    errores.push(['phraseEnv', 'Usá mayúsculas, números y guiones bajos.']);
  }
  if (c.logsFormat && !['jsonl', 'plain'].includes(c.logsFormat)) {
    errores.push(['logsFormat', 'Elegí jsonl o plain.']);
  }
  if (c.logsPattern) {
    try { new RegExp(c.logsPattern); } catch { errores.push(['logsPattern', 'No es una expresión regular válida.']); }
  }
  if (!Array.isArray(c.targets) || !c.targets.length) {
    errores.push(['targets', 'Configurá al menos un destino.']);
  } else {
    const vistos = new Set<string>();
    c.targets.forEach((t, i) => {
      if (!ID_VALIDO.test(t.id || '')) errores.push([`targets.${i}.id`, 'Usá minúsculas, números y guiones.']);
      else if (vistos.has(t.id)) errores.push([`targets.${i}.id`, 'Los IDs de destino no se pueden repetir.']);
      vistos.add(t.id);
      if (!t.name?.trim()) errores.push([`targets.${i}.name`, 'Escribí un nombre.']);
    });
    if (c.targets.filter(t => t.default).length > 1) {
      errores.push(['targets', 'Solo un destino puede ser el predeterminado.']);
    }
  }
  if (errores.length) throw new ErrorApi(422, 'Revisá los campos indicados antes de guardar.', errores);
  return structuredClone(c);
}

function listadoBackups(pid: string) {
  const config = proyecto(pid).config;
  const disco = datos.discos[pid];
  const origenes = (config.origins || '').split(',').map(s => s.trim()).filter(Boolean);
  const existe = !!config.backupFolder && !!disco;
  const archivos = existe ? disco.backups.filter(b => !config.backupExtension || b.file.endsWith(config.backupExtension)) : [];
  return {
    folder: config.backupFolder, exists: existe, origins: origenes,
    files: archivos.map(b => ({ ...b, knownOrigin: origenes.includes(b.origin) })),
  };
}

function listadoLogs(pid: string) {
  const config = proyecto(pid).config;
  const disco = datos.discos[pid];
  const existe = !!config.logsFolder && !!disco;
  let patron: RegExp | null = null;
  try { patron = new RegExp(config.logsPattern || '.*'); }
  catch { throw new ErrorApi(422, 'El patrón de nombre de logs no es una expresión regular válida.'); }
  const files: ArchivoLog[] = existe
    ? Object.entries(disco.logs)
        .filter(([nombre]) => patron!.test(nombre))
        .map(([nombre, contenido]) => ({
          file: nombre,
          size: new Blob([contenido]).size,
          modified: hace(0),
        }))
        .sort((a, b) => (a.file < b.file ? 1 : -1))
    : [];
  return { folder: config.logsFolder, exists: existe, format: config.logsFormat, files };
}

const CLAVES_TIEMPO = ['time', 'timestamp', 'ts', 'date', 'datetime', 'fecha', 'hora'];
const CLAVES_USUARIO = ['user', 'usuario', 'username', 'actor', 'email'];
const CLAVES_TIPO = ['type', 'tipo', 'level', 'nivel', 'severity', 'kind', 'event'];
const CLAVES_TEXTO = ['text', 'message', 'msg', 'mensaje', 'descripcion', 'description', 'detail', 'title'];

const elegir = (obj: Record<string, unknown>, claves: string[]) => {
  for (const k of claves) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return typeof v === 'string' ? v : JSON.stringify(v);
  }
  return '';
};

function parsearJsonl(texto: string) {
  const entradas = [];
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!linea.trim()) continue;
    try {
      const obj = JSON.parse(linea) as Record<string, unknown>;
      let tipo = (elegir(obj, CLAVES_TIPO) || 'evento').toLowerCase();
      if (['err', 'fatal', 'critical', 'crit', 'exception', 'warn'].includes(tipo)) {
        tipo = tipo === 'warn' ? 'warn' : 'error';
      }
      entradas.push({
        line: i + 1, time: elegir(obj, CLAVES_TIEMPO).slice(0, 40),
        user: elegir(obj, CLAVES_USUARIO).slice(0, 80), type: tipo.slice(0, 40),
        text: elegir(obj, CLAVES_TEXTO).slice(0, 500) || linea.slice(0, 200), raw: obj,
      });
    } catch {
      entradas.push({ line: i + 1, time: '', user: '', type: 'texto', text: linea.slice(0, 500), raw: null });
    }
  }
  return entradas;
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

async function enrutar(metodo: string, ruta: string, params: URLSearchParams, cuerpo: Record<string, unknown>): Promise<Response> {
  if (ruta === '/api/state' && metodo === 'GET') return json(estado());

  if (ruta === '/api/projects' && metodo === 'POST') {
    const id = String(cuerpo.id || '');
    if (!ID_VALIDO.test(id)) throw new ErrorApi(422, 'El ID del proyecto debe tener letras minúsculas, números y guiones (máximo 80).');
    if (datos.records[id]) throw new ErrorApi(409, 'Ya existe un proyecto con ese ID.');
    const config = validar(cuerpo.config);
    datos.records[id] = { config, revision: 1, metadata: (cuerpo.metadata as Record<string, string>) || {} };
    datos.discos[id] = {
      git: { workspace: config.workspace, hasGit: true, version: config.versionFile ? { path: config.versionFile, version: 'v0.1.0', raw: 'v0.1.0' } : null, branch: 'main', head: '0000000', changes: 0, remote: '', commits: [], tags: [], lastTag: '', commitsSinceTag: null, ahead: 0, behind: 0, error: '' },
      backups: [], logs: {},
    };
    guardar();
    return json(estado(), 201);
  }

  if (ruta === '/api/import' && metodo === 'POST') return json(estado());

  const unProyecto = /^\/api\/projects\/([a-z0-9_-]+)$/.exec(ruta);
  if (unProyecto) {
    const pid = unProyecto[1];
    const registro = proyecto(pid);
    if (metodo === 'PUT') {
      if (cuerpo.revision !== registro.revision) {
        throw new ErrorApi(409, 'El proyecto cambió en otra pestaña. Recargá los datos antes de guardar; tu borrador se conserva.');
      }
      registro.config = validar(cuerpo.config);
      registro.revision += 1;
      guardar();
      return json(estado());
    }
    if (metodo === 'DELETE') {
      if (datos.activos[pid]) throw new ErrorApi(409, 'Hay una operación en curso para este proyecto. Esperá a que termine o cancelala.');
      if (cuerpo.revision !== registro.revision) {
        throw new ErrorApi(409, 'El proyecto cambió en otra pestaña. Recargá los datos antes de eliminarlo.');
      }
      delete datos.records[pid];
      delete datos.discos[pid];
      delete datos.status.deployed[pid];
      delete datos.status.remote[pid];
      guardar();
      return json(estado());
    }
  }

  if (metodo === 'POST' && ruta === '/api/workspace/browse') return json(explorar(cuerpo.path));
  if (metodo === 'POST' && ruta === '/api/workspace/inspect') return json(inspeccionar(cuerpo.workspace));

  if (metodo === 'POST' && ruta === '/api/ssh/test') {
    const borrador = { host: String(cuerpo.host || ''), port: String(cuerpo.port || '22'), key: String(cuerpo.key || ''), remoteVersion: String(cuerpo.remoteVersion || '') };
    const sonda = sondear(borrador);
    // Igual que el backend: solo se registra si coincide con un destino guardado.
    const pid = String(cuerpo.project || ''), tid = String(cuerpo.target || '');
    const destino = datos.records[pid]?.config.targets.find(t => t.id === tid);
    if (destino && destino.host === borrador.host && (destino.port || '22') === borrador.port) {
      registrarSonda(pid, tid, sonda);
    }
    return json(sonda);
  }

  const sshDestino = /^\/api\/projects\/([a-z0-9_-]+)\/targets\/([a-z0-9_-]+)\/ssh-test$/.exec(ruta);
  if (sshDestino && metodo === 'POST') {
    const [, pid, tid] = sshDestino;
    const config = proyecto(pid).config;
    const destino = config.targets.find(t => t.id === tid);
    if (!destino) throw new ErrorApi(404, 'No se encontró el destino.');
    const desplegada = datos.status.deployed[pid]?.[tid]?.version || datos.discos[pid]?.git.lastTag || '';
    const sonda = sondear(destino, desplegada);
    registrarSonda(pid, tid, sonda);
    return json(sonda);
  }

  const recurso = /^\/api\/projects\/([a-z0-9_-]+)\/(git|history|backups|logs|logs\/file|run|version|backups\/delete|logs\/delete|logs\/zip)$/.exec(ruta);
  if (recurso) {
    const [, pid, nombre] = recurso;
    const registro = proyecto(pid);
    const disco = datos.discos[pid];

    if (metodo === 'GET') {
      if (nombre === 'git') {
        if (!disco) throw new ErrorApi(422, 'La carpeta del workspace no existe o no es accesible.');
        return json({ ...disco.git, version: registro.config.versionFile ? disco.git.version : null });
      }
      if (nombre === 'history') return json({ history: datos.historial.filter(j => j.project === pid).map(({ _lineas, ...j }) => { void _lineas; return j; }) });
      if (nombre === 'backups') return json(listadoBackups(pid));
      if (nombre === 'logs') return json(listadoLogs(pid));
      if (nombre === 'logs/file') {
        const archivo = params.get('name') || '';
        const contenido = disco?.logs[archivo];
        if (contenido === undefined) throw new ErrorApi(404, 'El archivo de log no existe en la carpeta configurada.');
        const base = { file: archivo, size: new Blob([contenido]).size, format: registro.config.logsFormat, content: contenido };
        return json(registro.config.logsFormat === 'jsonl' ? { ...base, entries: parsearJsonl(contenido), truncated: false } : base);
      }
    }

    if (metodo === 'POST') {
      if (nombre === 'run') return json(iniciar(pid, cuerpo), 202);

      if (nombre === 'version') {
        const valor = String(cuerpo.version || '').trim();
        if (!VERSION_VALIDA.test(valor)) throw new ErrorApi(422, 'La versión debe tener formato X.Y.Z.', [['version', 'Usá el formato X.Y.Z.']]);
        if (!registro.config.versionFile) throw new ErrorApi(422, 'El proyecto no tiene archivo de versión configurado.');
        if (!disco) throw new ErrorApi(422, 'La carpeta del workspace no existe.');
        const pelado = valor.replace(/^v/, '');
        const conPrefijo = valor.startsWith('v') ? valor : `v${pelado}`;
        disco.git.version = { path: registro.config.versionFile, version: conPrefijo, raw: conPrefijo };
        const resultado: Record<string, unknown> = { written: conPrefijo, path: registro.config.versionFile, git: '' };
        if (cuerpo.tag === true) {
          const tag = `${registro.config.tagPrefix || ''}${pelado}`;
          if (disco.git.tags.some(t => t.name === tag)) {
            throw new ErrorApi(422, `VERSION se escribió, pero Git falló: el tag ${tag} ya existe.`);
          }
          disco.git.tags.unshift({ name: tag, date: hace(0), subject: `Versión ${pelado}` });
          disco.git.lastTag = tag;
          disco.git.commitsSinceTag = 0;
          disco.git.changes = 0;
          disco.git.commits.unshift({ hash: Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0').slice(0, 7), subject: `chore: versión ${pelado}`, author: datos.usuario, date: hace(0) });
          resultado.tag = tag;
          resultado.git = `[main ${disco.git.commits[0].hash}] chore: versión ${pelado}\n 1 file changed, 1 insertion(+), 1 deletion(-)`;
        }
        guardar();
        return json({ ...resultado, git: disco.git });
      }

      if (nombre === 'backups/delete') {
        const archivos = (cuerpo.files as string[]) || [];
        if (!Array.isArray(archivos) || !archivos.length) throw new ErrorApi(422, 'Indicá qué backups eliminar.');
        const conocidos = new Set(disco.backups.map(b => b.file));
        const faltante = archivos.find(f => !conocidos.has(f));
        if (faltante) throw new ErrorApi(404, `No se encontró ${faltante} en la carpeta de backups.`);
        if (registro.config.protectLast && conocidos.size - archivos.length < 1) {
          throw new ErrorApi(422, 'El último backup está protegido. Conservá al menos uno.');
        }
        disco.backups = disco.backups.filter(b => !archivos.includes(b.file));
        guardar();
        return json(listadoBackups(pid));
      }

      if (nombre === 'logs/delete') {
        const archivos = (cuerpo.files as string[]) || [];
        if (!Array.isArray(archivos) || !archivos.length) throw new ErrorApi(422, 'Indicá qué archivos eliminar.');
        for (const f of archivos) {
          if (!(f in disco.logs)) throw new ErrorApi(404, 'El archivo de log no existe en la carpeta configurada.');
          delete disco.logs[f];
        }
        guardar();
        return json(listadoLogs(pid));
      }

      if (nombre === 'logs/zip') {
        const archivos = (cuerpo.files as string[]) || [];
        if (!Array.isArray(archivos) || !archivos.length) throw new ErrorApi(422, 'Elegí al menos un archivo.');
        // No armamos un ZIP real: entregamos un texto con los archivos concatenados,
        // que es lo que tiene sentido poder abrir desde una demo.
        const partes = archivos.map(f => `===== ${f} =====\n${disco.logs[f] ?? ''}`).join('\n');
        const aviso = `Demo de DevOps Panel — exportación simulada\nEn la aplicación real este archivo es un ZIP con ${archivos.length} archivo(s).\n\n`;
        return new Response(new Blob([aviso + partes], { type: 'text/plain' }), {
          status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    }
  }

  const unJob = /^\/api\/jobs\/([a-f0-9]+)$/.exec(ruta);
  if (unJob && metodo === 'GET') return json(instantanea(unJob[1], Number(params.get('offset') || 0)));

  const cancelarJob = /^\/api\/jobs\/([a-f0-9]+)\/cancel$/.exec(ruta);
  if (cancelarJob && metodo === 'POST') return json(cancelar(cancelarJob[1]));

  if (ruta === '/api/jobs' && metodo === 'GET') return json({ jobs: activos() });

  throw new ErrorApi(404, 'Ruta no encontrada.');
}

function registrarSonda(pid: string, tid: string, sonda: ReturnType<typeof sondear>) {
  datos.status.remote[pid] ||= {};
  datos.status.remote[pid][tid] = sonda.ok
    ? { version: sonda.remoteVersion, checkedAt: sonda.checkedAt, ok: true }
    : { version: '', checkedAt: sonda.checkedAt, ok: false, error: sonda.output.slice(-300) };
  guardar();
}

// ---------------------------------------------------------------------------
// Instalación
// ---------------------------------------------------------------------------

export function instalarHttp() {
  const original = window.fetch.bind(window);

  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url, location.href);
    if (!url.pathname.startsWith('/api/')) return original(entrada, init);

    const metodo = (init?.method || 'GET').toUpperCase();
    await esperar(demora(url.pathname, metodo));

    const caida = debeFallar(metodo);
    if (caida) return error(caida);

    let cuerpo: Record<string, unknown> = {};
    if (init?.body) {
      try { cuerpo = JSON.parse(String(init.body)); } catch { return error(new ErrorApi(400, 'El cuerpo no es JSON válido.')); }
    }
    try {
      return await enrutar(metodo, url.pathname, url.searchParams, cuerpo);
    } catch (e) {
      return error(e);
    }
  };
}
