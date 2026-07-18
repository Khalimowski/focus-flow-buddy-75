import { useState } from "react";
import { Mail, Inbox } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "@/lib/i18n";
import { notify } from "@/lib/notifications";
import { ensureGoogleToken, listRecentEmails, type GmailMessage } from "@/lib/google";

// Recent-inbox picker: tap an email to turn its subject into a task. Rendered
// by TaskList only when the Gmail toggle is on and a Google account is
// connected (see Settings), so this component can assume the feature is live.
export function GmailImport({ onImport }: { onImport: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const { t } = useTranslation();

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      // Opening the dialog is a user gesture, so an interactive reconnect
      // (popup / account sheet) is allowed here if the token went stale.
      const token = await ensureGoogleToken();
      setEmails(await listRecentEmails(token));
    } catch (e) {
      console.warn("[Gmail] Load failed", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void load();
  };

  const pick = (msg: GmailMessage) => {
    onImport(msg.subject);
    setOpen(false);
    notify({ title: t("gmail_task_added"), body: msg.subject, kind: "info" });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 rounded-full px-3 text-[10px] font-bold gap-1.5"
        >
          <Mail className="size-3" />
          {t("gmail_import")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Inbox className="size-4" /> {t("gmail_import")}
          </DialogTitle>
          <DialogDescription>{t("gmail_import_desc")}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("loading")}</div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t("gmail_load_failed")}
          </div>
        ) : emails.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("gmail_empty")}</div>
        ) : (
          <ScrollArea className="max-h-[50vh]">
            <ul className="flex flex-col gap-1.5 pr-3">
              {emails.map((msg) => (
                <li key={msg.id}>
                  <button
                    onClick={() => pick(msg)}
                    className="w-full rounded-2xl border bg-card/40 p-3 text-left transition hover:bg-card/70 hover:border-primary/40"
                  >
                    <div className="truncate text-sm font-medium">{msg.subject}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {msg.from}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
