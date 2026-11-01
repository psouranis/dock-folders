// Dock Folders' settings: which app-grid folders are in the dock. Opened from
// the Extensions app, or from a dock folder's right-click menu. A switch per
// app-grid folder; what it changes is config.js's file, which the extension
// follows at once.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {folderName, folderSettings, readConfig, writeConfig} from './config.js';

export default class DockFoldersPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage({icon_name: 'folder-symbolic'});
        window.add(page);

        const help = new Adw.PreferencesGroup({
            description: _('To make a folder, open Show Apps and drop one app on ' +
                'another; drag more apps in, and click the folder to rename it. ' +
                'In the dock, drag a folder to move it, or right-click it.'),
        });
        page.add(help);

        const group = new Adw.PreferencesGroup({title: _('Folders in the Dock')});
        page.add(group);

        const folders = new Gio.Settings({schema_id: 'org.gnome.desktop.app-folders'});
        const ids = folders.get_strv('folder-children');
        let shown = 0;
        for (const id of ids) {
            const settings = folderSettings(id);
            const apps = settings.get_strv('apps');
            if (apps.length === 0)
                continue;          // a folder by category only (YaST...): no apps of its own
            shown++;
            const row = new Adw.SwitchRow({
                title: folderName(settings) || id,
                subtitle: apps.length === 1 ? _('1 app') : `${apps.length} ${_('apps')}`,
                active: readConfig().some(f => f.id === id),
            });
            row.connect('notify::active', () => {
                const config = readConfig().filter(f => f.id !== id);
                if (row.active)
                    config.push({id, position: null});
                writeConfig(config);
            });
            group.add(row);
        }
        if (shown === 0) {
            group.add(new Adw.ActionRow({
                title: _('No app folders yet'),
                subtitle: _('Make one in Show Apps first.'),
            }));
        }
    }
}
