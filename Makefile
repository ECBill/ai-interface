.PHONY: dev frontend test lint typecheck format

# 启动后端 (端口 8000)
dev:
	cd backend && PYTHONPATH=. .venv/bin/uvicorn app.main:app --reload

# 启动前端 (端口 5173)
frontend:
	export PATH="/opt/apps/com.tencent.workbuddy/files/resources/runtime/node/bin:$$PATH" && cd frontend && npm run dev

# 运行后端测试
test:
	PYTHONPATH=backend backend/.venv/bin/pytest -q

lint:
	python3 -m compileall -q backend

typecheck:
	python3 -m compileall -q backend

format:
	python3 -m compileall -q backend
