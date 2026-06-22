(function() {
    "use strict";

    class ApiGameplayEvaluator {
        constructor(options) {
            options = options || {};
            this.client = options.client;
        }

        async evaluate(request) {
            var response = await this.client.evaluateGuess(
                request.date,
                request.guess,
                request.rowIndex,
                {
                    mode: request.mode,
                    prevGuesses: request.prevGuesses,
                    returnRemainingCount: request.returnRemainingCount
                }
            );
            return this.normalizeResponse(request, response);
        }

        normalizeResponse(request, response) {
            var EVAL_MAP = { "0": "absent", "1": "present", "2": "correct" };
            var validStatuses = ["FAIL", "IN_PROGRESS", "WIN"];
            var terminal = response && response.game_status !== "IN_PROGRESS";
            var validEvalStr = response && typeof response.evaluation === "string" &&
                /^[012]{5}$/.test(response.evaluation);
            var allCorrect = validEvalStr && response.evaluation === "22222";
            var statusMatchesEvaluation = response && (
                (response.game_status === "WIN" && allCorrect) ||
                (response.game_status === "FAIL" && !allCorrect && response.guess_number === 6) ||
                (response.game_status === "IN_PROGRESS" && !allCorrect && response.guess_number < 6)
            );
            var valid = response &&
                response.date === request.date &&
                response.puzzle_num === request.puzzleNum &&
                response.guess_number === request.rowIndex + 1 &&
                validEvalStr &&
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

            var evaluation = response.evaluation.split("").map(function(c) { return EVAL_MAP[c]; });

            return {
                date: response.date,
                evaluation: evaluation,
                gameStatus: response.game_status,
                puzzleNum: response.puzzle_num,
                rowIndex: response.guess_number,
                solution: response.solution || null,
                source: "api",
                answersRemaining: typeof response.answers_remaining === "number" ? response.answers_remaining : null
            };
        }
    }

    window.LeftWordleApi.gameplay = new ApiGameplayEvaluator({
        client: window.LeftWordleApi.client
    });
    window.LeftWordleApi.ApiGameplayEvaluator = ApiGameplayEvaluator;
})();
