import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, X } from "lucide-react";
import { checkForUpdate, dismissUpdate, type UpdateInfo } from "@/lib/updateCheck";

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void checkForUpdate().then(setUpdate);
  }, []);

  return (
    <AnimatePresence>
      {update && (
        <motion.div
          initial={{ opacity: 0, y: -16, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -16, height: 0 }}
          className="mb-4 flex items-center gap-3 overflow-hidden rounded-2xl border border-primary/30 bg-primary/10 p-3 backdrop-blur"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/20 text-primary">
            <Download className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Update available — v{update.versionName}</div>
            {update.notes && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{update.notes}</div>
            )}
          </div>
          <a
            href={update.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Update
          </a>
          <button
            onClick={() => {
              dismissUpdate(update.versionCode);
              setUpdate(null);
            }}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-secondary"
          >
            <X className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
