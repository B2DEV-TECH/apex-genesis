// Worker-side transition assertions. Persist transitions and selection in Oracle;
// this module does not establish provenance or make an evolutionary decision.
const transitions={
 GENOME_CREATED:['DEFINITION_GENERATED','REJECTED'],
 DEFINITION_GENERATED:['VALIDATION_STARTED'],
 VALIDATION_STARTED:['VALIDATED','VALIDATION_FAILED'],
 VALIDATED:['IMPORT_STARTED'],IMPORT_STARTED:['IMPORTED','IMPORT_FAILED'],
 IMPORTED:['RUNTIME_VERIFIED','REJECTED'],RUNTIME_VERIFIED:['TESTING','REJECTED'],
 TESTING:['EVALUATED','REJECTED'],EVALUATED:['SELECTED','REJECTED'],
 VALIDATION_FAILED:['ARCHIVED'],IMPORT_FAILED:['ARCHIVED'],SELECTED:['ARCHIVED'],REJECTED:['ARCHIVED'],ARCHIVED:[]
};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function nextApplicationState(from,to,evidence){
 const fail=message=>{throw new TypeError(message);};
 if(!Object.hasOwn(transitions,from)||!transitions[from].includes(to)) fail('Unsupported application phase transition');
 if(!evidence||!hash(evidence.genomeHash)||!hash(evidence.artifactHash)) fail('Genome and definition hashes required');
 if(['DEFINITION_GENERATED','VALIDATED','IMPORTED','RUNTIME_VERIFIED','TESTING'].includes(to)&&evidence.success!==true) fail('Successful phase evidence required');
 if(['VALIDATION_FAILED','IMPORT_FAILED'].includes(to)&&evidence.success!==false) fail('A failed phase must record its failure');
 if(['IMPORTED','RUNTIME_VERIFIED','TESTING'].includes(to)&&(!Number.isSafeInteger(evidence.applicationId)||evidence.applicationId<1)) fail('Materialized application identity required');
 if(to==='IMPORTED'&&evidence.existenceVerified!==true) fail('Import process success does not prove application existence');
 if(to==='RUNTIME_VERIFIED'&&evidence.authenticated!==true) fail('Authenticated application execution must be independently verified');
 if(to==='TESTING'&&evidence.fixtureReset!==true) fail('Equivalent isolated fixture reset required before testing');
 if(['EVALUATED','SELECTED'].includes(to)){
  if(evidence.authority!=='ORACLE'||evidence.fitnessDefinition!=='order-lab-task-proxy/2.0.0'||typeof evidence.eligible!=='boolean'||!Number.isFinite(evidence.fitness)||evidence.fitness<0||evidence.fitness>100) fail('Versioned Oracle fitness decision required');
  if(to==='SELECTED'&&evidence.eligible!==true) fail('Ineligible applications cannot survive');
  if(!evidence.eligible&&evidence.fitness!==0) fail('Ineligible application fitness must be zero');
 }
 if(to==='ARCHIVED'&&evidence.artifactsPreserved!==true) fail('Preserve evidence before archiving a disposable application');
 return to;
}
