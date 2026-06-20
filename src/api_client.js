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
            var prevGuesses = options && options.prevGuesses;
            var body = { date: date, guess: guess, row_index: rowIndex };
            if (prevGuesses !== undefined) {
                body.prev_guesses = prevGuesses;
            }
            options = Object.assign({}, options, { body: body, method: "POST" });
            return this.request("/api/v1/game/guess", options);
        }

        async puzzleMetadata(date, options) {
            var query = new URLSearchParams({ date: date });
            return this.request("/api/v1/game/puzzle?" + query.toString(), options);
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

    var config = window.LEFT_WORDLE_CONFIG || {};
    window.LeftWordleApi = {
        ApiClient: ApiClient,
        ApiClientError: ApiClientError,
        client: new ApiClient({
            baseUrl: config.apiBaseUrl,
            credentials: config.apiCredentials,
            timeoutMs: config.apiRequestTimeoutMs
        })
    };
})();
