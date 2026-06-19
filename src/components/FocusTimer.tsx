import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, RotateCcw, Coffee, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { notify } from "@/lib/notifications";

type TimerState = {
  focusMin: number;
  breakMin: number;
  completedToday: number;
  lastDay: string;
};

const DEFAULT: TimerState = { focusMin: 25, breakMin: 5, completedToday: 0, lastDay: "" };
const today = () => new Date().toISOString().slice(0, 10);

export function FocusTimer() {
  const [s, setS] = useState<TimerState>(DEFAULT);
  const [phase, setPhase] = useState<"focus" | "break">("focus");
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(25 * 60);
  const endRef = useRef<number | null>(null);

  // load
  useEffect(() => {
    const loaded = loadJSON<TimerState>(STORAGE_KEYS.timer, DEFAULT);
    if (loaded.lastDay !== today()) {
      loaded.completedToday = 0;
      loaded.lastDay = today();
    }
    setS(loaded);
    setRemaining(loaded.focusMin * 60);
  }, []);

  useEffect(() => saveJSON(STORAGE_KEYS.timer, s), [s]);

  // tick
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (endRef.current == null) return;
      const left = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(id);
        setRunning(false);
        endRef.current = null;
        if (phase === "focus") {
          const next = { ...s, completedToday: s.completedToday + 1, lastDay: today() };
          setS(next);
          notify({ title: "Focus session done", body: "Nice work. Time for a short break.", kind: "timer" });
          setPhase("break");
          setRemaining(s.breakMin * 60);
        } else {
          notify({ title: "Break over", body: "Ready for another focus session?", kind: "timer" });
          setPhase("focus");
          setRemaining(s.focusMin * 60);
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, [running, phase, s]);

  const start = () => {
    endRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  };
  const pause = () => {
    setRunning(false);
    endRef.current = null;
  };
  const reset = () => {
    pause();
    setRemaining((phase === "focus" ? s.focusMin : s.breakMin) * 60);
  };

  const total = (phase === "focus" ? s.focusMin : s.breakMin) * 60;
  const pct = 1 - remaining / total;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  const R = 130;
  const C = 2 * Math.PI * R;

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex gap-2 rounded-full bg-surface p-1">
        {(["focus", "break"] as const).map((p) => (
          <button
            key={p}
            onClick={() => {
              setPhase(p);
              setRunning(false);
              setRemaining((p === "focus" ? s.focusMin : s.breakMin) * 60);
            }}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
              phase === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p === "focus" ? <Brain className="size-4" /> : <Coffee className="size-4" />}
            {p === "focus" ? "Focus" : "Break"}
          </button>
        ))}
      </div>

      <div className="relative">
        <svg width="300" height="300" className="-rotate-90">
          <circle cx="150" cy="150" r={R} fill="none" stroke="var(--color-border)" strokeWidth="6" />
          <motion.circle
            cx="150"
            cy="150"
            r={R}
            fill="none"
            stroke={phase === "focus" ? "var(--color-primary)" : "var(--color-mint)"}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            style={{ filter: "drop-shadow(0 0 12px color-mix(in oklab, var(--color-primary) 60%, transparent))" }}
            transition={{ ease: "linear" }}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-mono text-6xl font-semibold tabular-nums">
            {mm}:{ss}
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {phase === "focus" ? "Stay with it" : "Breathe"}
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        {running ? (
          <Button size="lg" variant="secondary" onClick={pause} className="rounded-full px-8">
            <Pause className="mr-2 size-4" /> Pause
          </Button>
        ) : (
          <Button size="lg" onClick={start} className="rounded-full px-8 shadow-glow">
            <Play className="mr-2 size-4" /> Start
          </Button>
        )}
        <Button size="lg" variant="ghost" onClick={reset} className="rounded-full">
          <RotateCcw className="size-4" />
        </Button>
      </div>

      <div className="grid w-full max-w-sm gap-5 rounded-2xl border bg-card/50 p-5 backdrop-blur">
        <Setting
          label="Focus"
          value={s.focusMin}
          min={5}
          max={60}
          step={5}
          unit="min"
          onChange={(v) => {
            setS({ ...s, focusMin: v });
            if (phase === "focus" && !running) setRemaining(v * 60);
          }}
        />
        <Setting
          label="Break"
          value={s.breakMin}
          min={1}
          max={20}
          step={1}
          unit="min"
          onChange={(v) => {
            setS({ ...s, breakMin: v });
            if (phase === "break" && !running) setRemaining(v * 60);
          }}
        />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Sessions today</span>
          <span className="font-mono text-mint">{s.completedToday}</span>
        </div>
      </div>
    </div>
  );
}

function Setting({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          {value} {unit}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}
