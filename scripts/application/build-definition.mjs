import { mkdir, readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { validateApplicationGenome, canonicalApplicationGenome } from '../../evolution/application/genome.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const templateRoot = join(repository, 'apex/order-lab/template');
const digest = value => createHash('sha256').update(value).digest('hex');
export const VERIFIED_APPLICATION_MAPPINGS = Object.freeze({
  report: Object.freeze(['classicReport']), edit: Object.freeze(['page']),
  filters: Object.freeze(['above', 'beside']), summary: Object.freeze(['before', 'after']),
  navigation: Object.freeze(['side', 'top']), density: Object.freeze(['comfortable', 'compact'])
});

async function filesUnder(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not permitted in trusted definitions');
    if (entry.isDirectory()) result.push(...await filesUnder(root, name));
    else if (entry.isFile()) result.push(name);
  }
  return result.sort();
}

export async function hashApplicationDefinition(appPath) {
  const files = [];
  for (const path of await filesUnder(appPath)) files.push({ path, sha256: digest(await readFile(join(appPath, path))) });
  return { files, definitionHash: digest(JSON.stringify(files)) };
}

export async function buildApplicationDefinition(genome, { outputDir, parentDefinitionHash = null } = {}) {
  validateApplicationGenome(genome);
  for (const [trait, value] of Object.entries(genome.traits)) {
    if (!VERIFIED_APPLICATION_MAPPINGS[trait]?.includes(value)) throw new TypeError(`Unsupported or unverified APEXlang mapping: ${trait}=${value}`);
  }
  if (parentDefinitionHash !== null && !/^[a-f0-9]{64}$/.test(parentDefinitionHash)) throw new TypeError('Invalid parent definition hash');
  if (typeof outputDir !== 'string' || !outputDir.trim() || /[\x00-\x1f"]/.test(outputDir)) throw new TypeError('A safe new output directory is required');
  const output = resolve(outputDir);
  try { await lstat(output); throw new Error('Output directory already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const canonicalGenome = canonicalApplicationGenome(genome);
  const provenance = JSON.parse(await readFile(join(repository, 'apex/order-lab/parent-source.json'), 'utf8'));
  const substitutions = {
    NAVIGATION: genome.traits.navigation,
    FILTER_SPAN: genome.traits.filters === 'beside' ? '3' : '12',
    REPORT_SPAN: genome.traits.filters === 'beside' ? '9' : '12',
    REPORT_NEW_ROW: genome.traits.filters === 'beside' ? 'false' : 'true',
    SUMMARY_SEQUENCE: genome.traits.summary === 'before' ? '5' : '40',
    DENSITY: genome.traits.density
  };
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Atomic claim: never merge with or replace another candidate.
  const appPath = join(output, 'application');
  for (const path of await filesUnder(templateRoot)) {
    const bytes = await readFile(join(templateRoot, path));
    const text = bytes.toString('utf8').replace(/@@([A-Z_]+)@@/g, (_, key) => {
      if (!Object.hasOwn(substitutions, key)) throw new Error(`Unknown trusted template token: ${key}`);
      return substitutions[key];
    });
    await mkdir(dirname(join(appPath, path)), { recursive: true });
    await writeFile(join(appPath, path), text);
  }
  const { files, definitionHash } = await hashApplicationDefinition(appPath);
  const genomeHash = digest(canonicalGenome);
  const manifest = {
    formatVersion: '1.0', kind: 'apexlang-application-definition', application: 'GENESIS_ORDER_LAB',
    genome: JSON.parse(canonicalGenome), genomeHash, definitionHash, parentDefinitionHash,
    parentSourceHash: provenance.parentSourceHash, parentSource: provenance,
    mmdVersion: provenance.mmdVersion, compilerValidated: false, runtimeVerified: false,
    fixtureRequired: true, files
  };
  const manifestPath = join(output, 'definition-manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { appPath, manifestPath, manifest, definitionHash, genomeHash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [genomePath, outputDir] = process.argv.slice(2);
    const result = await buildApplicationDefinition(JSON.parse(await readFile(genomePath, 'utf8')), { outputDir });
    console.log(JSON.stringify({ ...result, manifest: undefined }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
