import path from 'node:path'
import chokidar from 'chokidar'
import { WebSocketServer } from 'ws'
import { analysisJsFromVue, analysisCssFromVue } from './plugins/vue.js'
import fs from 'node:fs'

const hotModules = new Map()

// 在已有的http服务上创建一个 websocket 服务
const createWebSockerServer = (root, server) => {
  const wss = new WebSocketServer({
    server,
  })
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected' }))
  })
  createHmr(root, wss)
}

// 文件变化的回调函数
function onfileChange(file, wss) {
  let wsContent = { type: 'full-reload' }
  // 这里应该判断文件得类型，比如
  // tsconfig.json 需要重启服务
  // vite.config.ts 需要重启服务
  // 普通js 或者 ts 文件可能需要重新加载页面
  // 。。。

  // 这里只处理 vue 文件
  if (file.endsWith('vue')) {
    const fileContent = fs.readFileSync(file, 'utf-8')
    
    const { hasChangeScript, hasChangeTemplate } = analysisJsFromVue(fileContent, file)
    const { hasChangeCss } = analysisCssFromVue(fileContent, file)
    if (hasChangeScript || hasChangeTemplate) {
      wsContent = {
        type: 'update', update: {
          path: hotModules.get(file),
          type: 'js-update',
          timestamp: Date.now()
        }
      }
    } else if (hasChangeCss) {
      wsContent = {
        type: 'update', update: {
          path: hotModules.get(file) +"?type=style",
          type: 'js-update',
          timestamp: Date.now()
        }
      }
    } else {
      // 代码得编译结果没有实际更新 不需要更新
      return
    }
  } else if (file.endsWith('css')) {
    wsContent = {
      type: 'update', update: {
        path: hotModules.get(file),
        type: 'js-update',
        timestamp: Date.now()
      }
    }
  }
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(
        JSON.stringify(wsContent)
      )
    }
  })
}

// 监测文件变化
function createHmr(root, wss) {
  chokidar
    .watch(path.join(root), { ignoreInitial: true })
    .on('change', (file, status) => {
      console.log('file changed', file)
      if (hotModules.has(file)) {
        onfileChange(file, wss)
      } else {
        wss.clients.forEach((client) => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'full-reload' }))
          }
        })
      }
    })
}

export { createWebSockerServer, hotModules }
