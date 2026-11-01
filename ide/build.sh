#!/usr/bin/env bash
# Builds a portable Windows Towelwise AI zip from upstream Code-OSS, VSCodium-style.
# Run from Git Bash: "C:\Program Files\Git\bin\bash.exe" ide/build.sh
# The VSCodium checkout and build output live outside the repo (TW_BUILD_DIR) to keep paths short.
# Timings are appended to $TW_BUILD_DIR/build-times.log.

set -eo pipefail

IDE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( dirname "${IDE_DIR}" )"
TW_BUILD_DIR="${TW_BUILD_DIR:-/c/tw-build}"
VSCODIUM_DIR="${TW_BUILD_DIR}/vscodium"

# shellcheck disable=SC1091
. "${IDE_DIR}/upstream.env"

for tool in git node npm jq python 7z cargo; do
  command -v "${tool}" >/dev/null || { echo "Missing tool: ${tool}" >&2; exit 1; }
done

log_time() { echo "$( date -Is ) $1" | tee -a "${TW_BUILD_DIR}/build-times.log"; }

mkdir -p "${TW_BUILD_DIR}"
log_time "start: VSCodium ${VSCODIUM_TAG}"

# 1. The extension, built and packed, to ship as a built-in extension.
EXT_STAGE="${TW_BUILD_DIR}/extension"
rm -rf "${EXT_STAGE}" && mkdir -p "${EXT_STAGE}"
( cd "${REPO_DIR}" && npm ci && npm run build && npm run package )
7z x -y -o"${EXT_STAGE}" "${REPO_DIR}/packages/towelwise/towelwise.vsix" >/dev/null
[[ -f "${EXT_STAGE}/extension/package.json" ]] || { echo "Packed extension has no package.json" >&2; exit 1; }
log_time "extension packed"

# 2. VSCodium at the pinned tag, clean.
if [[ ! -d "${VSCODIUM_DIR}/.git" ]]; then
  git clone --quiet --depth 1 --branch "${VSCODIUM_TAG}" https://github.com/VSCodium/vscodium.git "${VSCODIUM_DIR}"
fi
cd "${VSCODIUM_DIR}"
git fetch --quiet --depth 1 origin tag "${VSCODIUM_TAG}"
git reset --quiet --hard
git clean --quiet -fdx
git checkout --quiet "${VSCODIUM_TAG}"

# 3. Identity: VSCodium merges its root product.json over the generated one.
jq -s '.[0] * .[1]' product.json "${IDE_DIR}/product.overlay.json" > product.json.tmp
mv product.json.tmp product.json

# Our own app icon and Windows tiles replace VSCodium's (a file overlay, not a patch).
cp "${IDE_DIR}"/icons/win32/* src/stable/resources/win32/
# The small logo at the left of the title bar.
cp "${IDE_DIR}/icons/code-icon.svg" src/stable/src/vs/workbench/browser/media/code-icon.svg

# 4. Same settings as VSCodium's dev/build.sh, with our naming.
export APP_NAME="Towelwise AI"
export ASSETS_REPOSITORY="towelwise/towelwise"
export BINARY_NAME="towelwise-ai"
export GLOBAL_DIRNAME="towelwise-ai"
export CI_BUILD="no"
export GH_REPO_PATH="towelwise/towelwise"
export ORG_NAME="Towelwise"
export SHOULD_BUILD="yes"
export SKIP_ASSETS="yes"
export SKIP_BUILD="no"
export SKIP_SOURCE="no"
export VSCODE_LATEST="no"
export VSCODE_QUALITY="stable"
export VSCODE_SKIP_NODE_VERSION_CHECK="yes"
export OS_NAME="windows"
export VSCODE_ARCH="x64"
export NODE_OPTIONS="--max-old-space-size=8192"

rm -rf vscode* VSCode*
# shellcheck disable=SC1091
. get_repo.sh
# shellcheck disable=SC1091
. version.sh
log_time "source fetched: ${MS_TAG} ${MS_COMMIT}"

# 5. The built-in extension goes in before the build, not as a patch.
mkdir -p vscode/extensions/towelwise
cp -r "${EXT_STAGE}/extension/." vscode/extensions/towelwise/

# shellcheck disable=SC1091
. build.sh
log_time "app built"

# 6. Portable zip.
DIST="${TW_BUILD_DIR}/dist"
mkdir -p "${DIST}"
ZIP="${DIST}/TowelwiseAI-win32-x64-${RELEASE_VERSION}.zip"
rm -f "${ZIP}"
( cd "${VSCODIUM_DIR}/VSCode-win32-x64" && 7z a -tzip -mx=5 "$( cygpath -w "${ZIP}" )" . >/dev/null )
log_time "zipped: ${ZIP} ($( du -h "${ZIP}" | cut -f1 ))"
