// Attempt every owned close; never let one failure skip the other resource.
export async function closeApplicationResources({browser,database,timeoutMs=10000}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw new TypeError('A cleanup timeout between 1 and 10000 milliseconds is required');
 const resources=[browser,database].filter(Boolean);
 const closed=await Promise.allSettled(resources.map(async resource=>{
  let timer;
  try{await Promise.race([Promise.resolve().then(()=>resource.close()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned resource close timed out')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
 }));
 if(closed.some(result=>result.status==='rejected'))throw new Error('Application worker resource cleanup failed');
}

// Include acquisition in the operation so connection failures also restore data.
export async function withRestoredFixture(fixture,operation){
 try{return await operation();}finally{await fixture.reset({forCleanup:true});}
}
