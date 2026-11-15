/**
 * The moving parts of a page, ported from the design boards: the glass
 * orbs behind the hero, the headline that resolves out of blocks on
 * browse, and the soft light that follows the pointer across panels.
 *
 * The shaders are the boards' own, line for line. Only the plumbing
 * around them is new.
 */

/** x, y and radius as fractions of the canvas, then which palette. */
export type OrbSpec = [x: number, y: number, r: number, palette: PaletteName]

export type PaletteName = 'teal' | 'clay' | 'stone' | 'ink' | 'olive' | 'violet'

const PALETTE: Record<PaletteName, {
  dark: string; base: string; bright: string; light: string
  angle: number; freq: number; seed: number
}> = {
  teal: { dark: '#04171a', base: '#0f4c52', bright: '#37c6c0', light: '#cfece6', angle: 0.9, freq: 3.4, seed: 3.7 },
  clay: { dark: '#220808', base: '#7a2a1c', bright: '#e07a3c', light: '#f7d9b0', angle: -0.6, freq: 3.0, seed: 11.3 },
  stone: { dark: '#1d1a14', base: '#6e6454', bright: '#c9bda4', light: '#f6efe2', angle: 1.9, freq: 2.6, seed: 21.9 },
  ink: { dark: '#050607', base: '#1a1e22', bright: '#3c444c', light: '#e8eef2', angle: 0.4, freq: 2.2, seed: 5.1 },
  olive: { dark: '#15170b', base: '#4e5520', bright: '#b9bf4a', light: '#eef0c8', angle: -1.3, freq: 3.8, seed: 33.2 },
  violet: { dark: '#140b20', base: '#4a2f70', bright: '#a97fd8', light: '#ead9f6', angle: 1.2, freq: 3.2, seed: 17.6 },
}

function vec3(hex: string): string {
  const h = hex.replace('#', '')
  const n = [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3))
  return `vec3(${n.join(',')})`
}

const PRECISION = [
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  '#else',
  'precision mediump float;',
  '#endif',
]

const NOISE = [
  'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
  'float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), f.x), mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), f.x), f.y); }',
]

function orbShader(orbs: OrbSpec[]): string {
  const src = [
    ...PRECISION,
    'uniform vec2 uRes;',
    'uniform float uDpr;',
    'varying vec2 vUv;',
    ...NOISE,
    'float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }',
    'vec4 orb(vec2 frag, vec2 c, float r, float sd, float an, float fq, vec3 CA, vec3 CB, vec3 CC, vec3 CD){',
    '  vec2 d = (frag - c) / r;',
    '  float rr = dot(d, d);',
    '  if (rr > 1.02) return vec4(0.0);',
    '  float z = sqrt(max(1.0 - rr, 0.0));',
    '  vec3 n = vec3(d, z);',
    '  vec2 sp = d / (z + 0.55);',
    '  float w1 = fbm(sp * 1.1 + sd);',
    '  float w2 = fbm(sp * 2.2 - sd * 0.7 + 3.0);',
    '  vec2 q = sp + vec2(w1 - 0.5, w2 - 0.5) * 1.7;',
    '  float t = q.x * cos(an) + q.y * sin(an);',
    '  float rib = sin(t * fq + (w1 - 0.5) * 7.0);',
    '  vec3 col = mix(CA, CB, smoothstep(-0.20, 0.40, rib));',
    '  col = mix(col, CC, smoothstep(0.42, 0.88, rib));',
    '  float vein = smoothstep(0.88, 0.998, sin(t * fq * 2.3 + w2 * 9.0));',
    '  col = mix(col, CD, vein * 0.80);',
    '  float lit = smoothstep(-0.30, 1.00, d.y * 0.80 + z * 0.55);',
    '  col *= mix(0.30, 1.10, lit);',
    '  vec2 hq = d - vec2(-0.30, 0.42);',
    '  col += vec3(1.0) * exp(-dot(hq, hq) * 4.5) * 0.30;',
    '  col += vec3(1.0) * pow(max(dot(n, normalize(vec3(-0.35, 0.50, 0.79))), 0.0), 120.0) * 0.55;',
    '  col *= mix(1.0, 0.60, smoothstep(0.55, 1.0, sqrt(rr)));',
    '  col += CD * pow(1.0 - z, 6.0) * 0.10;',
    '  col *= mix(0.26, 1.0, smoothstep(-0.95, 0.15, d.y));',
    '  col += (hash(d * 240.0 + sd) - 0.5) * 0.014;',
    '  float a = 1.0 - smoothstep(1.0 - 2.2 / r, 1.0, sqrt(rr));',
    '  return vec4(max(col, 0.0) * a, a);',
    '}',
    'void main(){',
    '  vec2 frag = vUv * uRes;',
    '  float u = min(uRes.x, 1500.0 * uDpr);',
  ]
  orbs.forEach(([x, y, r, name], i) => {
    const p = PALETTE[name]
    src.push(
      `  vec4 o${i} = orb(frag, vec2(u * ${x.toFixed(3)}, uRes.y * ${y.toFixed(3)}), u * ${r.toFixed(3)}, ` +
      `${p.seed.toFixed(1)}, ${p.angle.toFixed(2)}, ${p.freq.toFixed(2)}, ` +
      `${vec3(p.dark)}, ${vec3(p.base)}, ${vec3(p.bright)}, ${vec3(p.light)});`,
    )
  })
  src.push('  vec4 o = o0;')
  for (let i = 1; i < orbs.length; i += 1) src.push(`  o = o + o${i} * (1.0 - o.a);`)
  src.push('  gl_FragColor = o;', '}')
  return src.join('\n')
}

const HEAD_SHADER = [
  ...PRECISION,
  'uniform sampler2D uTex;',
  'uniform vec2 uRes;',
  'uniform vec2 uPtr;',
  'uniform float uPtrI;',
  'uniform vec2 uSpan;',
  'uniform float uReveal;',
  'uniform float uCell;',
  'varying vec2 vUv;',
  ...NOISE,
  'void main(){',
  '  vec2 uv = vUv;',
  '  float asp = uRes.x / uRes.y;',
  '  float front = uSpan.x - 0.08 + uReveal * (uSpan.y - uSpan.x + 0.26);',
  '  float d = front - uv.x;',
  '  float resolved = smoothstep(0.0, 0.17, d);',
  '  vec2 pd = (uv - uPtr) * vec2(asp, 1.0);',
  '  float g = exp(-dot(pd, pd) / 0.040) * uPtrI;',
  '  vec2 suv = uv - (uv - uPtr) * g * 0.05;',
  '  float cell = mix(uCell, 1.0, resolved);',
  '  vec2 id = floor(suv * uRes / cell);',
  '  vec2 q = (id + 0.5) * cell / uRes;',
  '  if (cell < 1.5) q = suv;',
  '  float vis = step(hash(id + 7.0), clamp(resolved * 1.7, 0.0, 1.0));',
  '  float m = texture2D(uTex, q).a * vis;',
  '  float hx = (uv.x - front) * 7.0;',
  '  float head = exp(-hx * hx) * smoothstep(0.02, 0.45, uReveal) * (1.0 - smoothstep(0.88, 1.0, uReveal));',
  '  vec3 ink = vec3(0.035, 0.090, 0.090);',
  '  ink = mix(ink, vec3(0.180, 0.420, 0.415), head * 0.75);',
  '  ink = mix(ink, vec3(0.145, 0.300, 0.300), g * 0.55);',
  '  gl_FragColor = vec4(ink * m, m);',
  '}',
].join('\n')

interface Program { gl: WebGLRenderingContext; U: Record<string, WebGLUniformLocation | null> }

function program(canvas: HTMLCanvasElement, fragment: string, names: string[]): Program | null {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false })
  if (!gl) return null
  const vertex =
    'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }'
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('shader', gl.getShaderInfoLog(shader))
      return null
    }
    return shader
  }
  const v = compile(gl.VERTEX_SHADER, vertex)
  const f = compile(gl.FRAGMENT_SHADER, fragment)
  if (!v || !f) return null
  const p = gl.createProgram()
  if (!p) return null
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null
  gl.useProgram(p)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(p, 'aPos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const U: Program['U'] = {}
  for (const n of names) U[n] = gl.getUniformLocation(p, n)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  return { gl, U }
}

const DISPLAY = '"GT Canon", "Fraunces", Georgia, serif'

function setFont(ctx: CanvasRenderingContext2D, px: number) {
  ctx.font = '10px sans-serif'
  ctx.font = `300 75% ${px}px ${DISPLAY}`
  if (ctx.font.indexOf('GT Canon') === -1) ctx.font = `300 ${px}px ${DISPLAY}`
}

/**
 * Starts everything inside `root` and returns the function that stops it.
 * `head` is the headline canvas, which only browse has.
 */
export function startFx(
  root: HTMLElement,
  orbCanvas: HTMLCanvasElement | null,
  orbs: OrbSpec[],
  head: HTMLCanvasElement | null,
): () => void {
  const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  let running = true
  let raf = 0
  let moved = false
  let visible = true
  const ptr = { x: -9999, y: -9999, on: false }

  const orbCtx = orbCanvas && orbs.length > 0 ? program(orbCanvas, orbShader(orbs), ['uRes', 'uDpr']) : null

  function drawOrbs() {
    if (!orbCtx || !orbCanvas) return
    const { gl, U } = orbCtx
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const w = Math.max(2, Math.round((orbCanvas.offsetWidth || 1200) * dpr))
    const h = Math.max(2, Math.round((orbCanvas.offsetHeight || 700) * dpr))
    if (orbCanvas.width !== w || orbCanvas.height !== h) { orbCanvas.width = w; orbCanvas.height = h }
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(U.uRes ?? null, w, h)
    // The real ratio between canvas pixels and CSS pixels, after rounding.
    gl.uniform1f(U.uDpr ?? null, w / Math.max(1, orbCanvas.offsetWidth || w))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /* ---------- headline ---------- */
  const off = document.createElement('canvas')
  const hCtx = head
    ? program(head, HEAD_SHADER, ['uTex', 'uRes', 'uPtr', 'uPtrI', 'uSpan', 'uReveal', 'uCell'])
    : null
  const tex = hCtx ? hCtx.gl.createTexture() : null
  let dpr = 1, W = 2, H = 2, sx0 = 0.2, sx1 = 0.8, t0 = performance.now(), li = 0
  const line1 = head?.getAttribute('data-line1') ?? ''
  const line2 = head?.getAttribute('data-line2') ?? ''
  const pad = parseFloat(head?.getAttribute('data-pad') ?? '') || 120

  function layout() {
    if (!head) return
    const cw = head.offsetWidth || 1000
    const ch = head.offsetHeight || 420
    dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    W = Math.max(2, Math.round(cw * dpr))
    H = Math.max(2, Math.round(ch * dpr))
    head.width = W; head.height = H
    off.width = W; off.height = H
    const g = off.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, W, H)
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.fillStyle = '#ffffff'
    const cont = Math.max(140, cw - pad * 2) * dpr
    let f = Math.max(42, Math.min(cw * 0.062, 88)) * dpr
    setFont(g, f)
    const m = Math.max(g.measureText(line1).width, g.measureText(line2).width, 1)
    if (m > cont) { f = (f * cont) / m; setFont(g, f) }
    const y1 = H * 0.5 - f * 0.24
    g.fillText(line1, W / 2, y1)
    g.fillText(line2, W / 2, y1 + f)
    const mw = Math.max(g.measureText(line1).width, g.measureText(line2).width)
    sx0 = (W / 2 - mw / 2) / W
    sx1 = (W / 2 + mw / 2) / W
  }

  function uploadHead() {
    layout()
    if (!hCtx) return
    const gl = hCtx.gl
    gl.viewport(0, 0, W, H)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  function drawHead(now: number) {
    if (!hCtx || !head) return
    const { gl, U } = hCtx
    const t = (now - t0) / 1000
    let r = reduce ? 1 : Math.min(Math.max((t - 0.3) / 2.3, 0), 1)
    r = 1 - (1 - r) * (1 - r)
    const cr = head.getBoundingClientRect()
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform1i(U.uTex ?? null, 0)
    gl.uniform2f(U.uRes ?? null, W, H)
    gl.uniform2f(U.uPtr ?? null, (ptr.x - cr.left) / (cr.width || 1), 1 - (ptr.y - cr.top) / (cr.height || 1))
    gl.uniform1f(U.uPtrI ?? null, reduce ? 0 : li)
    gl.uniform2f(U.uSpan ?? null, sx0, sx1)
    gl.uniform1f(U.uReveal ?? null, r)
    gl.uniform1f(U.uCell ?? null, 8 * dpr)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /* ---------- the light on the panels ---------- */
  function spots() {
    // Asked for fresh each time: on the live site panels arrive after the data does.
    const panels = root.querySelectorAll<HTMLElement>('.panel')
    panels.forEach((el) => {
      const r = el.getBoundingClientRect()
      const sc = r.width / (el.offsetWidth || 1) || 1
      const dx = Math.max(r.left - ptr.x, 0, ptr.x - r.right)
      const dy = Math.max(r.top - ptr.y, 0, ptr.y - r.bottom)
      const o = ptr.on ? Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (90 * sc)) : 0
      el.style.setProperty('--mx', `${((ptr.x - r.left) / sc).toFixed(1)}px`)
      el.style.setProperty('--my', `${((ptr.y - r.top) / sc).toFixed(1)}px`)
      el.style.setProperty('--mo', (o * 0.75).toFixed(2))
    })
  }

  function frame(now: number) {
    raf = 0
    if (!running) return
    li += ((ptr.on ? 1 : 0) - li) * 0.12
    if (moved) { moved = false; spots() }
    if (visible) drawHead(now)
    raf = requestAnimationFrame(frame)
  }

  const onMove = (e: PointerEvent) => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.on = true; moved = true }
  const onLeave = () => { ptr.on = false; moved = true }
  const onScroll = () => { if (ptr.on) moved = true }
  const onReplay = () => { t0 = performance.now(); if (reduce) drawHead(t0) }
  if (!reduce) {
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerleave', onLeave)
    window.addEventListener('scroll', onScroll, true)
  }
  head?.parentElement?.addEventListener('click', onReplay)

  const ro = new ResizeObserver(() => {
    uploadHead()
    drawOrbs()
    if (reduce) drawHead(performance.now())
  })
  if (head) ro.observe(head)
  if (orbCanvas) ro.observe(orbCanvas)

  const io = head
    ? new IntersectionObserver((entries) => {
        visible = entries[0]?.isIntersecting ?? true
        if (reduce && visible) drawHead(performance.now())
      })
    : null
  if (head && io) io.observe(head)

  drawOrbs()

  const quiet = (p: Promise<unknown>) => p.catch(() => undefined)
  const ready = Promise.race([
    Promise.all([
      quiet(document.fonts.load('300 100px "GT Canon"')),
      quiet(document.fonts.load('300 100px "Fraunces"')),
      quiet(document.fonts.load('300 16px "GT Standard"')),
    ]),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ])
  void ready.then(() => {
    if (!running) return
    uploadHead()
    if (head && hCtx && head.width > 2) {
      const fallback = root.querySelector<HTMLElement>('[data-fb]')
      if (fallback) fallback.style.visibility = 'hidden'
    }
    drawOrbs()
    t0 = performance.now()
    if (reduce) drawHead(t0)
    else raf = requestAnimationFrame(frame)
  })

  return () => {
    running = false
    if (raf) cancelAnimationFrame(raf)
    root.removeEventListener('pointermove', onMove)
    root.removeEventListener('pointerleave', onLeave)
    window.removeEventListener('scroll', onScroll, true)
    head?.parentElement?.removeEventListener('click', onReplay)
    ro.disconnect()
    io?.disconnect()
    const fallback = root.querySelector<HTMLElement>('[data-fb]')
    if (fallback) fallback.style.visibility = ''
  }
}
