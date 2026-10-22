// Boundary validation only. Oracle owns genome generation and genetic operators.
export const APPLICATION_TRAITS=Object.freeze(Object.fromEntries(Object.entries({
 report:['classicReport','interactiveReport'],edit:['page','modal'],filters:['above','beside'],
 summary:['before','after'],navigation:['side','top'],density:['comfortable','compact']
}).map(([key,values])=>[key,Object.freeze(values)])));
const tasks=Object.freeze(['locateOrder','filterOrders','updateOrder']);
export const APPLICATION_BASELINE=Object.freeze({
 schemaVersion:'2.0',application:'GENESIS_ORDER_LAB',dataSource:'GENESIS_ORDERS_SAFE_V',tasks,
 traits:Object.freeze(Object.fromEntries(Object.entries(APPLICATION_TRAITS).map(([key,values])=>[key,values[0]])))
});
function exactKeys(value,keys,label){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key))) throw new TypeError('Invalid '+label+' properties');
}
export function validateApplicationGenome(genome){
 exactKeys(genome,['schemaVersion','application','dataSource','tasks','traits'],'application genome');
 if(genome.schemaVersion!=='2.0'||genome.application!=='GENESIS_ORDER_LAB'||genome.dataSource!=='GENESIS_ORDERS_SAFE_V') throw new TypeError('Unsupported application genome boundary');
 if(!Array.isArray(genome.tasks)||genome.tasks.length!==tasks.length||!tasks.every((task,index)=>genome.tasks[index]===task)) throw new TypeError('All three fixed tasks must be preserved in order');
 exactKeys(genome.traits,Object.keys(APPLICATION_TRAITS),'application traits');
 for(const [trait,values] of Object.entries(APPLICATION_TRAITS)) if(!values.includes(genome.traits[trait])) throw new TypeError('Unsupported application trait: '+trait);
 return true;
}
export function canonicalApplicationGenome(genome){
 validateApplicationGenome(genome);
 return JSON.stringify({schemaVersion:'2.0',application:'GENESIS_ORDER_LAB',dataSource:'GENESIS_ORDERS_SAFE_V',tasks:[...tasks],traits:Object.fromEntries(Object.keys(APPLICATION_TRAITS).map(key=>[key,genome.traits[key]]))});
}
export function applyApplicationProposal(parent,proposal){
 const child=JSON.parse(canonicalApplicationGenome(parent));
 exactKeys(proposal,['operations'],'application mutation proposal');
 if(!Array.isArray(proposal.operations)||proposal.operations.length<1||proposal.operations.length>3) throw new TypeError('One to three structural operations required');
 const seen=new Set();
 for(const operation of proposal.operations){
  exactKeys(operation,['trait','value'],'application mutation operation');
  const {trait,value}=operation;
  if(typeof trait!=='string'||!Object.hasOwn(APPLICATION_TRAITS,trait)||seen.has(trait)||!APPLICATION_TRAITS[trait].includes(value)) throw new TypeError('Unsupported or repeated structural operation');
  seen.add(trait);child.traits[trait]=value;
 }
 validateApplicationGenome(child);return child;
}
