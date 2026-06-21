import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserAction =
  | 'task_created'
  | 'task_completed'
  | 'task_deleted'
  | 'task_edited'
  | 'nudge_created'
  | 'nudge_deleted'
  | 'ai_suggestion_accepted'
  | 'ai_suggestion_refused';

export interface HistoryEvent {
  id: string;
  type: UserAction;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface HistoryState {
  events: HistoryEvent[];
  firstLaunchDate: number | null;
  lastAISuggestionDate: number | null;
  addEvent: (type: UserAction, metadata?: Record<string, any>) => void;
  getDaysSinceLaunch: () => number;
  getDaysSinceLastAISuggestion: () => number;
  setAISuggestionDate: (date: number) => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      events: [],
      firstLaunchDate: null,
      lastAISuggestionDate: null,

      addEvent: (type, metadata) => {
        const now = Date.now();
        const newEvent: HistoryEvent = {
          id: crypto.randomUUID(),
          type,
          timestamp: now,
          metadata
        };

        set((state) => ({
          events: [...state.events, newEvent].slice(-500),
          firstLaunchDate: state.firstLaunchDate ?? now,
        }));
      },

      getDaysSinceLaunch: () => {
        const { firstLaunchDate } = get();
        if (!firstLaunchDate) return 0;
        const diff = Date.now() - firstLaunchDate;
        return Math.floor(diff / (1000 * 60 * 60 * 24));
      },

      getDaysSinceLastAISuggestion: () => {
        const { lastAISuggestionDate } = get();
        if (!lastAISuggestionDate) return 999; // Far in the past
        const diff = Date.now() - lastAISuggestionDate;
        return Math.floor(diff / (1000 * 60 * 60 * 24));
      },

      setAISuggestionDate: (date) => set({ lastAISuggestionDate: date }),
    }),
    {
      name: 'focus-flow-history',
    }
  )
);
