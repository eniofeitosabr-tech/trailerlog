'use strict';
// Local build only. No network, database, git mutation or deployment.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const listFile = path.join(__dirname, 'pages-files.txt');
const normalized = value => value.split(path.sep).join('/');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function files() {
    const names = fs.readFileSync(listFile, 'utf8').trim().split(/\r?\n/);
    assert.equal(names.length, 36, 'Review any change to the 36-file publication boundary');
    assert.equal(new Set(names).size, names.length, 'Duplicate public asset');
    for (const name of names) {
        assert(!path.isAbsolute(name) && !name.includes('\\') && !name.split('/').some(p => p === '..' || p === '.' || !p), 'Unsafe asset path');
        assert(!/^(?:supabase|tests|release|Documentos|scripts|\.github)\//i.test(name), 'Internal directory in public artifact');
        assert(!/(?:repair|manifest|receipt|\.sql$|\.md$)/i.test(name), 'Operational material in public artifact');
        assert(name !== 'sync-import-ui.js' && name !== 'sync-import-executor.js' && name !== 'sync-import-preview.js', 'Inactive import tools are not public assets');
    }
    return names;
}

function regularAsset(source, name) {
    let current = source;
    for (const part of name.split('/')) {
        assert(fs.readdirSync(current).includes(part), 'Missing or incorrectly cased path: ' + name);
        current = path.join(current, part);
        assert(!fs.lstatSync(current).isSymbolicLink(), 'Symlinks are not allowed: ' + name);
    }
    assert(fs.statSync(current).isFile(), 'Expected an ordinary file: ' + name);
    return current;
}

function walk(directory, prefix = '') {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const name = prefix + entry.name;
        assert(!entry.isSymbolicLink(), 'Symlink in artifact');
        return entry.isDirectory() ? walk(path.join(directory, entry.name), name + '/') : [name];
    }).sort();
}

function validate(source, names) {
    const allowed = new Set(names);
    function reference(from, target) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) return;
        const clean = target.split(/[?#]/)[0];
        if (!clean) return;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), clean));
        assert(allowed.has(resolved), 'Dependency outside allowlist: ' + from + ' -> ' + target);
    }
    for (const name of names) {
        const filename = regularAsset(source, name);
        if (!/\.(?:html|js|css)$/.test(name)) continue;
        const text = fs.readFileSync(filename, 'utf8');
        // Reject embedded credentials or private identity literals, without printing their values.
        if (!name.startsWith('vendor/')) {
            assert(!/\bsb_secret_[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), 'Secret material in: ' + name);
            assert(!/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i.test(text), 'Hardcoded account/entity identity in: ' + name);
            assert(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(text), 'Embedded JWT in: ' + name);
        }
        if (name.endsWith('.html')) {
            for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) reference(name, match[1]);
        }
        if (name.endsWith('.css')) {
            for (const match of text.matchAll(/url\(\s*["']?([^"'\s)]+)["']?\s*\)/g)) reference(name, match[1]);
        }
    }
    assert(allowed.has('payment-settings.js') && allowed.has('daily-sync.js'), 'Required runtime missing');
    const provenance = JSON.parse(fs.readFileSync(path.join(source, 'vendor/supabase-js/provenance.json'), 'utf8'));
    const sdk = 'vendor/supabase-js/' + provenance.bundle;
    assert(allowed.has(sdk), 'Dynamic authentication dependency is not allowlisted');
    const integrity = 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(path.join(source, sdk))).digest('base64');
    assert.equal(integrity, provenance.bundleIntegrity, 'SDK integrity mismatch');
    assert(fs.readFileSync(path.join(source, 'auth.js'), 'utf8').includes(integrity), 'Authentication SRI mismatch');
}

function build({ source = root, output = path.join(root, '_site') } = {}) {
    source = path.resolve(source);
    output = path.resolve(output);
    assert(output !== source && !source.startsWith(output + path.sep), 'Output cannot contain or replace source');
    const names = files();
    validate(source, names); // Check all inputs before writing any artifact.
    if (fs.existsSync(output)) {
        assert(!fs.lstatSync(output).isSymbolicLink(), 'Output cannot be a symlink');
        assert.equal(fs.readdirSync(output).length, 0, 'Refusing to overwrite or delete an existing artifact; use a fresh directory');
    } else fs.mkdirSync(output, { recursive: true });
    for (const name of names) {
        const target = path.join(output, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(regularAsset(source, name), target);
    }
    assert.deepEqual(walk(output), [...names].sort(), 'Unexpected file in public artifact');
    for (const name of names) assert.equal(sha(fs.readFileSync(path.join(output, name))), sha(fs.readFileSync(path.join(source, name))), 'Asset bytes changed');
    return { output, count: names.length, files: names };
}

if (require.main === module) {
    const result = build();
    console.log('Pages artifact verified: ' + result.count + ' allowlisted files; internal files excluded.');
}
module.exports = { files, validate, walk, build };
