import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Edit2, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export type TimelineTask = {
  kind: "task";
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null;
  dueDate: string;
  createdAt: number;
  notified?: boolean;
};

export type TimelineNudge = {
  kind: "nudge";
  id: string;
  title: string;
  done: boolean;
  time: string; // "HH:mm"
  originalId: string;
};

export type TimelineItem = TimelineTask | TimelineNudge;

type Props = {
  items: TimelineItem[];
  isToday: boolean;
  onToggleTask: (id: string) => void;
  onToggleNudge: (originalId: string, time: string) => void;
  onSetTaskTime: (id: string, minutes: number | null) => void;
  onEditTask: (task: TimelineTask) => void;
  onDeleteTask: (id: string) => void;
};

const BLOCK_MIN = 44; // visual block height in px == minutes (1px = 1min)
const SNAP = 5;
const HOLD_MS = 320;
const TOUCH_CANCEL_DIST = 10;
const MOUSE_START_DIST = 4;

const itemMinutes = (item: TimelineItem): number | null => {
  if (item.kind === "nudge") {
    const [h, m] = item.time.split(":").map(Number);
    return h * 60 + m;
  }
  if (!item.remindAt) return null;
  const d = new Date(item.remindAt);
  return d.getHours() * 60 + d.getMinutes();
};

const fmtMinutes = (min: number) => {
  const d = new Date();
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

type DragState = {
  itemId: string;
  minutes: number | null; // null = dropped on the "no time" shelf
  active: boolean;
};

type Session = {
  itemId: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  lastY: number;
  grabOffset: number;
  hadTime: boolean;
  active: boolean;
  holdTimer: number | null;
};

export function TaskTimeline({
  items,
  isToday,
  onToggleTask,
  onToggleNudge,
  onSetTaskTime,
  onEditTask,
  onDeleteTask,
}: Props) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const dragMinutesRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const timed = useMemo(
    () =>
      items
        .map((item) => ({ item, minutes: itemMinutes(item) }))
        .filter((e): e is { item: TimelineItem; minutes: number } => e.minutes !== null)
        .sort((a, b) => a.minutes - b.minutes),
    [items]
  );
  const untimed = useMemo(
    () => items.filter((i): i is TimelineTask => i.kind === "task" && !i.remindAt),
    [items]
  );

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const { startMin, endMin } = useMemo(() => {
    let startHour = 6;
    let endHour = 22;
    for (const e of timed) {
      startHour = Math.min(startHour, Math.floor(e.minutes / 60));
      endHour = Math.max(endHour, Math.ceil((e.minutes + BLOCK_MIN) / 60));
    }
    if (isToday) {
      startHour = Math.min(startHour, Math.floor(nowMin / 60));
      endHour = Math.max(endHour, Math.min(24, Math.ceil(nowMin / 60) + 1));
    }
    return { startMin: Math.max(0, startHour) * 60, endMin: Math.min(24, endHour) * 60 };
  }, [timed, isToday, nowMin]);

  // Calendar-style lane layout: cluster overlapping blocks, split cluster width evenly.
  const positioned = useMemo(() => {
    type Entry = { item: TimelineItem; minutes: number; lane: number; lanes: number };
    const out: Entry[] = [];
    let cluster: { item: TimelineItem; minutes: number; lane: number }[] = [];
    let laneEnds: number[] = [];
    let clusterEnd = -1;

    const flush = () => {
      const lanes = laneEnds.length || 1;
      for (const c of cluster) out.push({ ...c, lanes });
      cluster = [];
      laneEnds = [];
    };

    for (const e of timed) {
      if (cluster.length && e.minutes >= clusterEnd) flush();
      let lane = laneEnds.findIndex((end) => e.minutes >= end);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = e.minutes + BLOCK_MIN;
      cluster.push({ ...e, lane });
      clusterEnd = Math.max(clusterEnd, e.minutes + BLOCK_MIN);
    }
    flush();
    return out;
  }, [timed]);

  const cleanupSession = () => {
    const s = sessionRef.current;
    if (s?.holdTimer) window.clearTimeout(s.holdTimer);
    sessionRef.current = null;
    setDrag(null);
  };

  const beginPress = (e: React.PointerEvent, item: TimelineTask, blockMinutes: number | null) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (sessionRef.current) return;
    const grid = gridRef.current;
    if (!grid) return;

    const rect = grid.getBoundingClientRect();
    const grabOffset =
      blockMinutes !== null ? e.clientY - (rect.top + (blockMinutes - startMin)) : 12;

    const session: Session = {
      itemId: item.id,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      lastY: e.clientY,
      grabOffset,
      hadTime: blockMinutes !== null,
      active: false,
      holdTimer: null,
    };
    sessionRef.current = session;

    const scroller = findScrollParent(grid);

    const computeMinutes = (clientY: number): number | null => {
      const r = grid.getBoundingClientRect();
      // Dragging well above the grid drops the task onto the "no time" shelf.
      if (clientY < r.top - 24) return null;
      const raw = clientY - r.top - session.grabOffset + startMin;
      const snapped = Math.round(raw / SNAP) * SNAP;
      return Math.min(Math.max(snapped, startMin), endMin - SNAP);
    };

    const activate = () => {
      if (session.active) return;
      session.active = true;
      if ("vibrate" in navigator) navigator.vibrate?.(15);
      const m = computeMinutes(session.lastY);
      dragMinutesRef.current = m;
      setDrag({ itemId: session.itemId, minutes: m, active: true });
    };

    const onTouchMove = (ev: TouchEvent) => {
      if (session.active) ev.preventDefault();
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== session.pointerId) return;
      session.lastY = ev.clientY;
      const dx = Math.abs(ev.clientX - session.startX);
      const dy = Math.abs(ev.clientY - session.startY);

      if (!session.active) {
        if (session.pointerType === "touch") {
          // Finger moved before the hold completed: it's a scroll, bail out.
          if (dx > TOUCH_CANCEL_DIST || dy > TOUCH_CANCEL_DIST) teardown();
        } else if (dx > MOUSE_START_DIST || dy > MOUSE_START_DIST) {
          activate();
        }
        return;
      }

      if (scroller) {
        const viewTop = scroller.getBoundingClientRect().top;
        const viewBottom = viewTop + scroller.clientHeight;
        if (ev.clientY < viewTop + 90) scroller.scrollTop -= 12;
        else if (ev.clientY > viewBottom - 90) scroller.scrollTop += 12;
      } else {
        if (ev.clientY < 90) window.scrollBy(0, -12);
        else if (ev.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
      }

      const m = computeMinutes(ev.clientY);
      dragMinutesRef.current = m;
      setDrag({ itemId: session.itemId, minutes: m, active: true });
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== session.pointerId) return;
      if (session.active) {
        suppressClickRef.current = true;
        const m = dragMinutesRef.current;
        // Untimed task dropped back on the shelf: nothing changed.
        if (!(m === null && !session.hadTime)) onSetTaskTime(session.itemId, m);
      }
      teardown();
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== session.pointerId) return;
      teardown();
    };

    const teardown = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", onTouchMove);
      cleanupSession();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });

    if (e.pointerType === "touch") {
      session.holdTimer = window.setTimeout(activate, HOLD_MS);
    }
  };

  const blockClick = (e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const gridHeight = endMin - startMin;
  const hours: number[] = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  const dragging = drag?.active ? drag : null;
  const shelfHighlight = !!dragging && dragging.minutes === null;

  const renderCheck = (item: TimelineItem) => (
    <button
      onClick={() =>
        item.kind === "task" ? onToggleTask(item.id) : onToggleNudge(item.originalId, item.time)
      }
      aria-label={item.title}
      aria-pressed={item.done}
      className={`grid size-5 shrink-0 place-items-center rounded-full border transition ${
        item.done
          ? item.kind === "nudge"
            ? "border-amber-500 bg-amber-500 text-white"
            : "border-mint bg-mint text-mint-foreground"
          : item.kind === "nudge"
            ? "border-border hover:border-amber-500"
            : "border-border hover:border-primary"
      }`}
    >
      {item.done && <Check className="size-3" strokeWidth={3} />}
    </button>
  );

  return (
    <div className="flex flex-col gap-3 select-none">
      <p className="text-[11px] text-muted-foreground text-center">{t("timeline_hint")}</p>

      {/* "No time" shelf */}
      {(untimed.length > 0 || shelfHighlight) && (
        <div
          className={`rounded-2xl border border-dashed p-2 flex flex-col gap-1.5 transition-colors ${
            shelfHighlight ? "border-primary bg-primary/10" : "border-border/60 bg-card/20"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1">
            {t("timeline_no_time")}
          </span>
          {untimed.map((task) => (
            <div
              key={task.id}
              onPointerDown={(e) => beginPress(e, task, null)}
              onContextMenu={(e) => e.preventDefault()}
              onClickCapture={blockClick}
              className={`flex items-center gap-2 rounded-xl border bg-card/50 px-2.5 py-2 cursor-grab active:cursor-grabbing touch-pan-y ${
                dragging?.itemId === task.id ? "opacity-40" : ""
              }`}
              style={{ touchAction: dragging?.itemId === task.id ? "none" : undefined }}
            >
              {renderCheck(task)}
              <span
                className={`flex-1 min-w-0 truncate text-sm font-medium ${
                  task.done ? "text-muted-foreground line-through" : ""
                }`}
              >
                {task.title}
              </span>
              <button
                onClick={() => onEditTask(task)}
                aria-label={t("edit")}
                className="grid size-6 shrink-0 place-items-center rounded-md text-blue-500/80 hover:bg-blue-500/10"
              >
                <Edit2 className="size-3.5" />
              </button>
              <button
                onClick={() => onDeleteTask(task.id)}
                aria-label={t("delete")}
                className="grid size-6 shrink-0 place-items-center rounded-md text-red-500/80 hover:bg-red-500/10"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hour grid */}
      <div className="rounded-2xl border bg-card/30 backdrop-blur p-2 pt-3">
        <div className="relative ml-12 mr-1" style={{ height: gridHeight }}>
          <div ref={gridRef} className="absolute inset-0">
            {hours.map((m) => (
              <div
                key={m}
                className="absolute left-0 right-0 border-t border-border/40"
                style={{ top: m - startMin }}
              >
                <span className="absolute -left-11 -top-2 w-10 text-right text-[10px] font-mono text-muted-foreground">
                  {fmtMinutes(m)}
                </span>
              </div>
            ))}

            {isToday && nowMin >= startMin && nowMin <= endMin && (
              <div
                className="absolute left-0 right-0 z-20 pointer-events-none"
                style={{ top: nowMin - startMin }}
              >
                <div className="h-px bg-red-500" />
                <div className="absolute -left-1.5 -top-[3px] size-1.5 rounded-full bg-red-500" />
              </div>
            )}

            {positioned.map(({ item, minutes, lane, lanes }) => {
              const isDragged = dragging?.itemId === item.id;
              const top =
                isDragged && dragging.minutes !== null ? dragging.minutes - startMin : minutes - startMin;
              const width = 100 / lanes;
              const draggable = item.kind === "task";
              return (
                <div
                  key={item.id}
                  onPointerDown={draggable ? (e) => beginPress(e, item, minutes) : undefined}
                  onContextMenu={(e) => e.preventDefault()}
                  onClickCapture={blockClick}
                  className={`absolute flex items-center gap-2 overflow-hidden rounded-xl border px-2 shadow-sm ${
                    item.kind === "nudge"
                      ? "bg-amber-500/10 border-amber-500/20"
                      : "bg-card border-border"
                  } ${draggable ? "cursor-grab active:cursor-grabbing touch-pan-y" : ""} ${
                    isDragged
                      ? dragging.minutes === null
                        ? "opacity-30"
                        : "z-30 ring-2 ring-primary shadow-glow"
                      : ""
                  } ${item.done && !isDragged ? "opacity-60" : ""}`}
                  style={{
                    top,
                    height: BLOCK_MIN,
                    left: `${lane * width}%`,
                    width: `calc(${width}% - 2px)`,
                    touchAction: isDragged ? "none" : undefined,
                    transition: isDragged ? "none" : "top 150ms ease",
                  }}
                >
                  {renderCheck(item)}
                  <div className="flex-1 min-w-0">
                    <div
                      className={`truncate text-xs font-medium leading-tight ${
                        item.done ? "text-muted-foreground line-through" : ""
                      }`}
                    >
                      {item.title}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                      <Clock className="size-2.5" />
                      {isDragged && dragging.minutes !== null
                        ? fmtMinutes(dragging.minutes)
                        : fmtMinutes(minutes)}
                    </div>
                  </div>
                  {item.kind === "nudge" ? (
                    <Sparkles className="size-3.5 shrink-0 text-amber-500/50" />
                  ) : (
                    <div className="flex shrink-0 items-center">
                      <button
                        onClick={() => onEditTask(item)}
                        aria-label={t("edit")}
                        className="grid size-6 place-items-center rounded-md text-blue-500/80 hover:bg-blue-500/10"
                      >
                        <Edit2 className="size-3.5" />
                      </button>
                      <button
                        onClick={() => onDeleteTask(item.id)}
                        aria-label={t("delete")}
                        className="grid size-6 place-items-center rounded-md text-red-500/80 hover:bg-red-500/10"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Time bubble while dragging */}
            {dragging && dragging.minutes !== null && (
              <div
                className="absolute -left-12 z-30 pointer-events-none rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-mono font-bold text-primary-foreground"
                style={{ top: dragging.minutes - startMin - 8 }}
              >
                {fmtMinutes(dragging.minutes)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
