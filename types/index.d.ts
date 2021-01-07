interface MCFileClientConfig {
  bucketName: string
  accessKeyId: string
  accessKeySecret: string
  publicEndPoint: string
  privateEndPoint: string
}

export class MCFileClient {
  constructor (config: MCFileClientConfig)
  readonly endpoint: URL
  get (key: string): Promise<ReadableStream>
  put (
    key: string,
    fileName: string,
    data: string | Buffer | ReadableStream,
    metadata: Object,
    contentType: string
  ): Promise<void>

  delete (key: string): Promise<void>
  copy (toKey: string, fromKey: string): Promise<void>
  generateObjectUrl (key: string): string
  signatureUrl (key: string, option: any): string
  /**
   * 返回文件的headers信息(api命名参考ali-oss)
   * @param key
   */
  getObjectMeta (key: string): Object
  /**
   * 获取文件的自定义meta信息(api命名参考ali-oss)
   *
   * @param key 文件的key
   */
  head (key: string): Object
}
