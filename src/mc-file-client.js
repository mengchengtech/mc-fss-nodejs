const { URL } = require('url')
const path = require('path')
const xpath = require('xpath')
const { DOMParser } = require('@xmldom/xmldom')
const { Readable } = require('stream')
const crypto = require('crypto')
const contentDisposition = require('content-disposition')
const log = require('@log4js-node/log4js-api').getLogger('node.fss.client')

// 使用原始的api，async方式不支持流式读写
const axiosStatic = require('axios')
const $posix = require('path').posix

const METHOD_PUT = 'PUT'
const METHOD_GET = 'GET'
const METHOD_HEAD = 'HEAD'
const METHOD_DELETE = 'DELETE'

const $axios = new axiosStatic.Axios({
  validateStatus (status) {
    return status >= 200 && status < 300
  }
})

module.exports = class MCFileClient {
  /**
   *
   * @param {import('../types').MCFileClientConfig} config
   */
  constructor (config) {
    this._config = config
    if ('server' in config) {
      const scheme = config.useSSL ? 'https' : 'http'
      const url = new URL(`${scheme}://${config.server}`)
      if (config.port) {
        url.port = String(config.port)
      }
      if (config.prefixPath) {
        url.pathname = config.prefixPath
      }
      this._endpoint = url
    } else {
      log.warn(
        '配置项 privateEndPoint, publicEndPoint, internal 已标记为过时，请改用新的配置方式 (server, useSSL?, port?, prefixPath?)'
      )
      this._endpoint = config.internal
        ? new URL(config.privateEndPoint)
        : new URL(config.publicEndPoint)
    }
  }

  get endpoint () {
    return this._endpoint
  }

  /**
   *
   * @param {string} key
   * @returns {Promise<NodeJS.ReadableStream>}
   */
  async get (key) {
    const signedData = this._signedData({
      method: METHOD_GET,
      key
    })

    try {
      const res = await $axios.request({
        url: signedData.targetUrl,
        method: METHOD_GET,
        headers: signedData.headers,
        responseType: 'stream'
      })

      return res.data
    } catch (err) {
      // 调用时设置了返回结果 'stream'，出错时也是以'stream'的格式返回，这里需要预处理一下
      if (axiosStatic.default.isAxiosError(err) && err.response) {
        const httpRes = /** @type {import('http').IncomingMessage} */ (
          err.response.data
        )
        /** @type {Buffer} */
        const data = await new Promise((resolve, reject) => {
          const buffers = []
          httpRes
            .on('data', chunk => {
              buffers.push(chunk)
            })
            .on('end', () => {
              return resolve(Buffer.concat(buffers))
            })
            .on('error', reject)
        })
        err.response.data = data.toString('utf-8')
        resolveAsyncRequestError(err)
      }
      err.message = err.message + ` --> [download] [${key}]`
      throw err
    }
  }

  /**
   *
   * @param {string} key
   * @param {string} fileName
   * @param {string | Buffer | NodeJS.ReadableStream} data
   * @param {Record<string, string>} metadata
   * @param {string} contentType
   */
  async put (key, fileName, data, metadata, contentType) {
    /** @type {Record<string, string>} */
    const fssMetadata = {}
    if (metadata) {
      for (const key in metadata) {
        fssMetadata['x-fss-meta-' + key] = metadata[key]
      }
    }

    const rawName = fileName ? path.basename(fileName) : path.basename(key)
    let headers = {
      'content-type': contentType
    }

    if (fileName) {
      headers['content-disposition'] = contentDisposition(rawName)
    }

    if (data instanceof Buffer) {
      headers['content-length'] = data.byteLength
    }

    const signedData = this._signedData({
      method: METHOD_PUT,
      key,
      headers,
      metadata: fssMetadata
    })

    headers = Object.assign(headers, signedData.headers)

    if (data instanceof Buffer || data instanceof Readable) {
      try {
        const res = await $axios.request({
          url: signedData.targetUrl,
          method: METHOD_PUT,
          headers: signedData.headers,
          data
        })
      } catch (err) {
        resolveAsyncRequestError(err)
        err.message = err.message + ` --> [upload] [${key}]`
        throw err
      }
    } else {
      throw new Error('上传的data必须为 Buffer/ReadableStream类型')
    }
  }

  /**
   *
   * @param {string} key
   */
  async delete (key) {
    const signedData = this._signedData({
      method: METHOD_DELETE,
      key,
      // request库在非GET请求时会强制生成content-length 头
      headers: { 'content-length': '0' }
    })

    try {
      await $axios.request({
        url: signedData.targetUrl,
        method: METHOD_DELETE,
        headers: signedData.headers
      })
    } catch (err) {
      resolveAsyncRequestError(err)
      err.message = err.message + ` --> [delete] [${key}]`
      throw err
    }
  }

  /**
   *
   * @param {string} to
   * @param {string} from
   * @param {string} [bucket]
   */
  async copy (to, from, bucket) {
    // 拼成服务端需要的地址
    const path = $posix.join(this._endpoint.pathname, 'apiversion')
    const url = new URL(path, this._endpoint)

    // 默认使用旧的格式
    let source = from
    let version = '1'
    try {
      const res = await $axios.request({
        url: url.toString(),
        method: METHOD_HEAD
      })
      version = res.headers['x-fss-server-version']
      const major = Number(version.split('.')[0])
      // 服务端支持跨bucket复制
      if (major > 1) {
        if (!bucket) {
          bucket = this._config.bucketName
        }
        source = `${bucket}/${from}`
      }
    } catch (ex) {
      // 等于405表示不支持带bucket的复制
      if (ex.status !== 405) {
        throw ex
      }
    }
    const signedData = this._signedData({
      method: METHOD_PUT,
      key: to,
      metadata: {
        'x-fss-client-version': '2',
        'x-fss-copy-source': source
      }
    })

    try {
      await $axios.request({
        url: signedData.targetUrl,
        method: METHOD_PUT,
        headers: { 'content-type': '', ...signedData.headers }
      })
    } catch (err) {
      resolveAsyncRequestError(err)
      err.message += ` --> [copy] [${bucket}/${from}] to [${this._config.bucketName}/${to}]`
      throw err
    }
  }

  /**
   *
   * @param {string} key
   */
  generateObjectUrl (key) {
    const path = $posix.join(
      this._endpoint.pathname,
      this._config.bucketName,
      key
    )
    const url = new URL(path, this._endpoint)
    const objectUrl = url.toString()
    return objectUrl
  }

  /**
   *
   * @param {string} key
   * @param {import('../types').SignatureUrlOption} option
   */
  signatureUrl (key, option) {
    option.expires = Math.round(Date.now() / 1000) + option.expires
    option.headers = option.headers || {}
    const resource = this._getResource(key)
    const sign = this._signature(resource, option)

    // 默认为给外部使用，所以指定用外网地址
    const path = $posix.join(
      this._endpoint.pathname,
      this._config.bucketName,
      key
    )
    const url = new URL(path, this._endpoint)

    const params = url.searchParams
    params.append('FSSAccessKeyId', this._config.accessKeyId)
    params.append('Expires', String(option.expires))
    params.append('Signature', sign.signature)

    for (const key in sign.subResource) {
      const value = sign.subResource[key]
      params.append(key, value)
    }

    const signedUrl = url.toString()
    return signedUrl
  }

  /**
   *
   * @param {string} key
   */
  async head (key) {
    const signedData = this._signedData({
      method: METHOD_HEAD,
      key
    })
    try {
      const res = await $axios.request({
        url: signedData.targetUrl,
        method: METHOD_HEAD,
        headers: signedData.headers
      })
      const result = {
        meta: {},
        headers: res.headers,
        status: res.status
      }

      Object.keys(res.headers).forEach(k => {
        if (k.indexOf('x-fss-meta-') === 0) {
          result.meta[k.substring(11)] = res.headers[k]
        }
      })
      return result
    } catch (err) {
      resolveAsyncRequestError(err)
      throw err
    }
  }

  /**
   *
   * @param {string} key
   */
  async getObjectMeta (key) {
    const signedData = this._signedData({
      method: METHOD_HEAD,
      key
    })

    try {
      const res = await $axios.request({
        url: signedData.targetUrl,
        method: METHOD_HEAD,
        headers: signedData.headers
      })

      return res.headers
    } catch (err) {
      resolveAsyncRequestError(err)
      throw err
    }
  }

  /**
   * 使用header传递签名方式生成签名数据
   *
   * @param {SignDataOption} option
   */
  _signedData (option) {
    const method = option.method
    const key = option.key
    const headers = option.headers || {}
    const metadata = option.metadata || {}
    // 拼成服务端需要的地址
    const path = $posix.join(
      this._endpoint.pathname,
      this._config.bucketName,
      key
    )
    const url = new URL(path, this._endpoint)

    const resource = this._getResource(key)
    headers.date = new Date().toUTCString()

    /** @type {Record<string, string>} */
    const userMetadata = {}
    for (const name in metadata) {
      // 全部转换为小写
      const lowerName = name.toLowerCase()
      userMetadata[lowerName] = metadata[name]
    }
    Object.assign(headers, userMetadata)

    const sign = this._signature(resource, {
      method,
      headers,
      metadata: userMetadata
    })
    headers.authorization = `FSS ${this._config.accessKeyId}:${sign.signature}`

    const params = url.searchParams
    for (const key in sign.subResource) {
      const value = sign.subResource[key]
      params.append(key, value)
    }

    const targetUrl = url.toString()

    return {
      targetUrl,
      headers: Object.assign({ accept: 'application/xml,*/*' }, headers)
    }
  }

  /**
   *
   * @param {string} key
   * @returns {string}
   */
  _getResource (key) {
    return $posix.join('/', this._config.bucketName, key)
  }

  /**
   *
   * @param {string} resource
   * @param {import('../types').SignatureUrlOption} option
   * @returns
   */
  _signature (resource, option) {
    const headers = option.headers || {}
    const signableValues = [option.method.toUpperCase()]
    const md5 = headers['content-md5'] || ''
    signableValues.push(md5)

    signableValues.push(headers['content-type'])
    if (option.expires) {
      signableValues.push(String(option.expires))
    } else {
      signableValues.push(headers.date)
    }

    /**
     * @type {Record<string, string>}
     */
    const subResource = {}
    if (option.process) {
      subResource['x-fss-process'] = option.process
    }
    if (option.response) {
      for (const key in option.response) {
        subResource['response-' + key.toLowerCase()] = option.response[key]
      }
    }

    const metadata = option.metadata || {}
    const keys = Object.keys(metadata).sort()
    for (const key of keys) {
      if (key.startsWith('x-fss-')) {
        signableValues.push(`${key}:${metadata[key]}`)
      }
    }

    // 加入请求的资源信息
    const canonicalizedResource = buildCanonicalizedResource(
      resource,
      subResource
    )
    signableValues.push(canonicalizedResource)
    const signable = signableValues.join('\n')
    const hmac = crypto.createHmac('sha1', this._config.accessKeySecret)
    const digest = hmac.update(signable).digest()
    return {
      signature: digest.toString('base64'),
      subResource
    }
  }
}

/**
 *
 * @param {string} resourcePath
 * @param {Record<string, string>} parameters
 * @returns {string}
 */
function buildCanonicalizedResource (resourcePath, parameters) {
  let canonicalizedResource = `${resourcePath}`
  const list = []

  Object.keys(parameters)
    .sort()
    .forEach(key => {
      list.push(`${key}=${parameters[key]}`)
    })

  if (list.length > 0) {
    canonicalizedResource += '?' + list.join('&')
  }
  return canonicalizedResource
}

/**
 *
 * @param {axiosStatic.AxiosError} err
 */
function resolveAsyncRequestError (err) {
  const res = err.response
  if (!res) {
    return
  }
  /**
   * @type {string}
   */
  const type = res.headers['content-type']
  // 转成json格式
  if (!type.includes('xml')) {
    return
  }

  const content = err.response.data
  if (!content) {
    return
  }

  // xml格式
  const doc = new DOMParser().parseFromString(content)
  const rawError = {}

  /** @type {Element[]} */
  // @ts-ignore
  const nodes = xpath.select('/Error/*', doc)
  for (const node of nodes) {
    // @ts-ignore
    rawError[node.localName] = node.textContent
  }
  const e = /** @type {any} */ (err)
  e.message = content
  e.code = rawError.Code
  e.desc = rawError.Message
  e.handled = true
}
