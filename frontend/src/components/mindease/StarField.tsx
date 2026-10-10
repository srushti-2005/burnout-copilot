import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  vx: number;
  vy: number;
}

/** Slowly drifting, twinkling stars on a canvas. Pauses when the tab is hidden. */
export function StarField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    let raf = 0;
    let last = 0;

    const build = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(200, Math.max(40, Math.floor(w * h * 0.00008)));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.2 + 0.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.2,
        vx: (Math.random() - 0.5) * 0.008,
        vy: -(0.004 + Math.random() * 0.01),
      }));
    };

    const draw = (t: number) => {
      const dt = last ? Math.min(t - last, 64) : 16;
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        if (!reduce) {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.y < -2) s.y = h + 2;
          if (s.x < -2) s.x = w + 2;
          if (s.x > w + 2) s.x = -2;
        }
        const tw = 0.5 + 0.5 * Math.sin(t * 0.001 * s.speed + s.phase);
        ctx.globalAlpha = 0.25 + 0.65 * tw;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.r > 1.1) {
          ctx.globalAlpha = 0.12 * tw;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      raf = requestAnimationFrame(draw);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };
    const onResize = () => {
      build();
      if (reduce) raf = requestAnimationFrame(draw);
    };

    build();
    start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}