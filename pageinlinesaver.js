var pageInlineSaver = (function () {
    "use strict";
    var errorText;
    var foundInlinables = 0;
    var initiatedInlines = 0;
    var completedInlines = 0;
    var stopInlining = false;
    
    // @author Rob W <http://stackoverflow.com/users/938089/rob-w>
    // Demo: var serialized_html = DOMtoString(document);
    function DOMtoString(document_root) {
        var html = '',
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
                    html += '<![CDATA[' + node.nodeValue + ']]>';
                    break;
                case Node.COMMENT_NODE:
                    html += '<!--' + node.nodeValue + '-->';
                    break;
                case Node.DOCUMENT_TYPE_NODE:
                    // (X)HTML documents are identified by public identifiers
                    html += "<!DOCTYPE " + node.name + (node.publicId ? ' PUBLIC "' + node.publicId + '"' : '') + (!node.publicId && node.systemId ? ' SYSTEM' : '') + (node.systemId ? ' "' + node.systemId + '"' : '') + '>\n';
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
                pageInlineSaver.handleMessage("Timeout reached: saving page with " + (initiatedInlines - completedInlines) + " inlines left unfinished out of " + foundInlinables + " found inlinables");
                this.saveFile();
            }, options.timeout)
        }
        
        //find all <link rel="stylesheet">, <style>, <script src=?> and <img src=> tags
        if (options.inlineCss) {
            var linkTags = findElements("link", function (elm) { return elm.getAttribute("rel") === "stylesheet" });
            pageInlineSaver.increaseFoundInlineables(foundInlinables + linkTags.length);
        }
        if (options.inlineJs) {
            var scriptTags = findElements("script", function (elm) { return elm.hasAttribute("src") });
            pageInlineSaver.increaseFoundInlineables(foundInlinables + scriptTags.length);
        }
        if (options.inlineImg) {
            var imgTags = findElements("img", function (elm) { return elm.hasAttribute("src") && elm.getAttribute("src") !== null });
            pageInlineSaver.increaseFoundInlineables(foundInlinables + imgTags.length);
        }

        pageInlineSaver.handleMessage("Inlining " + foundInlinables + " external resources");
        
        if (options.deepInlineCss) {
            //inline stylesheet internal content
            var styleTags = findElements("style");
            for (let i = 0; i < styleTags.length; i++) {
                inlineStylesheetInternal(styleTags[i].innerText, document.getElementsByTagName("base")[0]);
            }
        }

        if (foundInlinables > 0) {
            try {
                if (options.inlineCss) {
                    for (let i = 0; i < linkTags.length; i++) {
                        //retrieve external file and inline into new <style> tag
                        var url = linkTags[i].getAttribute("href");

                        downloadResource({
                                url: url,
                                resourceDeclaration: linkTags[i]
                            },
                            inlineStylesheet,
                            false);
                    }
                }

                if (options.inlineJs) {
                    for (var i = 0; i < scriptTags.length; i++) {
                        //retrieve external file and inline into new <script> tag without src attribute
                        var url = scriptTags[i].getAttribute("src");

                        downloadResource({
                                url: url,
                                resourceDeclaration: scriptTags[i]
                            },
                            inlineScript,
                            false);
                    }
                }

                if (options.inlineImg) {
                    for (var i = 0; i < imgTags.length; i++) {
                        var url = imgTags[i].getAttribute("src");
                        if (!url.startsWith("data:")) {
                            //retrieve external image and create data URI
                            downloadResource({
                                    url: url,
                                    resourceDeclaration: imgTags[i]
                                },
                                inlineImage,
                                true);
                        } else {
                            completedInline();
                        }
                    }
                }
            }        
            catch(error) {
                pageInlineSaver.handleError(error);
                clearTimeout(timeout);
                saveFile();
            }
        }
        else {
            //nothing left to inline, call saveFile
            clearTimeout(timeout);
            saveFile();
        }
    }

    function inlineScript(srcElement, resourceDeclaration, content, contentType) {
        //surround with CDATA
        content = "//<![CDATA[\n" + content.replace(new RegExp("<\/script>", "gi"), "&lt;/script&gt;") + "\n//]]>";

        //replace src attribute with inlined script
        resourceDeclaration.removeAttribute("src");
        resourceDeclaration.innerHTML = content;

        completedInline();
    }

    function inlineImage(srcElement, resourceDeclaration, content, contentType) {
        //replace src attribute with base64 encoded image
        resourceDeclaration.setAttribute("src", getImageAsDataUrl(content, contentType));

        completedInline();
    }

    function inlineStylesheet(srcElement, resourceDeclaration, content, contentType) {
        //create new element
        var newElement = document.createElement("style");
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
            inlineStylesheetInternal(content, newElement);
        }

        //signal completedInline for stylesheet
        completedInline();
    }

    function inlineStylesheetInternal(content, srcElement) {
        var baseUrl = srcElement.getAttribute("href");
        //search CSS for url() occurrences and inline them. they will be replaced in the page source
        var urlPattern = /url\("?'?([ a-zA-Z0-9:\-\.\\\/_&?=@]+)"?'?\)/gi;
        var match = urlPattern.exec(content);
        while (match) {
            //avoid urls that are already inlined
            if (!match[1].startsWith("data:")) {

                var url = match[1];
                //if relative URL, resolve to absolute based on stylesheet location
                if (!match[1].startsWith("http") &&
                    !match[1].startsWith("/") &&
                    baseUrl != undefined) {
                    url = relativeUrlToAbsolute(baseUrl, url);
                }

                pageInlineSaver.increaseFoundInlineables(foundInlinables++);
                downloadResource({
                        url: url,
                        resourceDeclaration: match[0],
                        srcElement: srcElement
                    },
                    inlineStylesheetImage,
                    true);
            }

            match = urlPattern.exec(content);
        }

        //search CSS for @import declarations and inline these
        var importPattern = /@import\s+"?'?([ a-zA-Z0-9:\-\.\\\/_&?=@]+)"?'?/gi;
        match = importPattern.exec(content);
        while (match) {
            var url = match[1];
            //if relative URL, resolve to absolute based on stylesheet location
            if (!match[1].startsWith("http") &&
                !match[1].startsWith("/") &&
                baseUrl != undefined) {
                url = relativeUrlToAbsolute(baseUrl, url);
            }

            pageInlineSaver.increaseFoundInlineables(foundInlinables++);
            downloadResource({
                    url: url,
                    resourceDeclaration: match[0],
                    srcElement: srcElement
                },
                inlineStylesheetImport,
                false);

            match = urlPattern.exec(content);
        }
    }

    function inlineStylesheetImage(srcElement, originalUrl, content, contentType) {
        srcElement.innerHTML = srcElement.innerHTML.replace(originalUrl, function () { return "url(" + getImageAsDataUrl(content, contentType) + ")"; })
        completedInline();
    }

    function inlineStylesheetImport(srcElement, importDeclaration, content, contentType) {
        srcElement.innerHTML = srcElement.innerHTML.replace(importDeclaration, function () { return content; });
        inlineStylesheetInternal(srcElement.innerHTML, srcElement);
        completedInline();
    }

    function getImageAsDataUrl(content, contentType) {

        if (stopInlining) return;

        try {
            var chunkSize = 800;
            if (content.byteLength > chunkSize) {
                var uintArray = new Uint8Array(content);
                var converted = [];
                for (var i=0; i < uintArray.length; i += chunkSize) {
                    converted.push(String.fromCharCode.apply(null, uintArray.subarray(i, i + chunkSize)));
                }

                var imgData = btoa(converted.join(""));
                console.debug(imgData.length);
                return "data:" + contentType + ";base64," + imgData;
            }
            else {
                return "data:" + contentType + ";base64," + btoa(String.fromCharCode.apply(null, new Uint8Array(content)));
            }
        }
        catch (error) {
            pageInlineSaver.handleError(error);
            saveFile();
        }
    }

    //find elements by name and filter by given expression
    function findElements(tagName, filter) {
        var elements = document.getElementsByTagName(tagName);
        var filteredElements = [];
        for (var i = 0; i < elements.length; i++) {
            if (filter == null || (typeof (filter) == 'function' && filter(elements[i]))) {
                filteredElements.push(elements[i]);
            }
        }

        return filteredElements;
    }

    function downloadResource(config, callback, isBinary) {
        initiatedInlines++;
        console.debug("Inlining " + config.url)

        try {
            var xhr = new XMLHttpRequest();
            xhr.responseType = isBinary ? "arraybuffer" : "text";
            xhr.onreadystatechange = function () {
                if (xhr.readyState == 4 && xhr.status == 200) {
                    var contentType = this.getResponseHeader("content-type");
                    callback(
                        config.srcElement,
                        config.resourceDeclaration,
                        xhr.response,
                        contentType);
                }
            };
            xhr.open("GET", config.url);
            xhr.send();
        }
        catch (error) {
            pageInlineSaver.handleError(error);
            completedInline();
        }
    }

    //@author Bergi <http://stackoverflow.com/users/1048572/bergi>
    function relativeUrlToAbsolute(base, relativeUrl) {
        var stack = base.split("/"),
            parts = relativeUrl.split("/");
        stack.pop(); // remove current file name (or empty string)
        // (omit if "base" is the current folder without trailing slash)
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] == ".")
                continue;
            if (parts[i] == "..")
                stack.pop();
            else
                stack.push(parts[i]);
        }
        return stack.join("/");
    }

    function completedInline() {
        completedInlines++;
        if (foundInlinables == initiatedInlines && initiatedInlines == completedInlines) {
            saveFile();
        }
    }

    function saveFile() {
        if (!stopInlining) {
            stopInlining = true;

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
        if (document.getElementsByTagName("base").length == 0) {
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
        document.getElementById("SimmetricPageSaverInfoPanel").innerHTML += "<span style=\"color: #a00;\">An error occurred! Press Control+Shift+J to see what it is.</span><br>";
        console.error(error);
    }

    function handleMessage(message) {
        document.getElementById("SimmetricPageSaverInfoPanel").innerHTML += message + "<br>";
    }

    function increaseFoundInlineables(newValue) {
        document.getElementById("SimmetricPageSaverInlineableCounter").innerText = newValue;
        this.foundInlinables = newValue;
    }

    return {
        insertTimestamp: insertTimestamp,
        setBaseLink: setBaseLink,
        inlineResources: inlineResources,
        saveFile: saveFile,
        DOMtoString: DOMtoString,
        handleError: handleError,
        handleMessage: handleMessage,
        increaseFoundInlineables: increaseFoundInlineables
    };
})();

try {
    var dimmer = document.createElement("div");
    dimmer.id = "SimmetricPageSaverDimmer";
    dimmer.setAttribute("style", "position: fixed; z-index: 9998; top: 0; left: 0; width: 100%; height: 100%; background-color: #000; opacity: 0.8");
    document.getElementsByTagName("body")[0].appendChild(dimmer);

    var infoPanel = document.createElement("div")
    infoPanel.id = "SimmetricPageSaverInfoPanel";
    infoPanel.setAttribute("style", "position: fixed; z-index: 9999; top: 0; left: 25%; width: 75%; height: 100%; color: #fff; text-align: left; font-size: 14pt;");
    document.getElementsByTagName("body")[0].appendChild(infoPanel);

    var inlineableCounter = document.createElement("div");
    inlineableCounter.id = "SimmetricPageSaverInlineableCounter";
    inlineableCounter.setAttribute("style", "position: fixed; z-index: 9999; top: 0; left: 0; width: 100px; height: 50px; background-color: #fff; color: #000; font-size: 50px; font-weight: bold; padding: 20px; text-align: right;");
    document.getElementsByTagName("body")[0].appendChild(inlineableCounter);

    var stopButton = document.createElement("button");
    stopButton.id = "SimmetricPageSaverStopButton";
    stopButton.onclick = pageInlineSaver.saveFile;
    stopButton.setAttribute("style", "position: fixed; z-index: 9999; left: 0; bottom: 0; width: 200px; height: 80px; background-color: #a66; color: $fff;");
    stopButton.innerText = "Interrupt and save page now";
    document.getElementsByTagName("body")[0].appendChild(stopButton);

    pageInlineSaver.handleMessage("Inlining page...");

    if (options.timeout > 0) {
        pageInlineSaver.handleMessage("Timeout set to " + (options.timeout / 1000) + " seconds.");
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