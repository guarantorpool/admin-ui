// Set the theme before first paint so dark mode doesn't flash light. Loaded from index.html as a plain script,
// not inline, so the Content Security Policy can allow scripts from the portal itself only (D-003).
try {
  var t = localStorage.getItem('blockcoop-theme');
  if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
