declare type MethodType = 'GET' | 'PUT' | 'DELETE' | 'HEAD'
declare interface SignDataOption {
  method: MethodType
  key: string
  headers?: Record<string, any>
  metadata?: Record<string, any>
}
