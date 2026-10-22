// These guards consume trusted Oracle observations. They do not allocate slots,
// authorize a user-supplied lease, or replace database locking and lease checks.
const keys=['schemaVersion','enabled','environment','schema','workspace','workspaceId','applicationIds','protectedApplicationIds','fixtureWritesAuthorized','maxConcurrentImports','maxMaterializationsPerRun'];
const identifier=/^[A-Z][A-Z0-9_]{0,29}$/;
const id=value=>Number.isSafeInteger(value)&&value>0;
const denied=new Set(['SYS','SYSTEM','INTERNAL','PUBLIC','APEX_PUBLIC_USER','ORDS_PUBLIC_USER']);
const reject=message=>{throw new TypeError(message);};
export function validateSandboxPolicy(policy){
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).length!==keys.length||!keys.every(key=>Object.hasOwn(policy,key))) reject('Explicit sandbox policy required');
 if(policy.schemaVersion!=='1.0'||policy.enabled!==true||policy.environment!=='development'||policy.fixtureWritesAuthorized!==true) reject('Development sandbox and fixture writes must be explicitly enabled');
 if(!identifier.test(policy.schema)||denied.has(policy.schema)||!identifier.test(policy.workspace)||denied.has(policy.workspace)||!id(policy.workspaceId)) reject('Invalid sandbox identity');
 for(const name of ['applicationIds','protectedApplicationIds']) if(!Array.isArray(policy[name])||policy[name].length<1||!policy[name].every(id)||new Set(policy[name]).size!==policy[name].length) reject('Explicit unique application pools required');
 if(policy.applicationIds.length>16||policy.applicationIds.some(value=>policy.protectedApplicationIds.includes(value))) reject('Application pool overlaps protected applications or exceeds 16 slots');
 if(policy.maxConcurrentImports!==1||!id(policy.maxMaterializationsPerRun)||policy.maxMaterializationsPerRun>128) reject('Import concurrency must be one and the run materialization budget 1..128');
 return true;
}
export function assertSandboxIdentity(policy,observed){
 validateSandboxPolicy(policy);
 if(!observed||observed.schema!==policy.schema||observed.workspace!==policy.workspace||observed.workspaceId!==policy.workspaceId) reject('Connected Oracle identity differs from the authorized sandbox');
 return true;
}
export function assertImportLease(policy,identity,lease,{now=new Date(),existingApplication,existingOwnership}={}){
 assertSandboxIdentity(policy,identity);
 if(!lease||lease.schema!==policy.schema||lease.workspaceId!==policy.workspaceId||!policy.applicationIds.includes(lease.applicationId)||policy.protectedApplicationIds.includes(lease.applicationId)) reject('Slot is outside the authorized sandbox');
 if(!['runId','organismId','token'].every(key=>typeof lease[key]==='string'&&/^[a-f0-9]{32}$/.test(lease[key]))||lease.owned!==true||lease.state!=='RESERVED') reject('An Oracle-owned reserved slot is required');
 const expiry=Date.parse(lease.expiresAt);
 if(!Number.isFinite(expiry)||!Number.isFinite(now.getTime())||expiry<=now.getTime()||!id(lease.materializationsRemaining)||lease.materializationsRemaining>policy.maxMaterializationsPerRun) reject('Slot lease expired or materialization budget exhausted');
 if(typeof existingApplication!=='boolean') reject('Application existence must be checked in Oracle');
 if(existingApplication&&(!existingOwnership||!['runId','organismId','applicationId','token'].every(key=>existingOwnership[key]===lease[key]))) reject('An existing application requires matching durable slot ownership');
 return true;
}
