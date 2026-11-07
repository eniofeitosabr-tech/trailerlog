'use strict';
// Synthetic privacy canaries and a local artifact only. No network or deployment.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { files, build, walk } = require('../scripts/build-pages.cjs');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trailerlog-pages-test-'));
const source = path.join(temporary, 'source');
fs.mkdirSync(source);
for (const name of files()) {
    const destination = path.join(source, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, name), destination);
}
for (const name of ['supabase/deployment/private-manifest.json', 'tests/private.test.cjs', 'release/receipt.json', 'INTERNAL.md']) {
    const target = path.join(source, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'SYNTHETIC_PRIVATE_CANARY');
}
const output = path.join(temporary, 'public');
assert.equal(build({ source, output }).count, 36);
assert.deepEqual(walk(output), files().sort());
assert(!walk(output).some(name => /supabase\/deployment|^tests\/|^release\/|INTERNAL/.test(name)));
assert.throws(() => build({ source, output }), /Refusing to overwrite/);
fs.appendFileSync(path.join(source, 'index.html'), '<script src="supabase/deployment/private-tool.js"></script>');
assert.throws(() => build({ source, output: path.join(temporary, 'bad-reference') }), /Dependency outside allowlist/);
assert(!fs.existsSync(path.join(temporary, 'bad-reference')), 'Invalid input must not create output');
fs.copyFileSync(path.join(root, 'index.html'), path.join(source, 'index.html'));
fs.appendFileSync(path.join(source, 'index.html'), '<!-- 10000000-0000-4000-8000-000000000099 -->');
assert.throws(() => build({ source, output: path.join(temporary, 'bad-private-id') }), /Hardcoded account/);
assert(!fs.existsSync(path.join(temporary, 'bad-private-id')));
const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
assert(/on:\s*\n\s+workflow_dispatch:/.test(workflow), 'Publishing must be manually dispatched');
assert(!/^\s+(?:push|pull_request|schedule):/m.test(workflow), 'Unexpected automatic deployment trigger');
assert(/path: _site\s*$/m.test(workflow), 'Only the generated public directory may be uploaded');
assert(/needs: build/.test(workflow), 'Deployment must wait for artifact verification');
console.log('PASS Pages: exact 36-file artifact, private canaries excluded, references/SRI validated, unsafe input and overwrite blocked. Test fixture retained in OS temporary directory.');
