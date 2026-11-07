plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
// versionCode = the GitHub Actions run number (release tag android-N); local builds are 1.
val code = (System.getenv("VERSION_CODE") ?: "1").toInt()
// The signing key never lives in this public repo. CI signs only when the VENTORY_KS_B64 / VENTORY_KS_PASS secrets exist
// (decoded to a temp file, path in VENTORY_KS_FILE); otherwise it builds an unsigned APK that is signed privately.
val ksFile = System.getenv("VENTORY_KS_FILE")
val ksPass = System.getenv("VENTORY_KS_PASS")
android {
    namespace = "com.oscarvelz.ventory"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.oscarvelz.ventory"
        minSdk = 30
        targetSdk = 34
        versionCode = code
        versionName = "1.0.$code"
    }
    if (!ksFile.isNullOrBlank() && !ksPass.isNullOrBlank()) {
        signingConfigs {
            create("rel") {
                storeFile = file(ksFile)
                storePassword = ksPass
                keyAlias = "ventory"
                keyPassword = ksPass
                storeType = "pkcs12"
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (!ksFile.isNullOrBlank() && !ksPass.isNullOrBlank()) signingConfig = signingConfigs.getByName("rel")
        }
    }
    buildFeatures { buildConfig = true }
    lint { checkReleaseBuilds = false; abortOnError = false }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.core:core:1.13.1")
}
