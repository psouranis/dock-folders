// Dock Folders: GNOME's own app-grid folders in Dash to Dock.
//
//   - The dock icon is a rounded square of the folder's first four apps, with
//     a red badge adding up the unread counts of all its apps, and Dash to
//     Dock's own running indicator while one of them is open (whatever style
//     it's set to: the folder counts as running with all their windows).
//   - Clicking it opens a pop-up grid of the folder's apps, each with its own
//     badge and Dash to Dock's running indicator; right-clicking one gives
//     its own app menu, as on the dock, over the pop-up (without New Window
//     for apps that only ever have one).
//   - An app in a dock folder gets no dock icon of its own while it runs:
//     the folder stands for it.
//   - Drop an app icon on it (from the dock or Show Apps) to put the app in
//     the folder; drag an app out of its pop-up to take it out (and unpin
//     it).
//   - Drag the folder along the dock to move it (a gap opens where it will
//     go, as for an app), or right-click it: Rename, Move
//     Left / Move Right, Remove from Dock, Settings (which folders are in
//     the dock: prefs.js).
//   - Right-click an app in the dock: Add to Folder puts it in one of the
//     dock's folders, or New Folder… makes one with it, where it was.
//
// Each folder's name and apps are the app-grid folder's own
// (org.gnome.desktop.app-folders), read live: make a folder in Show Apps by
// dropping one app on another, and anything moved in or out of it shows here
// too. Which folders are in the dock, and where: config.js.
//
// Everything comes from Dash to Dock's exported dockManager ("so it can be
// accessed by other extensions"):
//   - the folder icons sit in the dock's own row of icons (its _box). That row
//     is Dash to Dock's to redraw, so its insert_child_at_index is wrapped to
//     count only its own icons, and the folders are put back in place after
//     every change; its Super+number shortcuts (_activateApp) skip the
//     folders, as its number overlays do;
//   - the counts are the ones Dash to Dock puts on its own icons: the app's
//     launcher count (Signal, Slack, Discord set one) plus its unread GNOME
//     notifications (dockManager.remoteModel, .notificationsMonitor);
//   - each dock's _appSystem is wrapped so get_running() leaves the folder
//     apps out;
//   - the running indicator is Dash to Dock's own AppIconIndicator, drawn on
//     a folder icon built like GNOME's app icons (FolderIcon below).
//   - its app icons' popupMenu is wrapped to add Add to Folder to their menu;
//   - an app dragged along a dock with folders is placed by this
//     (handleDragOver, acceptDrop), so it can go between apps and folders.
// disable() undoes all of it.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as IconGrid from 'resource:///org/gnome/shell/ui/iconGrid.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import {
    KNOWN_SINGLE_WINDOW_APPS, configFile, folderName, folderSettings, readConfig,
    readSingleWindowApps, writeConfig,
} from './config.js';
import {folderEntries, moveInRow, newFolderId, placeFolders, rawIndex} from './order.js';

const DASH_TO_DOCK = 'dash-to-dock@micxgx.gmail.com';
const POPUP_ICON_SIZE = 56;
const POPUP_COLUMNS = 4;

// Out of the dock's pinned apps: a folder stands for it now.
function unpin(app) {
    const favorites = AppFavorites.getAppFavorites();
    if (favorites.isFavorite(app.id))
        favorites.removeFavorite(app.id);
}

function folderApps(settings) {
    const system = Shell.AppSystem.get_default();
    return settings.get_strv('apps')
        .map(id => system.lookup_app(id))
        .filter(app => app !== null);
}

// A red count on the top right corner of an icon, as Dash to Dock's.
function makeBadge() {
    return new St.Label({style_class: 'notification-badge dock-folder-badge', visible: false});
}

// An icon of `size` px with `badge` on its top right corner. Placed by
// coordinates (a fixed layout): a layout manager's alignment stretched the
// badge over the whole icon.
function iconWithBadge(icon, badge, size) {
    const stack = new St.Widget({width: size, height: size});
    for (const actor of [icon, badge]) {
        actor.get_parent()?.remove_child(actor);
        stack.add_child(actor);
    }
    const place = () => {
        const [, width] = badge.get_preferred_width(-1);
        // Over the corner, a little past the edge, as Dash to Dock's.
        badge.set_position(Math.round(size - width * 0.75), -Math.round(size * 0.08));
    };
    // Disconnected when this stack goes (a new icon size makes a new one).
    badge.connectObject('notify::text', place, 'style-changed', place, stack);
    place();
    return stack;
}

// Dash to Dock's own formula (appIconIndicators.js,
// _updateNotificationBadgeStyle): the badge's font follows the icon size.
function badgeStyle(iconSize, defaultIconSize) {
    const font = St.ThemeContext.get_for_stage(global.stage).get_font();
    let fontSize = font.get_size() / 1024 * 0.9;
    if (!font.get_size_is_absolute())
        fontSize /= 0.75;
    const multiplier = iconSize < defaultIconSize
        ? Math.max(24, Math.min(iconSize * 1.3, defaultIconSize)) / defaultIconSize
        : iconSize / defaultIconSize;
    return `font-size: ${Math.round(multiplier * fontSize)}px; ` +
        `margin-left: ${Math.round(multiplier * 3)}px;`;
}

function setBadge(label, count) {
    label.text = count > 99 ? '99+' : `${count}`;
    label.visible = count > 0;
}

// While one of our own drags runs (a folder moved along the dock, an app
// dragged out of a folder), a transparent full-screen target takes the drop,
// so the drag ends where it's let go instead of flying back. GNOME's drag
// and drop then finishes it as any accepted drop. onDrop() returns whether
// the drop is taken.
function makeDropCatcher(onDrop) {
    const catcher = new St.Widget({
        reactive: true,
        x: 0,
        y: 0,
        width: global.stage.width,
        height: global.stage.height,
    });
    catcher._delegate = {
        handleDragOver: () => DND.DragMotionResult.MOVE_DROP,
        acceptDrop: () => onDrop(),
    };
    Main.uiGroup.add_child(catcher);
    return catcher;
}

// The padding `from` gets from the theme, scaled, as `to`'s own: the pop-up's
// tiles take the dock icons', so Dash to Dock's indicators (drawn along the
// bottom of the icon's area) have the same room below the picture there as
// in the dock, instead of landing on it.
function copyPadding(from, to, scale) {
    try {
        const node = from.get_theme_node();
        const sides = [St.Side.TOP, St.Side.RIGHT, St.Side.BOTTOM, St.Side.LEFT]
            .map(side => `${Math.round(node.get_padding(side) * scale)}px`);
        to.set_style(`padding: ${sides.join(' ')};`);
    } catch {
        // Not on the stage yet: the theme's own padding stays.
    }
}

function pointerOver(actor) {
    const [x, y] = global.get_pointer();
    const [ax, ay] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return x >= ax && x < ax + w && y >= ay && y < ay + h;
}

// The app being dragged: any app icon (the dock's, Show Apps'), not a folder.
function appFromDragSource(source) {
    const app = source?.app;
    return app instanceof Shell.App && !(source instanceof FolderIcon) ? app : null;
}

// Dash to Dock's own running indicator for `source` (a FolderIcon), in the
// style it's set to. Its unread badge is left out: the folder has its own.
// Asks for a folder's name in a GNOME Shell dialog, `text` filled in;
// `done(name)` with the name typed (trimmed, not empty) when confirmed.
function askName(title, text, confirm, done) {
    const dialog = new ModalDialog.ModalDialog({styleClass: 'dock-folders-name-dialog'});
    const content = new Dialog.MessageDialogContent({title});
    const entry = new St.Entry({text, can_focus: true, x_expand: true});
    content.add_child(entry);
    dialog.contentLayout.add_child(content);
    const ok = () => {
        const name = entry.get_text().trim();
        if (!name)
            return;
        dialog.close();
        done(name);
    };
    entry.clutter_text.connect('activate', ok);
    dialog.setButtons([
        {label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape},
        {label: confirm, action: ok, default: true},
    ]);
    dialog.setInitialKeyFocus(entry);
    dialog.open();
    entry.clutter_text.set_selection(0, text.length);
}

function makeIndicator(indicators, source) {
    if (!indicators || !source.app)
        return null;
    try {
        const indicator = new indicators.AppIconIndicator(source);
        const parts = indicator._indicators ?? [];
        const isBadge = i => i instanceof indicators.UnityIndicator;
        parts.filter(isBadge).forEach(i => i.destroy());
        indicator._indicators = parts.filter(i => !isBadge(i));
        return indicator;
    } catch (e) {
        console.warn(`Dock Folders: running indicator: ${e.message}`);
        return null;
    }
}

// The folder's dock button, built as GNOME's own dock icons are (an
// overview-tile button, an icon container holding a BaseIcon and the running
// dot), so it has their exact size, padding and indicator area, with
// the properties Dash to Dock's running indicators read from an app icon:
// running, focused and windows-count. So Dash to Dock's AppIconIndicator draws
// the same indicator on it as on its app icons, in whatever style it is set
// to. `app` is one of the folder's apps (the one open, if any), for the
// "dominant colour" option. The pop-up's app tiles are FolderIcons too, each
// for its one app, so they get the same indicators.
const FolderIcon = GObject.registerClass({
    Properties: {
        'focused': GObject.ParamSpec.boolean('focused', 'focused', 'focused',
            GObject.ParamFlags.READWRITE, false),
        'running': GObject.ParamSpec.boolean('running', 'running', 'running',
            GObject.ParamFlags.READWRITE, false),
        'windows-count': GObject.ParamSpec.uint('windows-count', 'windows-count',
            'windows-count', GObject.ParamFlags.READWRITE, 0, GLib.MAXUINT32, 0),
    },
}, class FolderIcon extends St.Button {
    // createIcon(size) draws the picture; sized with baseIcon.setIconSize().
    _init(createIcon, styleClass = 'dock-folder-button') {
        super._init({
            style_class: `overview-tile ${styleClass}`,
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE,
        });
        this.app = null;
        this._iconContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this.set_child(this._iconContainer);
        // GNOME's DashIcon: a BaseIcon, without its label, sized by hand.
        // Not called `icon`: Dash to Dock takes anything in its row with an
        // `icon` for one of its app icons (getAppIcons), calls app-icon
        // methods on it and may destroy it.
        this.baseIcon = new IconGrid.BaseIcon('', {
            createIcon,
            setSizeManually: true,
            showLabel: false,
        });
        this._iconContainer.add_child(this.baseIcon);
        this._dot = new St.Widget({
            style_class: 'app-grid-running-dot',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
        });
        this._iconContainer.add_child(this._dot);
        this._dot.hide();
    }
});

// One folder in one dock.
class DockFolder {
    constructor(ext, dash, id) {
        this._ext = ext;
        this._dash = dash;
        this.id = id;
        this._settings = folderSettings(id);

        this._button = new FolderIcon(size => this._createIcon(size));
        this.item = new Dash.DashItemContainer();
        this.item.setChild(this._button);
        // A dash item starts at scale 0, invisible, until it is shown.
        this.item.show(false);
        dash._hookUpLabel(this.item);

        const side = dash._position ?? St.Side.BOTTOM;
        this._menu = this._makeMenu(side, 'dock-folder-menu');
        this._actions = this._makeMenu(side, 'dock-folder-actions');
        this._fillActions();
        this._side = side;

        this._button.connect('clicked', () => {
            if (!this._menu.isOpen)
                this._fillMenu();
            this._menu.toggle();
        });
        this._menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this._closeAppMenu();
        });
        this._button.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            this._menu.close();
            this._actions.toggle();
            return Clutter.EVENT_STOP;
        });

        // Drag it along the dock to move it: it moves among the icons as the
        // pointer goes (as an app does), stays where it's let go, and goes
        // back with Esc.
        this._button._delegate = this;
        this._draggable = DND.makeDraggable(this._button);
        this._draggable.connect('drag-begin', () => {
            this._menu.close();
            this._actions.close();
            this.item.opacity = 80;
            this._ext.beginFolderDrag(this);
            this._catcher = makeDropCatcher(() => {
                this._ext.endFolderDrag(this, true);
                return true;
            });
        });
        this._draggable.connect('drag-end', () => {
            this._catcher?.destroy();
            this._catcher = null;
            this.item.opacity = 255;
            this._ext.endFolderDrag(this, false);   // no-op after a drop
        });

        this._sizeId = dash.connect('icon-size-changed', () => this.update());
        this.update();
    }

    _makeMenu(side, styleClass) {
        const menu = new PopupMenu.PopupMenu(this._button, 0.5, side);
        menu.actor.add_style_class_name(styleClass);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        const manager = new PopupMenu.PopupMenuManager(this._button);
        manager.addMenu(menu);
        // Keeps the dock shown while a menu is open (intellihide).
        menu.connect('open-state-changed', (_menu, open) => {
            this._dash._itemMenuStateChanged?.(this.item, open);
            if (open)
                this._button.add_style_pseudo_class('checked');
            else
                this._button.remove_style_pseudo_class('checked');
        });
        return menu;
    }

    _fillActions() {
        this._actions.addAction(_('Rename…'), () => this._ext.renameFolder(this.id));
        this._actions.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._actions.addAction(_('Move Left'), () => this._ext.nudgeFolder(this.id, this.item, -1));
        this._actions.addAction(_('Move Right'), () => this._ext.nudgeFolder(this.id, this.item, 1));
        this._actions.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._actions.addAction(_('Remove from Dock'), () => this._ext.removeFolder(this.id));
        this._actions.addAction(_('Dock Folders Settings…'), () => this._ext.openPreferences());
    }

    // Dash to Dock's own running indicators (the folder's and the pop-up
    // tiles'), made again when its settings change, as it does for its icons.
    resetIndicator() {
        this._indicator?.destroy();
        this._indicator = makeIndicator(this._ext.indicators, this._button);
        this._cells?.forEach(cell => {
            cell.indicator?.destroy();
            cell.indicator = makeIndicator(this._ext.indicators, cell.tile);
        });
    }

    // --- Dropping an app on the folder ------------------------------------
    // GNOME's drag and drop asks the folder (its button's _delegate) before
    // Dash to Dock's row: an app icon dragged here, from the dock or Show
    // Apps, goes into the folder.

    handleDragOver(source) {
        const app = appFromDragSource(source);
        if (!app || this._settings.get_strv('apps').includes(app.id))
            return DND.DragMotionResult.CONTINUE;
        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source) {
        const app = appFromDragSource(source);
        this.setDropHover(false);
        if (!app || this._settings.get_strv('apps').includes(app.id))
            return false;
        this._ext.addToFolder(this.id, app);
        return true;
    }

    // Lit while an app is dragged over it.
    setDropHover(hover) {
        if (this._gone)
            return;
        if (hover)
            this._button.add_style_pseudo_class('drop');
        else
            this._button.remove_style_pseudo_class('drop');
    }

    contains(actor) {
        return !this._gone && !!actor && this._button.contains(actor);
    }

    // For DND: what follows the pointer.
    getDragActor() {
        const size = this._dash.iconSize;
        return new Clutter.Clone({source: this._button.baseIcon.icon, width: size, height: size});
    }

    getDragActorSource() {
        return this._button.baseIcon;
    }

    // The folder square at `size`, its badge on its corner: BaseIcon's
    // picture, made again whenever the size or the apps change.
    _createIcon(size) {
        const pad = Math.max(2, Math.round(size * 0.1));
        const mini = Math.max(4, Math.floor((size - 3 * pad) / 2));
        const square = new St.BoxLayout({
            style_class: 'dock-folder-icon',
            orientation: Clutter.Orientation.VERTICAL,
            style: `border-radius: ${Math.round(size * 0.24)}px; ` +
                `padding: ${pad}px; spacing: ${pad}px;`,
            width: size,
            height: size,
        });
        const apps = folderApps(this._settings).slice(0, 4);
        for (let row = 0; row < 2; row++) {
            const line = new St.BoxLayout({style: `spacing: ${pad}px;`});
            for (const app of apps.slice(row * 2, row * 2 + 2)) {
                const icon = app.create_icon_texture(mini);
                icon.set_size(mini, mini);
                line.add_child(icon);
            }
            square.add_child(line);
        }
        this._badge = makeBadge();
        this._badge.set_style(badgeStyle(size, this._ext.defaultIconSize));
        const stack = iconWithBadge(square, this._badge, size);
        this.updateState();
        return stack;
    }

    // The dock icon: as big as the dock's own (Dash to Dock's icon size).
    update() {
        if (this._gone)
            return;
        if (this._button.baseIcon.iconSize === this._dash.iconSize)
            this._button.baseIcon.update();
        else
            this._button.baseIcon.setIconSize(this._dash.iconSize);
        const apps = folderApps(this._settings);
        this.item.setLabelText(folderName(this._settings));
        this.item.visible = apps.length > 0;
        this.updateState();
    }

    // Counts and open apps.
    updateState() {
        if (!this._button || this._gone)
            return;          // the BaseIcon draws its first picture early
        const apps = folderApps(this._settings);
        if (this._badge)
            setBadge(this._badge, apps.reduce((sum, app) => sum + this._ext.count(app), 0));
        const running = apps.filter(app => app.state === Shell.AppState.RUNNING);
        const focusApp = Shell.WindowTracker.get_default().focus_app;
        this._button.running = running.length > 0;
        this._button.focused = apps.includes(focusApp);
        this._button.windowsCount = running.reduce((n, app) => n + app.get_n_windows(), 0);
        const app = running[0] ?? apps[0] ?? null;
        if (app !== this._button.app) {
            // The "dominant colour" option reads it when the indicator is made.
            this._button.app = app;
            this.resetIndicator();
        }
        // The pop-up's tiles, also while it's being built (before it opens).
        this._cells?.forEach(({app, tile}) => {
            if (tile.badge)
                setBadge(tile.badge, this._ext.count(app));
            tile.running = app.state === Shell.AppState.RUNNING;
            tile.focused = app === focusApp;
            tile.windowsCount = app.get_n_windows();
        });
    }

    // The pop-up: the folder's name, then its apps, POPUP_COLUMNS a row. Each
    // app is a tile like the dock's icons (a FolderIcon for that one app):
    // its badge, and Dash to Dock's running indicator in its chosen style.
    _fillMenu() {
        this._clearCells();
        this._menu.removeAll();
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'dock-folder-popup',
        });
        box.add_child(new St.Label({
            text: folderName(this._settings),
            style_class: 'dock-folder-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        const grid = new St.Widget({
            layout_manager: new Clutter.GridLayout({
                row_homogeneous: true,
                column_homogeneous: true,
            }),
        });
        folderApps(this._settings).forEach((app, i) => {
            const tile = new FolderIcon(size => {
                const icon = app.create_icon_texture(size);
                icon.set_size(size, size);
                tile.badge = makeBadge();
                tile.badge.set_style(badgeStyle(size, this._ext.defaultIconSize));
                setBadge(tile.badge, this._ext.count(app));
                return iconWithBadge(icon, tile.badge, size);
            }, 'dock-folder-app');
            tile.app = app;
            tile.x_align = Clutter.ActorAlign.CENTER;
            tile.baseIcon.setIconSize(POPUP_ICON_SIZE);
            const scale = POPUP_ICON_SIZE / Math.max(1, this._dash.iconSize);
            copyPadding(this._button, tile, scale);
            copyPadding(this._button.baseIcon, tile.baseIcon, scale);
            tile.connect('clicked', () => {
                this._menu.close();
                app.activate();
            });
            tile.connect('button-press-event', (_actor, event) => {
                if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                    return Clutter.EVENT_PROPAGATE;
                this._openAppMenu(app, tile);
                return Clutter.EVENT_STOP;
            });
            tile.connect('popup-menu', () => this._openAppMenu(app, tile));   // Menu key
            this._makeTileDraggable(tile, app);
            const cell = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'dock-folder-cell',
            });
            cell.add_child(tile);
            cell.add_child(new St.Label({
                text: app.get_name(),
                style_class: 'dock-folder-app-name',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            this._cells.push({app, tile, indicator: null});
            grid.layout_manager.attach(cell, i % POPUP_COLUMNS,
                Math.floor(i / POPUP_COLUMNS), 1, 1);
        });
        box.add_child(grid);
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(box);
        this._menu.addMenuItem(item);
        this.updateState();
        this._cells.forEach(cell => {
            cell.indicator = makeIndicator(this._ext.indicators, cell.tile);
        });
    }

    // An app's own menu, from a right-click on it in the pop-up: GNOME's
    // AppMenu, as the dock's app icons have (windows, New Window, the app's
    // actions, Pin to Dock, App Details, Quit), on the app's tile. The pop-up
    // stays open under it: the menu has its own manager and grab, stacked on
    // the pop-up's, so a click outside it or Esc closes just the menu. Picking
    // something in it closes both. New Window is left out for apps that only
    // ever have one window, and an app for which it opened nothing is
    // remembered as one.
    _openAppMenu(app, tile) {
        this._closeAppMenu();
        const menu = new AppMenu(tile, this._side, {
            favoritesSection: true,
            showSingleWindows: true,
        });
        // No New Window for an app that only ever has one (see config.js).
        const ext = this._ext;
        const updateNewWindowItem = menu._updateNewWindowItem;
        menu._updateNewWindowItem = function () {
            updateNewWindowItem.call(this);
            if (ext.isSingleWindow(this._app))
                this._newWindowItem.visible = false;
        };
        menu.setApp(app);
        menu.actor.add_style_class_name('dock-folder-app-menu');
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        const manager = new PopupMenu.PopupMenuManager(tile);
        manager.addMenu(menu);
        menu.connect('activate', (_menu, item) => {
            if (item === menu._newWindowItem)
                ext.watchNewWindow(app);
            this._menu.close();
        });
        menu.connect('open-state-changed', (_menu, open) => {
            if (!open && this._appMenu === menu)
                this._closeAppMenu();
        });
        this._appMenu = menu;
        menu.open(BoxPointer.PopupAnimation.FULL);
    }

    _closeAppMenu() {
        const menu = this._appMenu;
        this._appMenu = null;
        if (!menu)
            return;
        // Destroyed once it has finished closing.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                menu.destroy();
            } catch {
                // Already gone.
            }
            return GLib.SOURCE_REMOVE;
        });
        if (menu.isOpen)
            menu.close(BoxPointer.PopupAnimation.NONE);
    }

    // Dragging an app out of the pop-up takes it out of the folder (and
    // unpins it), dropped anywhere but back on the folder. The pop-up closes
    // as the drag starts, so the dock and desktop show.
    _makeTileDraggable(tile, app) {
        tile._delegate = {
            getDragActor: () => {
                const icon = app.create_icon_texture(POPUP_ICON_SIZE);
                icon.set_size(POPUP_ICON_SIZE, POPUP_ICON_SIZE);
                return icon;
            },
            getDragActorSource: () => tile.baseIcon,
        };
        const draggable = DND.makeDraggable(tile);
        let catcher = null;
        draggable.connect('drag-begin', () => {
            this._closeAppMenu();
            this._menu.close();
            catcher = makeDropCatcher(() => {
                if (this._gone || pointerOver(this._button))
                    return false;           // back on its folder: nothing
                this._ext.removeFromFolder(this.id, app);
                return true;
            });
        });
        draggable.connect('drag-end', () => {
            catcher?.destroy();
            catcher = null;
        });
    }

    _clearCells() {
        this._cells?.forEach(cell => cell.indicator?.destroy());
        this._cells = [];
    }

    // Tolerates parts GNOME has destroyed already (a dock torn down by Dash
    // to Dock goes with everything in it).
    destroy() {
        const quietly = fn => {
            try {
                fn();
            } catch {
                // Already gone.
            }
        };
        this._gone = true;
        quietly(() => this._clearCells());
        quietly(() => this._indicator?.destroy());
        this._indicator = null;
        quietly(() => this._dash.disconnect(this._sizeId));
        quietly(() => this._menu.destroy());
        quietly(() => this._actions.destroy());
        quietly(() => this._closeAppMenu());
        quietly(() => this.item.destroy());
    }
}

export default class DockFoldersExtension extends Extension {
    enable() {
        this._config = [];
        this._docks = new Map();     // dash -> {folders, restore}
        this._watched = [];          // [settings, signal id] per folder
        this._entries = [];          // disconnect functions (counts, windows)
        this._hidden = new Set();    // desktop ids kept out of the dock
        this._placeholders = new Set();   // the gaps shown while a folder is dragged
        this._singleWindow = new Set(readSingleWindowApps());
        this._timeouts = new Set();
        this._dragMonitor = {dragMotion: event => this._dragMotion(event)};
        DND.addDragMonitor(this._dragMonitor);
        this._dragEndIds = ['item-drag-end', 'item-drag-cancelled'].map(signal =>
            Main.overview.connect(signal, () => this._dragEnded()));
        this._appStateId = Shell.AppSystem.get_default().connect('app-state-changed',
            () => this._stateChanged());
        this._focusId = Shell.WindowTracker.get_default().connect('notify::focus-app',
            () => this._stateChanged());
        // The config changes from the preferences window, or by hand.
        this._configMonitor = configFile().monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._configMonitor.connect('changed', () => {
            this._singleWindow = new Set(readSingleWindowApps());
            if (JSON.stringify(readConfig()) !== JSON.stringify(this._config))
                this._rebuild();
        });
        // Dash to Dock may start after this; wait for it.
        this._stateId = Main.extensionManager.connect('extension-state-changed',
            (_m, ext) => {
                if (ext.uuid === DASH_TO_DOCK)
                    this._hookDashToDock();
            });
        this._hookDashToDock();
    }

    async _hookDashToDock() {
        const dtd = Main.extensionManager.lookup(DASH_TO_DOCK);
        if (!dtd || dtd.state !== ExtensionState.ACTIVE) {
            this._unhook();
            return;
        }
        // The same module instances GNOME Shell loaded Dash to Dock from.
        const module = await import(dtd.dir.get_child('extension.js').get_uri());
        const indicators = await import(dtd.dir.get_child('appIconIndicators.js').get_uri());
        if (!this._docks || !module.dockManager || module.dockManager === this._manager)
            return;
        if (!module.dockManager.settings)
            return;   // Dash to Dock half-loaded: its next state change hooks again
        this._unhook();
        this._manager = module.dockManager;
        this.indicators = indicators;
        // Dash to Dock makes its icons' indicators again when these change;
        // so do the folders (appIcons.js).
        const settings = this._manager.settings;
        this._settingsIds = [
            'apply-custom-theme',
            'running-indicator-style',
            'show-icons-emblems',
            'show-icons-notifications-counter',
            'application-counter-overrides-notifications',
        ].map(key => settings.connect(`changed::${key}`, () => this._resetIndicators()));
        this._monitorStateId = this._manager.notificationsMonitor?.connect('state-changed',
            () => this._resetIndicators());
        this._managerIds = ['docks-ready', 'toggled'].map(signal =>
            this._manager.connect(signal, () => this._rebuild()));
        // Also fires when Dash to Dock creates or drops its launcher model.
        this._monitorId = this._manager.notificationsMonitor?.connect('changed',
            () => this._watchCounts());
        this._rebuild();
    }

    _unhook() {
        this._clear();
        if (this._manager) {
            this._managerIds.forEach(id => this._manager.disconnect(id));
            this._settingsIds?.forEach(id => this._manager.settings?.disconnect(id));
            if (this._monitorId)
                this._manager.notificationsMonitor?.disconnect(this._monitorId);
            if (this._monitorStateId)
                this._manager.notificationsMonitor?.disconnect(this._monitorStateId);
        }
        this._manager = null;
        this.indicators = null;
        this._settingsIds = [];
        this._monitorId = 0;
        this._monitorStateId = 0;
    }

    get defaultIconSize() {
        try {
            return this._manager.settings.get_default_value('dash-max-icon-size').unpack();
        } catch {
            return 48;
        }
    }

    // An app's unread count, worked out as Dash to Dock does for its icons.
    // No badges at all with its "show icons emblems" off, or in Do Not
    // Disturb (appIconIndicators.js, AppIconIndicator).
    count(app) {
        const manager = this._manager;
        if (!manager?.settings?.showIconsEmblems || manager.notificationsMonitor?.dndMode)
            return 0;
        const entry = manager.remoteModel?.lookupById(app.id);
        const launcher = entry?.['count-visible'] ? entry.count ?? 0 : 0;
        if (launcher > 0 && manager.settings?.applicationCounterOverridesNotifications)
            return launcher;
        return launcher + (manager.notificationsMonitor?.getAppNotificationsCount(app.id) ?? 0);
    }

    // --- Dropping apps into folders --------------------------------------------

    // As GNOME files an app dragged onto a folder in Show Apps: into this
    // folder's apps, out of any other folder. Unpinned from the dock too, as
    // the folder stands for it now (and it has no dock icon of its own).
    addToFolder(id, app) {
        const children = new Gio.Settings({schema_id: 'org.gnome.desktop.app-folders'})
            .get_strv('folder-children');
        for (const other of children) {
            if (other !== id)
                this._removeApp(other, app);
        }
        const settings = folderSettings(id);
        settings.set_strv('apps', [...settings.get_strv('apps'), app.id]);
        unpin(app);
    }

    // An app dragged out of a folder: out of the folder, and unpinned.
    removeFromFolder(id, app) {
        this._removeApp(id, app);
        unpin(app);
    }

    // Takes `app` out of folder `id`. With no app left, the folder is
    // deleted as Show Apps deletes it (appDisplay.js, removeApp), and leaves
    // the dock's config; its hidden icon goes at the next rebuild.
    _removeApp(id, app) {
        const settings = folderSettings(id);
        const apps = settings.get_strv('apps');
        if (!apps.includes(app.id))
            return;
        if (apps.length > 1) {
            settings.set_strv('apps', apps.filter(a => a !== app.id));
            return;
        }
        for (const key of settings.settings_schema.list_keys())
            settings.reset(key);
        const folders = new Gio.Settings({schema_id: 'org.gnome.desktop.app-folders'});
        folders.set_strv('folder-children',
            folders.get_strv('folder-children').filter(f => f !== id));
        if (this._entry(id)) {
            this._config = this._config.filter(f => f.id !== id);
            this._save();
        }
    }

    // --- Moving a folder by dragging it -------------------------------------
    // Its place follows the pointer while it's dragged (the dock's icons
    // move aside, as for an app); dropped, it's saved; cancelled, put back.

    // While a folder is dragged along the dock, a gap opens where it would
    // go, as GNOME's dash does for an app (dash.js, handleDragOver: the
    // same placeholder, the slot worked out without it, none right before or
    // after the folder itself). Let go there, it moves there; Esc, or let go
    // off the dock, and nothing changes.
    beginFolderDrag(folder) {
        this._folderDrag = {folder, placeholder: null, dash: null, slot: -1, index: null};
    }

    endFolderDrag(folder, dropped) {
        const drag = this._folderDrag;
        if (!drag || drag.folder !== folder)
            return;
        this._folderDrag = null;
        const {dash, index} = drag;
        const move = dropped && drag.placeholder && index !== null;
        this._clearPlaceholder(drag, !move);
        if (move && this._moveTo(dash, folder.id, index))
            this._save();
    }

    _previewFolderDrag() {
        const drag = this._folderDrag;
        const {folder} = drag;
        const dash = [...this._docks.keys()].find(d => d._box.contains(folder.item));
        if (!dash || !pointerOver(dash._box)) {
            this._clearPlaceholder(drag, true);
            return;
        }
        const children = dash._box.get_children().filter(a => !this._placeholders.has(a));
        const slot = this._slotAt(dash, children,
            drag.dash === dash ? drag.placeholder : null, drag.slot, folder.item);
        const self = children.indexOf(folder.item);
        if (slot === self || slot === self + 1) {
            this._clearPlaceholder(drag, true);   // where it is already
            return;
        }
        if (drag.placeholder && drag.dash === dash && drag.slot === slot)
            return;
        const fresh = !drag.placeholder;
        this._clearPlaceholder(drag, false);
        const placeholder = this._makePlaceholder(dash, children, slot, fresh);
        Object.assign(drag, {placeholder, dash, slot, index: slot > self ? slot - 1 : slot});
    }

    // A gap like GNOME's dash's (DragPlaceholderItem), sized as Dash to Dock
    // sizes it (half an icon along the dock), put before icon `slot` of
    // `children`: counted without any gap still closing (they are in the
    // dock's row until they're gone).
    _makePlaceholder(dash, children, slot, animate) {
        const placeholder = new Dash.DashItemContainer();
        placeholder.setChild(new St.Bin({style_class: 'placeholder'}));
        const size = dash.iconSize ?? this.defaultIconSize;
        if (dash._isHorizontal ?? true)
            placeholder.child.set_size(size, size / 2);
        else
            placeholder.child.set_size(size / 2, size);
        this._placeholders.add(placeholder);
        placeholder.connect('destroy', () => this._placeholders?.delete(placeholder));
        const anchor = children[slot];
        const raw = anchor ? dash._box.get_children().indexOf(anchor) : dash._box.get_n_children();
        Clutter.Actor.prototype.insert_child_at_index.call(dash._box, placeholder, raw);
        placeholder.show(animate);
        return placeholder;
    }

    _clearPlaceholder(drag, animate) {
        const {placeholder} = drag;
        Object.assign(drag, {placeholder: null, slot: -1, index: null});
        if (!placeholder)
            return;
        if (animate)
            placeholder.animateOutAndDestroy();
        else
            placeholder.destroy();
    }

    // Which gap of the dock's row (`children`, without the placeholder) the
    // pointer is in: after every icon whose middle it's past. Measured as if
    // there were no placeholder (the icons after it are pushed along by its
    // size), so that showing it can't change the answer and make it jump.
    _slotAt(dash, children, placeholder, placeholderSlot, skip) {
        const [px, py] = global.get_pointer();
        const horizontal = dash._isHorizontal ?? true;
        const along = actor => {
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return horizontal ? [x, w] : [y, h];
        };
        let shift = 0;
        const ph = placeholder;
        if (ph) {
            const next = children[placeholderSlot];
            if (next)
                shift = along(next)[0] - along(ph)[0];
        }
        const pointer = horizontal ? px : py;
        let slot = 0;
        children.forEach((actor, i) => {
            if (!actor.visible || actor === skip)
                return;
            const [start, size] = along(actor);
            const middle = start - (ph && i >= placeholderSlot ? shift : 0) + size / 2;
            if (pointer > middle)
                slot = i + 1;
        });
        return slot;
    }

    // Lights the folder under a dragged app, and no other; moves a dragged
    // folder.
    _dragMotion(event) {
        if (this._folderDrag) {
            this._previewFolderDrag();
            return DND.DragMotionResult.CONTINUE;
        }
        const app = appFromDragSource(event.source);
        this._docks?.forEach(dock => dock.folders.forEach(folder => {
            folder.setDropHover(!!app && folder.contains(event.targetActor) &&
                folder.handleDragOver(event.source) !== DND.DragMotionResult.CONTINUE);
        }));
        return DND.DragMotionResult.CONTINUE;
    }

    _dragEnded() {
        this._docks?.forEach(dock => dock.folders.forEach(folder => folder.setDropHover(false)));
    }

    // --- Single-window apps -------------------------------------------------

    isSingleWindow(app) {
        return !!app && (KNOWN_SINGLE_WINDOW_APPS.includes(app.id) ||
            this._singleWindow.has(app.id));
    }

    // New Window was picked for a running app: if no new window of it has
    // appeared a few seconds later, it's one that hands a second launch over
    // to the running one. Remember it, so its menu leaves New Window out.
    // (New windows, not the count: one closed meanwhile would hide a new one.)
    watchNewWindow(app) {
        const before = new Set(app.get_windows());
        if (before.size === 0)
            return;
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._timeouts.delete(id);
            const opened = app.get_windows().some(w => !before.has(w));
            if (this._docks && !opened && !this.isSingleWindow(app)) {
                this._singleWindow.add(app.id);
                try {
                    writeConfig(this._config, [...this._singleWindow]);
                } catch (e) {
                    console.warn(`Dock Folders: saving ${configFile().get_path()}: ${e.message}`);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    // --- Where the folders sit -------------------------------------------

    // The folder items of a dock, and the dock's own icons (everything else
    // in its row).
    _split(dash) {
        const folders = new Set(this._docks.get(dash)?.folders.map(f => f.item) ?? []);
        const others = dash._box.get_children()
            .filter(a => !folders.has(a) && !this._placeholders?.has(a));
        return [folders, others];
    }

    // Puts each folder back after `position` of the dock's own icons.
    _place(dash) {
        const dock = this._docks.get(dash);
        if (!dock)
            return;
        const [folders, others] = this._split(dash);
        // In the config's order: it decides which of two folders in the same
        // gap comes first (placeFolders keeps the order it's given for ties).
        const rank = id => {
            const i = this._config.findIndex(f => f.id === id);
            return i < 0 ? Infinity : i;
        };
        const order = placeFolders(others, [...dock.folders]
            .sort((a, b) => rank(a.id) - rank(b.id))
            .map(folder => ({
                item: folder.item,
                pos: this._entry(folder.id)?.position ?? Infinity,
            })));
        order.forEach((actor, index) => {
            if (folders.has(actor) &&
                dash._box.get_child_at_index(index) !== actor)
                Clutter.Actor.prototype.set_child_at_index.call(dash._box, actor, index);
        });
    }

    // How many of the dock's own icons are before `item` now.
    _indexOf(dash, item) {
        const [folders] = this._split(dash);
        let index = 0;
        for (const actor of dash._box.get_children()) {
            if (actor === item)
                break;
            if (!folders.has(actor))
                index++;
        }
        return index;
    }

    // The dock's row as order.js sees it: each folder, and every other icon.
    _row(dash) {
        const byItem = new Map(this._docks.get(dash)?.folders.map(f => [f.item, f.id]) ?? []);
        return dash._box.get_children()
            .filter(a => !this._placeholders?.has(a))
            .map(a => (byItem.has(a) ? {folder: byItem.get(a)} : {}));
    }

    // Puts folder `id` at `index` of this dock's row (without it): every
    // folder's position, and the order of folders sharing a gap, follow.
    // Not saved: the caller saves (a drag only when it's dropped).
    // An app dragged over a dock with folders: a gap where it would go, as
    // GNOME's dash shows it (none right before or after its own icon, none
    // past the pinned apps and folders), placed as for a dragged folder.
    _appDragOver(dash, app) {
        const box = dash._box;
        if (dash._dragPlaceholder && !this._placeholders.has(dash._dragPlaceholder))
            dash._clearDragPlaceholder();   // one of GNOME's, from before a folder came
        const current = dash._dragPlaceholder;
        const children = box.get_children().filter(a => !this._placeholders.has(a));
        const [folders] = this._split(dash);
        const favorites = AppFavorites.getAppFavorites().getFavoriteMap();
        const id = app.get_id();
        const own = children.findIndex(a => a.child?.app?.get_id?.() === id);
        let limit = 0;
        children.forEach((a, i) => {
            const childId = a.child?.app?.get_id?.();
            if (folders.has(a) || (childId && childId in favorites))
                limit = i + 1;
        });
        const slot = Math.min(limit,
            this._slotAt(dash, children, current, current ? dash._dockFoldersSlot : -1, null));
        if (own !== -1 && (slot === own || slot === own + 1)) {
            if (current)
                dash._clearDragPlaceholder();
            dash._dockFoldersSlot = -1;
            return DND.DragMotionResult.CONTINUE;
        }
        if (current && dash._dockFoldersSlot === slot)
            return DND.DragMotionResult.MOVE_DROP;
        current?.destroy();
        const placeholder = this._makePlaceholder(dash, children, slot, !current);
        dash._dragPlaceholder = placeholder;
        dash._dragPlaceholderPos = box.get_children().indexOf(placeholder);
        dash._dockFoldersSlot = slot;
        return DND.DragMotionResult.MOVE_DROP;
    }

    // The app dropped in the gap: among the pinned apps after the pinned
    // apps before the gap (as GNOME's acceptDrop does it, later, before the
    // next redraw), and every folder where the gap's row has it, so an app
    // moved past a folder stays past it.
    _appDrop(dash, app, placeholder) {
        if (app.is_window_backed() || !global.settings.is_writable('favorite-apps'))
            return false;
        const id = app.get_id();
        const appFavorites = AppFavorites.getAppFavorites();
        const favorites = appFavorites.getFavoriteMap();
        const byItem = new Map(this._docks.get(dash)?.folders.map(f => [f.item, f.id]) ?? []);
        const row = [];
        let favPos = 0;
        let before = true;
        for (const actor of dash._box.get_children()) {
            if (actor === placeholder) {
                row.push({});   // the app, where it goes
                before = false;
            } else if (this._placeholders.has(actor)) {
                continue;
            } else if (byItem.has(actor)) {
                row.push({folder: byItem.get(actor)});
            } else {
                const childId = actor.child?.app?.get_id?.();
                if (childId === id)
                    continue;   // its icon now: it moves
                row.push({});
                if (before && childId && childId in favorites)
                    favPos++;
            }
        }
        const entries = folderEntries(row);
        const placed = new Set(entries.map(e => e.id));
        this._config = [...entries, ...this._config.filter(e => !placed.has(e.id))];
        this._save();
        console.log(`Dock Folders: drop ${id} at pinned ${favPos}; folders ${JSON.stringify(this._config)}`);
        global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            if (id in favorites)
                appFavorites.moveFavoriteToPos(id, favPos);
            else
                appFavorites.addFavoriteAtPos(id, favPos);
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    // What the dock's row holds, for the log: app ids, [folder ids].
    _describeRow(dash) {
        const byItem = new Map(this._docks.get(dash)?.folders.map(f => [f.item, f.id]) ?? []);
        return dash._box.get_children().filter(a => !this._placeholders?.has(a)).map(a => byItem.has(a) ? `[${byItem.get(a)}]`
            : `${(a.child?.app?.get_id() ?? a.constructor?.name ?? '?').replace(/\.desktop$/, '')}${a.visible ? '' : '(hidden)'}`).join(' ');
    }

    _moveTo(dash, id, index) {
        console.log(`Dock Folders: move ${id} to ${index}; row: ${this._describeRow(dash)}`);
        const entries = folderEntries(moveInRow(this._row(dash), id, index));
        const placed = new Set(entries.map(e => e.id));
        const config = [...entries, ...this._config.filter(e => !placed.has(e.id))];
        if (JSON.stringify(config) === JSON.stringify(this._config))
            return false;
        this._config = config;
        this._docks.forEach((_dock, d) => this._place(d));
        console.log(`Dock Folders: now ${JSON.stringify(config)}; row: ${this._describeRow(dash)}`);
        return true;
    }

    _entry(id) {
        return this._config.find(f => f.id === id);
    }

    _save() {
        try {
            writeConfig(this._config);
        } catch (e) {
            console.warn(`Dock Folders: saving ${configFile().get_path()}: ${e.message}`);
        }
    }

    // Move Left / Move Right: past the next icon that way, app or folder.
    nudgeFolder(id, item, step) {
        const dash = [...this._docks.keys()].find(d => d._box.contains(item));
        if (!dash || !this._entry(id))
            return;
        const children = dash._box.get_children();
        let i = children.indexOf(item);
        do
            i += step;
        while (i >= 0 && i < children.length && !children[i].visible);
        if (i < 0 || i >= children.length)
            return;   // already first or last
        // In the row without it, the neighbour's index is `i` either way
        // (to its right it shifts down one): there it goes before (left) or
        // just after (right) it.
        if (this._moveTo(dash, id, i))
            this._save();
    }

    removeFolder(id) {
        this._config = this._config.filter(f => f.id !== id);
        this._save();
        this._rebuild();
    }

    renameFolder(id) {
        const settings = folderSettings(id);
        askName(_('Rename Folder'), folderName(settings), _('Rename'), name => {
            settings.set_boolean('translate', false);
            settings.set_string('name', name);
        });
    }

    // --- Folders from an app's menu in the dock -----------------------------
    // Dash to Dock builds an app icon's menu each time it opens
    // (appIcons.js, popupMenu -> DockAppIconMenu._rebuildMenu), so its
    // icons' popupMenu is wrapped to add "Add to Folder" after it, while
    // this is on: each dock folder, and New Folder….

    _patchAppMenus() {
        if (!this._docks)
            return;
        this._menuPatches ??= new Map();   // icon class prototype -> undo
        const ext = this;
        const icons = [...this._docks.keys()]
            .flatMap(dash => dash._box.get_children())
            .map(actor => actor.child)
            .filter(child => child?.app && typeof child.popupMenu === 'function');
        for (const icon of icons) {
            const proto = Object.getPrototypeOf(icon);
            if (this._menuPatches.has(proto))
                continue;
            const own = Object.prototype.hasOwnProperty.call(proto, 'popupMenu');
            const original = proto.popupMenu;
            proto.popupMenu = function (...args) {
                const result = original.apply(this, args);
                try {
                    ext._addFolderItems(this);
                } catch (e) {
                    console.warn(`Dock Folders: ${e.message}`);
                }
                return result;
            };
            this._menuPatches.set(proto, () => {
                if (own)
                    proto.popupMenu = original;
                else
                    delete proto.popupMenu;
            });
            console.log(`Dock Folders: Add to Folder in the menus of ${proto.constructor?.name ?? 'dock icons'}`);
        }
    }

    _unpatchAppMenus() {
        this._menuPatches?.forEach(undo => undo());
        this._menuPatches = new Map();
    }

    _addFolderItems(icon) {
        const {app, _menu: menu} = icon;
        if (!menu || !app || !this._docks)
            return;
        const sub = new PopupMenu.PopupSubMenuMenuItem(_('Add to Folder'));
        for (const {id} of this._config)
            sub.menu.addAction(folderName(folderSettings(id)), () => this.addToFolder(id, app));
        if (this._config.length > 0)
            sub.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        sub.menu.addAction(_('New Folder…'), () => this.newFolder(app, icon));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(sub);
    }

    // A new app-grid folder with `app` in it (out of any other), in the dock
    // where the app's icon was; the app unpinned, as the folder stands for
    // it now. Its name is asked for first.
    newFolder(app, icon) {
        const dash = [...this._docks.keys()].find(d => d._box.contains(icon));
        const position = dash ? this._indexOf(dash, icon.get_parent()) : null;
        askName(_('New Folder'), _('New Folder'), _('Create'), name => {
            if (!this._docks)
                return;
            const folders = new Gio.Settings({schema_id: 'org.gnome.desktop.app-folders'});
            for (const other of folders.get_strv('folder-children'))
                this._removeApp(other, app);
            const id = newFolderId(name, folders.get_strv('folder-children'));
            const settings = folderSettings(id);
            settings.set_string('name', name);
            settings.set_boolean('translate', false);
            settings.set_strv('apps', [app.id]);
            folders.set_strv('folder-children', [...folders.get_strv('folder-children'), id]);
            this._config.push({id, position});
            this._save();
            unpin(app);
            this._rebuild();
        });
    }

    // --- Building ----------------------------------------------------------

    _clear() {
        this._unpatchAppMenus();
        // Unwrap first: removing the folder icons must not re-place them.
        this._docks?.forEach(dock => {
            dock.restore();
            dock.folders.forEach(f => f.destroy());
        });
        this._docks = new Map();
        this._watched?.forEach(([settings, id]) => settings.disconnect(id));
        this._watched = [];
        this._unwatchCounts();
        this._hidden = new Set();
    }

    _rebuild() {
        this._clear();
        if (!this._manager)
            return;
        this._config = readConfig();
        for (const {id} of this._config) {
            const settings = folderSettings(id);
            this._watched.push([settings, settings.connect('changed', () => this._folderChanged())]);
        }
        for (const dock of this._manager._allDocks ?? []) {
            const dash = dock.dash;
            if (!dash?._box || !dash._appSystem)
                continue;
            const folders = this._config.map(({id}) => new DockFolder(this, dash, id));
            this._docks.set(dash, {folders, restore: this._wrapDash(dock, dash)});
            folders.forEach(f => dash._box.add_child(f.item));
            this._place(dash);
        }
        this._patchAppMenus();
        this._folderChanged();
    }

    // Takes over what this dock needs; returns what puts it back.
    _wrapDash(dock, dash) {
        const box = dash._box;
        const ext = this;

        // Dash to Dock places its icons by index among its own: skip ours,
        // then put ours back. Not the drag placeholder (pinning by drag):
        // GNOME counts the whole row for it, folders too, and its acceptDrop
        // reads that index back so (dash.js, handleDragOver).
        box.insert_child_at_index = (child, index) => {
            const [folders] = this._split(dash);
            const raw = child === dash._dragPlaceholder
                ? index : rawIndex(box.get_children(), a => folders.has(a), index);
            Clutter.Actor.prototype.insert_child_at_index.call(box, child, raw);
            this._place(dash);
        };

        // Super+number: the Nth of the dock's own app icons, as its number
        // overlays count them (getAppIcons leaves the folders out).
        dock._activateApp = appIndex => {
            const [folders] = this._split(dash);
            const icons = box.get_children()
                .filter(actor => !folders.has(actor) && actor.child?.app)
                .map(actor => actor.child);
            icons[appIndex]?.activate(1);
        };
        const removedId = box.connect('child-removed', () => {
            if (!this._detached)
                this._place(dash);
        });
        // Right after a Shell start the docks are ready before their icons
        // are drawn: the app menus are wrapped when the first one comes.
        const addedId = box.connect('child-added', () => this._patchAppMenus());

        // Dragging an app along the dock (pinning it, or moving it among the
        // pinned apps) with folders in it: GNOME's dash works out the gap
        // from every icon in the row, folders too, but against the pinned
        // apps alone, and a folder's place ("after N icons") wouldn't follow
        // an app moved past it. So with folders here, the gap is placed as
        // for a dragged folder, and the drop moves the app among the pinned
        // apps and every folder to where the gap had it (_appDragOver,
        // _appDrop). Without folders, GNOME's and Dash to Dock's own code.
        const handleDragOver = dash.handleDragOver;
        dash.handleDragOver = (source, actor, x, y, time) => {
            const app = appFromDragSource(source);
            if (!app || app.is_window_backed() || this._split(dash)[0].size === 0)
                return handleDragOver.call(dash, source, actor, x, y, time);
            return this._appDragOver(dash, app);
        };

        // Pinning an app by dropping it on the dock: GNOME's acceptDrop reads
        // an app from every icon before the drop point, and a folder has
        // none. The folders are out of the row while it runs.
        const acceptDrop = dash.acceptDrop;
        dash.acceptDrop = (...args) => {
            const app = appFromDragSource(args[0]);
            const placeholder = dash._dragPlaceholder;
            if (app && placeholder && this._placeholders.has(placeholder))
                return this._appDrop(dash, app, placeholder);
            const [folders] = this._split(dash);
            this._detached = true;
            folders.forEach(item => box.remove_child(item));
            try {
                return acceptDrop.call(dash, ...args);
            } finally {
                folders.forEach(item => box.add_child(item));
                this._detached = false;
                this._place(dash);
            }
        };

        // The folder apps get no dock icon of their own.
        const real = dash._appSystem;
        dash._appSystem = new Proxy(real, {
            get(target, prop) {
                if (prop === 'get_running') {
                    return () => target.get_running()
                        .filter(app => !ext._hidden.has(app.get_id()));
                }
                const value = target[prop];
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });

        return () => {
            delete box.insert_child_at_index;
            delete dock._activateApp;
            delete dash.acceptDrop;
            delete dash.handleDragOver;
            box.disconnect(removedId);
            box.disconnect(addedId);
            dash._appSystem = real;
            try {
                dash._queueRedisplay();
            } catch {
                // A dock Dash to Dock has already destroyed (docks-ready).
            }
        };
    }

    // A folder's name or apps changed: redraw, re-hide, re-count.
    _folderChanged() {
        this._patchAppMenus();   // in case the dock had no app icon to patch yet
        this._docks.forEach(dock => dock.folders.forEach(f => f.update()));
        this._hidden = new Set(this._watched.flatMap(([settings]) => settings.get_strv('apps')));
        this._docks.forEach((_dock, dash) => dash._queueRedisplay());
        this._watchCounts();
    }

    // Follow the launcher counts and the windows of every app in a folder.
    _watchCounts() {
        this._unwatchCounts();
        const model = this._manager?.remoteModel;
        const system = Shell.AppSystem.get_default();
        for (const id of this._hidden) {
            if (model) {
                const entry = model.lookupById(id);
                const handler = entry.connect(['count-changed', 'count-visible-changed'],
                    () => this._stateChanged());
                this._entries.push(() => entry.disconnect(handler));
            }
            const app = system.lookup_app(id);
            if (app) {
                const handler = app.connect('windows-changed', () => this._stateChanged());
                this._entries.push(() => app.disconnect(handler));
            }
        }
        this._stateChanged();
    }

    _unwatchCounts() {
        this._entries?.forEach(disconnect => disconnect());
        this._entries = [];
    }

    // Also re-counts: the badges follow the same settings.
    _resetIndicators() {
        this._docks?.forEach(dock => dock.folders.forEach(f => f.resetIndicator()));
        this._stateChanged();
    }

    _stateChanged() {
        this._docks?.forEach(dock => dock.folders.forEach(f => f.updateState()));
    }

    disable() {
        Main.extensionManager.disconnect(this._stateId);
        Shell.AppSystem.get_default().disconnect(this._appStateId);
        Shell.WindowTracker.get_default().disconnect(this._focusId);
        this._configMonitor.cancel();
        this._timeouts.forEach(id => GLib.source_remove(id));
        this._timeouts = null;
        DND.removeDragMonitor(this._dragMonitor);
        this._dragEndIds.forEach(id => Main.overview.disconnect(id));
        this._unhook();
        this._docks = null;
        this._watched = null;
        this._entries = null;
        this._configMonitor = null;
    }
}
