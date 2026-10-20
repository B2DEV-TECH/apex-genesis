export const SECTIONS = Object.freeze(['metrics','filters','revenue','orders']);
export const PALETTES = Object.freeze([
  {bg:'#10151c',surface:'#1b2430',text:'#f4f4f5',accent:'#f5a640'},
  {bg:'#f4f1eb',surface:'#ffffff',text:'#20252d',accent:'#754200'},
  {bg:'#101b19',surface:'#1a2a25',text:'#e7f5ed',accent:'#78e1b0'},
  {bg:'#343840',surface:'#424650',text:'#797d85',accent:'#999999'}
]);
export const GENE_NAMES=Object.freeze(['columns','navigation','order','chart','table','palette','fontSize','spacing','radius','collapseDetails','sort']);
export const GENE_LIMITS=Object.freeze([4,2,24,2,2,4,5,6,6,2,2]);
export function permutation(index) {
  const items=[...SECTIONS], out=[];
  for(let n=4;n>0;n--){const f=[1,1,2,6][n-1];out.push(items.splice(Math.floor(index/f),1)[0]);index%=f;}
  return out;
}
export function fromGenes(genes) {
  if(!Array.isArray(genes)||genes.length!==11||genes.some((v,i)=>!Number.isInteger(v)||v<0||v>=GENE_LIMITS[i])) throw new Error('Invalid bounded genes');
  return {schemaVersion:'1.0',layout:{columns:genes[0]+1,navigation:['top','left'][genes[1]],order:permutation(genes[2]),chart:['bars','line'][genes[3]],table:['table','cards'][genes[4]]},style:{palette:genes[5],fontSize:12+genes[6]*2,spacing:4+genes[7]*4,radius:genes[8]*4},behavior:{collapseDetails:!!genes[9],sort:['name','value'][genes[10]]}};
}
function keys(obj, expected){return obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).length===expected.length&&expected.every(k=>Object.hasOwn(obj,k));}
export function validateGenome(g) {
  const errors=[];
  if(!keys(g,['schemaVersion','layout','style','behavior'])||g.schemaVersion!=='1.0')return {valid:false,errors:['Unsupported genome envelope']};
  const l=g.layout,s=g.style,b=g.behavior;
  if(!keys(l,['columns','navigation','order','chart','table'])||!Number.isInteger(l.columns)||l.columns<1||l.columns>4||!['top','left'].includes(l.navigation)||!['bars','line'].includes(l.chart)||!['table','cards'].includes(l.table)||!Array.isArray(l.order)||l.order.length!==4||new Set(l.order).size!==4||l.order.some(x=>!SECTIONS.includes(x)))errors.push('Invalid layout');
  if(!keys(s,['palette','fontSize','spacing','radius'])||!Number.isInteger(s.palette)||s.palette<0||s.palette>3||![12,14,16,18,20].includes(s.fontSize)||![4,8,12,16,20,24].includes(s.spacing)||![0,4,8,12,16,20].includes(s.radius))errors.push('Invalid style');
  if(!keys(b,['collapseDetails','sort'])||typeof b.collapseDetails!=='boolean'||!['name','value'].includes(b.sort))errors.push('Invalid behavior');
  return {valid:errors.length===0,errors};
}
export function canonicalGenome(g) {
  if(!validateGenome(g).valid)throw new Error('Invalid genome');
  const l=g.layout,s=g.style,b=g.behavior;
  return JSON.stringify({schemaVersion:'1.0',layout:{columns:l.columns,navigation:l.navigation,order:l.order,chart:l.chart,table:l.table},style:{palette:s.palette,fontSize:s.fontSize,spacing:s.spacing,radius:s.radius},behavior:{collapseDetails:b.collapseDetails,sort:b.sort}});
}
export function applyMutation(parent,proposal) {
  if(!keys(proposal,['operations'])||!Array.isArray(proposal.operations)||proposal.operations.length<1||proposal.operations.length>3)throw new Error('One to three operations required');
  const g=JSON.parse(canonicalGenome(parent));
  const locations={columns:g.layout,navigation:g.layout,order:g.layout,chart:g.layout,table:g.layout,palette:g.style,fontSize:g.style,spacing:g.style,radius:g.style,collapseDetails:g.behavior,sort:g.behavior};
  const seen=new Set();
  for(const op of proposal.operations){if(!keys(op,['gene','value'])||!Object.hasOwn(locations,op.gene)||seen.has(op.gene))throw new Error('Unsupported mutation');seen.add(op.gene);locations[op.gene][op.gene]=op.value;}
  if(!validateGenome(g).valid)throw new Error('Mutation violates schema');
  return g;
}
