// Salidas guionadas de los scripts. Se usan tanto para los jobs que corren en vivo
// (línea a línea, con pausas) como para el historial ya terminado.

export interface Paso { texto: string; pausa?: number }

const p = (texto: string, pausa = 110): Paso => ({ texto, pausa });

export interface ContextoSalida {
  proyecto: string; destino: string; host: string; version: string;
  backup: string; carpeta: string; rama: string;
}

function cabecera(c: ContextoSalida, titulo: string): Paso[] {
  return [
    p(`▸ ${titulo}`, 60),
    p(`  proyecto   ${c.proyecto}`, 40),
    p(`  workspace  ${c.carpeta}`, 40),
    p(`  destino    ${c.destino}${c.host ? ` (${c.host})` : ''}`, 220),
  ];
}

export function guion(kind: string, c: ContextoSalida, fallar = false): Paso[] {
  if (kind === 'deploy') {
    const pasos = [
      ...cabecera(c, `Deploy ${c.version || 'sin versión'} → ${c.destino}`),
      p('→ Verificando el working tree…', 320),
      p('  ✓ sin cambios sin commitear', 180),
      p(`→ Construyendo la aplicación (rama ${c.rama})`, 260),
      p('  vite v5.4.10 building for production...', 420),
      p('  ✓ 1.284 módulos transformados', 380),
      p('  dist/index.html                  2.41 kB │ gzip:  1.02 kB', 90),
      p('  dist/assets/index-9f2c1b.css    38.77 kB │ gzip:  7.64 kB', 90),
      p('  dist/assets/index-4ab8e0.js    214.09 kB │ gzip: 68.31 kB', 300),
      p(`→ Sincronizando con ${c.host || 'el servidor'}`, 280),
      p('  sending incremental file list', 240),
      p('  dist/ … 187 archivos, 3,2 MB transferidos', 420),
      p('→ Aplicando migraciones de base de datos', 340),
      p('  Migrating: 2026_09_14_143000_indice_pedidos_creado_en', 380),
      p('  Migrated:  2026_09_14_143000_indice_pedidos_creado_en (41,2 ms)', 260),
    ];
    if (fallar) {
      return [...pasos,
        p('→ Reiniciando los servicios', 300),
        p('  systemctl restart app.service', 420),
        p('  Job for app.service failed because the control process exited with error code.', 180),
        p('  ✕ el servicio no levantó: puerto 3000 ya en uso', 140),
        p('', 60),
        p('ERROR: el deploy se detuvo. No se cambió el symlink de la versión activa.', 0),
      ];
    }
    return [...pasos,
      p('→ Reiniciando los servicios', 300),
      p('  systemctl restart app.service', 380),
      p('  ✓ app.service activo (pid 24817)', 220),
      p('→ Verificando salud del servicio', 300),
      p('  GET /salud → 200 OK (84 ms)', 260),
      p('', 40),
      p(`✓ ${c.version || 'La aplicación'} publicada en ${c.destino}`, 0),
    ];
  }

  if (kind === 'backup') {
    return [
      ...cabecera(c, `Backup de ${c.destino}`),
      p('→ Conectando por SSH', 340),
      p('→ Volcando la base de datos', 420),
      p('  pg_dump: guardando la definición de la base', 300),
      p('  pg_dump: 48 tablas, 182.431 filas', 460),
      p('→ Comprimiendo', 380),
      p(`  ${c.backup} … 47,3 MB`, 300),
      p('→ Empaquetando imágenes subidas', 340),
      p('  2.184 archivos … 118,6 MB', 400),
      p('→ Descargando a tu equipo', 420),
      p(`  ${c.carpeta}/backups/${c.backup}`, 200),
      p('', 40),
      p('✓ Backup disponible para restaurar en cualquier destino', 0),
    ];
  }

  if (kind === 'restore' || kind === 'restore-local') {
    const donde = kind === 'restore' ? c.destino : 'tu base local';
    return [
      ...cabecera(c, `Restaurar ${c.backup} en ${donde}`),
      p('→ Verificando la frase de confirmación', 260),
      p('  ✓ frase correcta', 180),
      p('→ Creando respaldo de seguridad previo', 420),
      p('  seguridad-antes-de-restaurar.sql.gz … 46,8 MB', 300),
      p('→ Descomprimiendo el backup', 380),
      p('→ Restaurando el esquema y los datos', 520),
      p('  48 tablas restauradas', 420),
      p('  182.431 filas insertadas', 380),
      p('→ Reconstruyendo índices', 420),
      p('→ Reiniciando la aplicación', 340),
      p('', 40),
      p(`✓ ${donde} quedó con los datos de ${c.backup}`, 0),
    ];
  }

  if (kind === 'logs') {
    return [
      ...cabecera(c, `Descargar logs de ${c.destino}`),
      p('→ Buscando archivos en /var/log/app', 360),
      p('  7 archivos coinciden con el patrón', 280),
      p('→ Descargando', 320),
      p('  2026-10-03.log … 412 kB', 160),
      p('  2026-10-02.log … 388 kB', 160),
      p('  2026-10-01.log … 401 kB', 160),
      p('  … 4 archivos más', 300),
      p('', 40),
      p(`✓ Logs guardados en ${c.carpeta}/logs`, 0),
    ];
  }

  if (kind === 'ssh') {
    return [p('(salida del comando remoto)', 200), p('✓ listo', 0)];
  }

  // action
  return [
    ...cabecera(c, 'Acción local'),
    p('→ Ejecutando el script en tu workspace', 420),
    p('  ✓ 14 tablas pobladas con datos de prueba', 380),
    p('  ✓ caché de la aplicación vaciada', 300),
    p('', 40),
    p('✓ Listo', 0),
  ];
}

/** Las líneas ya resueltas, como quedarían guardadas en el historial. */
export function lineas(kind: string, c: ContextoSalida, fallar = false): string[] {
  return guion(kind, c, fallar).map(x => x.texto);
}
