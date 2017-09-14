var menu = [];
menu["test"] = chrome.contextMenus.create({
    "title": "Save page as one file",
    "contexts": ["page"],
    "onclick": function (info, tab) {
        saveInlinedPage();
    }
});

var isActive = false;
var animationIndex = 0;

function saveInlinedPage() {
    var options = getOptions();
    chrome.tabs.query(
        { currentWindow: true, active: true },
        function(tabArray) {
            startActivity();
            chrome.tabs.executeScript(tabArray[0].id, {
                code: "var options = " + JSON.stringify(getOptions())
            }, function() {
                chrome.tabs.executeScript(tabArray[0].id,
                    {
                        file: "pageinlinesaver.js"
                    },
                    function(result) {
                        if (chrome.runtime.lastError) {
                            console.error(chrome.runtime.lastError);
                        }
                    });
            });
        }
    );
}

function saveFile(request) {
    endActivity();
    var blob = new Blob(["\ufeff", request.source], { encoding: "UTF-8", type: "text/html;charset=utf-8" });
    var urlParts = decodeURIComponent(request.url).replace("http://", "").replace("https://", "").split(/[\.\/\\:\?&=\[\]\|]/);
    var fileNameParts = [];
    for (var i = 0; i < urlParts.length; i++) {
        if (urlParts[i] && urlParts[i].length > 0) {
            fileNameParts.push(decodeURIComponent(urlParts[i]));
        }
    }
    var fileName = fileNameParts.join("-");

    chrome.downloads.download({
        url: URL.createObjectURL(blob),
        filename: fileName + ".html",

    });
}

function startActivity() {
    isActive = true;
    indicateActivity();
}

function endActivity() {
    isActive = false;
}

function indicateActivity() {
    if(chrome.browserAction != undefined) {
        if (isActive) {
            chrome.browserAction.setIcon({ path: "img/activity" + animationIndex + ".png" })
            if (++animationIndex > 3) {
                animationIndex = 0;
            }
            window.setTimeout(indicateActivity, 300);
        } else {
            chrome.browserAction.setIcon({ path: "img/icon128.png" })
            animationIndex = 0;
        }
    }
}

function getOption(name, defaultValue) {
    try {
        var value = window.localStorage.getItem(name);
        if (typeof value != "undefined" && value != null) {
            return value;
        }
        
        return defaultValue;
    }
    catch (err) {
        console.log("Error getting option " + name);
    }

    return null;
}

function getOptions() {
    return {
        inlineJs : getOption("inlineJs", "true") == "true",
        inlineCss : getOption("inlineCss", "true") == "true",
        deepInlineCss : getOption("deepInlineCss", "true") == "true",
        inlineImg : getOption("inlineImg", "true") == "true",
        timeout : getOption("timeout", 30000),
        addTimestamp : getOption("addTimestamp", "true") == "true"
    };
}

function setOption(name, value) {
    try {
        window.localStorage.removeItem(name);
        window.localStorage.setItem(name, value);
    }
    catch (err) {
        console.log("Error setting option " + name);
    }
}

chrome.runtime.onMessage.addListener(function (request, sender) {
    if (request.action == "saveFile") {
        saveFile(request);
    }
});