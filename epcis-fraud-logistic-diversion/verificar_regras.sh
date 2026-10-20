
#!/usr/bin/env bash

cd "$(dirname "$0")" && npx mocha test/anomalyDetection.test.js --reporter json 2>/dev/null | node test/report.js

