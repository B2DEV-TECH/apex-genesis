const id=/^[a-f0-9]{32}$/;
const phases=new Set(['GENOME_CREATED','DEFINITION_GENERATED','VALIDATION_STARTED','VALIDATED','IMPORT_STARTED','IMPORTED','RUNTIME_VERIFIED','TESTING','EVALUATED','SELECTED','REJECTED']);
function require(condition){if(!condition)throw new TypeError('Invalid control response or bounded request');}
function keys(value,expected){require(value&&typeof value==='object'&&!Array.isArray(value));require(Object.keys(value).sort().join('|')===[...expected].sort().join('|'));}
function integer(value,min,max){return Number.isSafeInteger(value)&&value>=min&&value<=max;}
function text(value,max){return typeof value==='string'&&value.trim().length>0&&new TextEncoder().encode(value).length<=max;}
export function validateDraft(value,caps){
 keys(value,['label','seed','generations','materializationBudget']);
 require(text(value.label,120)&&!/[\x00-\x1f\x7f-\x9f]/.test(value.label)&&integer(value.seed,1,2147483646));
 require(caps&&caps.capabilityVersion==='order-lab-queued-feasibility/1.0'&&caps.supportedSeed===50000&&caps.maxGenerations===1&&caps.maxMaterializations===2);
 require(value.seed===caps.supportedSeed);
 require(integer(value.generations,1,caps.maxGenerations)&&integer(value.materializationBudget,value.generations+1,caps.maxMaterializations));
 return value;
}
export function validateStatus(value){
 keys(value,['canCreate','canStart','capabilityVersion','supportedSeed','maxGenerations','maxMaterializations','requests']);
 require(typeof value.canCreate==='boolean'&&typeof value.canStart==='boolean');
 require(value.capabilityVersion==='order-lab-queued-feasibility/1.0'&&value.supportedSeed===50000&&value.maxGenerations===1&&value.maxMaterializations===2);
 require(Array.isArray(value.requests)&&value.requests.length<=100);
 for(const request of value.requests)validateRequest(request);
 require(new Set(value.requests.map(request=>request.id)).size===value.requests.length);
 return value;
}
function validateRequest(value){
 keys(value,['id','label','state','seed','generations','materializationBudget','runId']);
 require(id.test(value.id)&&text(value.label,120));
 require(['DRAFT','QUEUED','CLAIMED','COMPLETED','FAILED','UNCERTAIN','CANCELLED'].includes(value.state));
 validateDraft({label:value.label,seed:value.seed,generations:value.generations,materializationBudget:value.materializationBudget},{capabilityVersion:'order-lab-queued-feasibility/1.0',supportedSeed:50000,maxGenerations:1,maxMaterializations:2});
 require(value.runId===null||id.test(value.runId));
 if(['DRAFT','QUEUED','CANCELLED'].includes(value.state))require(value.runId===null);
 if(value.state==='COMPLETED')require(value.runId!==null);
}
export function validateWatch(value){
 keys(value,['request','run','organisms','events']);validateRequest(value.request);
 require(Array.isArray(value.organisms)&&value.organisms.length<=11&&Array.isArray(value.events)&&value.events.length<=200);
 if(value.run===null){require(value.request.runId===null&&value.organisms.length===0&&value.events.length===0);return value;}
 keys(value.run,['id','state','materializations','budget','fitnessDefinition']);
 require(value.run.id===value.request.runId&&['RUNNING','COMPLETE','FAILED','CANCELLED'].includes(value.run.state));
 require(value.run.fitnessDefinition==='order-lab-task-proxy/2.0.0'&&value.run.budget===value.request.materializationBudget&&integer(value.run.materializations,0,value.run.budget));
 if(value.request.state==='COMPLETED')require(value.run.state==='COMPLETE');
 if(value.request.state==='FAILED')require(['FAILED','CANCELLED'].includes(value.run.state));
 const seen=new Set();
 for(const row of value.organisms){
  keys(row,['id','generation','parentId','applicationId','state','eligible','fitness','selected','reason']);
  require(id.test(row.id)&&!seen.has(row.id));seen.add(row.id);
  require(integer(row.generation,0,value.request.generations)&&(row.parentId===null||id.test(row.parentId)));
  require(row.applicationId===null||integer(row.applicationId,1,9999999999)&&![120,121].includes(row.applicationId));
  require(phases.has(row.state)&&(row.eligible===null||typeof row.eligible==='boolean'));
  require(row.fitness===null||typeof row.fitness==='number'&&Number.isFinite(row.fitness)&&row.fitness>=0&&row.fitness<=100);
  require((row.eligible===null)===(row.fitness===null)&&typeof row.selected==='boolean');
  require(!row.selected||row.state==='SELECTED'&&row.eligible===true&&row.fitness!==null);
  require(row.reason===null||text(row.reason,240));
 }
 for(const event of value.events){keys(event,['organismId','state','recordedAt']);require(seen.has(event.organismId)&&phases.has(event.state)&&typeof event.recordedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.recordedAt)&&Number.isFinite(Date.parse(event.recordedAt)));}
 return value;
}
export function watchLines(value){
 validateWatch(value);const lines=['Request '+value.request.state+' · GA_ONLY · budget '+value.request.materializationBudget];
 if(!value.run)return [...lines,'No Oracle run is linked. Evolution has not started.'];
 lines.push('Oracle run '+value.run.id+' · '+value.run.state+' · materializations '+value.run.materializations+'/'+value.run.budget);
 for(const row of value.organisms)lines.push('Generation '+row.generation+' · '+row.state+' · '+(row.fitness===null?'not evaluated':'fitness '+row.fitness+'; eligible '+row.eligible)+(row.selected?' · selected':''));
 return lines;
}
