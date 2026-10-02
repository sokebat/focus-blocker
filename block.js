/**
 * Handles the "give me 15 minutes" temporary unlock on the block page.
 */
(function () {
  const SNOOZE_MINUTES = 15;
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

  chrome.storage.sync.get("time_limit_min", (r) => {
    if (Number(r.time_limit_min) > 0) btn.style.display = "none";
  });

  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Unlocking...";

    const until = Date.now() + SNOOZE_MINUTES * 60 * 1000;
    chrome.storage.local.set({ [`snooze_${setting}`]: until }, () => {
      window.location.href = returnUrl;
    });
  });
})();
