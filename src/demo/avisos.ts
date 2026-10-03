// Avisos de "esto es simulado" para las integraciones externas del producto.
// En DevOps Panel las integraciones no son pagos ni mails: son SSH, Git y el disco.
// La primera vez que una operación tocaría un servidor real, lo explicamos.

const CLAVE = 'demo-devpanel-avisos';

function vistos(): string[] {
  try { return JSON.parse(localStorage.getItem(CLAVE) || '[]'); } catch { return []; }
}
function marcar(clave: string) {
  try { localStorage.setItem(CLAVE, JSON.stringify([...new Set([...vistos(), clave])])); } catch { /* da igual */ }
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export interface AvisoJob { kind: string; label: string; command: string; host: string; destino: string; }

const TEXTOS: Record<string, (a: AvisoJob) => string> = {
  deploy: a => `En la aplicación real, el panel se conectaría por SSH a <strong>${esc(a.host || 'tu servidor')}</strong> y ejecutaría tu script de deploy dentro del workspace del proyecto. Lo que hace ese script lo definís vos: compilar, subir archivos, correr migraciones, reiniciar servicios.`,
  backup: a => `En la aplicación real, esto correría tu script de backup contra <strong>${esc(a.host || 'tu servidor')}</strong> y dejaría el archivo en la carpeta de backups de tu equipo, listo para restaurar en cualquier destino.`,
  restore: a => `En la aplicación real, esto reemplazaría la base de datos de <strong>${esc(a.destino)}</strong> con el contenido del backup elegido. Por eso el panel exige escribir la frase de confirmación antes de dejarte continuar.`,
  'restore-local': () => 'En la aplicación real, esto reemplazaría tu base de datos local con el backup elegido. Tu servidor no se toca.',
  logs: a => `En la aplicación real, esto traería los archivos de log desde <strong>${esc(a.host || 'tu servidor')}</strong> a la carpeta de logs del proyecto, para poder leerlos y filtrarlos sin entrar por SSH.`,
  action: () => 'En la aplicación real, esto ejecutaría tu propio script dentro del workspace del proyecto, con las variables de entorno del destino activo.',
};

function mostrar(aviso: AvisoJob) {
  const dialogo = document.getElementById('modal') as HTMLDialogElement | null;
  if (!dialogo) return;
  const explicacion = (TEXTOS[aviso.kind] || TEXTOS.action)(aviso);
  dialogo.className = '';
  dialogo.innerHTML = `
    <div class="modal-head">
      <h2 id="modal-title">Operación simulada</h2>
      <span class="badge green">DEMO</span>
    </div>
    <div class="modal-body">
      <p>${explicacion}</p>
      <div class="confirm-target flex" style="display:block">
        <div class="tiny subtle" style="margin-bottom:6px">COMANDO QUE SE EJECUTARÍA</div>
        <code class="mono" style="overflow-wrap:anywhere">${esc(aviso.command)}</code>
      </div>
      <p class="hint">Acá no se ejecuta nada: vas a ver la misma salida, en vivo, generada en tu navegador.
        Podés cancelarla a mitad de camino como en la aplicación real.</p>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn primary" data-cerrar-aviso>Ver la operación</button>
    </div>`;
  dialogo.querySelector('[data-cerrar-aviso]')?.addEventListener('click', () => dialogo.close());
  if (!dialogo.open) dialogo.showModal();
}

export function instalarAvisos() {
  window.addEventListener('demo:job', evento => {
    const aviso = (evento as CustomEvent<AvisoJob>).detail;
    const clave = `job:${aviso.kind}`;
    if (vistos().includes(clave)) return;
    marcar(clave);
    // Esperamos a que la aplicación termine su propio render antes de abrir el diálogo.
    setTimeout(() => mostrar(aviso), 250);
  });
}
