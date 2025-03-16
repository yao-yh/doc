import { parse as vueParse, compileTemplate, compileScript } from 'vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { CLIENT_PATH } from '../config.js'
import { createHash } from 'crypto'


// 判断vue文件是否发生变化得缓存
const vueHashMap = new Map();

function analysisJsFromVue(content, filename) {
  const { descriptor } = vueParse(content, { filename })

  let hasStyle = false
  let hasChangeScript = false
  let hasChangeTemplate = false

  if (descriptor.styles.length) {
    // 如果当前文件有style。就加一句import css的逻辑
    hasStyle = true
  }
  
  // 编译vue script
  const { content: vueScriptCode, bindings } = compileScript(descriptor, {
    source: descriptor.scriptSetup.content
  })

  // 编译vue template
  const vueTemplateCode = compileTemplate({
    source: descriptor.template.content,
    filename,
    compilerOptions: { bindingMetadata: bindings }
  }).code

  // 编译ts代码
  const vueScriptCodeJs = transformSync(vueScriptCode, {
    loader: 'ts',
    target: 'esnext'
  }).code

  // 判断代码是都发生变化
  const scriptHash = createHash('md5').update(vueScriptCodeJs).digest('hex')
  const templateHash = createHash('md5').update(vueTemplateCode).digest('hex')

  hasChangeScript = vueHashMap.get(filename + 'script') !== scriptHash
  hasChangeTemplate = vueHashMap.get(filename + 'template') !== templateHash

  vueHashMap.set(filename + 'script', scriptHash)
  vueHashMap.set(filename + 'template', templateHash)

  return {
    vueScriptCodeJs,
    vueTemplateCode,
    hasStyle,
    hasChangeScript,
    hasChangeTemplate,
    scriptHash,
    templateHash
  }
}

function analysisCssFromVue(content, filename) {
  const { descriptor } = vueParse(content, { filename })

  const cssContent = descriptor.styles.reduce(
    (init, item) => init + item.content,
    ''
  )

  const cssHash = createHash('md5').update(cssContent).digest('hex')

  const hasChangeCss = vueHashMap.get(filename + 'css') !== cssHash

  vueHashMap.set(filename + 'css', cssHash)

  return { cssContent, hasChangeCss }
}

function extractJsFromVue(content, url) {
  const fileName = url.split('/').pop().split('?')[0]
  const uriName = url.split('?')[0]

  const {
    vueScriptCodeJs,
    vueTemplateCode,
    hasStyle,
    hasChangeScript,
    scriptHash
  } = analysisJsFromVue(content, fileName)

  let code = []

  if (hasStyle) {
    code.push(`import "${uriName}?type=style"`)
  }

  code = [
    `import { createHotContext } from "${CLIENT_PATH}";`,
    `const hotContext = createHotContext("${uriName}");`,
    ...code,
    vueScriptCodeJs.replace(
      'export default',
      `const main =`
    ),
    vueTemplateCode,
    `main.render = render`,
    `export const _rerender_only = ${hasChangeScript ? 'false' : 'true'}`,
    `main.__hmrId = "${scriptHash}";
typeof __VUE_HMR_RUNTIME__ !== "undefined" && __VUE_HMR_RUNTIME__.createRecord(main.__hmrId, main);
hotContext.accept((mod) => {
  if (!mod) return;
  const { default: updated, _rerender_only } = mod;
  if (_rerender_only) {
    console.log('只更新template')
    __VUE_HMR_RUNTIME__.rerender(updated.__hmrId, updated.render);
  } else {
    console.log('更新了script')
    __VUE_HMR_RUNTIME__.reload(updated.__hmrId, updated);
  }
});`,
    `export default main`,
  ].join('\n')

  return { code }
}

function extractCssFromVue(content, url) {
  const fileName = url.split('/').pop()

  const { cssContent } = analysisCssFromVue(content, fileName)

  const code = [
    `import { createHotContext } from "${CLIENT_PATH}";`,
    `const hotContext = createHotContext("${url}");`,
    `import { updateStyle } from "${CLIENT_PATH}"`,
    `let css = ${JSON.stringify(cssContent)}`,
    `updateStyle("${url}", css)`,
    `hotContext.accept()`,
  ].join('\n')

  return { code }
}

export { extractJsFromVue, extractCssFromVue, analysisJsFromVue, analysisCssFromVue }