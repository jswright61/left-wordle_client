(function() {
    "use strict";

    var config = window.LEFT_WORDLE_CONFIG || {};
    var baseUrl = (config.apiBaseUrl || "").replace(/\/+$/, "");

    function todayIso() {
        var d = new Date();
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        var day = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + day;
    }

    function triggerJsonDownload(data, filename) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function fetchRefArray(path) {
        var response = await fetch(baseUrl + path);
        if (!response.ok) throw new Error("Request failed: " + response.status);
        return response.json();
    }

    class GameDownloads extends HTMLElement {
        connectedCallback() {
            var today = todayIso();
            var container = document.createElement("div");
            container.className = "downloads-container";

            container.appendChild(this._makeSection({
                heading: "Legal Words",
                load: function() { return fetchRefArray("/api/v1/ref/legal_words"); },
                toText: function(data) { return data.join("\n"); },
                filename: "left_wordle_legal_words_" + today + ".json"
            }));

            container.appendChild(this._makeSection({
                heading: "Answer List",
                load: function() { return fetchRefArray("/api/v1/ref/answers"); },
                toText: function(data) { return data.join("\n"); },
                filename: "left_wordle_answers_" + today + ".json"
            }));

            container.appendChild(this._makeSection({
                heading: "Previous Answers",
                load: function() { return fetchRefArray("/api/v1/ref/prev_answers?date=" + today); },
                toText: function(data) {
                    return data.map(function(r) {
                        return r.puzzle_number + "," + r.date + "," + r.word;
                    }).join("\n");
                },
                filename: "left_wordle_previous_answers_" + today + ".json"
            }));

            this.appendChild(container);
        }

        _makeSection(opts) {
            var section = document.createElement("div");
            section.className = "downloads-section";

            var heading = document.createElement("h2");
            heading.className = "downloads-heading";
            heading.textContent = opts.heading;
            section.appendChild(heading);

            var pre = document.createElement("pre");
            pre.className = "downloads-pre";
            pre.textContent = "Loading…";
            section.appendChild(pre);

            var btnRow = document.createElement("div");
            btnRow.className = "downloads-btn-row";

            var jsonBtn = document.createElement("button");
            jsonBtn.className = "downloads-action-button";
            jsonBtn.textContent = "Download as JSON";
            jsonBtn.disabled = true;
            btnRow.appendChild(jsonBtn);
            section.appendChild(btnRow);

            opts.load().then(function(data) {
                pre.textContent = opts.toText(data);
                jsonBtn.disabled = false;
                jsonBtn.addEventListener("click", function() {
                    triggerJsonDownload(data, opts.filename);
                });
            }).catch(function() {
                pre.textContent = "Error loading data.";
            });

            return section;
        }
    }

    customElements.define("game-downloads", GameDownloads);
})();
