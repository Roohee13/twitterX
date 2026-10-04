// Runs before the page is drawn (it is a blocking script in <head>), so the first paint already has the right colours.
// Keep it in step with src/lib/theme.ts. It is a separate file, not inline, so a strict Content-Security-Policy does not have to allow inline scripts.
;(function () {
  var theme = 'dark'
  try {
    var saved = localStorage.getItem('xclone.theme')
    if (saved === 'light' || saved === 'dark') theme = saved
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light'
  } catch {
    /* storage or matchMedia unavailable: the dark theme */
  }
  document.documentElement.setAttribute('data-theme', theme)
})()
