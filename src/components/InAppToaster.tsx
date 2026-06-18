import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, X } from "lucide-react";
import { subscribeNotif, type InAppNotif } from "@/lib/notifications";

export function InAppToaster() {
  const [items, setItems] = useState<InAppNotif[]>([]);

  useEffect(() => {
    return subscribeNotif((n) => {
      setItems((cur) => [n, ...cur]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== n.id)), 6000);
    });
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {items.slice(0, 3).map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border bg-popover/90 p-3 backdrop-blur-xl shadow-glow"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Bell className="size-4" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{n.title}</div>
              {n.body && <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>}
            </div>
            <button
              onClick={() => setItems((cur) => cur.filter((x) => x.id !== n.id))}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-secondary"
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
