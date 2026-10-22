import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashApplicationDefinition } from '../../../scripts/application/build-definition.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));

test('the versioned successful source snapshot retains the genuine compiler binding', async () => {
  const snapshot = await json('snapshots/feasibility-v1/snapshot.json');
  const evidence = await json('snapshots/feasibility-v1/compiler-validation.json');
  const source = await hashApplicationDefinition(join(root, 'snapshots/feasibility-v1/application'));
  assert.equal(source.definitionHash, 'a3fcadef1911fd2c00aeff8109b2a924a5ae533640b56a7cb5a18aebe415bfae');
  assert.equal(source.definitionHash, snapshot.definitionHash);
  assert.equal(source.definitionHash, evidence.definitionHash);
  assert.equal(sha(await readFile(join(root, 'snapshots/feasibility-v1/compiler-output.txt'))), evidence.outputSha256);
  assert.equal(evidence.compilerValid, true);
});

test('every prototype preserves exact source and compiler output, including rejected attempts', async () => {
  const index = await json('index.json');
  assert.equal(index.runtimeVerified, false);
  assert.equal(index.imports, 0);
  for (const entry of index.cases) {
    const source = await hashApplicationDefinition(join(root, entry.name, 'application'));
    const evidence = await json(entry.evidence);
    const output = await readFile(join(root, dirname(entry.evidence), 'compiler-output.txt'));
    const text = output.toString();
    assert.equal(source.definitionHash, entry.definitionHash, entry.name);
    assert.equal(source.definitionHash, evidence.definitionHash, entry.name);
    assert.equal(sha(output), evidence.outputSha256, entry.name);
    assert.equal(entry.compilerValid, evidence.compilerValid, entry.name);
    assert.equal((text.match(/Warning:/g) || []).length, entry.warningCount, entry.name);
    assert.equal((text.match(/Error:/g) || []).length, entry.errorCount, entry.name);
    assert.equal(entry.compilerValid, /Validation successful\./.test(text) && entry.errorCount === 0, entry.name);
    assert.equal(evidence.runtimeVerified, false, entry.name);
    assert.equal(evidence.connected, false, entry.name);
  }
  for (const name of ['top-navigation-v1', 'interactive-report-v3', 'modal-edit-v4', 'combined-v2']) {
    const entry = index.cases.find(candidate => candidate.name === name);
    assert.equal(entry?.compilerValid, true, name);
    assert.equal(entry.warningCount, 0, name);
  }
});

test('the preserved mapping matrix distinguishes accepted navigation warnings from errors', async () => {
  const index = await json('snapshots/feasibility-v1/mappings/index.json');
  assert.equal(index.entries.length, 16);
  for (const entry of index.entries) {
    const evidence = await json(`snapshots/feasibility-v1/mappings/${entry.evidence}`);
    const output = await readFile(join(root, 'snapshots/feasibility-v1/mappings', dirname(entry.evidence), 'compiler-output.txt'));
    assert.equal(sha(output), evidence.outputSha256, entry.variant);
    assert.match(output.toString(), /Validation successful\./, entry.variant);
    assert.doesNotMatch(output.toString(), /APEXlang Compile Errors:/, entry.variant);
    assert.equal((output.toString().match(/Warning:/g) || []).length, entry.traits.navigation === 'top' ? 3 : 0, entry.variant);
  }
});
