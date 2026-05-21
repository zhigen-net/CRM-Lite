export interface StoragePutOptions {
  httpMetadata?: {
    contentType?: string
    contentDisposition?: string
    contentEncoding?: string
  }
}

export interface StorageGetResult {
  body: ReadableStream
  httpMetadata?: {
    contentType?: string
    contentDisposition?: string
  }
  size?: number
}

/** 统一存储接口，所有 Provider 必须实现 */
export interface StorageProvider {
  put(key: string, value: ArrayBuffer | ReadableStream | Blob, opts?: StoragePutOptions): Promise<void>
  get(key: string): Promise<StorageGetResult | null>
  delete(key: string | string[]): Promise<void>
  /** 创建分段上传，返回 uploadId（用于客户端直传）*/
  createMultipartUpload(key: string, opts?: StoragePutOptions): Promise<{ key: string; uploadId: string }>
}
