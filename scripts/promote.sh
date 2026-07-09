#!/usr/bin/env bash
set -euo pipefail

# promote.sh — bless a tested BETA cut to production on all three channels, reusing
# the EXACT bytes that were tested. The other half of scripts/uat.sh (which cuts a
# beta to Play internal + TestFlight + a GitHub prerelease). Nothing here rebuilds
# the app.
#
#   Usage: scripts/promote.sh v0.0.103-beta.1 [--ios|--android|--github]   (no target arg = all three)
#
# What it does (promote-as-is, per channel):
#   * Repo:    bump package.json to the target version, commit, tag v<version>, push.
#   * Play:    fastlane android promote — moves the internal AAB to production (draft).
#   * iOS:     fastlane ios promote — attaches the existing TestFlight build to a new
#              App Store version (no binary upload).
#   * GitHub:  download the APK from the beta prerelease and re-attach it to a fresh
#              v<version> full release (not prerelease, marked latest). No rebuild.
#
# Two final gates stay MANUAL, by design (a script must not do these):
#   * Play:    the production release is a DRAFT — confirm the rollout % in the console.
#   * iOS:     the App Store version is created but NOT submitted — hit Submit in ASC.
#
# Credentials come from fastlane/.env (same as uat.sh). Requires: node, gh, bundle.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

BETA_TAG="${1:-}"
[ -n "$BETA_TAG" ] || error "Usage: scripts/promote.sh <beta-tag> [--ios|--android|--github]  (e.g. v0.0.103-beta.1)"

DO_IOS=1; DO_ANDROID=1; DO_GITHUB=1
case "${2:-}" in
  --ios)     DO_ANDROID=0; DO_GITHUB=0 ;;
  --android) DO_IOS=0; DO_GITHUB=0 ;;
  --github)  DO_IOS=0; DO_ANDROID=0 ;;
  "" ) ;;
  * ) error "Unknown arg '$2'. Use --ios, --android, --github, or no arg for all." ;;
esac

# ── pre-flight ─────────────────────────────────────────────────────
command -v node   >/dev/null || error "node not installed"
command -v gh     >/dev/null || error "gh CLI not installed"
command -v bundle >/dev/null || error "bundler not installed (bundle install)"
[ -f fastlane/Fastfile ]     || error "fastlane/Fastfile not found"
[ -z "$(git status --porcelain)" ] || error "Working tree is dirty. Commit or stash first."

# ── derive the target version from the beta tag (single source of truth) ──
TARGET_VERSION=$(node scripts/lib/version.js target-from-beta "$BETA_TAG") || error "Could not derive a version from '$BETA_TAG'"
CURRENT_VERSION=$(node -p "require('./package.json').version")
info "Promoting ${BOLD}${BETA_TAG}${NC} → production ${BOLD}${TARGET_VERSION}${NC} (package.json currently ${CURRENT_VERSION})"

# ── assert we are promoting what was tested: the beta tag's commit is on main ──
git fetch --tags --quiet origin || error "Could not fetch tags/refs"
git rev-parse -q --verify "refs/tags/${BETA_TAG}" >/dev/null || error "Tag ${BETA_TAG} not found locally (git fetch --tags)"
BETA_SHA=$(git rev-list -n1 "$BETA_TAG")
if ! git merge-base --is-ancestor "$BETA_SHA" origin/main; then
  error "The commit for ${BETA_TAG} (${BETA_SHA:0:8}) is NOT on origin/main. Refusing to promote a build that isn't on main."
fi
info "Verified ${BETA_TAG} (${BETA_SHA:0:8}) is on origin/main."

# ── 1. reconcile the repo: bump package.json to the target, commit, tag, push ──
if git rev-parse -q --verify "refs/tags/v${TARGET_VERSION}" >/dev/null; then
  warn "Tag v${TARGET_VERSION} already exists — skipping the version bump/tag (idempotent re-run)."
else
  info "Bumping package.json → ${TARGET_VERSION}, tagging v${TARGET_VERSION}"
  node -e "const fs=require('fs'),p=require('./package.json');p.version='${TARGET_VERSION}';fs.writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n')"
  # Keep package-lock's top-level version in step if present (no full reinstall).
  [ -f package-lock.json ] && node -e "const fs=require('fs'),l=require('./package-lock.json');l.version='${TARGET_VERSION}';if(l.packages&&l.packages['']){l.packages[''].version='${TARGET_VERSION}';}fs.writeFileSync('./package-lock.json',JSON.stringify(l,null,2)+'\n')" || true
  git add package.json package-lock.json 2>/dev/null || git add package.json
  git commit -m "chore(release): ${TARGET_VERSION}"
  git tag "v${TARGET_VERSION}"
  git push origin HEAD --tags
fi

# ── 2. Play: promote the existing internal build to production (draft) ──
if [ "$DO_ANDROID" = 1 ]; then
  info "Play: promoting the tested internal build to production (draft)…"
  bundle exec fastlane android promote
  info "Play done — open Play Console → Production and confirm the rollout %."
fi

# ── 3. App Store: attach the existing TestFlight build to a new version ──
if [ "$DO_IOS" = 1 ]; then
  info "App Store: attaching the tested TestFlight build to version ${TARGET_VERSION}…"
  bundle exec fastlane ios promote app_version:"${TARGET_VERSION}"
  info "App Store done — open App Store Connect and hit Submit for Review."
fi

# ── 4. GitHub: cut a clean v<version> full release from the tested APK ──
if [ "$DO_GITHUB" = 1 ]; then
  info "GitHub: cutting v${TARGET_VERSION} from the tested ${BETA_TAG} APK (no rebuild)…"
  TMP_ASSETS="$(mktemp -d)"
  trap 'rm -rf "$TMP_ASSETS"' EXIT
  # Reuse the tested bytes: download the APK attached to the beta prerelease.
  if gh release download "$BETA_TAG" -D "$TMP_ASSETS" --pattern "*.apk" 2>/dev/null; then
    APK=$(find "$TMP_ASSETS" -name "*.apk" | head -1)
  else
    APK=""
  fi
  NOTES_FILE="$(mktemp -t promote-notes).md"
  # Carry the beta's own notes forward if present, else a minimal note.
  gh release view "$BETA_TAG" --json body -q .body > "$NOTES_FILE" 2>/dev/null || echo "Off Grid ${TARGET_VERSION}" > "$NOTES_FILE"
  if gh release view "v${TARGET_VERSION}" >/dev/null 2>&1; then
    warn "GitHub release v${TARGET_VERSION} already exists — skipping (idempotent re-run)."
  elif [ -n "$APK" ]; then
    gh release create "v${TARGET_VERSION}" "$APK" --title "Off Grid ${TARGET_VERSION}" --notes-file "$NOTES_FILE" --latest
    info "Cut GitHub release v${TARGET_VERSION} with the tested APK."
  else
    warn "No APK found on ${BETA_TAG} — creating the release without a binary (attach manually or run the iOS AltStore workflow)."
    gh release create "v${TARGET_VERSION}" --title "Off Grid ${TARGET_VERSION}" --notes-file "$NOTES_FILE" --latest
  fi
  rm -f "$NOTES_FILE"
fi

echo ""
info "${BOLD}Promotion staged for ${TARGET_VERSION}.${NC} Remaining MANUAL gates:"
[ "$DO_ANDROID" = 1 ] && echo "  • Play Console  → Production → confirm rollout %"
[ "$DO_IOS" = 1 ]     && echo "  • App Store Connect → Submit for Review"
