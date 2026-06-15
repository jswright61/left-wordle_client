(function() {
    "use strict";

    class ApiGameplayEvaluator {
        constructor(options) {
            options = options || {};
            this.client = options.client;
            this.enabled = options.enabled === true;
            this.fallbackEnabled = options.fallbackEnabled === true;
        }

        async evaluate(request, localEvaluate) {
            if (!this.enabled) return this.localResult(localEvaluate, "local");

            try {
                var response = await this.client.evaluateGuess(
                    request.date,
                    request.guess,
                    request.rowIndex
                );
                return this.normalizeResponse(request, response);
            } catch (error) {
                if (!this.fallbackEnabled || !this.isFallbackEligible(error)) throw error;

                console.warn("Left Wordle API gameplay fallback", {
                    code: error && error.code ? error.code : "request_failed",
                    puzzleNum: request.puzzleNum,
                    retryable: !!(error && error.retryable),
                    rowIndex: request.rowIndex,
                    status: error && error.status ? error.status : null
                });
                return this.localResult(localEvaluate, "fallback");
            }
        }

        isFallbackEligible(error) {
            return !!(error && (error.retryable || error.code === "invalid_gameplay_response"));
        }

        localResult(localEvaluate, source) {
            var result = localEvaluate();
            if (result.error) {
                throw new window.LeftWordleApi.ApiClientError(result.error, {
                    code: "invalid_guess",
                    detail: result.error,
                    status: 400
                });
            }
            return Object.assign({ source: source }, result);
        }

        normalizeResponse(request, response) {
            var validEvaluations = ["absent", "correct", "present"];
            var validStatuses = ["FAIL", "IN_PROGRESS", "WIN"];
            var terminal = response && response.game_status !== "IN_PROGRESS";
            var allCorrect = response && Array.isArray(response.evaluation) && response.evaluation.every(function(value) {
                return value === "correct";
            });
            var statusMatchesEvaluation = response && (
                (response.game_status === "WIN" && allCorrect) ||
                (response.game_status === "FAIL" && !allCorrect && response.row_index === 6) ||
                (response.game_status === "IN_PROGRESS" && !allCorrect && response.row_index < 6)
            );
            var valid = response &&
                response.date === request.date &&
                response.puzzle_num === request.puzzleNum &&
                response.row_index === request.rowIndex + 1 &&
                Array.isArray(response.evaluation) &&
                response.evaluation.length === 5 &&
                response.evaluation.every(function(value) { return validEvaluations.includes(value); }) &&
                validStatuses.includes(response.game_status) &&
                statusMatchesEvaluation &&
                ((terminal && typeof response.solution === "string" && /^[a-z]{5}$/.test(response.solution)) ||
                    (!terminal && response.solution == null)) &&
                (response.game_status !== "WIN" || response.solution === request.guess);

            if (!valid) {
                throw new window.LeftWordleApi.ApiClientError("API returned an invalid gameplay response", {
                    code: "invalid_gameplay_response",
                    retryable: true
                });
            }

            return {
                date: response.date,
                evaluation: response.evaluation.slice(),
                gameStatus: response.game_status,
                puzzleNum: response.puzzle_num,
                rowIndex: response.row_index,
                solution: response.solution || null,
                source: "api"
            };
        }
    }

    var config = window.LEFT_WORDLE_CONFIG || {};
    window.LeftWordleApi.gameplay = new ApiGameplayEvaluator({
        client: window.LeftWordleApi.client,
        enabled: config.apiGameplayEnabled,
        fallbackEnabled: config.localGameplayFallbackEnabled
    });
    window.LeftWordleApi.ApiGameplayEvaluator = ApiGameplayEvaluator;
})();
