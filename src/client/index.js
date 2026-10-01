// ==========================================
// dsh-theme-blackhole — 客户端半边（免构建 client bundle）
//
// dsh 客户端模块系统的既定契约：执行 bundle 仅注册工厂
//（window.__ModuleLoader__.load({ id, factory })），模块体副作用在工厂
// 物化时运行；factory 收到的 require 由模块表应答。本文件直接作为
// client bundle 提供（package.json exports["./client"]），无需构建步骤。
//
// 本插件无开关：加载即启用，卸载即还原。职责只有三件：
//   1. 令牌覆盖层：ctx.theme.overrideTokens 把深空玻璃调色板叠在当前
//      主题之上。覆盖层与 light/dark/system 偏好通道正交——不注册主题
//      id、不读写主题偏好，卸载时覆盖层随纤维回收自动还原；
//   2. 深色渲染基调断言：ui-layout 的 ThemePresenter 每次发布都按偏好
//      重写 color-scheme 与 body[data-ds-dark-theme] 暗色基底；黑洞是
//      单套深空色，需要暗色基底兜底未覆盖的令牌，故在每次 theme/change
//      后（内置插件先注册监听，本监听器运行于 presenter 之后）把两者
//      重新断言为 dark——只改呈现，不碰偏好；
//   3. 结构层视觉：html[data-dsh-blackhole] 门控属性、样式表 link 与
//      window.DshBlackhole 渲染器的挂载/启停。
// ==========================================
window.__ModuleLoader__.load({
  id: 'dsh-theme-blackhole',
  factory: () => {
    'use strict'

    /** 令牌覆盖层 source 标识（动态包门面会改钉为包 id，此处为直装插件路径）。 */
    const SOURCE = 'blackhole'

    /** 激活标记：html 属性门控 blackhole.css 结构层；link 标签携带同名标记便于认领。 */
    const MARK = 'data-dsh-blackhole'
    const STYLE_URL = '/blackhole/blackhole.css'
    const SCRIPT_URL = '/blackhole/blackhole.js'

    /** ui-layout ThemePresenter 按偏好维护的暗色基底属性（呈现层，只读其契约）。 */
    const DARK_ATTRIBUTE = 'data-ds-dark-theme'

    /**
     * 深空玻璃调色板：令牌名 → 单套色值。面板为半透明深色玻璃，让
     * blackhole.js 的 WebGL 黑洞背景从内容之下透出；品牌强调色为吸积盘琥珀。
     */
    const PALETTE = {
      /* 背景：分层玻璃。bg-base 会被外壳 body 之外的多个全高容器
         （AppFrame、centerCol、会话骨架）嵌套叠刷，任一非零 alpha 都会
         复合成黑色遮罩盖住画布层，故取全透明——画布层直接透出，
         压暗与可读性完全由 layer-1/2/3 及上方玻璃层承担 */
      '--dsw-alias-bg-base': 'rgba(4, 5, 11, 0)',
      '--dsw-alias-bg-layer-1': 'rgba(9, 11, 20, 0.42)',
      '--dsw-alias-bg-layer-2': 'rgba(12, 15, 26, 0.52)',
      '--dsw-alias-bg-layer-3': 'rgba(15, 18, 31, 0.64)',
      '--dsw-alias-bg-mask-1': 'rgba(0, 0, 0, 0.5)',
      '--dsw-alias-bg-mask-2': 'rgba(0, 0, 0, 0.24)',
      '--dsw-alias-bg-mask-3': 'rgba(0, 0, 0, 0.55)',
      '--dsw-alias-bg-mask-photo': 'rgba(0, 0, 0, 0.88)',
      '--dsw-alias-bg-mask-drop': 'rgba(10, 12, 24, 0.55)',
      '--dsw-alias-bg-module-platform': 'rgba(13, 16, 28, 0.55)',
      '--dsw-alias-bg-multi-select': 'rgba(15, 18, 31, 0.5)',
      '--dsw-alias-bg-overlay': 'rgba(18, 21, 36, 0.72)',
      '--dsw-alias-bg-skeleton': 'rgba(255, 255, 255, 0.06)',

      /* 描边：冷调微光线，随层级加深 */
      '--dsw-alias-border-inverted2': 'rgba(255, 255, 255, 0.10)',
      '--dsw-alias-border-inverted': 'rgba(255, 255, 255, 0.08)',
      '--dsw-alias-border-l1': 'rgba(151, 168, 212, 0.09)',
      '--dsw-alias-border-l2-darkmode-thin': 'rgba(151, 168, 212, 0.10)',
      '--dsw-alias-border-l2': 'rgba(151, 168, 212, 0.14)',
      '--dsw-alias-border-l3': 'rgba(151, 168, 212, 0.19)',
      '--dsw-alias-border-l4': 'rgba(151, 168, 212, 0.26)',

      /* 品牌：吸积盘琥珀（前景文字取深棕，保证琥珀底上的对比度） */
      '--dsw-alias-brand-primary-invert': 'rgb(24, 16, 4)',
      '--dsw-alias-brand-primary-new-colorprimary-new-color': 'rgb(251, 176, 34)',
      '--dsw-alias-brand-primary': 'rgb(245, 158, 11)',
      '--dsw-alias-brand-text': 'rgb(253, 186, 68)',

      /* 按钮 */
      '--dsw-alias-button-contrast-fill': 'rgb(233, 237, 248)',
      '--dsw-alias-button-elevated-fill': 'rgba(18, 21, 36, 0.85)',
      '--dsw-alias-button-floating-fill': 'rgba(16, 19, 32, 0.78)',
      '--dsw-alias-button-floating-hover': 'rgba(24, 28, 46, 0.85)',
      '--dsw-alias-button-ghost-active-border': 'rgb(140, 150, 178)',
      '--dsw-alias-button-ghost-active-fill': 'rgba(255, 255, 255, 0.10)',
      '--dsw-alias-button-ghost-active-hover': 'rgba(255, 255, 255, 0.16)',
      '--dsw-alias-button-info-fill': 'rgb(245, 158, 11)',
      '--dsw-alias-button-info-hover': 'rgb(251, 176, 34)',
      '--dsw-alias-button-primary-dimmed': 'rgba(245, 158, 11, 0.22)',
      '--dsw-alias-button-primary-fill': 'rgb(245, 158, 11)',
      '--dsw-alias-button-primary-hover': 'rgb(251, 176, 34)',
      '--dsw-alias-button-tool-bar-fill-invisible': 'rgba(20, 22, 36, 0.4)',
      '--dsw-alias-button-tool-bar-fill': 'rgba(30, 34, 52, 0.55)',
      '--dsw-alias-button-tool-bar-hover': 'rgba(38, 43, 64, 0.68)',

      /* 交互态：白色叠层提亮，强调态染琥珀 */
      '--dsw-alias-interactive-bg-active': 'rgba(255, 255, 255, 0.14)',
      '--dsw-alias-interactive-bg-hover-accent': 'rgba(245, 158, 11, 0.18)',
      '--dsw-alias-interactive-bg-hover-danger': 'rgba(242, 90, 90, 0.16)',
      '--dsw-alias-interactive-bg-hover-solid': 'rgba(255, 255, 255, 0.10)',
      '--dsw-alias-interactive-bg-hover': 'rgba(255, 255, 255, 0.07)',

      /* 文字：蓝白冷调梯度 */
      '--dsw-alias-label-caption': 'rgb(110, 120, 150)',
      '--dsw-alias-label-dimmed': 'rgb(78, 86, 112)',
      '--dsw-alias-label-primary-bluish': 'rgb(147, 197, 253)',
      '--dsw-alias-label-primary-dimmed': 'rgb(206, 212, 230)',
      '--dsw-alias-label-primary-foreground': 'rgb(24, 16, 4)',
      '--dsw-alias-label-primary-inverted': 'rgb(24, 16, 4)',
      '--dsw-alias-label-primary': 'rgb(233, 237, 248)',
      '--dsw-alias-label-secondary': 'rgb(184, 192, 214)',
      '--dsw-alias-label-tertiary': 'rgb(140, 150, 178)',

      /* Markdown：代码块近乎不透明的夜空底，选中段染琥珀 */
      '--dsw-alias-markdown-citation': 'rgba(20, 24, 42, 0.6)',
      '--dsw-alias-markdown-code-block-banner': 'rgba(10, 12, 22, 0.72)',
      '--dsw-alias-markdown-code-block': 'rgba(4, 6, 13, 0.84)',
      '--dsw-alias-markdown-code-segment-selected': 'rgba(245, 158, 11, 0.22)',
      '--dsw-alias-markdown-code-segment-unselected': 'rgba(4, 6, 13, 0.55)',
      '--dsw-alias-markdown-inline-code': 'rgba(255, 255, 255, 0.08)',
      '--dsw-alias-markdown-placeholder': 'rgba(255, 255, 255, 0.07)',
      '--dsw-alias-markdown-tag': 'rgba(255, 255, 255, 0.10)',

      /* 滚动条 */
      '--dsw-alias-scrollbar-bg-l1': 'rgba(151, 168, 212, 0.22)',
      '--dsw-alias-scrollbar-bg-l2': 'rgba(151, 168, 212, 0.26)',
      '--dsw-alias-scrollbar-hover-l1': 'rgba(151, 168, 212, 0.38)',
      '--dsw-alias-scrollbar-hover-l2': 'rgba(151, 168, 212, 0.46)',

      /* 状态色：业务主色染琥珀，其余保持语义色相、按暗底提亮 */
      '--dsw-alias-state-business-primary': 'rgb(245, 158, 11)',
      '--dsw-alias-state-business-tertiary': 'rgba(245, 158, 11, 0.16)',
      '--dsw-alias-state-error-primary': 'rgb(242, 90, 90)',
      '--dsw-alias-state-error-secondary': 'rgb(248, 122, 122)',
      '--dsw-alias-state-success-primary': 'rgb(74, 222, 128)',
      '--dsw-alias-state-success-secondary': 'rgb(110, 231, 183)',
      '--dsw-alias-state-success-tertiary': 'rgba(34, 197, 94, 0.16)',
      '--dsw-alias-state-warn-label': 'rgb(221, 134, 41)',
      '--dsw-alias-state-warn-primary': 'rgb(245, 158, 11)',
      '--dsw-alias-state-warn-secondary': 'rgb(251, 176, 34)',
      '--dsw-alias-state-warn-tertiary': 'rgba(245, 158, 11, 0.16)',

      /* 浮层：高不透明度保证可读性 */
      '--dsw-alias-toast-bg': 'rgba(18, 21, 36, 0.92)',
      '--dsw-alias-tooltip-bg': 'rgba(22, 25, 42, 0.94)',

      /* 专项表面 */
      '--dsw-specific-bubble-highlight': 'rgba(245, 158, 11, 0.15)',
      '--dsw-specific-bubble': 'rgba(24, 28, 47, 0.58)',
      '--dsw-specific-input-major': 'rgba(10, 12, 22, 0.66)',
      '--dsw-specific-login-input': 'rgba(10, 12, 22, 0.66)',
      '--dsw-specific-menu': 'rgba(16, 19, 33, 0.88)',
      '--dsw-specific-selector': 'rgba(15, 18, 31, 0.7)',
      '--dsw-specific-sidebar-fill': 'rgba(7, 9, 17, 0.52)',
      '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(245, 158, 11, 0.20)',
      '--dsw-specific-sidebar-nav-item-active': 'rgba(255, 255, 255, 0.10)',
      '--dsw-specific-sidebar-nav-item-hover': 'rgba(255, 255, 255, 0.07)',
      '--dsw-specific-tip': 'rgba(18, 21, 36, 0.9)',
    }

    /**
     * overrideTokens 契约要求每令牌给出 { light, dark } 双表（裸字符串会抛
     * 教学性错误）；黑洞为单套深空色，两档填同一值，使浅色/深色/跟随系统
     * 任一档下覆盖层渲染一致。
     */
    const TOKENS = Object.fromEntries(
      Object.entries(PALETTE).map(([name, value]) => [name, { light: value, dark: value }]),
    )

    /**
     * 客户端插件体：叠令牌覆盖层、断言深色渲染基调、挂载结构层视觉，
     * 卸载时全部还原。
     * @param {import('@deepseek-ai/cordis').Context} ctx - 客户端 cordis 上下文。
     */
    function apply(ctx) {
      let disposed = false
      let scriptLoading = false

      // 1. 令牌覆盖层：叠在当前主题之上，卸载随纤维回收自动移除并还原
      ctx.effect(() => ctx.theme.overrideTokens(SOURCE, TOKENS), 'theme-blackhole: token overlay')

      // 2. 深色渲染基调：ThemePresenter 每次发布按偏好重写 color-scheme 与
      //    暗色基底属性，本监听器运行于其后重新断言为 dark（只改呈现）。
      //    已覆盖令牌之外的基底令牌需要暗色基底兜底，否则浅色偏好下露浅色底
      const assertDarkChrome = () => {
        if (disposed) return
        document.documentElement.style.colorScheme = 'dark'
        document.body.setAttribute(DARK_ATTRIBUTE, '')
      }
      assertDarkChrome()
      ctx.on('theme/change', assertDarkChrome)

      // 3. 结构层：html 门控属性 + 样式表 + WebGL 渲染器。
      //    Host 首屏引导可能已注入同一 link（携带标记），认领而非重复插入
      document.documentElement.setAttribute(MARK, '')
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
        script.setAttribute(MARK, '')
        script.onload = () => {
          scriptLoading = false
          // 加载完成前插件已卸载则不启动
          if (!disposed && window.DshBlackhole !== undefined) window.DshBlackhole.start()
        }
        script.onerror = () => { scriptLoading = false }
        document.head.appendChild(script)
      }

      // 卸载回收：还原渲染基调到当前偏好解析结果，摘除全部 DOM 痕迹。
      // disposed 先于覆盖层移除置位，使移除发布的 theme/change 不再触发断言；
      // 无论纤维内各 effect 的处置顺序如何，最终状态都收敛到偏好本真值
      ctx.effect(() => () => {
        disposed = true
        const scheme = ctx.theme.getTheme().active.colorScheme
        document.documentElement.style.colorScheme = scheme
        if (scheme === 'dark') document.body.setAttribute(DARK_ATTRIBUTE, '')
        else document.body.removeAttribute(DARK_ATTRIBUTE)
        document.documentElement.removeAttribute(MARK)
        const link = document.querySelector(`link[${MARK}]`)
        if (link !== null) link.remove()
        const script = document.querySelector(`script[${MARK}]`)
        if (script !== null) script.remove()
        if (window.DshBlackhole !== undefined) window.DshBlackhole.stop()
      }, 'theme-blackhole: teardown')
    }

    /** 客户端半边依赖的服务（与 package.json dsh.client.inject 的包一一对应）。 */
    const inject = ['theme']

    return { inject, apply }
  },
})
