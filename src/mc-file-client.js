const { URL } = require('url')
const path = require('path')
const { Readable, PassThrough } = require('stream')
const crypto = require('crypto')

// 使用原始的api，async方式不支持流式读写
const $request = require('request')
const $asyncRequest = require('request-promise-native')
const $posix = require('path').posix

const METHOD_PUT = 'PUT'
const METHOD_GET = 'GET'
const METHOD_HEAD = 'HEAD'
const METHOD_DELETE = 'DELETE'

module.exports = class MCFileClient {
  constructor (config) {
    this._config = config
    this._endpoint = config.internal
      ? new URL(config.privateEndPoint)
      : new URL(config.publicEndPoint)
  }

  get endpoint () {
    return this._endpoint
  }

  /**
   *
   * @param {string} key
   * @param {Promise<ReadableStream>}
   */
  async get (key) {
    const signedData = this._signedData({
      method: METHOD_GET,
      key
    })

    try {
      const req = $request({
        url: signedData.targetUrl,
        method: METHOD_GET,
        headers: signedData.headers
      })
      const readable = await getResponseStream(req)
      return readable
    } catch (err) {
      const res = err.response
      if (res) {
        err.status = res.statusCode
        resolveError(err)
      }
      err.message = err.message + ` --> [download] [${key}]`
      throw err
    }
  }

  async put (key, fileName, data, metadata, contentType) {
    const fss = {}
    if (metadata) {
      for (const key in metadata) {
        fss['x-fss-meta-' + key] = metadata[key]
      }
    }

    const rawName = fileName ? path.basename(fileName) : path.basename(key)
    let headers = {
      'content-type': contentType
    }

    if (fileName) {
      headers['content-disposition'] = encodeURIComponent(rawName)
    }

    if (data instanceof Buffer) {
      headers['content-length'] = data.byteLength
    }

    const signedData = this._signedData({
      method: METHOD_PUT,
      key,
      headers,
      fss
    })

    headers = Object.assign(headers, signedData.headers)

    if (data instanceof Buffer || data instanceof Readable) {
      try {
        await $asyncRequest({
          url: signedData.targetUrl,
          method: METHOD_PUT,
          headers: signedData.headers,
          body: data
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

  async delete (key) {
    const signedData = this._signedData({
      method: METHOD_DELETE,
      key,
      // request库在非GET请求时会强制生成content-length 头
      headers: { 'content-length': 0 }
    })

    try {
      await $asyncRequest({
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

  async copy (toKey, fromKey) {
    const signedData = this._signedData({
      method: METHOD_PUT,
      key: toKey,
      fss: {
        'x-fss-copy-source': fromKey
      }
    })

    try {
      await $asyncRequest({
        url: signedData.targetUrl,
        method: METHOD_PUT,
        headers: signedData.headers
      })
    } catch (err) {
      resolveAsyncRequestError(err)
      err.message = err.message + ` --> [copy] [${fromKey}] to [${toKey}]`
      throw err
    }
  }

  async generateObjectUrl (key) {
    const path = $posix.join(this._config.prefix, this._config.bucketName, key)
    const endPoint = this._config.publicEndPoint
    const url = new URL(path, endPoint)
    const objectUrl = url.toString()
    return objectUrl
  }

  async signatureUrl (key, option) {
    option.expires = Math.round(Date.now() / 1000) + option.expires
    option.headers = option.headers || {}
    const resource = this._getResource(key)
    const sign = this._signature(resource, option)

    // 默认为给外部使用，所以指定用外网地址
    const endPoint = this._config.publicEndPoint
    const path = $posix.join(this._config.prefix, this._config.bucketName, key)
    const url = new URL(path, endPoint)

    const params = url.searchParams
    params.append('FSSAccessKeyId', this._config.accessKeyId)
    params.append('Expires', option.expires)
    params.append('Signature', sign.signature)

    for (const key in sign.subResource) {
      const value = sign.subResource[key]
      params.append(key, value)
    }

    const signedUrl = url.toString()
    return signedUrl
  }

  async getObjectMeta (key) {
    const signedData = this._signedData({
      method: METHOD_HEAD,
      key
    })

    try {
      const req = $request({
        url: signedData.targetUrl,
        method: METHOD_HEAD,
        headers: signedData.headers
      })
      const readable = await getResponseStream(req)
      return readable.headers
    } catch (err) {
      const res = err.response
      if (res) {
        err.status = res.statusCode
        resolveError(err)
      }
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
    const fss = option.fss || {}
    // 拼成服务端需要的地址
    const path = $posix.join(this._config.prefix, this._config.bucketName, key)
    const url = new URL(path, this._endpoint)

    const resource = this._getResource(key)
    headers.date = new Date().toGMTString()

    const userMetadata = {}
    for (const name in fss) {
      // 全部转换为小写
      const lowerName = name.toLowerCase()
      userMetadata[lowerName] = fss[name]
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

  _getResource (key) {
    return $posix.join('/', this._config.bucketName, key)
  }

  _signature (resource, option) {
    const headers = option.headers || {}
    const signableValues = [option.method.toUpperCase()]
    const md5 = headers['content-md5'] || ''
    signableValues.push(md5)

    signableValues.push(headers['content-type'])
    signableValues.push(option.expires || headers.date)

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

async function getResponseStream (req) {
  // 流式处理hystrix只用计录状态
  // 收到请求后状态大于500的认为失败
  const stream = await new Promise((resolve, reject) => {
    req.on('response', res => {
      const status = res.statusCode
      if (status < 400) {
        // 由于request作为输出流只实现了pipe方法，没有真正实现全部的ReadableStream接口
        // 这里使用Transform流中转一下，变成一个标准的Readable流
        const transfer = new RpcResponseStream()
        Object.assign(transfer.headers, res.headers)
        transfer.statusCode = status
        req.pipe(transfer)
        return resolve(transfer)
      }

      // status >= 400, 有错误发生
      // http响应的状态码大于等于400时，说明响应中包含错误信息
      // 根据响应的'content-type'决定是转换成字符串还是json对象
      // 此处hack了request模块
      // 分析request的代码后得知：
      // 设置callback属性可以在后续代码中激活readResponseBody方法，同时还可以触发有body值的 'complete'事件
      // 如果不设置callback属性则会在最后触发不包含body的'complete'事件
      req.callback = () => null
      const type = res.headers['content-type']
      if (type.includes('json')) {
        // body解析为json
        req.json(true)
      } else {
        // body解析为字符串
        req.encoding = 'utf8'
      }

      req.on('complete', (res, body) => {
        const err = parseResponseStreamError(res, body)
        return reject(err)
      })
    })
  })
  return stream
}

function resolveAsyncRequestError (err) {
  const res = err.response
  if (res) {
    let body = res.body
    if (body) {
      /**
       * @type {string}
       */
      const type = res.headers['content-type']
      // 转成json格式
      if (typeof body === 'string' && type.includes('json')) {
        try {
          body = JSON.parse(body)
        } catch (err) {
          // 什么也不做
          body = {
            code: 'json_format_error',
            desc: body
          }
        }
        res.body = body
      }
    }

    resolveError(err)
    err.status = res.statusCode
  }
}

function resolveError (err) {
  const body = err.response.body
  if (!body) {
    return
  }

  // xml格式
  const cheerio = require('cheerio')
  const $ = cheerio.load(body, { xmlMode: true, normalizeWhitespace: true })
  const rawError = {}

  $('Error *').each((index, node) => {
    rawError[node.name] = cheerio(node).text()
  })
  err.code = rawError.Code
  err.desc = rawError.Message
  err.handled = true

  throw Error(`调用私有云文件服务时发生错误. ${err.message}`)
}

function parseResponseStreamError (res, body) {
  let err
  if (body && typeof body === 'object') {
    if (body.code && body.desc) {
      err = new Error(body.desc)
      err.code = body.code
      err.desc = body.desc
    }
  }

  const status = res.statusCode
  if (!err) {
    err = new Error()
    err.response = res
    err.message = `调用服务发生错误[${status}]`
  }

  // 客户端错 / 服务端错
  if (status < 500) {
    err.name = 'HTTP_CLIENT_ERROR'
    err.handleed = true
  } else {
    err.name = 'HTTP_SERVER_ERROR'
  }
  err.status = status

  return err
}

class RpcResponseStream extends PassThrough {
  constructor () {
    super()
    this._headers = {}
    this.statusCode = 404
  }

  /**
   * 存储response响应返回的headers
   */
  get headers () {
    return this._headers
  }
}

/**
 * @typedef {object} MCFileClientConfig
 * @property {string} bucketName
 * @property {string} accessKeyId
 * @property {string} accessKeySecret
 * @property {string} publicEndPoint
 * @property {string} privateEndPoint
 */

/**
 * @typedef {object} SignDataOption
 * @property {'GET' | 'PUT' | 'DELETE'} method
 * @property {string} key
 * @property {{[name: string]: string}} [headers = {}]
 * @property {{[name: string]: string}} [metadata = {}]
 */
