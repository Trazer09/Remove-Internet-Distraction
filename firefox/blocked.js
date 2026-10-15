/* Blocked-page controller: explains the rule that stopped navigation and offers safe navigation actions. */

(() => {
    'use strict';
    // Use the native extension API available in the current browser.
    const api = globalThis.browser || globalThis.chrome;
    // Support Firefox promise APIs and Chrome callback APIs with one helper.
    function call(owner, method, ...args) { return new Promise((resolve, reject) => { try {
        if (globalThis.browser)
            Promise.resolve(owner[method](...args)).then(resolve, reject);
        else
            owner[method](...args, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r));
    }
    catch (e) {
        reject(e);
    } }); }
    // Display tracked time using the same compact format as the extension badge.
    function fmt(n) { n = Math.max(0, Math.floor(Number(n) || 0)); const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = n % 60; return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`; }
    // Use the browser's local date so daily totals match the user's calendar.
    function localDay() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    const parts = location.search.slice(1).split('&');
    let target = '', domain = '', reason = 'schedule';
    try {
        target = decodeURIComponent(parts[1] || '');
        domain = decodeURIComponent(parts[2] || '');
        reason = decodeURIComponent(parts[3] || 'schedule');
    }
    catch (_) { }
    if (!target) {
        target = '';
        domain = 'Website';
    }
    $('blocked-domain').textContent = domain || (() => { try {
        return new URL(target).hostname;
    }
    catch (_) {
        return 'Website';
    } })();
    $('reason').textContent = reason === 'limit' ? 'Your daily time limit for this website has been reached.' : 'This website is blocked by your current schedule.';
    function $(id) { return document.getElementById(id); }
    $('back').addEventListener('click', () => history.length > 1 ? history.back() : api.tabs.create({ url: api.runtime.getURL('dashboard.html') }));
    $('dashboard').addEventListener('click', () => api.tabs.create({ url: api.runtime.getURL('dashboard.html?tab=dashboard') }));
    // Show the one-per-day defer action only when it is enabled and unused.
    (async () => { try {
        const stored = await call(api.storage.local, 'get', ['rwd_setting_defer_block_v1', 'rwd_block_deferred_v1']);
        const enabled = !!stored.rwd_setting_defer_block_v1;
        const key = localDay(), entries = stored.rwd_block_deferred_v1 || {};
        const alreadyUsed = !!(entries[key] && entries[key][domain]);
        if (enabled && target && !alreadyUsed) {
            $('defer').hidden = false;
            $('defer').addEventListener('click', async () => { const latest = await call(api.storage.local, 'get', ['rwd_block_deferred_v1']); const data = latest.rwd_block_deferred_v1 || {}; if (!data[key])
                data[key] = {}; if (data[key][domain]) {
                $('defer').disabled = true;
                $('defer').textContent = 'Already used today';
                return;
            } data[key][domain] = { expiresAt: Date.now() + 5 * 60 * 1000, usedAt: Date.now() }; await call(api.storage.local, 'set', { 'rwd_block_deferred_v1': data }); const current = await call(api.tabs, 'getCurrent').catch(() => null); if (current && current.id != null)
                await call(api.tabs, 'update', current.id, { url: target });
            else
                location.href = target; });
        }
    }
    catch (_) { } })();
    // Read today's stored tracking totals for the blocked domain and all sites.
    (async () => { try {
        const obj = await call(api.storage.local, 'get', ['rwd_website_time_daily_v3']);
        const data = obj.rwd_website_time_daily_v3 || {}, today = data[localDay()] || {};
        const total = Object.values(today).reduce((n, x) => n + Number(x || 0), 0);
        let seconds = 0;
        try {
            const host = new URL(target).hostname.replace(/^www\./, '').toLowerCase();
            seconds = Number(today[host] || 0);
        }
        catch (_) { }
        $('site-time').textContent = fmt(seconds);
        $('day-time').textContent = fmt(total);
    }
    catch (_) {
        $('site-time').textContent = 'Unavailable';
        $('day-time').textContent = 'Unavailable';
    } })();
})();
