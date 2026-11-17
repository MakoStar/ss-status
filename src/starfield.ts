interface Star {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  hue: number
  twinkle: number
  twinkleSpeed: number
  life: number
  lifeSpeed: number
}

const LINK_DIST = 185
const LINK_DIST_SQ = LINK_DIST * LINK_DIST
const MOUSE_DIST = 190
const MOUSE_DIST_SQ = MOUSE_DIST * MOUSE_DIST
const HUES = [190, 205, 230, 265, 300, 330, 45, 160]

export function initStarfield(): void {
  const canvas = document.getElementById('starfield') as HTMLCanvasElement | null
  if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const context = canvas.getContext('2d')
  if (!context) return
  const ctx = context

  let width = 0
  let height = 0
  let dpr = 1
  let stars: Star[] = []
  const mouse = { x: -1000, y: -1000 }

  const spawn = (star: Star, fresh = false): void => {
    star.x = Math.random() * width
    star.y = Math.random() * height
    if (fresh) {
      star.vx = (Math.random() - 0.5) * 0.28
      star.vy = (Math.random() - 0.5) * 0.28
    }
    star.size = Math.random() * 3 + 3.5
    star.hue = HUES[Math.floor(Math.random() * HUES.length)]
    star.twinkle = Math.random() * Math.PI * 2
    star.twinkleSpeed = 0.018 + Math.random() * 0.026
    star.life = fresh ? Math.random() : 0
    star.lifeSpeed = 0.0007 + Math.random() * 0.001
  }

  const resize = (): void => {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const count = Math.min(72, Math.floor((width * height) / 19000))
    stars = Array.from({ length: count }, () => {
      const s = {} as Star
      spawn(s, true)
      return s
    })
  }

  const lineColor = (dark: boolean): string => dark ? '120, 160, 235' : '80, 120, 190'

  function drawStar4(x: number, y: number, s: Star, alpha: number, dark: boolean): void {
    const size = s.size
    const valley = size * 0.2
    ctx.save()
    ctx.translate(x, y)

    const light = (v: number): number => dark ? v : Math.min(88, v + 12)
    const face = (ax: number, ay: number, bx: number, by: number, l: number): void => {
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.closePath()
      ctx.fillStyle = `hsla(${s.hue}, 100%, ${light(l)}%, ${alpha})`
      ctx.fill()
    }

    /** 八面无阴影批量绘制仅中心高光发光 */
    face(0, -size, -valley, -valley, 84)
    face(0, -size, valley, -valley, 76)
    face(size, 0, valley, -valley, 70)
    face(size, 0, valley, valley, 58)
    face(0, size, valley, valley, 82)
    face(0, size, -valley, valley, 74)
    face(-size, 0, -valley, valley, 70)
    face(-size, 0, -valley, -valley, 58)

    ctx.shadowColor = `hsla(${s.hue}, 100%, 65%, ${alpha * 0.85})`
    ctx.shadowBlur = size * 1.4
    ctx.beginPath()
    ctx.moveTo(0, -size * 0.34)
    ctx.lineTo(size * 0.34, 0)
    ctx.lineTo(0, size * 0.34)
    ctx.lineTo(-size * 0.34, 0)
    ctx.closePath()
    ctx.fillStyle = `hsla(${s.hue}, 100%, 96%, ${alpha * 0.95})`
    ctx.fill()
    ctx.restore()
  }

  let raf = 0
  let running = false
  const frame = (): void => {
    if (!running) return
    ctx.clearRect(0, 0, width, height)
    const dark = document.documentElement.dataset.theme !== 'light'
    const line = lineColor(dark)

    for (const s of stars) {
      s.x += s.vx
      s.y += s.vy
      if (s.x < 0 || s.x > width) s.vx *= -1
      if (s.y < 0 || s.y > height) s.vy *= -1
      s.twinkle += s.twinkleSpeed
      s.life += s.lifeSpeed
      if (s.life >= 1) spawn(s, false)
    }

    const pts = stars.map(s => {
      const envelope = Math.sin(Math.PI * s.life)
      const blink = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(s.twinkle))
      const dx = s.x - mouse.x
      const dy = s.y - mouse.y
      const near = dx * dx + dy * dy < MOUSE_DIST_SQ
      return { s, alpha: envelope * blink * (near ? 1 : dark ? 0.9 : 0.55) }
    }).filter(p => p.alpha > 0.04)

    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const amx = a.s.x - mouse.x
      const amy = a.s.y - mouse.y
      const nearMouse = amx * amx + amy * amy < MOUSE_DIST_SQ
      for (let j = i + 1; j < pts.length; j++) {
        const b = pts[j]
        const dx = a.s.x - b.s.x
        const dy = a.s.y - b.s.y
        const distSq = dx * dx + dy * dy
        if (distSq > LINK_DIST_SQ) continue
        const bmx = b.s.x - mouse.x
        const bmy = b.s.y - mouse.y
        const focus = nearMouse || bmx * bmx + bmy * bmy < MOUSE_DIST_SQ
        const alpha = (1 - Math.sqrt(distSq) / LINK_DIST) * Math.min(a.alpha, b.alpha) * (focus ? (dark ? 0.7 : 0.32) : (dark ? 0.32 : 0.14))
        ctx.beginPath()
        ctx.moveTo(a.s.x, a.s.y)
        ctx.lineTo(b.s.x, b.s.y)
        ctx.strokeStyle = `rgba(${line}, ${alpha.toFixed(3)})`
        ctx.lineWidth = focus ? 1.1 : 0.7
        ctx.stroke()
      }
      if (nearMouse) {
        const mdSq = amx * amx + amy * amy
        ctx.beginPath()
        ctx.moveTo(a.s.x, a.s.y)
        ctx.lineTo(mouse.x, mouse.y)
        ctx.strokeStyle = `rgba(${line}, ${((1 - Math.sqrt(mdSq) / MOUSE_DIST) * a.alpha * (dark ? 0.4 : 0.16)).toFixed(3)})`
        ctx.lineWidth = 0.8
        ctx.stroke()
      }
    }

    for (const p of pts) {
      drawStar4(p.s.x, p.s.y, p.s, p.alpha, dark)
    }
    raf = requestAnimationFrame(frame)
  }

  const start = (): void => {
    if (running) return
    running = true
    frame()
  }
  const stop = (): void => {
    running = false
    cancelAnimationFrame(raf)
  }

  let resizeTimer = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(resize, 150)
  })
  window.addEventListener('pointermove', e => {
    mouse.x = e.clientX
    mouse.y = e.clientY
  })
  window.addEventListener('pointerleave', () => {
    mouse.x = -1000
    mouse.y = -1000
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop()
    else start()
  })

  resize()
  start()
}
