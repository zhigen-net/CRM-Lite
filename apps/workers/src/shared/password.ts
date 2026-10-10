// 密码哈希：PBKDF2-SHA256（Web Crypto 原生实现）
//
// 选择 PBKDF2 而非 bcryptjs：bcryptjs 是纯 JS 实现，cost=12 时一次校验约 360ms CPU，
// 远超 Workers 免费版每请求 10ms 的 CPU 上限（Error 1102）。
// 迭代次数按"改密码 = 校验 + 生成，两次派生仍在 10ms 内"选定（单次约 4ms）。
// 迭代次数随哈希一起存储；调整 PBKDF2_ITERATIONS 后，用户下次登录时自动升级。
//
// 存储格式：pbkdf2_sha256$<iterations>$<salt base64>$<hash base64>
// 旧格式：bcrypt（$2a$/$2b$/$2y$ 开头），仅用于兼容校验，登录成功后自动转为新格式。

const PBKDF2_ITERATIONS = 20_000
const SALT_BYTES = 16
const HASH_BITS = 256
const PREFIX = 'pbkdf2_sha256'

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS)
  return new Uint8Array(bits)
}

// 长度相同时逐字节比较全部内容，避免提前退出泄露时序信息
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, PBKDF2_ITERATIONS)
  return `${PREFIX}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export function isLegacyHash(stored: string): boolean {
  return stored.startsWith('$2')
}

/**
 * 校验密码。needsRehash 为 true 时，调用方应在校验成功后用 hashPassword 重新生成并保存。
 * 旧 bcrypt 哈希的校验仍然很耗 CPU，但每个用户只会发生一次。
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (isLegacyHash(stored)) {
    const bcrypt = await import('bcryptjs')
    const valid = await bcrypt.default.compare(password, stored)
    return { valid, needsRehash: valid }
  }

  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== PREFIX) return { valid: false, needsRehash: false }
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations <= 0) return { valid: false, needsRehash: false }

  const expected = fromBase64(parts[3]!)
  const actual = await derive(password, fromBase64(parts[2]!), iterations)
  const valid = constantTimeEqual(actual, expected)
  return { valid, needsRehash: valid && iterations !== PBKDF2_ITERATIONS }
}
