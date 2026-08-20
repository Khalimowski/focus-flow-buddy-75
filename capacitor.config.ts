import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.khalimowski.focusflow",
  appName: "FlowDay",
  webDir: "dist/client",
  bundledWebRuntime: false,
  android: {
    // The app's dark --background; the splash sits the icon tile on the same
    // colour so launch doesn't flash a different ground.
    backgroundColor: "#100E0C",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#100E0C",
      androidSplashResourceName: "splash",
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon",
      iconColor: "#C9A46A",
      presentationOptions: ["badge", "sound", "banner", "list"],
    },
  },
};

export default config;
