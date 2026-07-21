---
type: userscript
name: Wider Hacker News
match: https://news.ycombinator.com/*
---

# Wider Hacker News

An extension is a note. This one runs on every Hacker News page and lets the
story table use the whole window instead of its 85% default.

```js
const main = document.querySelector('#hnmain')
if (main) {
  main.setAttribute('width', '100%')
  document.documentElement.dataset.flowmdWideHn = 'on'
}
```
