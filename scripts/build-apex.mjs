import {cp,readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const target='apex/application',starter='.local/apex-26-2/apex-genesis';
await mkdir('apex',{recursive:true});await cp(starter,target,{recursive:true});
for(const file of await readdir(target+'/pages'))if(/^p0000[1-8]-genesis(?:-[1-8])?\.apx$/.test(file))await rm(target+'/pages/'+file);
await writeFile(target+'/deployments/default.json','{}\n');
let app=await readFile(target+'/application.apx','utf8');
app=app.replace('    name: APEX Genesis','    name: APEX Genesis\n    version: 0.1.0-alpha.1');
app=app.replace('    security {','    authorization {\n        scheme: @genesis-read\n        runOnPublicPages: false\n    }\n    css {\n        fileUrls: #APP_FILES#genesis/lab.css\n    }\n    javaScript {\n        fileUrls: #APP_FILES#genesis/apex-boot.js\n    }\n    security {');
await writeFile(target+'/application.apx',app);
await writeFile(target+'/shared-components/authorizations.apx',`authorization genesis-read (\n name: Genesis Reader\n type: plSqlFunctionBody\n settings {\n plsqlFunctionBody: return apxgen_security.allowed('READER')=1;\n }\n error {\n errorMessage: A named Genesis principal is required.\n }\n)\n`);
const raw=await readFile('showcase/index.html','utf8');let content=raw.match(/<body>([\s\S]*)<script type="module" src="\.\/lab\.mjs(?:\?[^"]*)?"><\/script><\/body>/)[1];content=content.replace(/<main /,'<div ').replace('</main>','</div>').replace(/<button /g,'<button type="button" ');
const names=['Genesis Control Center','Evolution Arena','Evolution Tree','Evolution Time Machine','Darwin vs Claude','Mutation Microscope','Research Analytics','Experiment Configuration'];
const views=['','arena','tree','arena','arena','mutation','analytics',''];
const control=`<div id="genesis-control">
<p class="eyebrow">ORACLE-OWNED STATE / AUTHENTICATED CONTROL</p><h1>Genesis Control Center</h1>
<p class="lede">The database owns every generation. Pending candidates await the browser evaluation worker.</p>
<label for="control-run">Experiment</label><select id="control-run"></select><section id="control-metrics" class="instrument-bar"></section>
<div class="transport"><button type="button" data-control="PAUSE">Pause</button><button type="button" data-control="RESUME">Resume</button><button type="button" data-control="STOP">Stop</button><button type="button" data-control="STEP">Run one generation</button><button type="button" data-control="STOP_AI">Stop AI</button></div>
<div class="configuration-grid"><label>Generation count<input id="run-count" type="number" min="1" max="100" value="5"></label><button type="button" data-control="RUN_N">Run N generations, then pause</button>
<label>Completed checkpoint generation<input id="checkpoint-generation" type="number" min="0" max="1000" value="0"></label><button type="button" data-control="CHECKPOINT">Duplicate checkpoint</button><button type="button" data-control="EXPORT">Download completed run JSON</button></div>
<p>Bounded requests include the current unfinished generation. A completed checkpoint is copied into a new run; its source history stays intact. The public publication pipeline separately produces the verified partitioned export.</p>
<p id="control-heartbeat" role="status"></p><h2>Evolution events</h2><ol id="control-events"></ol></div>`;
const numberField=(label,id,value,min,max,step=1)=>`<label>${label}<input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
const config=`<div class="analytics-card"><p class="eyebrow">SAFE DEFAULTS / PROVIDER DISABLED</p><h1>Experiment Configuration</h1>
<p>Every run uses synthetic data. AI requires separately configured credentials, reviewed prices, model verification and explicit owner opt-in. Creating a run never enables paid requests. Configuration becomes immutable after initialization.</p>
<div class="configuration-grid"><label>Experiment name<input id="new-label" value="Local Genesis experiment" maxlength="120"></label><label>Population<select id="new-mode"><option>GA_ONLY</option><option>RANDOM_SEARCH</option><option>GA_HAIKU</option></select></label>
${numberField('Seed','new-seed',42,1,2147483646)}${numberField('Population size','new-size',12,4,100)}${numberField('Generations','new-generations',5,1,1000)}
${numberField('Mutation rate','new-mutation',.25,0,1,.01)}${numberField('Crossover rate','new-crossover',.75,0,1,.01)}${numberField('Elites','new-elites',2,0,99)}${numberField('Tournament size','new-tournament',3,2,10)}
${numberField('Diversity threshold','new-diversity',.3,0,1,.01)}${numberField('Stagnation window','new-stagnation',10,1,1000)}${numberField('Generation timeout / seconds','new-generation-timeout',1200,30,7200)}${numberField('Total timeout / seconds','new-total-timeout',21600,30,86400)}</div>
<h2>Technical fitness weights</h2><p>Weights must sum to one. Hard accessibility, structure and responsive constraints remain mandatory. New weights define a new experimental condition.</p><div class="configuration-grid">
${numberField('Accessibility','weight-accessibility',.4,0,1,.01)}${numberField('Hierarchy','weight-hierarchy',.25,0,1,.01)}${numberField('Responsiveness','weight-responsiveness',.25,0,1,.01)}${numberField('DOM performance proxy','weight-performance',.1,0,1,.01)}</div>
<button id="create-experiment" type="button">Create and start experiment</button><p id="create-status" role="status"></p><p>A Node/Playwright worker supplies real browser observations; DBMS_SCHEDULER advances ready generations. Limits and types are validated in Oracle.</p></div>`;
const files=[];
for(let n=1;n<=8;n++){
 const html=n===1?control:n===8?config:`<div data-genesis-embedded data-initial-view="${views[n-1]}">${content}</div>`;
 const page=`page ${n} (\n name: ${names[n-1]}\n alias: GENESIS-${n}\n title: ${names[n-1]} | APEX Genesis\n appearance {\n pageTemplate: @/standard\n templateOptions: #DEFAULT#\n }\n navigation {\n warnOnUnsavedChanges: false\n }\n security {\n authentication: required\n pageAccessProtection: argumentsMustHaveChecksum\n }\n region genesis-laboratory (\n name: ${names[n-1]}\n type: staticContent\n layout {\n sequence: 10\n slot: body\n columnSpan: 12\n startNewRow: true\n }\n appearance {\n template: @/blank-with-attributes\n templateOptions: #DEFAULT#\n }\n source {\n htmlCode: \`\`\`html\n${html}\n\`\`\`\n }\n )\n process genesis-data (\n name: GENESIS_DATA\n type: executeCode\n source {\n plsqlCode: \`\`\`plsql\napxgen_web.ajax;\n\`\`\`\n }\n execution {\n sequence: 10\n point: ajaxCallback\n }\n )\n)\n`;
 const filename=`p${String(n).padStart(5,'0')}-genesis-${n}.apx`;await writeFile(target+'/pages/'+filename,page);files.push(filename);
}
await rm(target+'/pages/p00001-home.apx');
const nav=names.map((name,i)=>`entry genesis-${i+1} (\n label: ${name}\n icon {\n imageIconCssClasses: fa-${['dashboard','desktop','sitemap','history','exchange','search','bar-chart','sliders'][i]}\n }\n layout {\n sequence: ${(i+1)*10}\n }\n link {\n target: {\n page: ${i+1}\n }\n }\n)`).join('\n');
await writeFile(target+'/shared-components/lists/navigation-menu.apx','list navigation-menu (\nname: Navigation Menu\n'+nav+'\n)\n');
const assets=['lab.mjs','lab.css','dataset.mjs','fitness-context.mjs','apex-boot.js','renderer/preview.html','renderer/genome.mjs'];let staticFiles=await readFile(target+'/shared-components/static-files.apx','utf8');
for(const path of assets){const destination=join(target,'shared-components/static-files/genesis',path);await mkdir(join(destination,'..'),{recursive:true});await cp('showcase/'+path,destination);staticFiles+=`\nfile "genesis/${path}" (\n mimeType: ${path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':'text/javascript'}\n charSet: utf-8\n)\n`;}
await writeFile(target+'/shared-components/static-files.apx',staticFiles);
console.log('Built eight authenticated native APEX pages and shared laboratory assets.');
