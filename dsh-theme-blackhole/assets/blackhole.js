// ==========================================
// dsh 黑洞主题 WebGL 渲染器（史瓦西黑洞 · 零测地线光线追踪，自适应步长 RK4）
// 移植自 openagents static/js/theme_blackhole.js：固定参数、无任何可调节项
// 与交互，仅保留缓慢自动环绕。渲染分辨率为 0.5 x devicePixelRatio(上限 2)
// 倍窗口尺寸，半分辨率渲染兼顾性能与清晰度。
// 本脚本自建全屏画布层（z-index:-1，内容之下），WebGL 不可用或着色器编译
// 失败时隐藏画布层，由 body 上的降级底色（纯黑 + 微弱吸积盘橙晕）透出。
// 本脚本不自动启动：仅暴露 window.DshBlackhole = { start, stop } 控制器，
// 由客户端半边按主题激活状态启停，重复 start/stop 幂等。
// ==========================================
(function () {
  'use strict'

  // ===== 1. 着色器源码 =====
  // 顶点着色器：全屏三角形
  var BH_VERT = [
    'attribute vec2 aPos;',
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n')

  // 片元着色器：光线被角动量守恒约束在过中心的平面内，用无量纲 u = r_s/r
  // 将测地线化为标量轨道方程 d^2u/dphi^2 = 1.5u^2 - u，经典 RK4 积分，步长随 u 自适应
  var BH_FRAG = [
    'precision highp float;',
    '',
    'uniform vec2  uRes;',
    'uniform float uTime;      // 模拟时间 (秒)',
    'uniform vec3  uCamPos;',
    'uniform vec3  uRight;',
    'uniform vec3  uUp;',
    'uniform vec3  uFwd;',
    'uniform float uTanFov;',
    'uniform float uExposure;',
    'uniform float uRs;        // 史瓦西半径 r_s = 2M',
    'uniform vec3  uDiskN;     // 盘面法向 (由倾角计算)',
    '',
    'const float DISK_OUT_R = 10.0;   // 盘外缘, 单位 r_s',
    '',
    '// ---------- 哈希 / 噪声 ----------',
    'float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }',
    'float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }',
    'vec3  hash33(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }',
    '',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f*f*(3.0-2.0*f);',
    '  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x),',
    '             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y);',
    '}',
    'float fbm(vec2 p){',
    '  float s = 0.0, a = 0.5;',
    '  for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + vec2(1.7,9.2); a *= 0.5; }',
    '  return s;',
    '}',
    '',
    '// ---------- 近似黑体辐射色, t ~ [0,3] ----------',
    'vec3 blackbody(float t){',
    '  t = clamp(t, 0.03, 3.5);',
    '  vec3 c = mix(vec3(0.85,0.25,0.04), vec3(1.0,0.72,0.42), smoothstep(0.05,0.9,t));',
    '  c = mix(c, vec3(0.72,0.82,1.25), smoothstep(1.0,2.1,t));',
    '  return c;',
    '}',
    '',
    '// ---------- 星空背景: 银河星云 + 两层星点 ----------',
    'vec3 background(vec3 rd){',
    '  vec3 col = vec3(0.0);',
    '  vec3 bn = normalize(vec3(0.25, 0.85, -0.35));',
    '  float band = exp(-pow(abs(dot(rd,bn))*3.2, 2.0));',
    '  float neb  = fbm(rd.xy*4.0 + rd.z*2.0);',
    '  col += band * (vec3(0.08,0.10,0.17) + vec3(0.22,0.13,0.28)*neb) * (0.35+0.65*neb);',
    '  for(int L=0;L<2;L++){',
    '    float sc = (L==0) ? 120.0 : 260.0;',
    '    vec3 p = rd*sc;',
    '    vec3 id = floor(p), f = fract(p);',
    '    float h = hash13(id);',
    '    if(h > 0.985){',
    '      vec3 sp = hash33(id);',
    '      float d = length(f - sp);',
    '      float b = smoothstep(0.18, 0.0, d) * pow((h-0.985)/0.015, 2.0);',
    '      vec3 scol = mix(vec3(0.7,0.8,1.2), vec3(1.2,0.9,0.7), hash13(id+7.0));',
    '      col += scol * b * (L==0 ? 3.0 : 1.6);',
    '    }',
    '  }',
    '  return col;',
    '}',
    '',
    '// ---------- 吸积盘着色 ----------',
    'vec4 diskShade(vec3 p, vec3 rd){',
    '  float r  = length(p);',
    '  float rr = r / uRs;                 // 半径, 单位 r_s',
    '  vec3 dn = uDiskN;',
    '',
    '  // 盘面内局部基, 定义方位角 (dn 恒在 yz 平面内, 与 x 轴永不平行, 叉积安全)',
    '  vec3 e1 = normalize(cross(dn, vec3(1.0,0.0,0.0)));',
    '  vec3 e2 = cross(dn, e1);',
    '  float phi = atan(dot(p,e2), dot(p,e1));',
    '',
    '  // 开普勒角速度 Omega = sqrt(M/r^3), M = r_s/2; 时间换算到 r_s 单位 (大黑洞转得慢)',
    '  float tau   = uTime * 2.0 / uRs;',
    '  float omega = sqrt(0.5/(rr*rr*rr));',
    '  float ph = phi - tau*omega;',
    '',
    '  // ISCO (3 r_s) 内侧自由落体区: 强剪切 + 内流',
    '  float plunge = 1.0 - smoothstep(1.2, 3.0, rr);',
    '  ph -= plunge * plunge * 4.0;',
    '',
    '  // 切向拉伸的旋涡湍流密度',
    '  float spiral = 3.5 / max(rr - 0.8, 0.3);',
    '  float n1 = fbm(vec2(rr*5.0  - tau*plunge*0.8, ph*1.2 + spiral));',
    '  float n2 = fbm(vec2(rr*11.0 + 7.3,            ph*2.5 - spiral));',
    '  float dens = clamp(n1*0.75 + n2*0.45 - 0.25, 0.0, 1.5);',
    '',
    '  // 温度分布 T ~ r^-3/4, 且随质量按天体物理标度 T ~ M^-1/4 变化',
    '  float T = pow(3.0/rr, 0.75) * pow(1.0/uRs, 0.25);',
    '',
    '  // ---- 相对论转移 ----',
    '  vec3 kdir = -normalize(rd);                       // 光子飞向相机方向',
    '  vec3 tdir = normalize(cross(dn, p));              // 顺行轨道方向',
    '  float beta  = min(sqrt(0.5 / max(rr - 1.0, 0.05)), 0.75);  // 开普勒速率',
    '  float gam   = inversesqrt(1.0 - beta*beta);',
    '  float dop   = 1.0 / (gam * (1.0 - beta*dot(tdir,kdir)));   // 多普勒因子',
    '  float ggrav = sqrt(max(1.0 - 1.0/rr, 0.0));                // 引力红移',
    '  float g = dop * ggrav;                            // 总红移因子',
    '',
    '  vec3 c = blackbody(T * g);                        // 颜色随红移物理地变化',
    '  float bright = dens * (0.5 + 1.6*T) * dop*dop*dop * (0.25 + 0.75*ggrav);',
    '',
    '  float fadeIn  = smoothstep(1.05, 1.9, rr);',
    '  float fadeOut = 1.0 - smoothstep(DISK_OUT_R*0.65, DISK_OUT_R, rr);',
    '  float alpha = clamp(dens*1.6, 0.0, 1.0) * fadeIn * fadeOut;',
    '',
    '  c *= mix(1.0, 0.35, plunge);      // 自由落体物质变暗变红, 落入视界',
    '  return vec4(c * bright * 2.2, alpha);',
    '}',
    '',
    '// ---------- 轨道方程右端: y = (u, du/dphi) ----------',
    'vec2 deriv(vec2 y){ return vec2(y.y, 1.5*y.x*y.x - y.x); }',
    '',
    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy*2.0 - uRes)/uRes.y;',
    '  vec3 rd = normalize(uFwd + uTanFov*(uv.x*uRight + uv.y*uUp));',
    '  vec3 ro = uCamPos;',
    '',
    '  // 光线所在轨道平面的正交基 (a, b): a 指向相机, b 在平面内垂直 a',
    '  float r0 = length(ro);',
    '  vec3 a = ro/r0;',
    '  vec3 bp = rd - dot(rd, a)*a;',
    '  float beta = max(length(bp), 1e-6);',
    '  vec3 b = bp/beta;',
    '  float alpha0 = dot(rd, a);',
    '',
    '  // 初值: u = r_s/r, du/dphi = -u*cos(psi)/sin(psi)',
    '  float u0 = uRs/r0;',
    '  vec2 y = vec2(u0, -u0*alpha0/beta);',
    '  float phi = 0.0;',
    '',
    '  vec3 pos = ro;',
    '  float prevS = dot(pos, uDiskN);',
    '  vec3 col = vec3(0.0);',
    '  float trans = 1.0;',
    '  float minR = r0;             // 近日点距离 (光子环辉光用)',
    '  bool captured = false;',
    '',
    '  for(int i=0;i<420;i++){',
    '    // 自适应步长: u 越大 (越靠近黑洞) 步长越小',
    '    float dphi = 0.04 / (1.0 + 2.5*y.x);',
    '',
    '    // 经典 RK4',
    '    vec2 k1 = deriv(y);',
    '    vec2 k2 = deriv(y + 0.5*dphi*k1);',
    '    vec2 k3 = deriv(y + 0.5*dphi*k2);',
    '    vec2 k4 = deriv(y + dphi*k3);',
    '    y += dphi*(k1 + 2.0*k2 + 2.0*k3 + k4)/6.0;',
    '    phi += dphi;',
    '',
    '    float u = y.x;',
    '    if(u <= 0.0) break;               // 逃逸至无穷远',
    '    if(u >= 1.0){ captured = true; break; }   // 越过事件视界 r < r_s',
    '    float r = uRs/u;',
    '    minR = min(minR, r);',
    '',
    '    float cp = cos(phi), sp = sin(phi);',
    '    vec3 er = cp*a + sp*b;',
    '    vec3 ep = -sp*a + cp*b;',
    '    vec3 newPos = r*er;',
    '    // 当前光线方向: d(pos)/dphi 正比于 (-u\')*er + u*ephi',
    '    vec3 dirNow = normalize(-y.y*er + u*ep);',
    '',
    '    // 与吸积盘平面穿越检测 (点积变号)',
    '    float s1 = dot(newPos, uDiskN);',
    '    if(prevS*s1 < 0.0 && trans > 0.02){',
    '      float t = prevS/(prevS - s1);',
    '      vec3 xp = mix(pos, newPos, t);',
    '      float xr = length(xp)/uRs;',
    '      if(xr > 1.03 && xr < DISK_OUT_R){',
    '        vec4 dc = diskShade(xp, dirNow);',
    '        col += trans*dc.rgb*dc.a;',
    '        trans *= (1.0 - dc.a);',
    '      }',
    '    }',
    '',
    '    // 盘上下方热晕 (体积发光)',
    '    float rr = r/uRs;',
    '    float haze = exp(-abs(s1/uRs)*3.0) * (1.0 - smoothstep(3.0, 9.0, rr)) * smoothstep(1.0, 1.8, rr);',
    '    col += trans * vec3(1.0, 0.55, 0.25) * haze * (r*dphi/uRs) * 0.12;',
    '',
    '    pos = newPos;',
    '    prevS = s1;',
    '',
    '    // 逃逸判定: 已过近日点向外且距离超过相机初始距离',
    '    if(y.y < 0.0 && r > r0) break;',
    '  }',
    '',
    '  if(!captured){',
    '    float cp = cos(phi), sp = sin(phi);',
    '    vec3 er = cp*a + sp*b;',
    '    vec3 ep = -sp*a + cp*b;',
    '    vec3 fdir = normalize(-y.y*er + y.x*ep);',
    '    col += trans*background(fdir);',
    '  }',
    '',
    '  // 光子环辉光: 近日点掠过光子球 r = 1.5 r_s 的光线',
    '  float minRR = minR/uRs;',
    '  col += vec3(1.0, 0.85, 0.6) * 0.30 * exp(-pow((minRR - 1.5)*5.0, 2.0));',
    '',
    '  // 曝光 + ACES 色调映射 + gamma',
    '  col *= uExposure;',
    '  col = (col*(2.51*col + 0.03)) / (col*(2.43*col + 0.59) + 0.14);',
    '  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n')

  // ===== 2. 固定渲染参数（不提供任何可调节项） =====
  var BH_MASS = 0.5                              // 黑洞质量 M, r_s = 2M
  var BH_TILT_DEG = 20                           // 吸积盘倾角（度）
  var BH_EXPOSURE = 1.3                          // 曝光
  var BH_DIST = 11.0                             // 相机距离（绝对单位）
  var BH_PITCH = 0.38                            // 相机俯仰（弧度）
  var BH_YAW0 = 0.6                              // 初始方位角（弧度）
  var BH_ORBIT_SPEED = 0.05                      // 自动环绕角速度（弧度/秒）
  var BH_TAN_FOV = Math.tan(50 * Math.PI / 360)  // 视场角 50 度
  var BH_FRAME_MS = 1000 / 30                    // 帧间隔上限：限制 30fps 降低 GPU 常驻开销（dt 按真实流逝时间计算，环绕速度不受影响）

  // ===== 3. 运行时状态（纯数据对象） =====
  var bh = { running: false, raf: null, canvas: null, gl: null, U: null, simT: 0, prevT: 0, yaw: BH_YAW0, ready: false, failed: false }

  // ===== 4. 画布层挂载 =====
  // 自建全屏固定层（位于 body 底色之上、#root 之下）；深色基调由
  // html[data-dsh-blackhole] 门控的 blackhole.css 与主题系统承载，此处不再染指。
  function mountLayer() {
    var existing = document.getElementById('dsh-blackhole-layer')
    if (existing) {
      return document.getElementById('dsh-blackhole-canvas')
    }
    var layer = document.createElement('div')
    layer.id = 'dsh-blackhole-layer'
    layer.setAttribute('aria-hidden', 'true')
    var canvas = document.createElement('canvas')
    canvas.id = 'dsh-blackhole-canvas'
    layer.appendChild(canvas)
    document.body.prepend(layer)
    return canvas
  }

  // ===== 5. 初始化与分辨率 =====
  // 初始化黑洞渲染器：编译链接着色器、建立全屏三角形、解析 uniform 位置、
  // 绑定窗口缩放；WebGL 不可用或着色器编译失败时静默降级返回 false
  function initBlackhole() {
    if (bh.ready || bh.failed) {
      return bh.ready
    }
    var canvas = mountLayer()
    var gl = canvas ? canvas.getContext('webgl', { antialias: false, alpha: false }) : null
    if (!canvas || !gl) {
      bh.failed = true
      return false
    }
    try {
      // 编译单个着色器，编译失败时抛出异常
      var compile = function (type, src) {
        var s = gl.createShader(type)
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed')
        }
        return s
      }
      var prog = gl.createProgram()
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, BH_VERT))
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, BH_FRAG))
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) || 'program link failed')
      }
      gl.useProgram(prog)
      // 全屏三角形顶点缓冲
      var buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      var locPos = gl.getAttribLocation(prog, 'aPos')
      gl.enableVertexAttribArray(locPos)
      gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0)
      // 解析全部 uniform 位置
      var U = {}
      var names = ['uRes', 'uTime', 'uCamPos', 'uRight', 'uUp', 'uFwd', 'uTanFov', 'uExposure', 'uRs', 'uDiskN']
      for (var i = 0; i < names.length; i++) {
        U[names[i]] = gl.getUniformLocation(prog, names[i])
      }
      bh.canvas = canvas
      bh.gl = gl
      bh.U = U
      bh.ready = true
      // 渲染分辨率跟随系统屏幕分辨率，窗口缩放时同步
      window.addEventListener('resize', resizeBlackhole)
    } catch (e) {
      bh.failed = true
      return false
    }
    return true
  }

  // 同步渲染分辨率：0.5 倍渲染比例再乘 devicePixelRatio（上限 2），
  // 半分辨率渲染缓解 GPU 压力；画布显示尺寸由 CSS 撑满全屏，浏览器负责放大
  function resizeBlackhole() {
    if (!bh.ready) {
      return
    }
    var scale = 0.5 * Math.min(window.devicePixelRatio || 1, 2)
    var w = Math.max(1, Math.floor(scale * window.innerWidth))
    var h = Math.max(1, Math.floor(scale * window.innerHeight))
    if (bh.canvas.width !== w || bh.canvas.height !== h) {
      bh.canvas.width = w
      bh.canvas.height = h
      bh.gl.viewport(0, 0, w, h)
    }
  }

  // ===== 6. 帧渲染与循环 =====
  // 绘制当前帧：按固定参数计算相机基向量与吸积盘姿态，上传 uniform 并渲染
  function drawBlackholeFrame() {
    var gl = bh.gl
    var U = bh.U
    var rs = 2 * BH_MASS
    var tilt = BH_TILT_DEG * Math.PI / 180
    var cp = Math.cos(BH_PITCH), sp = Math.sin(BH_PITCH)
    var cam = [
      BH_DIST * cp * Math.sin(bh.yaw),
      BH_DIST * sp,
      BH_DIST * cp * Math.cos(bh.yaw)
    ]
    // 相机基向量：fwd 指向黑洞中心
    var fwd = [-cam[0], -cam[1], -cam[2]]
    var fl = Math.hypot(fwd[0], fwd[1], fwd[2])
    fwd = fwd.map(function (v) { return v / fl })
    // right = normalize(cross(fwd, (0,1,0)))
    var right = [-fwd[2], 0, fwd[0]]
    var rl = Math.hypot(right[0], right[1], right[2])
    if (rl < 1e-6) {
      right = [1, 0, 0]
      rl = 1
    }
    right = right.map(function (v) { return v / rl })
    // up = cross(right, fwd)
    var up = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0]
    ]
    gl.uniform2f(U.uRes, bh.canvas.width, bh.canvas.height)
    gl.uniform1f(U.uTime, bh.simT)
    gl.uniform3f(U.uCamPos, cam[0], cam[1], cam[2])
    gl.uniform3f(U.uRight, right[0], right[1], right[2])
    gl.uniform3f(U.uUp, up[0], up[1], up[2])
    gl.uniform3f(U.uFwd, fwd[0], fwd[1], fwd[2])
    gl.uniform1f(U.uTanFov, BH_TAN_FOV)
    gl.uniform1f(U.uExposure, BH_EXPOSURE)
    gl.uniform1f(U.uRs, rs)
    gl.uniform3f(U.uDiskN, 0, Math.cos(tilt), Math.sin(tilt))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // 渲染循环：推进模拟时间与环绕角，每帧先同步分辨率再绘制；
  // now 为 requestAnimationFrame 时间戳（毫秒）
  function tickBlackhole(now) {
    if (!bh.running) {
      return
    }
    bh.raf = requestAnimationFrame(tickBlackhole)
    // 30fps 限速：未到帧间隔直接跳帧，仅跳渲染不跳计时
    if (now - bh.prevT < BH_FRAME_MS) {
      return
    }
    resizeBlackhole()
    var dt = Math.min((now - bh.prevT) / 1000, 0.1)
    bh.prevT = now
    bh.simT += dt
    bh.yaw += dt * BH_ORBIT_SPEED
    drawBlackholeFrame()
  }

  // ===== 7. 启动与停止 =====
  // 启动黑洞渲染：初始化 WebGL 并开始 RAF 循环；
  // 系统要求减少动态时仅渲染一帧静态画面
  function startBlackhole() {
    if (!initBlackhole()) {
      // WebGL 不可用：隐藏画布层（alpha:false 的空白画布为纯黑不透明），
      // 让 body 的降级底色（纯黑 + 微弱橙晕）透出
      var layer = document.getElementById('dsh-blackhole-layer')
      if (layer) {
        layer.style.display = 'none'
      }
      return
    }
    resizeBlackhole()
    // 减少动态效果：静态渲染一帧即可，不启动循环
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bh.simT = 0
      bh.yaw = BH_YAW0
      drawBlackholeFrame()
      return
    }
    if (bh.running) {
      return
    }
    bh.running = true
    bh.prevT = performance.now()
    bh.raf = requestAnimationFrame(tickBlackhole)
  }

  // ===== 8. 停止与控制器导出 =====
  // 停止黑洞渲染：取消 RAF 循环、解绑缩放监听、销毁 GL 上下文并移除画布层；
  // 重置初始化标记，下次 start 重新建层与编译着色器（failed 标记保留，
  // WebGL 不可用的环境不会无谓重试）
  function stopBlackhole() {
    bh.running = false
    if (bh.raf !== null) {
      cancelAnimationFrame(bh.raf)
      bh.raf = null
    }
    window.removeEventListener('resize', resizeBlackhole)
    if (bh.gl !== null) {
      var lose = bh.gl.getExtension('WEBGL_lose_context')
      if (lose) {
        lose.loseContext()
      }
    }
    var layer = document.getElementById('dsh-blackhole-layer')
    if (layer) {
      layer.remove()
    }
    bh.canvas = null
    bh.gl = null
    bh.U = null
    bh.ready = false
  }

  // 控制器导出：客户端半边按主题激活状态调用；脚本只加载一次
  window.DshBlackhole = { start: startBlackhole, stop: stopBlackhole }
})()
