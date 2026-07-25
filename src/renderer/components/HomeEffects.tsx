import React, { useEffect, useRef } from 'react';

// ── Particles ────────────────────────────────────────────────
interface Dot {
  x: number; y: number;
  vx: number; vy: number;
  r: number; alpha: number;
}

const Particles: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const dots: Dot[] = Array.from({ length: 55 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.5 + 0.4,
      alpha: Math.random() * 0.5 + 0.15,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0) d.x = canvas.width;
        if (d.x > canvas.width) d.x = 0;
        if (d.y < 0) d.y = canvas.height;
        if (d.y > canvas.height) d.y = 0;

        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${d.alpha})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
};

// ── CursorGlow ────────────────────────────────────────────────
// Exported so it can be used globally in the app root
interface CursorGlowProps {
  enabled?: boolean;
}

export const CursorGlow: React.FC<CursorGlowProps> = ({ enabled = true }) => {
  const divRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const el = divRef.current;
    if (!el) return;

    let animId: number;
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let curX = mouseX;
    let curY = mouseY;

    const onMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    window.addEventListener('mousemove', onMove);

    const animate = () => {
      curX += (mouseX - curX) * 0.08;
      curY += (mouseY - curY) * 0.08;

      hueRef.current = (hueRef.current + 0.003) % (Math.PI * 2);
      const t = (Math.sin(hueRef.current) + 1) / 2; // 0–1
      // lerp between #7c5cfc (purple) and #ff2d78 (neon pink)
      const r = Math.round(124 + (255 - 124) * t);
      const g = Math.round(92  + (45  - 92) * t);
      const b = Math.round(252 + (120 - 252) * t);

      el.style.left = `${curX}px`;
      el.style.top  = `${curY}px`;
      el.style.background = `radial-gradient(circle 400px at center, rgba(${r},${g},${b},0.10) 0%, transparent 70%)`;

      animId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', onMove);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={divRef}
      style={{
        position: 'fixed',
        width: '800px', height: '800px',
        marginLeft: '-400px', marginTop: '-400px',
        pointerEvents: 'none',
        zIndex: 0,
        borderRadius: '50%',
      }}
    />
  );
};

// ── HomeEffects ───────────────────────────────────────────────
interface HomeEffectsProps {
  enabled: boolean;
}

const HomeEffects: React.FC<HomeEffectsProps> = ({ enabled }) => {
  if (!enabled) return null;
  return (
    <>
      <Particles />
    </>
  );
};

export default HomeEffects;
