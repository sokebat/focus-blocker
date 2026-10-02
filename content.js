/**
 * CLEAN & SCALABLE CONTENT SCRIPT FOR PUREFOCUS
 * Handles element hiding via CSS injection and powerful redirects.
 */

const CONFIG = {
  facebook: {
    domain: "facebook.com",
    elements: {
      // Only active on the home page (html[data-pf-home] is set in updateInjectedStyles)
      fb_feed: [
        'html[data-pf-home] [role="main"]',
        "html[data-pf-home] [aria-posinset]",
        'html[data-pf-home] [role="feed"]',
        'html[data-pf-home] [data-pagelet*="Feed"]',
        'html[data-pf-home] [data-pagelet="Stories"]',
      ],
      fb_reels: [
        '[aria-label="Reels"]',
        'a[href*="/reels/"]',
        'a[href*="/reel/"]',
        'a[href*="/watch/"]',
        'div[aria-label="Reels tray"]',
        '[data-pagelet="Reels"]',
      ],
      fb_marketplace: [
        '[aria-label="Marketplace"]',
        'a[href*="/marketplace/"]',
      ],
    },
    redirects: [
      { path: "/reels", setting: "fb_reels" },
      { path: "/reel", setting: "fb_reels" },
      { path: "/watch", setting: "fb_reels" },
    ],
  },
  youtube: {
    domain: "youtube.com",
    elements: {
      yt_shorts: {
        selectors: [
          'ytd-guide-entry-renderer:has(a[href="/shorts"])',
          'ytd-mini-guide-entry-renderer:has(a[href="/shorts"])',
          "#shorts-container",
          "ytd-reel-shelf-renderer",
          'a[href^="/shorts"]',
        ],
      },
      yt_recommended: {
        selectors: [
          "#related",
          "ytd-watch-next-secondary-results-renderer",
          'ytd-browse[page-subtype="home"] #contents',
        ],
      },
    },
    redirects: [{ path: "/shorts", setting: "yt_shorts" }],
  },
  instagram: {
    domain: "instagram.com",
    elements: {
      ig_reels: [
        'a[href*="/reels/"]',
        'a[href*="/reels/videos/"]',
        'svg[aria-label="Reels"]',
        'a[href="/explore/"]',
        'a[href^="/explore/"]',
      ],
    },
    redirects: [
      { path: "/reels", setting: "ig_reels" },
      { path: "/explore", setting: "ig_reels" },
    ],
  },
};

let userSettings = {};
let injectedStyleElement = null;
let snoozeTimer = null;

function snoozeKey(setting) {
  return `snooze_${setting}`;
}

const MAX_LIMIT_MIN = 90;
const FLUSH_MS = 1000;
let pendingMs = 0;
let inflightMs = 0; // being written to storage; still counted until the write lands
const SESSION_LIMIT_MS = 15 * 60 * 1000; // continuous use before a forced break
const BREAK_MS = 30 * 60 * 1000;
const SESSION_GAP_MS = 2 * 60 * 1000; // idle longer than this ends a session
let overlayEl = null;

/** Messaging and calls are never blocked: no break screen, no hiding, no counting. */
function isExemptPath() {
  const { hostname, pathname } = window.location;
  if (hostname.includes("messenger.com")) return true;
  return (
    hostname.includes("facebook.com") &&
    ["/messages", "/messenger", "/groupcall", "/videocall", "/call", "/rtc"].some(
      (p) => pathname.startsWith(p),
    )
  );
}

function onBreak() {
  return (
    typeof userSettings.break_until === "number" &&
    Date.now() < userSettings.break_until
  );
}

function fmtClock(ms) {
  const t = Math.ceil(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Full-screen, non-dismissible break screen with a countdown. */
function updateBreakOverlay() {
  // Only the defined restricted pages are covered, never the rest of a site
  if (!(onBreak() && currentRestriction()) || isExemptPath()) {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    return;
  }
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.id = "pure-focus-break";
    overlayEl.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:#0f172a;color:#f8fafc;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "font-family:system-ui,sans-serif;text-align:center;padding:24px;";
    overlayEl.innerHTML =
      '<div style="font-size:48px">&#9749;</div>' +
      '<h1 style="font-size:28px;margin:12px 0 8px;color:#f8fafc">Time for a break</h1>' +
      '<p style="color:#94a3b8;max-width:420px;margin:0 0 20px">You have been scrolling for 15 minutes straight. Step away, stretch, drink some water.</p>' +
      '<div id="pure-focus-count" style="font-size:44px;font-weight:600;color:#a5b4fc"></div>';
    (document.body || document.documentElement).appendChild(overlayEl);
    document.querySelectorAll("video, audio").forEach((m) => m.pause());
  }
  overlayEl.querySelector("#pure-focus-count").textContent = fmtClock(
    userSettings.break_until - Date.now(),
  );
}

function today() {
  return new Date().toDateString();
}

/** Daily watch-time budget in ms (0 = no budget, always block). Capped at 90 min. */
function budgetMs() {
  const min = Number(userSettings.time_limit_min) || 0;
  return Math.min(Math.max(min, 0), MAX_LIMIT_MIN) * 60 * 1000;
}

function usedMs() {
  const stored =
    userSettings.usage_date === today() ? userSettings.usage_ms || 0 : 0;
  return stored + pendingMs + inflightMs;
}

function budgetExhausted() {
  return budgetMs() > 0 && usedMs() >= budgetMs();
}

/** Locked = forced break or daily budget used up: toggles are ignored. */
function locked() {
  return onBreak() || budgetExhausted();
}

function isEnabled(setting) {
  return locked() || !!userSettings[setting];
}

function snoozeActive() {
  const until = userSettings.snooze_all;
  return typeof until === "number" && Date.now() < until;
}

/**
 * Whether a setting is currently unblocked: only during an active unlock
 * ("give me N minutes"), never during a forced break or once the daily
 * budget (if any) is used up.
 */
function isSnoozed() {
  return false; // no temporary unlocks: the toggle is the only control
}

function anyBlockEnabledHere() {
  const hostname = window.location.hostname;
  return Object.values(CONFIG).some(
    (data) =>
      hostname.includes(data.domain) &&
      [
        ...Object.keys(data.elements || {}),
        ...(data.redirects || []).map((r) => r.setting),
      ].some((k) => isEnabled(k)),
  );
}

/** Adds elapsed watch time to today's total in local storage. */
function flushUsage() {
  if (!pendingMs) return;
  const delta = pendingMs;
  pendingMs = 0;
  inflightMs += delta;
  chrome.storage.local.get(
    ["usage_date", "usage_ms", "session_ms", "session_last"],
    (r) => {
      const now = Date.now();
      const base = r.usage_date === today() ? r.usage_ms || 0 : 0;
      const fresh = !r.session_last || now - r.session_last > SESSION_GAP_MS;
      const session = (fresh ? 0 : r.session_ms || 0) + delta;
      const update = {
        usage_date: today(),
        usage_ms: base + delta,
        session_ms: session,
        session_last: now,
      };
      if (session >= SESSION_LIMIT_MS) {
        update.break_until = now + BREAK_MS;
        update.session_ms = 0;
      }
      Object.assign(userSettings, update);
      inflightMs -= delta;
      chrome.storage.local.set(update);
    },
  );
}

/** The restriction rule matching the current URL, if any. */
function currentRestriction() {
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;
  for (const data of Object.values(CONFIG)) {
    if (!hostname.includes(data.domain)) continue;
    for (const rule of data.redirects || []) {
      if (rule.exact ? pathname === rule.path : pathname.startsWith(rule.path)) {
        return rule;
      }
    }
  }
  return null;
}

/** On a restricted page whose block is switched OFF (so it is being watched). */
function onRestrictedPath() {
  if (isExemptPath()) return false;
  const rule = currentRestriction();
  return !!rule && !isEnabled(rule.setting);
}

/** Every setting key, for switching them all on when locked. */
function allSettingKeys() {
  const keys = new Set();
  for (const data of Object.values(CONFIG)) {
    Object.keys(data.elements || {}).forEach((k) => keys.add(k));
    (data.redirects || []).forEach((r) => keys.add(r.setting));
  }
  return [...keys];
}

/** When locked (time up or break), flip every toggle ON and keep it that way. */
function enforceToggles() {
  if (!locked()) return;
  const patch = {};
  for (const k of allSettingKeys()) {
    if (!userSettings[k]) patch[k] = true;
  }
  if (Object.keys(patch).length) {
    Object.assign(userSettings, patch);
    chrome.storage.sync.set(patch);
  }
}

let badgeEl = null;

function placeBadge(el, x, y) {
  const maxX = window.innerWidth - el.offsetWidth;
  const maxY = window.innerHeight - el.offsetHeight;
  el.style.left = `${Math.min(Math.max(x, 0), Math.max(maxX, 0))}px`;
  el.style.top = `${Math.min(Math.max(y, 0), Math.max(maxY, 0))}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}

/** Lets the user drag the badge anywhere; the spot is remembered. */
function makeBadgeDraggable(el) {
  const saved = userSettings.badge_pos;
  if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
    placeBadge(el, saved.x, saved.y);
  }
  // Listen on window in the capture phase so the host page can't swallow the events
  let drag = null;
  const onBadge = (e) => e.composedPath().includes(el);

  const downTypes = ["pointerdown", "mousedown"];
  const moveTypes = ["pointermove", "mousemove"];
  downTypes.forEach((type) => window.addEventListener(
    type,
    (e) => {
      if (drag || !onBadge(e) || e.button > 0) return;
      const rect = el.getBoundingClientRect();
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      el.style.cursor = "grabbing";
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  ));
  moveTypes.forEach((type) => window.addEventListener(
    type,
    (e) => {
      if (!drag) return;
      placeBadge(el, e.clientX - drag.dx, e.clientY - drag.dy);
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  ));
  const end = (e) => {
    if (!drag) return;
    drag = null;
    el.style.cursor = "grab";
    const r = el.getBoundingClientRect();
    userSettings.badge_pos = { x: r.left, y: r.top };
    chrome.storage.local.set({ badge_pos: userSettings.badge_pos });
    e.stopImmediatePropagation();
  };
  ["pointerup", "pointercancel", "mouseup"].forEach((type) =>
    window.addEventListener(type, end, true),
  );
  // Block the click/mouse events the page would otherwise act on (e.g. play/pause)
  ["click"].forEach((type) =>
    window.addEventListener(
      type,
      (e) => {
        if (onBadge(e)) e.stopImmediatePropagation();
      },
      true,
    ),
  );
}

/** Small live "time left" pill shown while restricted content is being used. */
function updateTimerBadge(show) {
  if (!show) {
    if (badgeEl) {
      badgeEl.remove();
      badgeEl = null;
    }
    return;
  }
  if (!badgeEl) {
    badgeEl = document.createElement("div");
    badgeEl.id = "pure-focus-badge";
    badgeEl.style.cssText =
      "position:fixed;inset:auto;margin:0;right:16px;bottom:16px;z-index:2147483646;padding:10px 16px;" +
      "border-radius:14px;text-align:center;background:rgba(15,23,42,0.92);color:#f8fafc;" +
      "font:600 13px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);" +
      "border:1px solid rgba(165,180,252,.4);cursor:grab;user-select:none;touch-action:none;";
    badgeEl.setAttribute("popover", "manual");
    (document.body || document.documentElement).appendChild(badgeEl);
    try {
      badgeEl.showPopover(); // top layer: stays above page overlays/dialogs
    } catch {}
    makeBadgeDraggable(badgeEl);
  }
  const left = Math.max(budgetMs() - usedMs(), 0);
  const fresh =
    !userSettings.session_last ||
    Date.now() - userSettings.session_last > SESSION_GAP_MS;
  const sessionUsed = (fresh ? 0 : userSettings.session_ms || 0) + pendingMs + inflightMs;
  const sessionLeft = Math.max(SESSION_LIMIT_MS - sessionUsed, 0);
  // You can watch until the next forced break or until today's budget ends
  const watchLeft = Math.min(sessionLeft, left);
  badgeEl.innerHTML =
    `<div style="font-size:11px;opacity:.7;letter-spacing:.05em">YOU CAN WATCH FOR</div>` +
    `<div style="font-size:26px;line-height:1.1">${fmtClock(watchLeft)}</div>` +
    `<div style="font-size:11px;opacity:.7">${fmtClock(left)} left today · used ${fmtClock(usedMs())}</div>`;
  badgeEl.style.borderColor =
    watchLeft < 60000 ? "rgba(248,113,113,.8)" : "rgba(165,180,252,.4)";
}

function startUsageTimer() {
  let lastTick = Date.now();
  let lastFlush = Date.now();
  setInterval(() => {
    const now = Date.now();
    const elapsed = Math.min(now - lastTick, 2000);
    lastTick = now;

    const counting =
      budgetMs() > 0 &&
      !locked() &&
      onRestrictedPath() &&
      document.visibilityState === "visible";
    if (counting) pendingMs += elapsed;
    updateTimerBadge(counting);

    if (budgetMs() > 0 && budgetExhausted() && !blockedAfterBudget) {
      blockedAfterBudget = true;
      flushUsage();
      enforceToggles();
      if (handleRedirects()) return;
      updateInjectedStyles();
    }
    if (overlayEl || onBreak()) {
      const wasOverlay = !!overlayEl;
      updateBreakOverlay();
      if (wasOverlay && !overlayEl) {
        // break just ended
        updateInjectedStyles();
      }
    }
    if (now - lastFlush >= FLUSH_MS) {
      lastFlush = now;
      flushUsage();
    }
  }, 1000);
}

let blockedAfterBudget = false;

/**
 * Schedules a re-check for the moment the soonest active snooze expires,
 * so blocking resumes automatically without waiting for navigation/polling.
 */
function scheduleSnoozeExpiry() {
  if (snoozeTimer) {
    clearTimeout(snoozeTimer);
    snoozeTimer = null;
  }

  const now = Date.now();
  let nextExpiry = Infinity;
  for (const key in userSettings) {
    if (key.startsWith("snooze_")) {
      const until = userSettings[key];
      if (typeof until === "number" && until > now && until < nextExpiry) {
        nextExpiry = until;
      }
    }
  }

  if (nextExpiry !== Infinity) {
    snoozeTimer = setTimeout(async () => {
      await loadSettings();
      if (handleRedirects()) return;
      updateInjectedStyles();
      scheduleSnoozeExpiry();
    }, nextExpiry - now + 250);
  }
}

/**
 * Loads settings from storage.
 * Toggle settings live in sync storage; temporary snooze timers live in
 * local storage since they're ephemeral and shouldn't sync across devices.
 */
async function loadSettings() {
  const [syncSettings, localSettings] = await Promise.all([
    new Promise((resolve) => chrome.storage.sync.get(null, resolve)),
    new Promise((resolve) => chrome.storage.local.get(null, resolve)),
  ]);
  userSettings = { ...syncSettings, ...localSettings };
  return userSettings;
}

/**
 * Injects CSS to hide elements instantly
 */
function updateInjectedStyles() {
  const hostname = window.location.hostname;
  const root = document.documentElement;
  if (hostname.includes("facebook.com") && window.location.pathname === "/") {
    root.setAttribute("data-pf-home", "");
  } else {
    root.removeAttribute("data-pf-home");
  }
  let css = "";
  if (isExemptPath()) {
    if (injectedStyleElement) injectedStyleElement.textContent = "";
    return;
  }

  for (const [platform, data] of Object.entries(CONFIG)) {
    if (hostname.includes(data.domain)) {
      if (data.elements) {
        for (const [setting, config] of Object.entries(data.elements)) {
          if (isEnabled(setting) && !isSnoozed(setting)) {
            const selectors = Array.isArray(config) ? config : config.selectors;
            selectors.forEach((selector) => {
              css += `${selector} { display: none !important; }\n`;
            });
          }
        }
      }
    }
  }

  if (!injectedStyleElement) {
    injectedStyleElement = document.createElement("style");
    injectedStyleElement.id = "pure-focus-dynamic-styles";
    (document.head || document.documentElement).appendChild(
      injectedStyleElement,
    );
  }
  injectedStyleElement.textContent = css;
}

/**
 * Handles redirects based on settings and path
 */
function handleRedirects() {
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;

  for (const [platform, data] of Object.entries(CONFIG)) {
    if (hostname.includes(data.domain) && data.redirects) {
      for (const rule of data.redirects) {
        if (isEnabled(rule.setting) && !isSnoozed(rule.setting)) {
          const isMatch = rule.exact
            ? pathname === rule.path
            : pathname.startsWith(rule.path);
          if (isMatch) {
            const blockUrl = new URL(chrome.runtime.getURL("block.html"));
            blockUrl.searchParams.set("return", window.location.href);
            blockUrl.searchParams.set("setting", rule.setting);
            window.location.replace(blockUrl.toString());
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Main initialization
 */
async function init() {
  await loadSettings();

  if (handleRedirects()) return;

  updateInjectedStyles();
  scheduleSnoozeExpiry();
  blockedAfterBudget = budgetExhausted();
  enforceToggles();
  startUsageTimer();

  // Monitor for navigation in SPAs
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (handleRedirects()) return;
      updateInjectedStyles();
    }
  }, 500);
}

// Listen for settings changes from popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SETTINGS_CHANGED") {
    userSettings = { ...userSettings, ...message.settings };
    updateInjectedStyles();
    handleRedirects();
  }
});

// Keep limit/usage in sync across tabs and with the popup
chrome.storage.onChanged.addListener((changes, area) => {
  let touched = false;
  for (const [k, c] of Object.entries(changes)) {
    if (k === "time_limit_min" || k.startsWith("usage_") || k === "break_until" || k.startsWith("session_") || k.startsWith("snooze_")) {
      userSettings[k] = c.newValue;
      touched = true;
    }
  }
  if (touched) {
    blockedAfterBudget = budgetExhausted();
    enforceToggles();
    updateBreakOverlay();
    scheduleSnoozeExpiry();
    if (!handleRedirects()) updateInjectedStyles();
  }
});

init();
