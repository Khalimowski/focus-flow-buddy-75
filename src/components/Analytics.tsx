import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, MoveRight, Trash2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { useTranslation } from "@/lib/i18n";
import {
  BUCKET_COUNT,
  buildInsights,
  outcomeSplit,
  rate,
  type Granularity,
  type InsightBucket,
  type Insights,
} from "@/lib/analytics";

const RANGES: Granularity[] = ["day", "week", "month"];

/** Chart colours, straight off the app's theme so light/dark both work. */
const COLORS = {
  completed: "var(--mint)",
  missed: "color-mix(in oklab, var(--primary) 25%, transparent)",
  open: "var(--border)",
  rate: "var(--primary)",
};

function Card({
  title,
  hint,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-card p-5 ${className}`}>
      {title && (
        <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h3>
      )}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      <div className={title ? "mt-4" : ""}>{children}</div>
    </div>
  );
}

export function Analytics() {
  const { t, language } = useTranslation();
  const dateLocale = language === "pl" ? pl : undefined;
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [data, setData] = useState<Insights | null>(null);

  const refresh = useCallback(() => setData(buildInsights(granularity)), [granularity]);

  useEffect(() => {
    refresh();
    // Same contract as the tabs: re-read storage when a sync pull or another
    // screen changes the underlying data, rather than remounting.
    window.addEventListener("ff.data_updated", refresh);
    window.addEventListener("ff.remote-update", refresh);
    return () => {
      window.removeEventListener("ff.data_updated", refresh);
      window.removeEventListener("ff.remote-update", refresh);
    };
  }, [refresh]);

  // 2024-01-01 was a Monday, so index 0 lands on Monday — matching the
  // Monday-first weeks used everywhere else in the app. Polish day names come
  // back lowercase from date-fns, and this one starts a sentence.
  const weekdayName = useCallback(
    (weekday: number) => {
      const name = format(new Date(2024, 0, 1 + weekday), "EEEE", { locale: dateLocale });
      return name.charAt(0).toUpperCase() + name.slice(1);
    },
    [dateLocale],
  );

  const bucketLabel = useCallback(
    (bucket: InsightBucket) => {
      if (granularity === "day") return format(bucket.start, "EEEEEE d", { locale: dateLocale });
      if (granularity === "week")
        return format(bucket.start, language === "pl" ? "d MMM" : "MMM d", { locale: dateLocale });
      return format(bucket.start, "LLL", { locale: dateLocale });
    },
    [granularity, dateLocale, language],
  );

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((bucket) => ({
      label: bucketLabel(bucket),
      completed: bucket.completed,
      missed: bucket.missed,
      open: Math.max(0, bucket.planned - bucket.completed - bucket.missed),
      rate: rate(bucket.completed, bucket.planned),
    }));
  }, [data, bucketLabel]);

  if (!data) return null;

  const { current, previous, lifetime, rangeStats, weekdays, todos, habitSlots } = data;
  const currentRate = rate(current.completed, current.planned);
  const previousRate = previous ? rate(previous.completed, previous.planned) : null;
  // Only compare against a period that actually had something planned —
  // "up 60 points on a week you planned nothing" is noise, not progress.
  const delta =
    previous && previous.planned > 0 && current.planned > 0 ? currentRate - previousRate! : null;

  const periodKey = granularity === "day" ? "today" : granularity === "week" ? "week" : "month";
  const outcomes = outcomeSplit(rangeStats);
  const hasHistory = data.buckets.some((b) => b.planned > 0);

  const bestWeekday = weekdays
    .filter((d) => d.planned >= 3)
    .sort((a, b) => rate(b.completed, b.planned) - rate(a.completed, a.planned))[0];

  const trackingSince = data.trackingSince
    ? format(
        new Date(`${data.trackingSince}T00:00:00`),
        language === "pl" ? "d MMMM yyyy" : "MMMM d, yyyy",
        {
          locale: dateLocale,
        },
      )
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-xl leading-tight">{t("insights_title")}</h2>
          <p className="text-xs text-muted-foreground">{t("insights_desc")}</p>
        </div>
        <div className="flex shrink-0 items-center rounded-full bg-card p-0.5">
          {RANGES.map((range) => (
            <button
              key={range}
              onClick={() => setGranularity(range)}
              aria-pressed={granularity === range}
              className={`rounded-full px-3 py-1.5 text-[10px] font-bold transition-all ${
                granularity === range
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`insights_range_${range}` as "insights_range_day")}
            </button>
          ))}
        </div>
      </div>

      {!hasHistory ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/60 py-12 text-center font-serif text-sm italic text-muted-foreground">
          {t("insights_empty")}
        </div>
      ) : (
        <>
          {/* Headline */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="sm:col-span-2">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {t(`insights_period_${periodKey}` as "insights_period_today")}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-3">
                <motion.span
                  key={`${granularity}-${currentRate}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="font-mono text-4xl font-semibold"
                >
                  {currentRate}%
                </motion.span>
                {delta !== null && (
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      delta > 0
                        ? "bg-mint/15 text-mint"
                        : delta < 0
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {delta > 0 ? (
                      <TrendingUp className="size-3" />
                    ) : delta < 0 ? (
                      <TrendingDown className="size-3" />
                    ) : (
                      <Minus className="size-3" />
                    )}
                    {delta > 0 ? "+" : ""}
                    {delta} {t("insights_points")}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("insights_planned_done")
                  .replace("{done}", String(current.completed))
                  .replace("{planned}", String(current.planned))}
              </p>
            </Card>

            <Card title={t("insights_lifetime")}>
              <div className="font-mono text-3xl font-semibold">
                {rate(lifetime.completed, lifetime.planned)}%
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("insights_planned_done")
                  .replace("{done}", String(lifetime.completed))
                  .replace("{planned}", String(lifetime.planned))}
              </p>
            </Card>
          </div>

          {/* Trend */}
          <Card
            title={t("insights_trend_title")}
            hint={t(`insights_trend_hint_${granularity}` as "insights_trend_hint_day").replace(
              "{n}",
              String(BUCKET_COUNT[granularity]),
            )}
          >
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  />
                  <YAxis yAxisId="rate" domain={[0, 100]} hide />
                  <Tooltip
                    cursor={{ fill: "var(--border)", fillOpacity: 0.25 }}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "0.75rem",
                      fontSize: "11px",
                    }}
                    formatter={(value: number, name: string) => [
                      name === "rate" ? `${value}%` : value,
                      t(`insights_legend_${name}` as "insights_legend_completed"),
                    ]}
                  />
                  {/* isAnimationActive={false} is load-bearing, not a style
                      choice: recharts 2.x grows bars from zero height via
                      react-smooth, and under React 19 that first frame never
                      advances — every bar stays at height 0 and renders
                      nothing at all. The line is unaffected (it animates a
                      dash offset), which is what makes the breakage look like
                      a data problem rather than an animation one. */}
                  <Bar
                    dataKey="completed"
                    stackId="tasks"
                    fill={COLORS.completed}
                    radius={[0, 0, 4, 4]}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="missed"
                    stackId="tasks"
                    fill={COLORS.missed}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="open"
                    stackId="tasks"
                    fill={COLORS.open}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="rate"
                    stroke={COLORS.rate}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
              {(["completed", "missed", "open", "rate"] as const).map((key) => (
                <span key={key} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: COLORS[key] }} />
                  {t(`insights_legend_${key}` as "insights_legend_completed")}
                </span>
              ))}
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            {/* Follow-through */}
            <Card
              title={t("insights_followthrough_title")}
              hint={
                trackingSince
                  ? t("insights_tracking_since").replace("{date}", trackingSince)
                  : t("insights_tracking_none")
              }
            >
              {outcomes.total === 0 ? (
                <p className="text-xs text-muted-foreground">{t("insights_followthrough_empty")}</p>
              ) : (
                <div className="space-y-3">
                  {(
                    [
                      {
                        key: "finished",
                        value: outcomes.finished,
                        icon: CheckCircle2,
                        color: "var(--mint)",
                      },
                      {
                        key: "moved",
                        value: outcomes.moved,
                        icon: MoveRight,
                        color: "var(--primary)",
                      },
                      {
                        key: "dropped",
                        value: outcomes.dropped,
                        icon: Trash2,
                        color: "var(--border)",
                      },
                    ] as const
                  ).map(({ key, value, icon: Icon, color }) => (
                    <div key={key} className="flex items-center gap-3">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="w-24 shrink-0 text-xs">
                        {t(`insights_${key}` as "insights_finished")}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${rate(value, outcomes.total)}%`,
                            background: color,
                          }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-right font-mono text-xs">
                        {value} · {rate(value, outcomes.total)}%
                      </span>
                    </div>
                  ))}

                  <dl className="grid grid-cols-2 gap-2 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                    {(
                      [
                        ["insights_rescheduled", rangeStats.taskRescheduled],
                        ["insights_postponed", rangeStats.taskPostponed],
                        ["insights_snoozed", rangeStats.taskSnoozed],
                        ["insights_to_todo", rangeStats.taskToTodo],
                      ] as const
                    ).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <dt className="truncate">{t(key)}</dt>
                        <dd className="font-mono text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </Card>

            {/* Weekday rhythm */}
            <Card
              title={t("insights_weekday_title")}
              hint={
                bestWeekday
                  ? t("insights_weekday_best").replace("{day}", weekdayName(bestWeekday.weekday))
                  : t("insights_weekday_thin")
              }
            >
              <div className="flex items-end justify-between gap-1.5">
                {weekdays.map((day) => {
                  const value = rate(day.completed, day.planned);
                  const best = bestWeekday?.weekday === day.weekday;
                  return (
                    <div key={day.weekday} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {day.planned > 0 ? `${value}%` : "–"}
                      </span>
                      <div className="flex h-24 w-full items-end rounded-md bg-secondary/60">
                        <div
                          className="w-full rounded-md transition-all"
                          style={{
                            height: `${Math.max(value, day.planned > 0 ? 4 : 0)}%`,
                            background: best ? "var(--mint)" : "var(--primary)",
                            opacity: best ? 1 : 0.55,
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-tighter text-muted-foreground">
                        {/* date-fns' own short form, not the first two letters
                            of the full name: Polish abbreviates piątek as "pt"
                            and niedziela as "nd", neither of which a slice
                            would produce. */}
                        {format(new Date(2024, 0, 1 + day.weekday), "EEEEEE", {
                          locale: dateLocale,
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* To-Do */}
            <Card title={t("insights_todo_title")}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="font-mono text-2xl font-semibold">{rangeStats.todoCompleted}</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("insights_todo_done")}
                  </p>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold">{todos.open}</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("insights_todo_open")}
                  </p>
                </div>
              </div>
              <p className="mt-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                {t("insights_todo_scheduled").replace("{n}", String(rangeStats.todoScheduled))}
              </p>
            </Card>

            {/* Habits */}
            <Card title={t("insights_habits_title")}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="font-mono text-2xl font-semibold">
                    {rangeStats.habitCompleted}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("insights_habits_done")}
                  </p>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold">{habitSlots}</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("insights_habits_slots")}
                  </p>
                </div>
              </div>
              <p className="mt-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                {t("insights_habits_snoozed").replace("{n}", String(rangeStats.habitSnoozed))}
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
