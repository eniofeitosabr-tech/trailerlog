/* Opt-in only. No startup, auth hooks, UI or automatic import. Requires sha256.js. */
const TrailerImportExecutor = (() => {
    const clone = x => JSON.parse(JSON.stringify(x));
    const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
    const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
    const stable = x => Array.isArray(x) ? x.map(stable) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
    const hash = x => trailerSha256(JSON.stringify(stable(x)));
    const fail = code => { throw Object.assign(Error(code), { code }); };
    function environment(value) {
        let url;
        try { url = new URL(value); } catch (_) { fail('invalid_environment'); }
        if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
            (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) fail('invalid_environment');
        return url.origin;
    }
    function create({ preview, storage, locks, getContext, send }) {
        let pauseRequested = false;
        if (!preview?.materialize || !storage?.getItem || !storage?.setItem || !locks?.request || typeof getContext !== 'function' || typeof send !== 'function') fail('missing_dependencies');
        async function context() {
            const ctx = await getContext();
            if (!uuid(ctx?.account)) fail('authentication_required');
            return { account: ctx.account, environment: environment(ctx.environment), token: ctx.token ?? null };
        }
        function key(ctx) { return 'trailerlog:import:v1:' + encodeURIComponent(ctx.environment) + ':' + ctx.account; }
        async function guard(bound, plan) {
            const current = await context();
            if (current.account !== bound.account || current.environment !== bound.environment) fail('scope_changed');
            if (plan && hash(current.token) !== hash(plan.token ?? null)) fail('local_snapshot_changed');
        }
        function work(state) { return preview.materialize(state.plan, { account: state.account, completed: state.completed }); }
        function validate(state, ctx) {
            if (!object(state) || state.version !== 1 || state.account !== ctx.account || state.environment !== ctx.environment ||
                !object(state.plan) || state.plan.account !== ctx.account || !object(state.completed) || !['staged', 'running', 'paused', 'uncertain', 'conflict', 'completed', 'archived'].includes(state.status)) fail('invalid_checkpoint');
            const { digest, ...body } = state;
            if (hash(body) !== digest) fail('corrupt_checkpoint');
            const materialized = work(state);
            if (state.inflight) {
                const batch = materialized.batches.find(b => b.state === 'pending' && b.operation_id === state.inflight.operation_id);
                if (!batch || hash(batch.request) !== hash(state.inflight.request)) fail('invalid_inflight');
            }
            if (state.status === 'conflict') {
                if (!state.inflight) fail('invalid_checkpoint');
                conflictReceipt(state.conflict, state.inflight);
            }
            if (['completed', 'archived'].includes(state.status) && (state.inflight || materialized.blocked.length || materialized.batches.some(b => b.state === 'pending'))) fail('invalid_checkpoint');
            for (const receipt of Object.values(state.completed)) completedReceipt(receipt, state.plan);
            return materialized;
        }
        function completedReceipt(receipt, plan) {
            if (!object(receipt) || receipt.status !== 'completed' || receipt.generation !== plan.generation ||
                !Number.isSafeInteger(receipt.last_sequence) || !Array.isArray(receipt.changes) || receipt.last_sequence < receipt.changes.length) fail('invalid_receipt');
            for (const change of receipt.changes) if (change.revision !== 1 || change.deleted_at !== null ||
                (change.entity === 'payment_settings' ? change.id !== null : !uuid(change.id))) fail('invalid_receipt');
        }
        function conflictReceipt(receipt, batch) {
            if (!object(receipt) || receipt.status !== 'conflict' || receipt.operation_id !== batch.operation_id ||
                !Number.isSafeInteger(receipt.generation) || receipt.generation < 1 || !Number.isSafeInteger(receipt.last_sequence) || receipt.last_sequence < 0 ||
                !['revision_conflict', 'generation_conflict', 'constraint_conflict', 'invalid_data'].includes(receipt.code) ||
                !Array.isArray(receipt.changes) || receipt.changes.length) fail('invalid_receipt');
        }
        function read(ctx) {
            const raw = storage.getItem(key(ctx));
            if (raw === null) return null;
            let state;
            try { state = JSON.parse(raw); } catch (_) { fail('corrupt_checkpoint'); }
            validate(state, ctx);
            return state;
        }
        async function persist(state, ctx, checkToken = true) {
            await guard(ctx, checkToken ? state.plan : null);
            const { digest, ...body } = state;
            state.digest = hash(body);
            validate(state, ctx);
            const serialized = JSON.stringify(state);
            // One atomic storage publication; never touches application data keys.
            storage.setItem(key(ctx), serialized);
            if (storage.getItem(key(ctx)) !== serialized) fail('checkpoint_not_durable');
        }
        function describe(state) {
            if (!state) return null;
            const materialized = work(state);
            return { account: state.account, environment: state.environment, plan_id: state.plan.plan_id, status: state.status,
                completed: Object.keys(state.completed).length, pending: materialized.batches.filter(b => b.state === 'pending').length,
                blocked: clone(materialized.blocked), operation_id: state.inflight?.operation_id ?? null, code: state.code ?? null,
                summary: Object.fromEntries(['ready', 'ignored', 'review'].map(k => [k, state.plan.rows.filter(r => r.disposition === k).length])), warnings: clone(state.plan.warnings),
                records: state.plan.rows.length };
        }
        async function locked(action) {
            const bound = await context();
            // Lock the whole account/environment slot, across tabs and executor instances.
            return locks.request(key(bound), { mode: 'exclusive', ifAvailable: true }, async lock => { if (lock === null) fail('executor_busy'); await guard(bound); return action(bound); });
        }
        async function stage(input) {
            const plan = clone(input);
            return locked(async ctx => {
                if (plan.account !== ctx.account) fail('scope_changed');
                await guard(ctx, plan);
                const materialized = preview.materialize(plan, { account: ctx.account });
                if (plan.version !== 1 || plan.rows.some(r => r.disposition === 'review')) fail('plan_requires_review');
                if (materialized.blocked.some(b => b.reason !== 'awaiting_all_journey_receipts')) fail('plan_blocked');
                const previous = read(ctx);
                if (previous && previous.status !== 'archived') {
                    if (hash(previous.plan) !== hash(plan)) fail('another_plan_exists');
                    return describe(previous);
                }
                const archives = JSON.parse(storage.getItem(key(ctx) + ':archives') || '[]');
                if (archives.some(a => a.input_hash === plan.input_hash)) fail('already_archived');
                const state = { version: 1, account: ctx.account, environment: ctx.environment, plan, completed: {}, inflight: null, status: 'staged' };
                await persist(state, ctx);
                return describe(state);
            });
        }
        async function inspect() {
            // getItem observes one atomic publication. Read-only observers must not
            // contend with the writer lock or lose their reload/progress view.
            const ctx = await context(); await guard(ctx); return describe(read(ctx));
        }
        async function run({ confirmation, onProgress = () => {} } = {}) {
            pauseRequested = false;
            return locked(async ctx => {
                const state = read(ctx);
                if (!state) fail('no_checkpoint');
                await guard(ctx, state.plan);
                if (['conflict', 'completed', 'archived'].includes(state.status)) return describe(state);
                if (confirmation?.confirmed !== true || confirmation.plan_id !== state.plan.plan_id ||
                    confirmation.account !== ctx.account || confirmation.environment !== ctx.environment) fail('explicit_confirmation_required');
                for (;;) {
                    await guard(ctx, state.plan);
                    const materialized = work(state);
                    if (pauseRequested && materialized.batches.some(b => b.state === 'pending')) {
                        state.status = 'paused'; state.code = 'user_paused'; await persist(state, ctx); return describe(state);
                    }
                    const batch = state.inflight || materialized.batches.find(b => b.state === 'pending');
                    if (!batch) {
                        if (materialized.blocked.length) fail('plan_blocked');
                        state.status = 'completed'; state.code = null;
                        await persist(state, ctx);
                        return describe(state);
                    }
                    state.status = 'running'; state.code = null;
                    state.inflight = { operation_id: batch.operation_id, request: clone(batch.request) };
                    await persist(state, ctx); // Must be durable BEFORE network I/O.
                    await onProgress(describe(state));
                    await guard(ctx, state.plan);
                    let receipt;
                    try { receipt = clone(await send(clone(state.inflight), { account: ctx.account, environment: ctx.environment })); }
                    catch (error) {
                        const authError = ['session_required', 'scope_changed'].includes(error.code);
                        state.status = authError ? 'paused' : 'uncertain'; state.code = authError ? error.code : 'transport_error';
                        await persist(state, ctx);
                        return describe(state); // No timer or automatic retries.
                    }
                    await guard(ctx, state.plan);
                    try {
                        if (receipt.status === 'conflict') conflictReceipt(receipt, state.inflight);
                        else {
                            completedReceipt(receipt, state.plan);
                            const next = { ...state.completed, [batch.operation_id]: receipt };
                            // Validates operation_id, exact identities, generation, revisions, UUIDs and dependent batches.
                            preview.materialize(state.plan, { account: ctx.account, completed: next });
                            if (receipt.last_sequence < Math.max(0, ...Object.values(state.completed).map(r => r.last_sequence)) + receipt.changes.length) fail('invalid_receipt');
                        }
                    } catch (_) {
                        state.status = 'uncertain'; state.code = 'invalid_receipt';
                        await persist(state, ctx);
                        return describe(state);
                    }
                    if (receipt.status === 'conflict') {
                        state.status = 'conflict'; state.code = receipt.code; state.conflict = receipt;
                        await persist(state, ctx);
                        return describe(state);
                    }
                    state.completed[batch.operation_id] = receipt;
                    state.inflight = null;
                    await persist(state, ctx);
                    await onProgress(describe(state));
                }
            });
        }
        async function archive() {
            return locked(async ctx => {
                const state = read(ctx);
                if (!state || state.status !== 'completed') fail('only_completed_can_archive');
                const archiveKey = key(ctx) + ':archive:' + state.plan.plan_id;
                const raw = JSON.stringify(state);
                storage.setItem(archiveKey, raw);
                if (storage.getItem(archiveKey) !== raw) fail('checkpoint_not_durable');
                const indexKey = key(ctx) + ':archives';
                const index = JSON.parse(storage.getItem(indexKey) || '[]');
                if (!index.some(a => a.plan_id === state.plan.plan_id)) index.push({ plan_id: state.plan.plan_id, input_hash: state.plan.input_hash, archive_key: archiveKey });
                const serialized = JSON.stringify(index); storage.setItem(indexKey, serialized);
                if (storage.getItem(indexKey) !== serialized) fail('checkpoint_not_durable');
                state.status = 'archived'; await persist(state, ctx, false); return describe(state);
            });
        }
        return { stage, inspect, run, archive, pause() { pauseRequested = true; } };
    }
    function httpTransport({ environment: target, apiKey, getSession, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
        const origin = environment(target);
        if (!apiKey || typeof getSession !== 'function' || typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) fail('invalid_transport');
        return async (batch, bound) => {
            const session = await getSession();
            if (bound.environment !== origin || session?.account !== bound.account || environment(session.environment) !== origin || !session.accessToken) fail('scope_changed');
            const response = await fetchImpl(origin + '/rest/v1/rpc/trailer_sync_write', {
                method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
                headers: { apikey: apiKey, Authorization: 'Bearer ' + session.accessToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({ operation_id: batch.operation_id, request: batch.request })
            });
            if (!response.ok) fail([401, 403].includes(response.status) ? 'session_required' : 'http_error');
            return response.json();
        };
    }
    return { create, httpTransport, environment };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TrailerImportExecutor;
