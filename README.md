# herdr-mods

My personal mods for the [Herdr](https://github.com/herdrdev/herdr-app) desktop app.

## Install / update

With Herdr open:

```sh
curl -fsSL https://raw.githubusercontent.com/wbmartin/herdr-mods/main/install.sh | sh
```

This copies `mods/*` into `~/.config/herdr-app/mods/`, makes a `my-main` layout (a copy of the
installed Herdr's `main` layout with its Files panel pointed at `my-files`) and switches to it.
Running it again updates everything.

Rollback: `herdr-app do layout.switch '{"name":"main"}'`

## Mods

- **my-files**: Herdr's Files panel (a copy of `files` from v0.1.13). Right-click a file or folder for
  **Copy full path** / **Copy relative path**. The clipboard uses `pbcopy` on macOS and
  `wl-copy`, `xclip` or `xsel` on Linux.

## Editing

Edit in this checkout, then `sh install.sh` to install it locally. Commit and push so other machines
can pick it up. To pick up upstream fixes to `files`, clone it again with
`herdr-app do mod.clone '{"name":"files","as":"files-new"}'`, copy your changes onto it, and replace `mods/my-files`.
