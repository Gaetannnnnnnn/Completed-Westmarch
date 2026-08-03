export function DocumentHooks() {
    Hooks.on("renderDocumentOwnershipConfig", (app, html, data) => {
        const container = $(html).find(".window-content.standard-form");

        container.css({
            "max-height": "70vh",
            "overflow-y": "auto"
        });
    });
}