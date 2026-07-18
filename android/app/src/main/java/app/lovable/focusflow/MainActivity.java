package app.lovable.focusflow;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import com.capacitorjs.plugins.app.AppPlugin;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;
import com.capacitorjs.plugins.statusbar.StatusBarPlugin;
import com.capacitorjs.plugins.splashscreen.SplashScreenPlugin;
import dev.barooni.capacitor.calendar.CapacitorCalendarPlugin;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppPlugin.class);
        registerPlugin(LocalNotificationsPlugin.class);
        registerPlugin(StatusBarPlugin.class);
        registerPlugin(SplashScreenPlugin.class);
        registerPlugin(CapacitorCalendarPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // Kill the Android 12+ overscroll stretch: it visually stretches the
        // whole page (header included) when scrolling past the top or bottom.
        // CSS overscroll-behavior doesn't reliably disable it in WebView.
        bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
    }

    @Override
    public void onResume() {
        super.onResume();
        createNotificationChannel();
    }

    // Google sign-in with Gmail/Calendar scopes: the social-login plugin runs
    // Google's AuthorizationClient consent UI and its result comes back here,
    // not to the plugin — forward it, or scoped logins hang/reject.
    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
                && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
            if (pluginHandle == null) {
                Log.i("MainActivity", "SocialLogin plugin handle is null");
                return;
            }
            Plugin plugin = pluginHandle.getInstance();
            if (!(plugin instanceof SocialLoginPlugin)) {
                Log.i("MainActivity", "SocialLogin plugin instance is not SocialLoginPlugin");
                return;
            }
            ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
    }

    // Marker required by the social-login plugin (never called).
    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}


    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager == null) return;

            // One channel per vibration style — channels are immutable after
            // creation, so the in-app vibration setting switches between these
            // ids at scheduling time (see VIBRATION_CHANNELS in src/lib/native.ts).
            createChannel(notificationManager, "boink_channel_v8",
                    getString(R.string.nudge_channel_name), new long[]{0, 2000});
            createChannel(notificationManager, "boink_channel_v8_short",
                    getString(R.string.channel_vib_short), new long[]{0, 300});
            createChannel(notificationManager, "boink_channel_v8_double",
                    getString(R.string.channel_vib_double), new long[]{0, 250, 150, 250});
            createChannel(notificationManager, "boink_channel_v8_novib",
                    getString(R.string.channel_vib_off), null);
        }
    }

    private void createChannel(NotificationManager notificationManager, String channelId,
                               CharSequence name, long[] vibrationPattern) {
        NotificationChannel channel = new NotificationChannel(channelId, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(getString(R.string.nudge_channel_description));
        if (vibrationPattern != null) {
            channel.enableVibration(true);
            channel.setVibrationPattern(vibrationPattern);
        } else {
            channel.enableVibration(false);
        }

        Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/boink");
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build();
        channel.setSound(soundUri, audioAttributes);

        notificationManager.createNotificationChannel(channel);
    }
}
