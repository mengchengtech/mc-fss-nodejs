declare interface FileClientConfig {
  internal: boolean
  bucketName: string
  accessKeyId: string
  accessKeySecret: string
  customDomain?: string
  tempDir?: string
}

declare interface NewNativeFileConfig extends FileClientConfig {
  // native方式部署的存储服务的服务器域名，如果类型是字符串，表示内外部使用同样的域名
  server:
    | string
    | {
        //外部访问的域名
        external: string
        //内部访问的域名，一般用于内网访问对象存储时不能通过外部域名穿透进入内部的场景
        internal?: string
      }
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
  /** @deprecated 旧的实现方式，外部访问的终结点地址，相当于 external + useSSL + port + prefixPath */
  publicEndPoint: string
  /** @deprecated 旧的实现方式，内部访问的终结点地址，相当于 internal + useSSL + port + prefixPath */
  privateEndPoint: string
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
    metadata: Object,
    contentType: string
  ): Promise<void>

  delete(key: string): Promise<void>
  copy(toKey: string, fromKey: string): Promise<void>
  generateObjectUrl(key: string): string
  signatureUrl(key: string, option: any): string
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
  headers: Object
  status: number
  meta: Object
}
