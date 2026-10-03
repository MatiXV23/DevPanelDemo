'use strict';

// Operational screens backed by the local API: real script execution with live output,
// Git status, VERSION writes, backups and logs on disk, SSH checks and an interactive remote terminal.

// ---------------------------------------------------------------------------
// Project and destination context
// ---------------------------------------------------------------------------
const destinationData={};
let destinations=[];
const COLORS=['amber','green','blue','red','purple','neutral'];
function targetColor(d){return COLORS.includes(d?.color)?d.color:d?.id==='prod'?'amber':d?.id==='staging'?'green':'blue'}
function targetsFor(id){
  if(!destinationData[id])destinationData[id]=(disk.saved[id]?.targets||[]).map(d=>({...d,short:d.short||d.name,color:targetColor(d)}));
  return destinationData[id];
}
const project=()=>projects.find(p=>p.id===state.project)||{id:'',name:'',workspace:''};
const dest=()=>destinations.find(d=>d.id===state.dest)||destinations[0]||{id:'',name:'Sin destino',short:'Sin destino',badge:'—',color:'neutral',host:'',env:[],actions:[]};
const repo=()=>disk.saved[state.project]?.github||'';
const isProd=d=>(d||dest()).color==='amber';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
const MONTHS=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function fmtDate(iso){if(!iso)return '—';const d=new Date(iso);if(isNaN(d))return esc(iso);const pad=n=>String(n).padStart(2,'0');return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`}
function fmtDay(iso){if(!iso)return '—';const d=new Date(iso);if(isNaN(d))return esc(iso);return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`}
function fmtSize(bytes){if(bytes==null)return '—';if(bytes<1024)return bytes+' B';if(bytes<1048576)return (bytes/1024).toFixed(bytes<10240?1:0)+' KB';if(bytes<1073741824)return (bytes/1048576).toFixed(1)+' MB';return (bytes/1073741824).toFixed(2)+' GB'}
function fmtDuration(ms){if(ms==null)return 'en curso';if(ms<1000)return ms+' ms';if(ms<60000)return (ms/1000).toFixed(1)+' s';const m=Math.floor(ms/60000),s=Math.round((ms%60000)/1000);return `${m} min ${s} s`}
function statusBadge(status){return {running:badge('Corriendo…','amber'),ok:badge('Exitoso','green'),error:badge('Error','red'),cancelled:badge('Cancelado','neutral')}[status]||badge(esc(status||'—'))}
function kindLabel(kind){return {deploy:'Deploy',backup:'Backup',restore:'Restaurar remoto','restore-local':'Restaurar local',logs:'Descargar logs',action:'Acción',ssh:'Comando SSH'}[kind]||kind}

// ---------------------------------------------------------------------------
// Cached reads. Screens render synchronously with whatever is cached and re-render
// when a load completes; settings never triggers loads so drafts are left alone.
// ---------------------------------------------------------------------------
const cache={};
function cached(kind,pid=state.project){return cache[kind+':'+pid]}
function fetched(kind,pid=state.project){
  const key=kind+':'+pid;
  if(cache[key])return cache[key];
  const entry=cache[key]={loading:true,data:null,error:''};
  api(`/api/projects/${encodeURIComponent(pid)}/${kind}`).then(data=>{entry.data=data},error=>{entry.error=error.message}).finally(()=>{
    entry.loading=false;
    if(state.project===pid&&state.page!=='settings'||state.page==='home')render();
  });
  return entry;
}
function invalidate(kind,pid=state.project){delete cache[kind+':'+pid]}
function invalidateAll(pid=state.project){['git','backups','logs','history'].forEach(k=>invalidate(k,pid));logEntriesCache={}}
function forgetProjectCache(pid){
  ['git','backups','logs','history'].forEach(k=>invalidate(k,pid));
  delete lastJob[pid];
  Object.keys(terminals).filter(k=>k.startsWith(pid+':')).forEach(k=>{
    const session=terminals[k];
    session.ws?.close(1000);
    session.observer?.disconnect();
    session.term?.dispose();
    delete terminals[k];
  });
}
function resetProjectView(){
  logEntriesCache={};
  logView={entries:[],files:[]};
  bumpValue='';
  state.openTarget='';
  state.configTab='general';
}
function statusFor(pid,tid){
  const remote=disk.status?.remote?.[pid]?.[tid],deployed=disk.status?.deployed?.[pid]?.[tid];
  if(remote?.ok&&remote.version)return {version:remote.version,source:'remoto',at:remote.checkedAt};
  if(deployed?.version)return {version:deployed.version,source:'deploy',at:deployed.at};
  if(remote&&!remote.ok)return {version:'',source:'error',at:remote.checkedAt,error:remote.error};
  return {version:'',source:'',at:''};
}
function currentVersion(git){return git?.version?.version||git?.lastTag||''}
async function refreshStatus(){
  try{const data=await api('/api/state');disk.status=data.status||{};disk.token=data.csrfToken;syncJobs(data.jobs||{});}catch{/* keep the last known status */}
}

// ---------------------------------------------------------------------------
// Jobs: start, poll for live output, cancel, resume after reload
// ---------------------------------------------------------------------------
const jobs={};         // project id -> running job (public fields)
const lastJob={};      // project id -> last job seen in this tab, with lines
const watching={};
function syncJobs(active){Object.keys(jobs).forEach(k=>delete jobs[k]);Object.entries(active).forEach(([pid,job])=>{jobs[pid]=job;watchJob(job)})}
async function startJob(body,onDone){
  const pid=state.project;
  if(jobs[pid]){toast('Ya hay una operación en curso para este proyecto.');return}
  try{
    const job=await api(`/api/projects/${encodeURIComponent(pid)}/run`,'POST',body);
    job.lines=[];jobs[pid]=job;lastJob[pid]=job;
    render();$('#execution')?.scrollIntoView({behavior:'smooth',block:'nearest'});
    watchJob(job,onDone);
  }catch(error){toast(error.message)}
}
function watchJob(job,onDone){
  if(watching[job.id])return;
  watching[job.id]=true;
  job.lines=job.lines||[];lastJob[job.project]=job;
  let offset=0,failures=0;
  const tick=async()=>{
    let snapshot;
    try{snapshot=await api(`/api/jobs/${job.id}?offset=${offset}`);failures=0}
    catch(error){if(++failures>5){delete watching[job.id];delete jobs[job.project];job.status='error';job.lines.push('✕ Se perdió la conexión con el servidor local: '+error.message);updateOutput(job);return}setTimeout(tick,1500);return}
    if(snapshot.reset)job.lines.length=0;
    job.lines.push(...snapshot.lines);offset=snapshot.next;
    const lines=job.lines;Object.assign(job,snapshot,{lines});
    updateOutput(job);
    if(job.status==='running'){setTimeout(tick,600);return}
    delete watching[job.id];delete jobs[job.project];
    await afterJob(job);
    if(onDone)onDone(job);
  };
  tick();
}
async function afterJob(job){
  const pid=job.project;
  invalidate('history',pid);
  if(['backup','restore','restore-local'].includes(job.kind))invalidate('backups',pid);
  if(job.kind==='logs'){invalidate('logs',pid);logEntriesCache={}}
  if(job.kind==='deploy')invalidate('git',pid);
  await refreshStatus();
  if(pid===state.project&&!(state.page==='settings'&&state.dirty))render();
  toast(`${job.label}: ${{ok:'terminó correctamente',error:`terminó con error (código ${job.exitCode})`,cancelled:'cancelada'}[job.status]||job.status}`);
}
function updateOutput(job){
  if(job.project!==state.project)return;
  const out=$('#job-output');
  if(out&&out.dataset.job===job.id){out.textContent=job.lines.join('\n')||(job.status==='running'?'Esperando salida…':'(sin salida)');out.scrollTop=out.scrollHeight}
  const status=$('#job-status');
  if(status){status.innerHTML=`<span class="dot"></span>${{running:'Corriendo…',ok:'Terminado',error:'Error',cancelled:'Cancelado'}[job.status]||job.status}`;status.className=`status-label ${job.status==='error'?'danger-text':job.status==='cancelled'?'muted':''}`}
  $('#execution')?.classList.toggle('running',job.status==='running');
  const meta=$('#job-meta');if(meta)meta.textContent=`${job.command} · ${fmtDuration(job.durationMs)}`;
  if(job.status!=='running'){$('#cancel-job')?.remove();$$('[data-script][data-locked]').forEach(b=>{b.disabled=false;delete b.dataset.locked})}
}
function executionBlock(){
  const job=jobs[state.project]||lastJob[state.project];
  const running=job?.status==='running';
  return `<section class="card execution ${running?'running':''}" id="execution"><div class="card-head"><div class="flex"><h3 class="flex">${icon('terminal')} Log de ejecución</h3><span class="status-label ${job?.status==='error'?'danger-text':job?.status==='cancelled'||!job?'muted':''}" id="job-status"><span class="dot"></span>${job?{running:'Corriendo…',ok:'Terminado',error:'Error',cancelled:'Cancelado'}[job.status]:'Sin operaciones en esta pestaña'}</span></div><div class="flex"><span class="log-meta" id="job-meta">${job?`${esc(job.command)} · ${fmtDuration(job.durationMs)}`:''}</span>${running?btn('Cancelar','cancel-job','compact danger','stop',`id="cancel-job" data-job="${esc(job.id)}"`):''}${btn('','copy-log','ghost icon-only','copy','aria-label="Copiar salida"')}${btn('','collapse-log','ghost icon-only','chevron','aria-label="Plegar log"')}</div></div><pre id="job-output" aria-live="polite" data-job="${esc(job?.id||'')}">${job?esc(job.lines.join('\n')||(running?'Esperando salida…':'(sin salida)')):'La salida de deploys, backups, restauraciones y acciones aparece acá en vivo. El historial completo está en Versiones.'}</pre></section>`;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function home(){
  const empty=!projects.length;
  const deployCount=Object.values(disk.status?.deployed||{}).reduce((n,t)=>n+Object.keys(t).length,0);
  return heading('Todos tus proyectos','Una mirada a lo que está corriendo, en cada destino.',btn('Nuevo proyecto','wizard','primary','plus'))+`<div class="stats-row"><div class="stat"><span>Proyectos en tu workspace</span><strong>${String(projects.length).padStart(2,'0')}</strong></div><div class="stat"><span>Destinos configurados</span><strong>${projects.reduce((n,p)=>n+targetsFor(p.id).length,0)}</strong></div><div class="stat"><span>Deploys registrados</span><strong>${deployCount}</strong></div><div class="stat"><span>Operaciones en curso</span><strong class="${Object.keys(jobs).length?'warning-text':'success'}">${String(Object.keys(jobs).length).padStart(2,'0')}</strong></div></div>${empty?`<div class="card empty">${icon('folder')}<h3>Tu próximo proyecto empieza acá</h3><p>Elegí un repo de tu disco y conectá tu primer destino.</p>${btn('Crear mi primer proyecto','wizard','primary','plus')}</div>`:`<div class="project-grid">${projects.map((p,i)=>{const git=fetched('git',p.id);const g=git.data;const version=currentVersion(g);return `<article class="card project-card"><div class="card-head"><div class="flex"><span class="project-symbol ${['','purple','blue'][i%3]}">${esc(p.name.slice(0,2))}</span><div><h2>${esc(p.name)}</h2><div class="project-path" title="${esc(p.workspace)}">${esc(p.workspace||'Sin workspace')}</div></div></div>${disk.saved[p.id]?.github?external(disk.saved[p.id].github,icon('github')):''}</div><div class="project-git">${git.loading?'<span class="subtle">Consultando Git…</span>':git.error?`<span class="danger-text">${esc(git.error)}</span>`:g.hasGit?`<span class="mono flex">${icon('branch')} ${esc(g.branch)}</span><span class="${g.changes?'warning-text':'success'}">${g.changes?`${g.changes} cambios sin commitear`:'Working tree limpio'}</span>${version?`<span class="mono">${esc(version)}</span>`:''}`:'<span class="subtle">Sin repositorio Git</span>'}</div>${targetsFor(p.id).map(d=>{const s=statusFor(p.id,d.id);return `<div class="project-dest"><div class="flex"><span class="dot ${d.color==='amber'?'warning-text':'success'}"></span>${esc(d.short)} ${badge(esc(d.badge),d.color)}</div><span class="mono">${esc(s.version||'—')}</span><span class="${s.source==='error'?'danger-text':'muted'}">${s.source==='remoto'?'Consultado '+fmtDate(s.at):s.source==='deploy'?'Deploy '+fmtDate(s.at):s.source==='error'?'SSH falló':'Sin consultar'}</span></div>`}).join('')}<div class="project-note">${jobs[p.id]?`<span class="success">● ${esc(jobs[p.id].label)} · corriendo…</span>`:version&&targetsFor(p.id).some(d=>statusFor(p.id,d.id).version&&statusFor(p.id,d.id).version!==version)?`<span>Hay destinos con una versión distinta a ${esc(version)}</span>`:'<span class="subtle">Sin operaciones en curso</span>'}</div><div class="card-footer"><a class="btn compact" href="${urlFor('panel',p.id,destMemory[p.id]||'')}" data-open-project="${esc(p.id)}">Abrir panel ${icon('arrow')}</a><a class="btn compact ghost" href="${urlFor('console',p.id,destMemory[p.id]||'')}" data-open-console="${esc(p.id)}">${icon('terminal')} Consola</a><span class="spacer"></span>${btn('','delete-project','ghost icon-only compact danger-text','trash',`data-pid="${esc(p.id)}" aria-label="Eliminar ${esc(p.name)} del panel"`)}</div></article>`}).join('')}<div class="new-project-card"><div><span class="plus">${icon('plus')}</span><h3>Un repo más, todo en un lugar</h3><p class="hint" style="margin:6px 0 15px">Conectá tus scripts y empezá a operar.</p>${btn('Agregar proyecto','wizard','ghost')}</div></div></div>`}<div class="page-foot"><span>Todos los datos y archivos permanecen en tu equipo.</span><span class="mono">${esc(location.host)}</span></div>`;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
function gitStrip(git){
  const g=git.data;
  let inner;
  if(git.loading)inner=`<span class="subtle">Consultando el repositorio…</span>`;
  else if(git.error)inner=`${icon('warning')} <span class="danger-text">${esc(git.error)}</span>`;
  else if(!g.hasGit)inner=`${icon('folder')} <span class="muted">Este workspace no es un repositorio Git.</span>`;
  else if(g.error)inner=`${icon('warning')} <span class="danger-text">${esc(g.error)}</span>`;
  else inner=`${repo()?`<a href="${esc(repo())}/tree/${encodeURIComponent(g.branch)}" target="_blank" rel="noopener"><span class="mono">${esc(g.branch)}</span>${icon('external')}</a>`:`<span class="mono">${esc(g.branch)}</span>`}<span class="separator"></span><span class="${g.changes?'warning-text':'success'} flex">${icon(g.changes?'file':'check')}${g.changes?`${g.changes} cambios sin commitear`:'Working tree limpio'}</span>${g.ahead!=null?`<span class="separator"></span><span class="muted">${g.ahead} adelante · ${g.behind} atrás del remoto</span>`:''}${g.version?.error?`<span class="separator"></span><span class="danger-text">${esc(g.version.path)}: ${esc(g.version.error)}</span>`:g.version?.missing?`<span class="separator"></span><span class="warning-text">Falta ${esc(g.version.path)}</span>`:''}`;
  return `<div class="git-strip"><span class="label">${icon('branch')} Estado del repo</span>${inner}<span class="last mono">${esc(project().workspace||'')}</span>${btn('','refresh-git','ghost icon-only compact','refresh','aria-label="Actualizar estado de Git"')}</div>`;
}
function panel(){
  const c=config(),d=dest(),p=project(),git=fetched('git');
  const g=git.data,version=currentVersion(g);
  const status=statusFor(p.id,d.id);
  const deployed=disk.status?.deployed?.[p.id]?.[d.id];
  const parts=[];
  parts.push(heading('Panel del proyecto',`Tu espacio de operaciones para <span class="mono">${esc(p.name)}</span>.`,`<span class="tiny subtle flex">${btn('Actualizar','refresh','ghost compact','refresh')}</span>`));
  parts.push(isProd(d)?`<div class="notice">${icon('shield')}<strong>Estás en ${esc(d.name)}.</strong> Las operaciones se ejecutan sobre el servidor real. Revisá el destino antes de continuar.<span class="icon-end">${icon('server')}</span></div>`:`<div class="notice info">${icon('server')} Destino activo: <strong>${esc(d.name)}</strong><span class="mono">${esc(d.host||'sin conexión SSH')}</span></div>`);
  parts.push(gitStrip(git));
  const showDeploy=!!d.deploy,showVersion=!!c.versionFile;
  if(showDeploy||showVersion){
    const cards=[];
    if(showDeploy)cards.push(`<section class="card deploy-card"><div class="card-head"><h2 class="card-title">${icon('rocket')} Deploy</h2>${badge(esc(d.badge),d.color)}</div><div class="card-body"><p class="hint">${esc(d.deployHint||`Publicá los últimos cambios${g?.branch?` de ${g.branch}`:''} en ${d.short.toLowerCase()}.`)}</p><div class="deploy-meta"><div><div class="eyebrow">VERSIÓN A PUBLICAR</div><div class="version-number">${esc(version||'—')}</div></div><div><div class="eyebrow">COMMITS DESDE ${esc(g?.lastTag||'EL ÚLTIMO TAG')}</div><div style="font-size:20px;font-weight:500">${g?.commitsSinceTag??'—'} <span class="muted" style="font-size:12px;font-weight:400">commits</span></div></div></div><div class="between">${btn(esc(d.deployLabel||`Deploy a ${d.short.toLowerCase()}`),'deploy','primary','rocket','data-script')}${repo()&&status.version&&g?.branch?external(`${repo()}/compare/${encodeURIComponent(status.version)}...${encodeURIComponent(g.branch)}`,'Ver cambios','external'):''}</div></div><div class="card-footer"><span class="flex">${icon('clock')} Último deploy: ${deployed?`${fmtDate(deployed.at)} · ${esc(deployed.version||'sin versión')}`:'sin registros'}</span>${deployed?`<span class="success flex">${icon('check')} Exitoso</span>`:''}</div></section>`);
    if(showVersion)cards.push(`<section class="card"><div class="card-head"><h2 class="card-title">${icon('tag')} Versiones</h2>${link('versions','Ver todas '+icon('arrow'),'','tiny muted')}</div><div class="card-body"><div class="version-line"><div><p class="hint">En ${esc(d.short.toLowerCase())}</p><div class="version-number" style="margin-top:7px">${esc(status.version||'—')}</div></div><span class="version-arrow">→</span><div><p class="hint">Próxima versión</p><div class="version-number" style="margin-top:7px;color:var(--accent)">${esc(version||'—')}</div></div></div>${!status.version?badge(status.source==='error'?'SSH falló':'Estado sin consultar',status.source==='error'?'red':'neutral'):status.version===version?badge('Al día','green'):badge('Actualización pendiente','amber')}${status.source?`<span class="tiny subtle" style="margin-left:8px">${status.source==='remoto'?'Leído por SSH':status.source==='deploy'?'Según el último deploy':''} ${fmtDate(status.at)}</span>`:''}${d.host?`<div style="margin-top:10px">${btn('Consultar versión remota','ssh-check','compact ghost','refresh',`data-target="${esc(d.id)}"`)}</div>`:''}${showDeploy?`<div class="divider" style="margin:17px 0 12px"></div><label class="hint" for="version-tag">Volver a una versión anterior</label><div class="tag-select-row"><select id="version-tag">${(g?.tags||[]).length?g.tags.map(t=>`<option value="${esc(t.name)}">${esc(t.name)}${t.name===status.version?' — desplegada':''}</option>`).join(''):'<option value="">Sin tags en el repositorio</option>'}</select>${btn('Re-deploy','redeploy','','refresh',`data-script ${(g?.tags||[]).length?'':'disabled'}`)}</div>`:''}</div></section>`);
    parts.push(`<div class="grid-main" ${cards.length===1?'style="grid-template-columns:1fr"':''}>${cards.join('')}</div>`);
  }
  const before=customActions(c,d,'before'),after=customActions(c,d,'after');
  if(before)parts.push(before);
  if(c.restoreLocal||d.restore)parts.push(`<section class="card action-card"><div><h3 class="flex">${icon('database')} Sincronizar bases de datos</h3><p class="hint">Usa el backup más reciente de cada origen (${esc(d.backupLabel||d.id)} y local).</p></div><div class="flex">${c.restoreLocal?btn(`${esc(d.short)} → Local`,'sync-local','','download','data-script'):''}${d.restore?btn(`Local → ${esc(d.short)}`,'sync-remote','danger','up','data-script'):''}</div></section>`);
  if(c.backupFolder)parts.push(backupBlock(c,d));
  if(after)parts.push(after);
  parts.push(executionBlock());
  parts.push(`<footer class="page-foot"><span class="flex">${icon('shield')} Los scripts se ejecutan dentro de ${esc(c.workspace)} y reciben la conexión del destino por variables DEVPANEL_*.</span><span>Salidas guardadas en ${esc(disk.path.replace(/projects\.json$/,'jobs/'))}</span></footer>`);
  return parts.join('');
}
function customActions(c,d,position){
  const all=[...c.actions.map((a,i)=>({...a,path:`actions.${i}`})),...(d.actions||[]).map((a,i)=>({...a,path:`targets.${c.targets.indexOf(c.targets.find(t=>t.id===d.id))}.actions.${i}`}))].filter(a=>a.script&&(a.position||'after')===position);
  if(!all.length)return '';
  const groups=new Map();all.forEach(a=>{const key=a.group||'Acciones';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a)});
  return [...groups.values()].map(actions=>{const a=actions[0];return `<section class="card action-card"><div><h3 class="flex">${icon('code')}${esc(a.group||'Acciones')}</h3><p class="hint">${esc(a.groupHint||'')}</p></div><div class="flex wrap">${actions.map(x=>btn(esc(x.label),'custom-action',x.style==='secondary'?'':x.style,'play',`data-path="${esc(x.path)}" data-script`)).join('')}</div></section>`}).join('');
}
function backupBlock(c,d){
  const entry=fetched('backups');const rows=entry.data?.files||[];
  const total=rows.reduce((n,b)=>n+(b.size||0),0);
  let body;
  if(entry.loading)body=`<tr><td colspan="7" class="empty">◌ Leyendo la carpeta de backups…</td></tr>`;
  else if(entry.error)body=`<tr><td colspan="7" class="empty danger-text">${esc(entry.error)}</td></tr>`;
  else if(!entry.data.exists)body=`<tr><td colspan="7"><div class="empty">${icon('folder')}<h3>La carpeta ${esc(c.backupFolder)} no existe</h3><p>Creala dentro del workspace o cambiá la ruta en Configuración.</p></div></td></tr>`;
  else if(!rows.length)body=`<tr><td colspan="7"><div class="empty">${icon('database')}<h3>No hay backups todavía</h3><p>${d.backup?`Creá el primero desde ${esc(d.short.toLowerCase())} para tener un punto de recuperación.`:'Configurá el script de backup del destino para crearlos desde acá.'}</p></div></td></tr>`;
  else body=rows.map(b=>`<tr><td><input type="checkbox" class="backup-check" value="${esc(b.file)}" aria-label="Seleccionar ${esc(b.file)}"></td><td class="file-cell">${icon('file')}${esc(b.file)}</td><td>${badge(esc(b.origin),b.origin===(d.backupLabel||d.id)?d.color:b.origin==='local'?'neutral':b.knownOrigin?'blue':'neutral')}</td><td>${fmtSize(b.size)}</td><td>${b.extras?`<span class="success">${esc(c.extrasLabel||'Extras')} ✓</span>`:'<span class="subtle">—</span>'}</td><td>${fmtDate(b.modified)}</td><td><div class="row-actions">${c.restoreLocal?btn('Local','restore-local','compact','download',`data-file="${esc(b.file)}" data-script title="Restaurar en local"`):''}${d.restore?btn(esc(d.short),'restore-remote','compact danger','refresh',`data-file="${esc(b.file)}" data-script title="Restaurar en ${esc(d.short)}"`):''}${btn('','delete-backup','compact ghost icon-only','trash',`data-file="${esc(b.file)}" data-script aria-label="Eliminar ${esc(b.file)}"`)}</div></td></tr>`).join('');
  return `<section class="card section-gap"><div class="card-head"><div><h2 class="card-title">${icon('database')} Backups ${badge(rows.length)}</h2><p class="hint">Guardados en tu disco. Disponibles para restaurar en cualquier destino.</p></div><div class="flex">${btn('','refresh-backups','ghost icon-only','refresh','aria-label="Releer backups"')}${d.backup?btn(`Crear backup de ${esc(d.short.toLowerCase())}`,'backup','','plus','data-script'):''}</div></div><div class="table-toolbar"><span class="mono tiny subtle">${esc(c.workspace)}/${esc(c.backupFolder)}</span>${btn('Eliminar seleccionados','delete-selected','danger compact','trash','disabled id="delete-selected" data-script')}</div><div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="all-backups" aria-label="Seleccionar todos los backups" ${rows.length<=1?'disabled':''}></th><th>Archivo</th><th>Origen</th><th>Tamaño</th><th>Extras</th><th>Fecha</th><th>Acciones</th></tr></thead><tbody>${body}</tbody></table></div><div class="table-caption">${icon('shield')} ${c.protectLast?'El último backup está protegido y no se puede eliminar.':'Todos los backups se pueden eliminar.'}<span class="spacer"></span>${rows.length} archivos · ${fmtSize(total)}</div></section>`;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------
function versionSummary(){const g=cached('git')?.data;if(!g)return 'Abrí Versiones para consultar el archivo y los tags del repositorio.';return `Versión actual: <code>${esc(currentVersion(g)||'—')}</code> · Último tag: <code>${esc(g.lastTag||'ninguno')}</code>`}
function tagList(q){
  const g=cached('git')?.data;const tags=(g?.tags||[]).filter(t=>`${t.name} ${t.subject}`.toLowerCase().includes(q.toLowerCase()));
  if(!g)return '<div class="empty">Consultando tags…</div>';
  if(!g.tags?.length)return '<div class="empty">No hay versiones publicadas todavía.<br>Creá el primer tag desde «Preparar próxima versión».</div>';
  if(!tags.length)return '<div class="empty">No hay tags que coincidan.</div>';
  return tags.map((t,i)=>{const where=destinations.filter(d=>statusFor(state.project,d.id).version===t.name);const previous=g.tags[i+1]?.name;return `<div class="timeline-item"><div class="timeline-marker">${icon('tag')}</div><div class="timeline-content"><div class="between"><h3>${esc(t.name)}</h3><span class="flex">${where.map(d=>badge(esc(d.badge),d.color)).join('')}</span></div><p>${esc(t.subject||'')}</p><span class="tiny subtle">${fmtDay(t.date)}</span>${repo()?`<div class="flex" style="margin:10px 0">${external(`${repo()}/tree/${encodeURIComponent(t.name)}`,'Tag')}${external(`${repo()}/releases/tag/${encodeURIComponent(t.name)}`,'Release')}${previous?external(`${repo()}/compare/${encodeURIComponent(previous)}...${encodeURIComponent(t.name)}`,'Compare'):''}</div>`:''}${destinations.some(d=>d.deploy)?btn('Re-deployar en…','tag-dest','compact','chevron',`data-tag="${esc(t.name)}" data-script`):''}</div></div>`}).join('');
}
function versions(){
  const c=config(),p=project();
  if(!c.versionFile)return heading('Versiones','Qué versión corre en cada destino.')+`<section class="card empty">${icon('tag')}<h3>Sin archivo de versión configurado</h3><p>Elegí el archivo VERSION en Configuración para activar esta pantalla.</p>${link('settings','Ir a Configuración','settings','btn primary')}</section>`;
  const git=fetched('git'),history=fetched('history');const g=git.data,version=currentVersion(g);
  const versionInfo=g?.version;
  const versionNote=git.loading?'Leyendo…':git.error?git.error:versionInfo?.missing?`Falta ${versionInfo.path}`:versionInfo?.error?versionInfo.error:`Archivo ${versionInfo?.path||c.versionFile} · ${versionInfo?.raw||'—'}`;
  const rows=destinations.map(d=>{const s=statusFor(p.id,d.id);const deployed=disk.status?.deployed?.[p.id]?.[d.id];return `<tr><td><span class="flex">${badge(esc(d.badge),d.color)} <strong style="color:var(--text)">${esc(d.name)}</strong></span></td><td class="mono">${esc(s.version||'—')}${s.source?`<div class="tiny subtle">${s.source==='remoto'?'SSH':s.source==='deploy'?'último deploy':'SSH falló'} · ${fmtDate(s.at)}</div>`:''}</td><td>${deployed?`${fmtDate(deployed.at)} <span class="success">✓</span>`:'—'}</td><td>${!s.version?badge('Sin consultar','neutral'):s.version===version?badge('Al día','green'):badge('Distinta','amber')}</td><td><div class="flex">${d.deploy?btn('Deploy','matrix-deploy','compact','rocket',`data-target="${esc(d.id)}" data-script`):''}${d.deploy&&g?.tags?.length?btn('Otra versión','choose-version','compact ghost','chevron',`data-target="${esc(d.id)}" data-script`):''}${d.host?btn('Consultar','ssh-check','compact ghost','refresh',`data-target="${esc(d.id)}"`):''}</div></td></tr>`}).join('');
  const commits=(g?.commits||[]).slice(0,g?.commitsSinceTag!=null?Math.max(g.commitsSinceTag,0):8);
  const hist=history.data?.history||[];
  return heading('Versiones','Una misma fuente de verdad. Todos los destinos a la vista.',badge(esc(versionNote),versionInfo?.error||versionInfo?.missing||git.error?'red':'neutral'))+`<section class="card"><div class="card-head"><h2 class="card-title">${icon('server')} Versiones por destino</h2><span class="hint">Versión actual <code class="success">${esc(version||'—')}</code></span></div><div class="table-wrap"><table><thead><tr><th>Destino</th><th>Versión desplegada</th><th>Último deploy</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">Sin destinos configurados.</td></tr>'}</tbody></table></div></section><div class="grid-main section-gap"><section class="card"><div class="card-head"><div><h2 class="card-title">${icon('tag')} Preparar próxima versión</h2><p class="hint">Escribe ${esc(c.versionFile)} en el workspace${g?.hasGit?' y, si querés, crea el commit y el tag':''}.</p></div></div><div class="card-body"><div class="between"><div class="segmented" id="bump-options">${['patch','minor','major'].map(x=>`<button data-action="bump-preview" data-bump="${x}" ${!versionInfo?.version?'disabled':''}>${x}</button>`).join('')}</div><div class="mono" id="bump-value">${esc(versionInfo?.version||'—')}</div></div><div class="notice info" style="margin:16px 0">${icon('file')} <span id="bump-hint">${versionInfo?.version?'Elegí el tipo de cambio para ver la próxima versión.':versionInfo?.missing?'El archivo no existe: se creará con la versión que elijas.':'Escribí la versión manualmente.'}</span></div><div class="flex wrap"><input id="bump-manual" class="mono" placeholder="o escribí una versión, ej. 2.0.0" aria-label="Versión manual" style="width:220px">${g?.hasGit?`<label class="switch"><input type="checkbox" id="bump-tag"> Crear commit y tag ${esc(c.tagPrefix||'')}X.Y.Z</label>`:''}</div><div style="margin-top:14px">${btn('Actualizar '+esc(c.versionFile),'bump-save','primary','check','id="bump-save" data-script')}</div>${g?.hasGit?`<div class="section-heading"><h3>Commits desde ${esc(g.lastTag||'el inicio')}</h3>${badge(`${g.commitsSinceTag??g.commits.length} commits`)}</div>${commits.length?commits.map(cm=>`<div class="commit">${repo()?`<a class="hash" href="${esc(repo())}/commit/${esc(cm.hash)}" target="_blank" rel="noopener">${esc(cm.hash)}</a>`:`<span class="hash">${esc(cm.hash)}</span>`}<div>${esc(cm.subject)}<div class="meta">${esc(cm.author)} · ${fmtDate(cm.date)}</div></div></div>`).join(''):'<p class="hint">No hay commits nuevos desde el último tag.</p>'}`:''}</div></section><section class="card"><div class="card-head"><h2 class="card-title">${icon('clock')} Historial de versiones</h2>${badge(`${g?.tags?.length||0} tags`)}</div><div class="card-body" style="padding-bottom:14px"><div class="search">${icon('search')}<input id="tag-search" placeholder="Buscar tag o mensaje…" aria-label="Buscar versiones"></div></div><div id="tags-list">${tagList('')}</div></section></div><section class="card section-gap"><div class="card-head"><h2 class="card-title">${icon('log')} Historial de operaciones</h2><span class="hint">${history.loading?'Cargando…':`${hist.length} registros en disco`}</span></div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Destino</th><th>Operación</th><th>Versión</th><th>Duración</th><th>Resultado</th><th></th></tr></thead><tbody>${hist.length?hist.map(h=>`<tr><td>${fmtDate(h.startedAt)}</td><td>${esc(h.targetName||'Local')}</td><td style="color:var(--text)">${esc(h.label)}</td><td class="mono">${esc(h.version||h.backup||'—')}</td><td class="mono">${fmtDuration(h.durationMs)}</td><td>${statusBadge(h.status)}${h.status==='error'?` <span class="tiny subtle">código ${h.exitCode}</span>`:''}</td><td>${btn('Ver salida','history-output','compact ghost','terminal',`data-id="${esc(h.id)}"`)}</td></tr>`).join(''):`<tr><td colspan="7" class="empty">${history.error?esc(history.error):'Todavía no se ejecutó ninguna operación en este proyecto.'}</td></tr>`}</tbody></table></div></section>`;
}
function bumpFrom(version,kind){const m=/^v?(\d+)\.(\d+)\.(\d+)/.exec(version||'');if(!m)return '';let [major,minor,patch]=m.slice(1).map(Number);if(kind==='patch')patch++;if(kind==='minor'){minor++;patch=0}if(kind==='major'){major++;minor=patch=0}return `${version.startsWith('v')?'v':''}${major}.${minor}.${patch}`}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------
let logEntriesCache={};   // file name -> entries (current project)
let logView={entries:[],files:[]};
function logRows(entries){return entries.length?entries.map((l,i)=>`<tr class="${l.type==='error'?'error-row':''}"><td class="mono">${esc(l.time||'—')}</td><td>${esc(l.user||'—')}</td><td>${badge(esc(l.type),l.type==='error'?'red':'neutral')}</td><td style="color:${l.type==='error'?'var(--danger)':'var(--text)'}">${esc(l.text)}</td><td>${btn('','log-detail','ghost compact','eye',`data-index="${i}" aria-label="Ver detalle"`)}</td></tr>`).join(''):'<tr><td colspan="5"><div class="empty">No hay eventos que coincidan con los filtros.</div></td></tr>'}
function logs(){
  const c=config(),d=dest();
  if(!c.logsFolder)return heading('Logs de la app','Archivos y eventos de tu aplicación.')+`<section class="card empty">${icon('log')}<h3>Sin logs configurados</h3><p>Elegí una carpeta de logs en Configuración y asigná el script de descarga del destino.</p>${link('settings','Configurar logs','settings','btn primary')}</section>`;
  const entry=fetched('logs');const files=entry.data?.files||[];
  const total=files.reduce((n,f)=>n+(f.size||0),0);
  const users=[...new Set(logView.entries.map(e=>e.user).filter(Boolean))];
  return heading('Logs de la app',`Archivos en ${esc(c.workspace)}/${esc(c.logsFolder)}${d.logs?`, descargados desde ${esc(d.name)}`:''}.`,badge(esc(d.badge),d.color))+`<section class="card"><div class="card-head"><div><h2 class="card-title">${icon('download')} Descargar logs de ${esc(d.short.toLowerCase())}</h2><p class="hint" style="max-width:720px">${d.logs?`Ejecuta <code>${esc(d.logs)}</code> con la conexión de ${esc(d.name)}. Lo que haga con los archivos remotos depende del script.`:'Este destino no tiene script de descarga configurado. Podés ver los archivos que ya están en la carpeta.'}</p></div>${d.logs?btn('Descargar logs','pull-logs','primary','download','data-script'):''}</div></section>${executionBlock()}<section class="card section-gap"><div class="card-head"><div><h2 class="card-title">${icon('folder')} Archivos en disco</h2><p class="hint" id="log-selection">${files.length} archivos · ${fmtSize(total)} · 0 seleccionados</p></div><div class="flex">${btn('','refresh-logs','ghost icon-only','refresh','aria-label="Releer carpeta"')}${btn(`Descargar seleccionados (${esc(c.zipName||'logs.zip')})`,'zip-logs','','download','id="zip-logs" disabled')}</div></div><div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="all-logs" aria-label="Seleccionar todos los logs"></th><th>Archivo</th><th>Tamaño</th><th>Modificado</th><th>Acciones</th></tr></thead><tbody>${entry.loading?'<tr><td colspan="5" class="empty">◌ Leyendo la carpeta…</td></tr>':entry.error?`<tr><td colspan="5" class="empty danger-text">${esc(entry.error)}</td></tr>`:!entry.data.exists?`<tr><td colspan="5" class="empty">La carpeta ${esc(c.logsFolder)} no existe en el workspace.</td></tr>`:files.length?files.map(f=>`<tr><td><input type="checkbox" class="log-check" value="${esc(f.file)}" aria-label="Seleccionar ${esc(f.file)}"></td><td class="file-cell">${icon('file')}${esc(f.file)}</td><td>${fmtSize(f.size)}</td><td>${fmtDate(f.modified)}</td><td><div class="row-actions">${btn('Ver','view-log','compact ghost','eye',`data-file="${esc(f.file)}"`)}${btn('Descargar','download-log','compact ghost','download',`data-file="${esc(f.file)}"`)}${btn('','delete-log','compact ghost danger-text','trash',`data-file="${esc(f.file)}" aria-label="Eliminar ${esc(f.file)}"`)}</div></td></tr>`).join(''):'<tr><td colspan="5" class="empty">No hay archivos que coincidan con el patrón configurado.</td></tr>'}</tbody></table></div></section>${c.logsFormat==='jsonl'?`<section class="card section-gap"><div class="card-head"><h2 class="card-title">${icon('search')} Visor de eventos</h2>${badge('JSONL','neutral')}</div><div class="filter-bar"><div class="search">${icon('search')}<input id="log-query" placeholder="Buscar en los eventos…" aria-label="Buscar eventos"></div><select id="log-type" aria-label="Tipo de evento"><option value="">Todos los tipos</option>${[...new Set(logView.entries.map(e=>e.type))].map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select><select id="log-user" aria-label="Usuario"><option value="">Todos los usuarios</option>${users.map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join('')}</select><input type="date" id="log-from" aria-label="Fecha desde" title="Desde"><input type="date" id="log-to" aria-label="Fecha hasta" title="Hasta">${btn('Aplicar / refrescar','filter-logs','','refresh')}</div><div class="table-caption" id="log-results">${logView.files.length?`${logView.entries.length} entradas en ${logView.files.length} archivos`:'Elegí archivos y tocá Aplicar / refrescar.'}</div><div class="table-wrap log-viewer"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Tipo</th><th>Descripción</th><th>Detalle</th></tr></thead><tbody id="log-rows">${logView.files.length?logRows(logView.entries):'<tr><td colspan="5" class="empty">Sin archivos seleccionados.</td></tr>'}</tbody></table></div></section>`:''}`;
}
async function loadLogEntries(files){
  const pid=state.project;
  const missing=files.filter(f=>!logEntriesCache[f]);
  await Promise.all(missing.map(async f=>{const data=await api(`/api/projects/${encodeURIComponent(pid)}/logs/file?name=${encodeURIComponent(f)}`);logEntriesCache[f]=(data.entries||[]).map(e=>({...e,file:f}))}));
  return files.flatMap(f=>logEntriesCache[f]||[]);
}
function applyLogFilters(){
  const q=($('#log-query')?.value||'').toLowerCase(),type=$('#log-type')?.value||'',user=$('#log-user')?.value||'',from=$('#log-from')?.value||'',to=$('#log-to')?.value||'';
  const day=t=>(t||'').replace('T',' ').slice(0,10);
  const rows=logView.entries.filter(l=>(!type||l.type===type)&&(!user||l.user===user)&&(!from||day(l.time)>=from)&&(!to||day(l.time)<=to)&&(`${l.text} ${l.user} ${JSON.stringify(l.raw||'')}`).toLowerCase().includes(q));
  logView.filtered=rows;
  $('#log-rows').innerHTML=logRows(rows);
  $('#log-results').textContent=`${rows.length} de ${logView.entries.length} entradas en ${logView.files.length} archivos`;
}
async function downloadBlob(path,body,name){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-DevPanel-Token':disk.token},body:JSON.stringify(body)});
  if(!response.ok){let message='No se pudo generar el archivo.';try{message=(await response.json()).error||message}catch{}throw new Error(message)}
  const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// ---------------------------------------------------------------------------
// Console: remote commands over SSH (one command per job, output streamed)
// ---------------------------------------------------------------------------
function consolePage(){
  const d=dest();
  const ready=d.console&&d.host;
  const session=ready?terminalFor(state.project,d.id):null;
  return heading('Consola remota',`Terminal interactiva sobre el servidor de ${esc(d.short.toLowerCase())} por SSH. La sesión queda abierta mientras navegás por el panel.`,badge(esc(d.name),d.color))+`${isProd(d)?`<div class="notice">${icon('warning')} <strong>Consola de producción.</strong> Estás en una shell real del servidor: verificá cada comando antes de ejecutarlo.</div>`:''}<section class="card">${ready?`<div class="card-head"><div class="flex">${btn('Probar conexión','ssh-check','','refresh',`data-target="${esc(d.id)}"`)}<span id="connection-status" class="tiny ${sshState(d.id)==='ok'?'success':sshState(d.id)==='error'?'danger-text':'muted'}">${sshSummary(d.id)}</span></div><div class="flex"><span class="mono tiny muted">${esc(d.host)} · puerto ${esc(d.port||'22')}</span>${btn('Editar conexión','edit-connection','compact ghost','settings',`data-target="${esc(d.id)}"`)}</div></div><div id="xterm-container" class="terminal terminal-live" role="region" aria-label="Terminal remota">${typeof Terminal==='undefined'?`<div class="terminal-empty">${icon('warning')}<p>No se pudo cargar xterm.js (dist/vendor). Recargá la página.</p></div>`:''}</div><div class="card-footer" style="gap:10px"><span id="terminal-status" class="tiny">${terminalStatusText(session)}</span><span class="spacer"></span><div class="flex" id="terminal-actions">${terminalButtons(session)}</div></div>`:`<div class="empty">${icon('terminal')}<h3>Sin consola configurada</h3><p>Completá usuario@host y la clave SSH del destino y habilitá la consola en Configuración.</p>${btn('Configurar conexión','edit-connection','primary','settings',`data-target="${esc(d.id)}"`)}</div>`}</section><div class="notice info section-gap">${icon('shield')} La sesión corre en tu equipo como <code>ssh -tt -p ${esc(d.port||'22')} ${d.key?'-i '+esc(d.key)+' ':''}${esc(d.host)}</code> dentro de una pseudo-terminal: funcionan <code>sudo</code>, <code>top</code>, editores y el autocompletado. ${d.remoteFolder?`Arranca en <code>${esc(d.remoteFolder)}</code>. `:''}Clave privada: ${esc(d.key||'la del agente SSH')}. Si la clave tiene passphrase, escribila en la terminal.</div>`;
}

// ---------------------------------------------------------------------------
// Interactive terminal: xterm.js in the browser, a PTY-backed `ssh -tt` on the server,
// bytes relayed over a WebSocket. One session per project + destination. Sessions live
// for the tab: navigating away keeps the SSH session and coming back reattaches it.
// ---------------------------------------------------------------------------
const terminals={};
const terminalKey=(pid,tid)=>`${pid}:${tid}`;
const encoder=new TextEncoder();
function terminalFor(pid,tid){return terminals[terminalKey(pid,tid)]||null}
function terminalStatusText(s){
  if(!s||s.status==='idle')return '<span class="muted">○ Sin conectar</span>';
  if(s.status==='connecting')return '<span class="warning-text">◌ Conectando…</span>';
  if(s.status==='connected')return `<span class="success">● Conectado</span> <span class="muted">· ${esc(s.host||'')}</span>`;
  return `<span class="muted">○ Sesión terminada${s.code!=null&&s.code!==0?` <span class="danger-text">(código ${s.code})</span>`:''}</span>`;
}
function terminalButtons(s){
  const live=s&&(s.status==='connected'||s.status==='connecting');
  return (live?btn('Desconectar','terminal-disconnect','compact danger','stop'):btn(s&&s.status!=='idle'?'Reconectar':'Conectar','terminal-connect','compact primary','play'))+btn('Limpiar','terminal-clear','compact ghost','trash');
}
function updateTerminalStatus(s){
  if(state.page!=='console'||s!==terminalFor(state.project,dest().id))return;
  const status=$('#terminal-status'),actions=$('#terminal-actions');
  if(status)status.innerHTML=terminalStatusText(s);
  if(actions)actions.innerHTML=terminalButtons(s);
}
function createTerminal(pid,tid){
  const s={pid,tid,status:'idle',code:null,host:'',ws:null,retried:false,wrapper:document.createElement('div')};
  s.wrapper.className='xterm-host';
  s.term=new Terminal({cursorBlink:true,fontSize:13,lineHeight:1.25,scrollback:5000,fontFamily:"'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace",theme:{background:'#0d100e',foreground:'#c9d6ca',cursor:'#b9ef82',cursorAccent:'#0d100e',selectionBackground:'#33452c',black:'#1b201c',red:'#f18d87',green:'#9aca9f',yellow:'#ddb878',blue:'#95b4e2',magenta:'#c0a7dc',cyan:'#8fcbc4',white:'#c9d6ca',brightBlack:'#546258',brightRed:'#f5a9a4',brightGreen:'#b9ef82',brightYellow:'#e8cd9b',brightBlue:'#adc4e8',brightMagenta:'#d2bfe8',brightCyan:'#a9dcd6',brightWhite:'#e9eeeb'}});
  s.fit=new FitAddon.FitAddon();s.term.loadAddon(s.fit);
  if(window.WebLinksAddon)s.term.loadAddon(new WebLinksAddon.WebLinksAddon((e,url)=>window.open(url,'_blank','noopener')));
  s.term.open(s.wrapper);
  s.term.onData(data=>{if(s.ws?.readyState===1)s.ws.send(encoder.encode(data))});
  s.term.onBinary(data=>{if(s.ws?.readyState===1)s.ws.send(Uint8Array.from(data,ch=>ch.charCodeAt(0)))});
  s.term.onResize(({cols,rows})=>{if(s.ws?.readyState===1)s.ws.send(JSON.stringify({type:'resize',cols,rows}))});
  if(window.ResizeObserver){s.observer=new ResizeObserver(()=>requestAnimationFrame(()=>fitTerminal(s)));s.observer.observe(s.wrapper)}
  terminals[terminalKey(pid,tid)]=s;
  return s;
}
function fitTerminal(s){
  if(!s?.wrapper.isConnected)return;
  // A container that is not laid out yet (hidden tab, pane still opening) proposes absurd sizes; wait for the ResizeObserver.
  let d;try{d=s.fit.proposeDimensions()}catch{return}
  if(!d||d.cols<20||d.rows<3)return;
  if(d.cols!==s.term.cols||d.rows!==s.term.rows)s.term.resize(d.cols,d.rows);
}
function connectTerminal(s){
  if(!s||(s.ws&&s.ws.readyState<2))return;
  const d=targetsFor(s.pid).find(t=>t.id===s.tid);
  if(!d?.host){toast('Este destino no tiene usuario@host.');return}
  s.status='connecting';s.code=null;s.host=d.host;updateTerminalStatus(s);
  fitTerminal(s);
  const url=`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/projects/${encodeURIComponent(s.pid)}/targets/${encodeURIComponent(s.tid)}/terminal?token=${encodeURIComponent(disk.token)}&cols=${s.term.cols}&rows=${s.term.rows}`;
  const ws=new WebSocket(url);ws.binaryType='arraybuffer';s.ws=ws;
  s.term.writeln(`\x1b[90m→ Conectando con ${d.host} (puerto ${d.port||22})…\x1b[0m`);
  ws.onmessage=e=>{
    if(typeof e.data!=='string'){s.term.write(new Uint8Array(e.data));return}
    let m;try{m=JSON.parse(e.data)}catch{return}
    if(m.type==='ready'){s.status='connected';s.retried=false;s.host=m.host;updateTerminalStatus(s);s.term.focus();ws.send(JSON.stringify({type:'resize',cols:s.term.cols,rows:s.term.rows}))}
    else if(m.type==='exit'){s.status='closed';s.code=m.code;s.term.writeln(`\r\n\x1b[90m○ Sesión terminada${m.code!=null?` (código ${m.code})`:''}. Tocá Reconectar para abrir otra.\x1b[0m`);updateTerminalStatus(s)}
    else if(m.type==='error'){s.status='closed';s.term.writeln(`\r\n\x1b[31m✕ ${m.message}\x1b[0m`);updateTerminalStatus(s)}
  };
  ws.onclose=async ev=>{
    if(s.ws!==ws)return;
    s.ws=null;
    if(s.status==='connecting'&&!s.retried){
      // The handshake was refused, typically because the server session token changed: refresh it and retry once.
      s.retried=true;await refreshStatus();
      if(s.wrapper.isConnected){connectTerminal(s);return}
    }
    if(s.status!=='closed'){s.status='closed';s.term.writeln(`\r\n\x1b[90m○ Conexión cerrada${ev.code&&ev.code!==1000&&ev.code!==1005?` (${ev.code})`:''}.\x1b[0m`)}
    updateTerminalStatus(s);
  };
}
function disconnectTerminal(s){if(s?.ws){s.status='closed';s.ws.close(1000)}updateTerminalStatus(s)}
function mountTerminal(){
  const box=$('#xterm-container');const d=dest();
  if(!box||!d.console||!d.host||typeof Terminal==='undefined')return;
  const s=terminalFor(state.project,d.id)||createTerminal(state.project,d.id);
  if(s.wrapper.parentElement!==box)box.appendChild(s.wrapper);
  fitTerminal(s);
  if(s.status==='idle')connectTerminal(s);
  else if(s.status==='connected')s.term.focus();
  updateTerminalStatus(s);
}
window.addEventListener('resize',()=>{if(state.page==='console')fitTerminal(terminalFor(state.project,dest().id))});
window.addEventListener('beforeunload',()=>{Object.values(terminals).forEach(s=>s.ws?.close(1000))});
function sshState(tid){const r=disk.status?.remote?.[state.project]?.[tid];return !r?'':r.ok?'ok':'error'}
function sshSummary(tid){const r=disk.status?.remote?.[state.project]?.[tid];if(!r)return 'Sin probar';if(r.ok)return `✓ Conexión correcta · ${fmtDate(r.checkedAt)}${r.version?` · versión remota ${r.version}`:''}`;return `✕ Falló ${fmtDate(r.checkedAt)}${r.error?' · '+r.error.split('\n').pop():''}`}
async function sshCheck(button,tid,resultEl){
  const pid=state.project;const previous=button.innerHTML;button.disabled=true;button.textContent='Conectando…';
  if(resultEl){resultEl.textContent='Conectando…';resultEl.className='tiny muted'}
  try{
    const r=await api(`/api/projects/${encodeURIComponent(pid)}/targets/${encodeURIComponent(tid)}/ssh-test`,'POST',{});
    await refreshStatus();
    if(resultEl&&resultEl.isConnected){resultEl.className=`tiny ${r.ok?'success':'danger-text'}`;resultEl.textContent=r.ok?`✓ Conexión correcta${r.remoteVersion?' · versión remota '+r.remoteVersion:r.remoteVersionFile?' · no se pudo leer '+r.remoteVersionFile:''}`:`✕ ${r.output.split('\n').pop()||'Conexión rechazada'}`}
    else if(state.project===pid&&!(state.page==='settings'))render();
    if(!r.ok&&r.output)toast('SSH: '+r.output.split('\n').pop().slice(0,160));
  }catch(error){if(resultEl&&resultEl.isConnected){resultEl.className='tiny danger-text';resultEl.textContent='✕ '+error.message}else toast(error.message)}
  finally{if(button.isConnected){button.disabled=false;button.innerHTML=previous}}
}

// Probe a connection as typed in a form (wizard or unsaved destination): the values travel
// in the request instead of being read from disk, so you can verify them before saving.
async function sshProbe(button,draft,resultEl){
  if(!draft.host?.trim()){if(resultEl){resultEl.className='tiny danger-text';resultEl.textContent='Completá usuario@host para probar.'}return null}
  if(!/^[^\s@]+@[^\s@]+$/.test(draft.host.trim())){if(resultEl){resultEl.className='tiny danger-text';resultEl.textContent='Usá el formato usuario@host.'}return null}
  const previous=button.innerHTML;button.disabled=true;button.textContent='Conectando…';
  if(resultEl){resultEl.textContent='Conectando… (hasta 25 s)';resultEl.className='tiny muted'}
  try{
    const r=await api('/api/ssh/test','POST',draft);
    if(r.recorded)await refreshStatus();
    if(resultEl&&resultEl.isConnected){resultEl.className=`tiny ${r.ok?'success':'danger-text'}`;resultEl.textContent=r.ok?`✓ Conexión correcta con ${r.host}${r.remoteVersion?' · versión remota '+r.remoteVersion:r.remoteVersionFile?' · no se pudo leer '+r.remoteVersionFile:''}`:`✕ ${r.output.split('\n').filter(Boolean).pop()||'Conexión rechazada'}`}
    return r;
  }catch(error){if(resultEl&&resultEl.isConnected){resultEl.className='tiny danger-text';resultEl.textContent='✕ '+error.message}else toast(error.message);return null}
  finally{if(button.isConnected){button.disabled=false;button.innerHTML=previous}}
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function latestBackup(origin){return (cached('backups')?.data?.files||[]).find(b=>b.origin===origin)}
function confirmDeploy(d,version){
  confirmDialog(`Deploy a ${esc(d.short.toLowerCase())}`,`Vas a ejecutar <code>${esc(d.deploy)}</code> ${version?`con la versión <strong class="mono">${esc(version)}</strong>`:'sin versión'} en <strong>${esc(d.name)}</strong>.`,()=>startJob({kind:'deploy',target:d.id,version}),{target:d.host||'sin conexión SSH configurada',label:version?`Deployar ${version}`:'Deployar',danger:isProd(d)});
}
function handleAction(a,b){
  if(a==='refresh'){invalidateAll();reloadFromDisk(null);return}
  if(handlePersistenceAction(a,b))return;
  if(a==='close-modal'){$('#modal').close();return}
  if(a==='confirm-action'){const phrase=$('#confirm-phrase')?.value;$('#modal').close();confirmedAction?.(phrase);return}
  if(a==='collapse-log'){$('#execution').classList.toggle('collapsed');return}
  if(a==='copy-log'){navigator.clipboard?.writeText($('#job-output')?.textContent||'').then(()=>toast('Salida copiada'));return}
  if(a==='cancel-job'){b.disabled=true;api(`/api/jobs/${b.dataset.job}/cancel`,'POST',{}).catch(e=>{toast(e.message);b.disabled=false});return}
  if(a==='refresh-git'){invalidate('git');render();return}
  if(a==='refresh-backups'){invalidate('backups');render();return}
  if(a==='refresh-logs'){invalidate('logs');logEntriesCache={};render();return}
  const c=config(),d=dest(),g=cached('git')?.data;
  if(a==='deploy'){confirmDeploy(d,currentVersion(g));return}
  if(a==='redeploy'){const tag=$('#version-tag')?.value;if(!tag){toast('No hay tags para re-deployar.');return}confirmDeploy(d,tag);return}
  if(a==='matrix-deploy'){state.dest=b.dataset.target;localStorage.setItem('dp-dest',state.dest);confirmDeploy(dest(),currentVersion(g));return}
  if(a==='choose-version'){state.dest=b.dataset.target;localStorage.setItem('dp-dest',state.dest);modal(`Re-deployar en ${esc(dest().name)}`,`<p>Elegí la versión que querés volver a publicar en este destino.</p><div class="field"><label for="version-tag">Versión</label><select id="version-tag">${(g?.tags||[]).map(t=>`<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}</select></div>`,btn('Cancelar','close-modal')+btn('Continuar','redeploy','primary'));return}
  if(a==='tag-dest'){const tag=b.dataset.tag;modal(`Re-deployar ${esc(tag)}`,`<p>Elegí el destino. La siguiente pantalla muestra la confirmación.</p><div class="script-list">${destinations.filter(x=>x.deploy).map(x=>`<button class="script-choice" data-action="tag-deploy" data-target="${esc(x.id)}" data-tag="${esc(tag)}">${icon('server')}${esc(x.name)}<span class="spacer"></span>${badge(esc(x.badge),x.color)}</button>`).join('')}</div>`);return}
  if(a==='tag-deploy'){state.dest=b.dataset.target;localStorage.setItem('dp-dest',state.dest);$('#modal').close();confirmDeploy(dest(),b.dataset.tag);return}
  if(a==='ssh-check'){sshCheck(b,b.dataset.target,state.page==='console'?$('#connection-status'):null);return}
  if(a==='test-ssh'){const target=c.targets[+b.dataset.index];if(!target)return;sshProbe(b,{host:target.host,port:target.port,key:target.key,remoteVersion:target.remoteVersion,project:state.project,target:target.id},$('#ssh-result-'+b.dataset.index));return}
  if(a==='backup'){startJob({kind:'backup',target:d.id});return}
  if(a==='restore-local'||a==='restore-remote'||a==='sync-local'||a==='sync-remote'){
    const remote=a.endsWith('remote');
    let file=b.dataset.file;
    if(a==='sync-local'){file=latestBackup(d.backupLabel||d.id)?.file;if(!file){toast(`No hay backups con origen «${d.backupLabel||d.id}». Creá uno primero.`);return}}
    if(a==='sync-remote'){file=latestBackup('local')?.file;if(!file){toast('No hay backups con origen «local».');return}}
    confirmDialog(remote?'Restaurar sobre el servidor':'Reemplazar la base de datos local',`Se restaurará <strong class="mono">${esc(file)}</strong> con <code>${esc(remote?d.restore:c.restoreLocal)}</code>. Se reemplazarán los datos actuales de ${remote?esc(d.name):'tu entorno local'}. Esta acción no se puede deshacer.`,phrase=>startJob(remote?{kind:'restore',target:d.id,backup:file,phrase}:{kind:'restore-local',target:d.id,backup:file}),{target:remote?d.host:'localhost · entorno local',danger:true,label:'Restaurar base de datos',phrase:remote?c.phrase:undefined});
    return;
  }
  if(a==='delete-backup'||a==='delete-selected'){
    const files=a==='delete-backup'?[b.dataset.file]:$$('.backup-check:checked').map(x=>x.value);
    if(!files.length)return;
    confirmDialog('Eliminar backups',`Vas a eliminar ${files.length} ${files.length===1?'archivo':'archivos'} de tu disco${c.extrasSuffix?' (y sus extras)':''}. Esta acción no se puede deshacer.`,async()=>{try{await api(`/api/projects/${encodeURIComponent(state.project)}/backups/delete`,'POST',{files});invalidate('backups');render();toast('Backups eliminados.')}catch(e){toast(e.message)}},{danger:true,label:'Eliminar backups'});
    return;
  }
  if(a==='custom-action'){
    const action=getPath(c,b.dataset.path);if(!action?.script)return;
    const launch=phrase=>startJob({kind:'action',action:action.id,target:d.id||undefined,phrase});
    if(action.confirm||action.requirePhrase)confirmDialog(esc(action.confirmTitle||action.label),esc(action.confirmMessage||`Se ejecutará ${action.script} dentro del workspace.`),launch,{danger:action.danger||action.style==='danger',label:action.confirmLabel||'Confirmar',phrase:action.requirePhrase?c.phrase:undefined});
    else launch();
    return;
  }
  if(a==='bump-preview'){const current=g?.version?.version||'';bumpValue=bumpFrom(current,b.dataset.bump);$$('#bump-options button').forEach(x=>x.classList.toggle('active',x===b));$('#bump-value').textContent=`${current} → ${bumpValue}`;$('#bump-hint').textContent=`${c.versionFile} pasará de ${current} a ${bumpValue}. No se hará ningún deploy.`;$('#bump-manual').value='';return}
  if(a==='bump-save'){
    const manual=$('#bump-manual')?.value.trim();const version=manual||bumpValue;
    if(!version){toast('Elegí patch, minor o major, o escribí una versión.');return}
    const tag=$('#bump-tag')?.checked===true;
    confirmDialog(`Actualizar ${esc(c.versionFile)}`,`Se escribirá <strong class="mono">${esc(version)}</strong> en <code>${esc(c.versionFile)}</code>${tag?` y se creará el commit y el tag <code>${esc(c.tagPrefix||'')}${esc(version.replace(/^v/,''))}</code>`:''}.`,async()=>{try{const r=await api(`/api/projects/${encodeURIComponent(state.project)}/version`,'POST',{version,tag});bumpValue='';cache['git:'+state.project]={loading:false,data:r.git,error:''};render();toast(`${c.versionFile} actualizado a ${r.written}${r.tag?` · tag ${r.tag} creado`:''}`)}catch(e){toast(e.message)}},{label:tag?'Escribir y crear tag':'Escribir archivo'});
    return;
  }
  if(a==='history-output'){
    api(`/api/jobs/${b.dataset.id}`).then(j=>modal(`${esc(j.label)}`,`<div class="between"><span class="hint">${fmtDate(j.startedAt)} · ${fmtDuration(j.durationMs)} · ${esc(j.targetName||'Local')}</span>${statusBadge(j.status)}</div><p class="mono tiny muted" style="margin-top:8px">$ ${esc(j.command)}</p><pre>${esc(j.lines.join('\n')||'(sin salida)')}</pre><p class="hint">Salida guardada en disco · código de salida ${j.exitCode??'—'}</p>`,btn('Cerrar','close-modal'),true)).catch(e=>toast(e.message));
    return;
  }
  if(a==='pull-logs'){confirmDialog('Descargar logs del servidor',`Se ejecutará <code>${esc(d.logs)}</code> con la conexión de ${esc(d.name)}.`,()=>startJob({kind:'logs',target:d.id}),{target:d.host,label:'Descargar logs'});return}
  if(a==='filter-logs'){
    const files=$$('.log-check:checked').map(x=>x.value);
    if(!files.length){logView={entries:[],files:[]};$('#log-rows').innerHTML='<tr><td colspan="5" class="empty">Elegí archivos y tocá Aplicar / refrescar.</td></tr>';$('#log-results').textContent='Sin archivos seleccionados.';return}
    b.disabled=true;$('#log-results').textContent='Leyendo archivos…';
    loadLogEntries(files).then(entries=>{logView={entries,files};const q=$('#log-query').value,type=$('#log-type').value,user=$('#log-user').value,from=$('#log-from').value,to=$('#log-to').value;render();files.forEach(f=>{const cb=$$('.log-check').find(x=>x.value===f);if(cb)cb.checked=true});$('#log-query').value=q;$('#log-type').value=type;$('#log-user').value=user;$('#log-from').value=from;$('#log-to').value=to;applyLogFilters();$('#log-selection').textContent=`${$$('.log-check').length} archivos · ${files.length} seleccionados`;$('#zip-logs').disabled=false}).catch(e=>{toast(e.message);b.disabled=false;$('#log-results').textContent=e.message});
    return;
  }
  if(a==='log-detail'){const l=(logView.filtered||logView.entries)[+b.dataset.index];if(!l)return;modal(l.type==='error'?'Detalle del error':'Detalle del evento',`<div class="between"><span class="mono tiny muted">${esc(l.time||'—')} · ${esc(l.user||'—')} · ${esc(l.file)}:${l.line}</span>${badge(esc(l.type),l.type==='error'?'red':'neutral')}</div><h3 style="margin-top:20px">${esc(l.text)}</h3><pre>${esc(l.raw==null?l.text:JSON.stringify(l.raw,null,2))}</pre>`,btn('Cerrar','close-modal'),true);return}
  if(a==='view-log'){const file=b.dataset.file;api(`/api/projects/${encodeURIComponent(state.project)}/logs/file?name=${encodeURIComponent(file)}`).then(r=>modal(esc(file),`<p class="hint">${fmtSize(r.size)}${r.truncated?' · se muestran las primeras entradas':''}</p><pre>${esc(r.content)}</pre>`,btn('Cerrar','close-modal')+btn('Descargar','download-log','','download',`data-file="${esc(file)}"`),true)).catch(e=>toast(e.message));return}
  if(a==='download-log'){const file=b.dataset.file;api(`/api/projects/${encodeURIComponent(state.project)}/logs/file?name=${encodeURIComponent(file)}`).then(r=>download(r.content,file)).catch(e=>toast(e.message));return}
  if(a==='delete-log'){const file=b.dataset.file;confirmDialog('Eliminar archivo de log',`Se eliminará <strong class="mono">${esc(file)}</strong> de tu disco.`,async()=>{try{await api(`/api/projects/${encodeURIComponent(state.project)}/logs/delete`,'POST',{files:[file]});delete logEntriesCache[file];logView={entries:[],files:[]};invalidate('logs');render();toast('Archivo eliminado')}catch(e){toast(e.message)}},{danger:true,label:'Eliminar archivo'});return}
  if(a==='zip-logs'){const files=$$('.log-check:checked').map(x=>x.value);if(!files.length){toast('Elegí al menos un archivo.');return}b.disabled=true;downloadBlob(`/api/projects/${encodeURIComponent(state.project)}/logs/zip`,{files},c.zipName||'logs.zip').then(()=>toast('ZIP generado con los archivos seleccionados')).catch(e=>toast(e.message)).finally(()=>{if(b.isConnected)b.disabled=false});return}
  if(a==='terminal-connect'){const s=terminalFor(state.project,d.id)||createTerminal(state.project,d.id);mountTerminal();connectTerminal(s);return}
  if(a==='terminal-disconnect'){disconnectTerminal(terminalFor(state.project,d.id));return}
  if(a==='terminal-clear'){const s=terminalFor(state.project,d.id);if(s){s.term.clear();s.term.focus()}return}
  if(a==='edit-connection'){state.configTab='targets';state.openTarget=b.dataset.target||d.id;navigate('settings');return}
  if(typeof extendedAction==='function')extendedAction(a,b);
}
document.addEventListener('input',e=>{if(e.target.id==='bump-manual'&&e.target.value){bumpValue='';$$('#bump-options button').forEach(x=>x.classList.remove('active'));const g=cached('git')?.data;$('#bump-value').textContent=`${g?.version?.version||'—'} → ${e.target.value}`}});

// Render override: base screens plus the persistence banner and per-page follow-ups.
const baseRender=render;
render=function(){baseRender();renderStorageStatus();if(projects.length&&state.page==='console')mountTerminal()};

// Demo: el arranque espera a que la capa de servicios simulada esté instalada.
(window.__demoLista||Promise.resolve()).then(()=>initializeApp());
