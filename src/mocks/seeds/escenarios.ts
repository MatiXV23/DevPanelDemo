// Los tres perfiles de uso de la demo. Cada uno es un disco completo: proyectos,
// repositorios, backups, logs, estado de los servidores e historial de operaciones.
import type { Escenario, Job, Registro } from '../tipos';
import { backups, config, destino, accion, hace, dias, horas, logs, repo } from './fabricas';
import { lineas } from '../salidas';

let contador = 0;
const idJob = () => (0xa1b2c3d4 + ++contador * 7919).toString(16).slice(0, 16).padEnd(16, '0');

function job(parcial: Partial<Job> & { project: string; kind: string; label: string }): Job {
  const dur = parcial.durationMs ?? 42_000;
  const inicio = parcial.startedAt ?? hace(dias(1));
  return {
    id: idJob(), target: null, targetName: null, command: 'scripts/deploy.sh',
    status: 'ok', exitCode: 0, startedAt: inicio,
    finishedAt: new Date(new Date(inicio).getTime() + dur).toISOString(),
    durationMs: dur, version: '', backup: '', dropped: 0, total: 0,
    ...parcial,
  };
}

const registro = (c: ReturnType<typeof config>, metadata: Record<string, string | number> = {}): Registro =>
  ({ config: c, revision: 1, metadata });

// ---------------------------------------------------------------------------
// 1 · Dev sola con un cliente
// ---------------------------------------------------------------------------

function devSolo(): Escenario {
  const ws = '/Users/flor/proyectos/feria-tristan-narvaja';
  const prod = destino({
    id: 'prod', name: 'Producción (VPS)', short: 'Producción', badge: 'VPS', color: 'amber',
    host: 'deploy@feria.com.uy', default: true, remoteFolder: '/var/www/feria',
    remoteVersion: '/var/www/feria/VERSION', backupLabel: 'prod',
    env: [['NODE_ENV', 'production'], ['APP_ENV', 'prod']],
    deployLabel: 'Publicar en producción',
    deployHint: 'Compila la tienda, sube los archivos y reinicia el sitio.',
  });
  const cfg = config({
    name: 'Feria Tristán Narvaja', workspace: ws,
    github: 'https://github.com/flor/feria-tristan-narvaja',
    origins: 'prod, local', targets: [prod],
    actions: [accion({ id: 'seed', label: 'Cargar datos de prueba', script: 'scripts/seed.sh', env: 'NODE_ENV=development' })],
  });

  const salida = { proyecto: 'Feria Tristán Narvaja', destino: 'Producción (VPS)', host: 'deploy@feria.com.uy', version: 'v1.4.2', backup: 'prod-2026-10-02.sql.gz', carpeta: ws, rama: 'main' };

  return {
    id: 'dev-solo',
    nombre: 'Flor',
    perfil: 'Desarrolladora freelance',
    resumen: 'Un cliente, un servidor. Lo mínimo para operar sin entrar por SSH a mano.',
    puedeHacer: [
      'Publicar una versión nueva en producción con un clic',
      'Crear y restaurar backups de la base',
      'Ver qué versión está corriendo en el servidor',
    ],
    sugerencias: [
      'Entrá al Panel y tocá «Publicar en producción»',
      'Andá a Versiones y preparála próxima versión con «minor»',
      'Creá un backup y después restauralo en local',
    ],
    usuario: 'flor',
    records: { feria: registro(cfg, { version: 'v1.4.2', branch: 'main', description: 'Tienda de la feria' }) },
    discos: {
      feria: {
        git: repo({ semilla: 'feria', workspace: ws, version: 'v1.4.2', cambios: 3, cantidadTags: 6, commitsNuevos: 4, adelante: 4, atras: 0, remoto: 'git@github.com:flor/feria-tristan-narvaja.git' }),
        backups: backups('feria', [{ origen: 'prod', cantidad: 3, cadaDias: 7 }, { origen: 'local', cantidad: 1, cadaDias: 2 }]),
        logs: logs('feria', 5, 34),
      },
    },
    status: {
      deployed: { feria: { prod: { version: 'v1.4.1', at: hace(dias(6)), job: 'historico' } } },
      remote: { feria: { prod: { version: 'v1.4.1', checkedAt: hace(horas(3)), ok: true } } },
    },
    historial: [
      job({ project: 'feria', kind: 'deploy', label: 'Publicar en producción', target: 'prod', targetName: 'Producción (VPS)', version: 'v1.4.1', startedAt: hace(dias(6)), durationMs: 68_400, command: 'scripts/deploy.sh v1.4.1' }),
      job({ project: 'feria', kind: 'backup', label: 'Backup de Producción (VPS)', target: 'prod', targetName: 'Producción (VPS)', backup: 'prod-2026-10-02.sql.gz', startedAt: hace(dias(1.3)), durationMs: 51_900, command: 'scripts/backup-remote-db.sh' }),
      job({ project: 'feria', kind: 'action', label: 'Cargar datos de prueba', startedAt: hace(horas(20)), durationMs: 8_100, command: 'scripts/seed.sh' }),
    ].map(j => ({ ...j, _lineas: lineas(j.kind, { ...salida, version: j.version || salida.version, backup: j.backup || salida.backup }) }) as Job),
  };
}

// ---------------------------------------------------------------------------
// 2 · Equipo con staging
// ---------------------------------------------------------------------------

function equipo(): Escenario {
  const base = '/Users/mperez/workspace';

  const destinos = (nombre: string, carpeta: string) => [
    destino({ id: 'prod', name: 'Producción', short: 'Producción', badge: 'PROD', color: 'amber', host: `deploy@${nombre}.com.uy`, default: true, remoteFolder: `/var/www/${carpeta}`, remoteVersion: `/var/www/${carpeta}/VERSION`, backupLabel: 'prod', restore: 'scripts/restore-remote-db.sh', env: [['NODE_ENV', 'production'], ['APP_ENV', 'prod']] }),
    destino({ id: 'staging', name: 'Staging', short: 'Staging', badge: 'STG', color: 'green', host: `deploy@stg.${nombre}.com.uy`, remoteFolder: `/var/www/${carpeta}`, remoteVersion: `/var/www/${carpeta}/VERSION`, backupLabel: 'staging', restore: 'scripts/restore-remote-db.sh', env: [['NODE_ENV', 'production'], ['APP_ENV', 'staging']], deployHint: 'Publica para que QA pruebe antes de ir a producción.' }),
  ];

  const mutualista = config({
    name: 'Mutualista Online', workspace: `${base}/mutualista`,
    github: 'https://github.com/salud-uy/mutualista-online',
    targets: [...destinos('mutualista', 'mutualista'),
      destino({ id: 'capacitacion', name: 'Capacitación', short: 'Capacitación', badge: 'CAP', color: 'blue', host: 'deploy@cap.mutualista.com.uy', remoteFolder: '/var/www/mutualista', backupLabel: 'capacitacion', console: true, deployHint: 'Ambiente para formar al personal administrativo.' })],
    actions: [
      accion({ id: 'seed', label: 'Cargar datos de prueba', script: 'scripts/seed.sh', env: 'NODE_ENV=development' }),
      accion({ id: 'cache', label: 'Limpiar caché', script: 'scripts/clear-cache.sh' }),
    ],
  });

  const padron = config({
    name: 'Padrón Rural', workspace: `${base}/padron-rural`,
    github: 'https://github.com/salud-uy/padron-rural',
    targets: destinos('padron', 'padron'),
    actions: [accion({ id: 'importar', label: 'Importar padrón del MGAP', script: 'scripts/importar-padron.sh', groupHint: 'Procesa el archivo del ministerio sin tocar producción.' })],
  });

  const cobros = config({
    name: 'Cobros', workspace: `${base}/cobros`,
    github: 'https://github.com/salud-uy/cobros',
    targets: destinos('cobros', 'cobros'),
  });

  const ctx = (nombre: string, ws: string, v: string) => ({ proyecto: nombre, destino: 'Producción', host: `deploy@${nombre}.com.uy`, version: v, backup: 'prod-2026-10-01.sql.gz', carpeta: ws, rama: 'main' });

  return {
    id: 'equipo',
    nombre: 'Matías',
    perfil: 'Dev en un equipo de 4',
    resumen: 'Tres productos, con staging antes de producción y versiones que no siempre coinciden.',
    puedeHacer: [
      'Comparar qué versión corre en cada ambiente',
      'Promover de staging a producción el mismo tag',
      'Revisar por qué falló el último deploy',
    ],
    sugerencias: [
      'Abrí Versiones: staging va adelantado respecto de producción',
      'En el historial, mirá la salida del deploy que falló',
      'Cambiá de destino arriba a la derecha y fijate cómo cambia el panel',
      'Probá la Consola remota y escribí «pm2 status»',
    ],
    usuario: 'mperez',
    records: {
      mutualista: registro(mutualista, { version: 'v3.2.0', branch: 'main', description: 'Portal de socios' }),
      padron: registro(padron, { version: 'v1.8.4', branch: 'main', description: 'Registro de productores' }),
      cobros: registro(cobros, { version: 'v0.9.1', branch: 'develop', description: 'Cobranzas y débitos' }),
    },
    discos: {
      mutualista: {
        git: repo({ semilla: 'mutualista', workspace: mutualista.workspace, version: 'v3.2.0', cambios: 0, cantidadTags: 12, commitsNuevos: 7, adelante: 7, remoto: 'git@github.com:salud-uy/mutualista-online.git' }),
        backups: backups('mutualista', [{ origen: 'prod', cantidad: 4, cadaDias: 7 }, { origen: 'staging', cantidad: 2, cadaDias: 10 }, { origen: 'local', cantidad: 1, cadaDias: 3 }]),
        logs: logs('mutualista', 7, 52),
      },
      padron: {
        git: repo({ semilla: 'padron', workspace: padron.workspace, version: 'v1.8.4', cambios: 11, cantidadTags: 8, commitsNuevos: 2, adelante: 2, atras: 3, remoto: 'git@github.com:salud-uy/padron-rural.git' }),
        backups: backups('padron', [{ origen: 'prod', cantidad: 2, cadaDias: 14 }]),
        logs: logs('padron', 4, 28),
      },
      cobros: {
        git: repo({ semilla: 'cobros', workspace: cobros.workspace, version: 'v0.9.1', rama: 'develop', cambios: 5, cantidadTags: 4, commitsNuevos: 12, adelante: 12, remoto: 'git@github.com:salud-uy/cobros.git' }),
        backups: backups('cobros', [{ origen: 'prod', cantidad: 1, cadaDias: 9 }], { extras: false }),
        logs: logs('cobros', 3, 18),
      },
    },
    status: {
      deployed: {
        mutualista: { prod: { version: 'v3.1.6', at: hace(dias(9)), job: 'historico' }, staging: { version: 'v3.2.0', at: hace(dias(2)), job: 'historico' } },
        padron: { prod: { version: 'v1.8.4', at: hace(dias(4)), job: 'historico' } },
      },
      remote: {
        mutualista: { prod: { version: 'v3.1.6', checkedAt: hace(horas(2)), ok: true }, staging: { version: 'v3.2.0', checkedAt: hace(horas(2)), ok: true } },
        padron: { prod: { version: 'v1.8.4', checkedAt: hace(horas(26)), ok: true } },
        cobros: { prod: { version: '', checkedAt: hace(horas(5)), ok: false, error: 'ssh: connect to host cobros.com.uy port 22: Connection refused' } },
      },
    },
    historial: [
      job({ project: 'mutualista', kind: 'deploy', label: 'Deploy a staging', target: 'staging', targetName: 'Staging', version: 'v3.2.0', startedAt: hace(dias(2)), durationMs: 96_300, command: 'scripts/deploy.sh v3.2.0' }),
      job({ project: 'mutualista', kind: 'deploy', label: 'Deploy a producción', target: 'prod', targetName: 'Producción', version: 'v3.2.0', startedAt: hace(horas(30)), durationMs: 43_700, status: 'error', exitCode: 1, command: 'scripts/deploy.sh v3.2.0' }),
      job({ project: 'mutualista', kind: 'backup', label: 'Backup de Producción', target: 'prod', targetName: 'Producción', backup: 'prod-2026-10-01.sql.gz', startedAt: hace(dias(1.1)), durationMs: 118_400, command: 'scripts/backup-remote-db.sh' }),
      job({ project: 'padron', kind: 'deploy', label: 'Deploy a producción', target: 'prod', targetName: 'Producción', version: 'v1.8.4', startedAt: hace(dias(4)), durationMs: 72_100, command: 'scripts/deploy.sh v1.8.4' }),
      job({ project: 'padron', kind: 'action', label: 'Importar padrón del MGAP', startedAt: hace(dias(3)), durationMs: 214_900, command: 'scripts/importar-padron.sh' }),
      job({ project: 'cobros', kind: 'deploy', label: 'Deploy a staging', target: 'staging', targetName: 'Staging', version: 'v0.9.1', startedAt: hace(dias(5)), durationMs: 38_200, status: 'cancelled', exitCode: 143, command: 'scripts/deploy.sh v0.9.1' }),
    ].map(j => {
      const nombre = j.project === 'mutualista' ? 'mutualista' : j.project === 'padron' ? 'padron' : 'cobros';
      const ws = j.project === 'mutualista' ? mutualista.workspace : j.project === 'padron' ? padron.workspace : cobros.workspace;
      const c = { ...ctx(nombre, ws, j.version || 'v1.0.0'), destino: j.targetName || 'local', backup: j.backup || 'prod-2026-10-01.sql.gz' };
      return { ...j, _lineas: lineas(j.kind, c, j.status === 'error') } as Job;
    }),
  };
}

// ---------------------------------------------------------------------------
// 3 · Agencia con varios clientes
// ---------------------------------------------------------------------------

function agencia(): Escenario {
  const base = '/Users/estudio/clientes';
  const simple = (nombre: string, carpeta: string, opciones: { consola?: boolean; host?: string } = {}) =>
    destino({
      id: 'prod', name: 'Producción (VPS)', short: 'Producción', badge: 'VPS', color: 'amber',
      host: opciones.host ?? `deploy@${nombre}.uy`, default: true,
      remoteFolder: `/var/www/${carpeta}`, remoteVersion: `/var/www/${carpeta}/VERSION`,
      backupLabel: 'prod', restore: 'scripts/restore-remote-db.sh', console: opciones.consola ?? true,
      env: [['APP_ENV', 'prod']],
    });

  const defs = [
    { id: 'parrilla', name: 'Parrilla del Puerto', carpeta: 'parrilla', v: 'v2.6.0', tags: 14, cambios: 0, nuevos: 3 },
    { id: 'vivero', name: 'Vivero Los Aromos', carpeta: 'vivero', v: 'v1.1.0', tags: 5, cambios: 2, nuevos: 9 },
    { id: 'inmobiliaria', name: 'Inmobiliaria Rambla', carpeta: 'rambla', v: 'v4.0.1', tags: 22, cambios: 0, nuevos: 1 },
    { id: 'escuela', name: 'Escuela de Música', carpeta: 'escuela', v: 'v0.4.0', tags: 2, cambios: 18, nuevos: 15 },
  ];

  const records: Record<string, Registro> = {};
  const discos: Escenario['discos'] = {};
  for (const d of defs) {
    const ws = `${base}/${d.carpeta}`;
    const cfg = config({
      name: d.name, workspace: ws, targets: [simple(d.carpeta, d.carpeta)],
      github: `https://github.com/estudio/${d.carpeta}`,
    });
    records[d.id] = registro(cfg, { version: d.v, branch: 'main', description: 'Cliente del estudio' });
    discos[d.id] = {
      git: repo({ semilla: d.id, workspace: ws, version: d.v, cambios: d.cambios, cantidadTags: d.tags, commitsNuevos: d.nuevos, adelante: d.nuevos, remoto: `git@github.com:estudio/${d.carpeta}.git` }),
      backups: backups(d.id, [{ origen: 'prod', cantidad: d.tags > 10 ? 5 : 2, cadaDias: 7 }, { origen: 'local', cantidad: 1, cadaDias: 4 }]),
      logs: logs(d.id, d.tags > 10 ? 6 : 3, 30),
    };
  }

  // Un cliente nuevo: carpeta sin repositorio Git y sin nada configurado todavía.
  const wsNuevo = `${base}/panaderia`;
  records['panaderia'] = registro(config({
    name: 'Panadería La Espiga', workspace: wsNuevo, versionFile: '', backupFolder: '', logsFolder: '',
    restoreLocal: '',
    // Un alta recién hecha: todavía no hay scripts ni conexión cargados.
    targets: [destino({
      id: 'prod', name: 'Producción (VPS)', short: 'Producción', badge: 'VPS', color: 'amber',
      host: '', default: true, console: false,
      deploy: '', backup: '', restore: '', logs: '', remoteVersion: '', remoteFolder: '',
    })],
  }), { description: 'Recién incorporado' });
  discos['panaderia'] = {
    git: { workspace: wsNuevo, hasGit: false, version: null, branch: '', head: '', changes: 0, remote: '', commits: [], tags: [], lastTag: '', commitsSinceTag: null, ahead: null, behind: null, error: '' },
    backups: [], logs: {},
  };

  return {
    id: 'agencia',
    nombre: 'Estudio Rivera',
    perfil: 'Agencia con 5 clientes',
    resumen: 'Muchos proyectos distintos: uno sin configurar, otro con el servidor caído y otro con años de historia.',
    puedeHacer: [
      'Ver de un vistazo el estado de todos los clientes',
      'Dar de alta un cliente nuevo con el asistente',
      'Detectar cuál servidor no responde',
    ],
    sugerencias: [
      'Mirá «Panadería La Espiga»: sin Git y sin scripts, como queda un alta recién hecha',
      'Tocá «Nuevo proyecto» y recorré el asistente de 4 pasos',
      'En «Inmobiliaria Rambla» mirá el historial de 22 versiones',
      'Probá a eliminar un proyecto desde la tarjeta de Inicio',
    ],
    usuario: 'estudio',
    records,
    discos,
    status: {
      deployed: {
        parrilla: { prod: { version: 'v2.6.0', at: hace(dias(3)), job: 'historico' } },
        inmobiliaria: { prod: { version: 'v4.0.1', at: hace(dias(11)), job: 'historico' } },
        vivero: { prod: { version: 'v1.0.2', at: hace(dias(21)), job: 'historico' } },
      },
      remote: {
        parrilla: { prod: { version: 'v2.6.0', checkedAt: hace(horas(4)), ok: true } },
        inmobiliaria: { prod: { version: 'v4.0.1', checkedAt: hace(horas(8)), ok: true } },
        vivero: { prod: { version: '', checkedAt: hace(horas(1)), ok: false, error: 'ssh: connect to host vivero.uy port 22: Operation timed out' } },
      },
    },
    historial: [
      job({ project: 'parrilla', kind: 'deploy', label: 'Deploy a producción (vps)', target: 'prod', targetName: 'Producción (VPS)', version: 'v2.6.0', startedAt: hace(dias(3)), durationMs: 54_200, command: 'scripts/deploy.sh v2.6.0' }),
      job({ project: 'inmobiliaria', kind: 'deploy', label: 'Deploy a producción (vps)', target: 'prod', targetName: 'Producción (VPS)', version: 'v4.0.1', startedAt: hace(dias(11)), durationMs: 61_800, command: 'scripts/deploy.sh v4.0.1' }),
      job({ project: 'vivero', kind: 'backup', label: 'Backup de Producción (VPS)', target: 'prod', targetName: 'Producción (VPS)', backup: 'prod-2026-09-26.sql.gz', startedAt: hace(dias(7)), durationMs: 88_600, command: 'scripts/backup-remote-db.sh' }),
    ].map(j => ({
      ...j,
      _lineas: lineas(j.kind, { proyecto: j.project, destino: j.targetName || 'local', host: 'deploy@servidor.uy', version: j.version || 'v1.0.0', backup: j.backup || 'prod.sql.gz', carpeta: `${base}/${j.project}`, rama: 'main' }),
    }) as Job),
  };
}

export const ESCENARIOS: Record<string, () => Escenario> = {
  'dev-solo': devSolo,
  equipo,
  agencia,
};

export const ORDEN = ['dev-solo', 'equipo', 'agencia'] as const;
export const POR_DEFECTO = 'equipo';
