#!/bin/sh
# Signs the release APK with the real key, which lives outside the repo.
# Writes file-toss.apk. Run this from examples/file-toss.
set -eu

key_dir="${FILE_TOSS_KEY_DIR:-$HOME/.config/file-toss}"
sdk="${ANDROID_HOME:-$HOME/Android/Sdk}"
apksigner="$(ls -d "$sdk"/build-tools/* | sort -V | tail -1)/apksigner"

"$apksigner" sign \
  --ks "$key_dir/release.keystore" \
  --ks-key-alias file-toss \
  --ks-pass "file:$key_dir/keystore-password" \
  --out file-toss.apk \
  android/app/build/outputs/apk/release/app-release.apk
rm -f file-toss.apk.idsig
"$apksigner" verify --print-certs file-toss.apk | grep 'SHA-256'
