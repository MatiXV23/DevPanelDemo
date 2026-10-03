// Fábricas de datos semilla. Todo se genera relativo al momento de arranque para que
// la demo nunca se vea vieja, y con un generador determinístico para que dos reinicios
// con el mismo escenario den exactamente lo mismo.
import type { Accion, ArchivoBackup, Commit, Config, Destino, GitInfo, Tag } from '../tipos';

/** PRNG determinístico (mulberry32) sembrado con un texto. */
export function azar(semilla: string) {
  let h = 1779033703 ^ semilla.length;
  for (let i = 0; i < semilla.length; i++) {
    h = Math.imul(h ^ semilla.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ARRANQUE = Date.now();
const MINUTO = 60_000, HORA = 60 * MINUTO, DIA = 24 * HORA;

/** Fecha ISO con offset (las unidades son minutos) hacia atrás desde el arranque. */
export function hace(minutos: number): string {
  const d = new Date(ARRANQUE - minutos * MINUTO);
  const tz = -d.getTimezoneOffset();
  const signo = tz >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${signo}${pad(tz / 60)}:${pad(tz % 60)}`;
}

export const dias = (n: number) => (n * DIA) / MINUTO;
export const horas = (n: number) => (n * HORA) / MINUTO;

export function diaArchivo(atras: number): string {
  const d = new Date(ARRANQUE - atras * DIA);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Configuración de proyectos y destinos
// ---------------------------------------------------------------------------

const COLORES: Record<string, string> = { amber: '#ddb878', green: '#9aca9f', blue: '#95b4e2', purple: '#c0a7dc', red: '#f18d87' };

export function destino(parcial: Partial<Destino> & { id: string; name: string }): Destino {
  const color = parcial.color || 'amber';
  return {
    short: parcial.name, badge: 'VPS', color, colorValue: COLORES[color] || COLORES.amber,
    host: '', version: '', default: false, port: '22', key: '~/.ssh/id_ed25519',
    remoteFolder: '', env: [], deploy: 'scripts/deploy.sh',
    deployLabel: `Deploy a ${parcial.name.toLowerCase()}`,
    deployHint: 'Compila la app, corre las migraciones y reinicia los servicios.',
    remoteVersion: '', backup: 'scripts/backup-remote-db.sh', restore: '',
    backupLabel: parcial.id, logs: 'scripts/pull-logs.sh', console: true, actions: [],
    ...parcial,
  };
}

export function accion(parcial: Partial<Accion> & { id: string; label: string; script: string }): Accion {
  return {
    group: 'Mantenimiento local', groupHint: 'Se ejecutan en tu workspace. No tocan el servidor.',
    position: 'after', style: 'secondary', args: '', env: '',
    confirm: false, confirmTitle: parcial.label, confirmMessage: '', confirmLabel: 'Ejecutar',
    danger: false, requirePhrase: false,
    ...parcial,
  };
}

export function config(parcial: Partial<Config> & { name: string; workspace: string; targets: Destino[] }): Config {
  return {
    github: '', phrase: 'RESTAURAR PRODUCCION', phraseEnv: 'CONFIRM_PHRASE',
    versionFile: 'VERSION', tagPrefix: 'v', backupFolder: 'backups', backupExtension: '.sql.gz',
    extrasSuffix: '-uploads.tar.gz', extrasLabel: 'Imágenes', origins: 'prod, staging, local',
    restoreLocal: 'scripts/restore-local-db.sh', protectLast: true,
    logsFolder: 'logs', logsPattern: '^\\d{4}-\\d{2}-\\d{2}\\.log$', logsFormat: 'jsonl',
    zipName: 'logs.zip', actions: [],
    ...parcial,
  };
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

const ASUNTOS = [
  'Corrige el cálculo de IVA en la facturación',
  'Agrega filtro por departamento en el listado',
  'Evita el doble envío al confirmar el formulario',
  'Sube el timeout de la pasarela de pagos a 30 s',
  'Normaliza los teléfonos al formato +598',
  'Cachea el padrón de localidades por 24 h',
  'Arregla el orden de las facturas por fecha',
  'Migración: índice sobre pedidos.creado_en',
  'Mejora el mensaje de error cuando falla el login',
  'Quita el console.log del checkout',
  'Actualiza las dependencias con vulnerabilidades',
  'Acelera el reporte mensual con una vista materializada',
  'Soporta exportar a CSV con punto y coma',
  'Corrige el huso horario en los comprobantes',
  'Agrega reintentos al envío de correos',
  'Valida la cédula con el dígito verificador',
  'Reduce el tamaño del bundle sacando moment',
  'Muestra el stock real en la ficha del producto',
];

const AUTORES = ['Matías Pérez', 'Lucía Rodríguez', 'Federico Silva', 'Agustina Méndez', 'Rodrigo Castro'];

export function commits(semilla: string, cantidad: number, desdeMinutos = 0): Commit[] {
  const r = azar(semilla + ':commits');
  const salida: Commit[] = [];
  let cursor = desdeMinutos;
  for (let i = 0; i < cantidad; i++) {
    cursor += 90 + Math.floor(r() * horas(20));
    salida.push({
      hash: Math.floor(r() * 0xfffffff).toString(16).padStart(7, '0').slice(0, 7),
      subject: ASUNTOS[Math.floor(r() * ASUNTOS.length)],
      author: AUTORES[Math.floor(r() * AUTORES.length)],
      date: hace(cursor),
    });
  }
  return salida;
}

const NOTAS_TAG = [
  'Facturación electrónica y reportes',
  'Mejoras de rendimiento en el listado',
  'Corrección de errores reportados por soporte',
  'Nuevo módulo de inventario',
  'Integración con la pasarela de pagos',
  'Ajustes de accesibilidad y textos',
  'Primera versión en producción',
];

/** Genera tags descendentes desde `desde` (ej. "1.4.2") hacia atrás. */
export function tags(semilla: string, desde: string, cantidad: number, prefijo = 'v'): Tag[] {
  const r = azar(semilla + ':tags');
  let [may, men, par] = desde.replace(/^v/, '').split('.').map(Number);
  const salida: Tag[] = [];
  let cursor = dias(4);
  for (let i = 0; i < cantidad; i++) {
    salida.push({
      name: `${prefijo}${may}.${men}.${par}`,
      date: hace(cursor),
      subject: NOTAS_TAG[Math.floor(r() * NOTAS_TAG.length)],
    });
    cursor += dias(5 + Math.floor(r() * 20));
    if (par > 0) par--;
    else if (men > 0) { men--; par = 1 + Math.floor(r() * 4); }
    else { may--; men = 1 + Math.floor(r() * 6); par = Math.floor(r() * 3); }
    if (may < 0) break;
  }
  return salida;
}

export function git(parcial: Partial<GitInfo> & { workspace: string }): GitInfo {
  return {
    hasGit: true, branch: 'main', head: '', changes: 0, remote: '',
    version: null, commits: [], tags: [], lastTag: '', commitsSinceTag: null,
    ahead: 0, behind: 0, error: '',
    ...parcial,
  };
}

/** Arma el GitInfo completo de un proyecto a partir de pocos datos. */
export function repo(opciones: {
  semilla: string; workspace: string; versionFile?: string; version: string;
  rama?: string; cambios?: number; remoto?: string; tagsDesde?: string; cantidadTags?: number;
  commitsNuevos?: number; adelante?: number; atras?: number;
}): GitInfo {
  const listaTags = opciones.cantidadTags === 0 ? [] : tags(opciones.semilla, opciones.tagsDesde || opciones.version, opciones.cantidadTags ?? 7);
  const nuevos = opciones.commitsNuevos ?? 4;
  const listaCommits = commits(opciones.semilla, Math.max(nuevos + 8, 12));
  return git({
    workspace: opciones.workspace,
    branch: opciones.rama || 'main',
    head: listaCommits[0]?.hash || '',
    changes: opciones.cambios ?? 0,
    remote: opciones.remoto || '',
    version: { path: opciones.versionFile || 'VERSION', version: opciones.version, raw: opciones.version },
    commits: listaCommits,
    tags: listaTags,
    lastTag: listaTags[0]?.name || '',
    commitsSinceTag: listaTags.length ? nuevos : null,
    ahead: opciones.adelante ?? 0,
    behind: opciones.atras ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export function backups(semilla: string, origenes: { origen: string; cantidad: number; cadaDias: number }[],
                        opciones: { extension?: string; extras?: boolean } = {}): ArchivoBackup[] {
  const r = azar(semilla + ':backups');
  const ext = opciones.extension ?? '.sql.gz';
  const salida: ArchivoBackup[] = [];
  for (const o of origenes) {
    for (let i = 0; i < o.cantidad; i++) {
      const atras = i * o.cadaDias + (i === 0 ? 0.3 : 0);
      salida.push({
        file: `${o.origen}-${diaArchivo(atras)}${ext}`,
        origin: o.origen,
        knownOrigin: true,
        size: Math.floor(12_000_000 + r() * 90_000_000),
        modified: hace(dias(atras)),
        extras: (opciones.extras ?? true) && i < 2,
      });
    }
  }
  return salida.sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Logs JSONL
// ---------------------------------------------------------------------------

const USUARIOS_LOG = ['mperez', 'lrodriguez', 'fsilva', 'amendez', 'soporte', 'sistema'];

const EVENTOS: { type: string; msg: string; extra?: Record<string, unknown> }[] = [
  { type: 'info', msg: 'Inicio de sesión correcto', extra: { ip: '179.27.84.12' } },
  { type: 'info', msg: 'Pedido #%N confirmado', extra: { total: '$ 4.850', moneda: 'UYU' } },
  { type: 'info', msg: 'Factura electrónica enviada a DGI', extra: { cfe: 'e-Ticket', serie: 'A' } },
  { type: 'info', msg: 'Exportación de reporte mensual', extra: { filas: 1284 } },
  { type: 'warn', msg: 'Reintento de envío de correo (intento 2)', extra: { destinatario: 'cliente@montevideo.com.uy' } },
  { type: 'warn', msg: 'Stock bajo en el artículo #%N', extra: { restantes: 3 } },
  { type: 'error', msg: 'Timeout llamando a la pasarela de pagos', extra: { ms: 30000, gateway: 'redpagos' } },
  { type: 'error', msg: 'No se pudo conectar con la base de datos', extra: { host: 'db-01', intento: 3 } },
  { type: 'info', msg: 'Alta de cliente desde el padrón', extra: { departamento: 'Canelones' } },
  { type: 'info', msg: 'Cambio de precio aplicado a 42 artículos' },
  { type: 'warn', msg: 'Cédula inválida en el formulario de alta', extra: { valor: '1.234.567-0' } },
  { type: 'error', msg: 'Error 500 al renderizar el comprobante', extra: { plantilla: 'comprobante.pdf.twig' } },
  { type: 'info', msg: 'Respaldo automático completado', extra: { tamanio: '48 MB' } },
  { type: 'info', msg: 'Sincronización con el servidor de la mutualista' },
];

/** Devuelve el contenido JSONL de un día de log. */
export function logDelDia(semilla: string, atras: number, cantidad: number): string {
  const r = azar(`${semilla}:log:${atras}`);
  const fecha = diaArchivo(atras);
  const lineas: string[] = [];
  let minuto = 7 * 60 + Math.floor(r() * 40);
  for (let i = 0; i < cantidad; i++) {
    minuto += 1 + Math.floor(r() * 26);
    if (minuto > 23 * 60 + 50) break;
    const e = EVENTOS[Math.floor(r() * EVENTOS.length)];
    const pad = (n: number) => String(n).padStart(2, '0');
    lineas.push(JSON.stringify({
      time: `${fecha}T${pad(Math.floor(minuto / 60))}:${pad(minuto % 60)}:${pad(Math.floor(r() * 60))}`,
      user: USUARIOS_LOG[Math.floor(r() * USUARIOS_LOG.length)],
      type: e.type,
      message: e.msg.replace('%N', String(1000 + Math.floor(r() * 9000))),
      ...(e.extra || {}),
    }));
  }
  return lineas.join('\n') + '\n';
}

export function logs(semilla: string, dias_: number, porDia = 40): Record<string, string> {
  const salida: Record<string, string> = {};
  for (let i = 0; i < dias_; i++) salida[`${diaArchivo(i)}.log`] = logDelDia(semilla, i, porDia);
  return salida;
}
