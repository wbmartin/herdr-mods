#!/bin/bash
# Time-tracker spike: checks the macOS probes the Herdr time-tracker mod would use
# (docs/time-tracker-spec.md section 5). One-off; safe to delete afterwards.
set -euo pipefail

cat <<'HEADER'
================================================================================
 Herdr time-tracker: macOS probe check
--------------------------------------------------------------------------------
 RUNS ON:  this Mac, locally. Run it INSIDE A HERDR TERMINAL, so macOS asks on
           Herdr's behalf, the same as the mod would.
 CHANGES:  nothing on disk except <this script>.log beside it. macOS may record
           permissions you grant to Herdr.
 PROMPTS, in order (each only if not already decided):
   1. "Herdr wants to control System Events"            -> Allow (Automation)
   2. If window titles fail: add Herdr in System Settings > Privacy & Security
      > Accessibility, then run this script again (no popup for this one)
   3. "Herdr wants to control Safari / Google Chrome / Microsoft Edge", one per
      browser that is running                            -> Allow (Automation)
   4. Optional at the end: ssh key passphrase for wbmartin@nuc2018, to send the
      log back for review
 DURING THE RUN: a 15 s window where you click into other apps (a browser,
           Outlook) so the frontmost-app probes see something other than Herdr.
 LOGGED:   app names, window titles and browser DOMAINS only (no paths/URLs).
 ROLLBACK: System Settings > Privacy & Security > Automation / Accessibility:
           untick Herdr. Or: tccutil reset AppleEvents
================================================================================
HEADER
cat -n "$0"
read -r -p "Enter runs it, Ctrl-C cancels: "

exec > >(tee -a "$0.log") 2>&1
echo "=== run $(date '+%Y-%m-%d %H:%M:%S %z')"

if [ "$(uname -s)" != Darwin ]; then echo "NOT MACOS"; exit 1; fi

ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time*1000'; }
results=()
note() { results+=("$1|$2|$3"); printf '  %-22s %-5s %s\n' "$1" "$2" "$3"; }

echo "--- environment"
sw_vers | sed 's/^/  /'
echo "  TERM_PROGRAM=${TERM_PROGRAM:-unset}"
echo "  parent chain:"
pid=$$
for _ in 1 2 3 4 5 6 7 8; do
  [ "$pid" -le 1 ] && break
  printf '    %s %s\n' "$pid" "$(ps -o comm= -p "$pid")"
  pid=$(ps -o ppid= -p "$pid" | tr -d ' ')
done

echo "--- 1. OS idle (ioreg, no permission)"
t0=$(ms)
if idle_ns=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF; exit}') && [ -n "$idle_ns" ]; then
  note idle PASS "$((idle_ns / 1000000000)) s idle, $(( $(ms) - t0 )) ms"
else
  note idle FAIL "no HIDIdleTime"
fi

front_lsappinfo() { lsappinfo info -only name "$(lsappinfo front)" | sed -E 's/.*"LSDisplayName"="?([^"]*)"?.*/\1/'; }
front_osa() { osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'; }
title_osa() { osascript -e 'tell application "System Events" to tell (first application process whose frontmost is true) to get name of front window'; }
domain() { sed -E 's#^[a-zA-Z]+://([^/:]+).*#\1#'; }

echo "--- 2. frontmost app + window title, sampled 3 times over 15 s"
echo "  >>> CLICK INTO OTHER APPS NOW (a browser, Outlook, Finder) <<<"
for i in 1 2 3; do
  sleep 5
  echo "  sample $i:"
  t0=$(ms)
  if a=$(front_lsappinfo 2>&1); then note "front(lsappinfo)#$i" PASS "$a, $(( $(ms) - t0 )) ms"; else note "front(lsappinfo)#$i" FAIL "$a"; fi
  t0=$(ms)
  if a=$(front_osa 2>&1); then note "front(osascript)#$i" PASS "$a, $(( $(ms) - t0 )) ms"; else note "front(osascript)#$i" FAIL "$a"; fi
  t0=$(ms)
  if w=$(title_osa 2>&1); then note "title#$i" PASS "$w, $(( $(ms) - t0 )) ms"; else note "title#$i" FAIL "$w"; fi
done

echo "--- 3. browser domain (Automation per browser; domain only)"
for b in Safari "Google Chrome" "Microsoft Edge" Firefox; do
  if ! pgrep -xq "$b"; then note "browser:$b" SKIP "not running"; continue; fi
  case $b in
    Safari) q='tell application "Safari" to get URL of front document' ;;
    Firefox) note "browser:$b" SKIP "no AppleScript URL support (expected)"; continue ;;
    *) q="tell application \"$b\" to get URL of active tab of front window" ;;
  esac
  t0=$(ms)
  if u=$(osascript -e "$q" 2>&1); then note "browser:$b" PASS "$(printf '%s' "$u" | domain), $(( $(ms) - t0 )) ms"
  else note "browser:$b" FAIL "$u"; fi
done

echo "--- 4. sleep/wake history (pmset, no permission; last 3)"
pmset -g log 2>/dev/null | grep -E ' (Sleep|Wake) +' | tail -3 | sed 's/^/  /' || echo "  none"

echo "=== SUMMARY"
for r in "${results[@]}"; do IFS='|' read -r n s d <<<"$r"; printf '  %-5s %s\n' "$s" "$n"; done
echo "=== done $(date '+%H:%M:%S')"

read -r -p "Send the log to wbmartin@nuc2018 for review? [y/N] " send
if [ "$send" = y ]; then
  scp "$0.log" wbmartin@nuc2018.deconsec.com:/tmp/claude-1000/-home-wbmartin-code-herdr/89439250-0187-439b-9e01-6995b046b967/scratchpad/mac-probes.log \
    || scp "$0.log" wbmartin@192.168.53.110:/tmp/claude-1000/-home-wbmartin-code-herdr/89439250-0187-439b-9e01-6995b046b967/scratchpad/mac-probes.log
  echo "sent"
fi
