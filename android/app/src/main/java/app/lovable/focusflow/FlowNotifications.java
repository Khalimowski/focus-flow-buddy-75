package app.lovable.focusflow;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

/**
 * Notification scheduling that owns its action buttons.
 *
 * Capacitor's LocalNotifications builds every action button as
 * {@code PendingIntent.getActivity(...)} pointing at MainActivity, so tapping
 * "Done" / "Got it" cold-starts the whole WebView just to mark one thing off.
 * Here the buttons are broadcasts to {@link FlowNotificationReceiver}, which
 * handles them in the background: the shade entry goes away, the widget mirror
 * updates, and the app is never brought to the front.
 *
 * Native code can't reach the WebView's localStorage (where the app's data
 * actually lives), so a pressed button is recorded in a pending-action queue —
 * the same trick the home-screen widget already uses for its ticks — and the
 * web layer applies it on next launch/resume (see drainNotificationActions in
 * src/lib/native.ts).
 *
 * Scheduled notifications are persisted here as well, both to survive reboots
 * (see ACTION_BOOT in the receiver) and to answer getPending() for the web
 * layer's reconcile pass.
 */
final class FlowNotifications {

    private static final String TAG = "FlowNotif";

    static final String PREFS = "ff_notifs";
    /** JSON object, notification id -> payload. */
    static final String KEY_SCHEDULED = "scheduled";
    /** JSON array of button presses waiting for the web layer. */
    static final String KEY_ACTIONS = "pending_actions";
    /**
     * JSON array of recently posted notifications. One-shots leave the schedule
     * the moment they fire, but their buttons stay pressable in the shade for as
     * long as the user leaves them there — this is what answers those presses.
     */
    static final String KEY_POSTED = "posted";
    private static final int POSTED_HISTORY = 20;

    static final String ACTION_FIRE = "app.lovable.focusflow.NOTIF_FIRE";
    static final String ACTION_BUTTON = "app.lovable.focusflow.NOTIF_ACTION";
    static final String EXTRA_ID = "notif_id";
    static final String EXTRA_ACTION = "notif_action";

    /** A one-shot missed while the phone was off still fires if it's this fresh. */
    private static final long BOOT_CATCHUP_WINDOW_MS = 12 * 60 * 60 * 1000L;

    private FlowNotifications() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject readStore(Context context) {
        try {
            return new JSONObject(prefs(context).getString(KEY_SCHEDULED, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void writeStore(Context context, JSONObject store) {
        prefs(context).edit().putString(KEY_SCHEDULED, store.toString()).apply();
    }

    // --- Scheduling -------------------------------------------------------

    /**
     * Persist and arm one notification. Scheduling an id that already exists
     * replaces it, which is what lets the web layer re-issue a notification on
     * a different channel when the vibration setting changes.
     */
    static void schedule(Context context, JSONObject notification) {
        int id = notification.optInt("id", 0);
        if (id == 0) return;
        long at = nextTriggerAt(notification, System.currentTimeMillis());
        try {
            notification.put("at", at);
        } catch (Exception ignored) {
        }

        JSONObject store = readStore(context);
        try {
            store.put(String.valueOf(id), notification);
        } catch (Exception e) {
            return;
        }
        writeStore(context, store);
        arm(context, id, at);
    }

    /**
     * Next fire time: the stored instant for one-shots, the first daily slot
     * strictly after {@code after} for repeating ones. Callers pass a slightly
     * future {@code after} when re-arming a notification that just fired, so an
     * alarm delivered a hair early can't re-arm itself for the same slot.
     * Calendar rather than +24h so the clock stays put across DST.
     */
    private static long nextTriggerAt(JSONObject notification, long after) {
        if (!notification.optBoolean("repeatDaily", false)) {
            return notification.optLong("at", System.currentTimeMillis());
        }
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, notification.optInt("hour", 0));
        cal.set(Calendar.MINUTE, notification.optInt("minute", 0));
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        while (cal.getTimeInMillis() <= after) {
            cal.add(Calendar.DAY_OF_MONTH, 1);
        }
        return cal.getTimeInMillis();
    }

    private static PendingIntent firePendingIntent(Context context, int id) {
        Intent intent = new Intent(context, FlowNotificationReceiver.class);
        intent.setAction(ACTION_FIRE);
        intent.putExtra(EXTRA_ID, id);
        // Distinct data per id — the request code alone is enough for
        // PendingIntent identity, but this keeps them readable in dumpsys.
        intent.setData(Uri.parse("ffnotif://fire/" + id));
        return PendingIntent.getBroadcast(context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void arm(Context context, int id, long at) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        PendingIntent pi = firePendingIntent(context, id);
        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms();
        try {
            if (canExact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                // Exact alarms switched off in system settings — still fires, just
                // batched by the OS. Better a late nudge than none.
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException e) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
        Log.d(TAG, "armed " + id + " for " + new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(new Date(at)));
    }

    /** Drop the alarm, the shade entry, and the stored record for these ids. */
    static void cancel(Context context, List<Integer> ids) {
        if (ids.isEmpty()) return;
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        JSONObject store = readStore(context);
        for (Integer id : ids) {
            if (id == null) continue;
            PendingIntent pi = firePendingIntent(context, id);
            if (alarmManager != null) alarmManager.cancel(pi);
            pi.cancel();
            store.remove(String.valueOf(id));
            try {
                NotificationManagerCompat.from(context).cancel(id);
            } catch (Exception ignored) {
            }
        }
        writeStore(context, store);
    }

    /** Everything currently armed, as [{ id, extra }] for the web layer's reconcile pass. */
    static JSONArray pending(Context context) {
        JSONObject store = readStore(context);
        JSONArray out = new JSONArray();
        Iterator<String> keys = store.keys();
        while (keys.hasNext()) {
            JSONObject n = store.optJSONObject(keys.next());
            if (n == null) continue;
            JSONObject entry = new JSONObject();
            try {
                entry.put("id", n.optInt("id"));
                entry.put("extra", n.optJSONObject("extra") != null ? n.optJSONObject("extra") : new JSONObject());
            } catch (Exception e) {
                continue;
            }
            out.put(entry);
        }
        return out;
    }

    // --- Firing -----------------------------------------------------------

    /** Alarm went off: show it, then re-arm (daily) or forget it (one-shot). */
    static void fire(Context context, int id) {
        JSONObject store = readStore(context);
        JSONObject n = store.optJSONObject(String.valueOf(id));
        if (n == null) return;

        post(context, n);

        if (n.optBoolean("repeatDaily", false)) {
            long next = nextTriggerAt(n, System.currentTimeMillis() + 60_000L);
            try {
                n.put("at", next);
                store.put(String.valueOf(id), n);
            } catch (Exception ignored) {
            }
            writeStore(context, store);
            arm(context, id, next);
        } else {
            store.remove(String.valueOf(id));
            writeStore(context, store);
        }
    }

    /** Build and show the notification, buttons included. */
    static void post(Context context, JSONObject n) {
        int id = n.optInt("id", 0);
        if (id == 0) return;

        MainActivity.createNotificationChannels(context);

        String channelId = n.optString("channelId", "boink_channel_v8");
        String body = n.optString("body", "");

        Intent open = new Intent(context, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(context, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_stat_icon)
                .setColor(Color.parseColor("#7C9CFF"))
                .setContentTitle(n.optString("title", ""))
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(openPi);

        JSONObject labels = n.optJSONObject("labels");
        if (!"none".equals(n.optString("actions", "none")) && labels != null) {
            String done = labels.optString("done", "");
            String snooze = labels.optString("snooze", "");
            if (!done.isEmpty()) {
                builder.addAction(0, done, buttonPendingIntent(context, id, "done"));
            }
            if (!snooze.isEmpty()) {
                builder.addAction(0, snooze, buttonPendingIntent(context, id, "snooze"));
            }
        }

        rememberPosted(context, n);

        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS revoked between scheduling and firing
            Log.w(TAG, "notify " + id + " denied", e);
        }
    }

    private static PendingIntent buttonPendingIntent(Context context, int id, String action) {
        Intent intent = new Intent(context, FlowNotificationReceiver.class);
        intent.setAction(ACTION_BUTTON);
        intent.putExtra(EXTRA_ID, id);
        intent.putExtra(EXTRA_ACTION, action);
        // Data must differ per button or the two share one PendingIntent
        intent.setData(Uri.parse("ffnotif://action/" + id + "/" + action));
        return PendingIntent.getBroadcast(context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // --- Button presses ---------------------------------------------------

    /**
     * A button was pressed in the shade. Everything here runs without the app:
     * the notification is dismissed, the widget mirror is corrected, a snooze is
     * re-armed, and the press is queued for the web layer to apply to its own
     * storage later.
     */
    static void handleButton(Context context, int id, String action) {
        try {
            NotificationManagerCompat.from(context).cancel(id);
        } catch (Exception ignored) {
        }

        JSONObject n = lastPosted(context, id);
        if (n == null) return;
        JSONObject extra = n.optJSONObject("extra");
        if (extra == null) extra = new JSONObject();
        String type = extra.optString("type", "");

        JSONObject record = new JSONObject();
        try {
            record.put("action", action);
            record.put("type", type);
            record.put("taskId", extra.optString("taskId", ""));
            record.put("nudgeId", extra.optString("nudgeId", ""));
            record.put("time", extra.optString("time", ""));
            record.put("title", extra.optString("title", n.optString("title", "")));
            record.put("day", new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()));
        } catch (Exception e) {
            return;
        }

        if ("snooze".equals(action)) {
            scheduleSnooze(context, n);
        } else if ("done".equals(action) && "task".equals(type)) {
            // Keep the home-screen widget honest right away — the task itself is
            // only marked off once the web layer drains the queue.
            String taskId = extra.optString("taskId", "");
            if (!taskId.isEmpty()) TaskWidgetProvider.removeFromMirror(context, taskId);
        }

        queueAction(context, record);
        FlowNotificationsPlugin.emitAction(record);
    }

    /**
     * The record for a fired notification: one-shots are dropped from the store
     * when they fire, so keep a small ring of what was posted to answer button
     * presses that arrive afterwards.
     */
    private static JSONObject lastPosted(Context context, int id) {
        JSONObject store = readStore(context);
        JSONObject live = store.optJSONObject(String.valueOf(id));
        if (live != null) return live;
        try {
            JSONArray posted = new JSONArray(prefs(context).getString(KEY_POSTED, "[]"));
            for (int i = posted.length() - 1; i >= 0; i--) {
                JSONObject n = posted.optJSONObject(i);
                if (n != null && n.optInt("id") == id) return n;
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private static void rememberPosted(Context context, JSONObject n) {
        try {
            JSONArray posted = new JSONArray(prefs(context).getString(KEY_POSTED, "[]"));
            JSONArray next = new JSONArray();
            int id = n.optInt("id");
            for (int i = 0; i < posted.length(); i++) {
                JSONObject old = posted.optJSONObject(i);
                if (old != null && old.optInt("id") != id) next.put(old);
            }
            next.put(n);
            // Trim from the front — oldest first
            while (next.length() > POSTED_HISTORY) next.remove(0);
            prefs(context).edit().putString(KEY_POSTED, next.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    /** "Postpone" / "Remind later": a fresh one-shot under a throwaway id. */
    private static void scheduleSnooze(Context context, JSONObject original) {
        try {
            JSONObject snoozed = new JSONObject(original.toString());
            int minutes = original.optInt("snoozeMinutes", 15);
            // Throwaway id: the canonical one belongs to the original schedule and
            // must stay cancellable on its own (see reconcileNotifications).
            int id = (int) ((System.currentTimeMillis() / 1000L * 31 + original.optInt("id")) % 2000000000L);
            if (id < 0) id = -id;
            snoozed.put("id", id);
            snoozed.put("repeatDaily", false);
            snoozed.remove("hour");
            snoozed.remove("minute");
            snoozed.put("at", System.currentTimeMillis() + minutes * 60_000L);
            JSONObject labels = snoozed.optJSONObject("labels");
            if (labels != null && !labels.optString("snoozeBody", "").isEmpty()) {
                snoozed.put("body", labels.optString("snoozeBody"));
            }
            JSONObject extra = snoozed.optJSONObject("extra");
            if (extra != null) extra.put("postponed", true);
            schedule(context, snoozed);
        } catch (Exception e) {
            Log.w(TAG, "snooze failed", e);
        }
    }

    private static void queueAction(Context context, JSONObject record) {
        try {
            JSONArray queue = new JSONArray(prefs(context).getString(KEY_ACTIONS, "[]"));
            queue.put(record);
            prefs(context).edit().putString(KEY_ACTIONS, queue.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "queueAction failed", e);
        }
    }

    /** Returns and clears the queued button presses. */
    static JSONArray takeActions(Context context) {
        String raw = prefs(context).getString(KEY_ACTIONS, "[]");
        prefs(context).edit().remove(KEY_ACTIONS).apply();
        try {
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    // --- Boot -------------------------------------------------------------

    /** Re-arm everything after a reboot — alarms don't survive one. */
    static void restoreAll(Context context) {
        JSONObject store = readStore(context);
        JSONObject next = new JSONObject();
        long now = System.currentTimeMillis();
        List<Runnable> arms = new ArrayList<>();

        Iterator<String> keys = store.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            final JSONObject n = store.optJSONObject(key);
            if (n == null) continue;
            final int id = n.optInt("id", 0);
            if (id == 0) continue;

            long at;
            if (n.optBoolean("repeatDaily", false)) {
                at = nextTriggerAt(n, now);
            } else {
                at = n.optLong("at", 0);
                if (at <= now) {
                    // Missed while the phone was off. Recent ones still deserve to
                    // be seen; anything older is stale noise.
                    if (now - at > BOOT_CATCHUP_WINDOW_MS) continue;
                    at = now + 15_000L;
                }
            }
            try {
                n.put("at", at);
                next.put(key, n);
            } catch (Exception ignored) {
                continue;
            }
            final long fireAt = at;
            final Context ctx = context;
            arms.add(() -> arm(ctx, id, fireAt));
        }

        writeStore(context, next);
        for (Runnable r : arms) r.run();
        Log.d(TAG, "restored " + arms.size() + " notification(s) after boot");
    }
}
