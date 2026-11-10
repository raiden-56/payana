// The package root has no "type" field so that dist/cjs is CommonJS.
// dist/esm needs its own marker so Node and bundlers treat it as ES modules.
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
fs.writeFileSync(path.join(dist, 'esm', 'package.json'), JSON.stringify({ type: 'module' }) + '\n');
fs.writeFileSync(path.join(dist, 'cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
