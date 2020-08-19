interface MCFileClientConfig {
  bucketName: string
  accessKeyId: string
  accessKeySecret: string
  publicEndpoint: string
  privateEndPoint: string
}

export class MCFileClient {
  constructor (config: MCFileClientConfig)
  readonly endpoint: URL
  get (key: string): Promise<ReadableStream>
  put (
    key: string,
    fileName: string,
    data: string | Buffer | WritableStream,
    metadata: Object,
    contentType: string
  ): Promise<void>

  delete (key: string): Promise<void>
  copy (toKey: string, fromKey: string): Promise<void>
  generateObjectUrl (key: string): string
  signatureUrl (key: string, option: any): string
  getObjectMeta (key: string): Object
}
