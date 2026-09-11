# JPush official vendor-channel rules. These are harmless when a channel is not packaged.
-dontwarn com.xiaomi.push.**
-keep class com.xiaomi.push.** { *; }

-dontwarn com.vivo.push.**
-dontwarn com.vivo.vms.**
-keep class com.vivo.push.** { *; }
-keep class com.vivo.vms.** { *; }

-dontwarn com.coloros.mcsdk.**
-dontwarn com.heytap.**
-dontwarn com.mcs.**
-keep class com.coloros.mcsdk.** { *; }
-keep class com.heytap.** { *; }
-keep class com.mcs.** { *; }

-dontwarn com.huawei.hms.**
-keep class com.huawei.hms.** { *; }
