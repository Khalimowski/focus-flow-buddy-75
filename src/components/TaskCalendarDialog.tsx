import { useState } from "react";
import { Plus, Calendar as CalendarIcon } from "lucide-react";
import { format, isSameDay, startOfDay } from "date-fns";
import { pl } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/ui/time-input";
import { TaskCalendar, type CalendarTask } from "@/components/TaskCalendar";
import { useTranslation } from "@/lib/i18n";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: CalendarTask[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onAddTask: (title: string, time: string, date: Date) => void;
  onToggleTask: (id: string) => void;
  onEditTask: (task: CalendarTask) => void;
  onDeleteTask: (id: string) => void;
};

/**
 * The calendar in a popup, with its own composer so a day can be filled in
 * without leaving the overview. New tasks land on whichever day is selected.
 */
export function TaskCalendarDialog({
  open,
  onOpenChange,
  tasks,
  selectedDate,
  onSelectDate,
  onAddTask,
  onToggleTask,
  onEditTask,
  onDeleteTask,
}: Props) {
  const { t, language } = useTranslation();
  const dateLocale = language === "pl" ? pl : undefined;
  const shortDateFormat = language === "pl" ? "d MMM" : "MMM d";

  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");

  const submit = () => {
    if (!title.trim()) return;
    onAddTask(title, time, selectedDate);
    setTitle("");
    setTime("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-3 overflow-hidden rounded-3xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarIcon className="size-4 text-primary" />
            {t("view_calendar")}
          </DialogTitle>
          <DialogDescription className="text-xs">{t("calendar_popup_hint")}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <TaskCalendar
            tasks={tasks}
            selectedDate={selectedDate}
            onSelectDate={onSelectDate}
            onToggleTask={onToggleTask}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
          />
        </div>

        {/* Composer pinned below the scroll area so it stays reachable */}
        <div className="rounded-2xl border bg-card/50 p-3 backdrop-blur">
          <div className="flex flex-col gap-2">
            <Input
              name="calendar-task-title"
              autoComplete="off"
              placeholder={t("task_input_placeholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="h-auto border-none bg-transparent px-0 text-base focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2">
              <div className="flex items-center gap-2">
                <TimeInput
                  value={time}
                  onValueChange={setTime}
                  className="h-8 w-28 rounded-full border-none bg-secondary/50 font-mono text-xs"
                />
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/50 px-3 py-1.5 text-[10px] font-bold">
                  <CalendarIcon className="size-3" />
                  {isSameDay(selectedDate, new Date())
                    ? t("today")
                    : format(startOfDay(selectedDate), shortDateFormat, { locale: dateLocale })}
                </span>
              </div>
              <Button
                onClick={submit}
                size="sm"
                aria-label={t("add_task")}
                className="size-8 rounded-full p-0 shadow-soft"
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
