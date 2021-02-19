import { BaseWebSocket } from './base'

const Console = console

class HeartbeatWebSocket<MessageReceived = any> extends BaseWebSocket<MessageReceived> {
  protected onmessage = ({ data: messageRaw }: MessageEvent<string>) => {
    if (!messageRaw) {
      Console.warn(`websocket receive undefine message from remote`)
      return
    }

    // 解决粘包的问题
    messageRaw.split('\n').forEach(messageRawV => {
      try {
        const message = JSON.parse(messageRawV)

        if (message.type && message.type === 'ping') {
          this.send({ type: 'pong' })
          return
        }

        this.dispatch('receiveMessage', message)
      } catch {
        this.dispatch('receiveRawMessage', messageRawV)
      }
    })
  }
}

export { HeartbeatWebSocket }
