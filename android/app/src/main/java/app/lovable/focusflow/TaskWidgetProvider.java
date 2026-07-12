package app.lovable.focusflow;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Home-screen widget showing the first three open tasks.
 *
 * Data flows through SharedPreferences ("ff_widget"): the web app mirrors its
 * task list into KEY_TASKS via WidgetBridgePlugin; ticking a row here removes
 * it from the mirror and records the id in KEY_PENDING, which the app applies
 * back to localStorage on next launch/resume.
 */
public class TaskWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "ff_widget";
    static final String KEY_TASKS = "tasks_json";
    static final String KEY_PENDING = "pending_done";
    static final String KEY_THEME = "theme";
    static final String ACTION_TICK = "app.lovable.focusflow.WIDGET_TASK_TICK";
    static final String EXTRA_TASK_ID = "task_id";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            manager.updateAppWidget(id, buildViews(context, manager, id));
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager,
                                          int appWidgetId, android.os.Bundle newOptions) {
        // Re-render with a row count that fits the new size
        manager.updateAppWidget(appWidgetId, buildViews(context, manager, appWidgetId));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_TICK.equals(intent.getAction())) {
            String taskId = intent.getStringExtra(EXTRA_TASK_ID);
            if (taskId != null && !taskId.isEmpty()) {
                markDone(context, taskId);
            }
            updateAll(context);
        }
    }

    /** Refresh every instance of this widget. Safe to call from anywhere. */
    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TaskWidgetProvider.class));
        for (int id : ids) {
            manager.updateAppWidget(id, buildViews(context, manager, id));
        }
    }

    /** How many task rows fit the widget's current height (1..3). */
    private static int rowsForSize(AppWidgetManager manager, int appWidgetId) {
        try {
            int heightDp = manager.getAppWidgetOptions(appWidgetId)
                    .getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT);
            if (heightDp <= 0) return 3; // options not reported yet
            if (heightDp < 55) return 1;
            if (heightDp < 95) return 2;
        } catch (Exception ignored) {
        }
        return 3;
    }

    private static void markDone(Context context, String taskId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray tasks = new JSONArray(prefs.getString(KEY_TASKS, "[]"));
            JSONArray remaining = new JSONArray();
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject t = tasks.optJSONObject(i);
                if (t != null && !taskId.equals(t.optString("id"))) {
                    remaining.put(t);
                }
            }
            JSONArray pending = new JSONArray(prefs.getString(KEY_PENDING, "[]"));
            pending.put(taskId);
            prefs.edit()
                    .putString(KEY_TASKS, remaining.toString())
                    .putString(KEY_PENDING, pending.toString())
                    .apply();
        } catch (Exception ignored) {
            // Corrupt prefs JSON — leave state untouched rather than lose ticks
        }
    }

    private static RemoteViews buildViews(Context context, AppWidgetManager manager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);

        int maxRows = rowsForSize(manager, appWidgetId);
        // At one-row height the header steals too much space — drop it
        views.setViewVisibility(R.id.widget_header_row, maxRows == 1 ? View.GONE : View.VISIBLE);

        int[] rowIds = { R.id.widget_row_1, R.id.widget_row_2, R.id.widget_row_3 };
        int[] textIds = { R.id.widget_task_1, R.id.widget_task_2, R.id.widget_task_3 };
        int[] timeIds = { R.id.widget_time_1, R.id.widget_time_2, R.id.widget_time_3 };
        int[] checkIds = { R.id.widget_check_1, R.id.widget_check_2, R.id.widget_check_3 };

        SharedPreferences themePrefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean light = "light".equals(themePrefs.getString(KEY_THEME, "dark"));

        // Mirrors the app's palette (styles.css dark / .light)
        int colorText = Color.parseColor(light ? "#14161D" : "#ECEFF4");
        int colorMuted = Color.parseColor(light ? "#575E6C" : "#9AA3B2");
        int colorAccent = Color.parseColor(light ? "#5B7CE6" : "#7C9CFF");

        views.setInt(R.id.widget_root, "setBackgroundResource",
                light ? R.drawable.widget_bg_light : R.drawable.widget_bg);
        views.setInt(R.id.widget_logo, "setColorFilter", colorAccent);
        views.setTextColor(R.id.widget_header, colorMuted);
        views.setTextColor(R.id.widget_empty, colorMuted);

        JSONArray tasks;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            tasks = new JSONArray(prefs.getString(KEY_TASKS, "[]"));
        } catch (Exception e) {
            tasks = new JSONArray();
        }

        // Only today's tasks (device-local date, matching the app's dueDate format)
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        List<JSONObject> todayTasks = new ArrayList<>();
        for (int i = 0; i < tasks.length() && todayTasks.size() < maxRows; i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t != null && today.equals(t.optString("dueDate"))) {
                todayTasks.add(t);
            }
        }

        int shown = todayTasks.size();
        for (int i = 0; i < rowIds.length; i++) {
            if (i < shown) {
                JSONObject t = todayTasks.get(i);
                String id = t.optString("id");
                String title = t.optString("title");
                String time = t.optString("time");
                views.setViewVisibility(rowIds[i], View.VISIBLE);
                views.setTextViewText(textIds[i], title);
                views.setTextColor(textIds[i], colorText);
                views.setTextViewText(timeIds[i], time);
                views.setTextColor(timeIds[i], colorMuted);
                views.setViewVisibility(timeIds[i], time.isEmpty() ? View.GONE : View.VISIBLE);
                views.setInt(checkIds[i], "setColorFilter", colorAccent);

                Intent tick = new Intent(context, TaskWidgetProvider.class);
                tick.setAction(ACTION_TICK);
                tick.putExtra(EXTRA_TASK_ID, id);
                // Unique data URI so the three rows get distinct PendingIntents
                // (extras alone don't differentiate them)
                tick.setData(Uri.parse("ffwidget://tick/" + Uri.encode(id)));
                PendingIntent tickPi = PendingIntent.getBroadcast(
                        context, i, tick,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                views.setOnClickPendingIntent(rowIds[i], tickPi);
            } else {
                views.setViewVisibility(rowIds[i], View.GONE);
            }
        }
        views.setViewVisibility(R.id.widget_empty, shown == 0 ? View.VISIBLE : View.GONE);

        // Tapping anywhere else opens the app
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openPi = PendingIntent.getActivity(
                context, 100, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, openPi);

        return views;
    }
}
