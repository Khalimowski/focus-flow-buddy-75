import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Plus, Trash2, Edit2, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { useHistoryStore } from "@/lib/history";

type ToDoItem = {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
};

const sortItems = (list: ToDoItem[]) => {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return b.createdAt - a.createdAt;
  });
};

export function SimpleToDo() {
  const [items, setItems] = useState<ToDoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const { t } = useTranslation();
  const { addEvent } = useHistoryStore();

  useEffect(() => {
    const data = loadJSON<ToDoItem[]>(STORAGE_KEYS.todo, []);
    setItems(sortItems(data));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      saveJSON(STORAGE_KEYS.todo, items);
    }
  }, [items, loaded]);

  const add = () => {
    if (!title.trim()) return;

    const newItem: ToDoItem = {
      id: generateId(),
      title: title.trim(),
      done: false,
      createdAt: Date.now()
    };

    setItems(prev => sortItems([newItem, ...prev]));
    setTitle("");
    addEvent('todo_created', { title: newItem.title });
  };

  const startEdit = (item: ToDoItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
  };

  const saveEdit = () => {
    if (!editingId || !editTitle.trim()) return;

    setItems(prev => {
      const updated = prev.map(item => item.id === editingId ? {
        ...item,
        title: editTitle.trim()
      } : item);
      return sortItems(updated);
    });
    setEditingId(null);
    setEditTitle("");
  };

  const toggle = (id: string) => {
    setItems(prev => {
      const updated = prev.map((item) => {
        if (item.id !== id) return item;
        return { ...item, done: !item.done };
      });
      return sortItems(updated);
    });
  };

  const remove = (id: string) => {
    setItems(prev => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border bg-card/50 p-4 backdrop-blur shadow-sm">
        <div className="flex items-center gap-3">
          <Input
            placeholder={t('task_input_placeholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="flex-1 bg-transparent border-none text-base focus-visible:ring-0 px-0 h-auto"
          />
          <Button onClick={add} size="sm" className="size-8 rounded-full p-0 shadow-soft shrink-0">
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {items.length === 0 && (
            <motion.li
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground bg-card/10"
            >
              {t('tasks_empty')}
            </motion.li>
          )}
          {items.map((item) => (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex items-center gap-3 rounded-2xl border bg-card/40 border-border p-3 backdrop-blur"
            >
              {editingId === item.id ? (
                <div className="flex items-center gap-2 w-full">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                    className="flex-1 h-9 bg-transparent border-none px-0 text-sm focus-visible:ring-0"
                    autoFocus
                  />
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-8 w-8 p-0">
                      <X className="size-4" />
                    </Button>
                    <Button size="sm" onClick={saveEdit} className="h-8 w-8 p-0">
                      <Save className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => toggle(item.id)}
                    className={`grid size-6 shrink-0 place-items-center rounded-full border transition ${
                      item.done
                        ? "border-mint bg-mint text-mint-foreground"
                        : "border-border hover:border-primary"
                    }`}
                  >
                    {item.done && <Check className="size-3.5" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${item.done ? "text-muted-foreground line-through" : ""}`}>
                      {item.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => startEdit(item)}
                      className="size-8 rounded-lg bg-blue-500/5 border-blue-500/10 text-blue-500 hover:bg-blue-500/10"
                    >
                      <Edit2 className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => remove(item.id)}
                      className="size-8 rounded-lg bg-red-500/5 border-red-500/10 text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
