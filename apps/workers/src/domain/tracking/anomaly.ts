// 访客异常标识（只做标记，不影响统计和写入）：机房 / 云服务器 IP、疑似 VPN / 代理、疑似机器人
// 依据：运营商名称（Cloudflare 提供的 asOrganization）与浏览器上报的屏幕、语言；规则是经验判断，可能误判，界面上以小图标提示
export type AnomalyType = 'bot' | 'datacenter' | 'vpn'
/** signal：判断依据（界面按它显示说明）；detail：运营商名称、语言、屏幕等原始值 */
export interface Anomaly { type: AnomalyType; signal: string; detail?: string | undefined }

// 云服务商、机房（小写子串匹配）
const DATACENTER = [
  'amazon', 'aws', 'google', 'microsoft', 'azure', 'alibaba', 'aliyun', 'tencent', 'huawei', 'baidu', 'bytedance', 'volcano',
  'digitalocean', 'ovh', 'hetzner', 'linode', 'akamai', 'vultr', 'choopa', 'constant company', 'oracle', 'cloudflare',
  'leaseweb', 'contabo', 'scaleway', 'ucloud', 'kingsoft', 'jd cloud', 'jingdong', 'hosting', 'data center', 'datacenter', 'server',
]
// 常见 VPN / 代理出口
const VPN = [
  'vpn', 'proxy', 'm247', 'datacamp', 'cdn77', 'aventice', 'packethub', 'clouvider', 'zenlayer', 'tefincom', 'hostroyale',
  'nordvpn', 'surfshark', 'mullvad', 'proton ag', 'private internet', 'tunnel', 'xtom',
]

export interface AnomalyInput {
  isp?: string | null
  screen?: string | null
  language?: string | null
  deviceType?: string | null
}

export function detectAnomalies(v: AnomalyInput): Anomaly[] {
  const out: Anomaly[] = []
  const isp = (v.isp ?? '').toLowerCase()
  if (isp) {
    if (VPN.some((k) => isp.includes(k))) out.push({ type: 'vpn', signal: 'vpnIsp', detail: v.isp ?? undefined })
    else if (DATACENTER.some((k) => isp.includes(k))) out.push({ type: 'datacenter', signal: 'hostingIsp', detail: v.isp ?? undefined })
  }
  const lang = (v.language ?? '').toLowerCase()
  const [w, h] = (v.screen ?? '').split('x').map(Number)
  // 服务器环境的语言设置（如 en-US@posix、C），真人浏览器不会出现
  if (lang.includes('@posix') || lang === 'c' || lang === 'posix') out.push({ type: 'bot', signal: 'posixLocale', detail: v.language ?? undefined })
  // 自称手机但屏幕是电脑分辨率（伪装 UA）
  else if (v.deviceType === 'mobile' && w && h && Math.min(w, h) >= 700) out.push({ type: 'bot', signal: 'uaScreenMismatch', detail: v.screen ?? undefined })
  // 无头浏览器常见的默认窗口
  else if (v.deviceType === 'desktop' && v.screen === '800x600') out.push({ type: 'bot', signal: 'headlessScreen', detail: v.screen })
  return out
}

/** 合并多次访问的标识（同一类型只保留一个） */
export function mergeAnomalies(list: Anomaly[][]): Anomaly[] {
  const seen = new Map<AnomalyType, Anomaly>()
  for (const a of list.flat()) if (!seen.has(a.type)) seen.set(a.type, a)
  return [...seen.values()]
}
