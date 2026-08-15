(function() {
    "use strict";

    class ApiClientError extends Error {
        constructor(message, options) {
            options = options || {};
            super(message);
            this.name = "ApiClientError";
            this.code = options.code || "request_failed";
            this.detail = options.detail || null;
            this.retryable = options.retryable === true;
            this.status = options.status || null;
        }
    }

    class ApiClient {
        constructor(options) {
            options = options || {};
            this.baseUrl = ApiClient.normalizeBaseUrl(options.baseUrl || "");
            this.credentials = options.credentials || "omit";
            this.fetch = options.fetch || window.fetch.bind(window);
            this.timeoutMs = Number(options.timeoutMs) || 3000;

            if (!this.baseUrl) {
                throw new ApiClientError("API base URL is required", { code: "invalid_configuration" });
            }
            if (!["include", "omit", "same-origin"].includes(this.credentials)) {
                throw new ApiClientError("API credentials mode is invalid", { code: "invalid_configuration" });
            }
        }

        static normalizeBaseUrl(value) {
            return String(value || "").trim().replace(/\/+$/, "");
        }

        async health(options) {
            return this.request("/api/v1/health", options);
        }

        async evaluateGuess(date, guess, rowIndex, options) {
            var body = {
                date: date,
                guess: guess,
                row_index: rowIndex,
                mode: (options && options.mode) || "regular",
                prev_guesses: (options && options.prevGuesses) || [],
                return_remaining_count: !!(options && options.returnRemainingCount)
            };
            options = Object.assign({}, options, { body: body, method: "POST" });
            return this.request("/api/v1/game/guess", options);
        }

        async submitDiagnostics(payload, options) {
            options = Object.assign({}, options, { body: payload, method: "POST", timeoutMs: 15000 });
            return this.request("/api/v1/diagnostics", options);
        }

        async puzzleMetadata(date, options) {
            var query = new URLSearchParams({ date: date });
            return this.request("/api/v1/game/puzzle?" + query.toString(), options);
        }

        async fetchAnswer(date, options) {
            var query = new URLSearchParams({ date: date });
            return this.request("/api/v1/game/answer?" + query.toString(), options);
        }

        async fetchRemainingCounts(date, guesses, options) {
            options = Object.assign({}, options, { body: { date: date, guesses: guesses }, method: "POST" });
            return this.request("/api/v1/game/remaining_counts", options);
        }

        async reportGameStart(date, puzzleNum, options) {
            options = Object.assign({}, options, { body: { date: date, puzzle_num: puzzleNum }, method: "POST" });
            return this.request("/api/v1/game/start", options);
        }

        async reportCompletion(date, puzzleNum, mode, gameStatus, guesses, options) {
            var body = {
                date: date,
                puzzle_num: puzzleNum,
                mode: mode,
                game_status: gameStatus,
                guesses: guesses
            };
            options = Object.assign({}, options, { body: body, method: "POST" });
            return this.request("/api/v1/game/complete", options);
        }

        // Live per-guess save of an in-progress (not yet WIN/FAIL) game --
        // same device_id-scoped, login-optional shape as reportCompletion,
        // called after every guess instead of only at the end.
        async reportProgress(date, mode, guesses, options) {
            var body = {
                date: date,
                mode: mode,
                guesses: guesses
            };
            options = Object.assign({}, options, { body: body, method: "POST" });
            return this.request("/api/v1/game/progress", options);
        }

        // -- Passkey auth / server sync (/api/v2) --------------------------

        async registerBegin(payload, options) {
            options = Object.assign({}, options, { body: payload || {}, method: "POST" });
            return this.request("/api/v2/auth/register/begin", options);
        }

        async registerFinish(payload, options) {
            options = Object.assign({}, options, { body: payload, method: "POST" });
            return this.request("/api/v2/auth/register/finish", options);
        }

        async loginBegin(options) {
            options = Object.assign({}, options, { body: {}, method: "POST" });
            return this.request("/api/v2/auth/login/begin", options);
        }

        async loginFinish(payload, options) {
            options = Object.assign({}, options, { body: payload, method: "POST" });
            return this.request("/api/v2/auth/login/finish", options);
        }

        async logout(options) {
            options = Object.assign({}, options, { method: "POST" });
            return this.request("/api/v2/auth/logout", options);
        }

        async deviceLink(delivery, options) {
            options = Object.assign({}, options, { body: { delivery: delivery }, method: "POST" });
            return this.request("/api/v2/auth/device_link", options);
        }

        async patchEmail(email, options) {
            options = Object.assign({}, options, { body: { email: email }, method: "PATCH" });
            return this.request("/api/v2/account/email", options);
        }

        async listPasskeys(options) {
            return this.request("/api/v2/account/passkeys", options);
        }

        async revokePasskey(id, options) {
            options = Object.assign({}, options, { method: "DELETE" });
            return this.request("/api/v2/account/passkeys/" + encodeURIComponent(id), options);
        }

        async requestRecovery(email, options) {
            options = Object.assign({}, options, { body: { email: email }, method: "POST" });
            return this.request("/api/v2/auth/recover", options);
        }

        async getProfile(options) {
            return this.request("/api/v2/profile", options);
        }

        async putPreferences(preferences, options) {
            options = Object.assign({}, options, { body: preferences, method: "PUT" });
            return this.request("/api/v2/profile/preferences", options);
        }

        async putGameState(gameState, options) {
            options = Object.assign({}, options, { body: gameState, method: "PUT" });
            return this.request("/api/v2/profile/game_state", options);
        }

        async postLocalStorageSnapshot(event, localStorage, options) {
            options = Object.assign({}, options, { body: { event: event, local_storage: localStorage }, method: "POST" });
            return this.request("/api/v2/profile/local_storage_snapshot", options);
        }

        async getHistory(options) {
            return this.request("/api/v2/history", options);
        }

        async importHistory(historyEntries, options) {
            options = Object.assign({}, options, { body: { history: historyEntries }, method: "POST" });
            return this.request("/api/v2/history/import", options);
        }

        async adjustStats(statistics, options) {
            options = Object.assign({}, options, { body: statistics, method: "POST" });
            return this.request("/api/v2/stats/adjust", options);
        }

        async request(path, options) {
            options = options || {};
            var controller = new AbortController();
            var timeoutId = setTimeout(function() {
                controller.abort("timeout");
            }, options.timeoutMs || this.timeoutMs);
            var externalSignal = options.signal;
            var abortFromExternalSignal = function() {
                controller.abort("cancelled");
            };

            if (externalSignal) {
                if (externalSignal.aborted) abortFromExternalSignal();
                else externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true });
            }

            try {
                var headers = { Accept: "application/json" };
                if (window.StorageController && window.StorageController.deviceId) {
                    var deviceId = window.StorageController.deviceId.get();
                    if (deviceId) headers["X-Device-Id"] = deviceId;
                }
                if (window.LeftWordleAuth && window.LeftWordleAuth.csrfToken) {
                    headers["X-CSRF-Token"] = window.LeftWordleAuth.csrfToken;
                }
                var body;
                if (options.body !== undefined) {
                    headers["Content-Type"] = "application/json";
                    body = JSON.stringify(options.body);
                }
                var response = await this.fetch(this.baseUrl + path, {
                    body: body,
                    credentials: this.credentials,
                    headers: headers,
                    method: options.method || "GET",
                    signal: controller.signal
                });
                var payload = await this.parseResponse(response);

                if (!response.ok) {
                    throw new ApiClientError(payload.detail || "API request failed", {
                        code: "http_error",
                        detail: payload.detail || null,
                        retryable: response.status >= 500,
                        status: response.status
                    });
                }

                return payload;
            } catch (error) {
                if (error instanceof ApiClientError) throw error;
                if (controller.signal.aborted) {
                    var timedOut = controller.signal.reason === "timeout";
                    throw new ApiClientError(timedOut ? "API request timed out" : "API request was cancelled", {
                        code: timedOut ? "timeout" : "cancelled",
                        retryable: timedOut
                    });
                }
                throw new ApiClientError("API request failed", {
                    code: "network_error",
                    detail: error && error.message ? error.message : null,
                    retryable: true
                });
            } finally {
                clearTimeout(timeoutId);
                if (externalSignal) externalSignal.removeEventListener("abort", abortFromExternalSignal);
            }
        }

        async parseResponse(response) {
            var text = await response.text();
            if (!text) return {};

            try {
                var payload = JSON.parse(text);
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                    throw new Error("Response is not a JSON object");
                }
                return payload;
            } catch (error) {
                throw new ApiClientError("API returned invalid JSON", {
                    code: "invalid_response",
                    status: response.status
                });
            }
        }
    }

    class ApiEventQueue {
        constructor(client, options) {
            options = options || {};
            this.client = client;
            this.flushing = false;
            this.maxJobs = Number(options.maxJobs) || 50;
            this.storageKey = options.storageKey || "leftWordleApiEventQueue";

            if (window.addEventListener) {
                window.addEventListener("online", () => {
                    this.flush();
                });
                if (document.addEventListener) {
                    document.addEventListener("visibilitychange", () => {
                        if (!document.hidden) this.flush();
                    });
                }
                setTimeout(() => this.flush(), 0);
            }
        }

        enqueueGameStart(date, puzzleNum) {
            var jobs = this._readJobs().filter((job) => job.key !== this._gameStartKey(date));
            jobs.push({
                attempts: 0,
                key: this._gameStartKey(date),
                payload: { date: date, puzzle_num: puzzleNum },
                type: "gameStart"
            });
            this._writeJobs(jobs.slice(-this.maxJobs));
            return this.flush();
        }

        async flush() {
            if (this.flushing) return;
            this.flushing = true;
            try {
                var remaining = [];
                var jobs = this._readJobs();
                this._writeJobs([]);

                for (var i = 0; i < jobs.length; i += 1) {
                    var job = jobs[i];
                    try {
                        await this._perform(job);
                    } catch (error) {
                        if (error && error.retryable === false) continue;
                        job.attempts = (Number(job.attempts) || 0) + 1;
                        remaining.push(job);
                    }
                }

                this._writeJobs(remaining.concat(this._readJobs()).slice(-this.maxJobs));
            } finally {
                this.flushing = false;
            }
        }

        _gameStartKey(date) {
            return "gameStart:" + date;
        }

        _perform(job) {
            if (!job || job.type !== "gameStart" || !job.payload) {
                return Promise.resolve();
            }
            return this.client.reportGameStart(job.payload.date, job.payload.puzzle_num);
        }

        _readJobs() {
            try {
                var raw = window.localStorage && window.localStorage.getItem(this.storageKey);
                if (!raw) return [];
                var jobs = JSON.parse(raw);
                return Array.isArray(jobs) ? jobs : [];
            } catch (error) {
                return [];
            }
        }

        _writeJobs(jobs) {
            if (!window.localStorage) return;
            if (!jobs.length) {
                window.localStorage.removeItem(this.storageKey);
                return;
            }
            window.localStorage.setItem(this.storageKey, JSON.stringify(jobs));
        }
    }

    var config = window.LEFT_WORDLE_CONFIG || {};
    var client = new ApiClient({
        baseUrl: config.apiBaseUrl,
        credentials: config.apiCredentials,
        timeoutMs: config.apiRequestTimeoutMs
    });

    window.LeftWordleApi = {
        ApiClient: ApiClient,
        ApiClientError: ApiClientError,
        ApiEventQueue: ApiEventQueue,
        client: client,
        eventQueue: new ApiEventQueue(client)
    };
})();
