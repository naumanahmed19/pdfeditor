# Android builds

PickPDF's Android application uses the same Tauri and React codebase as the
desktop application. Its package ID is `com.xvelopers.pickpdf`, its minimum
Android version is API 24, and it targets the current SDK installed by the
Android toolchain. PDF files can be opened or shared into PickPDF, and exported
files use Android's system document picker.

## Local prerequisites

Install these once:

- Android Studio with the Android SDK, SDK Platform 36, Android SDK Build Tools,
  Android SDK Platform-Tools, and NDK 27.1.12297006.
- Rust Android targets for `aarch64-linux-android`,
  `armv7-linux-androideabi`, `i686-linux-android`, and
  `x86_64-linux-android`.
- Bun and the normal project dependencies.

Set these user environment variables, adjusting the paths if Android Studio is
installed elsewhere:

```powershell
[Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Android\Android Studio\jbr', 'User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
[Environment]::SetEnvironmentVariable('NDK_HOME', "$env:LOCALAPPDATA\Android\Sdk\ndk\27.1.12297006", 'User')
```

On Windows, enable **Settings > System > For developers > Developer Mode**.
Tauri needs permission to create a symbolic link while assembling Android
packages. Restart the terminal after changing environment variables.

## Develop and build

```powershell
bun install --frozen-lockfile
bun run android:dev
```

Create APKs for testing:

```powershell
bun run android:apk
```

Create the Android App Bundle required by Google Play:

```powershell
bun run android:aab
```

Outputs are placed below `src-tauri/gen/android/app/build/outputs/`.

## Google Play signing

The generated debug APK is only for local testing. Before the first Play Store
upload, generate and protect an upload keystore, configure Gradle release
signing locally or in CI, and build a signed AAB. Never commit the keystore,
alias password, or keystore password. The generated Android `.gitignore`
already excludes `key.properties`, `keystore.properties`, and local keystores
should be kept outside the repository.

For the first release, create the app in Google Play Console, enable Play App
Signing, upload the signed AAB to an internal testing track, complete the store
listing and policy forms, and test it before promoting the release. Automated
Play uploads can be added after the first application and service-account
permissions are established.
