// Emulador de shell remoto. En la aplicación real del otro lado del WebSocket hay un
// `ssh -tt` sobre una PTY; acá hay un intérprete que entiende los comandos que uno
// escribiría en un servidor de verdad y responde con salidas creíbles.
import { datos } from './store';
import { diaArchivo } from './seeds/fabricas';

const VERDE = '\x1b[32m', AZUL = '\x1b[34m', GRIS = '\x1b[90m', ROJO = '\x1b[31m', AMAR = '\x1b[33m', FIN = '\x1b[0m';

export interface Sesion {
  host: string; usuario: string; maquina: string; carpeta: string; pid: string; tid: string;
}

export function crearSesion(host: string, remoteFolder: string, pid: string, tid: string): Sesion {
  const [usuario, maquina] = host.includes('@') ? host.split('@') : ['deploy', host];
  return { host, usuario, maquina, carpeta: remoteFolder || `/home/${usuario}`, pid, tid };
}

export const prompt = (s: Sesion) =>
  `${VERDE}${s.usuario}@${s.maquina.split('.')[0]}${FIN}:${AZUL}${s.carpeta}${FIN}$ `;

export function bienvenida(): string {
  return [
    'Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)',
    '',
    `  Carga del sistema:  0,24              Procesos:        138`,
    `  Uso de /:           38,4% de 78,7 GB  Usuarios:        1`,
    `  Memoria en uso:     41%               IP:              10.0.0.14`,
    '',
    `${GRIS}Último acceso: hoy desde 179.27.84.12${FIN}`,
    `${AMAR}Esta es una sesión simulada de la demo. Ningún comando sale de tu navegador.${FIN}`,
    '',
  ].join('\r\n') + '\r\n';
}

function arbol(s: Sesion): Record<string, string[]> {
  return {
    [s.carpeta]: ['current', 'releases', 'shared', 'VERSION', 'ecosystem.config.js'],
    [`${s.carpeta}/current`]: ['dist', 'node_modules', 'package.json', 'VERSION'],
    [`${s.carpeta}/releases`]: ['2026-10-01_1042', '2026-09-24_0915', '2026-09-11_1730'],
    [`${s.carpeta}/shared`]: ['uploads', 'storage', '.env'],
    '/var/log': ['app', 'nginx', 'syslog', 'auth.log'],
    [`/home/${s.usuario}`]: ['.ssh', 'backups', 'scripts'],
  };
}

function versionRemota(s: Sesion): string {
  return datos.status.deployed[s.pid]?.[s.tid]?.version
    || datos.discos[s.pid]?.git.lastTag
    || 'v1.0.0';
}

const AYUDA = [
  'Comandos reconocidos en esta demo:',
  '',
  '  ls [carpeta]      pwd            cd <carpeta>',
  '  cat <archivo>     tail <archivo> whoami / hostname / date / uptime',
  '  df -h             free -m        uname -a',
  '  pm2 status        pm2 logs       systemctl status app',
  '  git log           git status     docker ps',
  '  ps aux            top            htop',
  '  clear             exit',
  '',
  'Cualquier otra cosa responde «command not found», igual que un servidor real.',
].join('\r\n');

/** Ejecuta un comando y devuelve la salida ya con saltos de línea \r\n. */
export function ejecutar(s: Sesion, linea: string): { salida: string; salir?: boolean } {
  const texto = linea.trim();
  if (!texto) return { salida: '' };
  const [cmd, ...args] = texto.split(/\s+/);
  const arg = args.filter(a => !a.startsWith('-')).join(' ');
  const t = arbol(s);
  const nl = (x: string[]) => x.join('\r\n') + '\r\n';

  switch (cmd) {
    case 'help':
    case 'ayuda':
      return { salida: AYUDA + '\r\n' };

    case 'exit':
    case 'logout':
      return { salida: 'logout\r\n', salir: true };

    case 'clear':
      return { salida: '\x1b[2J\x1b[H' };

    case 'pwd':
      return { salida: s.carpeta + '\r\n' };

    case 'whoami':
      return { salida: s.usuario + '\r\n' };

    case 'hostname':
      return { salida: s.maquina + '\r\n' };

    case 'date':
      return { salida: new Date().toString() + '\r\n' };

    case 'uptime':
      return { salida: ` ${new Date().toTimeString().slice(0, 8)} up 31 days,  4:12,  1 user,  load average: 0,24, 0,31, 0,28\r\n` };

    case 'uname':
      return { salida: `Linux ${s.maquina.split('.')[0]} 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux\r\n` };

    case 'cd': {
      if (!arg || arg === '~') { s.carpeta = `/home/${s.usuario}`; return { salida: '' }; }
      const destino = arg === '..'
        ? s.carpeta.slice(0, s.carpeta.lastIndexOf('/')) || '/'
        : arg.startsWith('/') ? arg : `${s.carpeta}/${arg}`.replace(/\/+/g, '/');
      if (t[destino] || Object.keys(t).some(k => k.startsWith(destino + '/'))) { s.carpeta = destino; return { salida: '' }; }
      return { salida: `${ROJO}-bash: cd: ${arg}: No such file or directory${FIN}\r\n` };
    }

    case 'ls': {
      const carpeta = arg ? (arg.startsWith('/') ? arg : `${s.carpeta}/${arg}`) : s.carpeta;
      const items = t[carpeta];
      if (!items) return { salida: `${ROJO}ls: cannot access '${arg}': No such file or directory${FIN}\r\n` };
      if (args.some(a => a.includes('l'))) {
        return {
          salida: nl([`total ${items.length * 4}`, ...items.map(i => {
            const dir = !i.includes('.') || i.startsWith('.');
            return `${dir ? 'drwxr-xr-x' : '-rw-r--r--'} 1 ${s.usuario} ${s.usuario} ${String(dir ? 4096 : 1024 + i.length * 37).padStart(7)} oct  3 10:42 ${dir ? AZUL + i + FIN : i}`;
          })]),
        };
      }
      return { salida: nl([items.map(i => (i.includes('.') && !i.startsWith('.') ? i : AZUL + i + FIN)).join('  ')]) };
    }

    case 'cat': {
      if (/VERSION$/.test(arg)) return { salida: versionRemota(s) + '\r\n' };
      if (/\.env$/.test(arg)) return { salida: `${AMAR}cat: ${arg}: Permission denied${FIN}\r\n` };
      if (/package\.json$/.test(arg)) {
        return { salida: nl(['{', '  "name": "app",', `  "version": "${versionRemota(s).replace(/^v/, '')}",`, '  "private": true', '}']) };
      }
      if (!arg) return { salida: `${ROJO}cat: falta el archivo${FIN}\r\n` };
      return { salida: `${ROJO}cat: ${arg}: No such file or directory${FIN}\r\n` };
    }

    case 'tail':
    case 'head': {
      const hoy = diaArchivo(0);
      return {
        salida: nl([
          `${GRIS}==> ${arg || `/var/log/app/${hoy}.log`} <==${FIN}`,
          `{"time":"${hoy}T10:41:02","user":"mperez","type":"info","message":"Pedido #4821 confirmado","total":"$ 4.850"}`,
          `{"time":"${hoy}T10:43:55","user":"sistema","type":"info","message":"Factura electrónica enviada a DGI"}`,
          `{"time":"${hoy}T10:47:11","user":"lrodriguez","type":"warn","message":"Reintento de envío de correo (intento 2)"}`,
          `{"time":"${hoy}T10:52:30","user":"sistema","type":"error","message":"Timeout llamando a la pasarela de pagos","ms":30000}`,
        ]),
      };
    }

    case 'df':
      return {
        salida: nl([
          'Filesystem      Size  Used Avail Use% Mounted on',
          '/dev/vda1        79G   30G   46G  40% /',
          'tmpfs           2,0G     0  2,0G   0% /dev/shm',
          '/dev/vdb1       197G   88G  100G  47% /var/lib/postgresql',
        ]),
      };

    case 'free':
      return {
        salida: nl([
          '               total        used        free      shared  buff/cache   available',
          'Mem:            3934        1612         284          12        2038        2042',
          'Swap:           2047         118        1929',
        ]),
      };

    case 'pm2': {
      if (args[0] === 'logs') {
        return { salida: nl([`${GRIS}/home/${s.usuario}/.pm2/logs/app-out.log last 5 lines:${FIN}`, '0|app  | GET /api/pedidos 200 41ms', '0|app  | GET /api/clientes 200 12ms', '0|app  | POST /api/pedidos 201 88ms', `0|app  | ${AMAR}WARN${FIN} cola de correos con 3 pendientes`, '0|app  | GET /salud 200 2ms']) };
      }
      return {
        salida: nl([
          '┌────┬──────────┬─────────┬─────────┬──────────┬────────┬──────────┐',
          '│ id │ name     │ mode    │ ↺       │ status   │ cpu    │ memory   │',
          '├────┼──────────┼─────────┼─────────┼──────────┼────────┼──────────┤',
          `│ 0  │ app      │ cluster │ 0       │ ${VERDE}online${FIN}   │ 0.4%   │ 184.2mb  │`,
          `│ 1  │ worker   │ fork    │ 2       │ ${VERDE}online${FIN}   │ 0.1%   │ 62.8mb   │`,
          `│ 2  │ cron     │ fork    │ 0       │ ${VERDE}online${FIN}   │ 0.0%   │ 41.3mb   │`,
          '└────┴──────────┴─────────┴─────────┴──────────┴────────┴──────────┘',
        ]),
      };
    }

    case 'systemctl':
      return {
        salida: nl([
          `${VERDE}●${FIN} app.service - Aplicación`,
          '     Loaded: loaded (/etc/systemd/system/app.service; enabled)',
          `     Active: ${VERDE}active (running)${FIN} since hace 3 días`,
          '   Main PID: 24817 (node)',
          '      Tasks: 23 (limit: 4613)',
          '     Memory: 184.2M',
        ]),
      };

    case 'docker':
      return {
        salida: nl([
          'CONTAINER ID   IMAGE                COMMAND                  STATUS          PORTS                    NAMES',
          'a91f2c4d8b7e   app:latest           "node server.js"         Up 3 days       0.0.0.0:3000->3000/tcp   app',
          '7d3e1a0c5f22   postgres:16-alpine   "docker-entrypoint.s…"   Up 31 days      5432/tcp                 db',
          'c05b9f7a1e34   redis:7-alpine       "docker-entrypoint.s…"   Up 31 days      6379/tcp                 cache',
        ]),
      };

    case 'git': {
      const disco = datos.discos[s.pid];
      if (args[0] === 'status') {
        return { salida: nl([`On branch ${disco?.git.branch || 'main'}`, "Your branch is up to date with 'origin/main'.", '', 'nothing to commit, working tree clean']) };
      }
      const commits = (disco?.git.commits || []).slice(0, 5);
      return { salida: nl(commits.length ? commits.map(c => `${AMAR}${c.hash}${FIN} ${c.subject} ${GRIS}(${c.author})${FIN}`) : ['fatal: not a git repository']) };
    }

    case 'ps':
      return {
        salida: nl([
          'USER       PID %CPU %MEM    VSZ   RSS TTY   STAT START   TIME COMMAND',
          'root         1  0.0  0.3 168504 12964 ?     Ss   sep02   1:21 /sbin/init',
          `${s.usuario}  24817  0.4  4.7 1184920 188612 ?   Ssl  oct01   8:04 node server.js`,
          'postgres  1042  0.2  6.1 428120 241088 ?    Ss   sep02  14:38 postgres: checkpointer',
        ]),
      };

    case 'top':
    case 'htop':
      return { salida: `${AMAR}top: esta demo no emula pantallas interactivas. Probá «ps aux» o «pm2 status».${FIN}\r\n` };

    case 'sudo':
      return { salida: `${AMAR}[sudo] password for ${s.usuario}: ${FIN}\r\n${ROJO}Esta demo no ejecuta comandos con privilegios.${FIN}\r\n` };

    case 'rm':
    case 'mv':
    case 'dd':
    case 'mkfs':
      return { salida: `${AMAR}Esta demo no modifica archivos del servidor simulado.${FIN}\r\n` };

    default:
      return { salida: `${ROJO}-bash: ${cmd}: command not found${FIN}\r\n${GRIS}Escribí «help» para ver qué entiende esta demo.${FIN}\r\n` };
  }
}
