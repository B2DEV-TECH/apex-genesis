import test from 'node:test';
import assert from 'node:assert/strict';
import {nextApplicationState} from '../../runtime/application/lifecycle.mjs';
const hash='a'.repeat(64);
const evidence=(extra={})=>({success:true,genomeHash:hash,artifactHash:hash,...extra});
test('application phases cannot be skipped or confused with real execution',()=>{
 assert.equal(nextApplicationState('GENOME_CREATED','DEFINITION_GENERATED',evidence()),'DEFINITION_GENERATED');
 for(const [from,to] of [['GENOME_CREATED','IMPORTED'],['DEFINITION_GENERATED','VALIDATED'],['IMPORT_STARTED','TESTING'],['IMPORTED','SELECTED'],['TESTING','SELECTED'],['REJECTED','SELECTED']]) assert.throws(()=>nextApplicationState(from,to,evidence()));
 assert.throws(()=>nextApplicationState('VALIDATION_STARTED','VALIDATED',evidence({success:false})));
 assert.equal(nextApplicationState('VALIDATION_STARTED','VALIDATION_FAILED',evidence({success:false})),'VALIDATION_FAILED');
 assert.throws(()=>nextApplicationState('IMPORT_STARTED','IMPORTED',evidence()));
 assert.equal(nextApplicationState('IMPORT_STARTED','IMPORTED',evidence({applicationId:130,existenceVerified:true})),'IMPORTED');
 assert.throws(()=>nextApplicationState('IMPORTED','TESTING',evidence({applicationId:130})));
 assert.equal(nextApplicationState('IMPORTED','RUNTIME_VERIFIED',evidence({applicationId:130,authenticated:true})),'RUNTIME_VERIFIED');
 assert.equal(nextApplicationState('RUNTIME_VERIFIED','TESTING',evidence({applicationId:130,fixtureReset:true})),'TESTING');
});
test('selection requires an eligible Oracle decision under the application fitness definition',()=>{
 const scored=evidence({authority:'ORACLE',fitnessDefinition:'order-lab-task-proxy/2.0.0',eligible:true,fitness:72.5});
 assert.equal(nextApplicationState('TESTING','EVALUATED',scored),'EVALUATED');
 assert.equal(nextApplicationState('EVALUATED','SELECTED',scored),'SELECTED');
 for(const extra of [{authority:'CLAUDE'},{fitnessDefinition:'dashboard/1.0'},{eligible:false},{fitness:NaN},{fitness:101}]) assert.throws(()=>nextApplicationState('EVALUATED','SELECTED',{...scored,...extra}));
 assert.equal(nextApplicationState('EVALUATED','REJECTED',{...scored,eligible:false,fitness:0}),'REJECTED');
 assert.equal(nextApplicationState('SELECTED','ARCHIVED',evidence({artifactsPreserved:true})),'ARCHIVED');
 assert.throws(()=>nextApplicationState('SELECTED','ARCHIVED',evidence()));
 assert.throws(()=>nextApplicationState('TESTING','ARCHIVED',evidence({artifactsPreserved:true})));
});
