'use strict';

// Disk-backed state is authoritative. Browser storage is used only for UI preferences
// and a one-time, non-destructive migration of the previous prototype.
const disk = {ready:false, token:'', records:{}, saved:{}, revisions:{}, path:'', busy:false, error:'', user:'', status:{}};
let workspaceInspection = null;
let scriptInspection = null;
let folderReturnPath = '';

async function api(path, method='GET', payload, retrySession=true, options={}) {
  // Local calls answer in milliseconds; only SSH probes wait on a remote host (server timeout: 25 s).
  const timeout = options.timeout || (path.includes('/ssh') ? 35000 : 15000);
  const headers = {'Accept':'application/json'};
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-DevPanel-Token'] = disk.token;
  }
  let response;
  try {
    response = await fetch(path, {method, headers, cache:'no-store', body:payload===undefined?undefined:JSON.stringify(payload), signal:AbortSignal.timeout(timeout)});
  } catch(error) {
    if (error?.name === 'TimeoutError') throw new Error(`El servidor local no respondió en ${Math.round(timeout/1000)} s. Si estabas probando SSH, el host remoto puede estar caído; si no, revisá la terminal donde corre python3 server.py.`);
    throw new Error('No se pudo conectar con el servidor local. Tus cambios siguen en el formulario. Iniciá python3 server.py y volvé a intentar.');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('El servidor no tiene la API de persistencia. Iniciá python3 server.py en lugar del servidor de archivos estáticos.'); }
  if (!response.ok) {
    if(response.status===403&&retrySession&&method!=='GET'&&result.error?.startsWith('La sesión del servidor cambió')){
      const fresh=await api('/api/state');disk.token=fresh.csrfToken;
      return api(path,method,payload,false,options);
    }
    const error = new Error(result.error || 'No se pudo completar la operación.');
    error.fields = result.fields || [];
    error.status = response.status;
    throw error;
  }
  return result;
}

function acceptSnapshot(data) {
  disk.token = data.csrfToken;
  disk.path = data.storagePath;
  disk.user = data.user||'';
  disk.status = data.status||{};
  if(typeof syncJobs==='function')syncJobs(data.jobs||{});
  disk.records = data.records;
  disk.saved = {};
  disk.revisions = {};
  projects = Object.entries(data.records).map(([id, record]) => {
    disk.saved[id] = structuredClone(record.config);
    disk.revisions[id] = record.revision;
    return {id, name:record.config.name, workspace:record.config.workspace,
      description:record.metadata?.description||'', version:record.metadata?.version||'v0.0.0',
      branch:record.metadata?.branch||'sin consultar', changes:record.metadata?.changes||0};
  });
  configCache = {};
  Object.keys(destinationData).forEach(key=>delete destinationData[key]);
  if (!projects.some(p=>p.id===state.project)) state.project=projects[0]?.id||'';
  disk.ready = true;
  disk.error = '';
}

function legacyRecords() {
  let old;
  try {old=JSON.parse(localStorage.getItem('dp-projects'));} catch {return [];}
  if (!Array.isArray(old) || !old.length) return [];
  const savedProjects = projects, savedActive = state.project;
  try {
    projects=old;
    return old.map(p=>{
      state.project=p.id;
      let c;
      try {c=JSON.parse(localStorage.getItem(`dp-config-${p.id}`));} catch { /* fallback below */ }
      return {id:p.id, config:c||defaultConfig(), metadata:p};
    });
  } finally {projects=savedProjects;state.project=savedActive;}
}

async function initializeApp() {
  $('#app').innerHTML='<div class="startup"><h1>DevOps Panel</h1><p class="hint">Cargando proyectos desde el disco…</p></div>';
  try {
    let data=await api('/api/state');
    disk.token=data.csrfToken;
    const legacy=legacyRecords();
    let imported=0, migrationError='';
    if (!Object.keys(data.records).length && legacy.length) {
      try {data=await api('/api/import','POST',{records:legacy});imported=legacy.length;}
      catch(error) {migrationError=error.message;}
    }
    acceptSnapshot(data);
    if (!projects.length && state.page!=='components') state.page='home';
    render();
    // The first entry now carries the resolved context, so the first Back has somewhere to return to.
    rememberContext();
    pushHistory(true);
    if(imported)toast(`${imported} proyectos migrados al disco. Se conservó la copia anterior del navegador.`);
    if(migrationError)$('#main').insertAdjacentHTML('afterbegin',`<div class="notice error">No se pudo migrar la copia del navegador: ${esc(migrationError)}. La copia original se conserva.</div>`);
  } catch(error) {
    disk.ready=false;
    $('#app').innerHTML=`<div class="startup"><span class="brand-mark">${icon('terminal')}</span><h1>No pudimos cargar tus proyectos</h1><p class="hint">${esc(error.message)}</p><p class="hint">No se reemplazaron los datos guardados.</p>${btn('Volver a intentar','retry-storage','primary','refresh')}</div>`;
  }
}

function renderStorageStatus() {
  if (!disk.ready || !$('#main'))return;
  if(!disk.saved[state.project]?.github)$$('.github-link').forEach(el=>el.classList.add('hidden'));
  if (!projects.length) {
    $$('.context-project,.context-wrap,.breadcrumb,.github-link').forEach(el=>el.classList.add('hidden'));
    if(state.page!=='components')$('#main').innerHTML=home();
  }
  $('#main').insertAdjacentHTML('afterbegin',`<div class="notice info storage-notice"><span class="flex">${icon('database')} <strong>Proyectos y configuración guardados en disco</strong></span><span class="spacer"></span><span class="tiny">Scripts, Git, backups, logs y SSH operan sobre tu equipo y tus servidores</span></div>`);
  if(state.page==='settings'){
    const footer=$('.config-footer');
    footer?.insertAdjacentHTML('afterend',`<p class="hint storage-path">Archivo: <code>${esc(disk.path)}</code><br>Guardá antes de salir. Los cambios se comparten entre navegadores.</p>`);
    if(disk.error)showPersistenceError(disk.lastError||new Error(disk.error));
  }
  if(disk.busy)$$('[data-action="save-config"],[data-action="discard-config"]').forEach(b=>b.disabled=true);
}

function showPersistenceError(error) {
  disk.error=error.message;disk.lastError=error;
  if($('#config-errors')) {
    const fields=error.fields?.length?error.fields:[['guardado',error.message]];
    showConfigErrors(fields);
    if(!error.fields?.length)$('#config-errors').insertAdjacentHTML('beforeend',`<div class="notice">Tu borrador sigue intacto. ${btn('Descargar borrador','export-draft','compact')}${btn('Cargar versión del disco','reload-disk','compact')}</div>`);
  } else if($('#wizard-error')) $('#wizard-error').textContent=error.message;
  else toast(error.message);
}

async function withStorageTask(button, action) {
  if(disk.busy)return;
  disk.busy=true;
  const previous=button?.innerHTML;
  if(button){button.disabled=true;button.textContent='Guardando…';}
  try {await action();}
  catch(error){showPersistenceError(error);}
  finally {
    disk.busy=false;
    if(button?.isConnected){button.disabled=false;button.innerHTML=previous;}
  }
}

function copyCurrentConfig() {
  if(state.configTab==='json'&&$('#json-editor')){
    try{return JSON.parse($('#json-editor').value);}
    catch{throw new Error('El JSON no es válido. Corregí la sintaxis antes de guardar.');}
  }
  return structuredClone(config());
}

async function saveConfiguration(button) {
  await withStorageTask(button, async()=>{
    const id=state.project, c=copyCurrentConfig();
    if(Array.isArray(c.targets))c.targets.forEach(d=>{if(d&&typeof d.name==='string')d.short=d.name.replace(/\s*\([^)]*\)\s*/g,'').trim()||d.name;});
    const errors=validateConfig(c);
    showConfigErrors(errors);
    if(errors.length)return;
    // Disable the editing surface until the durable write is acknowledged.
    const fields=$$('.config-layout input,.config-layout select,.config-layout textarea,.config-layout button');
    const enabled=fields.filter(el=>!el.disabled);
    enabled.forEach(el=>el.disabled=true);
    try{
      const data=await api(`/api/projects/${encodeURIComponent(id)}`,'PUT',{config:c,revision:disk.revisions[id]});
      acceptSnapshot(data);
      state.project=id;state.dirty=false;
      render();
      toast('Configuración guardada en disco.');
    }finally{enabled.filter(el=>el.isConnected).forEach(el=>el.disabled=false);}
  });
  // render() ran while busy; unlock only after the request has fully completed.
  $$('[data-action="save-config"],[data-action="discard-config"]').forEach(b=>b.disabled=false);
}

async function reloadFromDisk(button) {
  await withStorageTask(button,async()=>{
    const snapshot=await api('/api/state');
    acceptSnapshot(snapshot);state.dirty=false;render();toast('Datos del disco actualizados.');
  });
  $$('[data-action="save-config"],[data-action="discard-config"]').forEach(b=>b.disabled=false);
}

function handlePersistenceAction(action,button) {
  if(action==='retry-storage'){initializeApp();return true;}
  if(disk.busy && ['config-tab','save-config','discard-config','wizard-create','close-modal'].includes(action))return true;
  if(action==='save-config'){saveConfiguration(button);return true;}
  if(action==='discard-config'){
    delete configCache[state.project];state.dirty=false;disk.error='';render();toast('Cambios descartados. Se muestra la última versión cargada del disco.');return true;
  }
  if(action==='export-draft'){
    try{download(JSON.stringify(copyCurrentConfig(),null,2),`${state.project}-borrador.json`,'application/json');}
    catch(error){showPersistenceError(error);}return true;
  }
  if(action==='reload-disk'){
    confirmDialog('Cargar la versión del disco','Se reemplazará el borrador de esta pestaña. Podés descargarlo antes de continuar.',()=>reloadFromDisk(null),{label:'Cargar del disco'});return true;
  }
  if(action==='refresh'){reloadFromDisk(button);return true;}
  if(action==='delete-project'){askDeleteProject(button.dataset.pid||state.project);return true;}
  if(action==='wizard'){workspaceInspection=null;return false;}
  if(action==='wizard-next'){advancePersistentWizard(button);return true;}
  if(action==='wizard-create'){createPersistentProject(button);return true;}
  if(action==='wizard-test-ssh'){
    captureWizard();
    const draft={host:(wizardData.host||'').trim(),port:(wizardData.port||'').trim(),key:(wizardData.key||'').trim()};
    sshProbe(button,draft,$('#wizard-ssh-result')).then(r=>{const el=$('#wizard-ssh-result');if(r)wizardData.sshResult={ok:r.ok,host:r.host,text:el?.textContent||''};else if(el&&!draft.host)wizardData.sshResult=null;});
    return true;
  }
  if(action==='browse-workspace'){captureWizard();openFolderBrowser(wizardData.workspace||null);return true;}
  if(action==='browse-folder'){openFolderBrowser(button.dataset.path);return true;}
  if(action==='folder-choose'){wizardData.workspace=folderReturnPath;workspaceInspection=null;wizard();return true;}
  if(action==='folder-cancel'){wizard();return true;}
  if(action==='script-picker'){
    if(state.page==='components')return false;
    openRealScriptPicker(button.dataset.field);return true;
  }
  return false;
}

async function openFolderBrowser(path) {
  try{
    const data=await api('/api/workspace/browse','POST',{path});
    folderReturnPath=data.path;
    modal('Elegí la carpeta del proyecto',`<p class="mono" style="overflow-wrap:anywhere">${esc(data.path)}</p><div class="script-list">${data.parent!==data.path?btn('Carpeta superior','browse-folder','ghost','folder',`data-path="${esc(data.parent)}"`):''}${data.children.map(c=>`<button class="script-choice" data-action="browse-folder" data-path="${esc(c.path)}">${icon('folder')}<span>${esc(c.name)}</span>${icon('chevron')}</button>`).join('')||'<p class="hint">Esta carpeta no tiene subcarpetas visibles.</p>'}</div>${data.truncated?'<p class="hint">Se muestran las primeras 250 carpetas.</p>':''}`,btn('Volver','folder-cancel')+btn('Usar esta carpeta','folder-choose','primary'),true);
  }catch(error){toast(error.message);}
}

async function advancePersistentWizard(button) {
  captureWizard();
  const error=$('#wizard-error');
  if(wizardStep===0){
    button.disabled=true;button.textContent='Inspeccionando…';
    try{
      workspaceInspection=await api('/api/workspace/inspect','POST',{workspace:wizardData.workspace});
      wizardData.workspace=workspaceInspection.workspace;
      wizardData.name=wizardData.name||workspaceInspection.name;
      const executable=workspaceInspection.scripts.filter(s=>s.executable).map(s=>s.path);
      const suggest=pattern=>executable.find(s=>pattern.test(s))||'';
      wizardData.deploy??=suggest(/(^|\/)deploy\.sh$/);
      wizardData.backup??=suggest(/backup.*\.sh$/);
      wizardData.logs??=suggest(/pull-logs\.sh$/);
      wizardStep=1;wizard();
    }catch(e){error.textContent=e.message;button.disabled=false;button.textContent='Continuar';}
    return;
  }
  if(wizardStep===1&&(!wizardData.name?.trim()||/[<>]/.test(wizardData.name))){error.textContent='Escribí un nombre sin < ni >.';return;}
  if(wizardStep===2&&(!wizardData.destName?.trim()||(wizardData.host&&!/^\S+@\S+$/.test(wizardData.host)))){error.textContent='Completá el nombre del destino. Si ingresás SSH, usá usuario@host.';return;}
  if(wizardStep===2&&wizardData.port&&!(+wizardData.port>=1&&+wizardData.port<=65535)){error.textContent='El puerto debe estar entre 1 y 65535.';return;}
  wizardStep++;wizard();
}

function renderPersistentWizard() {
  const stages=['Workspace','Proyecto','Destino','Resumen'];
  let body=`<div class="wizard-steps">${stages.map((s,i)=>`<div class="wizard-step ${i===wizardStep?'active':''}"><b>${i<wizardStep?'✓':i+1}</b>${s}</div>`).join('')}</div>`;
  if(wizardStep===0)body+=`<h2>Empezá por tu repo</h2><p class="hint">Elegí una carpeta de tu equipo. Se inspeccionará sin modificar sus archivos.</p><div class="field"><label for="wizard-workspace">Ruta del workspace</label><div class="input-group"><input id="wizard-workspace" data-wizard="workspace" class="mono" value="${esc(wizardData.workspace||'')}" placeholder="~/workspace/mi-proyecto">${btn('Explorar','browse-workspace','','folder')}</div></div>`;
  if(wizardStep===1){const i=workspaceInspection;body+=`<h2>Confirmá el proyecto</h2><div class="field"><label for="wizard-name">Nombre del proyecto</label><input id="wizard-name" data-wizard="name" value="${esc(wizardData.name)}"></div><div class="detected"><div>${icon(i.hasGit?'check':'folder')}${i.hasGit?'Se detectó un repositorio Git':'No se detectó .git; podés agregar la carpeta igualmente.'}</div><div>${icon('tag')} ${i.version?'Archivo VERSION: '+esc(i.version):'Sin archivo VERSION reconocido'}</div><div>${icon('code')} ${i.scripts.length} scripts .sh encontrados</div><div>${icon('folder')} backups/: ${i.hasBackups?'encontrada':'sin configurar'} · logs/: ${i.hasLogs?'encontrada':'sin configurar'}</div></div><p class="hint section-gap">El repositorio de GitHub se puede completar después en Configuración.</p>`;}
  if(wizardStep===2)body+=`<h2>Configurá tu primer destino</h2><p class="hint">La conexión SSH es opcional por ahora: podés completarla o cambiarla después en Configuración → Destinos.</p><div class="form-grid section-gap">${wizardField('Nombre','destName',wizardData.destName??'Producción (VPS)')}${wizardField('Badge','badge',wizardData.badge??'VPS')}<div class="form-subtitle">CONEXIÓN SSH</div>${wizardField('Usuario y host (opcional)','host',wizardData.host??'')}${wizardField('Puerto','port',wizardData.port??'22')}${wizardField('Ruta de clave SSH','key',wizardData.key??'~/.ssh/id_ed25519')}${wizardField('Carpeta remota (opcional)','remoteFolder',wizardData.remoteFolder??'')}<div class="field full"><div class="flex">${btn('Probar conexión','wizard-test-ssh','','refresh','id="wizard-test-ssh"')}<span id="wizard-ssh-result" class="tiny ${wizardData.sshResult?wizardData.sshResult.ok?'success':'danger-text':'muted'}">${wizardData.sshResult?esc(wizardData.sshResult.text):'Se ejecuta ssh con BatchMode (clave o agente, sin contraseña).'}</span></div></div><div class="form-subtitle">SCRIPTS</div>${['deploy','backup','logs'].map((key,index)=>`<div class="field full"><label for="wiz-${key}">${['Script de deploy','Crear backup remoto','Descargar logs'][index]}</label><select id="wiz-${key}" class="mono" data-wizard="${key}"><option value="" ${!wizardData[key]?'selected':''}>Sin configurar</option>${(workspaceInspection?.scripts||[]).map(s=>`<option value="${esc(s.path)}" ${wizardData[key]===s.path?'selected':''} ${!s.executable?'disabled':''}>${esc(s.path)}${s.executable?'':' · sin permiso de ejecución'}</option>`).join('')}</select></div>`).join('')}</div>`;
  if(wizardStep===3)body+=`<h2>Listo para guardar</h2><p class="hint">Se creará la configuración del panel. No se ejecutará ningún script ni se modificará el repositorio.</p><div class="detected"><div class="between"><span>Proyecto</span><strong>${esc(wizardData.name)}</strong></div><div class="between"><span>Workspace</span><code style="overflow-wrap:anywhere">${esc(wizardData.workspace)}</code></div><div class="between"><span>Destino</span><span>${esc(wizardData.destName)} ${badge(esc(wizardData.badge),'amber')}</span></div><div class="between"><span>SSH</span><code>${esc(wizardData.host?`${wizardData.host} · puerto ${wizardData.port||'22'}`:'Sin configurar')}</code></div>${wizardData.host?`<div class="between"><span>Prueba de conexión</span><span class="${wizardData.sshResult?wizardData.sshResult.ok?'success':'danger-text':'muted'}">${wizardData.sshResult?esc(wizardData.sshResult.text):'Sin probar'}</span></div>`:''}${['deploy','backup','logs'].map(k=>`<div class="between"><span>${k}</span><code>${esc(wizardData[k]||'Sin configurar')}</code></div>`).join('')}</div><p class="hint section-gap">Guardado permanente en <code>${esc(disk.path)}</code>.</p>`;
  body+='<p id="wizard-error" class="field-error danger-text" role="alert" style="margin-top:14px"></p>';
  modal('Nuevo proyecto',body,(wizardStep?btn('Atrás','wizard-back','ghost'):'')+'<span class="spacer"></span>'+btn('Cancelar','close-modal')+btn(wizardStep===3?'Crear proyecto':'Continuar',wizardStep===3?'wizard-create':'wizard-next','primary',wizardStep===3?'check':'arrow'),true);
}

async function createPersistentProject(button) {
  await withStorageTask(button,async()=>{
    const id=wizardData.name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
    const c=defaultConfig();
    Object.assign(c,{name:wizardData.name.trim(),workspace:wizardData.workspace,github:'',
      versionFile:workspaceInspection.version?'VERSION':'',backupFolder:workspaceInspection.hasBackups?'backups':'',
      logsFolder:workspaceInspection.hasLogs?'logs':'',restoreLocal:'',actions:[]});
    const d={...c.targets[0],name:wizardData.destName.trim(),short:wizardData.destName.trim(),badge:wizardData.badge,
      host:(wizardData.host||'').trim(),port:String(wizardData.port||'22').trim()||'22',key:(wizardData.key||'').trim(),deploy:wizardData.deploy,backup:wizardData.backup,logs:wizardData.logs,
      restore:'',remoteFolder:(wizardData.remoteFolder||'').trim(),remoteVersion:'',console:!!(wizardData.host||'').trim(),version:'',
      deployLabel:`Deploy a ${wizardData.destName.toLowerCase()}`};
    c.targets=[d];
    const data=await api('/api/projects','POST',{id,config:c,metadata:{version:workspaceInspection.version||'v0.0.0'}});
    acceptSnapshot(data);state.project=id;state.dirty=false;
    resetProjectView();
    rememberContext();
    $('#modal').close();navigate('home');toast('Proyecto creado y guardado en disco.');
  });
}

function askDeleteProject(pid) {
  const target=projects.find(p=>p.id===pid);
  if(!target)return;
  if(jobs[pid]){toast('Hay una operación en curso para este proyecto. Esperá a que termine o cancelala.');return;}
  confirmDialog('Eliminar proyecto del panel',
    `Se quitará <strong>${esc(target.name)}</strong> de DevOps Panel: su configuración, sus destinos y el estado de deploy que aprendimos por SSH.<br><br>`+
    `No se toca nada dentro de <code>${esc(target.workspace||'el workspace')}</code>: los backups, los logs y el repositorio quedan como están.`,
    ()=>deleteProject(pid),
    {phrase:target.name,danger:true,label:'Eliminar proyecto'});
}

async function deleteProject(pid) {
  await withStorageTask(null,async()=>{
    const data=await api(`/api/projects/${encodeURIComponent(pid)}`,'DELETE',{revision:disk.revisions[pid]});
    delete configCache[pid];
    delete destMemory[pid];
    forgetProjectCache(pid);
    if(state.project===pid){
      state.project='';state.dirty=false;resetProjectView();
      if(state.page==='settings'||state.page==='console')state.page='home';
    }
    acceptSnapshot(data);            // picks the first remaining project, or none
    if(!projects.length)state.page='home';
    render();                        // resolves the destination of whatever project is left
    rememberContext();
    pushHistory(true);
    toast('Proyecto eliminado del panel. No se borró ningún archivo de tu disco.');
  });
}

async function openRealScriptPicker(fieldKey) {
  try{
    scriptInspection=await api('/api/workspace/inspect','POST',{workspace:config().workspace});
    scriptTarget=fieldKey;
    scriptInventory=scriptInspection.scripts.map(s=>s.path);
    modal('Elegí un script',`<p>Archivos dentro de <code>${esc(scriptInspection.workspace)}</code></p><div class="search section-gap">${icon('search')}<input id="script-search" placeholder="Buscar un archivo .sh…" aria-label="Buscar script"></div><div class="script-list" id="script-list">${realScriptChoices('')}</div><div class="notice info">${icon('shield')} Inventario leído del disco. Los enlaces que salen del workspace quedan excluidos.</div>`,btn('Desactivar función','clear-script','ghost')+btn('Cancelar','close-modal'),true);
  }catch(error){toast(error.message);}
}
function realScriptChoices(query) {
  return scriptInspection.scripts.filter(s=>s.path.toLowerCase().includes(query.toLowerCase())).map(s=>`<button class="script-choice" data-action="select-script" data-script-path="${esc(s.path)}" ${s.executable?'':'disabled'}>${icon('file')}<span>${esc(s.path)}</span><small class="${s.executable?'success':'danger-text'}">${s.executable?'✓ ejecutable':'Sin permiso de ejecución'}</small></button>`).join('')||'<p class="hint">No se encontraron scripts .sh en esta carpeta.</p>';
}

// Freeze context changes during an acknowledged save to avoid saving a draft under
// another project's ID. Rejected writes leave all inputs and the draft available.
document.addEventListener('click', event=>{
  if(disk.busy && event.target.closest('button,a,summary')){
    event.preventDefault();event.stopImmediatePropagation();
  }
},true);
document.addEventListener('keydown',event=>{
  if(disk.busy&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();}
},true);
