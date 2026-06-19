import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.focusflow",
  appName: "Focus Flow",
  webDir: "dist/client",
  bundledWebRuntime: false,
  android: {
    backgroundColor: "#0F1115",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#0F1115",
      androidSplashResourceName: "splash",
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon",
      iconColor: "#7C9CFF",
      presentationOptions: ["badge", "sound", "banner", "list"],
    },
  },
};

export default config;
