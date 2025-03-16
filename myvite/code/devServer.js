// 负责启动一个 Koa 服务，用于处理请求，对请求进行处理，返回相应的内容

import Koa from 'koa'
import staticFiles from 'koa-static' // 静态资源使用的库
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from "url"
import { dirname } from "path"
import { parse } from 'es-module-lexer'
import MagicSting from 'magic-string'

import { OPTIMIZER_PATH, CLIENT_PATH, CLIENT_FILE } from './config.js'
import { extractJsFromVue, extractCssFromVue } from './plugins/vue.js'
import { createWebSockerServer, hotModules } from './hmr.js'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let ROOT = ''

const app = new Koa()

function getContent(ctxBodyStream) {
  return new Promise((resolve) => {
    let res = ''

    if (typeof ctxBodyStream === 'string') {
      resolve(ctxBodyStream)
    } else {
      ctxBodyStream.on('data', (chunk) => {
        res += chunk
      })
      ctxBodyStream.on('end', () => {
        resolve(res)
      })
    }
  })
}

function modifyImport(content) {
  // 修改 import 
  // 对于外部依赖，引用 .myvite/deps/ 下的
  // 对于相对路径的引用，改成针对root的绝对路径
  // 这里只写了两个case。还有很多都可以补充，比如 png 等图片的使用。alias 中 '@' 的转换等

  const imports = parse(content)[0]
  const magicSting = new MagicSting(content)
  for (const item of imports) {
    if (!/^(\.|\/)/.test(item.n)) {
      // 例如 import { createApp } from 'vue'
      const { n, s, e } = item
      magicSting.overwrite(s, e, `${OPTIMIZER_PATH}/${n}.js`)
    } else if (/.(svg|jpg|png)/.test(item.n)) {
      const { n, s, e } = item
      magicSting.overwrite(s, e, `${n}?import`)
    } else if (/.(vue|css)/.test(item.n) && item.n.startsWith('.')) {
      // 例如 import App from './App.vue'
      // 需要修改为相对路径
      const { s, e } = item
      let { n } = item
      if (n.startsWith('.')) {
        n = n.replace('./', '')
      }
      magicSting.overwrite(s, e, `/src/${n}`)
    }
  }
  return magicSting.toString()
}

async function modifyHtml(ctx) {
  ctx.body = (await getContent(ctx.body)).replace(
    /<\/head>/,
    `<script type="module" src="${CLIENT_PATH}"></script>\n<\/head>`)
}

async function modifyVueToJs(ctx, url) {
  ctx.set('Content-Type', 'text/javascript')
  const content = await getContent(ctx.body)
  const { code } = extractJsFromVue(content, url)
  ctx.body = modifyImport(code)
}

async function modifyVueToCss(ctx, url) {
  ctx.set('Content-Type', 'text/javascript')
  const content = await getContent(ctx.body)
  const { code } = extractCssFromVue(content, url)
  ctx.body = code
}

async function modifyTs(ctx) {
  ctx.set('Content-Type', 'text/javascript')
  
  ctx.body = modifyImport(await getContent(ctx.body))
}

async function modifyCss(ctx) {
  ctx.set('Content-Type', 'text/javascript')
  const content = await getContent(ctx.body)
  const fileName = ctx.request.url.split('/').pop().split('?')[0]
  const code = [
    `import { createHotContext } from "${CLIENT_PATH}";`,
    `const hotContext = createHotContext("${ctx.request.url}");`,
    `import { updateStyle } from "${CLIENT_PATH}"`,
    `let css = ${JSON.stringify(content)}`,
    `updateStyle("${ctx.request.url}", css)`,
    `hotContext.accept()`,
    ].join('\n')

  ctx.body = code
}

async function modifySvg(ctx) {

  let code = ""
  if (ctx.request.url == '/vite.svg') {
    ctx.set('Content-Type', 'image/svg+xml')
    code = fs.readFileSync(path.join(__dirname, 'vite.svg'), 'utf-8')
  } else {
    ctx.set('Content-Type', 'text/javascript')
    const content = await getContent(ctx.body)
    code = [
      `export default "data:image/svg+xml,`,
      encodeURIComponent(content),
      `"`,
    ].join('')
  }

  ctx.body = code
}

async function modifyResponse(ctx) {
  // ctx.body
  const uri = ctx.request.url.split('?')[0]

  if (ctx.response.is('html')) {
    await modifyHtml(ctx)
  } else if (ctx.request.url === CLIENT_PATH) {
    ctx.set('Content-Type', 'text/javascript')
    ctx.body = await fs.promises.readFile(path.join(__dirname, CLIENT_FILE))
  } else if (ctx.request.url.endsWith('.ts')) {
    await modifyTs(ctx)
  } else if (ctx.request.url.endsWith('.js')) {
    await modifyTs(ctx)
  } else if (uri.endsWith('.css')) {
    await modifyCss(ctx)
    hotModules.set(path.join(ROOT, ctx.request.url), ctx.request.url)
  } else if (uri.endsWith('.vue') && !ctx.request.url.includes('?type=style')) {
    await modifyVueToJs(ctx, ctx.request.url)
    hotModules.set(path.join(ROOT, ctx.request.url), ctx.request.url)
  } else if (uri.endsWith('.vue') && ctx.request.url.includes('?type=style')) {
    await modifyVueToCss(ctx, ctx.request.url)
    hotModules.set(path.join(ROOT, ctx.request.url), ctx.request.url)
  } else if (uri.endsWith('.svg')) {
    await modifySvg(ctx)
  }
}

const createServer = (root, config) => {
  ROOT = root
  const { server: serverConfig } = config
  const { host, port } = serverConfig

  // 使用中间件，处理所有请求，并对静态资源做相应的处理
  app.use(async (ctx, next) => {
    await next()
    await modifyResponse(ctx)
  })

  // 将预编译路径，加入静态资源中

  // 配置静态资源路径，将当前目录作为静态资源路径
  app.use(staticFiles(root, {
    hidden: true,
  }))

  const server = http.createServer(app.callback())

  server.listen(port, host, () => {
    console.log(`start dev server:   http://${host}:${port}/`)
    createWebSockerServer(root, server)
  })
}
export { createServer }
