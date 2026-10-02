/**
 * Handles the "give me N minutes" temporary unlock on the block page.
 * With a daily timer set, N is capped at the time left today and the unlocked
 * time is counted as used. A forced break or an empty budget hides the button.
 */
(function () {
  // During a forced break / when today's time is up, say so on this page
  const desc = document.querySelector(".description");
  const showReason = () => {
    chrome.storage.local.get(["break_until"], (l) => {
      const left = (l.break_until || 0) - Date.now();
      if (desc && left > 0) {
        const m = Math.floor(left / 60000);
        const sec = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
        desc.textContent = `Break time. You were on this for 15 minutes straight. Back in ${m}:${sec}.`;
      }
    });
  };
  showReason();
  setInterval(showReason, 1000);

  const SNOOZE_MS = 15 * 60 * 1000;
  const KNOWN_SETTINGS = [
    "fb_feed",
    "fb_reels",
    "fb_marketplace",
    "yt_shorts",
    "yt_recommended",
    "ig_reels",
  ];

  const params = new URLSearchParams(window.location.search);
  const returnUrl = params.get("return");
  const setting = params.get("setting");
  const btn = document.getElementById("snooze-btn");

  const isValidReturnUrl = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  if (
    !btn ||
    !setting ||
    !KNOWN_SETTINGS.includes(setting) ||
    !returnUrl ||
    !isValidReturnUrl(returnUrl)
  ) {
    if (btn) btn.style.display = "none";
    return;
  }

  const fmtMin = (ms) => {
    const m = Math.max(Math.ceil(ms / 60000), 1);
    return `${m} minute${m === 1 ? "" : "s"}`;
  };

  let grantMs = SNOOZE_MS;
  let breakTimer = null;
  btn.style.display = "none";

  function refresh() {
    chrome.storage.sync.get("time_limit_min", (s) => {
      const limitMin = Math.min(Number(s.time_limit_min) || 0, 90);
      chrome.storage.local.get(["usage_date", "usage_ms", "break_until"], (l) => {
        const breakLeft = (l.break_until || 0) - Date.now();
        if (breakLeft > 0) {
          btn.style.display = "none";
          clearTimeout(breakTimer);
          breakTimer = setTimeout(refresh, breakLeft + 500);
          return;
        }
        grantMs = SNOOZE_MS;
        if (limitMin > 0) {
          const used =
            l.usage_date === new Date().toDateString() ? l.usage_ms || 0 : 0;
          const left = limitMin * 60000 - used;
          if (left <= 0) {
            btn.style.display = "none";
            return;
          }
          grantMs = Math.min(SNOOZE_MS, left);
        }
        btn.disabled = false;
        btn.textContent =
          grantMs < SNOOZE_MS
            ? `Give me my last ${fmtMin(grantMs)}`
            : `I really need ${fmtMin(grantMs)}`;
        btn.style.display = "none"; // unlock button retired: use the popup toggle
      });
    });
  }

  refresh();
  chrome.storage.onChanged.addListener(refresh);

  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Unlocking...";
    chrome.storage.local.set({ snooze_all: Date.now() + grantMs }, () => {
      window.location.href = returnUrl;
    });
  });
})();
