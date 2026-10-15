/* Tracks real user input for configurable inactivity pausing.
 * Mirrors the reference tracker: input events refresh the idle deadline, while
 * the background owns the actual session accounting and automatic resume.
 */

(() => {
    'use strict';
    const api = globalThis.browser || globalThis.chrome;
    if (!api?.runtime?.sendMessage)
        return;
    let lastSent = 0;
    let lastActivityAt = Date.now();
    const SEND_THROTTLE_MS = 100;
    function sendActivity(at) {
        try {
            const result = api.runtime.sendMessage({ type: 'USER_ACTIVITY', at });
            if (result && typeof result.then === 'function')
                result.catch(() => { });
        }
        catch (_) {
            // The background service worker may be restarting; the next input event retries.
        }
    }
    function reportActivity() {
        const now = Date.now();
        lastActivityAt = now;
        if (now - lastSent < SEND_THROTTLE_MS)
            return;
        lastSent = now;
        sendActivity(now);
    }
    // Use capture listeners on both document and window. Some sites stop or
    // retarget bubbling events, so capture phase is important for reliable input.
    const events = [
        'pointerdown', 'pointermove', 'pointerup', 'pointerrawupdate',
        'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick',
        'keydown', 'keyup', 'keypress', 'input', 'change',
        'wheel', 'scroll', 'touchstart', 'touchmove', 'touchend',
        'dragstart', 'dragover', 'drop'
    ];
    for (const type of events) {
        window.addEventListener(type, reportActivity, { capture: true, passive: true });
        document.addEventListener(type, reportActivity, { capture: true, passive: true });
    }
    // Resume after returning to a tab/window, including when the first activity
    // event is focus-related rather than a mouse click.
    window.addEventListener('focus', reportActivity, true);
    window.addEventListener('pageshow', reportActivity, true);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible')
            reportActivity();
    }, true);
    // Establish the initial activity window as soon as the content script loads.
    reportActivity();
    // Keep blocking checks independent from the time-tracking activity stream.
    const blockingCheck = () => {
        try {
            const result = api.runtime.sendMessage({ type: 'CHECK_BLOCKING_NOW' });
            if (result && typeof result.then === 'function')
                result.catch(() => { });
        }
        catch (_) { }
    };
    setInterval(blockingCheck, 2000);
    blockingCheck();
})();
