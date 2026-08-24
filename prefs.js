import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { getExtensionCacheDir, fileBasedCache } from './cache.js';

const ACCENTS = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate', 'brown'];
const titleCase = s => s.charAt(0).toUpperCase() + s.slice(1);

export default class GnomeThemeTweaksPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Libadwaita provides built-in preference search; keep it enabled so
        // the growing number of settings remains easy to navigate.
        try {
            window.search_enabled = true;
        } catch (_) {
            try { window.set_search_enabled(true); } catch (_) {}
        }

        this._addOverviewPage(window, settings);
        this._addUserThemePage(window, settings);
        this._addGtkThemePage(window, settings);
        this._addIconThemePage(window, settings);
        this._addAccentPage(window, settings);
        this._addCursorPage(window, settings);

        return Promise.resolve();
    }

    _newPage(title, iconName, description) {
        const page = new Adw.PreferencesPage({
            title: _(title),
            icon_name: iconName,
            description: _(description),
        });
        return page;
    }

    _newGroup(page, title, description = '') {
        const group = new Adw.PreferencesGroup({
            title: _(title),
            description: description ? _(description) : undefined,
        });
        page.add(group);
        return group;
    }

    _addOverviewPage(window, settings) {
        const page = this._newPage(
            'Overview',
            'preferences-system-symbolic',
            'One place to coordinate themes, accent colors, icons, and cursors while keeping manual choices under your control.'
        );

        const intro = new Adw.StatusPage({
            icon_name: 'preferences-desktop-theme-symbolic',
            title: _('GNOME Theme Tweaks'),
            description: _('A unified appearance manager for Light and Dark mode, accent colors, icon themes, cursor themes, and GTK 4 styling.'),
        });
        intro.add_css_class('compact');

        const introGroup = this._newGroup(page, 'Appearance Manager',
            'Each section controls one part of your desktop appearance. Automatic features only act when you explicitly enable them.');
        const introRow = new Adw.ActionRow({
            title: _('Manual control comes first'),
            subtitle: _('Theme selections are persistent. Automatic accent and cursor switching can be enabled independently.'),
        });
        introRow.add_prefix(new Gtk.Image({icon_name: 'preferences-system-symbolic'}));
        introGroup.add(introRow);

        const light = settings.get_string('gtk-theme-light') || 'Adwaita';
        const dark = settings.get_string('gtk-theme-dark') || 'Adwaita-dark';
        const accentAuto = settings.get_boolean('auto-accent-enable');
        const cursorAuto = settings.get_boolean('cursor-follow-color-scheme');

        const statusGroup = this._newGroup(page, 'Current Configuration',
            'A quick summary of the choices that are currently configured.');
        this._addPropertyRow(statusGroup, 'GTK — Light', light, 'applications-graphics-symbolic');
        this._addPropertyRow(statusGroup, 'GTK — Dark', dark, 'applications-graphics-symbolic');
        this._addPropertyRow(statusGroup, 'Wallpaper Accent', accentAuto ? 'Automatic' : 'Manual', 'color-select-symbolic');
        this._addPropertyRow(statusGroup, 'Cursor Switching', cursorAuto ? 'Follow Light/Dark mode' : 'Manual', 'input-mouse-symbolic');

        const helpGroup = this._newGroup(page, 'How it works',
            'The extension reacts to GNOME’s Light/Dark setting and accent color without taking control away from you.');
        this._addInfoRow(helpGroup, 'Light & Dark themes',
            'Select independent GTK and GNOME Shell themes. The appropriate choice is applied when GNOME changes color scheme.',
            'weather-clear-symbolic');
        this._addInfoRow(helpGroup, 'Accent-based icons',
            'Optionally associate a different icon theme with each GNOME accent color. This is independent from wallpaper analysis.',
            'applications-graphics-symbolic');
        this._addInfoRow(helpGroup, 'Automatic Accent',
            'When enabled, wallpaper analysis chooses an accent when the wallpaper changes. Manual accent changes are not continuously overwritten.',
            'color-select-symbolic');
        this._addInfoRow(helpGroup, 'Cursor Themes',
            'Choose separate cursors for Light and Dark mode and optionally switch them automatically with GNOME.',
            'input-mouse-symbolic');

        // StatusPage is deliberately kept as a child of a non-visible box so
        // the page retains a polished introduction without changing the
        // standard PreferencesPage navigation model.
        intro.set_visible(false);
        window.add(page);
    }

    _addUserThemePage(window, settings) {
        const page = this._newPage(
            'User Themes',
            'applications-system-symbolic',
            'Control the GNOME Shell theme independently for Light and Dark mode.'
        );

        const group = this._newGroup(page, 'Shell Appearance',
            'These choices are applied through the GNOME User Themes extension when the system color scheme changes.');
        this._addModeCombo(group, settings, 'user-theme-light', 'Light mode',
            'GNOME Shell theme used whenever the system is set to prefer a light appearance.', 'Adwaita');
        this._addModeCombo(group, settings, 'user-theme-dark', 'Dark mode',
            'GNOME Shell theme used whenever the system is set to prefer a dark appearance.', 'Adwaita-dark');

        const info = this._infoCard(
            'Accent color stays independent',
            'GNOME’s current accent color is managed separately. Changing the Shell theme here will not reset your accent selection.',
            'preferences-system-symbolic'
        );
        page.add(info);
        window.add(page);
    }

    _addGtkThemePage(window, settings) {
        const page = this._newPage(
            'GTK Themes',
            'applications-graphics-symbolic',
            'Choose the visual style used by GTK applications in Light and Dark mode.'
        );

        const group = this._newGroup(page, 'Application Appearance',
            'Choose separate GTK themes for the two GNOME color schemes. The selected theme is applied automatically when the scheme changes.');
        this._addModeCombo(group, settings, 'gtk-theme-light', 'Light mode',
            'GTK theme used by applications in Light mode.', 'Adwaita');
        this._addModeCombo(group, settings, 'gtk-theme-dark', 'Dark mode',
            'GTK theme used by applications in Dark mode.', 'Adwaita-dark');

        const integration = this._newGroup(page, 'GTK 4 Integration',
            'Some third-party themes do not automatically reach GTK 4 applications. Optional file synchronization bridges that gap.');
        const link = new Adw.SwitchRow({
            title: _('Synchronize GTK 4 theme files'),
            subtitle: _('Copy gtk.css, gtk-dark.css and supported theme assets to ~/.config/gtk-4.0 whenever the selected GTK theme changes.'),
        });
        settings.bind('set-link-gtk4', link, 'active', Gio.SettingsBindFlags.DEFAULT);
        integration.add(link);

        const path = new Adw.EntryRow({
            title: _('Theme installation directory'),
            text: settings.get_string('set-theme-path'),
            tooltip_text: _('Directory containing installed GTK themes, normally /usr/share/themes.'),
        });
        path.connect('apply', () => {
            const value = path.text.trim() || '/usr/share/themes';
            settings.set_string('set-theme-path', value);
        });
        integration.add(path);

        this._addInfoRow(integration, 'Recommended location',
            'Use /usr/share/themes for system-wide themes or ~/.local/share/themes for themes installed only for your user account.',
            'folder-symbolic');
        window.add(page);
    }

    _addIconThemePage(window, settings) {
        const page = this._newPage(
            'Icon Themes',
            'preferences-system-symbolic',
            'Associate icon themes with GNOME’s accent colors. The selected theme is applied when accent-based switching is enabled.'
        );

        const behavior = this._newGroup(page, 'Accent Icon Switching',
            'This feature changes the desktop icon theme when the GNOME accent changes. It does not analyze your wallpaper and does not alter the accent itself.');
        const enabled = new Adw.SwitchRow({
            title: _('Use accent-based icon themes'),
            subtitle: _('Automatically apply the icon theme assigned to the current GNOME accent color.'),
        });
        settings.bind('change-app-colors', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        behavior.add(enabled);

        const note = new Adw.ActionRow({
            title: _('Manual accent changes are supported'),
            subtitle: _('Choose any GNOME accent manually. The matching icon theme will follow only when this option is enabled.'),
        });
        note.add_prefix(new Gtk.Image({icon_name: 'color-select-symbolic'}));
        behavior.add(note);

        const themes = this._getAvailableIconThemes();
        const assignments = this._newGroup(page, 'Accent Assignments',
            'Choose the icon theme that should accompany each GNOME accent. Missing themes fall back to Adwaita.');
        this._addComboRows(assignments, settings, themes, '-icon-theme');
        window.add(page);
    }

    _addAccentPage(window, settings) {
        const page = this._newPage(
            'Automatic Accent',
            'color-select-symbolic',
            'Optionally derive a GNOME accent from your wallpaper without continuously overriding manual choices.'
        );

        const behavior = this._newGroup(page, 'Automatic Accent',
            'Automatic Accent is event-driven: it reacts to wallpaper changes and explicit refreshes rather than constantly enforcing a color.');
        const enabled = new Adw.SwitchRow({
            title: _('Use wallpaper-based accent color'),
            subtitle: _('Analyze the current wallpaper and choose a suitable GNOME accent when the wallpaper changes.'),
        });
        settings.bind('auto-accent-enable', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        behavior.add(enabled);

        const manual = new Adw.ActionRow({
            title: _('Manual changes are respected'),
            subtitle: _('After Auto Accent chooses a color, you can change the GNOME accent yourself. It will stay in place until the wallpaper changes or you explicitly refresh the automatic choice.'),
        });
        manual.add_prefix(new Gtk.Image({icon_name: 'preferences-system-symbolic'}));
        behavior.add(manual);

        const selection = this._newGroup(page, 'Accent Selection',
            'Fine-tune how the wallpaper palette is interpreted when an automatic accent is calculated.');
        const highlight = new Adw.SwitchRow({
            title: _('Prefer a highlight color'),
            subtitle: _('Prefer a visually prominent or contrasting wallpaper color instead of simply choosing the dominant color.'),
        });
        settings.bind('auto-accent-highlight-mode', highlight, 'active', Gio.SettingsBindFlags.DEFAULT);
        selection.add(highlight);

        const indicator = new Adw.SwitchRow({
            title: _('Show panel indicator'),
            subtitle: _('Display a small accent indicator in the top panel and provide a convenient action for forcing a new wallpaper analysis.'),
        });
        settings.bind('auto-accent-show-indicator', indicator, 'active', Gio.SettingsBindFlags.DEFAULT);
        selection.add(indicator);

        const performance = this._newGroup(page, 'Performance & Diagnostics',
            'Wallpaper analysis can be cached. Diagnostic logging is useful when troubleshooting automatic accent selection.');
        const cache = new Adw.SwitchRow({
            title: _('Disable wallpaper palette cache'),
            subtitle: _('Always analyze the wallpaper from scratch instead of reusing a previously calculated palette. This may take longer for large images.'),
        });
        settings.bind('auto-accent-disable-cache', cache, 'active', Gio.SettingsBindFlags.DEFAULT);
        performance.add(cache);

        const debug = new Adw.SwitchRow({
            title: _('Enable debug logging'),
            subtitle: _('Write detailed Auto Accent diagnostics to the GNOME Shell journal. Leave this off during normal use.'),
        });
        settings.bind('auto-accent-debug-logging', debug, 'active', Gio.SettingsBindFlags.DEFAULT);
        performance.add(debug);

        const cacheGroup = this._newGroup(page, 'Wallpaper Palette Cache',
            'Cached palettes reduce repeated image processing when the same wallpaper is encountered again.');
        const row = new Adw.ActionRow({
            title: _('Cache directory'),
            subtitle: getExtensionCacheDir(),
        });
        const clear = new Gtk.Button({
            label: _('Clear cache'),
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Remove all cached wallpaper palettes.'),
            css_classes: ['destructive-action'],
        });
        clear.connect('clicked', async () => {
            try {
                await fileBasedCache(getExtensionCacheDir()).clear();
                clear.label = _('Cache cleared');
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1800, () => {
                    clear.label = _('Clear cache');
                    return GLib.SOURCE_REMOVE;
                });
            } catch (e) {
                console.warn(`[GNOME Theme Tweaks] Could not clear accent cache: ${e.message}`);
            }
        });
        row.add_suffix(clear);
        cacheGroup.add(row);

        window.add(page);
    }

    _addCursorPage(window, settings) {
        const page = this._newPage(
            'Cursor Themes',
            'input-mouse-symbolic',
            'Choose separate pointer themes for Light and Dark mode, with optional automatic switching.'
        );

        const behavior = this._newGroup(page, 'Automatic Switching',
            'When enabled, the cursor theme follows GNOME’s current color scheme. Disable it if you prefer a single cursor regardless of Light/Dark mode.');
        const follow = new Adw.SwitchRow({
            title: _('Follow Light/Dark mode'),
            subtitle: _('Automatically apply the selected Light or Dark cursor theme whenever GNOME changes color scheme.'),
        });
        settings.bind('cursor-follow-color-scheme', follow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behavior.add(follow);

        const choices = this._newGroup(page, 'Cursor Selection',
            'Select the pointer theme to use for each color scheme. Themes are discovered from standard system and user icon directories.');
        this._addCursorCombo(choices, settings, 'cursor-theme-light', 'Light mode',
            'Cursor theme used while GNOME prefers a light appearance.', 'Adwaita');
        this._addCursorCombo(choices, settings, 'cursor-theme-dark', 'Dark mode',
            'Cursor theme used while GNOME prefers a dark appearance.', 'Adwaita');

        this._addInfoRow(choices, 'Theme discovery',
            'Cursor themes are searched in /usr/share/icons, /usr/local/share/icons, ~/.local/share/icons and ~/.icons.',
            'folder-symbolic');
        window.add(page);
    }

    _addModeCombo(group, settings, key, title, subtitle, fallback) {
        const themes = this._getAvailableThemes();
        let selected = settings.get_string(key) || fallback;
        if (!themes.includes(selected))
            selected = themes.includes(fallback) ? fallback : (themes[0] || fallback);
        if (settings.get_string(key) !== selected)
            settings.set_string(key, selected);

        const row = new Adw.ComboRow({
            title: _(title),
            subtitle: _(subtitle),
            model: new Gtk.StringList({strings: themes}),
            selected: Math.max(0, themes.indexOf(selected)),
        });
        row.connect('notify::selected', () => {
            if (row.selected >= 0 && row.selected < themes.length)
                settings.set_string(key, themes[row.selected]);
        });
        group.add(row);
    }

    _addCursorCombo(group, settings, key, title, subtitle, fallback) {
        const themes = this._getAvailableCursorThemes();
        let selected = settings.get_string(key) || fallback;
        if (!themes.includes(selected))
            selected = themes.includes(fallback) ? fallback : (themes[0] || fallback);
        if (settings.get_string(key) !== selected)
            settings.set_string(key, selected);

        const row = new Adw.ComboRow({
            title: _(title),
            subtitle: _(subtitle),
            model: new Gtk.StringList({strings: themes}),
            selected: Math.max(0, themes.indexOf(selected)),
        });
        row.connect('notify::selected', () => {
            if (row.selected >= 0 && row.selected < themes.length)
                settings.set_string(key, themes[row.selected]);
        });
        group.add(row);
    }

    _addComboRows(group, settings, themes, suffix) {
        for (const color of ACCENTS) {
            const key = `${color}${suffix}`;
            let selected = settings.get_string(key);
            if (!themes.includes(selected))
                selected = themes.includes('Adwaita') ? 'Adwaita' : (themes[0] || 'Adwaita');
            if (settings.get_string(key) !== selected)
                settings.set_string(key, selected);

            const row = new Adw.ComboRow({
                title: _(titleCase(color)),
                subtitle: _(`Icon theme used whenever the GNOME accent is ${color}.`),
                model: new Gtk.StringList({strings: themes}),
                selected: Math.max(0, themes.indexOf(selected)),
            });
            row.connect('notify::selected', () => {
                if (row.selected >= 0 && row.selected < themes.length)
                    settings.set_string(key, themes[row.selected]);
            });
            group.add(row);
        }
    }

    _addInfoRow(group, title, subtitle, iconName) {
        const row = new Adw.ActionRow({title: _(title), subtitle: _(subtitle)});
        row.add_prefix(new Gtk.Image({icon_name: iconName}));
        group.add(row);
        return row;
    }

    _addPropertyRow(group, title, value, iconName) {
        const row = new Adw.ActionRow({title: _(title), subtitle: _(value)});
        row.add_prefix(new Gtk.Image({icon_name: iconName}));
        row.add_css_class('property');
        group.add(row);
    }

    _infoCard(title, subtitle, iconName) {
        const group = new Adw.PreferencesGroup();
        const row = new Adw.ActionRow({title: _(title), subtitle: _(subtitle)});
        row.add_prefix(new Gtk.Image({icon_name: iconName}));
        group.add(row);
        return group;
    }

    _getAvailableThemes() {
        return this._scanThemeDirectories([
            '/usr/local/share/themes', '/usr/share/themes',
            GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'themes']),
            GLib.build_filenamev([GLib.get_home_dir(), '.themes']),
        ]);
    }

    _getAvailableIconThemes() {
        return this._scanThemeDirectories([
            '/usr/local/share/icons', '/usr/share/icons',
            GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'icons']),
            GLib.build_filenamev([GLib.get_home_dir(), '.icons']),
        ]);
    }

    _getAvailableCursorThemes() {
        return this._scanThemeDirectories([
            '/usr/local/share/icons', '/usr/share/icons',
            GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'icons']),
            GLib.build_filenamev([GLib.get_home_dir(), '.icons']),
        ]);
    }

    _scanThemeDirectories(directories) {
        const themes = new Set();
        for (const dir of directories) {
            if (!GLib.file_test(dir, GLib.FileTest.IS_DIR))
                continue;
            const directory = Gio.File.new_for_path(dir);
            let enumerator;
            try {
                enumerator = directory.enumerate_children(
                    'standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const path = GLib.build_filenamev([dir, info.get_name()]);
                    if (GLib.file_test(path, GLib.FileTest.IS_DIR) &&
                        GLib.file_test(GLib.build_filenamev([path, 'index.theme']), GLib.FileTest.EXISTS))
                        themes.add(info.get_name());
                }
                enumerator.close(null);
            } catch (e) {
                console.warn(`[GNOME Theme Tweaks] Cannot scan ${dir}: ${e.message}`);
            }
        }
        const result = Array.from(themes).sort((a, b) => a.localeCompare(b));
        if (!result.includes('Adwaita'))
            result.unshift('Adwaita');
        if (!result.includes('Adwaita-dark'))
            result.push('Adwaita-dark');
        return result;
    }
}
