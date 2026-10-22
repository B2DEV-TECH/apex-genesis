/* Trusted native controls. This file performs no genetic or fitness calculation. */
(()=>{
 'use strict';
 const contractUrl=new URL('control-contract.mjs',document.currentScript.src);
 async function boot(){
  const root=document.getElementById('living-control');if(!root)return;
  const message=root.querySelector('[data-status]');
  const buttons=[...root.querySelectorAll('button[data-action]')];
  const fields=[...root.querySelectorAll('[name="label"],[name="seed"],[name="generations"],[name="materializationBudget"],[data-requests]')];
  const disable=()=>{for(const node of [...buttons,...fields])node.disabled=true;};
  disable();
  try{
   const [{validateDraft,validateStatus,validateWatch},{createNativeView}]=await Promise.all([import(contractUrl.href),import(new URL('control-view.mjs',document.currentScript?.src||contractUrl.href).href)]);
   const view=createNativeView(root,{baseUrl:contractUrl.href});window.addEventListener('pagehide',()=>view.pause(),{once:true});
   let status=null,selected=null,busy=false;
   async function call(action,requestId,payload){
    const response=await apex.server.process('LIVING_CONTROL',{x01:action,x02:requestId||'',x03:payload?JSON.stringify(payload):''},{dataType:'json'});
    if(!response||response.ok!==true||Object.keys(response).sort().join('|')!=='data|ok')throw new Error('Control unavailable');
    return response.data;
   }
   const select=root.querySelector('[data-requests]');
   function allowed(){
    const draft=selected?.request.state==='DRAFT';
    for(const field of fields)field.disabled=busy||(field===select?status.requests.length===0:!status.canCreate);
    for(const button of buttons){
     button.disabled=busy||(button.dataset.action==='CREATE'?!status.canCreate:button.dataset.action==='START'?!status.canStart||!draft:button.dataset.action==='CANCEL'?!status.canCreate||!['DRAFT','QUEUED'].includes(selected?.request.state):!select?.value);
    }
   }
   async function render(value){
    selected=validateWatch(value);await view.render(selected);
    message.textContent=selected.request.state==='QUEUED'?'Queued for the configured worker. No execution is implied.':selected.request.state==='UNCERTAIN'?'Worker lease expired. Inspect real run evidence before creating another request.':'Oracle request '+selected.request.state;
   }
   async function refresh(preferred){
    view.clear();selected=null;
    status=validateStatus(await call('STATUS'));const previous=preferred||select?.value;
    const seed=root.querySelector('[name="seed"]');if(seed){seed.value=String(status.supportedSeed);seed.readOnly=true;}
    if(select){select.replaceChildren();for(const request of status.requests){const option=document.createElement('option');option.value=request.id;option.textContent=request.label+' · '+request.state;select.append(option);}if(status.requests.some(request=>request.id===previous))select.value=previous;}
    if(select?.value)await render(await call('WATCH',select.value));
    else{selected=null;view.clear();message.textContent=status.canStart?'Ready for an explicitly bounded GA_ONLY request.':'Control configured; the evolution worker is unavailable.';}
    allowed();
   }
   function integerInput(name){const value=root.querySelector('[name="'+name+'"]').value;if(!/^[1-9][0-9]*$/.test(value))throw new TypeError('Explicit integer required');return Number(value);}
   async function act(action){
    if(!['CREATE','START','CANCEL','REFRESH'].includes(action))return;
    if(busy)return;busy=true;allowed();
    try{
     let result;
     if(action==='CREATE'){
      const payload=validateDraft({label:root.querySelector('[name="label"]').value,seed:integerInput('seed'),generations:integerInput('generations'),materializationBudget:integerInput('materializationBudget')},status);
      result=validateWatch(await call('CREATE',null,payload));
     }else if(action==='REFRESH'){await refresh();return;}
     else{if(!select?.value)throw new TypeError('Select an actual request');result=validateWatch(await call(action,select.value));}
     await refresh(result.request.id);
    }catch{view.clear();selected=null;message.textContent='Request refused or control unavailable. No execution is assumed.';}
    finally{busy=false;allowed();}
   }
   for(const button of buttons)button.addEventListener('click',()=>act(button.dataset.action));
   select?.addEventListener('change',()=>act('REFRESH'));
   await refresh();
  }catch{disable();message.textContent='Control is disabled or not configured. An owner must bind an approved application and worker.';}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
