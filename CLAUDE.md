# herdr-mods

Personal Herdr mods. Mod API docs: `~/.config/herdr-app/AGENTS.md` and `herdr.d.ts`.

- Branch strategy: one branch, `main`. Commit and push directly. No dev/uat.
- `install.sh` is piped to `sh` from raw.githubusercontent.com, so keep it POSIX sh and non-interactive.
- Check a mod before you commit: `herdr-app check mods/<name>`, then `sh install.sh`.
