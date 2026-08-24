#!@GJS@ -m

import getPalette from './color-thief.js'

const imagePath = ARGV[0]
const palette = getPalette(imagePath)
let output = ''
for (let entry of palette) {
    output += entry.join(',') + ";"
}
print(output)
