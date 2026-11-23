plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 빌드 시 -Ptoiletmap.webUrl=https://... 로 바꿀 수 있음
val webUrl: String = (findProperty("toiletmap.webUrl") as String?)
    ?.takeIf { it.isNotBlank() }
    ?: "https://toiletmap.example.com/"

val admobAppId: String = (findProperty("toiletmap.admobAppId") as String?)
    ?.takeIf { it.isNotBlank() } ?: "ca-app-pub-3940256099942544~3347511713"
val admobBannerId: String = (findProperty("toiletmap.admobBannerId") as String?)
    ?.takeIf { it.isNotBlank() } ?: "ca-app-pub-3940256099942544/9214589741"

// 구글 로그인: Google Cloud 의 OAuth "웹 애플리케이션" 클라이언트 ID (서버의 GOOGLE_CLIENT_ID 와 같은 값, 공개 값)
val googleClientId: String = (findProperty("toiletmap.googleClientId") as String?) ?: ""

// CI 에서 -Ptoiletmap.versionCode=<빌드번호> 로 올려서 새 APK 가 업데이트로 인식되게 함
val appVersionCode: Int = (findProperty("toiletmap.versionCode") as String?)?.toIntOrNull() ?: 1

// 플레이스토어 업로드용 서명 키 (CI 의 GitHub Secrets 에서 환경변수로 받음). 없으면 디버그 키로 서명
val uploadKeystore: String? = System.getenv("ANDROID_KEYSTORE_FILE")?.takeIf { file(it).exists() }

android {
    namespace = "com.salddeul.toiletmap"
    compileSdk = 36

    defaultConfig {
        // 플레이콘솔에 등록한 패키지 이름 (한 번 출시하면 바꿀 수 없음)
        applicationId = "com.ridertoilet.map"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = "1.0.$appVersionCode"
        buildConfigField("String", "WEB_URL", "\"$webUrl\"")
        // Google AdMob (공개 값, 비밀 아님). CI 에서 -Ptoiletmap.admobAppId / -Ptoiletmap.admobBannerId 로 넣음.
        // 없으면 구글 공식 테스트 광고 ID (실제 수익 없음)
        manifestPlaceholders["admobAppId"] = admobAppId
        buildConfigField("String", "ADMOB_BANNER_ID", "\"$admobBannerId\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleClientId\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (uploadKeystore != null) {
            create("upload") {
                storeFile = file(uploadKeystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (uploadKeystore != null) {
                signingConfigs.getByName("upload")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // 하단 배너 광고 (Google AdMob) + 유럽 사용자 동의 화면(UMP)
    implementation("com.google.android.gms:play-services-ads:23.6.0")
    implementation("com.google.android.ump:user-messaging-platform:3.1.0")
    // 구글 로그인 (Credential Manager)
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
}
