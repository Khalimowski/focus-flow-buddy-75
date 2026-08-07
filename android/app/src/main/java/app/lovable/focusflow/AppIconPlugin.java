package app.lovable.focusflow;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Swaps the home-screen icon between the dark and light logo tiles, following
 * the app's own light/dark setting (not the system one).
 *
 * Android has no API to change an icon directly: the launcher entry sits on two
 * activity-aliases declared in AndroidManifest.xml, each with its own icon, and
 * we enable one while disabling the other. The dark alias is the manifest
 * default, matching the app's default theme.
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {

    private static final String TAG = "AppIcon";
    private static final String DARK = "app.lovable.focusflow.MainActivityDark";
    private static final String LIGHT = "app.lovable.focusflow.MainActivityLight";

    /** options: { theme: "light" | "dark" } */
    @PluginMethod
    public void setTheme(PluginCall call) {
        boolean light = "light".equals(call.getString("theme", "dark"));
        String wantedName = light ? LIGHT : DARK;
        String otherName = light ? DARK : LIGHT;

        PackageManager pm = getContext().getPackageManager();
        ComponentName wanted = new ComponentName(getContext(), wantedName);
        ComponentName other = new ComponentName(getContext(), otherName);

        // Called on every launch and theme toggle. Re-applying an alias that is
        // already active makes some launchers drop and re-add the icon (losing
        // its place on the home screen), so bail out when nothing changes.
        if (isActive(pm, wanted, DARK.equals(wantedName))) {
            call.resolve();
            return;
        }

        try {
            // Enable first, then disable: if the process dies between the two
            // calls the app still has a launcher entry. Disabling first can
            // leave it with none — i.e. an app the user cannot open.
            pm.setComponentEnabledSetting(wanted,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);
            pm.setComponentEnabledSetting(other,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP);
            Log.i(TAG, "Launcher icon switched to " + (light ? "light" : "dark"));
        } catch (Exception e) {
            Log.w(TAG, "Failed to switch launcher icon", e);
            call.reject("Failed to switch launcher icon", e);
            return;
        }
        call.resolve();
    }

    /** DEFAULT means "whatever the manifest says", which differs per alias. */
    private boolean isActive(PackageManager pm, ComponentName component, boolean enabledInManifest) {
        int state = pm.getComponentEnabledSetting(component);
        if (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT) return enabledInManifest;
        return state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }
}
