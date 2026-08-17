package app.lovable.focusflow;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Everything a FlowDay notification does without the app running:
 *
 * <ul>
 *   <li>{@code ACTION_FIRE} — an alarm came due, show the notification</li>
 *   <li>{@code ACTION_BUTTON} — "Done" / "Got it" / "Postpone" was pressed in
 *       the shade; handled here rather than by launching MainActivity</li>
 *   <li>{@code BOOT_COMPLETED} — alarms don't survive a reboot, re-arm them</li>
 * </ul>
 */
public class FlowNotificationReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        switch (action) {
            case FlowNotifications.ACTION_FIRE:
                FlowNotifications.fire(context, intent.getIntExtra(FlowNotifications.EXTRA_ID, 0));
                break;
            case FlowNotifications.ACTION_BUTTON:
                FlowNotifications.handleButton(
                        context,
                        intent.getIntExtra(FlowNotifications.EXTRA_ID, 0),
                        intent.getStringExtra(FlowNotifications.EXTRA_ACTION));
                break;
            case Intent.ACTION_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
                FlowNotifications.restoreAll(context);
                break;
            default:
                break;
        }
    }
}
