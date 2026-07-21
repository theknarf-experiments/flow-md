// Kept in a separate file rather than inline: the IWA CSP forbids inline
// script, and the probe should obey the same rules the shell does.
const KEY = 'flow-md-probe-loads'
let n = 0
try {
  n = Number(localStorage.getItem(KEY) ?? '0') + 1
  localStorage.setItem(KEY, String(n))
  document.getElementById('t').textContent = 'localStorage OK'
} catch (e) {
  document.getElementById('t').textContent = `localStorage blocked: ${e.name}`
}
document.getElementById('n').textContent = String(n)
document.title = `probe #${n}`
