.PHONY: ajuda testar avaliar tudo rede diagnostico limpar limpar-sim mapa

ajuda:
	@echo "make testar       testes unitarios das regras"
	@echo "make avaliar      testes + avaliacao (dataset ja gerado) + RELATORIO.md"
	@echo "make tudo         regenera o dataset do ARCOS e avalia (reproduz do zero)"
	@echo "make rede         tudo + teste de carga Caliper na rede Fabric"
	@echo "make mapa         mostra quais regras disparam em cada tipo de anomalia"
	@echo "make diagnostico  mostra o estado da maquina (git, docker, versoes)"
	@echo "make limpar       lista arquivos temporarios (nao apaga); make limpar-sim apaga"

testar:
	cd epcis-fraud-logistic-diversion && npx mocha test/anomalyDetection.test.js

avaliar:
	scripts/pipeline.sh

tudo:
	scripts/pipeline.sh --gerar

rede:
	scripts/pipeline.sh --gerar --rede

diagnostico:
	scripts/diagnostico.sh

limpar:
	scripts/pipeline.sh --limpar

limpar-sim:
	scripts/pipeline.sh --limpar --sim

mapa:
	node analysis_scripts/mapa_regras.js $${DADOS:-../epcis-arcos-etl-generator/output}
