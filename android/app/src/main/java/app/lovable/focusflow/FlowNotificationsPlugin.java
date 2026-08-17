package app.lovable.focusflow;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * JS bridge for {@link FlowNotifications} — the app's own notification
 * scheduling, used instead of @capacitor/local-notifications so that the
 * action buttons can be handled without opening the app.
 *
 * Payloads cross as JSON strings (same idiom as WidgetBridge) because they nest
 * deeper than PluginCall's flat getters are comfortable with.
 */
@CapacitorPlugin(name = "FlowNotifications")
public class FlowNotificationsPlugin extends Plugin {

    private static final String TAG = "FlowNotif";

    /**
     * The loaded instance, if the WebView is up. Null in a process started only
     * to run the notification receiver — the press is queued in that case and
     * picked up by the web layer on next launch.
     */
    private static WeakReference<FlowNotificationsPlugin> instance;

    @Override
    public void load() {
        instance = new WeakReference<>(this);
    }

    /** options: { notifications: string } — JSON array of notification payloads */
    @PluginMethod
    public void schedule(PluginCall call) {
        String json = call.getString("notifications", "[]");
        try {
            JSONArray list = new JSONArray(json);
            for (int i = 0; i < list.length(); i++) {
                JSONObject n = list.optJSONObject(i);
                if (n != null) FlowNotifications.schedule(getContext(), n);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Invalid notification payload", e);
        }
    }

    /** options: { ids: number[] } */
    @PluginMethod
    public void cancel(PluginCall call) {
        List<Integer> ids = new ArrayList<>();
        try {
            List<Object> raw = call.getArray("ids").toList();
            for (Object o : raw) {
                if (o instanceof Number) ids.add(((Number) o).intValue());
            }
        } catch (Exception e) {
            call.reject("Invalid ids", e);
            return;
        }
        FlowNotifications.cancel(getContext(), ids);
        call.resolve();
    }

    /** { notifications: string } — JSON array of { id, extra } for everything armed */
    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("notifications", FlowNotifications.pending(getContext()).toString());
        call.resolve(ret);
    }

    /** { actions: string } — JSON array of queued button presses; clears the queue */
    @PluginMethod
    public void takePendingActions(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("actions", FlowNotifications.takeActions(getContext()).toString());
        call.resolve(ret);
    }

    /**
     * Nudge the web layer to drain the queue right away when the app happens to
     * be running. Best-effort: no listener means it drains on next resume.
     */
    static void emitAction(JSONObject record) {
        FlowNotificationsPlugin plugin = instance != null ? instance.get() : null;
        if (plugin == null) return;
        try {
            plugin.notifyListeners("actionPerformed", JSObject.fromJSONObject(record), true);
        } catch (Exception e) {
            Log.d(TAG, "no live listener for notification action", e);
        }
    }
}
