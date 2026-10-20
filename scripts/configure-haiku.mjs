import {connect,config} from './db.mjs';
let key='';for await(const chunk of process.stdin)key+=chunk;key=key.trim();
if(key.length<20||key.length>500||/[\r\n\x00]/.test(key))throw new Error('Invalid key input');
const db=await connect();const c=await config();
try{
 await db.execute(`declare n number;begin
 apex_util.set_security_group_id(apex_util.find_security_group_id(:workspace));
 select count(*) into n from apex_workspace_credentials where static_id='APXGEN_HAIKU';
 if n=0 then apex_credential.create_credential(p_credential_name=>'Genesis optional Haiku',p_credential_static_id=>'APXGEN_HAIKU',p_authentication_type=>apex_credential.c_type_http_header,p_allowed_urls=>apex_t_varchar2('https://api.anthropic.com/'));end if;
 apex_credential.set_persistent_credentials(p_credential_static_id=>'APXGEN_HAIKU',p_key=>'x-api-key',p_value=>:secret);
 update apxgen_provider_config set credential_static_id='APXGEN_HAIKU',model_id='claude-haiku-5-5',enabled=0 where singleton=1;
 end;`,{workspace:c.workspace,secret:key});await db.commit();
 console.log('APEX Web Credential configured. Paid execution remains disabled; the key was not written to project files.');
}catch(error){await db.rollback();console.error('Credential configuration failed:',error.code||'Oracle error');process.exitCode=1;}finally{key='';await db.close();}
