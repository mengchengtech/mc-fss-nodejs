declare interface FileClientConfig {
  internal: boolean
  bucketName: string
  accessKeyId: string
  accessKeySecret: string
  customDomain?: string
  tempDir?: string
}

declare interface NewNativeFileConfig extends FileClientConfig {
  /**
   * 服务器访问域名
   */
  server: string
  /**
   * 路径前缀，用于兼容某些非标准部署。例如放在反向代理后面会多出一段路径
   */
  prefixPath?: string
  /**
   * 默认值：使用ssl时为443，不使用时为80
   */
  port?: number
  /**
   * 生成访问的URL时，是否使用SSL方式，默认为false
   */
  useSSL?: boolean
}

declare interface OldNativeFileConfig extends FileClientConfig {
  internal: boolean
  /**
   * @deprecated 旧的实现方式，外部访问的终结点地址，相当于 external + useSSL + port + prefixPath
   * 公网入口终结点
   */
  publicEndPoint: string
  /**
   * @deprecated 旧的实现方式，内部访问的终结点地址，相当于 internal + useSSL + port + prefixPath
   * 私网入口终结点，如果为空，则使用 publicEndPoint
   */
  privateEndPoint?: string
}

declare type MCFileClientConfig = NewNativeFileConfig | OldNativeFileConfig

export class MCFileClient {
  constructor(config: MCFileClientConfig)
  readonly endpoint: URL
  get(key: string): Promise<NodeJS.ReadableStream>
  put(
    key: string,
    fileName: string,
    data: string | Buffer | NodeJS.ReadableStream,
    metadata: Record<string, string>,
    contentType: string
  ): Promise<void>

  delete(key: string): Promise<void>
  copy(to: string, from: string, bucket?: string): Promise<void>
  generateObjectUrl(key: string): string
  signatureUrl(key: string, option: SignatureUrlOption): string
  /**
   * 返回文件的headers信息(api命名参考ali-oss)
   * @param key
   */
  getObjectMeta(key: string): Promise<Object>
  /**
   * 获取文件的自定义meta信息(api命名参考ali-oss)
   *
   * @param key 文件的key
   */
  head(key: string): Promise<FileMetaInfo>
}

declare interface FileMetaInfo {
  headers: Record<string, string>
  meta: Record<string, any>
  status: number
}

declare interface SignatureUrlOption {
  method: MethodType
  headers?: Record<string, string>
  expires?: number
  process?: string
  response?: Record<string, any>
  metadata?: Record<string, any>
}
