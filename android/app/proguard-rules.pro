# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Keep line numbers so Play Console can deobfuscate crash stack traces
# (the mapping file is bundled into the .aab automatically).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor plugin classes (incl. our WidgetBridgePlugin) are kept by the
# consumer rules shipped in @capacitor/android; manifest-declared components
# (MainActivity, TaskWidgetProvider) are kept by AAPT rules. No extra keeps
# needed — add rules here only if a plugin breaks in a release build.
