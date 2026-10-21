// 访客的浏览器语言（navigator.language，如 zh-CN、en-US）：显示为当前界面语言的名称，如「中文（中国）」
/** 去掉服务器环境的后缀（如 en-US@posix），无法识别时原样返回 */
export function languageName(code: string | null | undefined, uiLang: string): string | null {
  if (!code) return null
  const clean = code.split('@')[0]!.replace('_', '-')
  try {
    return new Intl.DisplayNames([uiLang === 'zh' ? 'zh-CN' : 'en'], { type: 'language' }).of(clean) ?? code
  } catch {
    return code
  }
}
