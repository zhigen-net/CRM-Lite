// 采集脚本 t.js：由网站通过同域路径 /_t/t.js 加载，只向同域 /_t/collect 上报，脚本里不出现 CRM 地址
// 保持小巧、无依赖；任何异常都不能影响网站本身
export const TRACKER_SCRIPT = `(function () {
  if (window.__crmTracker) return
  var ENDPOINT = '/_t/collect', VID = 'crm_vid', SID = 'crm_sid', SLAST = 'crm_slast', SESSION_MS = 30 * 60 * 1000
  var PARAMS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','bd_vid','bdclkid','clickid','gdt_vid','qz_gdt','gclid','wbraid','gbraid','fbclid','msclkid','ttclid']
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16) })
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v) } catch (e) { return null } }
  function cookie(k, v) {
    try {
      if (v === undefined) { var m = document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null }
      document.cookie = k + '=' + encodeURIComponent(v) + '; path=/; max-age=31536000; SameSite=Lax'
    } catch (e) { return null }
  }
  var vid = store(VID) || cookie(VID) || uuid(); store(VID, vid); cookie(VID, vid)
  function session() {
    var now = Date.now(), sid = store(SID), last = Number(store(SLAST) || 0)
    if (!sid || now - last > SESSION_MS) { sid = uuid(); store(SID, sid) }
    store(SLAST, String(now)); return sid
  }
  function params() {
    var out = {}, q = new URLSearchParams(location.search)
    for (var i = 0; i < PARAMS.length; i++) { var v = q.get(PARAMS[i]); if (v) out[PARAMS[i]] = v }
    return out
  }
  function send(events, beacon) {
    try {
      var body = JSON.stringify({ v: vid, s: session(), e: events, scr: screen.width + 'x' + screen.height,
        lg: navigator.language, net: navigator.connection && navigator.connection.effectiveType, wd: navigator.webdriver ? 1 : 0 })
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' })); return }
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {})
    } catch (e) {}
  }
  var pageStart = Date.now(), maxScroll = 0, lastPath = null
  function pageview() {
    var path = location.pathname + location.search
    if (path === lastPath) return
    lastPath = path; pageStart = Date.now(); maxScroll = 0
    send([{ id: uuid(), t: 'pageview', p: path, ti: document.title, r: document.referrer, h: location.hostname, q: params() }])
  }
  function leave() {
    if (!lastPath) return
    send([{ id: uuid(), t: 'leave', p: lastPath, d: Date.now() - pageStart, sc: maxScroll }], true)
    pageStart = Date.now()
  }
  window.addEventListener('scroll', function () {
    var h = document.documentElement.scrollHeight - innerHeight
    if (h > 0) maxScroll = Math.max(maxScroll, Math.min(100, Math.round(scrollY / h * 100)))
  }, { passive: true })
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leave() })
  // 单页应用：路由变化时记一次离开 + 一次浏览
  ;['pushState', 'replaceState'].forEach(function (fn) {
    var orig = history[fn]
    history[fn] = function () { var r = orig.apply(this, arguments); setTimeout(function () { if (location.pathname + location.search !== lastPath) { leave(); pageview() } }, 0); return r }
  })
  window.addEventListener('popstate', function () { leave(); pageview() })
  // 关键行为：点击电话、复制微信号（不上报复制的内容）
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href^="tel:"]')
    if (a) send([{ id: uuid(), t: 'tel', p: location.pathname }])
  }, true)
  document.addEventListener('copy', function () {
    var text = String(window.getSelection ? window.getSelection() : '').trim()
    if (/^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/.test(text) || /微信|wechat|weixin/i.test(text)) send([{ id: uuid(), t: 'wechat', p: location.pathname }])
  }, true)
  // 表单：自动带上访客 ID（隐藏字段 crm_vid），提交时记一次
  function tagForms(root) {
    var forms = (root || document).querySelectorAll ? (root || document).querySelectorAll('form') : []
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('input[name="crm_vid"]')) continue
      var input = document.createElement('input'); input.type = 'hidden'; input.name = 'crm_vid'; input.value = vid
      forms[i].appendChild(input)
    }
  }
  document.addEventListener('submit', function () { send([{ id: uuid(), t: 'form', p: location.pathname }], true) }, true)
  if (window.MutationObserver) new MutationObserver(function () { tagForms() }).observe(document.documentElement, { childList: true, subtree: true })
  window.__crmTracker = {
    visitorId: vid,
    track: function (name, meta) { send([{ id: uuid(), t: 'custom', p: location.pathname, m: { name: String(name).slice(0, 50), data: meta } }]) },
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { tagForms(); pageview() })
  else { tagForms(); pageview() }
})();
`
