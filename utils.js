let loggingEnabled = false
let logFn = null

function setLogging(value) {
    loggingEnabled = value
}

function setLogFn(value) {
    logFn = value
}

function journal(msg, error = false) {
    if (loggingEnabled || error) {
        if (logFn) {
            logFn(msg, error)
        } else {
            const output = `[Auto Accent Colour] ${msg}`
            if (error) {
                console.error(output)
            } else {
                console.log(output)
            }
        }
    }
}

export {
    loggingEnabled,
    setLogging,
    setLogFn,
    journal
}
