// Apply the saved theme before first paint (avoids a flash). Kept as a file so the CSP can forbid inline scripts.
try {
  var t = localStorage.getItem('hh-theme');
  var dark = t === 'dark' || ((!t || t === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
