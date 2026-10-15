/*
 * Distraction-filter content script for Remove Internet Distraction.
 * Reads the supplied uBlock-style cosmetic lists, categorizes each rule into a
 * named feature, then emits CSS only for features whose switches are enabled.
 * A few uBlock procedural operators are not browser-native; unsupported rules
 * are skipped safely rather than breaking the entire filter list.
 */

(() => {
    'use strict';
    const api = globalThis.browser || globalThis.chrome;
    const catalogue = globalThis.FOCUS_FILTER_FEATURES;
    const host = location.hostname.toLowerCase();
    const site = host.includes('youtube.com') ? 'youtube' : host.includes('reddit.com') ? 'reddit' : host.includes('instagram.com') ? 'instagram' : null;
    if (!site || !catalogue?.[site] || !api?.runtime?.getURL)
        return;
    const filterFile = { youtube: 'youtube-strict.txt', reddit: 'reddit.txt', instagram: 'instagram.txt' }[site];
    const masterKey = `enabled_${site}`;
    const featureKey = id => `feature_${site}_${id}`;
    const styleId = `focus-filter-styles-${site}`;
    const hiddenClassPrefix = `focus-filter-hidden-${site}-`;
    let observer = null;
    let rulesByFeature = {};
    let preferences = {};
    let dynamicRules = [];
    // Categorize individual selectors. The section name provides context, while
    // selector matching lets specific controls (such as YouTube likes) get their
    // own toggle even when the original list placed them in a broader section.
    function classifyFeature(selector, section, rawLine) {
        const s = `${selector} ${rawLine}`.toLowerCase();
        const h = (section || '').toLowerCase();
        const has = (...terms) => terms.some(term => s.includes(term));
        if (site === 'youtube') {
            if (has('like-button-view-model', 'like-button', 'like button'))
                return 'likes';
            if (has('ytd-ad-', 'ad-slot', 'masthead-ad', 'carousel-ad', 'companion-ad', 'promoted', 'promo-renderer', 'display-ad'))
                return 'ads';
            if (has('is_sub_short', 'badge-text') || h.includes('subscriptions'))
                return 'subscriptions';
            if (has('is_short', 'ytd-reel', 'reel-shelf', 'shorts', 'overlay-style="shorts"', 'grid-shelf-view-model'))
                return 'shorts';
            if (has('video-preview', 'mouseover-overlay', 'thumbnail-overlay-loading-preview'))
                return 'hoverPreviews';
            if (has('page-subtype="home"', 'homepage') || h === 'homepage' || h.includes('home page'))
                return 'homepage';
            if (has('#secondary', '#related', 'watch-next-secondary', 'related videos', 'sidebar / related'))
                return 'relatedVideos';
            if (has('suggestqueries', 'searchboxcomponentsuggestions', 'suggestionscontainer'))
                return 'searchSuggestions';
            if (has('ytd-search', 'container.ytd-search', 'ytd-shelf-renderer', 'continuation-item-renderer'))
                return 'searchResults';
            if (has('#comments', 'comment-teaser', 'comment-thread', 'author-text', 'author-thumbnail', 'vote-count-middle', 'engagement-panel-comments'))
                return 'comments';
            if (has('is-channel-for-you-section', 'is-playlist-suggestions', 'horizontal-card-list-renderer', 'people also search'))
                return 'channelRecommendations';
            if (has('ytp-endscreen', 'html5-endscreen', 'ytp-fullscreen-grid-stills', 'pause-overlay', 'ytp-ce-element', 'ytp-cards'))
                return 'playerOverlays';
            if (has('ytd-watch-flexy[theater]', 'full-bleed-container', 'scrollbar-width'))
                return 'theaterMode';
            if (has('#logo', 'voice-search-button', 'masthead.style-scope', 'your logo'))
                return 'branding';
            if (has('ytd-guide-', 'mini-guide', 'feed/trending', 'feed/explore', 'guide-button', 'feed/subscriptions', 'a[href="/"]'))
                return 'navigation';
            if (has('owner-sub-count', '#metadata', '#chat', 'notification-topbar', 'info-panel', 'video-summary', 'social-links', 'transcript-section', 'infocards-section', 'metadata carousel', 'scroll-container', '#actions', '#menu-container'))
                return 'videoMetadata';
            if (h.includes('shorts'))
                return 'shorts';
            if (h.includes('comments'))
                return 'comments';
            if (h.includes('search suggestion'))
                return 'searchSuggestions';
            if (h.includes('promoted') || h.includes('ads'))
                return 'ads';
            if (h.includes('navigation') || h.includes('left bar') || h.includes('sidebar / guide'))
                return 'navigation';
            if (h.includes('related'))
                return 'relatedVideos';
            if (h.includes('endscreen') || h.includes('overlays'))
                return 'playerOverlays';
            if (h.includes('controls & metadata'))
                return 'videoMetadata';
            if (h.includes('full window mode') || h.includes('theater mode'))
                return 'theaterMode';
            return 'videoMetadata';
        }
        if (site === 'reddit') {
            // Match the most specific comment controls before broad comment containers,
            // so each category remains independently toggleable.
            if (has('faceplate-number', 'upvote number') || h.includes('comment voting'))
                return 'commentVoting';
            if (has('comment-main-grid', 'comment + share + upvote', 'nd\:hidden'))
                return 'commentActions';
            if (has('items-center.flex-nowrap.flex-row.flex', 'comment username', 'timestamp'))
                return 'userMetadata';
            if (has('comment-children', 'shreddit-comment', 'comment container') || h === 'comments' || h.includes('comment avatar'))
                return 'comments';
            if (has('pt-md.pb-2xs.relative', 'subreddit header in post', 'subreddit / post header'))
                return 'subredditHeader';
            if (has('px-md.border-neutral-border.border-b-sm', 'complete header', 'top header / navigation bar'))
                return 'header';
            if (has('fixed-sidebar', 'left-sidebar', 'flex-sidebar') || h.includes('related posts'))
                return h.includes('related') ? 'relatedPosts' : 'homeFeed';
            if (has('right-sidebar') || h.includes('right sidebar'))
                return 'rightSidebar';
            if (has('login sidebar', 'h-screen-without-header', 'bg-neutral-background-weak.rounded-4'))
                return 'loginSidebar';
            if (has('justify-start.items-center.gap-xs.flex.pe-lg', 'reddit icon'))
                return 'redditBranding';
            if (has('max-w-\[750px\]', 'search header'))
                return 'searchHeader';
            if (h.includes('left sidebar'))
                return 'leftSidebar';
            if (h.includes('homepage') || h.includes('feed'))
                return 'homeFeed';
            if (h.includes('header'))
                return 'header';
            return 'leftSidebar';
        } // Instagram: each Reel action has its own independently switchable feature.
        if (site === 'instagram') {
            if (has('suggested for you', 'xvbhtw8') || h.includes('suggested for you'))
                return 'suggestions';
            if (has('stories status bar', 'profile status bar') || h.includes('stories status bar') || h.includes('profile status bar'))
                return 'stories';
            if (has('a[href="/reels/"]', 'reels link', 'left navbar — reels'))
                return 'reelsNavigation';
            if (h.includes('comments button') || has('comments button'))
                return 'reelsComments';
            if (h.includes('like button') || has('like button'))
                return 'reelsLikes';
            if (h.includes('save button') || has('save button'))
                return 'reelsSave';
            if (h.includes('share button') || has('share button'))
                return 'reelsShare';
            if (h.includes('profile avatar') || has('profile avatar'))
                return 'reelsProfile';
            if (h.includes('more (⋯) button') || has('more (⋯) button', 'more button'))
                return 'reelsMore';
            if (h.includes('full reel video overlay removal') || has('full reel video overlay removal'))
                return 'reelsOverlay';
            if (has('right panel', 'your account card', 'right panel footer', 'messages widget'))
                return 'rightPanel';
            if (h.includes('reels — in-video interactions'))
                return 'reelsOverlay';
            if (h.includes('left navbar — reels'))
                return 'reelsNavigation';
            if (h.includes('right panel'))
                return 'rightPanel';
            if (h.includes('home feed'))
                return 'homeFeed';
            return 'rightPanel';
        }
        return null;
    }
    async function readFilterList() {
        // Content scripts execute alongside the page and cannot reliably fetch
        // chrome-extension:// resources directly. Ask the extension background
        // context to read the packaged list instead.
        const response = await api.runtime.sendMessage({ type: 'LOAD_FILTER_LIST', file: filterFile });
        if (!response || !response.ok || typeof response.text !== 'string') {
            throw new Error(response && response.error || `Could not load ${filterFile}`);
        }
        return response.text;
    }
    function parseFilterList(source) {
        const grouped = Object.fromEntries(catalogue[site].features.map(f => [f.id, []]));
        const dynamic = [];
        let section = '';
        for (const original of source.split(/\r?\n/)) {
            const line = original.trim();
            // The source list uses comment headings. Remember the most recent heading
            // so selectors in broad sections can still be categorized sensibly.
            if (line.startsWith('!')) {
                const comment = line.slice(1).trim();
                if (comment && !/^[-=]{3,}$/.test(comment) && !comment.startsWith('Title:') && !comment.startsWith('Description:') && !comment.startsWith('Last modified:') && !comment.startsWith('Homepage:') && !comment.startsWith('License:') && !comment.startsWith('Source:'))
                    section = comment;
                continue;
            }
            if (!line || line.startsWith('#') || line.startsWith('['))
                continue;
            const marker = line.indexOf('##');
            if (marker < 0)
                continue; // Network filters require a request-blocking API/rule set.
            const domains = line.slice(0, marker).split(',').map(d => d.trim().replace(/^\*\./, '').replace(/^\|\|/, ''));
            if (!domains.some(d => d === host || host.endsWith(`.${d}`) || d === ''))
                continue;
            let selector = line.slice(marker + 2).trim();
            if (!selector)
                continue;
            let styleDeclarations = '';
            const styleMatch = selector.match(/:style\(([^()]*)\)\s*$/);
            if (styleMatch) {
                styleDeclarations = styleMatch[1];
                selector = selector.slice(0, styleMatch.index).trim();
            }
            const feature = classifyFeature(selector, section, line);
            if (!feature || !grouped[feature])
                continue;
            const textMatch = selector.match(/:has-text\((\/.*\/i?)\)\s*$/);
            if (textMatch) {
                const pattern = textMatch[1], lastSlash = pattern.lastIndexOf('/');
                dynamic.push({ feature, selector: selector.slice(0, textMatch.index).trim() || '*', expression: pattern.slice(1, lastSlash), flags: pattern.slice(lastSlash + 1).replace(/[^gimsuy]/g, ''), styleDeclarations });
                continue;
            }
            // Ignore unsupported selector syntax, but keep processing the other rules.
            try {
                document.querySelector(selector);
                grouped[feature].push(styleDeclarations ? `${selector} { ${styleDeclarations} }` : `${selector} { display: none !important; }`);
            }
            catch (_) { /* uBlock procedural selectors may not be valid native CSS. */ }
        }
        return { grouped, dynamic };
    }
    function readPreferences() {
        const keys = [masterKey, ...catalogue[site].features.map(f => featureKey(f.id))];
        return new Promise(resolve => {
            try {
                const accept = values => {
                    preferences = { master: typeof values?.[masterKey] === 'boolean' ? values[masterKey] : true };
                    catalogue[site].features.forEach(f => preferences[f.id] = typeof values?.[featureKey(f.id)] === 'boolean' ? values[featureKey(f.id)] : true);
                    resolve();
                };
                if (globalThis.browser)
                    api.storage.local.get(keys).then(accept).catch(() => { preferences.master = true; resolve(); });
                else
                    api.storage.local.get(keys, accept);
            }
            catch (_) {
                preferences.master = true;
                resolve();
            }
        });
    }
    function featureIsOn(id) { return preferences.master && preferences[id] !== false; }
    function removeFeatureClasses() {
        document.querySelectorAll('[class*="focus-filter-hidden-' + site + '-"]').forEach(el => {
            [...el.classList].filter(c => c.startsWith(hiddenClassPrefix)).forEach(c => el.classList.remove(c));
        });
    }
    function applyFilters() {
        document.getElementById(styleId)?.remove();
        removeFeatureClasses();
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (!preferences.master)
            return;
        // Build a single stylesheet from enabled feature buckets. Each toggle only
        // contributes the CSS rules assigned to that feature.
        const activeCss = [];
        Object.entries(rulesByFeature).forEach(([feature, rules]) => { if (featureIsOn(feature))
            activeCss.push(...rules); });
        if (activeCss.length) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = activeCss.join('\n');
            (document.head || document.documentElement).appendChild(style);
        }
        if (dynamicRules.some(rule => featureIsOn(rule.feature))) {
            observer = new MutationObserver(() => {
                if (applyFilters.queued)
                    return;
                applyFilters.queued = true;
                queueMicrotask(() => { applyFilters.queued = false; applyDynamicRules(); });
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            applyDynamicRules();
        }
    }
    function applyDynamicRules() {
        if (!preferences.master)
            return;
        for (const rule of dynamicRules) {
            if (!featureIsOn(rule.feature))
                continue;
            let regex, elements;
            try {
                regex = new RegExp(rule.expression, rule.flags);
                elements = document.querySelectorAll(rule.selector);
            }
            catch (_) {
                continue;
            }
            for (const element of elements) {
                const text = (element.innerText || element.textContent || '').trim();
                if (text && regex.test(text)) {
                    // Feature-specific classes let the user reverse one rule group without
                    // undoing unrelated filters on the same page.
                    element.classList.add(`${hiddenClassPrefix}${rule.feature}`);
                }
            }
        }
    }
    Promise.all([readFilterList(), readPreferences()]).then(([source]) => {
        const parsed = parseFilterList(source);
        rulesByFeature = parsed.grouped;
        dynamicRules = parsed.dynamic;
        // A class per feature keeps text-based rules reversible and independently toggleable.
        const helperStyle = document.createElement('style');
        helperStyle.id = `${styleId}-helper`;
        helperStyle.textContent = catalogue[site].features.map(f => `.${hiddenClassPrefix}${f.id}{display:none!important;}`).join('\n');
        (document.head || document.documentElement).appendChild(helperStyle);
        applyFilters();
        // Update the page immediately when any master or feature switch changes.
        api.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local')
                return;
            let changed = false;
            if (changes[masterKey]) {
                preferences.master = changes[masterKey].newValue !== false;
                changed = true;
            }
            catalogue[site].features.forEach(f => {
                const key = featureKey(f.id);
                if (changes[key]) {
                    preferences[f.id] = changes[key].newValue !== false;
                    changed = true;
                }
            });
            if (changed)
                applyFilters();
        });
    }).catch(error => console.warn('[Focus Filter] Could not initialise filters:', error));
})();
