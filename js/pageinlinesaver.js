var pageInlineSaver = (function () {
    "use strict";

    // @author Rob W <http://stackoverflow.com/users/938089/rob-w>
    // Demo: var serialized_html = DOMtoString(document);
    function DOMtoString(document_root) {
        var html = "",
            node = document_root.firstChild;
        while (node) {
            switch (node.nodeType) {
                case Node.ELEMENT_NODE:
                    html += node.outerHTML;
                    break;
                case Node.TEXT_NODE:
                    html += node.nodeValue;
                    break;
                case Node.CDATA_SECTION_NODE:
                    html += "<![CDATA[" + node.nodeValue + "]]>";
                    break;
                case Node.COMMENT_NODE:
                    html += "<!--' + node.nodeValue + '-->";
                    break;
                case Node.DOCUMENT_TYPE_NODE:
                    // (X)HTML documents are identified by public identifiers
                    html += "<!DOCTYPE " + node.name + (node.publicId ? " PUBLIC \"" + node.publicId + "\"" : "") + (!node.publicId && node.systemId ? " SYSTEM" : "") + (node.systemId ? " \"" + node.systemId + "\"" : "") + ">\n";
                    break;
            }
            node = node.nextSibling;
        }
        return html;
    }

    function inlineResources() {
        var timeout;
        if (options.timeout > 0) {
            timeout = setTimeout(() => {
                if (!pageInlineSaver.stopInlining) {
                    console.info("Timeout reached: saving page with " + (this.initiatedInlines - this.completedInlines) + " inlines left unfinished out of " + this.foundInlinables + " found inlinables");
                    pageInlineSaver.saveFile();
                }
            }, options.timeout * 1000);
        }

        //find all <link rel="stylesheet">, <style>, <script src=?>, <img src=>, <source>, <video> and <audio> tags
        if (options.inlineCss) {
            var linkTags = findElements("link", function (elm) { return elm.getAttribute("rel").toLowerCase() === "stylesheet"; });
        }
        if (options.inlineJs || options.removeJs) {
            var scriptTags = findElements("script", function (elm) { return elm.hasAttribute("src"); });
        }
        if (options.inlineImg) {
            var imgTags = findElements("img", function (elm) { return elm.hasAttribute("src") && elm.getAttribute("src") !== null; });

            imgTags.concat(findElements("embed", function (elm) { return elm.hasAttribute("src") && elm.hasAttribute("type") && elm.getAttribute("type").startsWith("image/"); }));

            imgTags.concat(findElements("source", function (elm) {
                return elm.hasAttribute("srcset") && elm.getAttribute("srcset") &&
                    (elm.hasAttribute("type") && elm.getAttribute("type").startsWith("image/") ||
                        elm.parentElement.nodeName.toLowerCase() === "picture");
            }));
        }

        if (options.deepInlineCss) {
            //inline stylesheet internal content
            var styleTags = findElements("style");
            for (let i = 0; i < styleTags.length; i++) {
                pageInlineSaver.inlineStylesheetInternal(styleTags[i].innerText, styleTags[i]);
            }

            var styleAttributes = queryElements("[style]");
            for (let i = 0; i < styleAttributes.length; i++) {
                pageInlineSaver.inlineStylesheetInternal(styleAttributes[i].getAttribute("style"), styleAttributes[i]);
            }
        }

        var initialInlineableCount = linkTags.length + scriptTags.length + imgTags.length +
            (styleTags ? styleTags.length : 0) +
            (styleAttributes ? styleAttributes.length : 0);
        pageInlineSaver.handleMessage("Inlining " + initialInlineableCount + " external resources");
        pageInlineSaver.increaseFoundInlineables(initialInlineableCount);

        if (initialInlineableCount > 0) {
            try {
                if (options.inlineCss) {
                    for (let i = 0; i < linkTags.length; i++) {
                        //retrieve external file and inline into new <style> tag
                        let url = linkTags[i].getAttribute("href");

                        pageInlineSaver.downloadResource({
                            url: url,
                            baseUrl: new URL(location.href).origin,
                            resourceDeclaration: linkTags[i]
                        },
                            pageInlineSaver.inlineStylesheet,
                            false);
                    }
                }

                if (options.inlineJs || options.removeJs) {
                    for (let i = 0; i < scriptTags.length; i++) {
                        if (options.inlineJs && !options.removeJs) {
                            //retrieve external file and inline into new <script> tag without src attribute
                            let url = scriptTags[i].getAttribute("src");

                            pageInlineSaver.downloadResource({
                                url: url,
                                baseUrl: new URL(location.href).origin,
                                resourceDeclaration: scriptTags[i]
                            },
                                pageInlineSaver.inlineScript,
                                false);
                        }
                        else {
                            scriptTags[i].parentElement.removeChild(scriptTags[i]);
                        }
                    }
                }

                if (options.inlineImg) {
                    for (let i = 0; i < imgTags.length; i++) {
                        if (imgTags[i].hasAttribute("src")) {
                            let url = imgTags[i].getAttribute("src");
                            if (!url.startsWith("data:")) {
                                //retrieve external image and create data URI
                                pageInlineSaver.downloadResource({
                                    url: url,
                                    baseUrl: new URL(location.href).origin,
                                    resourceDeclaration: imgTags[i],
                                    srcElement: "src"
                                },
                                    pageInlineSaver.inlineImage,
                                    true);
                            }
                        }

                        if (imgTags[i].hasAttribute("srcset")) {
                            let urls = imgTags[i].getAttribute("srcset").trim().split(",");
                            for (let j = 0; j < urls.length; j++) {
                                let url = urls[j].trim().split(" ")[0].trim();
                                if (!url.startsWith("data:")) {
                                    pageInlineSaver.downloadResource({
                                        url: url,
                                        baseUrl: new URL(location.href).origin,
                                        resourceDeclaration: imgTags[i],
                                        srcElement: "srcset"
                                    },
                                        pageInlineSaver.inlineImage,
                                        true);
                                }
                            }
                        }
                    }
                }
            }
            catch (error) {
                pageInlineSaver.handleError(error);
                clearTimeout(timeout);
                pageInlineSaver.saveFile();
            }
        }
        else {
            //nothing left to inline, call saveFile
            clearTimeout(timeout);
            pageInlineSaver.saveFile();
        }
    }

    function inlineScript(_url, _srcElement, resourceDeclaration, content, _contentType) {
        //surround with CDATA
        content = "//<![CDATA[\n" + content.replace(new RegExp("<\/script>", "gi"), "&lt;/script&gt;") + "\n//]]>";

        //replace src attribute with inlined script
        resourceDeclaration.removeAttribute("src");
        resourceDeclaration.innerHTML = content;

        pageInlineSaver.completedInline();
    }

    function inlineImage(url, srcElement, resourceDeclaration, content, contentType) {
        //replace src attribute with base64 encoded image
        pageInlineSaver.getImageAsDataUrl(content, contentType, function (dataUrl) {
            if (srcElement === "src") {
                resourceDeclaration.setAttribute("src", dataUrl);
            }
            else if (srcElement === "srcset") {
                resourceDeclaration.setAttribute("srcset", resourceDeclaration.getAttribute("srcset").replace(url, dataUrl));
            }

            pageInlineSaver.completedInline();
        });
    }

    function inlineStylesheet(url, srcElement, resourceDeclaration, content, contentType) {
        //create new element
        let newElement = document.createElement("style");
        newElement.setAttribute("type", "text/css");
        newElement.innerHTML = content;
        newElement.setAttribute("href", resourceDeclaration.getAttribute("href"));
        if (resourceDeclaration.hasAttribute("media")) {
            newElement.setAttribute("media", resourceDeclaration.getAttribute("media"));
        }
        //replace old element with new
        resourceDeclaration.parentNode.replaceChild(newElement, resourceDeclaration);

        //inline internal content (url() and @import)
        if (options.deepInlineCss) {
            pageInlineSaver.inlineStylesheetInternal(content, newElement);
        }

        //signal completedInline for stylesheet
        pageInlineSaver.completedInline();
    }

    function inlineStylesheetInternal(content, srcElement) {
        var rootUrl = new URL(location.href).origin;
        var baseUrl = undefined;
        if (srcElement.hasAttribute("href")) {
            baseUrl = srcElement.getAttribute("href");
        }
        if (srcElement.hasAttribute("src")) {
            baseUrl = srcElement.getAttribute("src");
        }
        if (baseUrl && baseUrl.startsWith("/")) {
            baseUrl = rootUrl + baseUrl;
        }
        if (baseUrl && baseUrl.startsWith(".")) {
            baseUrl = relativeUrlToAbsolute(rootUrl,)
        }
        if (baseUrl === undefined) {
            document.getElementsByTagName("base")[0].getAttribute("href");
        }
        if (baseUrl === undefined) {
            baseUrl = new URL(location.href).origin;
        }
        //search CSS for url() occurrences and inline them. they will be replaced in the page source
        var urlPattern = /url\("?'?([ a-zA-Z0-9:\-\.\\\/_&?=@]+)"?'?\)/gi;
        var match = urlPattern.exec(content);
        while (match) {
            let url = match[1];
            //avoid urls that are already inlined
            if (!match[1].startsWith("data:")) {
                pageInlineSaver.downloadResource({
                    url: url,
                    baseUrl,
                    resourceDeclaration: match[0],
                    srcElement: srcElement
                },
                    pageInlineSaver.inlineStylesheetImage,
                    true);
            }

            match = urlPattern.exec(content);
        }

        //search CSS for @import declarations and inline these
        var importPattern = /@import\s+"?'?([ a-zA-Z0-9:\-\.\\\/_&?=@]+)"?'?/gi;
        match = importPattern.exec(content);
        while (match) {
            let url = match[1];

            pageInlineSaver.downloadResource({
                url: url,
                baseUrl,
                resourceDeclaration: match[0],
                srcElement: srcElement
            },
                pageInlineSaver.inlineStylesheetImport,
                false);

            match = urlPattern.exec(content);
        }
    }

    function inlineStylesheetImage(url, srcElement, originalUrl, content, contentType) {
        pageInlineSaver.getImageAsDataUrl(content, contentType, function (dataUrl) {
            srcElement.innerHTML = srcElement.innerHTML.replace(originalUrl, function () { return "url(" + dataUrl + ")"; });

            pageInlineSaver.completedInline();
        });
    }

    function inlineStylesheetImport(url, srcElement, importDeclaration, content, _contentType) {
        srcElement.innerHTML = srcElement.innerHTML.replace(importDeclaration, function () { return content; });
        pageInlineSaver.inlineStylesheetInternal(srcElement.innerHTML, srcElement);

        pageInlineSaver.completedInline();
    }

    function getImageAsDataUrl(content, _contentType, callback) {
        if (this.stopInlining) return;

        try {
            var reader = new FileReader();
            reader.readAsDataURL(content);
            reader.onloadend = function () {
                callback(reader.result);
            };
        }
        catch (error) {
            pageInlineSaver.handleError(error);
            pageInlineSaver.saveFile();
        }
    }

    //find elements by name and filter by given expression
    function findElements(tagName, filter) {
        var elements = document.getElementsByTagName(tagName);
        var filteredElements = [];
        for (var i = 0; i < elements.length; i++) {
            if (!filter || typeof filter === "function" && filter(elements[i])) {
                filteredElements.push(elements[i]);
            }
        }

        return filteredElements;
    }

    function queryElements(query) {
        return document.querySelectorAll(query);
    }

    function downloadResource(config, callback, isBinary) {
        //resolve URL        
        if (!config.url.startsWith("http")) {
            config.url = new URL(config.url, config.baseUrl);
        }

        pageInlineSaver.initiatedInlines++;
        console.debug("Inlining " + config.url);

        try {
            fetch(config.url, {
                credentials: "include",
                mode: "cors"
            })
                .then(response => {
                    return (isBinary ? response.blob() : response.text()).then(content => {
                        callback(config.url, config.srcElement, config.resourceDeclaration, content, response.headers.get("Content-Type"));
                    });
                })
                .catch(reason => {
                    pageInlineSaver.handleError(reason);
                });
        }
        catch (error) {
            pageInlineSaver.handleError(error);
        }
    }

    //@author Bergi <http://stackoverflow.com/users/1048572/bergi>
    function relativeUrlToAbsolute(base, relativeUrl) {
        var stack = base.split("/"),
            parts = relativeUrl.split("/");
        stack.pop(); // remove current file name (or empty string)
        // (omit if "base" is the current folder without trailing slash)
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === ".")
                continue;
            if (parts[i] === "..")
                stack.pop();
            else
                stack.push(parts[i]);
        }
        return stack.join("/");
    }

    function completedInline() {
        pageInlineSaver.completedInlines++;
        if (pageInlineSaver.initiatedInlines === pageInlineSaver.completedInlines) {
            pageInlineSaver.saveFile();
        }
    }

    function saveFile() {
        if (!pageInlineSaver.stopInlining) {
            pageInlineSaver.stopInlining = true;

            var infoPanel = document.getElementById("SimmetricPageSaverInfoPanel");
            infoPanel.parentElement.removeChild(infoPanel);
            var dimmer = document.getElementById("SimmetricPageSaverDimmer");
            dimmer.parentElement.removeChild(dimmer);
            var counter = document.getElementById("SimmetricPageSaverInlineableCounter");
            counter.parentElement.removeChild(counter);
            var stopButton = document.getElementById("SimmetricPageSaverStopButton");
            stopButton.parentElement.removeChild(stopButton);

            var pageSource = pageInlineSaver.DOMtoString(document);

            chrome.runtime.sendMessage({
                "action": "saveFile",
                "source": pageSource,
                "url": window.location.href
            });
        }
    }

    function setBaseLink() {
        if (document.getElementsByTagName("base").length === 0) {
            var base = document.createElement("base");
            base.setAttribute("href", window.location.href);
            document.head.appendChild(base);
        }
    }

    function insertTimestamp() {
        var meta = document.createElement("meta");
        meta.setAttribute("name", "generator");
        meta.setAttribute("value", "Saved inlined page from " + window.location.href + " on " + new Date());
        document.head.appendChild(meta);
    }

    function handleError(error) {
        document.getElementById("SimmetricPageSaverInfoPanel").innerHTML += "<span style=\"color: #a00;\">An error occurred! Press F12 to see what it is.</span><br>";
        console.error(error);
    }

    function handleMessage(message) {
        document.getElementById("SimmetricPageSaverInfoPanel").innerHTML += message + "<br>";
    }

    function increaseFoundInlineables(totalInlineablesCount) {
        document.getElementById("SimmetricPageSaverInlineableCounter").innerText = totalInlineablesCount;
    }

    return {
        insertTimestamp: insertTimestamp,
        setBaseLink: setBaseLink,
        inlineResources: inlineResources,
        saveFile: saveFile,
        DOMtoString: DOMtoString,
        handleError: handleError,
        handleMessage: handleMessage,
        increaseFoundInlineables: increaseFoundInlineables,
        downloadResource: downloadResource,
        inlineImage: inlineImage,
        inlineScript: inlineScript,
        inlineStylesheet: inlineStylesheet,
        inlineStylesheetImage: inlineStylesheetImage,
        inlineStylesheetImport: inlineStylesheetImport,
        inlineStylesheetInternal: inlineStylesheetInternal,
        completedInline: completedInline,
        getImageAsDataUrl: getImageAsDataUrl,
        errorText: "",
        foundInlinables: 0,
        initiatedInlines: 0,
        completedInlines: 0,
        stopInlining: false
    };
})();

try {
    var dimmer = document.createElement("div");
    dimmer.id = "SimmetricPageSaverDimmer";
    dimmer.setAttribute("style", "position: fixed; z-index: 9998; top: 0; left: 0; width: 100%; height: 100%; background-color: #fff; opacity: 0.8");
    document.getElementsByTagName("body")[0].appendChild(dimmer);

    var infoPanel = document.createElement("div");
    infoPanel.id = "SimmetricPageSaverInfoPanel";
    infoPanel.setAttribute("style", "position: fixed; z-index: 9999; top: 0; left: 25%; width: 75%; height: 100%; color: #000; text-align: left; font-size: 14pt;");
    document.getElementsByTagName("body")[0].appendChild(infoPanel);

    var inlineableCounter = document.createElement("div");
    inlineableCounter.id = "SimmetricPageSaverInlineableCounter";
    inlineableCounter.setAttribute("style", "position: fixed; z-index: 9999; top: 0; left: 0; width: 100px; height: 50px; color: #000; font-size: 50px; font-weight: bold; padding: 20px; text-align: right; float: left;");
    document.getElementsByTagName("body")[0].appendChild(inlineableCounter);

    var stopButton = document.createElement("button");
    stopButton.id = "SimmetricPageSaverStopButton";
    stopButton.onclick = pageInlineSaver.saveFile;
    stopButton.setAttribute("style", "position: fixed; z-index: 9999; left: 0; bottom: 0; width: 200px; height: 80px; background-color: #aaa; color: 000;");
    stopButton.innerText = "Interrupt and save page now";
    document.getElementsByTagName("body")[0].appendChild(stopButton);

    pageInlineSaver.handleMessage("Inlining page...");

    pageInlineSaver.foundInlinables = 0;

    if (options.timeout > 0) {
        pageInlineSaver.handleMessage("Timeout set to " + options.timeout + " seconds.");
    }

    if (options.addTimestamp) {
        pageInlineSaver.insertTimestamp();
    }
    pageInlineSaver.setBaseLink();
    pageInlineSaver.inlineResources();
}
catch (error) {
    pageInlineSaver.handleError(error);
}