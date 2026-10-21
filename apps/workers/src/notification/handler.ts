import { describeContactMatches, findContactMatches } from '../domain/leads/dedupe'
import { sendEmail } from '../shared/email'

// lead_assigned：线索分配给销售；lead_resubmitted：已有线索的客户再次提交（外部入口去重合并后提醒负责人，已转化的带 clientId 提醒客户负责人）
interface NotificationMessage {
  type: 'lead_assigned' | 'lead_resubmitted'
  leadId: string
  assignedToUserId: string
  clientId?: string
}

interface NotificationConfig {
  emailEnabled: boolean
  email: string
  webhookEnabled: boolean
  webhookUrl: string
}

export async function handleNotificationBatch(
  batch: MessageBatch<NotificationMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processNotification(message.body, env)
      message.ack()
    } catch (err) {
      console.error('[notification] 处理失败:', err)
      message.retry()
    }
  }
}

async function processNotification(msg: NotificationMessage, env: Env): Promise<void> {
  if (msg.type !== 'lead_assigned' && msg.type !== 'lead_resubmitted') return

  const user = await env.DB.prepare(
    'SELECT name, email, notification_config FROM users WHERE id = ?',
  ).bind(msg.assignedToUserId).first<{ name: string; email: string; notification_config: string | null }>()
  if (!user) return

  let config: NotificationConfig = { emailEnabled: false, email: user.email, webhookEnabled: false, webhookUrl: '' }
  if (user.notification_config) {
    try { config = { ...config, ...JSON.parse(user.notification_config) } } catch { /* keep default */ }
  }

  if (!config.emailEnabled && !config.webhookEnabled) return

  const lead = await env.DB.prepare(
    'SELECT name, contact_info, source, lead_no FROM leads WHERE id = ?',
  ).bind(msg.leadId).first<{ name: string; contact_info: string; source: string; lead_no: number | null }>()
  if (!lead) return

  const leadNo = lead.lead_no != null ? `L-${String(lead.lead_no).padStart(4, '0')} ` : ''
  const resubmit = msg.type === 'lead_resubmitted'
  const subject = resubmit ? `客户再次提交：${leadNo}${lead.name}` : `新线索已分配给你：${leadNo}${lead.name}`
  const intro = !resubmit ? '以下线索已分配给你，请及时跟进：'
    : msg.clientId ? '你负责的客户再次提交了信息（内容见客户的跟进记录），请及时跟进：'
      : '你负责的线索再次提交了信息（内容见线索的跟进记录），请及时跟进：'
  // 新分配的线索：联系方式以前出现过时，写明之前的线索 / 客户和负责人
  const history = resubmit ? '' : await findContactMatches(env.DB, lead.contact_info, msg.leadId)
    .then((m) => (m.length > 0 ? `\n\n该联系方式之前来过：\n${describeContactMatches(m)}` : ''))
    .catch(() => '')
  const body = `你好 ${user.name}，\n\n${intro}\n\n姓名：${lead.name}\n联系方式：${lead.contact_info}\n来源：${lead.source ?? '未知'}${history}\n\n请登录 CRM 查看详情。`

  const webhookText = `【${resubmit ? '客户再次提交' : '新线索分配'}】${leadNo}${lead.name}\n联系方式：${lead.contact_info}\n来源：${lead.source ?? '未知'}\n负责人：${user.name}${history}`

  await Promise.allSettled([
    config.emailEnabled && config.email
      ? sendEmail(env, config.email, subject, body)
      : Promise.resolve(),
    config.webhookEnabled && config.webhookUrl
      ? sendWebhook(config.webhookUrl, webhookText)
      : Promise.resolve(),
  ])
}

export function buildWebhookPayload(url: string, text: string): object {
  if (url.includes('qyapi.weixin.qq.com')) {
    // 企业微信机器人
    return { msgtype: 'text', text: { content: text } }
  }
  if (url.includes('oapi.dingtalk.com')) {
    // 钉钉机器人
    return { msgtype: 'text', text: { content: text } }
  }
  if (url.includes('open.feishu.cn') || url.includes('open.larksuite.com')) {
    // 飞书机器人
    return { msg_type: 'text', content: { text } }
  }
  // 通用 Webhook
  return { event: 'lead_assigned', message: text }
}

async function sendWebhook(url: string, text: string): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildWebhookPayload(url, text)),
  })
}
