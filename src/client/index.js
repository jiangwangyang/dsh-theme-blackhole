// ==========================================
// dsh-theme-blackhole — 客户端半边（免构建 client bundle）
//
// dsh 客户端模块系统的既定契约：执行 bundle 仅注册工厂
//（window.__ModuleLoader__.load({ id, factory })），模块体副作用在工厂
// 物化时运行；factory 收到的 require 由模块表应答，基线 specifier 含
// 'react' 与 '@deepseek-ai/dsh-client-store'，因此本文件直接作为
// client bundle 提供（package.json exports["./client"]），无需构建步骤。
//
// 职责：
//   1. 把黑洞主题注册进 ThemeRuntime（ctx.theme.register），使其成为
//      theme/change 体系里的一等主题；
//   2. 在设置 General 段注册 "主题-黑洞" 开关行（settings.general.item 槽位）；
//   3. 按主题激活状态启停视觉：html[data-dsh-blackhole] 属性（门控
//      blackhole.css）、样式表 link 与 window.DshBlackhole 渲染器；
//   4. 开关状态持久化在本插件自有命名空间 theme-blackhole.enabled（Host 半边
//      注册 schema）——黑洞主题 id 不进入 ui-theme 的内置设置 schema，
//      这是 dsh 对第三方主题保留的边界。
//   5. 仲裁主题偏好归属：ui-settings 的共享镜像在每次 settings/document-updated
//      后全量重读，会触发 ui-theme adopt 把偏好压回其持久化的内置值；
//      以 ui-theme 持久化 section 的 preference 是否变化区分该碾压与用户在
//      外观行的主动切换，前者重新断言黑洞，后者让位并回写开关为关。
// ==========================================
window.__ModuleLoader__.load({
  id: 'dsh-theme-blackhole',
  factory: (require) => {
    'use strict'
    const React = require('react')
    const { defineStore } = require('@deepseek-ai/dsh-client-store')

    /** 注册进 ThemeRuntime 的主题 id。 */
    const THEME_ID = 'blackhole'

    /** 主题定义：深色基调；令牌覆写由 html 属性门控的 blackhole.css 承载。 */
    const THEME_DEFINITION = { id: THEME_ID, colorScheme: 'dark', tokens: {} }

    /** 本插件自有的设置命名空间与开关字段（Host 半边注册 schema）。 */
    const SETTINGS_NAMESPACE = 'theme-blackhole'
    const ENABLED_FIELD = 'enabled'

    /** ui-theme 的持久化命名空间（只读观察，仲裁基准；字面量理由同 Host 半边）。 */
    const UI_THEME_NAMESPACE = 'ui-theme'

    /** 激活标记：html 属性门控 blackhole.css；link 标签携带同名标记便于认领。 */
    const MARK = 'data-dsh-blackhole'
    const STYLE_URL = '/blackhole/blackhole.css'
    const SCRIPT_URL = '/blackhole/blackhole.js'

    /** 设置行文案命名空间与词典。 */
    const LOCALE_NS = 'settings.theme-blackhole'
    const zh = { 'blackhole.title': '主题-黑洞' }
    const en = { 'blackhole.title': 'Theme - Black Hole' }

    /** 设置行样式：布局对齐语言行（figma Setting-Cell），颜色全部取自设计令牌。 */
    const ROW_CSS = [
      '.dsh-bh-row{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2);}',
      '.dsh-bh-title{flex:1;min-width:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);}',
      '.dsh-bh-switch{flex:none;width:36px;height:20px;padding:2px;border:none;border-radius:10px;background:var(--dsw-alias-interactive-bg-active);cursor:pointer;transition:background .15s ease;}',
      '.dsh-bh-switch.dsh-bh-on{background:var(--dsw-alias-brand-primary);}',
      '.dsh-bh-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-inverted);transition:transform .15s ease;}',
      '.dsh-bh-on .dsh-bh-thumb{transform:translateX(16px);}',
    ].join('\n')

    /**
     * 渲染 "主题-黑洞" 设置行：标题 + 开关（role="switch"）。
     * @param {object} props - 槽位组合 props（runtime/store/locale/inject 四份）。
     * @param {(key: string) => string} props.t - 文案翻译座。
     * @param {<T>(selector: (state: { enabled: boolean, revision: number }) => T) => T} props.useStore - store 选择器 hook。
     * @param {(on: boolean) => void} props.setEnabled - 开关写入口。
     * @returns {object} React 元素树。
     */
    function BlackholeRow(props) {
      const enabled = props.useStore((state) => state.enabled)
      return React.createElement('div', { className: 'dsh-bh-row' },
        React.createElement('div', { className: 'dsh-bh-title' }, props.t('blackhole.title')),
        React.createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': enabled,
          'aria-label': props.t('blackhole.title'),
          className: enabled ? 'dsh-bh-switch dsh-bh-on' : 'dsh-bh-switch',
          onClick: () => { props.setEnabled(!enabled) },
        }, React.createElement('span', { className: 'dsh-bh-thumb' })))
    }

    /**
     * 客户端插件体：注册主题与设置行，协调持久化开关与主题偏好，
     * 并按激活状态同步 DOM 视觉。
     * @param {import('@deepseek-ai/cordis').Context} ctx - 客户端 cordis 上下文。
     */
    function apply(ctx) {
      // 主题注册：卸载时 ThemeRuntime 自动把占用中的偏好重置为默认
      ctx.effect(() => ctx.theme.register(THEME_DEFINITION), 'theme-blackhole: theme registration')

      // 设置作用域：本插件命名空间承载开关的持久化；远程浏览器自动降级为进程内
      const scope = ctx.settingsScope.bind({
        namespace: SETTINGS_NAMESPACE,
        // 只窄化形状，不重复校验（Host 半边的 schema 已保证 enabled 存在）
        decode: (section) => {
          if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
          return { enabled: section.enabled === true }
        },
      })

      // ui-theme 的只读观察：adopt 碾压把偏好压回持久化值且 section 不变；
      // 用户在外观行主动切换会真实改变 section.preference
      const uiThemeScope = ctx.settingsScope.bind({
        namespace: UI_THEME_NAMESPACE,
        decode: (section) => {
          if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
          return typeof section.preference === 'string' ? { preference: section.preference } : undefined
        },
      })

      let active = false
      let scriptLoading = false
      // 最近的内置偏好：关闭开关时恢复它；黑洞偏好不落盘 ui-theme 命名空间，
      // 用户的浅色/深色/跟随系统选择不会因开关而丢失
      let lastBuiltin
      // 最近见到的 ui-theme 持久化偏好（仲裁基准；首次观察只记录不判定）
      let lastPersisted
      // 让位写回 enabled=false 尚未落盘的窗口：抑制一切重新断言
      let pendingOff = false
      // 设置行 store 的本地单调计数（store 改由本插件 scope 驱动）
      let rowRevision = 0

      /**
       * 按激活状态同步 DOM：html 属性、样式表 link 与 WebGL 渲染器。
       * 两条路径都幂等（start/stop 幂等、移除操作空转安全），不设早退：
       * Host 首屏引导注入而客户端判定为关的边缘情况也必须能清理残留。
       * @param {boolean} on - 黑洞主题是否激活。
       */
      const syncDom = (on) => {
        active = on
        if (on) {
          document.documentElement.setAttribute(MARK, '')
          // Host 首屏引导可能已注入同一 link（携带标记），认领而非重复插入
          if (document.querySelector(`link[${MARK}]`) === null) {
            const link = document.createElement('link')
            link.rel = 'stylesheet'
            link.href = STYLE_URL
            link.setAttribute(MARK, '')
            document.head.appendChild(link)
          }
          if (window.DshBlackhole !== undefined) {
            window.DshBlackhole.start()
          } else if (!scriptLoading) {
            scriptLoading = true
            const script = document.createElement('script')
            script.src = SCRIPT_URL
            script.onload = () => {
              scriptLoading = false
              // 加载完成前已被切走则不启动
              if (active && window.DshBlackhole !== undefined) window.DshBlackhole.start()
            }
            script.onerror = () => { scriptLoading = false }
            document.head.appendChild(script)
          }
        } else {
          document.documentElement.removeAttribute(MARK)
          const link = document.querySelector(`link[${MARK}]`)
          if (link !== null) link.remove()
          if (window.DshBlackhole !== undefined) window.DshBlackhole.stop()
        }
      }

      /** 恢复到最近的内置偏好（注册表已不含它时回退跟随系统）。 */
      const restoreBuiltin = () => {
        const registered = ctx.theme.getTheme().themes
        const target = lastBuiltin !== undefined && registered.some((theme) => theme.id === lastBuiltin)
          ? lastBuiltin
          : 'system'
        ctx.theme.setTheme(target)
      }

      /**
       * 以持久化开关为准协调主题偏好与设置行：开关镜像进 store；开则在偏好被
       * 压回持久化内置值（adopt 碾压的签名）时重新断言黑洞，关且正占用偏好则
       * 交还。与持久化值不同的偏好是用户尚未落盘的主动切换，交给仲裁让位。
       */
      const reconcile = () => {
        const section = scope.getSnapshot().value
        if (section === undefined) return
        if (!section.enabled) pendingOff = false
        if (bound !== undefined) bound.sync(section.enabled, ++rowRevision)
        const preference = ctx.theme.getTheme().preference
        if (section.enabled) {
          if (!pendingOff && preference !== THEME_ID && preference === lastPersisted) {
            ctx.theme.setTheme(THEME_ID)
          }
        } else if (preference === THEME_ID) {
          restoreBuiltin()
        }
      }
      ctx.effect(() => scope.subscribe(reconcile), 'theme-blackhole: settings adoption')

      /**
       * 仲裁偏好归属：ui-theme 持久化偏好变化 = 用户在外观行主动切换，让位并
       * 回写开关为关；section 不变而偏好被压离黑洞 = 共享镜像全量重读引发的
       * adopt 碾压，重新断言（与碾压同在同一个同步发布段，两次 DOM 翻转之间
       * 无绘制）。已知边界：黑洞激活时点击恰好等于持久化值的内置主题会被视为
       * 碾压而覆盖，需用开关关闭——不改动 dsh 前提下该场景无法区分。
       */
      ctx.effect(() => uiThemeScope.subscribe(() => {
        const section = uiThemeScope.getSnapshot().value
        if (section === undefined) return
        if (lastPersisted === undefined) {
          // 首次观察：只记录基准，不判定为用户切换
          lastPersisted = section.preference
        } else if (section.preference !== lastPersisted) {
          lastPersisted = section.preference
          if (scope.getSnapshot().value?.enabled === true) {
            pendingOff = true
            void scope.set(ENABLED_FIELD, false)
          }
          return
        }
        if (!pendingOff
          && scope.getSnapshot().value?.enabled === true
          && ctx.theme.getTheme().preference !== THEME_ID) {
          ctx.theme.setTheme(THEME_ID)
        }
      }), 'theme-blackhole: ui-theme adoption arbitration')

      // 设置行 store：持久化开关的镜像，reconcile（本插件 scope 订阅）是唯一写者
      const store = defineStore({
        init: () => ({ enabled: false, revision: -1 }),
        actions: {
          sync: (draft, on, revision) => {
            if (revision <= draft.revision) return
            draft.enabled = on
            draft.revision = revision
          },
        },
      })
      let bound

      // 偏好变化只驱动 DOM 与 lastBuiltin；开关归属由仲裁与本插件 scope 决定，
      // 不再在此回写（adopt 碾压与用户主动切换在本事件上无法区分）
      ctx.on('theme/change', (snapshot) => {
        if (snapshot.preference !== THEME_ID) lastBuiltin = snapshot.preference
        syncDom(snapshot.preference === THEME_ID)
      })

      // 开关手势：立即切换主题，并持久化开关状态（远程浏览器进程内生效）；
      // 手动手势终结让位窗口
      const setEnabled = (on) => {
        pendingOff = false
        void scope.set(ENABLED_FIELD, on)
        if (on) ctx.theme.setTheme(THEME_ID)
        else restoreBuiltin()
      }

      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'theme-blackhole: row dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-theme-blackhole'
        style.textContent = ROW_CSS
        document.head.appendChild(style)
        return () => { style.remove() }
      }, 'theme-blackhole: row style')

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'theme-blackhole',
        order: 20,
        store,
        locale: LOCALE_NS,
        inject: (actions) => {
          bound = actions
          // 从 scope 重新同步，不丢注册与首渲染之间的变化（revision 守卫去重）
          bound.sync(scope.getSnapshot().value?.enabled === true, ++rowRevision)
          return { setEnabled }
        },
      }, BlackholeRow))

      // 应用当前状态（晚于内置插件激活的组成里，scope 可能已就绪）
      const snapshot = ctx.theme.getTheme()
      if (snapshot.preference !== THEME_ID) lastBuiltin = snapshot.preference
      syncDom(snapshot.preference === THEME_ID)
      reconcile()

      // 最后注册卸载回收：逆序处置时最先执行，摘除本主题的全部 DOM 痕迹
      ctx.effect(() => () => { syncDom(false) }, 'theme-blackhole: teardown')
    }

    /** 客户端半边依赖的服务（与 package.json dsh.client.inject 的包一一对应）。 */
    const inject = ['theme', 'slots', 'locale', 'connection', 'remote', 'settingsScope']

    return { inject, apply }
  },
})
