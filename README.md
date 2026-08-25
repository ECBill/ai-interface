# AI Interface

面向开发者的大模型 API 调用工作台，首版支持 OpenAI Responses API 和 Anthropic Messages API。

## 开发

1. 复制 `.env.example` 为 `.env`，设置 `APP_ENCRYPTION_KEY`。
2. 安装后端依赖：`pip install -r backend/requirements.txt`。
3. 启动后端：`make dev`。
4. 启动前端：`cd frontend && npm run dev`。
5. 运行测试：`make test`。

完整架构、接口契约和验收标准见 [DESIGN.md](DESIGN.md)。
