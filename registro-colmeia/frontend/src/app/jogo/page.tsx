"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { House, RotateCcw } from "lucide-react";

// ── Constantes do jogo ────────────────────────────────────────────────────────

const CANVAS_W = 800;
const CANVAS_H = 300;
const GROUND_Y = CANVAS_H - 48;

const BEE_X = 90;
const BEE_W = 36;
const BEE_H = 22;

const GRAVITY = 0.55;
const JUMP_V = -9.5;

const OBS_W = 28;
const OBS_GAP_MIN = 220;
const OBS_GAP_MAX = 380;
const OBS_SPEED_INIT = 4.5;
const OBS_SPEED_MAX = 11;
const SPEED_INC = 0.0008; // incremento por frame

type Phase = "idle" | "playing" | "dead";

interface Obs {
  x: number;
  topH: number;   // altura do obstáculo superior
  botY: number;   // y inicial do obstáculo inferior
  passed: boolean;
}

// ── Helpers de desenho ────────────────────────────────────────────────────────

function drawBee(ctx: CanvasRenderingContext2D, x: number, y: number, flap: number) {
  const cx = x + BEE_W / 2;
  const cy = y + BEE_H / 2;

  // Corpo
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, BEE_W / 2, BEE_H / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#fbbf24";
  ctx.fill();

  // Listras
  const stripes = [0.25, 0.5, 0.75];
  stripes.forEach((t) => {
    const sx = x + BEE_W * t;
    ctx.beginPath();
    ctx.ellipse(sx, cy, BEE_W * 0.08, BEE_H / 2 - 1, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#1c1917";
    ctx.fill();
  });

  // Asas — batem em função do frame
  const wingY = cy - BEE_H / 2 - 2;
  const wingFlap = Math.sin(flap * 0.6) * 5;
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;

  // asa esquerda
  ctx.beginPath();
  ctx.ellipse(cx - 6, wingY + wingFlap, 10, 7, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // asa direita
  ctx.beginPath();
  ctx.ellipse(cx + 6, wingY - wingFlap, 10, 7, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 1;

  // Olho
  ctx.beginPath();
  ctx.arc(x + BEE_W * 0.12, cy - 3, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#1c1917";
  ctx.fill();

  ctx.restore();
}

function drawHoneycomb(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // fundo
  ctx.fillStyle = "#d97706";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();

  // padrão favo
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = 1.2;
  const size = 10;
  const rows = Math.ceil(h / (size * 1.5)) + 1;
  const cols = Math.ceil(w / (size * Math.sqrt(3))) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hx = x + c * size * Math.sqrt(3) + (r % 2) * size * (Math.sqrt(3) / 2);
      const hy = y + r * size * 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = hx + size * 0.55 * Math.cos(angle);
        const py = hy + size * 0.55 * Math.sin(angle);
        if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function drawGround(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#92400e";
  ctx.fillRect(0, GROUND_Y, CANVAS_W, 4);

  // flores decorativas
  const positions = [50, 150, 280, 420, 560, 680, 760];
  positions.forEach((px) => {
    ctx.font = "18px serif";
    ctx.fillText("🌸", px, GROUND_Y + 22);
  });
}

function drawScore(ctx: CanvasRenderingContext2D, score: number, best: number) {
  ctx.fillStyle = "#451a03";
  ctx.font = "bold 15px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`RECORDE ${String(best).padStart(5, "0")}`, CANVAS_W - 12, 24);
  ctx.fillText(String(score).padStart(5, "0"), CANVAS_W - 12, 44);
  ctx.textAlign = "left";
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function JogoPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    phase: "idle" as Phase,
    beeY: GROUND_Y - BEE_H,
    beeVY: 0,
    obstacles: [] as Obs[],
    score: 0,
    best: 0,
    speed: OBS_SPEED_INIT,
    nextObsX: CANVAS_W + 60,
    frame: 0,
  });
  const rafRef = useRef<number>(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);

  // Verifica colisão entre abelha e obstáculo
  function checkCollision(obs: Obs, beeY: number): boolean {
    const bx1 = BEE_X + 4, bx2 = BEE_X + BEE_W - 4;
    const by1 = beeY + 3,  by2 = beeY + BEE_H - 3;
    const ox1 = obs.x,     ox2 = obs.x + OBS_W;

    if (bx2 < ox1 || bx1 > ox2) return false;

    // bate no bloco superior
    if (by1 < obs.topH) return true;
    // bate no bloco inferior
    if (by2 > obs.botY) return true;

    return false;
  }

  function spawnObs(fromX: number): Obs {
    const gap = 90 + Math.random() * 60; // abertura entre os blocos
    const topH = 40 + Math.random() * (GROUND_Y - gap - 80);
    return {
      x: fromX,
      topH,
      botY: topH + gap,
      passed: false,
    };
  }

  function resetGame() {
    const s = stateRef.current;
    s.phase = "playing";
    s.beeY = GROUND_Y / 2 - BEE_H;
    s.beeVY = 0;
    s.obstacles = [spawnObs(CANVAS_W + 60)];
    s.score = 0;
    s.speed = OBS_SPEED_INIT;
    s.nextObsX = CANVAS_W + 60;
    s.frame = 0;
    setPhase("playing");
    setScore(0);
  }

  const handleAction = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === "idle") {
      resetGame();
    } else if (s.phase === "playing") {
      s.beeVY = JUMP_V;
    } else if (s.phase === "dead") {
      resetGame();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        handleAction();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleAction]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function loop() {
      if (!ctx || !canvas) return;
      const s = stateRef.current;
      s.frame++;

      // ── fundo ──
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      // gradiente céu
      const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
      grad.addColorStop(0, "#fef9c3");
      grad.addColorStop(1, "#fde68a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CANVAS_W, GROUND_Y);

      drawGround(ctx);

      if (s.phase === "playing") {
        // física
        s.beeVY += GRAVITY;
        s.beeY += s.beeVY;

        // chão e teto
        if (s.beeY + BEE_H >= GROUND_Y) {
          s.beeY = GROUND_Y - BEE_H;
          s.phase = "dead";
          setPhase("dead");
          if (s.score > s.best) { s.best = s.score; setBest(s.score); }
        }
        if (s.beeY <= 0) { s.beeY = 0; s.beeVY = 0; }

        // velocidade crescente
        s.speed = Math.min(OBS_SPEED_MAX, s.speed + SPEED_INC);

        // mover obstáculos
        s.obstacles.forEach((o) => { o.x -= s.speed; });

        // spawn novo obstáculo
        const last = s.obstacles[s.obstacles.length - 1];
        if (last && last.x < CANVAS_W - (OBS_GAP_MIN + Math.random() * (OBS_GAP_MAX - OBS_GAP_MIN))) {
          s.obstacles.push(spawnObs(CANVAS_W + 20));
        }

        // remover obstáculos fora da tela
        s.obstacles = s.obstacles.filter((o) => o.x + OBS_W > -10);

        // score e colisão
        s.obstacles.forEach((o) => {
          if (!o.passed && o.x + OBS_W < BEE_X) {
            o.passed = true;
            s.score++;
            setScore(s.score);
          }
          if (checkCollision(o, s.beeY)) {
            s.phase = "dead";
            setPhase("dead");
            if (s.score > s.best) { s.best = s.score; setBest(s.score); }
          }
        });
      }

      // ── desenhar obstáculos ──
      s.obstacles.forEach((o) => {
        // bloco superior
        drawHoneycomb(ctx, o.x, 0, OBS_W, o.topH);
        // bloco inferior
        drawHoneycomb(ctx, o.x, o.botY, OBS_W, GROUND_Y - o.botY);
      });

      // ── abelha ──
      drawBee(ctx, BEE_X, s.beeY, s.frame);

      // ── score ──
      drawScore(ctx, s.score, s.best);

      // ── telas de idle / game over ──
      if (s.phase === "idle") {
        ctx.fillStyle = "rgba(69,26,3,0.55)";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = "#fef08a";
        ctx.font = "bold 28px monospace";
        ctx.textAlign = "center";
        ctx.fillText("🐝 Mandaçaia Run", CANVAS_W / 2, CANVAS_H / 2 - 20);
        ctx.font = "16px monospace";
        ctx.fillStyle = "#fde68a";
        ctx.fillText("Pressione Espaço ou toque para começar", CANVAS_W / 2, CANVAS_H / 2 + 16);
        ctx.textAlign = "left";
      }

      if (s.phase === "dead") {
        ctx.fillStyle = "rgba(69,26,3,0.55)";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = "#fef08a";
        ctx.font = "bold 26px monospace";
        ctx.textAlign = "center";
        ctx.fillText("💥 Colisão!", CANVAS_W / 2, CANVAS_H / 2 - 24);
        ctx.font = "16px monospace";
        ctx.fillStyle = "#fde68a";
        ctx.fillText(`Pontuação: ${s.score}  |  Recorde: ${s.best}`, CANVAS_W / 2, CANVAS_H / 2 + 8);
        ctx.fillText("Pressione Espaço ou toque para recomeçar", CANVAS_W / 2, CANVAS_H / 2 + 34);
        ctx.textAlign = "left";
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <main className="min-h-screen px-4 py-8 flex flex-col items-center" aria-label="Jogo Mandaçaia Run">

      {/* Navegação de volta */}
      <div className="w-full max-w-4xl mb-6 flex items-center gap-3">
        <a href="/"
          className="flex items-center gap-2 bg-yellow-950 hover:bg-yellow-900 text-yellow-300 text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          <House size={15} /> Início
        </a>
        <h1 className="text-lg font-bold text-yellow-950">🐝 Mandaçaia Run</h1>
      </div>

      {/* Canvas do jogo */}
      <div
        className="w-full max-w-4xl bg-yellow-950 rounded-2xl shadow-xl overflow-hidden cursor-pointer select-none"
        onClick={handleAction}
        role="button"
        aria-label="Área do jogo — clique ou pressione espaço para jogar"
        tabIndex={0}
        onKeyDown={(e) => { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); handleAction(); } }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="w-full h-auto"
        />
      </div>

      {/* Instruções e score */}
      <div className="w-full max-w-4xl mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-xl p-4 flex flex-col gap-1">
          <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide">Pontuação</p>
          <p className="text-2xl font-bold text-yellow-950">{String(score).padStart(5, "0")}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-xl p-4 flex flex-col gap-1">
          <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide">Recorde</p>
          <p className="text-2xl font-bold text-amber-600">{String(best).padStart(5, "0")}</p>
        </div>
        <div className="bg-yellow-950 rounded-2xl shadow-xl p-4 flex flex-col gap-1 col-span-2 sm:col-span-1">
          <p className="text-xs text-yellow-500 uppercase font-semibold tracking-wide">Controles</p>
          <p className="text-sm text-yellow-300">⎵ Espaço · ↑ Seta · Toque</p>
          <p className="text-xs text-yellow-500 mt-1">Desvie dos favos de mel!</p>
        </div>
      </div>

      {phase === "dead" && (
        <button
          onClick={handleAction}
          className="mt-4 flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-yellow-950 font-bold px-6 py-3 rounded-xl shadow-lg transition-colors"
        >
          <RotateCcw size={16} /> Jogar de novo
        </button>
      )}

      <p className="text-center text-xs text-yellow-800 opacity-60 mt-6 pb-4">
        © {new Date().getFullYear()} Projeto Colmeia Smart · SENAI Gaspar Ricardo Júnior
      </p>
    </main>
  );
}
