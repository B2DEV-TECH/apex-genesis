import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { hashApplicationDefinition } from './build-definition.mjs';

export async function fingerprintSqlcl(sqlclPath) {
  const compilerJar = resolve(dirname(sqlclPath), '../lib/ext/apexlang-compiler.jar');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  return { executableSha256: digest(await readFile(sqlclPath)), compilerJarSha256: digest(await readFile(compilerJar)) };
}

export function executeSqlcl(file, args, { input = '', timeoutMs }) {
  return new Promise(resolveResult => {
    let stdout = '', stderr = '', timedOut = false, spawnError = null;
    const child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.stdin.on('error', () => {});
    child.on('error', error => { spawnError = error.code || error.message; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr, exitCode, signal, timedOut, spawnError });
    });
    child.stdin.end(input);
  });
}

export function acceptsCompilerResult(result) {
  if (!result || result.spawnError || result.timedOut || result.exitCode !== 0) return false;
  const output = (result.stdout || '') + (result.stderr || '');
  return /^\s*Validation successful\.\s*$/m.test(output)
    && !/Compile Errors|Error:|ORA-\d|SP2-\d|not supported|Upgrade SQLcl|Unknown Command/i.test(output);
}

export async function validateApplicationDefinition({ appPath, evidenceDir, sqlclPath, timeoutMs = 120000 } = {}) {
  for (const [name, value] of Object.entries({ appPath, evidenceDir, sqlclPath })) {
    if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f"]/.test(value)) throw new TypeError(`Invalid ${name}`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new TypeError('Invalid compiler timeout');
  const absoluteAppPath = resolve(appPath), absoluteEvidence = resolve(evidenceDir);
  const comparisonApp = process.platform === 'win32' ? absoluteAppPath.toLowerCase() : absoluteAppPath;
  const comparisonEvidence = process.platform === 'win32' ? absoluteEvidence.toLowerCase() : absoluteEvidence;
  if (comparisonEvidence === comparisonApp || comparisonEvidence.startsWith(comparisonApp + sep)) throw new TypeError('Evidence must remain outside the application definition');
  const before = await hashApplicationDefinition(absoluteAppPath);
  let fingerprintBefore = null;
  try { fingerprintBefore = await fingerprintSqlcl(sqlclPath); } catch {}
  const version = await executeSqlcl(sqlclPath, ['-version'], { timeoutMs });
  let compilation = null;
  if (!version.spawnError && !version.timedOut && version.exitCode === 0 && /SQLcl: Release 26\.[2-9]/.test(version.stdout + version.stderr)) {
    compilation = await executeSqlcl(sqlclPath, ['-thin', '-nohistory', '-noupdates', '-S', '/nolog'], {
      timeoutMs,
      input: `prompt\nset define off\nwhenever sqlerror exit failure rollback\napex validate -input "${absoluteAppPath.replaceAll('\\', '/')}"\nexit\n`
    });
  }
  const output = compilation ? compilation.stdout + compilation.stderr : version.stdout + version.stderr;
  const after = await hashApplicationDefinition(absoluteAppPath);
  let fingerprintAfter = null;
  try { fingerprintAfter = await fingerprintSqlcl(sqlclPath); } catch {}
  const unchanged = before.definitionHash === after.definitionHash && fingerprintBefore !== null && JSON.stringify(fingerprintBefore) === JSON.stringify(fingerprintAfter);
  const compilerValid = unchanged && acceptsCompilerResult(compilation);
  const status = compilerValid ? 'compiler_validated' : version.spawnError ? 'compiler_unavailable' : !compilation ? 'compiler_version_rejected' : compilation.timedOut ? 'compiler_timeout' : !unchanged ? 'definition_changed' : 'compiler_rejected';
  const evidence = { formatVersion: '1.0', status, compilerValid, runtimeVerified: false, connected: false, definitionHash: before.definitionHash, files: before.files,
    compiler: { version: (version.stdout + version.stderr).trim(), executable: resolve(sqlclPath), ...(fingerprintBefore || { executableSha256:null,compilerJarSha256:null }), exitCode: compilation?.exitCode ?? version.exitCode, error: compilation?.spawnError ?? version.spawnError },
    observedAt: new Date().toISOString(), outputSha256: createHash('sha256').update(output).digest('hex') };
  await mkdir(absoluteEvidence, { recursive: true });
  const outputPath = join(absoluteEvidence, 'compiler-output.txt'), evidencePath = join(absoluteEvidence, 'compiler-validation.json');
  await writeFile(outputPath, output);
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  return { ...evidence, outputPath, evidencePath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [appPath, evidenceDir, sqlclPath] = process.argv.slice(2);
    const result = await validateApplicationDefinition({ appPath, evidenceDir, sqlclPath });
    console.log(JSON.stringify(result, null, 2));
    if (!result.compilerValid) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
