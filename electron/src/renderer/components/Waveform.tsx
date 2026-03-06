import React, { useRef, useEffect, useCallback } from 'react';

interface WaveformProps {
  micLevel: number;
  systemLevel: number;
  isActive: boolean;
}

const HISTORY_LENGTH = 64;
const CANVAS_HEIGHT = 60;

export const Waveform: React.FC<WaveformProps> = ({ micLevel, systemLevel, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const micHistory = useRef<number[]>(new Array(HISTORY_LENGTH).fill(0));
  const sysHistory = useRef<number[]>(new Array(HISTORY_LENGTH).fill(0));
  const animationRef = useRef<number>(0);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 400, h: CANVAS_HEIGHT });
  const timeRef = useRef<number>(0);

  useEffect(() => {
    micHistory.current.push(micLevel);
    if (micHistory.current.length > HISTORY_LENGTH) micHistory.current.shift();
    sysHistory.current.push(systemLevel);
    if (sysHistory.current.length > HISTORY_LENGTH) sysHistory.current.shift();
  }, [micLevel, systemLevel]);

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: CANVAS_HEIGHT };
      canvas.width = rect.width * dpr;
      canvas.height = CANVAS_HEIGHT * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    timeRef.current += 1;
    const { w: width, h: height } = sizeRef.current;
    const midY = height / 2;

    ctx.clearRect(0, 0, width, height);

    // Faint center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    const barWidth = width / HISTORY_LENGTH;
    const barGap = 2;
    const micHist = micHistory.current;
    const sysHist = sysHistory.current;
    const r = 1.5;

    // Mic bars — upper half
    for (let i = 0; i < HISTORY_LENGTH; i++) {
      const level = micHist[i] || 0;
      const fade = 0.5 + 0.5 * (i / HISTORY_LENGTH);
      let barH: number;
      let alpha: number;

      if (isActive) {
        barH = Math.max(1, level * midY * 3);
        alpha = (0.15 + level * 0.60) * fade;
      } else {
        const breath = Math.sin((timeRef.current * 0.025) + (i * 0.12)) * 0.5 + 0.5;
        barH = 1 + breath * 3;
        alpha = 0.02 + breath * 0.02;
      }

      const barW = Math.max(1, barWidth - barGap);
      const bx = i * barWidth + (barWidth - barW) / 2;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;

      ctx.beginPath();
      ctx.moveTo(bx + r, midY - barH);
      ctx.lineTo(bx + barW - r, midY - barH);
      ctx.arcTo(bx + barW, midY - barH, bx + barW, midY - barH + r, r);
      ctx.lineTo(bx + barW, midY);
      ctx.lineTo(bx, midY);
      ctx.lineTo(bx, midY - barH + r);
      ctx.arcTo(bx, midY - barH, bx + r, midY - barH, r);
      ctx.closePath();
      ctx.fill();
    }

    // System bars — lower half (dimmer)
    for (let i = 0; i < HISTORY_LENGTH; i++) {
      const level = sysHist[i] || 0;
      const fade = 0.5 + 0.5 * (i / HISTORY_LENGTH);
      let barH: number;
      let alpha: number;

      if (isActive) {
        barH = Math.max(1, level * midY * 3);
        alpha = (0.10 + level * 0.40) * fade;
      } else {
        const breath = Math.sin((timeRef.current * 0.025) + (i * 0.12) + Math.PI) * 0.5 + 0.5;
        barH = 1 + breath * 2;
        alpha = 0.015 + breath * 0.015;
      }

      const barW = Math.max(1, barWidth - barGap);
      const bx = i * barWidth + (barWidth - barW) / 2;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;

      ctx.beginPath();
      ctx.moveTo(bx, midY);
      ctx.lineTo(bx + barW, midY);
      ctx.lineTo(bx + barW, midY + barH - r);
      ctx.arcTo(bx + barW, midY + barH, bx + barW - r, midY + barH, r);
      ctx.lineTo(bx + r, midY + barH);
      ctx.arcTo(bx, midY + barH, bx, midY + barH - r, r);
      ctx.closePath();
      ctx.fill();
    }

    animationRef.current = requestAnimationFrame(draw);
  }, [isActive]);

  useEffect(() => {
    animationRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationRef.current);
  }, [draw]);

  return (
    <div ref={containerRef} className="w-full">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
};
