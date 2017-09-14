function loadSettings() {
    chrome.runtime.getBackgroundPage(function(bgp){
        var options = bgp.getOptions();
        
        elmById("chkInlineJs").checked = options.inlineJs;
        elmById("chkInlineCss").checked = options.inlineCss;
        elmById("chkDeepInlineCss").checked = options.deepInlineCss;
        elmById("chkInlineImg").checked = options.inlineImg;
        elmById("nmbTimeout").value = options.timeout;
        elmById("chkAddTimestamp").checked = options.addTimestamp;
    });
}

function saveSettings() {
    chrome.runtime.getBackgroundPage(function(bgp){
        debugger;
        bgp.setOption("inlineJs", elmById("chkInlineJs").checked);
        bgp.setOption("inlineCss", elmById("chkInlineCss").checked);
        bgp.setOption("deepInlineCss", elmById("chkDeepInlineCss").checked);
        bgp.setOption("inlineImg", elmById("chkInlineImg").checked);
        bgp.setOption("timeout", elmById("nmbTimeout").value);
        bgp.setOption("addTimestamp", elmById("chkAddTimestamp").checked);
    });
}

function elmById(id) {
    return document.getElementById(id);
}

function linkupChangeEvent(elmId) {
    elmById(elmId).addEventListener("change", saveSettings);
}

window.onload = function () {
    loadSettings();

    linkupChangeEvent("chkInlineJs");
    linkupChangeEvent("chkInlineCss");
    linkupChangeEvent("chkDeepInlineCss");
    linkupChangeEvent("chkInlineImg");
    linkupChangeEvent("nmbTimeout");
    linkupChangeEvent("chkAddTimestamp");
};