import oracledb from 'oracledb';
import {readFile} from 'node:fs/promises';
oracledb.fetchAsString=[oracledb.CLOB];
oracledb.outFormat=oracledb.OUT_FORMAT_OBJECT;
export async function config(){return JSON.parse((await readFile(new URL('../.local/oracle.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));}
export async function connect(){const {user,password,connectString}=await config();return oracledb.getConnection({user,password,connectString});}
export async function rows(db,sql,binds={}){return (await db.execute(sql,binds)).rows;}
export async function createRun(db,{label='Genesis experiment',mode='GA_ONLY',seed=42,size=12,generations=100}={}){
 const r=await db.execute('begin :id := apxgen_evolution.create_run(:label,:mode,:seed,:size,:generations); end;',{id:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},label,mode,seed,size,generations});await db.commit();return r.outBinds.id;
}
export {oracledb};
