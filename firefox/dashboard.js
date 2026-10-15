/* Dashboard controller: statistics, usage chart, blocking rules, notifications, exports, and settings. */

(() => {
    // Dashboard controller: rendering, filters, rules, notifications, data export, and settings.
    'use strict';
    const api = globalThis.browser || globalThis.chrome;
    const $ = id => document.getElementById(id);
    const TRACKING_EXCLUDED_KEY = 'rwd_tracking_excluded_sites_v1', DATA_KEY = 'rwd_website_time_daily_v3', SESSIONS_KEY = 'rwd_website_time_sessions_v1', RULES_KEY = 'rwd_block_rules_v1', WHITELIST_KEY = 'rwd_block_whitelist_v1', BLOCK_STATS_KEY = 'rwd_block_stats_v1', THEME_KEY = 'ui_theme', DAILY_NOTIFICATION_KEY = 'rwd_daily_summary_notification_v1', DAILY_NOTIFICATION_TIME_KEY = 'rwd_daily_summary_time_v1', SITE_NOTIFICATIONS_KEY = 'rwd_site_notifications_v1', NOTIFICATION_MESSAGE_KEY = 'rwd_notification_message_v1';
    let report = null, rules = [], blockStats = {}, dailyData = {}, sessionData = {};
    /** Promise wrapper for Chrome callback APIs and Firefox promise APIs. */
    function call(owner, method, ...args) { return new Promise((resolve, reject) => { try {
        if (globalThis.browser)
            Promise.resolve(owner[method](...args)).then(resolve, reject);
        else
            owner[method](...args, result => { const e = chrome.runtime.lastError; e ? reject(new Error(e.message)) : resolve(result); });
    }
    catch (e) {
        reject(e);
    } }); }
    /** Send a best-effort message to the background tracker. */
    function send(message) { return new Promise(resolve => { try {
        if (globalThis.browser)
            api.runtime.sendMessage(message).then(resolve).catch(() => resolve(null));
        else
            api.runtime.sendMessage(message, r => resolve(chrome.runtime.lastError ? null : r || null));
    }
    catch (_) {
        resolve(null);
    } }); }
    /** Format tracked seconds as a compact human-readable duration. */
    function fmt(n) { n = Math.max(0, Math.floor(Number(n) || 0)); const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = n % 60; return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`; }
    /** Return a local-calendar date key (YYYY-MM-DD), not a UTC date. */
    function localDay(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    /** Apply the selected dashboard theme and synchronize its control. */
    function theme(value) { document.body.dataset.theme = value; $('theme').textContent = value === 'dark' ? '☀ Light mode' : '☾ Dark mode'; const check = $('setting-dark'); if (check)
        check.checked = value === 'dark'; }
    /** Derive a stable display color for a domain across dashboard renders. */
    function siteColor(domain) { let hash = 2166136261; for (let i = 0; i < domain.length; i++) {
        hash ^= domain.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    } const hue = (hash >>> 0) % 360; return `hsl(${hue} 84% 48%)`; }
    function favicon(domain) { if (domain === 'Others') {
        const mark = document.createElement('span');
        mark.className = 'favicon favicon-others';
        mark.textContent = '…';
        return mark;
    } const img = document.createElement('img'); img.className = 'favicon'; img.alt = ''; img.src = globalThis.browser ? `page-icon:https://${domain}/` : `chrome://favicon/size/32@2x/https://${domain}/`; img.onerror = () => { img.style.display = 'none'; }; return img; }
    /** Render summary cards and per-site statistics for the selected date range. */
    function renderStats() { const today = report?.sites || [], allTimeSites = report?.allSites || []; const from = $('chart-from')?.value || '0000-01-01', to = $('chart-to')?.value || '9999-12-31'; const rangeTotals = {}, rangeSessions = {}; Object.entries(dailyData).forEach(([day, domains]) => { if (day < from || day > to)
        return; Object.entries(domains || {}).forEach(([domain, seconds]) => rangeTotals[domain] = (rangeTotals[domain] || 0) + Number(seconds || 0)); Object.entries(sessionData[day] || {}).forEach(([domain, count]) => rangeSessions[domain] = (rangeSessions[domain] || 0) + Number(count || 0)); }); const all = Object.entries(rangeTotals).map(([domain, seconds]) => ({ domain, seconds, sessions: rangeSessions[domain] || 0 })); const todaySeconds = report?.totalSeconds || 0; $('today-total').textContent = fmt(todaySeconds); $('all-total').textContent = fmt(report?.allTimeSeconds || 0); $('site-count').textContent = allTimeSites.length; const todayBlocks = blockStats[localDay()] || {}; $('blocked-count').textContent = Object.values(todayBlocks).reduce((n, x) => n + Number(x.attempts || 0), 0); const list = $('stats-list'); list.replaceChildren(); let sorted = $('stat-sort').value === 'name' ? [...all].sort((a, b) => a.domain.localeCompare(b.domain)) : $('stat-sort').value === 'sessions' ? [...all].sort((a, b) => b.sessions - a.sessions || b.seconds - a.seconds) : [...all].sort((a, b) => b.seconds - a.seconds); const limit = $('stat-limit').value; const count = limit === 'all' ? sorted.length : Number(limit); let sites = sorted.slice(0, count).map(s => ({ ...s })); if (sorted.length > count) {
        const rest = sorted.slice(count);
        sites.push({ domain: 'Others', seconds: rest.reduce((n, x) => n + Number(x.seconds || 0), 0), sessions: rest.reduce((n, x) => n + Number(x.sessions || 0), 0), isAggregate: true, domainCount: rest.length });
    } $('stat-summary').textContent = limit === 'all' ? `Showing all ${all.length} websites.` : `Showing ${Math.min(count, sorted.length)} ${count === 1 ? 'website' : 'websites'}${sorted.length > count ? ` and grouping ${sorted.length - count} remaining websites as Others.` : ''}`; const max = Math.max(1, ...sites.map(x => x.seconds)); if (!all.length) {
        list.textContent = 'No tracked website data yet. Browse a few websites and refresh this dashboard.';
    } sites.forEach(s => { const row = document.createElement('div'); row.className = 'site-row'; const id = document.createElement('div'); id.className = 'site-id'; id.append(favicon(s.domain)); const name = document.createElement('span'); name.className = 'site-name'; name.textContent = s.isAggregate ? `Others (${s.domainCount} websites)` : s.domain; id.append(name); const bar = document.createElement('div'); bar.className = 'site-bar site-bar-cell'; const fill = document.createElement('span'); fill.style.width = `${s.seconds / max * 100}%`; fill.style.background = s.isAggregate ? '#64748b' : siteColor(s.domain); bar.append(fill); const time = document.createElement('strong'); time.className = 'right'; time.textContent = fmt(s.seconds); const sessions = document.createElement('span'); sessions.className = 'right sessions-cell'; sessions.textContent = `${s.sessions || 0} sessions`; row.append(id, bar, time, sessions); list.append(row); }); renderBlocked(); renderUsageChart(); }
    /** Render today's recorded blocking attempts and their reasons. */
    function renderBlocked() { const wrap = $('blocked-activity-overview'); wrap.replaceChildren(); const today = blockStats[localDay()] || {}; const entries = Object.entries(today).sort((a, b) => b[1].attempts - a[1].attempts); if (!entries.length) {
        wrap.textContent = 'No blocking attempts recorded today.';
        return;
    } entries.forEach(([domain, data]) => { const row = document.createElement('div'); row.className = 'blocked-row'; const name = document.createElement('strong'); name.textContent = domain; const count = document.createElement('span'); count.className = 'muted'; count.textContent = `${data.attempts || 0} redirects · ${data.schedule || 0} scheduled · ${data.limit || 0} time-limit`; row.append(name, count); wrap.append(row); }); }
    /** Normalize old and new blocking-rule shapes for backwards compatibility. */
    function methodFlags(r) { const days = Array.isArray(r.days) ? r.days : [0, 1, 2, 3, 4, 5, 6]; const hasLimit = Number(r.dailyLimitMinutes || 0) > 0; const legacySchedule = String(r.startTime || '00:00') !== String(r.endTime || '00:00') || days.length !== 7; if (r.scheduleEnabled === undefined)
        r.scheduleEnabled = legacySchedule || (!hasLimit && String(r.startTime || '00:00') === String(r.endTime || '00:00')); if (r.limitEnabled === undefined)
        r.limitEnabled = hasLimit; return { scheduleEnabled: !!r.scheduleEnabled, limitEnabled: !!r.limitEnabled }; }
    /** Turn a saved blocking rule into a short human-readable summary. */
    function describeRule(r) { const f = methodFlags(r), parts = []; if (f.scheduleEnabled) {
        const days = (r.days || []).length === 7 ? 'Every day' : (r.days || []).map(n => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][n]).join(', ') || 'No days';
        parts.push(`Schedule: ${days}, ${r.startTime}–${r.endTime}`);
    } if (f.limitEnabled)
        parts.push(`Daily limit: ${r.dailyLimitMinutes} min`); return parts.join(' · ') || 'No blocking method enabled'; }
    /** Enable or disable schedule and daily-limit inputs from their checkboxes. */
    function syncMethodFields() { const schedule = $('rule-schedule-enabled').checked, limit = $('rule-limit-enabled').checked; ['rule-start', 'rule-end'].forEach(id => $(id).disabled = !schedule); document.querySelectorAll('input[name="day"]').forEach(x => x.disabled = !schedule); $('rule-limit').disabled = !limit; }
    /** Render saved website-blocking rules in the Limits & schedules page. */
    function renderRules() { const wrap = $('rules-list'); wrap.replaceChildren(); if (!rules.length) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No blocking rules yet. Add a domain above to start.';
        wrap.append(p);
        return;
    } rules.forEach((rule, index) => { const row = document.createElement('div'); row.className = 'rule-row'; const info = document.createElement('div'); const domain = document.createElement('div'); domain.className = 'rule-domain'; domain.textContent = (rule.patterns || [rule.domain]).join(' · '); domain.title = (rule.patterns || [rule.domain]).join('\n') + (rule.regex ? ' (regular expressions)' : ''); const meta = document.createElement('div'); meta.className = 'rule-meta'; meta.textContent = describeRule(rule); info.append(domain, meta); const status = document.createElement('label'); status.className = 'checkline'; const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = !!rule.enabled; toggle.addEventListener('change', () => { rules[index].enabled = toggle.checked; saveRules(); }); status.append(toggle, document.createTextNode(rule.enabled ? 'Enabled' : 'Disabled')); const actions = document.createElement('div'); actions.className = 'rule-actions'; const del = document.createElement('button'); del.className = 'delete'; del.textContent = 'Delete'; del.addEventListener('click', () => { rules.splice(index, 1); saveRules(); }); actions.append(del); row.append(info, status, actions); wrap.append(row); }); }
    /** Persist blocking rules and refresh their visible list. */
    async function saveRules() { await call(api.storage.local, 'set', { [RULES_KEY]: rules }); renderRules(); }
    /** Validate and save patterns that bypass website blocking. */
    async function saveWhitelist() { const patterns = $('whitelist-patterns').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); await call(api.storage.local, 'set', { [WHITELIST_KEY]: patterns }); $('whitelist-patterns').value = patterns.join('\n'); const b = $('save-whitelist'); b.textContent = 'Saved'; setTimeout(() => b.textContent = 'Save whitelist', 1200); }
    /** Save sites excluded from time tracking (separate from the blocking whitelist). */
    async function saveTrackingExclusions() { const patterns = $('tracking-excluded-patterns').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); const invalid = patterns.find(x => /\s/.test(x) || x.length > 2048); if (invalid) {
        alert('Enter one domain or URL pattern per line, without spaces.');
        return;
    } await call(api.storage.local, 'set', { [TRACKING_EXCLUDED_KEY]: patterns }); $('tracking-excluded-patterns').value = patterns.join('\n'); const b = $('save-tracking-exclusions'); b.textContent = 'Saved'; setTimeout(() => b.textContent = 'Save tracking exclusions', 1200); }
    /** Reload tracker reports and persisted dashboard data from extension storage. */
    async function refresh() { const [r, raw, ses, block] = await Promise.all([send({ type: 'GET_WEBSITE_TIME' }), call(api.storage.local, 'get', [DATA_KEY]).catch(() => ({})), call(api.storage.local, 'get', [SESSIONS_KEY]).catch(() => ({})), call(api.storage.local, 'get', [BLOCK_STATS_KEY]).catch(() => ({}))]); if (r)
        report = r; const daily = (raw && raw[DATA_KEY]) || {}; dailyData = daily; const sessions = (ses && ses[SESSIONS_KEY]) || {}; sessionData = sessions; if (report) {
        const agg = {};
        Object.entries(daily).forEach(([day, domains]) => Object.entries(domains || {}).forEach(([domain, sec]) => { agg[domain] = (agg[domain] || 0) + Number(sec || 0); }));
        report.allSites = Object.entries(agg).map(([domain, seconds]) => ({ domain, seconds, sessions: Object.values(sessions).reduce((n, day) => n + Number(day?.[domain] || 0), 0) }));
        report.allTimeSeconds = Object.values(agg).reduce((a, b) => a + b, 0);
        report.days = Object.entries(daily).map(([day, domains]) => ({ day, seconds: Object.values(domains || {}).reduce((a, b) => a + Number(b || 0), 0) })).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30);
        report.sites = (daily[localDay()] ? Object.entries(daily[localDay()]).map(([domain, seconds]) => ({ domain, seconds, sessions: Number(sessions[localDay()]?.[domain] || 0) })) : []);
        report.totalSeconds = report.sites.reduce((n, x) => n + x.seconds, 0);
        report.day = localDay();
    } blockStats = (block && block[BLOCK_STATS_KEY]) || {}; renderStats(); }
    $('rule-form').addEventListener('submit', async (e) => { e.preventDefault(); const patterns = $('rule-domain').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); if (!patterns.length)
        return; const scheduleEnabled = $('rule-schedule-enabled').checked, limitEnabled = $('rule-limit-enabled').checked; if (!scheduleEnabled && !limitEnabled) {
        alert('Enable Schedule blocking, Daily time-limit blocking, or both before adding this rule.');
        return;
    } const regex = $('rule-regex').checked; if (regex) {
        try {
            patterns.forEach(p => { const clean = p.replace(/^[+>~]/, ''); new RegExp(clean, 'i'); });
        }
        catch (_) {
            alert('One of the patterns is not a valid regular expression.');
            return;
        }
    }
    else {
        const bad = patterns.find(p => { const clean = p.replace(/^[+>~]/, ''); return !clean || !/^[a-z0-9*._:/?=&%#\-\s]+$/i.test(clean); });
        if (bad) {
            alert('Check this pattern: ' + bad + '\nUse a domain or URL pattern with letters, numbers, dots, hyphens, slashes, and * wildcards.');
            return;
        }
    } const days = [...document.querySelectorAll('input[name="day"]:checked')].map(x => Number(x.value)); if (scheduleEnabled && !days.length) {
        alert('Select at least one day for schedule blocking.');
        return;
    } const limit = Number($('rule-limit').value) || 0; if (limitEnabled && (!Number.isFinite(limit) || limit < 1 || limit > 1440)) {
        alert('Set a daily time limit between 1 and 1440 minutes.');
        return;
    } rules.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), domain: patterns[0], patterns, regex, enabled: $('rule-enabled').checked, scheduleEnabled, limitEnabled, days: scheduleEnabled ? days : [0, 1, 2, 3, 4, 5, 6], startTime: $('rule-start').value || '09:00', endTime: $('rule-end').value || '17:00', dailyLimitMinutes: limitEnabled ? limit : 0 }); await saveRules(); $('rule-domain').value = ''; $('rule-regex').checked = false; $('rule-schedule-enabled').checked = false; $('rule-limit-enabled').checked = false; syncMethodFields(); });
    /** Add calendar days without mutating the supplied Date object. */
    function dateAdd(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
    /** Convert a date to the same local YYYY-MM-DD format used by storage. */
    function isoDate(d) { return localDay(d); }
    /** Apply the selected quick date range to the usage chart filters. */
    function applyChartPeriod() { const preset = $('chart-period').value; const today = new Date(); let from, to = isoDate(today); if (preset === 'today')
        from = to;
    else if (preset === 'week') {
        const day = today.getDay();
        const sunday = dateAdd(today, -day);
        from = isoDate(sunday);
    }
    else if (preset === '7')
        from = isoDate(dateAdd(today, -6));
    else if (preset === '30')
        from = isoDate(dateAdd(today, -29));
    else {
        from = $('chart-from').value || isoDate(dateAdd(today, -6));
        to = $('chart-to').value || isoDate(today);
    } $('chart-from').value = from; $('chart-to').value = to; }
    /** Build the stacked daily usage chart, axis, domain selector, legend and hover tooltip. */
    function renderUsageChart() {
        const host = $('usage-chart');
        if (!host)
            return;
        host.replaceChildren();
        let hoverTip = document.getElementById('usage-chart-tooltip');
        if (!hoverTip) {
            hoverTip = document.createElement('div');
            hoverTip.id = 'usage-chart-tooltip';
            hoverTip.className = 'chart-hover-tooltip dashboard-chart-tooltip';
            hoverTip.hidden = true;
            document.body.append(hoverTip);
        }
        const from = $('chart-from').value || isoDate(dateAdd(new Date(), -6)), to = $('chart-to').value || isoDate(new Date());
        if (from > to) {
            host.textContent = 'Choose a valid date range.';
            return;
        }
        const days = [];
        let cursor = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
        for (let n = 0; cursor <= end && n < 93; n++, cursor = dateAdd(cursor, 1)) {
            const day = isoDate(cursor);
            const values = dailyData[day] || {};
            days.push({ day, values, total: Object.values(values).reduce((a, b) => a + Math.max(0, Number(b) || 0), 0) });
        }
        const domainTotals = {};
        days.forEach(d => Object.entries(d.values).forEach(([domain, seconds]) => domainTotals[domain] = (domainTotals[domain] || 0) + Math.max(0, Number(seconds) || 0)));
        const domainSelect = $('chart-domain'), chosen = domainSelect.value || 'all', topValue = $('chart-top').value, topCount = topValue === 'all' ? Object.keys(domainTotals).length : Number(topValue);
        const sorted = Object.keys(domainTotals).sort((a, b) => domainTotals[b] - domainTotals[a]);
        const visible = chosen !== 'all' ? [chosen] : sorted.slice(0, topCount);
        const restDomains = chosen !== 'all' ? [] : sorted.slice(topCount);
        const showOthers = $('show-others').checked;
        const series = visible.filter(d => Object.prototype.hasOwnProperty.call(domainTotals, d)).map(domain => ({ domain, color: siteColor(domain) }));
        if (showOthers && restDomains.length)
            series.push({ domain: 'Others', color: '#cbd5e1', others: restDomains });
        // Keep the domain selector synchronized with currently recorded domains.
        const previous = domainSelect.value;
        const opts = [['all', 'From all domains'], ...sorted.map(d => [d, d])];
        if (domainSelect.options.length !== opts.length || [...domainSelect.options].some((o, i) => !opts[i] || o.value !== opts[i][0])) {
            domainSelect.replaceChildren();
            opts.forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; domainSelect.append(o); });
            domainSelect.value = opts.some(x => x[0] === previous) ? previous : 'all';
        }
        const filteredSeries = chosen !== 'all' ? [{ domain: chosen, color: siteColor(chosen) }] : series;
        const totals = days.map(day => filteredSeries.reduce((sum, ser) => sum + (ser.others ? ser.others.reduce((n, d) => n + Number(day.values[d] || 0), 0) : Number(day.values[ser.domain] || 0)), 0));
        const max = Math.max(3600, Math.ceil(Math.max(0, ...totals) / 3600) * 3600);
        const chart = document.createElement('div');
        chart.className = 'stacked-chart';
        const axis = document.createElement('div');
        axis.className = 'chart-axis';
        [4, 3, 2, 1, 0].forEach(step => { const label = document.createElement('span'); const hours = (max / 3600) * (step / 4); const value = Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2))); label.textContent = `${value} hr`; axis.append(label); });
        chart.append(axis);
        const plot = document.createElement('div');
        plot.className = 'chart-plot';
        const dataArea = document.createElement('div');
        dataArea.className = 'chart-data-area';
        [0, 25, 50, 75, 100].forEach(pos => { const line = document.createElement('span'); line.className = 'chart-gridline'; line.style.bottom = `${pos}%`; dataArea.append(line); });
        const columns = document.createElement('div');
        columns.className = 'chart-columns';
        days.forEach(day => { const col = document.createElement('div'); col.className = 'chart-column'; col.title = `${day.day}: ${fmt(day.total)}`; const stack = document.createElement('div'); stack.className = 'chart-stack'; const pieces = filteredSeries.map(ser => ({ ser, sec: ser.others ? ser.others.reduce((n, d) => n + Number(day.values[d] || 0), 0) : Number(day.values[ser.domain] || 0) })).filter(piece => piece.sec > 0); const visibleTotal = pieces.reduce((sum, piece) => sum + piece.sec, 0); pieces.forEach(({ ser, sec }) => { const segment = document.createElement('span'); segment.className = 'chart-segment'; segment.dataset.domain = ser.domain; segment.style.height = `${sec / Math.max(1, visibleTotal) * 100}%`; segment.style.background = ser.color; segment.title = `${ser.domain}: ${fmt(sec)}`; segment.tabIndex = 0; segment.setAttribute('aria-label', `${ser.domain}, ${fmt(sec)}, ${day.total > 0 ? (sec / day.total * 100).toFixed(2) : '0.00'} percent of daily usage`); const showSegmentTip = (event) => { const pct = day.total > 0 ? sec / day.total * 100 : 0; hoverTip.textContent = `${ser.domain} · ${fmt(sec)} · ${pct.toFixed(2)}% of ${fmt(day.total)}`; hoverTip.hidden = false; const x = event.clientX ?? (segment.getBoundingClientRect().left + segment.getBoundingClientRect().width / 2), y = event.clientY ?? segment.getBoundingClientRect().top; hoverTip.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - hoverTip.offsetWidth - 8))}px`; hoverTip.style.top = `${Math.max(8, Math.min(y + 12, window.innerHeight - hoverTip.offsetHeight - 8))}px`; const siblings = stack.querySelectorAll('.chart-segment'); siblings.forEach(sib => { sib.style.opacity = sib === segment ? '1' : '0.18'; sib.style.filter = sib === segment ? 'brightness(1.12)' : 'none'; }); segment.style.outline = '2px solid var(--text)'; segment.style.outlineOffset = '-2px'; }; const hideSegmentTip = () => { hoverTip.hidden = true; stack.querySelectorAll('.chart-segment').forEach(sib => { sib.style.opacity = '1'; sib.style.filter = 'none'; sib.style.outline = 'none'; }); }; segment.addEventListener('pointerenter', showSegmentTip); segment.addEventListener('pointermove', showSegmentTip); segment.addEventListener('pointerleave', hideSegmentTip); segment.addEventListener('focus', showSegmentTip); segment.addEventListener('blur', hideSegmentTip); stack.append(segment); }); stack.style.height = `${Math.min(100, visibleTotal / max * 100)}%`; const label = document.createElement('span'); label.className = 'chart-day-label'; label.textContent = new Date(day.day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); col.append(stack, label); columns.append(col); });
        dataArea.append(columns);
        plot.append(dataArea);
        chart.append(plot);
        host.append(chart);
        $('chart-range-summary').textContent = `${from} to ${to} · ${days.length} days · ${fmt(totals.reduce((a, b) => a + b, 0))} shown`;
        const legend = $('chart-legend');
        legend.replaceChildren();
        filteredSeries.forEach(ser => { const item = document.createElement('label'); item.className = 'legend-item'; const swatch = document.createElement('span'); swatch.style.background = ser.color; const check = document.createElement('input'); check.type = 'checkbox'; check.checked = true; check.addEventListener('change', () => { item.classList.toggle('legend-muted', !check.checked); const segments = host.querySelectorAll('.chart-segment'); segments.forEach(seg => { if (seg.dataset.domain === ser.domain)
            seg.style.opacity = check.checked ? '1' : '0.08'; }); }); item.append(swatch, document.createTextNode(ser.domain), check); legend.append(item); });
        if (chosen === 'all' && restDomains.length && !showOthers) {
            const note = document.createElement('span');
            note.className = 'muted';
            note.textContent = `${restDomains.length} other websites hidden`;
            legend.append(note);
        }
        $('stat-summary').textContent = $('stat-limit').value === 'all' ? `Showing all ${report?.allSites?.length || 0} websites.` : `Website list: top ${$('stat-limit').value}, with remaining websites grouped as Others.`;
    }
    /** Render per-site notification rules in the Notifications page. */
    function renderSiteNotifications(list) { const wrap = $('site-notification-list'); wrap.replaceChildren(); if (!list.length) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No website notifications configured.';
        wrap.append(p);
        return;
    } list.forEach((item, index) => { const row = document.createElement('div'); row.className = 'notification-row'; const name = document.createElement('strong'); name.textContent = item.domain; const interval = document.createElement('span'); interval.className = 'muted'; interval.textContent = `Every ${fmt(item.intervalSeconds)}`; const del = document.createElement('button'); del.className = 'button secondary'; del.type = 'button'; del.textContent = 'Remove'; del.addEventListener('click', async () => { list.splice(index, 1); await call(api.storage.local, 'set', { [SITE_NOTIFICATIONS_KEY]: list }); renderSiteNotifications(list); }); row.append(name, interval, del); wrap.append(row); }); }
    /** Load notification preferences and their saved per-site rules. */
    async function loadNotifications() { const stored = await call(api.storage.local, 'get', [DAILY_NOTIFICATION_KEY, DAILY_NOTIFICATION_TIME_KEY, SITE_NOTIFICATIONS_KEY, NOTIFICATION_MESSAGE_KEY]); if (stored[DAILY_NOTIFICATION_KEY] === undefined)
        await call(api.storage.local, 'set', { [DAILY_NOTIFICATION_KEY]: true }); if (stored[DAILY_NOTIFICATION_TIME_KEY] === undefined)
        await call(api.storage.local, 'set', { [DAILY_NOTIFICATION_TIME_KEY]: '20:00' }); if (stored[NOTIFICATION_MESSAGE_KEY] === undefined)
        await call(api.storage.local, 'set', { [NOTIFICATION_MESSAGE_KEY]: 'You have spent a lot of time on this site' }); $('notification-daily-enabled').checked = stored[DAILY_NOTIFICATION_KEY] !== false; $('notification-daily-time').value = stored[DAILY_NOTIFICATION_TIME_KEY] || '20:00'; $('notification-message').value = stored[NOTIFICATION_MESSAGE_KEY] || 'You have spent a lot of time on this site'; renderSiteNotifications(Array.isArray(stored[SITE_NOTIFICATIONS_KEY]) ? stored[SITE_NOTIFICATIONS_KEY] : []); }
    /** Connect notification controls to their persistent settings. */
    function bindNotifications() { $('notification-daily-enabled').addEventListener('change', e => call(api.storage.local, 'set', { [DAILY_NOTIFICATION_KEY]: e.target.checked })); $('notification-daily-time').addEventListener('change', e => call(api.storage.local, 'set', { [DAILY_NOTIFICATION_TIME_KEY]: e.target.value })); $('site-notification-form').addEventListener('submit', async (e) => { e.preventDefault(); const domain = $('notification-domain').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, ''); if (!/^[a-z0-9.-]+$/i.test(domain)) {
        alert('Enter a valid website domain, such as reddit.com.');
        return;
    } const stored = await call(api.storage.local, 'get', [SITE_NOTIFICATIONS_KEY]); const list = Array.isArray(stored[SITE_NOTIFICATIONS_KEY]) ? stored[SITE_NOTIFICATIONS_KEY] : []; const intervalText = String($('notification-interval').value || '00:30').trim(); const intervalMatch = intervalText.match(/^(\d{1,3}):([0-5]\d)$/); if (!intervalMatch) {
        alert('Enter a duration as HH:MM, for example 00:30 for 30 minutes.');
        return;
    } const intervalSeconds = (Number(intervalMatch[1]) * 3600) + (Number(intervalMatch[2]) * 60); if (intervalSeconds < 60) {
        alert('The reminder interval must be at least one minute.');
        return;
    } const item = { domain, intervalSeconds }; const existing = list.findIndex(x => String(x.domain).toLowerCase() === domain); if (existing >= 0)
        list[existing] = item;
    else
        list.push(item); await call(api.storage.local, 'set', { [SITE_NOTIFICATIONS_KEY]: list }); $('notification-domain').value = ''; renderSiteNotifications(list); $('notification-status').textContent = 'Website notification saved.'; }); $('save-notification-message').addEventListener('click', async () => { const message = $('notification-message').value.trim(); if (!message) {
        $('notification-status').textContent = 'Enter a notification message first.';
        return;
    } await call(api.storage.local, 'set', { [NOTIFICATION_MESSAGE_KEY]: message }); $('notification-status').textContent = 'Notification message saved.'; }); }
    /** Select the dashboard section requested by the navigation or URL. */
    function activatePage() { const allowed = ['dashboard', 'statistics', 'whitelist', 'limits', 'notifications', 'settings']; const requested = new URLSearchParams(location.search).get('tab') || 'dashboard'; const current = allowed.includes(requested) ? requested : 'dashboard'; document.querySelectorAll('[data-page]').forEach(el => el.classList.toggle('page-active', el.dataset.page === current)); document.querySelectorAll('.nav-link[data-page]').forEach(link => { const active = link.dataset.page === current; link.classList.toggle('active', active); if (active)
        link.setAttribute('aria-current', 'page');
    else
        link.removeAttribute('aria-current'); }); const titles = { dashboard: 'Dashboard', statistics: 'Website Statistics', whitelist: 'Whitelist', limits: 'Limits & schedules', notifications: 'Notifications', settings: 'Settings' }; document.title = `Remove Internet Distraction — ${titles[current]}`; const h = document.querySelector('.top-title h1'); if (h)
        h.textContent = titles[current]; const eyebrow = document.querySelector('.top-title .eyebrow'); if (eyebrow)
        eyebrow.textContent = 'REMOVE INTERNET DISTRACTION'; }
    /** Show a short status message after settings and data operations. */
    function status(message) { const el = $('settings-status'); if (el)
        el.textContent = message; }
    /** Trigger a local browser download without sending data to a server. */
    function downloadBlob(filename, content, type) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    /** Escape a value for safe inclusion in a CSV file. */
    function csvCell(value) { const s = String(value ?? ''); return '"' + s.replace(/"/g, '""') + '"'; }
    /** Export the selected date range of website usage as CSV. */
    async function exportCsv() { const from = $('export-from').value, to = $('export-to').value; if (!from || !to || from > to) {
        status('Choose a valid date range.');
        return;
    } const [raw, ses] = await Promise.all([call(api.storage.local, 'get', [DATA_KEY]), call(api.storage.local, 'get', [SESSIONS_KEY])]); const daily = raw[DATA_KEY] || {}, sessions = ses[SESSIONS_KEY] || {}; const rows = [['Date', 'Website', 'Time (seconds)', 'Sessions']]; Object.keys(daily).filter(day => day >= from && day <= to).sort().forEach(day => Object.entries(daily[day] || {}).sort((a, b) => b[1] - a[1]).forEach(([domain, seconds]) => rows.push([day, domain, Math.floor(Number(seconds) || 0), Number(sessions[day]?.[domain] || 0)]))); downloadBlob(`website-activity-${from}-to-${to}.csv`, '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8'); status(`Exported ${Math.max(0, rows.length - 1)} records to CSV.`); }
    /** Export locally stored extension data to a JSON backup file. */
    async function backupData() { const all = await call(api.storage.local, 'get', null); downloadBlob(`remove-internet-distraction-backup-${localDay()}.json`, JSON.stringify({ format: 'remove-internet-distraction-backup', version: 1, createdAt: new Date().toISOString(), data: all }, null, 2), 'application/json'); status('Backup downloaded.'); }
    /** Validate and restore a previously exported JSON backup. */
    async function restoreData(file) { try {
        const parsed = JSON.parse(await file.text());
        const data = parsed?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data))
            throw new Error('This file is not a valid extension backup.');
        if (!confirm('Restore this backup? Existing extension data with matching keys will be replaced.'))
            return;
        await call(api.storage.local, 'set', data);
        status('Backup restored. Reloading dashboard…');
        setTimeout(() => location.reload(), 400);
    }
    catch (e) {
        status(e.message || 'Could not restore this backup.');
    } }
    /** Remove tracking history and blocking activity after explicit confirmation. */
    async function removeAllData() { if (!confirm('Delete all tracked website time and blocking activity? Your blocking rules, whitelist, and preferences will be kept.'))
        return; const result = await send({ type: 'CLEAR_WEBSITE_TIME' }); await call(api.storage.local, 'remove', [BLOCK_STATS_KEY]).catch(() => { }); if (result?.ok) {
        blockStats = {};
        await refresh();
        status('Tracked statistics and blocking activity removed.');
    }
    else
        status('Could not clear tracking data. Try again.'); }
    /** Load saved extension settings into the Settings controls. */
    async function loadSettings() { const v = await call(api.storage.local, 'get', ['rwd_setting_badge_enabled_v1', 'rwd_setting_defer_block_v1', 'rwd_setting_idle_seconds_v1', THEME_KEY]); $('setting-badge').checked = v['rwd_setting_badge_enabled_v1'] !== false; $('setting-defer').checked = !!v['rwd_setting_defer_block_v1']; const idle = Number(v['rwd_setting_idle_seconds_v1'] ?? 300), known = [15, 30, 60, 120, 300, 0]; if (known.includes(idle))
        $('setting-idle').value = String(idle);
    else {
        $('setting-idle').value = 'custom';
        $('setting-idle-custom').value = String(Math.max(1, Math.min(86400, idle || 45)));
    } $('setting-idle-custom').hidden = $('setting-idle').value !== 'custom'; $('setting-dark').checked = v[THEME_KEY] === 'dark'; await loadNotifications(); }
    /** Bind settings controls and persist changes as the user makes them. */
    function bindSettings() { const save = async (key, value) => { await call(api.storage.local, 'set', { [key]: value }); status('Settings saved.'); }; const saveIdle = () => { const mode = $('setting-idle').value; const raw = mode === 'custom' ? Number($('setting-idle-custom').value) : Number(mode); if (mode === 'custom' && (!Number.isFinite(raw) || raw < 1 || raw > 86400)) {
        status('Enter a custom duration from 1 to 86400 seconds.');
        return;
    } save('rwd_setting_idle_seconds_v1', Math.floor(raw)); }; $('setting-badge').addEventListener('change', e => save('rwd_setting_badge_enabled_v1', e.target.checked)); $('setting-defer').addEventListener('change', e => save('rwd_setting_defer_block_v1', e.target.checked)); $('setting-idle').addEventListener('change', () => { const custom = $('setting-idle').value === 'custom'; $('setting-idle-custom').hidden = !custom; if (!custom)
        saveIdle();
    else
        $('setting-idle-custom').focus(); }); $('setting-idle-custom').addEventListener('change', saveIdle); $('setting-dark').addEventListener('change', async (e) => { const next = e.target.checked ? 'dark' : 'light'; theme(next); await save(THEME_KEY, next); }); $('export-csv').addEventListener('click', exportCsv); $('backup-data').addEventListener('click', backupData); $('restore-data').addEventListener('click', () => $('restore-file').click()); $('restore-file').addEventListener('change', e => { if (e.target.files?.[0])
        restoreData(e.target.files[0]); e.target.value = ''; }); $('remove-data').addEventListener('click', removeAllData); bindNotifications(); }
    activatePage();
    bindSettings();
    $('rule-schedule-enabled').addEventListener('change', syncMethodFields);
    $('rule-limit-enabled').addEventListener('change', syncMethodFields);
    syncMethodFields();
    $('save-whitelist').addEventListener('click', saveWhitelist);
    $('save-tracking-exclusions').addEventListener('click', saveTrackingExclusions);
    $('stat-sort').addEventListener('change', renderStats);
    $('stat-limit').addEventListener('change', renderStats);
    $('refresh').addEventListener('click', refresh);
    $('chart-refresh').addEventListener('click', () => { applyChartPeriod(); refresh(); });
    $('chart-period').addEventListener('change', () => { applyChartPeriod(); renderUsageChart(); });
    ['chart-from', 'chart-to'].forEach(id => $(id).addEventListener('change', () => { renderStats(); renderUsageChart(); }));
    ['chart-top', 'chart-domain', 'show-others'].forEach(id => $(id).addEventListener('change', renderUsageChart));
    $('theme').addEventListener('click', async () => { const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark'; theme(next); await call(api.storage.local, 'set', { [THEME_KEY]: next }); });
    $('back').addEventListener('click', () => { try {
        api.tabs.create({ url: api.runtime.getURL('popup.html') });
    }
    catch (_) { } });
    (async () => { const stored = await call(api.storage.local, 'get', [RULES_KEY, WHITELIST_KEY, TRACKING_EXCLUDED_KEY, THEME_KEY]).catch(() => ({})); rules = stored[RULES_KEY] || []; let migratedRules = false; rules.forEach(r => { if (r.scheduleEnabled === undefined || r.limitEnabled === undefined) {
        methodFlags(r);
        migratedRules = true;
    } }); if (migratedRules)
        await call(api.storage.local, 'set', { [RULES_KEY]: rules }); $('whitelist-patterns').value = (stored[WHITELIST_KEY] || []).join('\n'); $('tracking-excluded-patterns').value = (stored[TRACKING_EXCLUDED_KEY] || []).join('\n'); theme(stored[THEME_KEY] === 'dark' ? 'dark' : 'light'); const today = localDay(), week = new Date(); week.setDate(week.getDate() - 6); $('export-from').value = localDay(week); $('export-to').value = today; applyChartPeriod(); await loadSettings(); renderRules(); await refresh(); })();
})();
