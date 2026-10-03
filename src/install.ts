// Punto de entrada de la demo. Corre antes que persistence.js / app.js / operations.js:
// instala el transporte simulado y recién entonces libera el arranque de la aplicación
// (ver el gate inline al principio de cada HTML).
import { instalarHttp } from './mocks/http';
import { instalarSocket } from './mocks/socket';
import { instalarAvisos } from './demo/avisos';
import { montarBadge, montarPanel, necesitaEntrada, pantallaEntrada } from './demo/ui';

instalarHttp();
instalarSocket();

async function arrancar() {
  montarBadge();
  if (necesitaEntrada()) await pantallaEntrada();
  montarPanel();
  instalarAvisos();
  window.__demoListo?.();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', arrancar, { once: true });
} else {
  void arrancar();
}
