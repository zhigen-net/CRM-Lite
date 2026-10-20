// 交给 AI 的网站接入提示词：按部署平台、开启的功能拼装
// CRM 地址只写进「需要设置的配置」（由用户放进服务器端），提示词明确要求不得写进前端或代码仓库
import type { TFunction } from 'i18next'
import { isCloudflare, type Integration, type Platform, type SiteFeatures, type TemplateFile } from './ui'

export type PromptScope = 'full' | 'forms'

export interface PromptContext {
  t: TFunction
  tpl: Integration
  platform: Platform
  features: SiteFeatures
  siteName: string
  origin: string
  workerName: string | null
}

/** 把模板里的 {{CRM_URL}} / {{CRM_HOST}} 换成当前 CRM 地址 */
export function fillTemplate(code: string, origin: string) {
  return code.replaceAll('{{CRM_URL}}', origin).replaceAll('{{CRM_HOST}}', new URL(origin).host)
}

/** 平台需要新增 / 修改的文件（Cloudflare Workers 另加 assets 与服务绑定配置） */
export function platformFiles(ctx: PromptContext): TemplateFile[] {
  const { tpl, platform, features, origin, workerName, t } = ctx
  const files = (tpl.platforms[platform] ?? []).map((f) => ({ path: f.path, code: fillTemplate(f.code, origin) }))
  if (platform === 'cloudflare_workers') {
    files.push({ path: 'wrangler.toml（[assets]）', code: tpl.assetsConfig })
    if (features.connect === 'binding') {
      files.push({ path: 'wrangler.toml（[[services]]）', code: tpl.serviceBindingConfig.replace('<crm-worker-name>', workerName ?? t('siteConnect.workerNamePlaceholder')) })
    }
  }
  return files
}

/** 需要在控制台 / 服务器上设置的配置 */
export function varsText(ctx: PromptContext) {
  const { t, platform, features, origin, workerName } = ctx
  const worker = workerName ?? t('siteConnect.workerUnknown')
  const key = isCloudflare(platform) ? `siteConnect.vars.${platform}.${features.connect}` : `siteConnect.vars.${platform}`
  return t(key, { origin, worker })
}

const fence = (code: string, lang = '') => `\`\`\`${lang}\n${code.trimEnd()}\n\`\`\``

export function buildPrompt(ctx: PromptContext, scope: PromptScope): string {
  const { t, tpl, platform, features, siteName } = ctx
  const lines: string[] = []
  let n = 0
  const section = (title: string, body: string) => { n += 1; lines.push(`${n}. ${title}\n${body}`) }

  if (scope === 'forms') {
    lines.push(t('siteConnect.prompt.formsIntro'))
  } else {
    const featureNames = [t('siteConnect.features.tracking'), ...(features.forms ? [t('siteConnect.features.forms')] : [])].join('、')
    lines.push(t('siteConnect.prompt.intro', { features: featureNames, platform: t(`siteConnect.platforms.${platform}.name`) }))
    lines.push(t('siteConnect.prompt.rule'))

    // 转发 /_t/*
    if (platform === 'other') {
      section(t('siteConnect.prompt.proxyTitle'), t('siteConnect.prompt.otherSteps', { spec: tpl.proxySpec }))
    } else {
      const files = platformFiles(ctx).map((f) => `${t('siteConnect.prompt.file', { path: f.path })}\n${fence(f.code)}`).join('\n\n')
      const steps = t(`siteConnect.steps.${platform}`, { entry: tpl.workerEntryLine })
      section(t('siteConnect.prompt.proxyTitle'), `${steps}\n\n${files}`)
    }
    section(t('siteConnect.prompt.scriptTitle'), t('siteConnect.prompt.script', { scriptTag: tpl.scriptTag }))
  }

  if (scope === 'forms' || features.forms) {
    section(t('siteConnect.prompt.formsTitle'), `${t('siteConnect.prompt.forms', { name: siteName })}\n\n${t('siteConnect.prompt.formHtml')}\n${fence(tpl.formHtml, 'html')}\n\n${t('siteConnect.prompt.formJs')}\n${fence(tpl.formJs, 'js')}`)
  }
  if (scope === 'full') section(t('siteConnect.prompt.varsTitle'), varsText(ctx))
  section(t('siteConnect.prompt.checkTitle'), t(scope === 'forms' ? 'siteConnect.prompt.checkForms' : 'siteConnect.prompt.check'))
  return lines.join('\n\n')
}
