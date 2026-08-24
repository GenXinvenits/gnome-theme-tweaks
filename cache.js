import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { journal } from './utils.js'

function getExtensionCacheDir() {
    return `${GLib.get_home_dir()}/.cache/auto-accent-colour`
}

// fake cache that does nothing
function noCache() {
    return {
        get: async () => null,
        set: async () => {},
        remove: async () => {},
        keys: async () => [],
        clear: async () => {},
    }
}

// simple file-based cache
function fileBasedCache(cachedir) {
    function _setup() {
        journal(`Ensuring cache directory ${cachedir} exists...`)
        GLib.mkdir_with_parents(cachedir, 0o0755)
    }

    function _fetchFile(key) {
        return Gio.File.new_for_path(`${cachedir}/${key}`)
    }

    async function get(key) {
        const file = _fetchFile(key)
        if (!file.query_exists(null))
            return null

        try {
            const [_ok, contents] = await new Promise((resolve, reject) => {
                file.load_contents_async(null, (_file, res) => {
                    try {
                        resolve(file.load_contents_finish(res))
                    } catch (e) {
                        reject(e)
                    }
                })
            })

            const contentsString = new TextDecoder('utf-8').decode(contents)
            return JSON.parse(contentsString)
        } catch (e) {
            // A broken cache entry must behave exactly like a cache miss.
            // This prevents one failed wallpaper analysis from stopping future runs.
            journal(`Unable to read cache entry ${file.get_path()}: ${e}`)
            try { file.delete(null) } catch (_) {}
            return null
        }
    }

    async function set(key, data) {
        const file = _fetchFile(key)
        journal(`Writing cache entry to ${file.get_path()}...`)
        const cereal = JSON.stringify(data)
        const bytes = new GLib.Bytes(cereal)

        try {
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
                )
            })

            stream.write_bytes(bytes, null)
            stream.close(null)
        } catch (e) {
            journal(`Unable to write cache entry ${file.get_path()}: ${e}`)
        }
    }

    async function remove(key) {
        const file = _fetchFile(key)
        try {
            await file.delete_async(GLib.PRIORITY_DEFAULT, null, null)
        } catch (_) {}
    }

    async function keys() {
        const dir = Gio.File.new_for_path(cachedir)
        if (!dir.query_exists(null))
            return []

        try {
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
                )
            })
            return Array.from(files).map(finfo => finfo.get_name())
        } catch (e) {
            journal(`Unable to enumerate cache directory ${cachedir}: ${e}`)
            return []
        }
    }

    async function clear() {
        for (const key of await keys())
            await remove(key)
    }

    _setup()
    return { get, set, remove, keys, clear }
}

export {
    getExtensionCacheDir,
    noCache,
    fileBasedCache,
}
