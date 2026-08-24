#!@GJS@ -m

import getPalette from './color-thief.js'

const imagePath = ARGV[0]
const palette = getPalette(imagePath)

// Color Thief returns several representative colours, but the first colour
// is not always the most useful accent for a multicoloured wallpaper. Prefer
// colours that are both visually prominent in the palette and sufficiently
// saturated to produce a meaningful GNOME accent, while keeping the original
// palette order as the primary signal.
function getSaturation(r, g, b) {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max === 0) return 0
    return ((max - min) / max) * 100
}

function getBrightness(r, g, b) {
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 510
}

function paletteScore(entry, index, count) {
    const [r, g, b] = entry
    const saturation = getSaturation(r, g, b) / 100
    const brightness = getBrightness(r, g, b)

    // Earlier palette entries are more representative of the wallpaper.
    const prominence = 1 - (index / Math.max(count, 1)) * 0.45

    // Strongly favour chromatic colours, but never completely discard neutral
    // colours because slate is a valid GNOME accent.
    const chromaWeight = 0.35 + saturation * 0.65

    // Avoid almost-black/almost-white colours dominating accent selection.
    const usableBrightness = Math.max(0, 1 - Math.abs(brightness - 0.5) / 0.5)
    const brightnessWeight = 0.65 + usableBrightness * 0.35

    return prominence * chromaWeight * brightnessWeight
}

const orderedPalette = (palette ?? [])
    .map((entry, index) => ({entry, index, score: paletteScore(entry, index, palette.length)}))
    .sort((a, b) => b.score - a.score)
    .map(item => item.entry)

let output = ''
for (let entry of orderedPalette) {
    output += entry.join(',') + ";"
}
print(output)
