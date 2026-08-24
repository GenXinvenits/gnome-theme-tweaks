import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { setLogging, setLogFn, journal } from './utils.js';
import { getExtensionCacheDir, noCache, fileBasedCache } from './cache.js';

const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';
const PREFER_DARK = 'prefer-dark';
const ACCENT_COLOR = 'accent-color';
const ACCENTS = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate', 'brown'];

function getHueFromRGB(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    if (delta === 0) return 0;
    let hue;
    switch (max) {
        case r: hue = (g - b) / delta; break;
        case g: hue = 2 + (b - r) / delta; break;
        default: hue = 4 + (r - g) / delta; break;
    }
    hue *= 60;
    return hue < 0 ? hue + 360 : hue;
}
function getSaturationFromRGB(r, g, b) {
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const delta = max - min;
    return max !== 0 ? (delta / max) * 100 : 0;
}
class HueRange {
    constructor(lowerBound, upperBound) { this.lowerBound = lowerBound; this.upperBound = upperBound; }
}
class AccentColour {
    constructor(name, r, g, b, hueRange) {
        this.name = name; this.r = r; this.g = g; this.b = b; this.hueRange = hueRange;
    }
}
function getSquaredEuclideanDistance(r1,g1,b1,r2,g2,b2) {
    return (r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2;
}
function isHueInRange(hue, range) {
    return range.lowerBound <= range.upperBound
        ? hue >= range.lowerBound && hue <= range.upperBound
        : hue >= range.lowerBound || hue <= range.upperBound;
}
function getClosestAccentColour(accentColours, r, g, b) {
    const hue = getHueFromRGB(r,g,b);
    const saturation = getSaturationFromRGB(r,g,b);
    if (saturation < 5)
        return accentColours.findIndex(a => a.name === 'slate');
    const eligible = accentColours.filter(a => isHueInRange(hue, a.hueRange));
    let best = eligible[0] ?? accentColours[0];
    let distance = Number.MAX_VALUE;
    for (const accent of eligible) {
        const d = getSquaredEuclideanDistance(r,g,b,accent.r,accent.g,accent.b);
        if (d < distance) { distance = d; best = accent; }
    }
    return accentColours.indexOf(best);
}
function execCommand(argv, input = null, cancellable = null) {
    let flags = Gio.SubprocessFlags.STDOUT_PIPE;
    if (input !== null) flags |= Gio.SubprocessFlags.STDIN_PIPE;
    const process = new Gio.Subprocess({argv, flags});
    process.init(cancellable);
    return new Promise((resolve,reject) => {
        process.communicate_utf8_async(input, cancellable, (proc,res) => {
            try { resolve(proc.communicate_utf8_finish(res)[1]); }
            catch (e) { reject(e); }
        });
    });
}
async function runColorThief(imagePath, extensionPath) {
    try {
        const result = await execCommand(['gjs','-m',`${extensionPath}/color-thief/run-color-thief.js`,imagePath]);
        return result.trim().split(';').filter(Boolean).map(entry => entry.split(',').map(Number));
    } catch (e) {
        journal(e, true);
        return Array(5).fill([0,0,0]);
    }
}
async function getBackgroundPalette(extensionPath, path) {
    return runColorThief(path, extensionPath);
}
async function applyClosestAccent(runId, getCurrentRun, extensionPath, accents, backgroundUri, cache, highlightMode, onWait, onError, onFinish) {
    const backgroundFile = Gio.File.new_for_uri(backgroundUri);
    const backgroundPath = backgroundFile.get_path();
    if (!backgroundPath) { onError(); return; }
    let bytes;
    try {
        bytes = await new Promise((resolve,reject) => {
            backgroundFile.load_bytes_async(null, (_f,res) => {
                try { resolve(backgroundFile.load_bytes_finish(res)[0]); } catch(e) { reject(e); }
            });
        });
    } catch (e) { journal(e,true); onError(); return; }

    const hash = bytes.hash();
    const parserVersion = 2;
    if (await cache.get('parser-version') !== parserVersion) {
        await cache.clear();
        await cache.set('parser-version', parserVersion);
    }
    let palette = await cache.get(hash);
    try {
        const info = await backgroundFile.query_info_async('standard::*', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null);
        if (info.get_content_type() === 'application/xml') { onError(); return; }
    } catch (e) {
        journal(e,true);
    }
    if (palette === null) {
        onWait();
        palette = await getBackgroundPalette(extensionPath, backgroundPath);
        await cache.set(hash, palette);
    }
    if (!palette?.length) { onError(); return; }
    const tuple = palette[highlightMode ? 1 : 0] ?? palette[0];
    const [r,g,b] = tuple;
    const idx = getClosestAccentColour(accents,r,g,b);
    const accent = accents[idx];
    if (runId === getCurrentRun()) onFinish(accent);
}

export default class GnomeThemeTweaksExtension extends Extension {
    enable() {
        this._interface = new Gio.Settings({schema: INTERFACE_SCHEMA});
        this._backgroundSettings = new Gio.Settings({schema: BACKGROUND_SCHEMA});
        this._preferences = this.getSettings();
        this._signals = [];
        this._autoSignals = [];
        this._cursorSignals = [];
        this._accentRun = 0;
        this._backgroundMonitor = null;
        this._backgroundMonitorTimeout = 0;

        this._signals.push(this._interface.connect('changed::accent-color', () => this._applyAll()));
        this._signals.push(this._interface.connect('changed::color-scheme', () => this._applyAll()));
        this._signals.push(this._preferences.connect('changed', () => this._applyAll()));

        this._applyAll();
        this._setupAutoAccent();
        this._setupCursor();
    }

    disable() {
        this._disconnectSignals(this._autoSignals, this._backgroundSettings);
        this._disconnectSignals(this._cursorSignals, this._interface);
        this._disconnectSignals(this._signals.slice(0,2), this._interface);
        if (this._signals[2] && this._preferences) this._preferences.disconnect(this._signals[2]);
        this._stopBackgroundMonitor();
        if (this._backgroundMonitorTimeout) {
            GLib.source_remove(this._backgroundMonitorTimeout);
            this._backgroundMonitorTimeout = 0;
        }
        this._signals = [];
        this._autoSignals = [];
        this._cursorSignals = [];
        this._destroyAutoIndicator();
        this._setGtkTheme('Adwaita');
        this._setIconTheme('Adwaita');
        if (this._userThemeSettings) this._setUserTheme('Adwaita');
        this._setCursorTheme('Adwaita');
        this._removeGtk4Files();
        this._interface = null;
        this._backgroundSettings = null;
        this._preferences = null;
        this._userThemeSettings = null;
    }

    _disconnectSignals(ids, settings) {
        if (!settings) return;
        for (const id of ids) {
            try { if (id) settings.disconnect(id); } catch (_) {}
        }
    }

    _applyAll() {
        if (!this._interface || !this._preferences) return;
        const accent = this._interface.get_string('accent-color') || 'blue';
        const dark = this._interface.get_string('color-scheme') === PREFER_DARK;
        const scheme = dark ? 'dark' : 'light';

        const gtkTheme = this._preferences.get_string(`gtk-theme-${scheme}`) || (dark ? 'Adwaita-dark' : 'Adwaita');
        const userTheme = this._preferences.get_string(`user-theme-${scheme}`) || (dark ? 'Adwaita-dark' : 'Adwaita');
        const iconTheme = this._preferences.get_string(`${accent}-icon-theme`) || 'Adwaita';

        this._setGtkTheme(gtkTheme);
        this._setIconTheme(iconTheme);
        this._setupUserThemeSettings();
        if (this._userThemeSettings) this._setUserTheme(userTheme);

        if (this._preferences.get_boolean('set-link-gtk4')) this._syncGtk4Files(gtkTheme);
        else this._removeGtk4Files();

        this._applyCursorTheme();
    }

    _setupUserThemeSettings() {
        if (this._userThemeSettings) return;
        try {
            this._userThemeSettings = new Gio.Settings({schema:'org.gnome.shell.extensions.user-theme'});
        } catch (e) {
            this._userThemeSettings = null;
            console.warn(`[GNOME Theme Tweaks] User Themes extension schema unavailable: ${e.message}`);
        }
    }

    _setGtkTheme(themeName) { this._interface?.set_string('gtk-theme', themeName); }
    _setIconTheme(themeName) {
        if (this._preferences?.get_boolean('change-app-colors') !== false && themeName)
            this._interface?.set_string('icon-theme', themeName);
    }
    _setUserTheme(themeName) { this._userThemeSettings?.set_string('name', themeName); }
    _setCursorTheme(themeName) { if (themeName) this._interface?.set_string('cursor-theme', themeName); }

    _setupCursor() {
        const handler = this._interface.connect('changed::color-scheme', () => this._applyCursorTheme());
        this._cursorSignals.push(handler);
        this._applyCursorTheme();
    }
    _applyCursorTheme() {
        if (!this._interface || !this._preferences || !this._preferences.get_boolean('cursor-follow-color-scheme')) return;
        const dark = this._interface.get_string('color-scheme') === PREFER_DARK;
        const key = dark ? 'cursor-theme-dark' : 'cursor-theme-light';
        const theme = this._preferences.get_string(key) || 'Adwaita';
        this._setCursorTheme(theme);
    }

    _setupAutoAccent() {
        const onScheme = this._backgroundSettings.connect('changed::picture-uri', () => {
            if (this._preferences.get_boolean('auto-accent-enable') &&
                this._interface.get_string('color-scheme') !== PREFER_DARK)
                this._scheduleAccentRefresh();
        });

        const onSchemeDark = this._backgroundSettings.connect('changed::picture-uri-dark', () => {
            if (this._preferences.get_boolean('auto-accent-enable') &&
                this._interface.get_string('color-scheme') === PREFER_DARK)
                this._scheduleAccentRefresh();
        });

        const onPref = this._preferences.connect('changed::auto-accent-enable', () => {
            if (this._preferences.get_boolean('auto-accent-enable')) {
                this._setupBackgroundMonitor();
                this._scheduleAccentRefresh();
                if (this._preferences.get_boolean('auto-accent-show-indicator'))
                    this._createAutoIndicator();
            } else {
                this._accentRun++;
                if (this._accentTimeout) {
                    GLib.source_remove(this._accentTimeout);
                    this._accentTimeout = 0;
                }
                this._stopBackgroundMonitor();
                this._destroyAutoIndicator();
            }
        });

        const onIndicator = this._preferences.connect('changed::auto-accent-show-indicator', () => {
            if (this._preferences.get_boolean('auto-accent-enable') &&
                this._preferences.get_boolean('auto-accent-show-indicator'))
                this._createAutoIndicator();
            else if (!this._preferences.get_boolean('auto-accent-show-indicator'))
                this._destroyAutoIndicator();
        });

        this._autoSignals.push(onScheme, onSchemeDark, onPref, onIndicator);

        if (this._preferences.get_boolean('auto-accent-enable')) {
            this._setupBackgroundMonitor();
            if (this._preferences.get_boolean('auto-accent-show-indicator'))
                this._createAutoIndicator();
            this._scheduleAccentRefresh();
        }
    }

    _setupBackgroundMonitor() {
        if (this._backgroundMonitor || !this._preferences?.get_boolean('auto-accent-enable')) return;
        try {
            const backgroundFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), '.config', 'background']));
            this._backgroundMonitor = backgroundFile.monitor(Gio.FileMonitorFlags.NONE, null);
            this._backgroundMonitor.connect('changed', (_monitor, _file, _otherFile, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CREATED) this._onWallpaperChanged();
            });
            journal(`Watching ${backgroundFile.get_path()} for wallpaper changes`);
        } catch (e) {
            this._backgroundMonitor = null;
            journal(`Could not monitor wallpaper file: ${e}`, true);
        }
    }

    _stopBackgroundMonitor() {
        if (this._backgroundMonitor) {
            try { this._backgroundMonitor.cancel(); } catch (_) {}
            this._backgroundMonitor = null;
        }
        if (this._backgroundMonitorTimeout) {
            GLib.source_remove(this._backgroundMonitorTimeout);
            this._backgroundMonitorTimeout = 0;
        }
    }

    _onWallpaperChanged() {
        if (!this._preferences?.get_boolean('auto-accent-enable')) return;
        this._accentRun++;
        if (this._accentTimeout) {
            GLib.source_remove(this._accentTimeout);
            this._accentTimeout = 0;
        }
        this._scheduleAccentRefresh(50);
    }

    _scheduleAccentRefresh(delay = 150) {
        if (this._accentTimeout) GLib.source_remove(this._accentTimeout);
        this._accentTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._accentTimeout = 0;
            this._setAccentFromWallpaper();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _setAccentFromWallpaper() {
        if (!this._preferences?.get_boolean('auto-accent-enable')) return;
        const backgroundUri = this._interface.get_string('color-scheme') === PREFER_DARK
            ? this._backgroundSettings.get_string('picture-uri-dark')
            : this._backgroundSettings.get_string('picture-uri');
        const accents = [
            new AccentColour('blue',0,115,255,new HueRange(195,300)),
            new AccentColour('teal',0,255,255,new HueRange(120,240)),
            new AccentColour('green',0,191,0,new HueRange(50,180)),
            new AccentColour('yellow',200,150,0,new HueRange(29,64)),
            new AccentColour('orange',237,91,0,new HueRange(9,64)),
            new AccentColour('red',230,0,26,new HueRange(340,9)),
            new AccentColour('pink',230,138,182,new HueRange(240,8)),
            new AccentColour('purple',145,65,172,new HueRange(240,330)),
            new AccentColour('slate',166,166,166,new HueRange(195,300))
        ];
        const onUbuntu = Main.sessionMode.currentMode === 'ubuntu';
        if (onUbuntu) accents[8].hueRange = new HueRange(50,180);
        const cache = this._preferences.get_boolean('auto-accent-disable-cache')
            ? noCache() : fileBasedCache(getExtensionCacheDir());
        const run = ++this._accentRun;
        this._showAutoIndicator('wait');
        await applyClosestAccent(
            run, () => this._accentRun, this.path, accents, backgroundUri, cache,
            this._preferences.get_boolean('auto-accent-highlight-mode'),
            () => this._showAutoIndicator('wait'),
            () => this._showAutoIndicator('alert'),
            (accent) => {
                if (run !== this._accentRun) return;
                this._interface.set_string(ACCENT_COLOR, accent.name);
                this._applyAll();
                this._showAutoIndicator('normal');
            }
        );
        if (!this._preferences?.get_boolean('auto-accent-enable')) this._destroyAutoIndicator();
    }

    _createAutoIndicator() {
        if (this._autoIndicator) return;
        const getIcon = name => new St.Icon({
            gicon: Gio.icon_new_for_string(`${this.path}/icons/${name}.svg`),
            style_class: 'system-status-icon'
        });
        this._autoIndicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._autoIndicator.add_child(getIcon('color-symbolic'));
        Main.panel.addToStatusArea(`${this.uuid}-auto-accent`, this._autoIndicator);
        this._autoIndicator.menu.addAction('Force Accent Refresh', () => this._scheduleAccentRefresh());
        this._autoIndicator.menu.addAction('Preferences', () => this.openPreferences());
    }
    _showAutoIndicator(state) {
        if (!this._preferences?.get_boolean('auto-accent-show-indicator')) return;
        if (!this._autoIndicator) this._createAutoIndicator();
        if (!this._autoIndicator) return;
        const name = state === 'wait' ? 'color-wait-symbolic' : state === 'alert' ? 'color-alert-symbolic' : 'color-symbolic';
        this._autoIndicator.child = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this.path}/icons/${name}.svg`),
            style_class: 'system-status-icon'
        });
    }
    _destroyAutoIndicator() {
        this._autoIndicator?.destroy();
        this._autoIndicator = null;
    }

    _gtk4Dir() { return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), '.config', 'gtk-4.0'])); }
    _syncGtk4Files(themeName) {
        const base = this._preferences.get_string('set-theme-path') || '/usr/share/themes';
        const sourceDir = Gio.File.new_for_path(GLib.build_filenamev([base, themeName, 'gtk-4.0']));
        const destDir = this._gtk4Dir();
        if (!sourceDir.query_exists(null)) return;
        try { destDir.make_directory_with_parents(null); } catch (_) {}
        for (const filename of ['gtk.css','gtk-dark.css']) this._copyFile(sourceDir.get_child(filename), destDir.get_child(filename));
        this._copyDirectory(sourceDir.get_child('assets'), destDir.get_child('assets'));
        const prefix = themeName.split('-')[0];
        if (prefix === 'MacTahoe' || prefix === 'WhiteSur') this._copyDirectory(sourceDir.get_child('windows-assets'), destDir.get_child('windows-assets'));
    }
    _copyFile(source,destination) {
        if (!source.query_exists(null)) return;
        try { source.copy(destination,Gio.FileCopyFlags.OVERWRITE,null,null); } catch(e) { console.warn(`[GNOME Theme Tweaks] Could not copy ${source.get_path()}: ${e.message}`); }
    }
    _copyDirectory(source,destination) {
        if (!source.query_exists(null)) return;
        try { destination.make_directory_with_parents(null); } catch (_) {}
        let enumerator;
        try {
            enumerator = source.enumerate_children('standard::name,standard::type',Gio.FileQueryInfoFlags.NONE,null);
            let info;
            while ((info=enumerator.next_file(null)) !== null) {
                const child=source.get_child(info.get_name()), target=destination.get_child(info.get_name());
                if (info.get_file_type()===Gio.FileType.DIRECTORY) this._copyDirectory(child,target);
                else this._copyFile(child,target);
            }
            enumerator.close(null);
        } catch(e) { console.warn(`[GNOME Theme Tweaks] Could not copy directory ${source.get_path()}: ${e.message}`); }
    }
    _removeGtk4Files() {
        const dir=this._gtk4Dir();
        for (const name of ['gtk.css','gtk-dark.css','assets','windows-assets']) this._removePath(dir.get_child(name));
    }
    _removePath(file) {
        if (!file.query_exists(null)) return;
        try {
            const info=file.query_info('standard::type',Gio.FileQueryInfoFlags.NONE,null);
            if (info.get_file_type()===Gio.FileType.DIRECTORY) {
                const e=file.enumerate_children('standard::name',Gio.FileQueryInfoFlags.NONE,null);
                let child; while ((child=e.next_file(null))!==null) this._removePath(file.get_child(child.get_name()));
                e.close(null);
            }
            file.delete(null);
        } catch(e) { console.warn(`[GNOME Theme Tweaks] Could not remove ${file.get_path()}: ${e.message}`); }
    }
}