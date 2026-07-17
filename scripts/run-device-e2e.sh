#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM="${1:-both}"
APP_ID="${DEVICE_E2E_APP_ID:-ai.offgridmobile.dev}"
OUTPUT_ROOT="${DEVICE_E2E_OUTPUT_ROOT:-$ROOT_DIR/.artifacts/device-e2e}"
RUN_DIR="$OUTPUT_ROOT/$(date +%Y%m%d-%H%M%S)"
ANDROID_SERIAL="${ANDROID_SERIAL:-}"
IOS_WDA_URL="${IOS_WDA_URL:-}"

usage() {
  echo "Usage: $0 [android|ios|both]" >&2
  echo "Set ANDROID_SERIAL for Android and IOS_WDA_URL for iOS." >&2
}

case "$PLATFORM" in
  android | ios | both) ;;
  *)
    usage
    exit 2
    ;;
esac

mkdir -p "$RUN_DIR"

write_metadata() {
  {
    echo "platform=$PLATFORM"
    echo "app_id=$APP_ID"
    echo "commit=$(git -C "$ROOT_DIR" rev-parse HEAD)"
    echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$RUN_DIR/metadata.txt"
}

android_dump() {
  local destination="$1"
  adb -s "$ANDROID_SERIAL" shell uiautomator dump /sdcard/offgrid-window.xml >/dev/null
  adb -s "$ANDROID_SERIAL" pull /sdcard/offgrid-window.xml "$destination" >/dev/null
}

android_wait_for_id() {
  local resource_id="$1"
  local destination="$2"
  local attempt

  for attempt in $(seq 1 30); do
    android_dump "$destination" || true
    if [[ -s "$destination" ]] &&
      [[ "$(xmllint --xpath "boolean(//node[@resource-id='$resource_id'])" "$destination" 2>/dev/null)" == "true" ]]; then
      return 0
    fi
    sleep 1
  done

  echo "Android timed out waiting for resource-id=$resource_id" >&2
  return 1
}

android_tap_id() {
  local resource_id="$1"
  local source="$2"
  local bounds

  bounds="$(xmllint --xpath "string(//node[@resource-id='$resource_id']/@bounds)" "$source")"
  if [[ ! "$bounds" =~ \[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\] ]]; then
    echo "Android could not resolve bounds for resource-id=$resource_id" >&2
    return 1
  fi

  adb -s "$ANDROID_SERIAL" shell input tap \
    "$(((${BASH_REMATCH[1]} + ${BASH_REMATCH[3]}) / 2))" \
    "$(((${BASH_REMATCH[2]} + ${BASH_REMATCH[4]}) / 2))"
}

run_android() {
  local home_xml="$RUN_DIR/android-00-home.xml"
  local settings_xml="$RUN_DIR/android-01-settings.xml"

  if [[ -z "$ANDROID_SERIAL" ]]; then
    echo "ANDROID_SERIAL is required for Android." >&2
    return 1
  fi

  adb -s "$ANDROID_SERIAL" get-state >/dev/null
  adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081
  adb -s "$ANDROID_SERIAL" shell am force-stop "$APP_ID"
  adb -s "$ANDROID_SERIAL" shell monkey -p "$APP_ID" \
    -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

  android_wait_for_id home-screen "$home_xml"
  adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$RUN_DIR/android-00-home.png"

  android_tap_id settings-tab "$home_xml"
  android_wait_for_id settings-tab "$settings_xml"
  if [[ "$(xmllint --xpath 'string(//node[@resource-id="settings-tab"]/@selected)' "$settings_xml")" != "true" ]]; then
    echo "Android Settings tab did not become selected." >&2
    return 1
  fi
  adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$RUN_DIR/android-01-settings.png"

  echo "android: PASS (Home -> Settings)"
}

ios_json_value() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);const v=x.value;process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})'
}

ios_create_session() {
  curl -fsS -X POST "$IOS_WDA_URL/session" \
    -H 'Content-Type: application/json' \
    --data "{\"capabilities\":{\"alwaysMatch\":{\"bundleId\":\"$APP_ID\",\"shouldTerminateApp\":false,\"shouldActivateApp\":true}}}"
}

ios_source() {
  local session_id="$1"
  local destination="$2"
  curl -fsS "$IOS_WDA_URL/session/$session_id/source" | ios_json_value > "$destination"
}

ios_screenshot() {
  local session_id="$1"
  local destination="$2"
  curl -fsS "$IOS_WDA_URL/session/$session_id/screenshot" |
    ios_json_value |
    base64 --decode > "$destination"
}

ios_find_element() {
  local session_id="$1"
  local accessibility_id="$2"
  curl -fsS -X POST "$IOS_WDA_URL/session/$session_id/elements" \
    -H 'Content-Type: application/json' \
    --data "{\"using\":\"accessibility id\",\"value\":\"$accessibility_id\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s).value[0];if(!e)process.exit(1);process.stdout.write(e["element-6066-11e4-a52e-4f735466cecf"]||e.ELEMENT)})'
}

ios_wait_for_source_pattern() {
  local session_id="$1"
  local pattern="$2"
  local destination="$3"
  local attempt

  for attempt in $(seq 1 30); do
    ios_source "$session_id" "$destination"
    if rg -q "$pattern" "$destination"; then
      return 0
    fi
    sleep 1
  done

  echo "iOS timed out waiting for accessibility pattern: $pattern" >&2
  return 1
}

run_ios() {
  local session_response session_id settings_id

  if [[ -z "$IOS_WDA_URL" ]]; then
    echo "IOS_WDA_URL is required for iOS." >&2
    return 1
  fi

  curl -fsS --max-time 5 "$IOS_WDA_URL/status" >/dev/null
  session_response="$(ios_create_session)"
  session_id="$(printf '%s' "$session_response" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.sessionId||x.value.sessionId)})')"
  trap 'curl -fsS -X DELETE "$IOS_WDA_URL/session/$session_id" >/dev/null 2>&1 || true' RETURN

  ios_wait_for_source_pattern "$session_id" 'name="home-screen"' "$RUN_DIR/ios-00-home.xml"
  ios_screenshot "$session_id" "$RUN_DIR/ios-00-home.png"

  settings_id="$(ios_find_element "$session_id" settings-tab)"
  curl -fsS -X POST "$IOS_WDA_URL/session/$session_id/element/$settings_id/click" \
    -H 'Content-Type: application/json' --data '{}' >/dev/null
  ios_wait_for_source_pattern "$session_id" \
    'name="settings-tab"[^>]*traits="[^"]*Selected' "$RUN_DIR/ios-01-settings.xml"
  ios_screenshot "$session_id" "$RUN_DIR/ios-01-settings.png"

  echo "ios: PASS (Home -> Settings)"
}

write_metadata

case "$PLATFORM" in
  android) run_android ;;
  ios) run_ios ;;
  both)
    run_android
    run_ios
    ;;
esac

echo "artifacts: $RUN_DIR"
