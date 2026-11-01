# Dock Folders

GNOME's app folders in [Dash to Dock](https://github.com/micheleg/dash-to-dock).

- **A folder in the dock**: a rounded square showing its first four apps.
  Click it and its apps open in a pop-up grid, each with its name; click one
  to open it, or bring its window forward. Right-click one for its own app
  menu, as on the dock (its windows, New Window, its actions, Pin to Dock,
  App Details, Quit), over the pop-up: Esc or a click elsewhere goes back
  to the folder. New Window is left out for apps that only ever have one
  window (Signal, Discord, Slack, and any app for which it opened nothing).
- **Dash to Dock's own running indicators**: on the folder while one of its
  apps is open, and on each open app in the pop-up, in whatever style Dash
  to Dock is set to (dots, dashes, segments...), changing with it.
- **Unread badges**: red counts at the icon's top right, as on the dock's
  other icons: on each app in the pop-up, and their total on the folder.
  They're Dash to Dock's own counts: the app's launcher count (Signal,
  Slack, Discord and others set one) plus its unread GNOME notifications.
- **Fewer dock icons**: an app in a dock folder gets no dock icon of its own
  while it runs. The folder stands for it.
- **Drop apps in, drag them out**: drag an app icon from the dock (or Show
  Apps) onto the folder; it lights up, and on release the app goes in:
  added to the app folder (and out of any other), unpinned from the dock.
  Drag an app out of the pop-up and let go anywhere but the folder: it
  leaves the folder (and isn't pinned), so it's back to a plain app.
- **Move it**: drag the folder along the dock; the icons make room as it
  goes, as for an app, and it stays where you let go (Esc puts it back).
  Or right-click it: Move Left,
  Move Right, Remove from Dock, Dock Folders Settings.
- **Any folder**: the settings window (Extensions app, or right-click a dock
  folder) has a switch per app folder.

Dash to Dock can't hold folders itself, and the extension that pinned
folders to GNOME's dash supports GNOME 43 only.

## Requirements

Works on:

- **OS**: Debian 13 (trixie)
- **GNOME Shell**: 48 (tested on 48.7), X11 session
- **Dash to Dock**: version 100 (Debian's `gnome-shell-extension-dashtodock`)

## Install

```sh
make install
```

Then log in again (on X11, Alt+F2, `r`, Enter is enough) and turn it on in
the Extensions app, or `gnome-extensions enable dock-folders@psouranis.github.io`.

## Use

1. Make a folder: open Show Apps, drop one app on another, drag more apps
   in, click the folder to rename it.
2. Put it in the dock: right-click a dock folder → Dock Folders Settings, or
   the Extensions app → Dock Folders → settings, and switch it on.
3. Drag it to where you want it.

A folder's name and apps are always the app folder's own, read live: change
the folder in Show Apps and the dock follows.
