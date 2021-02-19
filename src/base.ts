import { SyncEvent } from '@swnb/event'

type VoidFnWithSingleArg<T> = (arg: T) => void

type EventMap<MessageReceived> = {
  open: VoidFunction // 链接打开
  createFailure: VoidFunction // 创建失败
  receiveMessage: VoidFnWithSingleArg<MessageReceived> // 接受的消息
  receiveRawMessage: VoidFnWithSingleArg<string> // 接受的 raw 消息
  send: VoidFnWithSingleArg<string> // 开始发送数据
  beforeClose: VoidFunction // 关闭前触发
  close: VoidFunction // 关闭
}

const Console = console

class BaseWebSocket<MessageReceived = any> extends SyncEvent<EventMap<MessageReceived>> {
  public url: string

  protected eventNamespace = 'baseWebSocket'

  private wsConnection: WebSocket | null = null

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
      const wsConnection = await newWebSocket(this.url)
      wsConnection.addEventListener('message', this.onmessage)
      wsConnection.addEventListener('error', this.onerror)
      wsConnection.addEventListener('close', this.onclose)
      this.wsConnection = wsConnection
      this.dispatch('open')
      this.flush()
    } finally {
      this.isCreating = false
    }
  }

  recreate = async () => {
    await this.create()
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
      throw error
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
    if (!this.wsConnection) return
    // 被关闭的情况下，不需要 ws 触发事件
    const previousWsConnection = this.wsConnection
    this.onclose()
    previousWsConnection?.close()
  }

  protected onmessage = ({ data: messageRaw }: MessageEvent<string>) => {
    if (!messageRaw) {
      Console.warn(`websocket receive undefine message from remote`)
      return
    }

    // 解决粘包的问题
    messageRaw.split('\n').forEach(messageRawV => {
      try {
        const message = JSON.parse(messageRawV)
        this.dispatch('receiveMessage', message)
      } catch {
        this.dispatch('receiveRawMessage', messageRawV)
      }
    })
  }

  private onclose = () => {
    this.dispatch('beforeClose')
    this.wsConnection?.removeEventListener('close', this.onclose)
    this.wsConnection?.removeEventListener('error', this.onerror)
    this.wsConnection?.removeEventListener('message', this.onmessage)
    this.wsConnection = null
    this.dispatch('close')
  }

  private onerror = () => {
    this.close()
  }
}

function newWebSocket(url: string): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url)

    const clear = () => {
      ws.onopen = null
      ws.onerror = null
      ws.onclose = null
    }

    ws.onopen = () => {
      clear()
      res(ws)
    }

    ws.onclose = () => {
      clear()
      rej()
    }

    ws.onerror = () => {
      clear()
      rej()
    }
  })
}

export { BaseWebSocket }
