import { useEffect, useRef } from "react"

const GLYPHS = "01ABCDEFGHIJKLMNOPQRSTUVWXYZ"

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function MatrixRain({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (prefersReducedMotion()) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animationFrame = 0
    let active = true
    let width = 0
    let height = 0
    let drops: number[] = []
    const fontSize = 14

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      const columns = Math.max(1, Math.floor(width / fontSize))
      drops = new Array(columns).fill(0).map(() => Math.random() * -40)
    }

    const draw = () => {
      if (!active || document.hidden) {
        return
      }

      ctx.fillStyle = "rgba(6, 10, 7, 0.04)"
      ctx.fillRect(0, 0, width, height)

      ctx.fillStyle = "rgba(15, 61, 30, 0.35)"
      ctx.font = `${fontSize}px var(--font-mono)`

      for (let i = 0; i < drops.length; i += 1) {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        const x = i * fontSize
        const y = drops[i] * fontSize
        ctx.fillText(glyph, x, y)

        if (y > height && Math.random() > 0.975) {
          drops[i] = 0
        } else {
          drops[i] += 0.32
        }
      }

      animationFrame = window.requestAnimationFrame(draw)
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        active = false
        window.cancelAnimationFrame(animationFrame)
        return
      }

      if (!active) {
        active = true
        draw()
      }
    }

    resize()
    draw()

    window.addEventListener("resize", resize)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("resize", resize)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full opacity-[0.05] ${className}`}
    />
  )
}
