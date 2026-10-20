import {validateGenome,PALETTES} from './genome.mjs';
export const RENDERER_VERSION='1.0.0';
export const ORDERS=Object.freeze([{name:'Atlas',amount:1280,status:'Ready'},{name:'Beacon',amount:840,status:'Review'},{name:'Cedar',amount:2100,status:'Ready'},{name:'Delta',amount:560,status:'Review'}]);
function el(tag,text,cls){const e=document.createElement(tag);if(text!==null&&text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
export function renderOrganism(root,g){
  if(!validateGenome(g).valid)throw new Error('Renderer rejected genome');
  root.replaceChildren();root.className='organism';
  const p=PALETTES[g.style.palette];
  for(const [k,v]of Object.entries(p))root.style.setProperty('--org-'+k,v);
  root.style.setProperty('--org-font',g.style.fontSize+'px');root.style.setProperty('--org-space',g.style.spacing+'px');root.style.setProperty('--org-radius',g.style.radius+'px');root.style.setProperty('--org-columns',g.layout.columns);
  root.style.setProperty('--org-order-span',Math.min(2,g.layout.columns));
  root.dataset.navigation=g.layout.navigation;
  const header=el('header',null,'org-header');header.append(el('strong','NORTH / OPERATIONS'),el('span','Synthetic scenario · Q3 2026','org-caption'));root.append(header);
  const shell=el('div',null,'org-shell'),nav=el('nav',null,'org-nav');nav.setAttribute('aria-label','Dashboard sections');
  const grid=el('div',null,'org-grid');
  const sections={};
  for(const name of g.layout.order){const link=el('a',name[0].toUpperCase()+name.slice(1));link.href='#org-'+name;nav.append(link);const section=el('section',null,'org-section');section.id='org-'+name;section.dataset.section=name;section.append(el('h2',{metrics:'Operating summary',filters:'Explore orders',revenue:'Revenue by month',orders:'Order workspace'}[name]));sections[name]=section;grid.append(section);}
  const metrics=el('div',null,'org-metrics');for(const [label,value]of [['Revenue','$4,780'],['Orders','4'],['Ready','2']]){const card=el('div',null,'org-metric');card.append(el('span',label),el('strong',value));metrics.append(card);}sections.metrics.append(metrics);
  const form=el('form',null,'org-filters'),label=el('label','Order status'),select=el('select');label.htmlFor='org-status';select.id='org-status';for(const value of ['All','Ready','Review']){const o=el('option',value);o.value=value;select.append(o);}const button=el('button','Apply filter');button.type='submit';form.append(label,select,button);sections.filters.append(form);
  const chart=el('div',null,'org-chart');chart.setAttribute('role','img');chart.setAttribute('aria-label','Monthly synthetic revenue: July 1200, August 1580, September 2000 dollars');
  if(g.layout.chart==='bars'){for(const [month,value]of [['Jul',1200],['Aug',1580],['Sep',2000]]){const item=el('div',null,'org-bar-item'),bar=el('div',null,'org-bar');bar.style.height=(value/22)+'px';item.append(el('span','$'+value),bar,el('span',month));chart.append(item);}}
  else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 240 100');svg.setAttribute('aria-hidden','true');const line=document.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points','10,80 120,51 230,15');line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','4');svg.append(line);chart.append(svg,el('p','Jul $1,200 · Aug $1,580 · Sep $2,000','org-caption'));}sections.revenue.append(chart);
  const status=el('p','4 synthetic orders','org-caption');status.setAttribute('role','status');
  const results=el('div',null,'org-results');
  const draw=(filter='All')=>{results.replaceChildren();const rows=ORDERS.filter(r=>filter==='All'||r.status===filter).toSorted(g.behavior.sort==='value'?(a,b)=>b.amount-a.amount:(a,b)=>a.name.localeCompare(b.name));status.textContent=rows.length+' synthetic orders';
    if(g.layout.table==='table'){const table=el('table');const caption=el('caption','Synthetic orders');table.append(caption);const head=el('thead'),tr=el('tr');for(const name of ['Order','Amount','Status']){const th=el('th',name);th.scope='col';tr.append(th);}head.append(tr);table.append(head);const body=el('tbody');for(const row of rows){const r=el('tr');for(const cell of [row.name,'$'+row.amount,row.status])r.append(el('td',cell));body.append(r);}table.append(body);results.append(table);}
    else{const list=el('ul',null,'org-order-cards');for(const r of rows){const li=el('li');li.append(el('strong',r.name),el('span','$'+r.amount),el('span',r.status));list.append(li);}results.append(list);}
  };draw();form.addEventListener('submit',e=>{e.preventDefault();draw(select.value);});sections.orders.append(status,results);
  const details=el('details');details.open=!g.behavior.collapseDetails;details.append(el('summary','Scenario notes'),el('p','All names and transactions are synthetic. Filters affect the order workspace. Revenue shows the complete quarter.'));sections.orders.append(details);
  shell.append(nav,grid);root.append(shell);return root;
}
