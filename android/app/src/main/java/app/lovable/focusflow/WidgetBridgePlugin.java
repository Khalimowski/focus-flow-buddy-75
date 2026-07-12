package app.lovable.focusflow;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS <-> widget bridge. The web app pushes its task list here (mirrored into
 * SharedPreferences for TaskWidgetProvider) and pulls back the ids of tasks
 * ticked from the widget while the app was closed.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(TaskWidgetProvider.PREFS, Context.MODE_PRIVATE);
    }

    /** options: { tasks: string } — JSON array of { id, title }, open tasks in display order */
    @PluginMethod
    public void setTasks(PluginCall call) {
        String json = call.getString("tasks", "[]");
        prefs().edit().putString(TaskWidgetProvider.KEY_TASKS, json).apply();
        TaskWidgetProvider.updateAll(getContext());
        call.resolve();
    }

    /** options: { theme: "light" | "dark" } — keeps the widget on the app's color mode */
    @PluginMethod
    public void setTheme(PluginCall call) {
        String theme = call.getString("theme", "dark");
        prefs().edit().putString(TaskWidgetProvider.KEY_THEME, theme).apply();
        TaskWidgetProvider.updateAll(getContext());
        call.resolve();
    }

    /** Returns and clears { ids: string[] } of tasks ticked from the widget. */
    @PluginMethod
    public void getPendingDone(PluginCall call) {
        String pending = prefs().getString(TaskWidgetProvider.KEY_PENDING, "[]");
        prefs().edit().remove(TaskWidgetProvider.KEY_PENDING).apply();
        JSObject ret = new JSObject();
        try {
            ret.put("ids", new JSArray(pending));
        } catch (Exception e) {
            ret.put("ids", new JSArray());
        }
        call.resolve(ret);
    }
}
