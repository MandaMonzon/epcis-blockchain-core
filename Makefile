.PHONY: help test evaluate all network map diagnose clean clean-yes

help:
	@echo "make test       unit tests for the rules"
	@echo "make evaluate   tests + evaluation on the existing dataset + REPORT.md"
	@echo "make all        regenerate the dataset from ARCOS and evaluate (full reproduction)"
	@echo "make network    all + Caliper load test on the Fabric network"
	@echo "make map        which rules fire for each anomaly type"
	@echo "make diagnose   machine state (git, docker, versions)"
	@echo "make clean      list temporary files (deletes nothing); make clean-yes deletes them"

test:
	cd epcis-fraud-logistic-diversion && npx mocha test/anomalyDetection.test.js

evaluate:
	scripts/pipeline.sh

all:
	scripts/pipeline.sh --regenerate

network:
	scripts/pipeline.sh --regenerate --network

map:
	node analysis_scripts/rule_map.js $${DATA:-../epcis-arcos-etl-generator/output}

diagnose:
	scripts/diagnose.sh

clean:
	scripts/pipeline.sh --clean

clean-yes:
	scripts/pipeline.sh --clean --yes
