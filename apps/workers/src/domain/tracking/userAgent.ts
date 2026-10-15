// 轻量 UA 解析：只识别统计需要的设备类型、系统、浏览器（含国内常见 App 内置浏览器）
// 不引入第三方解析库（Worker CPU 限制）

export interface ParsedUA { deviceType: 'mobile' | 'tablet' | 'desktop'; os: string; browser: string }

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|curl|wget|python-requests|python-urllib|scrapy|httpclient|go-http|java\/|okhttp|axios|node-fetch|phantomjs|selenium|puppeteer|playwright/i

export function isBotUA(ua: string): boolean {
  return !ua || BOT_RE.test(ua)
}

export function parseUserAgent(ua: string): ParsedUA {
  const tablet = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)
  const mobile = !tablet && /Mobi|iPhone|iPod|Android|HarmonyOS|Windows Phone/i.test(ua)

  let os = 'Other'
  if (/HarmonyOS|OpenHarmony/i.test(ua)) os = 'HarmonyOS'
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS'
  else if (/CrOS/i.test(ua)) os = 'ChromeOS'
  else if (/Linux/i.test(ua)) os = 'Linux'

  // App 内置浏览器优先（它们的 UA 里同时带 Chrome / Safari 标识）
  let browser = 'Other'
  if (/MicroMessenger/i.test(ua)) browser = /wxwork/i.test(ua) ? 'WeCom' : 'WeChat'
  else if (/DingTalk/i.test(ua)) browser = 'DingTalk'
  else if (/AlipayClient/i.test(ua)) browser = 'Alipay'
  else if (/aweme|BytedanceWebview|NewsArticle/i.test(ua)) browser = 'Douyin/Toutiao'
  else if (/xhsdiscover/i.test(ua)) browser = 'Xiaohongshu'
  else if (/baiduboxapp|baidubrowser/i.test(ua)) browser = 'Baidu'
  else if (/QQBrowser/i.test(ua)) browser = 'QQ Browser'
  else if (/\bQQ\//i.test(ua)) browser = 'QQ'
  else if (/UCBrowser|UCWEB/i.test(ua)) browser = 'UC'
  else if (/Quark/i.test(ua)) browser = 'Quark'
  else if (/HuaweiBrowser/i.test(ua)) browser = 'Huawei'
  else if (/MiuiBrowser|XiaoMi/i.test(ua)) browser = 'Xiaomi'
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung'
  else if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera'
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox'
  else if (/Chrome|CriOS/i.test(ua)) browser = 'Chrome'
  else if (/Safari/i.test(ua)) browser = 'Safari'

  return { deviceType: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', os, browser }
}
