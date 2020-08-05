
chrome.tabs.query(
    {currentWindow: true, active: true},
    function(activeTabs) {
        chrome.tabs.executeScript(activeTabs[0].id, {
            code: "console.log(\"inline from options\"); chrome.runtime.sendMessage(" +
            JSON.stringify({
                "action": "startInline"
            }) + ");"
        });
    });