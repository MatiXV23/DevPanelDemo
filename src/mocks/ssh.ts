// Pruebas de conexión SSH simuladas. El resultado depende del host, así que la demo
// muestra siempre los tres casos reales: conecta, host caído y clave rechazada.
import { hace } from './seeds/fabricas';
import type { Destino } from './tipos';

export interface Sonda {
  ok: boolean; host: string; port: string; key: string; exitCode: number;
  output: string; remoteVersion: string; remoteVersionFile: string; checkedAt: string;
}

export interface Borrador { host: string; port?: string; key?: string; remoteVersion?: string; }

/** Hosts que fallan a propósito, para que se vea cómo informa el panel. */
function diagnostico(host: string): { ok: boolean; codigo: number; salida: string } {
  if (!host.trim()) {
    return { ok: false, codigo: 255, salida: 'ssh: no se indicó usuario@host.' };
  }
  if (/vivero|caido|offline/i.test(host)) {
    return { ok: false, codigo: 255, salida: `ssh: connect to host ${host.split('@').pop()} port 22: Operation timed out` };
  }
  if (/cobros/i.test(host)) {
    return { ok: false, codigo: 255, salida: `ssh: connect to host ${host.split('@').pop()} port 22: Connection refused` };
  }
  if (/^root@/i.test(host)) {
    return { ok: false, codigo: 255, salida: `${host}: Permission denied (publickey).\nEl servidor rechazó la clave: revisá que la pública esté en ~/.ssh/authorized_keys.` };
  }
  if (!/@/.test(host)) {
    return { ok: false, codigo: 255, salida: `ssh: Could not resolve hostname ${host}: nodename nor servname provided, or not known` };
  }
  return { ok: true, codigo: 0, salida: 'DEVPANEL_OK' };
}

export function sondear(destino: Destino | Borrador, versionConocida = ''): Sonda {
  const host = (destino.host || '').trim();
  const port = (destino.port || '22').trim() || '22';
  const key = (destino.key || '').trim();
  const archivoVersion = (destino.remoteVersion || '').trim();
  const d = diagnostico(host);

  let remota = '';
  let salida = d.salida;
  if (d.ok && archivoVersion) {
    remota = versionConocida || 'v1.0.0';
    salida = `DEVPANEL_OK\n${remota}`;
  }

  return {
    ok: d.ok, host, port, key, exitCode: d.codigo, output: salida,
    remoteVersion: remota, remoteVersionFile: archivoVersion, checkedAt: hace(0),
  };
}
