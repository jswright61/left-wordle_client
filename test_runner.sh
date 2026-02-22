#!/bin/zsh

mkdir -p tmp

# First test truncates
npm run lint 2> tmp/test_runner.err | tee tmp/test_runner.out

# Subsequent tests append
npm test 2>> tmp/test_runner.err | tee -a tmp/test_runner.out
npm run test:e2e 2>> tmp/test_runner.err | tee -a tmp/test_runner.out
