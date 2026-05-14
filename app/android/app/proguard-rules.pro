# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# React Native core + Hermes reflection entry points.
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# Keep native module getName() reflection targets.
-keepclassmembers class * extends com.facebook.react.bridge.BaseJavaModule {
    public <methods>;
}

# Sentry.
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# OkHttp3 / Okio — widely used by HTTP-based libraries.
-dontwarn okhttp3.**
-dontwarn okio.**

# Expo modules autolinking entry points.
-keep class expo.modules.** { *; }

# Preserve line numbers + source files so Sentry stack traces deobfuscate cleanly.
-keepattributes Signature,*Annotation*,EnclosingMethod,InnerClasses
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Add any project specific keep options here:
