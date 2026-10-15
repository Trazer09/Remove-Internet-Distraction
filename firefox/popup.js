/*
 * Popup controller for Remove Internet Distraction.
 * Builds a separate switch for every feature, persists settings locally, and
 * offers a site master switch plus an independently saved light/dark theme.
 */

(() => {
    'use strict';
    const api = globalThis.browser || globalThis.chrome;
    const catalogue = globalThis.FOCUS_FILTER_FEATURES;
    const siteList = document.getElementById('site-list');
    const summary = document.getElementById('summary');
    const siteIcons = { youtube: ['icons/youtube.png', 'youtube'], reddit: ['icons/reddit.png', 'reddit'], instagram: ['icons/instagram.png', 'instagram'] };
    const themeKey = 'ui_theme';
    // Normalize Chrome callback APIs and Firefox promise APIs behind one helper.
    function storageGet(keys) {
        return new Promise(resolve => {
            try {
                if (globalThis.browser)
                    api.storage.local.get(keys).then(v => resolve(v || {})).catch(() => resolve({}));
                else
                    api.storage.local.get(keys, v => resolve(v || {}));
            }
            catch (_) {
                resolve({});
            }
        });
    }
    function storageSet(values) {
        return new Promise(resolve => {
            try {
                if (globalThis.browser)
                    api.storage.local.set(values).then(resolve).catch(resolve);
                else
                    api.storage.local.set(values, resolve);
            }
            catch (_) {
                resolve();
            }
        });
    }
    const masterKey = site => `enabled_${site}`;
    const featureKey = (site, feature) => `feature_${site}_${feature}`;
    const allKeys = Object.entries(catalogue).flatMap(([site, config]) => [masterKey(site), ...config.features.map(f => featureKey(site, f.id))]);
    // Accessible switch markup; labels are linked to each checkbox by a unique ID.
    function makeSwitch(id, label, checked = true) {
        const wrapper = document.createElement('label');
        wrapper.className = 'switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.checked = checked;
        input.setAttribute('aria-label', label);
        const slider = document.createElement('span');
        slider.className = 'slider';
        const sr = document.createElement('span');
        sr.className = 'sr-only';
        sr.textContent = label;
        wrapper.append(input, slider, sr);
        return { wrapper, input };
    }
    const inputsBySite = {};
    const featureInputs = {};
    Object.entries(catalogue).forEach(([site, config]) => {
        const card = document.createElement('article');
        card.className = 'site-card';
        card.dataset.site = site;
        const heading = document.createElement('div');
        heading.className = 'site-heading';
        const icon = document.createElement('img');
        icon.className = `site-icon ${siteIcons[site][1]}`;
        icon.setAttribute('aria-hidden', 'true');
        icon.alt = '';
        icon.src = siteIcons[site][0];
        const copy = document.createElement('div');
        copy.className = 'site-copy';
        const title = document.createElement('h2');
        title.textContent = config.title;
        const desc = document.createElement('p');
        desc.textContent = config.description;
        copy.append(title, desc);
        // Each website has its own disclosure button and starts collapsed.
        const expandButton = document.createElement('button');
        expandButton.type = 'button';
        expandButton.className = 'site-expand';
        expandButton.setAttribute('aria-expanded', 'false');
        expandButton.setAttribute('aria-label', `Show ${config.title} filter controls`);
        expandButton.innerHTML = '<span class="chevron" aria-hidden="true">⌄</span>';
        const masterLabel = document.createElement('span');
        masterLabel.className = 'master-label';
        masterLabel.append(document.createTextNode('Site '));
        const master = makeSwitch(`${site}-master`, `Enable all ${config.title} filters`);
        masterLabel.append(master.wrapper);
        heading.append(icon, copy, expandButton, masterLabel);
        const featureList = document.createElement('div');
        featureList.className = 'feature-list';
        featureList.id = `${site}-feature-list`;
        featureList.hidden = true;
        expandButton.setAttribute('aria-controls', featureList.id);
        expandButton.addEventListener('click', () => {
            const isExpanded = !featureList.hidden;
            featureList.hidden = isExpanded;
            expandButton.setAttribute('aria-expanded', String(!isExpanded));
            expandButton.setAttribute('aria-label', `${isExpanded ? 'Show' : 'Hide'} ${config.title} filter controls`);
            expandButton.querySelector('.chevron').textContent = isExpanded ? '⌄' : '⌃';
            updateExpandAllLabel();
        });
        const featureToggles = [];
        config.features.forEach(feature => {
            const row = document.createElement('div');
            row.className = 'feature-row';
            const text = document.createElement('div');
            text.className = 'feature-copy';
            const name = document.createElement('strong');
            name.textContent = feature.label;
            const help = document.createElement('small');
            help.textContent = feature.description;
            text.append(name, help);
            const control = makeSwitch(`${site}-${feature.id}`, `${config.title}: ${feature.label}`);
            row.append(text, control.wrapper);
            featureList.append(row);
            featureInputs[featureKey(site, feature.id)] = control.input;
            featureToggles.push(control.input);
            control.input.addEventListener('change', async () => {
                await storageSet({ [featureKey(site, feature.id)]: control.input.checked });
                updateSummary();
            });
        });
        inputsBySite[site] = { master: master.input, features: featureToggles, featureList };
        master.input.addEventListener('change', async () => {
            // Pausing a site doesn't erase its individual feature preferences.
            await storageSet({ [masterKey(site)]: master.input.checked });
            updateSummary();
        });
        card.append(heading, featureList);
        siteList.append(card);
    });
    function updateSummary() {
        let enabled = 0, total = 0;
        Object.entries(catalogue).forEach(([site, config]) => {
            const masterOn = inputsBySite[site].master.checked;
            config.features.forEach(f => {
                total++;
                if (masterOn && featureInputs[featureKey(site, f.id)].checked)
                    enabled++;
            });
            inputsBySite[site].features.forEach(input => { input.disabled = !masterOn; });
            inputsBySite[site].featureList.style.opacity = masterOn ? '1' : '.48';
        });
        summary.textContent = `${enabled} of ${total} filters active`;
    }
    // Restore the saved theme and each filter's saved state when the popup opens.
    storageGet([...allKeys, themeKey]).then(values => {
        applyTheme(values[themeKey] === 'dark' ? 'dark' : 'light');
        Object.entries(catalogue).forEach(([site, config]) => {
            const masterValue = values[masterKey(site)];
            inputsBySite[site].master.checked = typeof masterValue === 'boolean' ? masterValue : true;
            config.features.forEach(feature => {
                const key = featureKey(site, feature.id);
                featureInputs[key].checked = typeof values[key] === 'boolean' ? values[key] : true;
            });
        });
        updateSummary();
    });
    const expandAllButton = document.getElementById('expand-all');
    // Keep the optional global expand/collapse control in sync with each dropdown.
    function updateExpandAllLabel() {
        const lists = [...siteList.querySelectorAll('.feature-list')];
        const allExpanded = lists.length > 0 && lists.every(list => !list.hidden);
        expandAllButton.textContent = allExpanded ? 'Collapse all' : 'Expand all';
    }
    expandAllButton.addEventListener('click', () => {
        const lists = [...siteList.querySelectorAll('.feature-list')];
        const shouldExpand = lists.some(list => list.hidden);
        lists.forEach(list => {
            list.hidden = !shouldExpand;
            const button = siteList.querySelector(`[aria-controls="${list.id}"]`);
            if (button) {
                button.setAttribute('aria-expanded', String(shouldExpand));
                const site = list.id.replace(/-feature-list$/, '');
                button.setAttribute('aria-label', `${shouldExpand ? 'Hide' : 'Show'} ${catalogue[site].title} filter controls`);
                button.querySelector('.chevron').textContent = shouldExpand ? '⌃' : '⌄';
            }
        });
        updateExpandAllLabel();
    });
    // Settings menu contains theme, refresh-all-tabs, and dashboard Settings navigation.
    document.getElementById('dashboard-button')?.addEventListener('click', async () => { try {
        const url = api.runtime.getURL('dashboard.html');
        const tabs = await (globalThis.browser ? api.tabs.query({}) : new Promise(resolve => api.tabs.query({}, resolve)));
        const existing = (tabs || []).find(tab => typeof tab.url === 'string' && tab.url.startsWith(url));
        if (existing && existing.id != null) {
            await (globalThis.browser ? api.tabs.update(existing.id, { active: true }) : new Promise(resolve => api.tabs.update(existing.id, { active: true }, resolve)));
            if (existing.windowId != null && api.windows?.update) {
                if (globalThis.browser)
                    await api.windows.update(existing.windowId, { focused: true }).catch(() => { });
                else
                    await new Promise(resolve => api.windows.update(existing.windowId, { focused: true }, resolve));
            }
        }
        else {
            if (globalThis.browser)
                await api.tabs.create({ url });
            else
                await new Promise(resolve => api.tabs.create({ url }, resolve));
        }
    }
    catch (e) {
        console.warn('Could not open Dashboard tab', e);
    } });
    const settingsButton = document.getElementById('settings-button');
    const settingsMenu = document.getElementById('settings-menu');
    settingsButton.addEventListener('click', () => {
        const open = settingsMenu.hidden;
        settingsMenu.hidden = !open;
        settingsButton.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.settings-wrap')) {
            settingsMenu.hidden = true;
            settingsButton.setAttribute('aria-expanded', 'false');
        }
    });
    document.getElementById('dashboard-settings')?.addEventListener('click', async () => {
        try {
            const dashboardUrl = api.runtime.getURL('dashboard.html');
            const settingsUrl = `${dashboardUrl}?tab=settings`;
            const tabs = await (globalThis.browser ? api.tabs.query({}) : new Promise(resolve => api.tabs.query({}, resolve)));
            const existing = (tabs || []).find(tab => typeof tab.url === 'string' && tab.url.startsWith(dashboardUrl));
            if (existing && existing.id != null) {
                await (globalThis.browser ? api.tabs.update(existing.id, { url: settingsUrl, active: true }) : new Promise(resolve => api.tabs.update(existing.id, { url: settingsUrl, active: true }, resolve)));
                if (existing.windowId != null && api.windows?.update) {
                    if (globalThis.browser)
                        await api.windows.update(existing.windowId, { focused: true }).catch(() => { });
                    else
                        await new Promise(resolve => api.windows.update(existing.windowId, { focused: true }, resolve));
                }
            }
            else {
                if (globalThis.browser)
                    await api.tabs.create({ url: settingsUrl });
                else
                    await new Promise(resolve => api.tabs.create({ url: settingsUrl }, resolve));
            }
            settingsMenu.hidden = true;
            settingsButton.setAttribute('aria-expanded', 'false');
        }
        catch (e) {
            console.warn('Could not open Dashboard Settings', e);
        }
    });
    function applyTheme(theme) {
        const light = theme === 'light';
        document.body.dataset.theme = light ? 'light' : 'dark';
        document.getElementById('theme-icon').textContent = light ? '☾' : '☀';
        document.getElementById('theme-label').textContent = light ? 'Dark mode' : 'Light mode';
        document.getElementById('theme-toggle').setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    }
    document.getElementById('theme-toggle').addEventListener('click', async () => {
        const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
        applyTheme(next);
        await storageSet({ [themeKey]: next });
    });
    const trackerTotal = document.getElementById('tracker-total');
    const donutTotal = document.getElementById('donut-total');
    const trackerSites = document.getElementById('tracker-sites');
    const trackerLegend = document.getElementById('tracker-legend');
    const trackerDaily = document.getElementById('tracker-daily');
    const trackerSummaryLabel = document.getElementById('tracker-summary-label');
    const trackerSort = document.getElementById('tracker-sort');
    let latestReport = null;
    let activeReport = 'today';
    const chartPalette = ['#e6007e', '#20c933', '#3020e8', '#ff8c00', '#8b22d9', '#e53935', '#00a6a6', '#795548', '#607d8b', '#c2185b', '#7cba00'];
    function siteColor(domain) { let hash = 2166136261; for (let i = 0; i < domain.length; i++) {
        hash ^= domain.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    } const hue = (hash >>> 0) % 360; return `hsl(${hue} 84% 48%)`; }
    function renderDonutSlices(donut, items, hoveredDomain) {
        let svg = donut.querySelector('.donut-slices');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 100 100');
            svg.setAttribute('aria-hidden', 'true');
            svg.classList.add('donut-slices');
            svg.style.pointerEvents = 'none';
            const hole = donut.querySelector('.donut-hole');
            donut.insertBefore(svg, hole || null);
        }
        svg.replaceChildren();
        const ns = 'http://www.w3.org/2000/svg', cx = 50, cy = 50, outer = 48, inner = 26;
        items.forEach(item => {
            const start = Number(item.start) || 0, end = Number(item.end) || 0, span = end - start;
            if (span <= 0.05)
                return;
            const point = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
            let path;
            if (span >= 359.5) {
                // SVG arc commands cannot draw a full circle when their start and end
                // points are identical. Use a real circle for the single-site/100% case;
                // the stationary .donut-hole overlays its center to keep the donut shape.
                path = document.createElementNS(ns, 'circle');
                path.setAttribute('cx', cx);
                path.setAttribute('cy', cy);
                path.setAttribute('r', outer);
            }
            else {
                const a = point(outer, start), b = point(outer, end), c = point(inner, end), d = point(inner, start), large = span > 180 ? 1 : 0;
                path = document.createElementNS(ns, 'path');
                path.setAttribute('d', `M ${a[0]} ${a[1]} A ${outer} ${outer} 0 ${large} 1 ${b[0]} ${b[1]} L ${c[0]} ${c[1]} A ${inner} ${inner} 0 ${large} 0 ${d[0]} ${d[1]} Z`);
            }
            path.setAttribute('fill', item.color);
            path.setAttribute('stroke', '#ffffff');
            path.setAttribute('stroke-width', '1.25');
            path.setAttribute('stroke-linejoin', 'round');
            path.classList.add('donut-slice');
            path.dataset.domain = item.domain;
            if (hoveredDomain) {
                if (item.domain === hoveredDomain) {
                    const mid = (start + end) / 2, rad = (mid - 90) * Math.PI / 180;
                    path.style.transform = `translate(${Math.cos(rad) * 2.4}px, ${Math.sin(rad) * 2.4}px)`;
                    path.style.filter = 'drop-shadow(0 2px 2px #0005)';
                    path.style.opacity = '1';
                    path.classList.add('is-raised');
                }
                else {
                    path.style.opacity = '.22';
                }
            }
            svg.append(path);
        });
    }
    function prettyDuration(seconds) {
        const n = Math.max(0, Math.floor(Number(seconds) || 0)), h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = n % 60;
        if (h)
            return `${h}h ${m}m ${s}s`;
        if (m)
            return `${m}m ${s}s`;
        return `${s}s`;
    }
    function sendTrackerMessage(message) {
        return new Promise(resolve => {
            try {
                if (globalThis.browser)
                    api.runtime.sendMessage(message).then(resolve).catch(() => resolve(null));
                else
                    api.runtime.sendMessage(message, response => { if (globalThis.chrome?.runtime?.lastError)
                        resolve(null);
                    else
                        resolve(response || null); });
            }
            catch (_) {
                resolve(null);
            }
        });
    }
    const siteIconCache = new Map();
    function makeSiteIcon(domain, color) {
        // Reuse each site's favicon node across one-second data refreshes. Recreating
        // the image causes visible reload/flicker that looks like an icon flip.
        if (siteIconCache.has(domain))
            return siteIconCache.get(domain);
        const wrap = document.createElement('span');
        wrap.className = 'tracker-site-icon';
        wrap.style.setProperty('--site-color', color);
        const fallback = document.createElement('span');
        fallback.className = 'tracker-site-fallback';
        fallback.textContent = (domain.replace(/^www\./, '')[0] || '•').toUpperCase();
        fallback.setAttribute('aria-hidden', 'true');
        wrap.append(fallback);
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        // Resolve the site's real favicon through the browser, without contacting a third-party service.
        if (globalThis.browser)
            img.src = `page-icon:https://${domain}/`;
        else
            img.src = `chrome://favicon/size/32@2x/https://${domain}/`;
        img.addEventListener('load', () => { if (img.naturalWidth > 0) {
            fallback.hidden = true;
            wrap.classList.add('has-favicon');
        } });
        img.addEventListener('error', () => { img.hidden = true; wrap.classList.remove('has-favicon'); });
        wrap.append(img);
        wrap.title = `Favicon for ${domain}`;
        siteIconCache.set(domain, wrap);
        return wrap;
    }
    function animateDonut(donut) {
        // Animate only the colored SVG slices. The donut hole and tracked-time
        // label remain fully visible and stationary throughout the reveal.
        const svg = donut.querySelector('.donut-slices');
        if (!svg)
            return;
        let items = [];
        try {
            items = JSON.parse(donut.dataset.chartData || '[]');
        }
        catch (_) { }
        if (!items.some(item => Number(item.end) - Number(item.start) > 0.05))
            return;
        if (svg.dataset.entrancePlayed === '1')
            return;
        svg.dataset.entrancePlayed = '1';
        svg.classList.add('chart-animate');
    }
    function ensureDonutHover() {
        const donut = document.getElementById('tracker-donut');
        if (!donut || donut.dataset.hoverBound === '1')
            return;
        donut.dataset.hoverBound = '1';
        let tooltip = document.getElementById('tracker-chart-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'tracker-chart-tooltip';
            tooltip.className = 'chart-hover-tooltip';
            tooltip.hidden = true;
            document.body.append(tooltip);
        }
        const data = () => { try {
            return JSON.parse(donut.dataset.chartData || '[]');
        }
        catch (_) {
            return [];
        } };
        const paintHighlight = (items, domain) => {
            renderDonutSlices(donut, items, domain);
        };
        const hide = () => {
            tooltip.hidden = true;
            delete donut.dataset.hoverDomain;
            donut.classList.remove('chart-hovering');
            const items = data();
            if (items.length)
                renderDonutSlices(donut, items, null);
        };
        const show = (selected, event) => {
            const items = data();
            if (!selected || !items.length)
                return;
            donut.dataset.hoverDomain = selected.domain;
            donut.classList.add('chart-hovering');
            paintHighlight(items, selected.domain);
            tooltip.textContent = `${selected.domain} · ${selected.time} · ${selected.percent.toFixed(2)}%`;
            tooltip.hidden = false;
            if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
                const x = event.clientX, y = event.clientY;
                tooltip.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - tooltip.offsetWidth - 8))}px`;
                tooltip.style.top = `${Math.max(8, Math.min(y + 12, window.innerHeight - tooltip.offsetHeight - 8))}px`;
            }
        };
        donut.addEventListener('pointermove', event => {
            const items = data();
            if (!items.length)
                return;
            const rect = donut.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, dx = event.clientX - cx, dy = event.clientY - cy, radius = Math.sqrt(dx * dx + dy * dy);
            if (radius < rect.width * .23 || radius > rect.width * .52) {
                hide();
                return;
            }
            const angle = ((Math.atan2(dy, dx) * 180 / Math.PI + 90) + 360) % 360;
            const selected = items.find(item => angle >= item.start && angle < item.end);
            if (selected)
                show(selected, event);
            else
                hide();
        });
        donut.addEventListener('pointerleave', hide);
        const legend = document.getElementById('tracker-legend');
        if (legend) {
            legend.addEventListener('pointerover', event => { const row = event.target.closest('.legend-row'); if (!row)
                return; const item = data().find(x => x.domain === row.dataset.domain); if (item)
                show(item, event); });
            legend.addEventListener('pointermove', event => { const row = event.target.closest('.legend-row'); if (!row)
                return; const item = data().find(x => x.domain === row.dataset.domain); if (item)
                show(item, event); });
            legend.addEventListener('pointerout', event => { const row = event.target.closest('.legend-row'); if (row && !row.contains(event.relatedTarget))
                hide(); });
        }
    }
    function renderSites(sites, total) {
        trackerSites.replaceChildren();
        trackerLegend.replaceChildren();
        const sorted = [...sites].sort((a, b) => trackerSort.value === 'name' ? a.domain.localeCompare(b.domain) : (trackerSort.value === 'sessions' ? (Number(b.sessions || 0) - Number(a.sessions || 0) || b.seconds - a.seconds) : b.seconds - a.seconds));
        if (!sorted.length) {
            const p = document.createElement('p');
            p.className = 'tracker-empty';
            p.textContent = 'Your website activity will appear here as you browse.';
            trackerSites.append(p);
            trackerLegend.textContent = 'No activity recorded yet';
            const emptyDonut = document.getElementById('tracker-donut');
            emptyDonut.dataset.chartData = '[]';
            renderDonutSlices(emptyDonut, [], null);
            ensureDonutHover();
            animateDonut(emptyDonut);
            return;
        }
        // Keep the compact popup readable: show the ten leading domains and combine the remainder.
        // Raw per-domain records remain untouched for the full Dashboard.
        const visible = sorted.slice(0, 10).map(site => ({ ...site }));
        if (sorted.length > 10) {
            const rest = sorted.slice(10);
            visible.push({ domain: 'Others', seconds: rest.reduce((n, s) => n + Number(s.seconds || 0), 0), sessions: rest.reduce((n, s) => n + Number(s.sessions || 0), 0), isAggregate: true, domainCount: rest.length });
        }
        visible.forEach((site, index) => { site.chartColor = chartPalette[index % chartPalette.length]; });
        let angle = 0;
        const pieces = [];
        visible.forEach((site, index) => {
            const color = site.chartColor, share = total > 0 ? site.seconds / total : 0, start = angle;
            angle += share * 360;
            pieces.push(`${color} ${start}deg ${angle}deg`);
            const legendRow = document.createElement('div');
            legendRow.className = 'legend-row';
            legendRow.dataset.domain = site.isAggregate ? `Others (${site.domainCount} sites)` : site.domain;
            const dot = document.createElement('span');
            dot.className = 'legend-dot';
            dot.style.background = color;
            const name = document.createElement('span');
            name.textContent = site.isAggregate ? `Others (${site.domainCount} sites)` : site.domain;
            name.title = name.textContent;
            legendRow.append(dot, name);
            trackerLegend.append(legendRow);
            const row = document.createElement('div');
            row.className = 'tracker-site';
            const top = document.createElement('div');
            top.className = 'tracker-site-line';
            const identity = document.createElement('div');
            identity.className = 'tracker-site-identity';
            if (site.isAggregate) {
                const otherIcon = document.createElement('span');
                otherIcon.className = 'tracker-site-icon';
                otherIcon.style.setProperty('--site-color', color);
                const otherMark = document.createElement('span');
                otherMark.className = 'tracker-site-fallback';
                otherMark.textContent = '…';
                otherIcon.append(otherMark);
                identity.append(otherIcon);
            }
            else
                identity.append(makeSiteIcon(site.domain, color));
            const domain = document.createElement('span');
            domain.className = 'tracker-domain';
            domain.textContent = site.isAggregate ? `Others (${site.domainCount} websites)` : site.domain;
            if (site.domain === latestReport?.currentDomain) {
                const badge = document.createElement('span');
                badge.className = 'current-site';
                badge.textContent = 'ACTIVE';
                domain.append(' ', badge);
            }
            identity.append(domain);
            const time = document.createElement('strong');
            time.className = 'tracker-time';
            time.textContent = prettyDuration(site.seconds);
            top.append(identity, time);
            const bar = document.createElement('div');
            bar.className = 'tracker-bar';
            const fill = document.createElement('span');
            fill.style.background = color;
            fill.style.width = `${Math.max(1, share * 100)}%`;
            bar.append(fill);
            const bottom = document.createElement('div');
            bottom.className = 'tracker-site-bottom';
            const sessions = document.createElement('span');
            sessions.textContent = `${(site.sessions || 0)} sessions`;
            const percent = document.createElement('span');
            percent.textContent = `${(share * 100).toFixed(2)}%`;
            bottom.append(sessions, percent);
            row.append(top, bar, bottom);
            trackerSites.append(row);
        });
        const donut = document.getElementById('tracker-donut');
        let startAngle = 0;
        const chartData = visible.map(site => { const color = site.chartColor, share = total > 0 ? Number(site.seconds || 0) / total : 0; const item = { domain: site.isAggregate ? `Others (${site.domainCount} sites)` : site.domain, color, seconds: Number(site.seconds || 0), share, start: startAngle, end: startAngle + share * 360, time: prettyDuration(site.seconds), percent: total > 0 ? Number(site.seconds || 0) / total * 100 : 0 }; startAngle = item.end; return item; });
        donut.dataset.chartData = JSON.stringify(chartData);
        // The gray conic gradient is only a no-data fallback. It must never cover
        // the first real SVG slice while the popup initializes.
        donut.classList.toggle('has-chart-data', chartData.some(item => item.end - item.start > 0.05));
        const hoveredDomain = donut.dataset.hoverDomain;
        if (hoveredDomain && chartData.some(item => item.domain === hoveredDomain)) {
            donut.classList.add('chart-hovering');
            renderDonutSlices(donut, chartData, hoveredDomain);
            const hovered = chartData.find(item => item.domain === hoveredDomain);
            const tooltip = document.getElementById('tracker-chart-tooltip');
            if (hovered && tooltip && !tooltip.hidden)
                tooltip.textContent = `${hovered.domain} · ${hovered.time} · ${hovered.percent.toFixed(2)}%`;
        }
        else {
            delete donut.dataset.hoverDomain;
            donut.classList.remove('chart-hovering');
            renderDonutSlices(donut, chartData, null);
        }
        ensureDonutHover();
        animateDonut(donut);
    }
    function renderDaily(report) {
        trackerDaily.replaceChildren();
        const days = report.days || [];
        if (!days.length) {
            const p = document.createElement('p');
            p.className = 'tracker-empty';
            p.textContent = 'Daily totals will appear after you browse.';
            trackerDaily.append(p);
            return;
        }
        const max = Math.max(1, ...days.map(d => d.seconds));
        days.slice(0, 7).forEach(d => { const row = document.createElement('div'); row.className = 'daily-row'; const label = document.createElement('span'); label.textContent = d.day === report.day ? 'Today' : new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); const bar = document.createElement('div'); bar.className = 'tracker-bar daily-bar'; const fill = document.createElement('span'); fill.style.width = '0%'; fill.style.background = '#1677ff'; bar.append(fill); const value = document.createElement('strong'); value.textContent = prettyDuration(d.seconds); row.append(label, bar, value); trackerDaily.append(row); requestAnimationFrame(() => { fill.style.width = `${Math.max(d.seconds ? 2 : 0, d.seconds / max * 100)}%`; }); });
    }
    function renderReport() {
        if (!latestReport)
            return;
        const todaySites = latestReport.sites || [];
        const totalSites = todaySites;
        const isToday = activeReport === 'today';
        const isTotal = activeReport === 'total';
        const total = isToday ? latestReport.totalSeconds : (isTotal ? latestReport.allTimeSeconds : latestReport.totalSeconds);
        trackerTotal.textContent = prettyDuration(total);
        donutTotal.textContent = prettyDuration(total);
        trackerSummaryLabel.textContent = isToday ? 'Today' : (isTotal ? 'All time' : 'Today');
        document.getElementById('tracker-chart-area').hidden = activeReport === 'daily';
        document.getElementById('tracker-list-header').hidden = activeReport === 'daily';
        trackerSites.hidden = activeReport === 'daily';
        trackerDaily.hidden = activeReport !== 'daily';
        if (activeReport === 'daily') {
            renderDaily(latestReport);
            return;
        }
        let sites = totalSites;
        if (isTotal) {
            // All-time per-domain totals are derived from daily maps sent by the tracker.
            sites = latestReport.allSites || totalSites;
        }
        document.getElementById('tracker-list-title').textContent = isTotal ? 'All-time website usage' : 'Websites';
        renderSites(sites, total);
    }
    async function refreshTrackerStats() {
        sendTrackerMessage({ type: 'UPDATE_WEBSITE_BADGE' });
        const report = await sendTrackerMessage({ type: 'GET_WEBSITE_TIME' });
        if (!report) {
            trackerTotal.textContent = 'Tracker unavailable';
            trackerSites.replaceChildren();
            const p = document.createElement('p');
            p.className = 'tracker-empty';
            p.textContent = 'The background tracker did not respond. Open extension Errors to see the cause.';
            trackerSites.append(p);
            return;
        }
        latestReport = report;
        renderReport();
    }
    document.querySelectorAll('.report-tab').forEach(button => button.addEventListener('click', () => { activeReport = button.dataset.report; document.querySelectorAll('.report-tab').forEach(b => b.classList.toggle('active', b === button)); renderReport(); }));
    trackerSort.addEventListener('change', renderReport);
    storageGet([themeKey]).then(values => applyTheme(values[themeKey] === 'dark' ? 'dark' : 'light'));
    refreshTrackerStats();
    // The open popup requests a live report each second, so elapsed time is shown
    // as seconds, then minutes and hours without waiting for the next alarm.
    const liveRefresh = setInterval(refreshTrackerStats, 1000);
    window.addEventListener('unload', () => clearInterval(liveRefresh));
    // Reload matching tabs so changed filters apply to already-open pages.
    document.getElementById('reload-tabs').addEventListener('click', async () => {
        try {
            const query = { url: ['*://youtube.com/*', '*://www.youtube.com/*', '*://m.youtube.com/*', '*://reddit.com/*', '*://www.reddit.com/*', '*://old.reddit.com/*', '*://instagram.com/*', '*://www.instagram.com/*'] };
            const tabs = globalThis.browser ? await api.tabs.query(query) : await new Promise(resolve => api.tabs.query(query, resolve));
            tabs.forEach(tab => { if (tab.id != null)
                api.tabs.reload(tab.id); });
            summary.textContent = `Refreshing ${tabs.length} matching tab${tabs.length === 1 ? '' : 's'}…`;
        }
        catch (_) {
            summary.textContent = 'Close and reopen the site to apply changes';
        }
    });
})();
