import {writeFile} from 'node:fs/promises';
import {rendererBundle} from './renderer-bundle.mjs';
await writeFile(new URL('../showcase/renderer/preview.html',import.meta.url),await rendererBundle());
console.log('Compiled the canonical renderer into an opaque-origin sandbox preview.');
