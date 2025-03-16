
// 对单独的文件进行热更新的处理
class HMRContext {
  constructor(hmrClient, ownerPath) {
    this.hmrClient = hmrClient
    this.ownerPath = ownerPath

    const mod = hmrClient.hotModulesMap.get(ownerPath)
    if (mod) {
      // 如果存在，说明已经注册过来，需要重置 callbacks
      mod.callbacks = []
    }
  }

  accept(deps) {
    // 收集依赖
    if (typeof deps === "function" || !deps) {
      const mod = this.hmrClient.hotModulesMap.get(this.ownerPath) || {
        id: this.ownerPath,
        callbacks: []
      }
      mod.callbacks.push({
        deps: [this.ownerPath],
        fn: ([mod]) => deps?.(mod)
      })
      this.hmrClient.hotModulesMap.set(this.ownerPath, mod)
    }
  }

}

// 热更新的客户端，用于处理热更新的消息，并回调对应 HMRContext 的处理函数
class HMRClient {
  constructor() {
    // 用于存储所有的 HMRContext
    this.hotModulesMap = new Map()

    this.initWebSocket()
  }

  initWebSocket() {
    const host = new URL(import.meta.url).host
    let ws = new WebSocket(`ws://${host}`)
    // ws.addEventListener('open', () => {}, { once: true })
    ws.addEventListener('message', async ({ data }) => {
      await this.handleMessage(JSON.parse(data))
    })
  }

  async handleMessage(data) {
    switch (data.type) {
      case 'update':
        if (data.update.type === "js-update") {
          const mod = this.hotModulesMap.get(data.update.path)
          if (!mod) {
              // 说明没有注册过，直接返回
              return
          }
          const fetchedNewModule = await this.importUpdatedModule(data.update)
          mod.callbacks.filter( ({deps}) => {
            return deps.includes(data.update.path)
          }).forEach(({ fn }) => {
            fn([fetchedNewModule])
          })
        } else {
          // 资源文件，直接刷新页面
          // 比如link之类的文件
          // 查找对应的link标签，将href替换
        }

        break
      case 'full-reload':
        window.location.reload()
        break
    }
  }
  
  async importUpdatedModule({ path, timestamp }) {
    const importPromise = import(`${path}?t=${timestamp}`)
    importPromise.catch(() => {
      window.location.reload()
    })
    return await importPromise
  }
}

const hmrClient = new HMRClient()

function createHotContext(ownerPath) {
  return new HMRContext(hmrClient, ownerPath)
}

// 把所有得样式标签存储，方便后续更新
const sheetsMap = new Map();

function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    const style = document.createElement('style')
    style.setAttribute('type', 'text/css')
    style.setAttribute("myvite-id", id);
    style.textContent = content
    document.head.append(style)
  } 
  sheetsMap.set(id, style);
}

export { updateStyle, createHotContext }
