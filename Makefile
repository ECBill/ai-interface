.PHONY: dev test lint typecheck format

dev:
	cd backend && uvicorn app.main:app --reload

test:
	PYTHONPATH=backend pytest -q

lint:
	python3 -m compileall -q backend

typecheck:
	python3 -m compileall -q backend

format:
	python3 -m compileall -q backend
