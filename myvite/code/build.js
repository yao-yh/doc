import path from 'node:path'
import fs from 'node:fs'
import { rollup } from 'rollup'
import terser from '@rollup/plugin-terser'
import html from '@rollup/plugin-html'
import commonjs from '@rollup/plugin-commonjs'
import styles from 'rollup-plugin-styles'
import url from '@rollup/plugin-url'
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace'
import esbuild from 'rollup-plugin-esbuild'
import del from 'rollup-plugin-delete'
import copy from 'rollup-plugin-copy'

const BUILD_HTMLTITLE = 'App'


function resolvePlugins(userPlugins) {
  const prePlugins = []
  const normalPlugins = []
  const postPlugins = []

  // 这里主要使用插件的两个属性
  // enforce: 'pre' | 'post' | void
  // name: string
  // 通过 enforce 来区分插件的执行顺序
  // 通过 name 来区分插件的唯一性。如果客户设置了和默认插件重名的插件，那么默认插件会被覆盖
  // 这里没有考虑插件覆盖。。
  for (const plugin of userPlugins) {
    if (plugin.enforce === 'pre') {
      prePlugins.push(plugin)
    } else if (plugin.enforce === 'post') {
      postPlugins.push(plugin)
    } else {
      normalPlugins.push(plugin)
    }
  }

  return [prePlugins, normalPlugins, postPlugins]
}

async function createBuild(root, config) {
  const { outDir, assetsDir='assets' } = config.build

  const template = path.join(config.root, 'index.html')
  if (!fs.existsSync(template)) {
    throw new Error('No index.html found in root directory')
  }

  const mainFile = path.basename(config.build.rollupOptions.input)

  const [prePlugins, normalPlugins, postPlugins] = resolvePlugins(config.plugins || [])

  const inputOptions = {
    input: config.build.rollupOptions.input,
    plugins: [
      // 这里存的都是绝对不会修改的插件。理论上都不支持配置
      // 这里写的只是示例
      // 在构建前删除 dist 目录下的所有文件
      del({ targets: outDir }),
      // 注释以下两个，使用用户配置的插件
      // // 可以代码中使用 @ 别名
      // alias(),
      // // 解析 .vue 文件为 sfc
      // vue(),
      // 存储的客户配置的前置执行的插件
      ...prePlugins,
      // 存储的客户配置的正常顺序执行的插件
      ...normalPlugins,
      // 处理css
      styles({
        mode: 'extract',
        minimize: true,
      }),
      // esbuild，这里用来编译 TypeScript
      esbuild({ target: 'esnext', loader: 'ts' }), // 使用 esbuild 编译 TypeScript
      // rollup 能够识别和处理 npm 包
      resolve(),
      // 将代码中的 process.env.NODE_ENV 替换为 production
      replace({
        preventAssignment: true,
        'process.env.NODE_ENV': JSON.stringify('production'),
      }),
      // rollup 能够识别 commonjs 模块
      commonjs(),
      // 处理图片
      url({
        include: ['**/*.svg', '**/*.png', '**/*.jpg', '**/*.gif'],
        limit: 0,
        fileName: `./${assetsDir}/[name]-[hash][extname]`,
      }),
      // 处理 html 文件。这里为了 html 文件中引入编译新生成的 css 和 js 文件。并删除对开发环境的 css 和 js 的引入
      html({
        title: BUILD_HTMLTITLE,
        template: async ({ files }) => {
          // files 是一个对象，包含了 entrypoints 生成的所有文件
          // 我们需要把他们按顺序引入到 html 模板中
    
          let code = fs.readFileSync(template).toString()
          code = code.replace(`<script type="module" src="${mainFile}"></script>`, '')
    
          let fileTags = []
          if (files.css) {
            const cssTags = files.css.map((item) => {
              return '\t' + `<link rel="stylesheet" href="/${item.fileName}">`
            })
            fileTags = [...fileTags, ...cssTags]
          }
          if (files.js) {
            const jsTags = files.js.map((item) => {
              return (
                '\t' + `<script type="module" src="/${item.fileName}"></script>`
              )
            })
            fileTags = [...fileTags, ...jsTags]
          }
          if (fileTags.length) {
            code = code.replace('</head>', fileTags.join('\n') + '\n</head>')
          }
          return code
        },
      }),
      // 存储的客户配置的后置执行的插件
      ...postPlugins,
      // 压缩 js 文件
      terser(),
      // 将 public 目录下的所有文件拷贝到 dist 目录
      copy({
        targets: [{ src: 'public/**/*', dest: outDir }]
      })
    ]
  }

  const start = Date.now()
  const bundle = await rollup(inputOptions)
  await bundle.write(config.build.rollupOptions.output)
  await bundle.close()
  const end = Date.now()
  console.log(`✓ built in ${Math.round(end - start)}ms`)
}

export { createBuild }
