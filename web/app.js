import { logger } from "./logger.js";
import { createGraph } from "./graph.js";
import { startBackend } from "./backend.js";

document.addEventListener("DOMContentLoaded", () => {
    logger.info("Bootstrapping frontend");

    const root = document.querySelector("#root");
    if (!root) {
        logger.error("Root element not found");
        return;
    }

    const graph = createGraph(root);

    startBackend({
        logger,
        onDelta: (delta) => {
            graph.applyDelta(delta);
        },
    }).catch((error) => {
        logger.error("Backend bootstrap failed", error);
    });
});
