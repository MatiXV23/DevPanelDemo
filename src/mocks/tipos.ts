// Las mismas formas que devuelve el backend real (server.py / operations.py).
// Si algo no está acá, el frontend no lo usa.

export interface Accion {
  id: string; group: string; groupHint: string; position: 'before' | 'after';
  label: string; style: string; script: string; args: string; env: string;
  confirm: boolean; confirmTitle: string; confirmMessage: string; confirmLabel: string;
  danger: boolean; requirePhrase: boolean;
}

export interface Destino {
  id: string; name: string; short: string; badge: string; color: string;
  host: string; version: string; default: boolean; colorValue: string;
  port: string; key: string; remoteFolder: string; env: [string, string][];
  deploy: string; deployLabel: string; deployHint: string; remoteVersion: string;
  backup: string; restore: string; backupLabel: string; logs: string;
  console: boolean; actions: Accion[];
}

export interface Config {
  name: string; workspace: string; github: string; phrase: string; phraseEnv: string;
  versionFile: string; tagPrefix: string; backupFolder: string; backupExtension: string;
  extrasSuffix: string; extrasLabel: string; origins: string; restoreLocal: string;
  protectLast: boolean; logsFolder: string; logsPattern: string; logsFormat: 'jsonl' | 'plain';
  zipName: string; actions: Accion[]; targets: Destino[];
}

export interface Registro { config: Config; revision: number; metadata: Record<string, string | number>; }

export interface Commit { hash: string; subject: string; author: string; date: string; }
export interface Tag { name: string; date: string; subject: string; }

export interface GitInfo {
  workspace: string; hasGit: boolean;
  version: { path: string; version?: string; raw?: string; missing?: boolean; error?: string } | null;
  branch: string; head: string; changes: number; remote: string;
  commits: Commit[]; tags: Tag[]; lastTag: string;
  commitsSinceTag: number | null; ahead: number | null; behind: number | null; error: string;
}

export interface ArchivoBackup {
  file: string; origin: string; knownOrigin: boolean; size: number; modified: string; extras: boolean;
}
export interface ArchivoLog { file: string; size: number; modified: string; }

export interface Job {
  id: string; project: string; target: string | null; targetName: string | null;
  kind: string; label: string; command: string;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  exitCode: number | null; startedAt: string; finishedAt: string | null; durationMs: number | null;
  version: string; backup: string; dropped: number; total: number;
  /** Salida guardada del job (en el backend real vive en .devpanel/jobs/<id>.log). */
  _lineas?: string[];
}

export interface EstadoRemoto { version: string; checkedAt: string; ok: boolean; error?: string; }
export interface EstadoDeploy { version: string; at: string; job: string; }

export interface Estado {
  deployed: Record<string, Record<string, EstadoDeploy>>;
  remote: Record<string, Record<string, EstadoRemoto>>;
}

/** Archivos que viven "en el disco" simulado de un workspace. */
export interface Disco {
  backups: ArchivoBackup[];
  logs: Record<string, string>;   // nombre de archivo -> contenido crudo (JSONL)
  git: GitInfo;
}

export interface Escenario {
  id: string;
  nombre: string;
  perfil: string;
  resumen: string;
  puedeHacer: string[];
  sugerencias: string[];
  usuario: string;
  records: Record<string, Registro>;
  discos: Record<string, Disco>;
  status: Estado;
  historial: Job[];
}
