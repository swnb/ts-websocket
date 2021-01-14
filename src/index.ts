import { SyncEvent } from '@swnb/event'

type VoidFnWithSingleArg<T> = (arg: T) => void

type EventMap = {
  open: VoidFunction // 链接打开
  receiveMessage: VoidFnWithSingleArg<any>
  send: VoidFnWithSingleArg<any> // 开始发送数据
  failure: VoidFunction // 此时的链接已经不可用
  beforeClose: VoidFunction // 关闭前触发
  close: VoidFunction // 关闭
}

const Console = console

class BaseWebSocket extends SyncEvent<EventMap> {
  protected eventNamespace = 'baseWebSocket'

  private wsConnection: WebSocket | null = null

  private retryTime: number = 0

  private maxRetryTime: number = 5

  private url: string

  private isCacheWhenWsNotOpen

  private cacheQueue: string[] = []

  private isCreating: boolean = false

  constructor(url: string, isCacheWhenWsNotOpen = true) {
    super()
    this.url = url
    this.isCacheWhenWsNotOpen = isCacheWhenWsNotOpen
  }

  setURL = (url: string) => {
    this.url = url
  }

  create = async () => {
    if (this.isCreating) {
      Console.warn('another websocket is running right now')
      return
    }
    this.isCreating = true
    // 开始关闭之前的 websocket,清理回调函数
    this.close()
    try {
      this.wsConnection = await newWebSocket(this.url)
      this.retryTime = 1
      this.wsConnection.addEventListener('message', this.onmessage)
      this.wsConnection.addEventListener('error', this.onerror)
      this.wsConnection.addEventListener('close', this.onclose)
      this.dispatch('open')
      this.flush()
    } catch (error) {
      // 当连接次数过多时候，放弃连接
      if (this.retryTime >= this.maxRetryTime) {
        this.dispatch('failure')
        Console.error(`connect to server failure , try to connect server again after one second`)
      } else {
        setTimeout(this.recreate, 1000)
      }
    } finally {
      this.isCreating = false
    }
  }

  recreate = () => {
    this.retryTime += 1
    this.create()
  }

  sendRaw = (body: string) => {
    if (!this.wsConnection) {
      if (this.isCacheWhenWsNotOpen) {
        this.cacheQueue.push(body)
      }
      return
    }

    try {
      this.wsConnection.send(body)
      this.dispatch('send', body)
    } catch (error) {
      Console.error(`error happen when send websocket message ${body} to remote ${this.url}`)
      if (this.isCacheWhenWsNotOpen) {
        this.cacheQueue.push(body)
      }
      this.recreate()
    }
  }

  send = <T extends Record<string, unknown>>(data: T) => {
    this.sendRaw(JSON.stringify(data))
  }

  dangerousGetWsConnection = () => {
    return this.wsConnection
  }

  flush = () => {
    // 如果不开启 cache 的情况下，不进行处理
    if (!this.isCacheWhenWsNotOpen) return

    // copy from cacheQueue
    const cacheQueueCopy = this.cacheQueue
    this.cacheQueue = []
    // send
    let data = cacheQueueCopy.shift()
    while (data) {
      this.sendRaw(data)
      data = cacheQueueCopy.shift()
    }
  }

  close = () => {
    this.wsConnection?.close()
  }

  private onclose = () => {
    this.dispatch('beforeClose')
    this.wsConnection?.addEventListener('close', this.onclose)
    this.wsConnection?.removeEventListener('error', this.onerror)
    this.wsConnection?.removeEventListener('message', this.onReceive)
    this.wsConnection = null
    this.dispatch('close')
  }

  private onmessage = ({ data: messageRaw }: MessageEvent<string>) => {
    if (!messageRaw) {
      Console.warn(`websocket receive undefine message from remote`)
      return
    }
    try {
      // TODO 可以考虑优化
      // 解决粘包的问题
      if (messageRaw.includes('\n')) {
        messageRaw.split('\n').forEach(messageRawV => {
          const message = JSON.parse(messageRawV)
          this.onReceive(message)
        })
        return
      }
      const message = JSON.parse(messageRaw)
      this.onReceive(message)
    } catch (err) {
      Console.error(
        `can't parse ws message from remote with err : ${err} , message : ${messageRaw}`,
      )
    }
  }

  private onerror = () => {
    this.recreate()
  }

  private onReceive = (data: any) => {
    this.dispatch('receiveMessage', data)
  }
}

function newWebSocket(url: string): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url)
    ws.onopen = () => {
      ws.onopen = null
      ws.onerror = null
      res(ws)
    }
    ws.onerror = () => {
      ws.onerror = null
      ws.onopen = null
      rej()
    }
  })
}

export { BaseWebSocket }
