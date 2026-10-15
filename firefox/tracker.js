/*
 * Local website-time tracker for Remove Internet Distraction.
 * Tracks the focused browser window's active HTTP(S) website. Checkpoints are
 * persisted so Manifest V3 service-worker suspension does not reset elapsed time.
 */

(() => {
    'use strict';
    const api = globalThis.browser || globalThis.chrome;
    const isFirefox = !!globalThis.browser;
    const TRACKING_EXCLUDED_KEY = 'rwd_tracking_excluded_sites_v1';
    const DATA_KEY = 'rwd_website_time_daily_v3';
    const SESSION_KEY = 'rwd_website_time_session_v3';
    const SESSIONS_KEY = 'rwd_website_time_sessions_v1';
    const ALARM = 'rwd_website_time_checkpoint_v3';
    let session = null;
    let badgeEnabled = true;
    let idleThreshold = 300;
    let deferBlockEnabled = false;
    let busy = false;
    let checkpointRequested = false;
    let trackingExcludedPatterns = [];
    let lastBadgeTabId = null;
    let initPromise = null;
    // Last real mouse/keyboard/touch activity per tab. Content-script events make the
    // threshold precise and avoid browser idle API's minimum-threshold limitations.
    const lastActivityAt = new Map();
    // Events arriving while a storage checkpoint is in flight are queued and applied
    // afterwards, so an old checkpoint cannot overwrite newer activity timestamps.
    const pendingActivityEvents = new Map();
    const call = (owner, method, ...args) => new Promise((resolve, reject) => {
        const fn = owner && owner[method];
        if (typeof fn !== 'function')
            return reject(new Error(`Browser API unavailable: ${method}`));
        if (isFirefox) {
            try {
                Promise.resolve(fn.call(owner, ...args)).then(resolve, reject);
            }
            catch (e) {
                reject(e);
            }
            return;
        }
        try {
            fn.call(owner, ...args, result => {
                const error = globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.lastError;
                if (error)
                    reject(new Error(error.message));
                else
                    resolve(result);
            });
        }
        catch (e) {
            reject(e);
        }
    });
    const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    function domainOf(url) {
        try {
            const u = new URL(url);
            return (u.protocol === 'http:' || u.protocol === 'https:') ? u.hostname.replace(/^www\./i, '').toLowerCase() : null;
        }
        catch (_) {
            return null;
        }
    }
    function duration(seconds) {
        const n = Math.max(0, Math.floor(Number(seconds) || 0));
        const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = n % 60;
        if (h)
            return `${h}h ${m}m ${s}s`;
        if (m)
            return `${m}m ${s}s`;
        return `${s}s`;
    }
    async function readData() {
        const obj = await call(api.storage.local, 'get', [DATA_KEY]);
        return obj && obj[DATA_KEY] && typeof obj[DATA_KEY] === 'object' ? obj[DATA_KEY] : {};
    }
    async function writeData(data) { await call(api.storage.local, 'set', { [DATA_KEY]: data }); }
    async function activeTab() {
        try {
            const win = await call(api.windows, 'getLastFocused', {});
            if (!win || win.focused === false)
                return null;
            const tabs = await call(api.tabs, 'query', { active: true, lastFocusedWindow: true });
            const tab = tabs && tabs[0];
            if (!tab || tab.id == null || !tab.url)
                return null;
            const domain = domainOf(tab.url);
            if (!domain)
                return null;
            // Establish a baseline immediately on first discovery (e.g. after browser restart).
            if (!lastActivityAt.has(tab.id))
                lastActivityAt.set(tab.id, Date.now());
            return { domain, url: tab.url, tabId: tab.id, audible: !!tab.audible };
        }
        catch (e) {
            console.warn('[Remove Internet Distraction] Could not determine active website:', e && e.message || e);
            return null;
        }
    }
    function addElapsed(data, oldSession, endMs) {
        if (!oldSession || !oldSession.domain || !Number.isFinite(oldSession.since))
            return;
        let cursor = oldSession.since;
        const end = Math.max(cursor, endMs);
        while (cursor < end) {
            const date = new Date(cursor);
            const nextDay = new Date(date);
            nextDay.setHours(24, 0, 0, 0);
            const boundary = Math.min(end, nextDay.getTime());
            const day = dayKey(date);
            if (!data[day])
                data[day] = {};
            data[day][oldSession.domain] = Math.max(0, Number(data[day][oldSession.domain]) || 0) + Math.floor((boundary - cursor) / 1000);
            cursor = boundary;
        }
    }
    async function setBadge(tab, seconds, paused = false) {
        const action = api.action || api.browserAction;
        if (!action)
            return;
        if (!badgeEnabled) {
            await call(action, 'setBadgeText', tab && tab.tabId != null ? { tabId: tab.tabId, text: '' } : { text: '' }).catch(() => { });
            return;
        }
        if (lastBadgeTabId != null && (!tab || lastBadgeTabId !== tab.tabId)) {
            await call(action, 'setBadgeText', { tabId: lastBadgeTabId, text: '' }).catch(() => { });
        }
        await call(action, 'setBadgeBackgroundColor', { color: paused ? '#ffffff' : '#1677ff' }).catch(() => { });
        await call(action, 'setBadgeTextColor', { color: paused ? '#17221b' : '#ffffff' }).catch(() => { });
        if (!tab) {
            await call(action, 'setBadgeText', { text: '' }).catch(() => { });
            lastBadgeTabId = null;
            return;
        }
        // Match Web Activity Time Tracker: show seconds first, then whole minutes.
        // The badge changes from e.g. 16s to 1m at exactly 60 seconds.
        const elapsed = Math.max(0, Math.floor(Number(seconds) || 0));
        const badgeText = elapsed < 60 ? `${elapsed}s` : elapsed < 3600 ? `${Math.floor(elapsed / 60)}m` : `${(elapsed / 3600).toFixed(1)}h`;
        // Keep decimal hours (e.g. 606 minutes -> 10.1h) instead of overflowing into 606m.
        await call(action, 'setBadgeText', { tabId: tab.tabId, text: badgeText }).catch(() => { });
        await call(action, 'setTitle', { tabId: tab.tabId, title: `Remove Internet Distraction — ${tab.domain}: ${duration(seconds)} today${paused ? ' (paused: no recent activity)' : ''}` }).catch(() => { });
        lastBadgeTabId = tab.tabId;
    }
    async function checkpoint() {
        if (busy) {
            checkpointRequested = true;
            return;
        }
        busy = true;
        try {
            const now = Date.now();
            const active = await activeTab();
            const tab = active && !isTrackingExcluded(active.url) ? active : null;
            const data = await readData();
            const previousSession = session ? { ...session } : null;
            const previousActivity = previousSession && (previousSession.lastActivityAt || lastActivityAt.get(previousSession.tabId) || previousSession.since);
            const previousWasPaused = !!(previousSession && idleThreshold > 0 && now - previousActivity >= idleThreshold * 1000);
            // The inactivity grace period only applies while the SAME tab remains active.
            // When the user switches tabs, navigates to another site, opens an excluded
            // page, or leaves the browser window, close the previous site's interval now.
            // Otherwise the old site can keep accruing up to the idle threshold after a switch.
            const sameActiveSession = !!(tab && previousSession &&
                previousSession.tabId === tab.tabId && previousSession.domain === tab.domain);
            const previousEnd = previousSession && sameActiveSession && idleThreshold > 0
                ? Math.min(now, previousActivity + idleThreshold * 1000) : now;
            addElapsed(data, previousSession, previousEnd);
            const lastActivity = tab ? (lastActivityAt.get(tab.tabId) || now) : now;
            const paused = !!(tab && idleThreshold > 0 && now - lastActivity >= idleThreshold * 1000);
            if (tab && !paused && (!previousSession || previousSession.domain !== tab.domain || previousSession.tabId !== tab.tabId || previousWasPaused)) {
                const savedSessions = await call(api.storage.local, 'get', [SESSIONS_KEY]).catch(() => ({}));
                const sessions = savedSessions && savedSessions[SESSIONS_KEY] || {};
                const today = dayKey();
                if (!sessions[today])
                    sessions[today] = {};
                sessions[today][tab.domain] = Number(sessions[today][tab.domain] || 0) + 1;
                await call(api.storage.local, 'set', { [SESSIONS_KEY]: sessions });
            }
            if (!tab || paused) {
                session = null;
            }
            else if (previousSession && !previousWasPaused && previousSession.domain === tab.domain && previousSession.tabId === tab.tabId && Number.isFinite(previousSession.since)) {
                // Advance by whole seconds only; retain the fractional remainder so frequent tab events
                // cannot repeatedly discard sub-second elapsed time.
                const wholeSeconds = Math.floor(Math.max(0, now - previousSession.since) / 1000);
                session = { domain: tab.domain, tabId: tab.tabId, audible: !!tab.audible, since: previousSession.since + wholeSeconds * 1000, lastActivityAt: lastActivityAt.get(tab.tabId) || previousActivity || now };
            }
            else {
                // A new visit/session starts now, not at this tab's last activity timestamp.
                // That timestamp may belong to a visit from minutes or hours ago and must
                // never be reused as the start of the current interval.
                const activityAt = lastActivityAt.get(tab.tabId) || now;
                session = { domain: tab.domain, tabId: tab.tabId, audible: !!tab.audible, since: now, lastActivityAt: activityAt };
            }
            await writeData(data);
            await call(api.storage.local, 'set', { [SESSION_KEY]: session });
            await evaluateNotifications(data);
            await setBadge(tab, tab ? Number(data[dayKey()] && data[dayKey()][tab.domain] || 0) : 0, paused);
        }
        catch (e) {
            console.error('[Remove Internet Distraction] Time tracker checkpoint failed:', e && e.message || e);
        }
        finally {
            busy = false;
            if (checkpointRequested) {
                checkpointRequested = false;
                for (const [tabId, at] of pendingActivityEvents.entries())
                    applyActivityTimestamp(tabId, at);
                pendingActivityEvents.clear();
                Promise.resolve().then(() => checkpoint());
            }
        }
    }
    async function updateLiveBadge() {
        try {
            const active = await activeTab();
            const tab = active && !isTrackingExcluded(active.url) ? active : null;
            if (!tab) {
                await setBadge(null, 0);
                return;
            }
            const data = await readData();
            const now = Date.now();
            const lastActivity = lastActivityAt.get(tab.tabId) || now;
            const paused = idleThreshold > 0 && now - lastActivity >= idleThreshold * 1000;
            const base = Number(data[dayKey()] && data[dayKey()][tab.domain] || 0);
            const sameSession = session && session.domain === tab.domain && session.tabId === tab.tabId && Number.isFinite(session.since);
            const rawExtra = sameSession ? Math.floor(Math.max(0, now - session.since) / 1000) : 0;
            const accountingActivity = sameSession && Number.isFinite(session.lastActivityAt) ? session.lastActivityAt : lastActivity;
            const extra = idleThreshold > 0 && sameSession ? Math.min(rawExtra, Math.max(0, Math.floor((accountingActivity + idleThreshold * 1000 - session.since) / 1000))) : rawExtra;
            await setBadge(tab, base + extra, paused);
        }
        catch (e) {
            console.warn('[Remove Internet Distraction] Live badge update failed:', e && e.message || e);
        }
    }
    async function report() {
        // Wait for the first checkpoint so an early popup message cannot see an uninitialized session.
        if (initPromise)
            await initPromise.catch(() => { });
        // Build a live report without writing to storage every second.
        const data = await readData();
        const live = JSON.parse(JSON.stringify(data));
        const now = Date.now();
        const reportTab = await activeTab();
        const reportSessionIsCurrent = !!(session && reportTab && !isTrackingExcluded(reportTab.url) &&
            session.tabId === reportTab.tabId && session.domain === reportTab.domain);
        const sessionActivity = session && (session.lastActivityAt || lastActivityAt.get(session.tabId) || session.since);
        const reportEnd = reportSessionIsCurrent && idleThreshold > 0
            ? Math.min(now, sessionActivity + idleThreshold * 1000) : now;
        if (reportSessionIsCurrent)
            addElapsed(live, session, reportEnd);
        const todayKey = dayKey();
        const todayMap = live[todayKey] || {};
        const savedSessions = await call(api.storage.local, 'get', [SESSIONS_KEY]).catch(() => ({}));
        const sessionData = savedSessions && savedSessions[SESSIONS_KEY] || {};
        const sites = Object.entries(todayMap).map(([domain, seconds]) => ({ domain, seconds: Math.max(0, Math.floor(Number(seconds) || 0)), sessions: Number(sessionData[todayKey] && sessionData[todayKey][domain] || 0) })).filter(x => x.seconds > 0).sort((a, b) => b.seconds - a.seconds);
        const days = Object.entries(live).map(([day, domains]) => ({ day, seconds: Object.values(domains || {}).reduce((s, n) => s + Math.max(0, Number(n) || 0), 0) })).sort((a, b) => b.day.localeCompare(a.day));
        const totalSeconds = sites.reduce((s, x) => s + x.seconds, 0);
        const allTimeSeconds = days.reduce((s, x) => s + x.seconds, 0);
        const aggregate = {};
        for (const domains of Object.values(live))
            for (const [domain, seconds] of Object.entries(domains || {}))
                aggregate[domain] = (aggregate[domain] || 0) + Math.max(0, Number(seconds) || 0);
        const allSessionCounts = {};
        for (const domains of Object.values(sessionData))
            for (const [domain, count] of Object.entries(domains || {}))
                allSessionCounts[domain] = (allSessionCounts[domain] || 0) + Number(count || 0);
        const allSites = Object.entries(aggregate).map(([domain, seconds]) => ({ domain, seconds: Math.floor(seconds), sessions: allSessionCounts[domain] || 0 })).sort((a, b) => b.seconds - a.seconds);
        const tab = await activeTab();
        return { day: todayKey, sites, allSites, totalSeconds, allTimeSeconds, days: days.slice(0, 30), currentDomain: tab && tab.domain || null };
    }
    async function clearData() {
        await writeData({});
        session = null;
        await call(api.storage.local, 'set', { [SESSION_KEY]: null, [SESSIONS_KEY]: {}, [BLOCK_STATS_KEY]: {} });
        await checkpoint();
    }
    async function ensureAlarm() {
        try {
            const existing = isFirefox ? await api.alarms.get(ALARM) : await call(api.alarms, 'get', ALARM);
            if (!existing) {
                if (isFirefox)
                    await api.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
                else
                    api.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
            }
        }
        catch (e) {
            console.warn('[Remove Internet Distraction] Alarm setup failed:', e && e.message || e);
        }
    }
    async function initialize() {
        try {
            const preferences = await call(api.storage.local, 'get', ['rwd_setting_badge_enabled_v1', 'rwd_setting_idle_seconds_v1', 'rwd_setting_defer_block_v1', TRACKING_EXCLUDED_KEY]);
            badgeEnabled = preferences['rwd_setting_badge_enabled_v1'] !== false;
            idleThreshold = Number(preferences['rwd_setting_idle_seconds_v1'] ?? 300);
            deferBlockEnabled = !!preferences['rwd_setting_defer_block_v1'];
            trackingExcludedPatterns = Array.isArray(preferences[TRACKING_EXCLUDED_KEY]) ? preferences[TRACKING_EXCLUDED_KEY].map(x => String(x).trim()).filter(Boolean) : [];
            const saved = await call(api.storage.local, 'get', [SESSION_KEY]);
            const previous = saved && saved[SESSION_KEY];
            // Resume the persisted checkpoint and last-input timestamp after MV3 suspension.
            session = previous && previous.domain && Number.isFinite(previous.since) && Date.now() - previous.since < 3 * 60 * 1000 ? previous : null;
            if (session && session.tabId != null && Number.isFinite(session.lastActivityAt))
                lastActivityAt.set(session.tabId, session.lastActivityAt);
        }
        catch (_) {
            session = null;
        }
        await ensureAlarm();
        try {
            const tabs = await call(api.tabs, 'query', { active: true, lastFocusedWindow: true });
            if (tabs && tabs[0] && tabs[0].id != null && !lastActivityAt.has(tabs[0].id))
                lastActivityAt.set(tabs[0].id, Date.now());
        }
        catch (_) { }
        await checkpoint();
    }
    // Website blocking inspired by LeechBlock's domain/schedule model. Rules are
    // configured in dashboard.html and evaluated before a top-level navigation.
    const BLOCK_RULES_KEY = 'rwd_block_rules_v1';
    const BLOCK_WHITELIST_KEY = 'rwd_block_whitelist_v1';
    const BLOCK_STATS_KEY = 'rwd_block_stats_v1';
    const DEFERRED_KEY = 'rwd_block_deferred_v1';
    function globToRegex(pattern) {
        const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('^' + escaped.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$', 'i');
    }
    function patternMatches(url, pattern, regexMode = false) {
        const raw = String(pattern || '').trim();
        if (!raw)
            return false;
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch (_) {
            return false;
        }
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const cleaned = raw.replace(/^https?:\/\//i, '');
        if (regexMode) {
            try {
                return new RegExp(cleaned, 'i').test(url);
            }
            catch (_) {
                return false;
            }
        }
        if (!cleaned.includes('/') && !cleaned.includes('?') && !cleaned.includes('#') && !cleaned.includes('://')) {
            const domainPattern = cleaned.toLowerCase().replace(/^www\./, '');
            if (domainPattern.startsWith('*.')) {
                const root = domainPattern.slice(2);
                return host === root || host.endsWith('.' + root);
            }
            if (!domainPattern.includes('*')) {
                return host === domainPattern || host.endsWith('.' + domainPattern);
            }
            try {
                return globToRegex(domainPattern).test(host);
            }
            catch (_) {
                return false;
            }
        }
        try {
            return globToRegex(cleaned.includes('://') ? cleaned : '*' + cleaned).test(url);
        }
        catch (_) {
            return false;
        }
    }
    function isTrackingExcluded(url) {
        return trackingExcludedPatterns.some(pattern => patternMatches(url, pattern, false));
    }
    function patternsFor(rule) { return Array.isArray(rule.patterns) && rule.patterns.length ? rule.patterns : [String(rule.domain || '')]; }
    function ruleMatches(rule, url, referrer) {
        const patterns = patternsFor(rule);
        const positives = patterns.filter(p => !/^[+>~]/.test(p));
        const exceptions = patterns.filter(p => p.startsWith('+')).map(p => p.slice(1));
        if (exceptions.some(p => patternMatches(url, p, !!rule.regex)))
            return false;
        const refs = patterns.filter(p => p.startsWith('>')).map(p => p.slice(1));
        if (refs.length && !refs.some(p => referrer && patternMatches(referrer, p, !!rule.regex)))
            return false;
        const keywords = patterns.filter(p => p.startsWith('~')).map(p => p.slice(1).toLowerCase()).filter(Boolean);
        if (keywords.length && !keywords.some(k => url.toLowerCase().includes(k)))
            return false;
        return positives.some(p => patternMatches(url, p, !!rule.regex)) || (keywords.length > 0 && !positives.length);
    }
    function timeToMinutes(value) { const m = /^(\d{1,2}):(\d{2})$/.exec(value || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
    function ruleMethodFlags(rule) {
        const days = Array.isArray(rule.days) ? rule.days : [0, 1, 2, 3, 4, 5, 6];
        const hasLimit = Number(rule.dailyLimitMinutes || 0) > 0;
        const legacySchedule = String(rule.startTime || '00:00') !== String(rule.endTime || '00:00') || days.length !== 7;
        const scheduleEnabled = rule.scheduleEnabled === undefined ? (legacySchedule || (!hasLimit && String(rule.startTime || '00:00') === String(rule.endTime || '00:00'))) : !!rule.scheduleEnabled;
        const limitEnabled = rule.limitEnabled === undefined ? hasLimit : !!rule.limitEnabled;
        return { scheduleEnabled, limitEnabled };
    }
    function scheduleActive(rule, date = new Date()) {
        if (!rule.enabled || !ruleMethodFlags(rule).scheduleEnabled)
            return false;
        const days = Array.isArray(rule.days) ? rule.days : [0, 1, 2, 3, 4, 5, 6];
        const start = timeToMinutes(rule.startTime), end = timeToMinutes(rule.endTime);
        if (start === null || end === null)
            return false;
        const now = date.getHours() * 60 + date.getMinutes(), day = date.getDay();
        if (start === end)
            return days.includes(day);
        if (start < end)
            return days.includes(day) && now >= start && now < end;
        // Overnight schedules belong to the day on which they start.
        return (days.includes(day) && now >= start) || (days.includes((day + 6) % 7) && now < end);
    }
    async function blockingRuleFor(url, navigationDetails = {}) {
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch (_) {
            return null;
        }
        if (!/^https?:$/.test(parsed.protocol))
            return null;
        const stored = await call(api.storage.local, 'get', [BLOCK_RULES_KEY, BLOCK_WHITELIST_KEY, DEFERRED_KEY]).catch(() => ({}));
        const rules = stored && stored[BLOCK_RULES_KEY] || [];
        const whitelist = stored && stored[BLOCK_WHITELIST_KEY] || [];
        const domain = parsed.hostname.replace(/^www\./i, '').toLowerCase();
        const today = dayKey();
        const deferred = stored && stored[DEFERRED_KEY] || {};
        const deferEntry = deferred[today] && deferred[today][domain];
        if (deferBlockEnabled && deferEntry && Number(deferEntry.expiresAt) > Date.now())
            return null;
        if (whitelist.some(pattern => patternMatches(url, pattern)))
            return null;
        const now = new Date();
        const data = await readData().catch(() => ({}));
        let todaySeconds = Number(data[dayKey()] && data[dayKey()][domain] || 0);
        // Include uncheckpointed seconds from the live session. Without this, a
        // daily limit could be missed until the next storage checkpoint or reload.
        const nowMs = Date.now();
        if (session && session.domain === domain && session.tabId === navigationDetails.tabId && Number.isFinite(session.since)) {
            const lastInput = Number(session.lastActivityAt || lastActivityAt.get(session.tabId) || session.since);
            const accountingEnd = idleThreshold > 0 ? Math.min(nowMs, lastInput + idleThreshold * 1000) : nowMs;
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const liveStart = Math.max(session.since, todayStart.getTime());
            todaySeconds += Math.max(0, Math.floor((accountingEnd - liveStart) / 1000));
        }
        const referrer = navigationDetails.documentUrl || navigationDetails.referrer || '';
        for (const rule of rules) {
            if (!rule || !rule.enabled || !ruleMatches(rule, url, referrer))
                continue;
            const methods = ruleMethodFlags(rule);
            if (methods.scheduleEnabled && scheduleActive(rule, now))
                return { rule, reason: 'schedule' };
            const limit = Number(rule.dailyLimitMinutes || 0);
            if (methods.limitEnabled && limit > 0 && todaySeconds >= limit * 60)
                return { rule, reason: 'limit' };
        }
        return null;
    }
    async function recordBlocked(domain, reason) {
        try {
            const obj = await call(api.storage.local, 'get', [BLOCK_STATS_KEY]);
            const stats = obj && obj[BLOCK_STATS_KEY] || {};
            const key = dayKey();
            if (!stats[key])
                stats[key] = {};
            if (!stats[key][domain])
                stats[key][domain] = { attempts: 0, schedule: 0, limit: 0 };
            stats[key][domain].attempts++;
            stats[key][domain][reason === 'limit' ? 'limit' : 'schedule']++;
            await call(api.storage.local, 'set', { [BLOCK_STATS_KEY]: stats });
        }
        catch (_) { }
    }
    // Notifications inspired by Web Activity Time Tracker. All preferences and counters
    // stay in local extension storage; the one-minute checkpoint alarm drives evaluation.
    const DAILY_NOTIFICATION_KEY = 'rwd_daily_summary_notification_v1';
    const DAILY_NOTIFICATION_TIME_KEY = 'rwd_daily_summary_time_v1'; // HH:MM
    const SITE_NOTIFICATIONS_KEY = 'rwd_site_notifications_v1'; // [{domain, intervalSeconds}]
    const NOTIFICATION_MESSAGE_KEY = 'rwd_notification_message_v1';
    const NOTIFICATION_STATE_KEY = 'rwd_notification_state_v1';
    const DAILY_NOTIFICATION_SENT_KEY = 'rwd_daily_notification_sent_v1';
    const DEFAULT_NOTIFICATION_MESSAGE = 'You have spent a lot of time on this site';
    async function notify(title, message, id) {
        if (!api.notifications || typeof api.notifications.create !== 'function')
            return;
        try {
            const iconUrl = api.runtime.getURL('icons/icon128.png');
            if (api.notifications.clear)
                await call(api.notifications, 'clear', id).catch(() => { });
            await call(api.notifications, 'create', id, { type: 'basic', iconUrl, title, message, priority: 0 }).catch(async () => {
                // Firefox/browser variants may expose promise-only overloads.
                try {
                    await api.notifications.create(id, { type: 'basic', iconUrl, title, message });
                }
                catch (_) { }
            });
        }
        catch (e) {
            console.warn('[Remove Internet Distraction] Notification failed:', e && e.message || e);
        }
    }
    async function evaluateNotifications(data) {
        try {
            const keys = [DAILY_NOTIFICATION_KEY, DAILY_NOTIFICATION_TIME_KEY, SITE_NOTIFICATIONS_KEY, NOTIFICATION_MESSAGE_KEY, NOTIFICATION_STATE_KEY, DAILY_NOTIFICATION_SENT_KEY, SESSIONS_KEY];
            const settings = await call(api.storage.local, 'get', keys);
            const today = dayKey();
            const now = new Date();
            const time = String(settings[DAILY_NOTIFICATION_TIME_KEY] || '20:00');
            const [hh, mm] = time.split(':').map(Number);
            if (settings[DAILY_NOTIFICATION_KEY] === true && (now.getHours() * 60 + now.getMinutes()) >= (hh * 60 + mm) && settings[DAILY_NOTIFICATION_SENT_KEY] !== today) {
                const todayMap = data[today] || {};
                const total = Object.values(todayMap).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
                const most = Object.entries(todayMap).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
                const sessionsObj = settings[SESSIONS_KEY] || {};
                const title = `Today's browsing time: ${duration(total)}`;
                const message = most ? `Most visited: ${most[0]} (${duration(most[1])})` : 'No website activity was recorded today.';
                await notify(title, message, 'rwd-daily-summary');
                await call(api.storage.local, 'set', { [DAILY_NOTIFICATION_SENT_KEY]: today });
            }
            const list = Array.isArray(settings[SITE_NOTIFICATIONS_KEY]) ? settings[SITE_NOTIFICATIONS_KEY] : [];
            if (!list.length)
                return;
            const state = settings[NOTIFICATION_STATE_KEY] || {};
            const todayMap = data[today] || {};
            const message = String(settings[NOTIFICATION_MESSAGE_KEY] || DEFAULT_NOTIFICATION_MESSAGE);
            let changed = false;
            for (const item of list) {
                const domain = String(item.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '');
                const interval = Math.max(1, Number(item.intervalSeconds) || 1800);
                if (!domain)
                    continue;
                const matched = Object.keys(todayMap).find(d => d === domain || d.endsWith('.' + domain));
                if (!matched)
                    continue;
                const elapsed = Math.max(0, Number(todayMap[matched]) || 0);
                const bucket = Math.floor(elapsed / interval);
                const stateKey = `${today}:${matched}:${interval}`;
                const previous = Number(state[stateKey] || 0);
                if (bucket > previous) {
                    await notify(matched, message, `rwd-site-${matched}`);
                    state[stateKey] = bucket;
                    changed = true;
                }
            }
            if (changed)
                await call(api.storage.local, 'set', { [NOTIFICATION_STATE_KEY]: state });
        }
        catch (e) {
            console.warn('[Remove Internet Distraction] Notification evaluation failed:', e && e.message || e);
        }
    }
    // Check top-level URLs through tabs.onUpdated instead of webNavigation. This
    // avoids the broad browsing-history permission; host access still allows URL
    // inspection. The redirect happens as soon as Chrome/Firefox reports the URL.
    const blockingChecksInFlight = new Set();
    const lastCheckedNavigationUrl = new Map();
    const lastKnownTabUrl = new Map();
    async function checkUpdatedTabForBlocking(tabId, url, referrer = '', force = false) {
        if (tabId == null || !url || url.startsWith(api.runtime.getURL('')))
            return;
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch (_) {
            return;
        }
        if (!/^https?:$/.test(parsed.protocol))
            return;
        const key = `${tabId}:${url}`;
        if (blockingChecksInFlight.has(key) || (!force && lastCheckedNavigationUrl.get(tabId) === url))
            return;
        blockingChecksInFlight.add(key);
        lastCheckedNavigationUrl.set(tabId, url);
        try {
            const match = await blockingRuleFor(url, { tabId, referrer });
            if (!match)
                return;
            const domain = domainOf(url) || parsed.hostname;
            await recordBlocked(domain, match.reason);
            const destination = api.runtime.getURL('blocked.html') + '?1&' + encodeURIComponent(url) + '&' + encodeURIComponent(domain) + '&' + encodeURIComponent(match.reason);
            await call(api.tabs, 'update', tabId, { url: destination }).catch(() => { });
        }
        catch (e) {
            console.warn('[Remove Internet Distraction] Blocking check failed:', e && e.message || e);
        }
        finally {
            blockingChecksInFlight.delete(key);
        }
    }
    async function getBlockSummary() {
        const [rulesObj, statsObj] = await Promise.all([
            call(api.storage.local, 'get', [BLOCK_RULES_KEY]).catch(() => ({})),
            call(api.storage.local, 'get', [BLOCK_STATS_KEY]).catch(() => ({}))
        ]);
        return { rules: (rulesObj && rulesObj[BLOCK_RULES_KEY]) || [], blockStats: (statsObj && statsObj[BLOCK_STATS_KEY]) || {} };
    }
    if (api.storage && api.storage.onChanged)
        api.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local')
                return;
            if (changes.rwd_setting_badge_enabled_v1)
                badgeEnabled = changes.rwd_setting_badge_enabled_v1.newValue !== false;
            if (changes.rwd_setting_idle_seconds_v1)
                idleThreshold = Number(changes.rwd_setting_idle_seconds_v1.newValue ?? 300);
            if (changes.rwd_setting_defer_block_v1)
                deferBlockEnabled = !!changes.rwd_setting_defer_block_v1.newValue;
            if (changes[TRACKING_EXCLUDED_KEY]) {
                trackingExcludedPatterns = Array.isArray(changes[TRACKING_EXCLUDED_KEY].newValue) ? changes[TRACKING_EXCLUDED_KEY].newValue.map(x => String(x).trim()).filter(Boolean) : [];
                checkpoint();
            }
            if (!badgeEnabled) {
                const action = api.action || api.browserAction;
                if (action)
                    call(action, 'setBadgeText', { text: '' }).catch(() => { });
            }
        });
    if (api.runtime.onStartup)
        api.runtime.onStartup.addListener(() => { initPromise = initialize(); });
    if (api.runtime.onInstalled)
        api.runtime.onInstalled.addListener(() => { initPromise = initialize(); });
    function applyActivityTimestamp(tabId, at = Date.now()) {
        if (tabId == null)
            return { sameSession: false, resumedAfterIdle: false };
        const previousAt = Math.max(Number(lastActivityAt.get(tabId) || 0), Number(session && session.tabId === tabId ? session.lastActivityAt || 0 : 0)) || at;
        const sameSession = !!(session && session.tabId === tabId);
        const resumedAfterIdle = sameSession && idleThreshold > 0 && at - previousAt >= idleThreshold * 1000;
        lastActivityAt.set(tabId, at);
        if (sameSession && resumedAfterIdle) {
            // Keep the old timestamp long enough to close the previous interval exactly
            // at the inactivity boundary. The checkpoint then starts a fresh session at `at`.
            session.lastActivityAt = previousAt;
        }
        else if (sameSession) {
            session.lastActivityAt = at;
        }
        return { sameSession, resumedAfterIdle };
    }
    function recordTabActivity(tabId, at = Date.now()) {
        if (tabId == null)
            return;
        if (busy) {
            pendingActivityEvents.set(tabId, at);
            checkpointRequested = true;
            return;
        }
        applyActivityTimestamp(tabId, at);
        checkpoint();
    }
    if (api.tabs.onActivated)
        api.tabs.onActivated.addListener(info => {
            if (info && info.tabId != null) {
                recordTabActivity(info.tabId);
                call(api.tabs, 'get', info.tabId).then(tab => { if (tab && tab.url)
                    checkUpdatedTabForBlocking(info.tabId, tab.url, '', true); }).catch(() => { });
            }
            else
                checkpoint();
        });
    if (api.tabs.onUpdated)
        api.tabs.onUpdated.addListener((tabId, change, tab) => {
            if (change && (change.url || change.status === 'complete')) {
                recordTabActivity(tabId);
                const url = (change.url || (tab && tab.url));
                if (url) {
                    const previousUrl = lastKnownTabUrl.get(tabId) || '';
                    if (change.url && change.url !== previousUrl)
                        lastCheckedNavigationUrl.delete(tabId);
                    if (change.url)
                        lastKnownTabUrl.set(tabId, change.url);
                    checkUpdatedTabForBlocking(tabId, url, previousUrl);
                }
            }
            else if (change && change.audible !== undefined) {
                if (change.audible && tab && tab.active)
                    refreshAudibleActivity();
                else
                    checkpoint();
            }
        });
    if (api.tabs.onRemoved)
        api.tabs.onRemoved.addListener(tabId => { lastActivityAt.delete(tabId); lastKnownTabUrl.delete(tabId); lastCheckedNavigationUrl.delete(tabId); checkpoint(); });
    if (api.windows.onFocusChanged)
        api.windows.onFocusChanged.addListener(windowId => { if (windowId !== -1)
            call(api.tabs, 'query', { active: true, lastFocusedWindow: true }).then(tabs => { if (tabs && tabs[0] && tabs[0].id != null)
                recordTabActivity(tabs[0].id);
            else
                checkpoint(); }).catch(() => checkpoint());
        else
            checkpoint(); });
    if (api.alarms.onAlarm)
        api.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) {
            checkpoint();
            updateLiveBadge();
        } });
    // Audio in the focused active tab counts as activity (e.g. watching a video
    // without touching the keyboard or mouse). The browser's audible flag reflects
    // recent sound output; polling it each second keeps the idle deadline refreshed.
    async function refreshAudibleActivity() {
        try {
            const tabs = await call(api.tabs, 'query', { active: true, lastFocusedWindow: true });
            const tab = tabs && tabs[0];
            if (!tab || tab.id == null || !tab.url || !tab.audible || isTrackingExcluded(tab.url))
                return;
            const now = Date.now();
            const previous = lastActivityAt.get(tab.id) || 0;
            const idleExpired = !previous || (idleThreshold > 0 && now - previous >= idleThreshold * 1000);
            if (idleExpired || !session || session.tabId !== tab.id) {
                recordTabActivity(tab.id, now);
            }
            else {
                lastActivityAt.set(tab.id, now);
                if (session && session.tabId === tab.id)
                    session.lastActivityAt = now;
            }
        }
        catch (_) { }
    }
    // Match Web Activity Time Tracker's reliable global activity check. Page-level
    // input events remain the fast path; the browser idle API is a fallback for
    // missed content-script events and resumes the timer without requiring a popup click.
    async function refreshSystemActivity() {
        try {
            // Match the user's configured inactivity threshold. The browser idle API
            // has a 15-second minimum; shorter thresholds use page input events instead.
            if (!api.idle || idleThreshold < 15)
                return;
            const state = await call(api.idle, 'queryState', Math.max(15, Math.floor(idleThreshold)));
            if (state !== 'active')
                return;
            const active = await activeTab();
            if (!active || isTrackingExcluded(active.url))
                return;
            const now = Date.now();
            const previous = lastActivityAt.get(active.tabId) || 0;
            const needsResume = !previous || (idleThreshold > 0 && now - previous >= idleThreshold * 1000) ||
                !session || session.tabId !== active.tabId || session.domain !== active.domain;
            if (needsResume) {
                recordTabActivity(active.tabId, now);
            }
            else {
                lastActivityAt.set(active.tabId, now);
                if (session && session.tabId === active.tabId && session.domain === active.domain) {
                    session.lastActivityAt = now;
                }
            }
        }
        catch (e) {
            // Keep the content-script activity path working if the idle API is unavailable.
        }
    }
    if (api.idle && api.idle.onStateChanged) {
        api.idle.onStateChanged.addListener(state => {
            if (state === 'active') {
                // Treat Chrome's explicit idle -> active transition as a resume signal.
                // This is independent of page content-script delivery and wakes tracking
                // automatically when the user returns to the browser.
                call(api.tabs, 'query', { active: true, lastFocusedWindow: true }).then(tabs => {
                    const tab = tabs && tabs[0];
                    if (tab && tab.id != null && tab.url && !isTrackingExcluded(tab.url))
                        recordTabActivity(tab.id, Date.now());
                    else
                        checkpoint();
                }).catch(() => refreshSystemActivity());
            }
        });
    }
    // Best-effort second-level badge updates while the background context is alive.
    // The popup also requests updates each second, so the badge stays live while it is open.
    setInterval(() => { refreshSystemActivity(); refreshAudibleActivity(); updateLiveBadge(); }, 1000);
    api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || !['USER_ACTIVITY', 'GET_WEBSITE_TIME', 'CLEAR_WEBSITE_TIME', 'UPDATE_WEBSITE_BADGE', 'GET_BLOCKING_DATA', 'SAVE_BLOCKING_RULES', 'LOAD_FILTER_LIST', 'CHECK_BLOCKING_NOW'].includes(message.type))
            return undefined;
        if (message.type === 'LOAD_FILTER_LIST') {
            const allowedFiles = new Set(['youtube-strict.txt', 'reddit.txt', 'instagram.txt']);
            const file = String(message.file || '');
            if (!allowedFiles.has(file)) {
                sendResponse({ ok: false, error: 'Unknown filter list.' });
                return false;
            }
            fetch(api.runtime.getURL(`filters/${file}`)).then(async (response) => {
                if (!response.ok)
                    throw new Error(`Could not load ${file}: ${response.status}`);
                sendResponse({ ok: true, text: await response.text() });
            }).catch(error => sendResponse({ ok: false, error: String(error && error.message || error) }));
            return true;
        }
        if (message.type === 'CHECK_BLOCKING_NOW') {
            const tab = _sender && _sender.tab;
            // Usage accrues on the active tab only, so check that tab periodically
            // while it remains open; this catches time-limit crossings without reloads.
            if (tab && tab.id != null && tab.active && tab.url) {
                checkUpdatedTabForBlocking(tab.id, tab.url, '', true);
            }
            return undefined;
        }
        if (message.type === 'USER_ACTIVITY') {
            const tabId = _sender && _sender.tab && _sender.tab.id;
            if (tabId != null) {
                const at = Number(message.at) || Date.now();
                const previousAt = Math.max(Number(lastActivityAt.get(tabId) || 0), Number(session && session.tabId === tabId ? session.lastActivityAt || 0 : 0));
                const hadLiveSession = !!(session && session.tabId === tabId);
                const wasPastIdleDeadline = idleThreshold > 0 && previousAt > 0 && at - previousAt >= idleThreshold * 1000;
                if (busy) {
                    // Do not mutate the live session while a checkpoint is calculating its
                    // interval. Apply this timestamp immediately after that checkpoint finishes.
                    pendingActivityEvents.set(tabId, at);
                    checkpointRequested = true;
                    return undefined;
                }
                const result = applyActivityTimestamp(tabId, at);
                // Always checkpoint on the first input after an idle deadline, even if a
                // system-idle poll updated one of the timestamp stores and masked the
                // transition. This prevents the timer remaining paused until popup open.
                if (!result.sameSession || result.resumedAfterIdle || !session || !hadLiveSession || wasPastIdleDeadline)
                    checkpoint();
            }
            return undefined;
        }
        if (message.type === 'GET_BLOCKING_DATA') {
            getBlockSummary().then(sendResponse).catch(() => sendResponse({ rules: [], blockStats: {} }));
            return true;
        }
        if (message.type === 'SAVE_BLOCKING_RULES') {
            const rules = Array.isArray(message.rules) ? message.rules : [];
            call(api.storage.local, 'set', { [BLOCK_RULES_KEY]: rules }).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: String(error && error.message || error) }));
            return true;
        }
        if (message.type === 'GET_WEBSITE_TIME') {
            report().then(sendResponse).catch(error => { console.error(error); sendResponse({ day: dayKey(), sites: [], totalSeconds: 0, allTimeSeconds: 0, days: [], currentDomain: null, error: String(error && error.message || error) }); });
            return true;
        }
        if (message.type === 'UPDATE_WEBSITE_BADGE') {
            updateLiveBadge().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
            return true;
        }
        clearData().then(() => sendResponse({ ok: true })).catch(error => { console.error(error); sendResponse({ ok: false, error: String(error && error.message || error) }); });
        return true;
    });
    initPromise = initialize();
})();
