// Un árbol de carpetas ficticio para el explorador y el inspector del asistente.
// Todo es de solo lectura: nada de esto toca el disco de verdad.
import { ErrorApi } from './red';
import { datos } from './store';

const SCRIPTS_TIPICOS = [
  'scripts/deploy.sh', 'scripts/backup-remote-db.sh', 'scripts/restore-remote-db.sh',
  'scripts/restore-local-db.sh', 'scripts/pull-logs.sh', 'scripts/seed.sh',
  'scripts/clear-cache.sh', 'scripts/migrar.sh', 'tools/check-health.sh',
  'tools/rotar-claves.sh', 'infra/provision.sh',
];

/** Carpetas inventadas, además de las de los proyectos del escenario activo. */
const ARBOL: Record<string, string[]> = {
  '/Users': ['flor', 'mperez', 'estudio'],
  '/Users/flor': ['proyectos', 'Descargas', 'Documentos'],
  '/Users/flor/proyectos': ['feria-tristan-narvaja', 'blog-personal', 'recetas-api'],
  '/Users/mperez': ['workspace', 'Descargas', 'Documentos'],
  '/Users/mperez/workspace': ['mutualista', 'padron-rural', 'cobros', 'turnos-online', 'sandbox'],
  '/Users/estudio': ['clientes', 'plantillas'],
  '/Users/estudio/clientes': ['parrilla', 'vivero', 'rambla', 'escuela', 'panaderia', 'ferreteria-centro'],
  '/Users/estudio/plantillas': ['base-laravel', 'base-astro'],
};

const HOJAS = ['src', 'public', 'scripts', 'backups', 'logs', 'node_modules', '.git', 'docs'];

function hijos(ruta: string): string[] {
  if (ARBOL[ruta]) return ARBOL[ruta];
  // Dentro de un proyecto mostramos una estructura verosímil, sin las carpetas que el
  // backend real saltea (.git, node_modules).
  const esProyecto = Object.values(datos.records).some(r => r.config.workspace === ruta)
    || Object.keys(ARBOL).some(k => ARBOL[k].some(h => `${k}/${h}` === ruta));
  return esProyecto ? HOJAS.filter(h => h !== '.git' && h !== 'node_modules') : [];
}

export function explorar(valor: unknown) {
  const ruta = typeof valor === 'string' && valor.trim() ? valor.replace(/\/+$/, '') : '/Users/mperez/workspace';
  if (typeof valor === 'string' && !(valor.startsWith('/') || valor.startsWith('~/'))) {
    throw new ErrorApi(422, 'Ingresá una ruta absoluta.');
  }
  const lista = hijos(ruta);
  const padre = ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/')) || '/' : '/';
  return {
    path: ruta,
    parent: padre,
    children: lista.map(name => ({ name, path: `${ruta}/${name}` })),
    truncated: false,
  };
}

export function inspeccionar(valor: unknown) {
  if (typeof valor !== 'string' || !(valor.startsWith('/') || valor.startsWith('~/'))) {
    throw new ErrorApi(422, 'Ingresá una ruta absoluta al workspace.');
  }
  const ruta = valor.replace(/^~/, '/Users/mperez').replace(/\/+$/, '');
  const nombre = ruta.slice(ruta.lastIndexOf('/') + 1);
  if (!nombre) throw new ErrorApi(422, 'La carpeta no existe o no es accesible.', [['workspace', 'Elegí una carpeta existente.']]);

  // Si ya es un proyecto del escenario, contamos lo que ese proyecto tiene de verdad.
  const existente = Object.entries(datos.records).find(([, r]) => r.config.workspace === ruta);
  if (existente) {
    const [pid, registro] = existente;
    const disco = datos.discos[pid];
    return {
      workspace: ruta, name: nombre, hasGit: disco?.git.hasGit ?? false,
      version: disco?.git.version?.version || null,
      scripts: SCRIPTS_TIPICOS.map(path => ({ path, executable: true })),
      hasBackups: !!registro.config.backupFolder,
      hasLogs: !!registro.config.logsFolder,
      truncated: false,
    };
  }

  // Carpeta nueva: el resultado depende del nombre, para que el asistente muestre casos distintos.
  const vacia = /sandbox|descargas|documentos|plantillas/i.test(nombre);
  return {
    workspace: ruta, name: nombre,
    hasGit: !vacia,
    version: vacia ? null : 'v0.1.0',
    scripts: vacia ? [] : SCRIPTS_TIPICOS.slice(0, 7).map((path, i) => ({ path, executable: i !== 6 })),
    hasBackups: !vacia, hasLogs: !vacia, truncated: false,
  };
}

export const scriptsDisponibles = () => SCRIPTS_TIPICOS;
