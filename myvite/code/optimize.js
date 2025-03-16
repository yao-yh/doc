// 负责收集所有的依赖服务，并使用esbuild进行编译，编译结果存储到一个固定文件夹中，等待html等引用
import path from 'node:path'
import fs from 'node:fs'
import { parse } from 'es-module-lexer'
import { build } from 'esbuild'
import { OPTIMIZER_PATH } from './config.js'

const initOptimizer = async (filePath) => {
  let allModules = [] // 收集裸模块集合
  const files = await fs.promises.readdir(filePath)
  for await (const fileName of files) {
    const file = path.join(filePath, fileName)
    const data = await fs.promises.stat(file)
    if (data.isDirectory()) {
      // 递归文件夹收集依赖
      allModules = allModules.concat(await initOptimizer(file))
    } else if (['.ts', '.js'].includes(path.extname(fileName))) {
      // 调用库 'es-module-lexer' 收集用到的依赖
      // 这里暂时没有直接收集 .vue 文件的内容，直接调用 parse 方法会报错
      const content = (await fs.promises.readFile(file)).toString()
      const imports = parse(content)[0]
      const modules = imports
        .map((item) => item.n)
        .filter((item) => !/^(\.|\/)/.test(item))
      allModules = allModules.concat(modules)
    }
  }
  return [...new Set(allModules)]
}

const buildOptimizer = (filePath, modules) => {
  build({
    // 设置构建的绝对工作目录，指向项目的根目录。
    absWorkingDir: filePath,
    // 定义入口文件。modules 应该是一个数组，包含项目的入口模块路径。
    entryPoints: modules,
    // 设置为 true 表示将所有依赖打包到一个或多个输出文件中。
    bundle: true,
    // 指定输出的模块格式，esm 表示输出为 ES 模块。
    format: 'esm',
    // 启用代码分割功能，允许将代码拆分为多个文件，以优化加载性能。
    splitting: true,
    // 指定输出目录。
    outdir: OPTIMIZER_PATH,
    // 用于定义全局变量。这里定义了两个 Vue.js 相关的全局变量
    define: {
      // 设置为 'true'，表示启用 Vue 的 Options API
      __VUE_OPTIONS_API__: 'true',
      // 设置为 'true'，表示在生产环境中启用 Vue Devtools
      __VUE_PROD_DEVTOOLS__: 'true',
    }
  })
}

const createOptimizer = async (root) => {
  const ret = await initOptimizer(path.join(root, 'src'))
  buildOptimizer(root, ret)
}

export { createOptimizer }
