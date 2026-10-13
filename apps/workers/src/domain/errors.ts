// 业务错误：携带 HTTP 状态码，由各入口转换为自己的错误格式
export class DomainError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409 | 422, message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

export const badRequest = (msg: string) => new DomainError(400, msg)
export const forbidden = (msg: string) => new DomainError(403, msg)
export const notFound = (msg: string) => new DomainError(404, msg)
