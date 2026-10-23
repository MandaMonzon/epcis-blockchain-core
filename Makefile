.PHONY: validate audit help test evaluate all network map diagnose clean clean-yes

help:
	@echo "make test       unit tests for the rules"
	@echo "make evaluate   tests + evaluation on the existing dataset + REPORT.md"
	@echo "make all        regenerate the dataset from ARCOS and evaluate (full reproduction)"
	@echo "make network    all + Caliper load test on the Fabric network"
	@echo "make validate   validation suite (oracle, mutation, metamorphic, statistics) -> validation/REPORT.md"
	@echo "make audit     ARCOS data quality audit"
	@echo "make map        which rules fire for each anomaly type"
	@echo "make diagnose   machine state (git, docker, versions)"
	@echo "make clean      list temporary files (deletes nothing); make clean-yes deletes them"

test:
	cd epcis-fraud-logistic-diversion && npx mocha 'test/*.test.js'

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

audit:
	python3 analysis_scripts/audit_arcos.py $${ARCOS_CSV:-../epcis-arcos-etl-generator/output/arcos_clean.csv}

validate:
	python3 -m unittest validation.test_stats validation.test_negative_controls validation.test_oracle validation.test_schema_check
	python3 -m validation.run_validation $(VALIDATE_ARGS)
