(function() {
    "use strict";

    class ApiShadowEvaluator {
        constructor(options) {
            options = options || {};
            this.client = options.client;
            this.enabled = options.enabled === true;
        }

        compare(expected, actual) {
            var mismatches = [];
            if (actual.date !== expected.date) mismatches.push("date");
            if (actual.puzzle_num !== expected.puzzleNum) mismatches.push("puzzle_num");
            if (actual.guess_number !== expected.rowIndex + 1) mismatches.push("guess_number");
            var actualEval = ApiShadowEvaluator.parseEvaluation(actual.evaluation);
            if (!ApiShadowEvaluator.arraysEqual(actualEval, expected.evaluation)) mismatches.push("evaluation");
            if (actual.game_status !== expected.gameStatus) mismatches.push("game_status");

            var expectedSolution = expected.gameStatus === "IN_PROGRESS" ? null : expected.solution;
            if ((actual.solution || null) !== expectedSolution) mismatches.push("solution");
            return mismatches;
        }

        static parseEvaluation(value) {
            var map = { "0": "absent", "1": "present", "2": "correct" };
            if (typeof value !== "string" || !/^[012]{5}$/.test(value)) return null;
            return value.split("").map(function(c) { return map[c]; });
        }

        static arraysEqual(left, right) {
            if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
            return left.every(function(value, index) {
                return value === right[index];
            });
        }

        report(detail) {
            window.dispatchEvent(new CustomEvent("left-wordle-api-shadow-result", { detail: detail }));
            if (detail.type === "mismatch") {
                console.warn("Left Wordle API shadow mismatch", {
                    fields: detail.fields,
                    puzzleNum: detail.puzzleNum,
                    rowIndex: detail.rowIndex
                });
            } else if (detail.type === "error") {
                console.warn("Left Wordle API shadow request failed", {
                    code: detail.code,
                    puzzleNum: detail.puzzleNum,
                    retryable: detail.retryable,
                    rowIndex: detail.rowIndex,
                    status: detail.status
                });
            } else {
                console.debug("Left Wordle API shadow match", {
                    puzzleNum: detail.puzzleNum,
                    rowIndex: detail.rowIndex
                });
            }
        }

        submit(expected) {
            if (!this.enabled || !this.client) return;

            var self = this;
            this.client.evaluateGuess(expected.date, expected.guess, expected.rowIndex).then(function(actual) {
                var fields = self.compare(expected, actual);
                self.report({
                    fields: fields,
                    puzzleNum: expected.puzzleNum,
                    rowIndex: expected.rowIndex,
                    type: fields.length ? "mismatch" : "match"
                });
            }).catch(function(error) {
                self.report({
                    code: error && error.code ? error.code : "request_failed",
                    puzzleNum: expected.puzzleNum,
                    retryable: !!(error && error.retryable),
                    rowIndex: expected.rowIndex,
                    status: error && error.status ? error.status : null,
                    type: "error"
                });
            });
        }
    }

    var config = window.LEFT_WORDLE_CONFIG || {};
    window.LeftWordleApi.shadow = new ApiShadowEvaluator({
        client: window.LeftWordleApi.client,
        enabled: config.apiGameplayShadowMode && !config.apiGameplayEnabled
    });
    window.LeftWordleApi.ApiShadowEvaluator = ApiShadowEvaluator;
})();
