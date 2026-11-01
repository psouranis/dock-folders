// Dock Folders' own config, shared by the extension and its preferences
// window: which app-grid folders are in the dock, and where.
//
//   ~/.config/dock-folders/folders.json
//   {
//     "folders": [{"id": "Chats", "position": 9}, {"id": "Work"}],
//     "singleWindowApps": ["org.signal.Signal.desktop"]
//   }
//
// "id" is the app-grid folder's id (its dconf path under
// /org/gnome/desktop/app-folders/folders/). "position" is how many of the
// dock's other icons come before the folder; without it, the folder goes
// after them all. A plain "Chats" string is read as {"id": "Chats"}.
//
// "singleWindowApps": apps whose right-click menu in a folder leaves out New
// Window, because they only ever have one window (a second launch hands over
// to the running one). The ones below are known; the extension adds any app
// for which New Window opened nothing.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const KNOWN_SINGLE_WINDOW_APPS = [
    'org.signal.Signal.desktop',
    'signal-desktop.desktop',
    'discord.desktop',
    'com.discordapp.Discord.desktop',
    'com.slack.Slack.desktop',
    'slack.desktop',
];

export function folderSettings(id) {
    return new Gio.Settings({
        schema_id: 'org.gnome.desktop.app-folders.folder',
        path: `/org/gnome/desktop/app-folders/folders/${id}/`,
    });
}

// An app-grid folder's name, as GNOME Shell shows it: a translated one
// ("Utilities") is named by its .directory file, in the user's language
// (shell_util_get_translated_folder_name). Here so the preferences window,
// which can't load Shell, shows the same name as the dock.
export function folderName(settings) {
    const name = settings.get_string('name');
    if (!settings.get_boolean('translate'))
        return name;
    try {
        const keyfile = new GLib.KeyFile();
        keyfile.load_from_data_dirs(`desktop-directories/${name}`, GLib.KeyFileFlags.NONE);
        return keyfile.get_locale_string('Desktop Entry', 'Name', null);
    } catch {
        return name;
    }
}

export const configFile = () => Gio.File.new_for_path(
    GLib.build_filenamev([GLib.get_user_config_dir(), 'dock-folders', 'folders.json']));

function readFile() {
    try {
        const [, bytes] = configFile().load_contents(null);
        const data = JSON.parse(new TextDecoder().decode(bytes));
        return data && typeof data === 'object' ? data : {};
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            console.warn(`Dock Folders: ${configFile().get_path()}: ${e.message}`);
        return {};
    }
}

export function readConfig() {
    const {folders} = readFile();
    if (!Array.isArray(folders))
        return [];
    return folders
        .map(f => (typeof f === 'string' ? {id: f} : f))
        .filter(f => f && typeof f.id === 'string' && f.id !== '')
        .map(f => ({id: f.id, position: Number.isInteger(f.position) ? f.position : null}));
}

// The apps learned so far (the known ones are added by the caller).
export function readSingleWindowApps() {
    const {singleWindowApps} = readFile();
    return Array.isArray(singleWindowApps)
        ? singleWindowApps.filter(id => typeof id === 'string')
        : [];
}

// Writes the folders and, when given, the learned single-window apps; what
// isn't given is kept as it is in the file.
export function writeConfig(folders, singleWindowApps) {
    const file = configFile();
    const dir = file.get_parent();
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
    const apps = singleWindowApps ?? readSingleWindowApps();
    const data = {
        folders: folders.map(f => (f.position === null ? {id: f.id} : {id: f.id, position: f.position})),
    };
    if (apps.length > 0)
        data.singleWindowApps = apps;
    file.replace_contents(new TextEncoder().encode(`${JSON.stringify(data, null, 4)}\n`),
        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
