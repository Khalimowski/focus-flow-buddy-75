package app.lovable.focusflow;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.capacitorjs.plugins.app.AppPlugin;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;
import com.capacitorjs.plugins.statusbar.StatusBarPlugin;
import com.capacitorjs.plugins.splashscreen.SplashScreenPlugin;
import dev.barooni.capacitor.calendar.CapacitorCalendarPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppPlugin.class);
        registerPlugin(LocalNotificationsPlugin.class);
        registerPlugin(StatusBarPlugin.class);
        registerPlugin(SplashScreenPlugin.class);
        registerPlugin(CapacitorCalendarPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        createNotificationChannel();
    }


    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            String channelId = "boink_channel_v8";
            CharSequence name = getString(R.string.nudge_channel_name);
            String description = getString(R.string.nudge_channel_description);
            int importance = NotificationManager.IMPORTANCE_HIGH;

            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager == null) return;

            NotificationChannel channel = new NotificationChannel(channelId, name, importance);
            channel.setDescription(description);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 2000});

            Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/boink");
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .build();
            channel.setSound(soundUri, audioAttributes);

            notificationManager.createNotificationChannel(channel);
        }
    }
}
