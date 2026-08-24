import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { journal } from './utils.js'

function getExtensionCacheDir() {
    return `${GLib.get_home_dir()}/.cache/auto-accent-colour`
}

// (ya... i can do oop js... for sure...)

// fake cache that does nothing
// serves as an interface reference
// but can also be used to disable caching
function noCache() {
    function get() { return null; }
    function set() { }
    function remove() { }
    function keys() { return []; }
    function clear() { }
    return { get: get, set: set, remove: remove, keys: keys, clear: clear };
}

// simple file-based cache
function fileBasedCache(cachedir) {
    function _setup() {
        journal(`Ensuring cache directory ${cachedir} exists...`);
        GLib.mkdir_with_parents(cachedir, 0o0755);
    }
    function _fetchFile(key) {
        return Gio.File.new_for_path(`${cachedir}/${key}`);
    }
    async function get(key) {
        const file = _fetchFile(key);
        if (!file.query_exists(null)) {
            return null;
        }
        journal(`Reading cache entry from ${file.get_path()}...`);
        const [_ok, contents, _etag] = await new Promise((resolve, reject) => {
            file.load_contents_async(null, (_file, res) => {
                try {
                    resolve(file.load_contents_finish(res))
                } catch (e) {
                    reject(e)
                }
            })
        })
        const decoder = new TextDecoder('utf-8');
        const contentsString = decoder.decode(contents);
        try {
            return JSON.parse(contentsString);
        } catch (err) {
            journal(`unable to parse ${file.get_path()}: ${err}`);
            return null;
        }
    }
    async function set(key, data) {
        const file = _fetchFile(key);
        journal(`Writing cache entry to ${file.get_path()}...`);
        const cereal = JSON.stringify(data);
        const bytes = new GLib.Bytes(cereal);
        const stream = await new Promise((resolve, reject) => {
            file.replace_async(
                null,
                false,
                Gio.FileCreateFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (_file, res) => {
                    try {
                        resolve(file.replace_finish(res))
                    } catch (e) {
                        reject(e)
                    }
                }
            );
        })
        stream.write_bytes(bytes, null);
    }
    async function remove(key) {
        const file = _fetchFile(key);
        try {
            await file.delete_async(GLib.PRIORITY_DEFAULT, null, null);
        } catch { return }
    }
    async function keys() {
        const dir = Gio.File.new_for_path(cachedir);
        const files = await new Promise((resolve, reject) => {
            dir.enumerate_children_async(
                'standard::*',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_DEFAULT,
                null,
                (_file, res) => {
                    try {
                        resolve(dir.enumerate_children_finish(res))
                    } catch (e) {
                        reject(e)
                    }
                }
            );
        })
        return Array.from(files).map((finfo) => finfo.get_name());
    }
    async function clear() {
        for (const key of await keys()) {
            remove(key);
        }
    }
    _setup();
    return { get: get, set: set, remove: remove, keys: keys, clear: clear };
}

export {
    getExtensionCacheDir,
    noCache,
    fileBasedCache,
}
