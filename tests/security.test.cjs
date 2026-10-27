// Verificações estáticas sem rede, sem executar o bundle e sem dados reais.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
async function main() {
    const project = new URL(source('supabase-config.js').match(/url:\s*"([^"]+)"/)[1]).origin;
    for (const page of ['login.html', 'cadastro.html', 'recuperar-senha.html', 'nova-senha.html']) {
        const html = source(page);
        const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
        assert(policy.includes("form-action 'none'"));
        assert(policy.includes("default-src 'none'"));
        assert(policy.includes("script-src 'self'"));
        assert(policy.includes('connect-src ' + project + ';'), 'CSP precisa acompanhar o projeto configurado');
        assert(!policy.includes('unsafe-inline') && !policy.includes('unsafe-eval'));
        assert(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
        assert(!/\son\w+=/i.test(html), 'handlers inline não são permitidos pela CSP');
        const form = html.match(/<form\b[\s\S]*?<\/form>/)[0];
        const controls = [...form.matchAll(/<(?:input|button)\b[^>]*>/g)];
        assert(controls.length > 1);
        assert(controls.every(([tag]) => /\bdisabled(?:\s|>)/.test(tag)), 'sem JS todos os controles devem permanecer desabilitados');
        assert(html.includes('<noscript>') && html.includes('Ative o JavaScript'));
        assert(html.includes('senha exclusiva para sua conta Trailer Log'));
        for (const [, attributes, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
            assert(attributes.includes('src="'));
            assert(!/src="(?:https?:|\/\/)/.test(attributes), 'sem dependência de scripts externos em tempo de execução');
            assert.equal(code.trim(), '');
        }
    }
    const provenance = JSON.parse(source('vendor/supabase-js/provenance.json'));
    const bundle = fs.readFileSync(path.join(root, 'vendor/supabase-js', provenance.bundle));
    const integrity = 'sha384-' + crypto.createHash('sha384').update(bundle).digest('base64');
    assert.equal(integrity, provenance.bundleIntegrity);
    assert(source('auth.js').includes('script.integrity = "' + integrity + '"'));
    assert(source('auth.js').includes('script.src = "vendor/supabase-js/' + provenance.bundle + '"'));
    assert(source('.gitattributes').includes('vendor/supabase-js/*.js -text'), 'Git deve preservar os bytes verificados');
    assert(source('vendor/supabase-js/LICENSE').includes('MIT'));
    assert(source('sobre.html').includes('autenticação pelo Supabase'));
    assert(!source('sobre.html').includes('Contas individuais e sincronização na nuvem estão planejadas'));
    console.log('PASSOU: CSP, controles desabilitados sem JS, noscript, scripts locais, hash SRI, licença e identificação do aplicativo. Sem rede/dados reais.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
