#!/bin/sh
# Installs these Herdr mods into ~/.config/herdr-app and switches to the
# "my-main" layout that uses them:
#
#   curl -fsSL https://raw.githubusercontent.com/wbmartin/herdr-mods/main/install.sh | sh
#
# Run from a checkout (sh install.sh) it installs that checkout instead of
# downloading. Running it again updates. Rollback:
#   herdr-app do layout.switch '{"name":"main"}'
set -eu

repo=https://codeload.github.com/wbmartin/herdr-mods/tar.gz/refs/heads/main
export PATH="$HOME/.local/bin:$PATH"
say() { printf '%s\n' "$*"; }
fail() { say "herdr-mods: $*" >&2; exit 1; }

here=
case $0 in */install.sh | install.sh) here=$(cd "$(dirname "$0")" && pwd) ;; esac
if [ -n "$here" ] && [ -d "$here/mods" ]; then
  src=$here
  say "Installing from checkout $src"
else
  command -v curl >/dev/null 2>&1 || fail "needs curl"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  say "Downloading wbmartin/herdr-mods..."
  curl -fsSL "$repo" | tar -xz -C "$tmp"
  src=$(echo "$tmp"/herdr-mods-*)
  [ -d "$src/mods" ] || fail "download has no mods folder"
fi

mkdir -p ~/.config/herdr-app/mods
for dir in "$src"/mods/*/; do
  name=$(basename "$dir")
  mkdir -p ~/.config/herdr-app/mods/"$name"
  cp -R "$dir". ~/.config/herdr-app/mods/"$name"/
  say "  mod $name"
done

if ! command -v herdr-app >/dev/null 2>&1 || ! herdr-app status >/dev/null 2>&1; then
  say "Mods copied. Open Herdr and run this again to set up the my-main layout."
  exit 0
fi

for dir in "$src"/mods/*/; do
  herdr-app check "$dir" >/dev/null || fail "mod check failed: $dir"
done

# The layout is cloned from the installed Herdr's own "main" (it changes between
# versions), then its Files panel is pointed at my-files.
if [ ! -e ~/.config/herdr-app/layouts/my-main.json ]; then
  herdr-app do layout.clone '{"name":"main","as":"my-main"}' >/dev/null
fi
sed 's/"mod": "files"/"mod": "my-files"/' ~/.config/herdr-app/layouts/my-main.json > ~/.config/herdr-app/layouts/my-main.json.tmp
mv ~/.config/herdr-app/layouts/my-main.json.tmp ~/.config/herdr-app/layouts/my-main.json
grep -q '"mod": "my-files"' ~/.config/herdr-app/layouts/my-main.json || fail "could not point my-main at my-files"
# A window border, so the window's edge shows against dark desktops.
# Root keys are the 2-space-indented ones: drop any root "border", add ours before "titlebar".
window_border='"border": { "width": 2, "color": "accent" },'
awk -v b="  $window_border" '/^  "border": /{next} /^  "titlebar": /{print b} {print}' \
  ~/.config/herdr-app/layouts/my-main.json > ~/.config/herdr-app/layouts/my-main.json.tmp
mv ~/.config/herdr-app/layouts/my-main.json.tmp ~/.config/herdr-app/layouts/my-main.json
grep -qF "  $window_border" ~/.config/herdr-app/layouts/my-main.json || fail "could not add the window border"
herdr-app do layout.switch '{"name":"my-main"}' >/dev/null
say "Done: layout my-main. Right-click a file in the Files panel to copy its path."
