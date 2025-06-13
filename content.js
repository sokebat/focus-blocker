const blockedPaths = [
    { domain: "youtube.com", path: "/shorts" },
    { domain: "facebook.com", path: "/watch" },
    { domain: "facebook.com", path: "/reel" },
    { domain: "instagram.com", path: "/reels" },
    { domain: "snapchat.com", path: "/spotlight" }
  ];
  
  function checkAndRedirect() {
    const { hostname, pathname } = window.location;
  
    for (const block of blockedPaths) {
      if (hostname.includes(block.domain) && pathname.startsWith(block.path)) {
        window.location.href = chrome.runtime.getURL("block.html");
        break;
      }
    }
  }
  
  // Run immediately
  checkAndRedirect();
  
  // Also monitor changes for SPA sites (like YouTube)
  let lastPath = location.pathname;
  const observer = new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      checkAndRedirect();
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  