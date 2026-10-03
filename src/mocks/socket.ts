// WebSocket simulado para la consola remota. Habla el mismo protocolo que terminal.py:
// tramas binarias = bytes de la PTY, tramas de texto = JSON de control.
import { datos } from './store';
import { crearSesion, bienvenida, ejecutar, prompt, type Sesion } from './shell';

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

type Escucha = ((e: Event) => void) | null;

/** Implementa lo que usa operations.js: onmessage, onclose, send, close, readyState, binaryType. */
class SocketSimulado implements Partial<WebSocket> {
  static readonly CONNECTING = 0; static readonly OPEN = 1;
  static readonly CLOSING = 2; static readonly CLOSED = 3;

  readyState = 0;
  binaryType: BinaryType = 'blob';
  onopen: Escucha = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: Escucha = null;

  private sesion: Sesion | null = null;
  private buffer = '';
  private historial: string[] = [];
  private cursorHistorial = -1;
  private temporizadores: number[] = [];

  constructor(public url: string) {
    this.arrancar();
  }

  private programar(fn: () => void, ms: number) {
    this.temporizadores.push(setTimeout(fn, ms) as unknown as number);
  }

  private texto(obj: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(obj) }));
  }

  private bytes(texto: string) {
    const datos_ = codificador.encode(texto);
    this.onmessage?.(new MessageEvent('message', { data: datos_.buffer }));
  }

  private arrancar() {
    const url = new URL(this.url.replace(/^ws/, 'http'));
    const m = /\/api\/projects\/([^/]+)\/targets\/([^/]+)\/terminal/.exec(url.pathname);
    const pid = m ? decodeURIComponent(m[1]) : '';
    const tid = m ? decodeURIComponent(m[2]) : '';
    const destino = datos.records[pid]?.config.targets.find(t => t.id === tid);

    this.programar(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));

      if (!destino || !destino.host) {
        this.texto({ type: 'error', message: 'Este destino no tiene usuario@host configurado.' });
        this.programar(() => this.cerrar(1011), 300);
        return;
      }
      if (/vivero|caido|offline/i.test(destino.host)) {
        this.bytes(`\x1b[90m→ Conectando con ${destino.host}…\x1b[0m\r\n`);
        this.programar(() => {
          this.texto({ type: 'error', message: `ssh: connect to host ${destino.host.split('@').pop()} port ${destino.port || 22}: Operation timed out` });
          this.programar(() => this.cerrar(1011), 200);
        }, 1400);
        return;
      }

      this.sesion = crearSesion(destino.host, destino.remoteFolder, pid, tid);
      this.texto({
        type: 'ready', host: destino.host, port: destino.port || '22', key: destino.key,
        command: `ssh -tt -p ${destino.port || '22'} ${destino.key ? `-i ${destino.key} ` : ''}${destino.host}`,
      });
      this.programar(() => {
        this.bytes(bienvenida());
        this.bytes(prompt(this.sesion!));
      }, 420);
    }, 260);
  }

  send(dato: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== 1 || !this.sesion) return;
    if (typeof dato === 'string') return;            // {type:'resize'}: nada que hacer acá
    const texto = decodificador.decode(dato as ArrayBuffer);
    for (const ch of texto) this.tecla(ch);
  }

  private tecla(ch: string) {
    const s = this.sesion!;
    // Enter
    if (ch === '\r' || ch === '\n') {
      this.bytes('\r\n');
      const linea = this.buffer;
      this.buffer = '';
      if (linea.trim()) { this.historial.unshift(linea); this.cursorHistorial = -1; }
      const { salida, salir } = ejecutar(s, linea);
      // Un poco de demora para que se sienta una conexión remota.
      this.programar(() => {
        if (salida) this.bytes(salida);
        if (salir) {
          this.texto({ type: 'exit', code: 0 });
          this.programar(() => this.cerrar(1000), 120);
          return;
        }
        this.bytes(prompt(s));
      }, linea.trim() ? 90 + Math.random() * 180 : 0);
      return;
    }
    // Backspace
    if (ch === '\x7f' || ch === '\b') {
      if (this.buffer.length) { this.buffer = this.buffer.slice(0, -1); this.bytes('\b \b'); }
      return;
    }
    // Ctrl+C
    if (ch === '\x03') { this.bytes('^C\r\n' + prompt(s)); this.buffer = ''; return; }
    // Ctrl+L
    if (ch === '\x0c') { this.bytes('\x1b[2J\x1b[H' + prompt(s) + this.buffer); return; }
    // Ctrl+D
    if (ch === '\x04') { this.bytes('logout\r\n'); this.texto({ type: 'exit', code: 0 }); this.programar(() => this.cerrar(1000), 120); return; }
    // Flechas arriba/abajo: historial
    if (ch === '\x1b') { this.esperandoEscape = true; return; }
    if (this.esperandoEscape) {
      if (ch === '[') return;
      this.esperandoEscape = false;
      if (ch === 'A' || ch === 'B') {
        const siguiente = ch === 'A' ? this.cursorHistorial + 1 : this.cursorHistorial - 1;
        if (siguiente < -1 || siguiente >= this.historial.length) return;
        this.cursorHistorial = siguiente;
        const nuevo = siguiente === -1 ? '' : this.historial[siguiente];
        this.bytes('\r\x1b[K' + prompt(s) + nuevo);
        this.buffer = nuevo;
      }
      return;
    }
    if (ch < ' ') return;
    this.buffer += ch;
    this.bytes(ch);
  }

  private esperandoEscape = false;

  private cerrar(codigo: number) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code: codigo, wasClean: codigo === 1000 }));
  }

  close(codigo = 1000) {
    for (const t of this.temporizadores) clearTimeout(t);
    this.temporizadores = [];
    this.cerrar(codigo);
  }

  addEventListener() { /* operations.js usa las propiedades on*, no hace falta */ }
  removeEventListener() { /* ídem */ }
}

export function instalarSocket() {
  const Original = window.WebSocket;
  const Sustituto = function (this: unknown, url: string | URL, protocolos?: string | string[]) {
    const texto = String(url);
    if (texto.includes('/api/projects/') && texto.includes('/terminal')) {
      return new SocketSimulado(texto) as unknown as WebSocket;
    }
    return new Original(url, protocolos);
  } as unknown as typeof WebSocket;

  // Las constantes son de solo lectura en el tipo, pero el objeto de verdad las lleva.
  Object.assign(Sustituto, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Sustituto;
}
