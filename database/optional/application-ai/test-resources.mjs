// Synthetic harness resources only. Uses the existing bounded close primitive.
import {closeApplicationResources} from '../../../runtime/application/resources.mjs';
async function bounded(operation,timeoutMs,label){let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),timeoutMs);})]);}finally{clearTimeout(timer);}}
export async function acquireTestOnlyConnection(connect,credentials,errors,{timeoutMs=12000}={}){
 let expired=false;const acquisition=Promise.resolve().then(()=>connect({user:credentials.user,password:credentials.password,connectString:credentials.connectString,connectTimeout:10,transportConnectTimeout:5,retryCount:0,retryDelay:0}));
 acquisition.then(async db=>{if(expired){try{await closeApplicationResources({database:db});}catch{errors.push('LATE_CONNECTION_CLOSE_FAILED');}}},()=>{});
 try{return await bounded(()=>acquisition,timeoutMs,'TEST_ONLY connection acquisition timed out');}catch(error){expired=true;throw error;}
}
export async function closeTestOnlyConnections(connections,errors){
 await Promise.allSettled(connections.filter(Boolean).map(async db=>{
  try{await bounded(()=>db.rollback(),5000,'TEST_ONLY rollback timed out');}catch{errors.push('ROLLBACK_FAILED');}
  try{await closeApplicationResources({database:db});}catch{errors.push('CLOSE_FAILED');}
 }));
}
