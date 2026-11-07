/* Uses the existing account-scoped storage and daily synchronization queue. */
(() => {
    const el = id => document.getElementById(id);
    let current = null, busy = false, dirty = false;
    el("settingsRate").addEventListener("input", () => { dirty = true; });
    TrailerStorage.subscribe(snapshot => {
        current = snapshot;
        if (!dirty) el("settingsRate").value = ((snapshot.data.paymentSettings?.rateCents ?? TrailerPay.DEFAULT_RATE) / 100).toFixed(2);
    }, error => { el("settingsRateStatus").textContent = error.message; });
    el("settingsRateForm").addEventListener("submit", async event => {
        event.preventDefault(); if (busy) return;
        try {
            const raw = el("settingsRate").value;
            if (!raw.trim() || !current) throw Error(PaycheckUI.t("invalid"));
            const dollars = TrailerPay.miles(Number(raw));
            const rateCents = TrailerPay.newRate(Math.round(dollars * 100));
            const token = current.token;
            busy = true; el("settingsSaveRate").disabled = true;
            await TrailerStorage.change(data => {
                data.paymentSettings = { ...(data.paymentSettings || {}), rateCents };
            }, token);
            dirty = false;
            el("settingsRate").value = (rateCents / 100).toFixed(2);
            el("settingsRateStatus").textContent = PaycheckUI.t("rateSaved");
        } catch (error) { el("settingsRateStatus").textContent = error.message; }
        finally { busy = false; el("settingsSaveRate").disabled = false; }
    });
})();
