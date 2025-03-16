import { merge } from 'lodash-es'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const OPTIMIZER_PATH = '/node_modules/.myvite/deps'
const CLIENT_FILE = 'client.js'
const CLIENT_PATH = `/@myvite/${CLIENT_FILE}`

const defaultConfig = {
  root: '',
  server: {
    host: 'localhost',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: '',
      output: {
        format: 'es',
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      }
    }
  },
  plugins: [],
  resolve: {
    alias: void 0
  }
}

function getConfigPath(root) {
  for (const file of fs.readdirSync(root)) {
    if (file.includes('vite.config')) {
      return path.join(root, file)
    }
  }

  throw new Error('No myvite.config.js found in root directory')
}

function resolveDevConfig(config) {
  return config
}

function resolveProdConfig(config) {
  // 这里只是简单处理几个参数
  function findInputInRoot(root) {
    const rootPath = path.join(root, 'src')
  
    for (const file of fs.readdirSync(rootPath)) {
      if (file.startsWith('main')) {
        return path.join(rootPath, file)
      }
    }
  
    throw new Error('No entry file found in src directory')
  }
  
  // 没有设置input的一个简单处理
  if (!config.build.input) {
    config.build.input = findInputInRoot(config.root)
  }
  // 这里应该考虑下多入库的情况（函数、对象、数组）。这里只是简单处理
  config.build.input = path.join(config.root, config.build.input)

  if (!config.build.rollupOptions.input) {
    config.build.rollupOptions.input = findInputInRoot(config.root)
  }

  // 没有设置output dir的一个简单处理
  if (!config.build.rollupOptions.output.dir) {
    config.build.rollupOptions.output.dir = path.join(config.root, config.build.outDir || 'dist')
  }

  return config
}

async function createConfig(root, env='dev') {
  defaultConfig.root = root

  const importConfig = (
    await import(pathToFileURL(getConfigPath(root)).href)
  ).default

  // 将默认配置和导入配置合并
  const config = merge(defaultConfig, importConfig)
  return env === 'prod' ? resolveDevConfig(config) : resolveProdConfig(config)
}

export { createConfig, OPTIMIZER_PATH, CLIENT_PATH, CLIENT_FILE }
