const LOG_PREFIX = "[GitVista]";

function log(level, message, detail) {
    const time = new Date().toISOString();
    if (detail !== undefined) {
        console.log(`${LOG_PREFIX} ${time} [${level}] ${message}`, detail);
        return;
    }
    console.log(`${LOG_PREFIX} ${time} [${level}] ${message}`);
}

export const logger = {
    info(message, detail) {
        log("INFO", message, detail);
    },
    warn(message, detail) {
        log("WARN", message, detail);
    },
    error(message, detail) {
        log("ERROR", message, detail);
    },
};

