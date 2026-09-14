# AI Interface V4 设计文档

- 文档状态：Draft
- 版本：v4.0
- 日期：2026-09-14
- 目标读者：前后端、测试、安全与部署相关人员
- 基线：V3 已实现以对话为核心的个人 AI 客户端（三栏布局、SSE 流式、服务端上下文构建、滑动续期、偏好持久化、性能优化与动画增强）

---

## 1. V4 定位与背景

### 1.1 产品定位

V4 将 AI Interface 从"功能可用"推进到"安全可信、质量可证"。

V3 完成了产品形态的重构——标准对话体验、刷新零丢失、流式渲染、性能优化——基本功能已无问题。但在开发过程中暴露出两个系统性短板：

1. **安全加固不足**：V3 聚焦功能与体验，安全层面仅继承了 V1/V2 的基础措施（Argon2 密码哈希、AES-GCM 凭据加密、HttpOnly Cookie），但缺乏系统性的安全审计与加固。对三端（后端 API、前端客户端、测试覆盖）的全面审计发现 **26 项安全漏洞**，其中 HIGH 级别 7 项、MEDIUM 级别 13 项、LOW 级别 6 项。
2. **测试覆盖严重不足**：当前仅 9 个测试（4 个 auth、1 个 health、4 个 adapter），8+ 个关键端点零测试覆盖，前端零测试。无法对后续迭代提供回归保障。

V4 的唯一主题是：**全面修复安全漏洞，建立系统化测试体系，使产品具备上线级别的安全性与质量保障。**

### 1.2 V3 遗留问题复盘（V4 直接动因）

以下问题在 V3 开发中被识别但未解决，V4 必须逐条修复：

| # | 问题 | 根因诊断 | V4 对策 |
| --- | --- | --- | --- |
| S1 | Cookie `Secure` 默认为 `False`，生产环境会话令牌可经 HTTP 明文传输 | `config.py` 中 `cookie_secure: bool = False` 硬编码默认值，未根据环境区分 | 生产环境强制 `Secure=True`，开发环境允许 `False`（§4.1） |
| S2 | 全部 API 端点无限流，可被暴力破解或 DoS | 未引入任何限流中间件 | 引入基于内存令牌桶的按用户限流（§4.2） |
| S3 | 无 CSRF 防护，仅依赖 `SameSite=Lax` | `SameSite=Lax` 阻止跨站 POST 但不阻止顶级导航 GET；状态变更端点缺乏双重确认 | 引入 CSRF Token 机制 + 自定义请求头校验（§4.3） |
| S4 | 无请求体大小限制，可发送超大 payload 导致 OOM | FastAPI 默认不限制请求体大小；Pydantic `max_length` 在解析阶段才校验，大 payload 在解析前已读入内存 | 引入请求体大小中间件 + 流式解析前置拦截（§4.4） |
| S5 | 会话令牌哈希使用 SHA-256 无盐，彩虹表可逆 | `auth.py` 中 `hashlib.sha256(token.encode()).hexdigest()`，与密码的 Argon2 方案不对称 | 改用 HMAC-SHA256 + 服务端密钥（§4.5） |
| S6 | 错误消息泄露邮箱是否存在（用户枚举攻击） | 登录失败返回"用户不存在"或"密码错误"区分两种情况 | 统一返回模糊错误消息 + 引入登录延迟防时序攻击（§4.6） |
| S7 | 默认加密密钥硬编码在源码中 | `config.py` 中 `DEFAULT_ENCRYPTION_KEY` 常量，`.env` 未设置时回退到默认值 | 启动时强制校验加密密钥非默认值，否则拒绝启动（§4.7） |
| S8 | 无安全响应头（CSP、HSTS、X-Frame-Options 等） | `main.py` 未添加安全头中间件 | 引入安全头中间件，统一注入标准安全头（§4.8） |
| S9 | 无安全事件日志 | 全局无安全相关日志记录 | 引入结构化安全审计日志（§4.9） |
| S10 | 前端 fetch 无超时，请求可无限挂起 | `client.ts` 中所有 `fetch` 调用未设置 `AbortController` 超时 | 封装统一请求超时 + SSE 空闲超时（§5.1） |
| S11 | 前端组件卸载不中止活跃 SSE 流，产生孤儿连接 | `MessageFlow.tsx`、`InputArea.tsx` 的 `useEffect` cleanup 未调用 `abort()` | 组件卸载时统一中止所有活跃 AbortController（§5.2） |
| S12 | 前端输入框无长度限制，可粘贴超大文本导致 OOM | `InputArea.tsx` textarea 无 `maxLength`，无粘贴事件处理 | 添加客户端长度限制 + 粘贴截断（§5.3） |
| T1 | 8+ 关键端点零测试覆盖 | V3 开发以功能交付为导向，测试未同步跟进 | 端点级集成测试全覆盖（§6.2） |
| T2 | 前端零测试 | 未引入任何前端测试框架与依赖 | 引入 Vitest + Testing Library，覆盖核心组件与 store（§6.3） |
| T3 | 无安全测试（越权、注入、CSRF 等） | 测试仅覆盖正常路径 | 新增安全测试套件（§6.4） |
| T4 | 无 SSE 流式集成测试 | SSE 测试需要特殊 fixture 与 mock | 引入 SSE 测试 fixture 与流式断言（§6.5） |

### 1.3 目标

1. 修复全部 7 项 HIGH 级别安全漏洞，消除生产环境可利用攻击面。
2. 修复全部 13 项 MEDIUM 级别安全漏洞，达到安全扫描工具零告警。
3. 后端测试覆盖率 ≥ 85%（行覆盖），关键端点 100% 覆盖。
4. 前端引入测试框架，核心 store 与组件测试覆盖率 ≥ 70%。
5. 安全测试套件覆盖 OWASP Top 10 相关场景。
6. 全部测试通过 CI 可重复运行，耗时 < 60s（后端）+ < 30s（前端）。

### 1.4 非目标

V4 暂不实现：

- 多用户/多租户安全隔离（仍为单用户个人工具）。
- 安全合规认证（SOC2、ISO27001 等）。
- 渗透测试外包或 Bug Bounty 计划。
- 前端 E2E 测试（Playwright/Cypress）——列入 V5，V4 聚焦单元 + 集成层。
- 性能压测与基准化——V4 仅补充安全相关的性能边界测试。

---

## 2. 核心原则：安全优先、测试驱动

V4 所有设计决策遵循以下优先级排序，冲突时序号小者优先：

1. **安全不可妥协**：任何功能便利不得以降低安全等级为代价。HIGH 级漏洞必须在 Phase 1 全部修复，不得带病进入后续阶段。
2. **测试先于信任**：任何安全修复或功能变更必须有对应测试证明其有效性。无测试的修复视为未完成。
3. **纵深防御**：安全措施不依赖单一防线。前端校验 + 后端校验 + 中间件拦截，三层独立，任一层失效不导致漏洞。
4. **最小权限**：默认拒绝，显式允许。新增的任何中间件、日志、监控不得接触用户明文数据或凭据。
5. **可观测性**：安全事件必须可追溯。所有认证、授权、限流、异常事件产生结构化日志，便于事后审计。

---

## 3. 总体架构变化

```text
React SPA (三栏布局)
  |
  | JSON / SSE (HttpOnly Session Cookie + CSRF Token Header)
  v
FastAPI API (/api/v3)
  +-- SecurityMiddlewareStack        # V4 新增：安全头 + 请求体大小限制
  +-- RateLimitMiddleware            # V4 新增：按用户令牌桶限流
  +-- CSRFMiddleware                 # V4 新增：CSRF Token 校验
  +-- Auth & Session                 # V4 加固：HMAC 令牌哈希 + 模糊错误 + 安全日志
  +-- Conversation Service           # V4 加固：请求体大小 + 所有权校验
  +-- Context Builder                # 沿用
  +-- Invocation Orchestrator        # 沿用
  +-- Provider Registry              # 沿用
  +-- Secret Service                 # V4 加固：密钥启动校验
  +-- Preference Service             # 沿用
  +-- SecurityAuditLogger            # V4 新增：结构化安全事件日志
  +-- SQLite (dev) / PostgreSQL (prod)
  +--> Provider APIs and gateways
```

### 3.1 架构原则

- 安全中间件栈在最外层，先于路由匹配执行，确保无端点绕过。
- 限流粒度为"按用户 + 按端点类别"，不同类别独立配额（认证类、消息发送类、常规读写类）。
- CSRF 防护采用双重提交 Cookie 模式：服务端下发 CSRF Cookie + 前端读取后放入自定义请求头 `X-CSRF-Token`，服务端比对两者一致。
- 安全审计日志与业务日志分离，写入独立文件 `logs/security.log`，包含时间戳、事件类型、用户 ID（脱敏）、IP、详情。
- 前端所有网络请求经过统一封装的 `apiFetch`，内置超时、CSRF 注入、401 处理、重试逻辑。

---

## 4. 后端安全加固方案

### 4.1 Cookie Secure 标志（修复 S1）

**当前问题**：`config.py` 中 `cookie_secure: bool = False`，生产环境会话 Cookie 可经 HTTP 明文传输，中间人可截获会话令牌。

**修复方案**：

```python
# config.py
class Settings(BaseSettings):
    cookie_secure: bool = Field(
        default_factory=lambda: os.getenv("APP_ENV") == "production"
    )
    cookie_samesite: str = "lax"  # 生产环境可升级为 strict
```

- 开发环境（`APP_ENV != production`）：`Secure=False`，允许 HTTP 本地调试。
- 生产环境（`APP_ENV == production`）：`Secure=True`，强制 HTTPS。
- 启动时若 `APP_ENV == production` 且 `cookie_secure` 为 `False`，打印 WARNING 日志。

**验收**：生产环境 Cookie 头包含 `Secure` 标志；HTTP 请求不携带会话 Cookie。

### 4.2 限流中间件（修复 S2）

**当前问题**：全部 API 端点无限流，可被暴力破解登录、刷消息发送、DoS。

**修复方案**：引入基于内存令牌桶的限流中间件，按用户 + 端点类别独立配额：

| 类别 | 端点 | 配额 | 窗口 |
| --- | --- | --- | --- |
| auth | `/auth/login`, `/auth/register` | 5 次 | 1 分钟 |
| message | `/conversations/*/messages` (POST) | 30 次 | 1 分钟 |
| write | `/conversations`, `/providers/*` (POST/PUT/PATCH/DELETE) | 60 次 | 1 分钟 |
| read | 其他 GET | 120 次 | 1 分钟 |
| sse | `/conversations/*/messages` (SSE) | 10 次 | 1 分钟 |

```python
# middleware/rate_limit.py
class RateLimitMiddleware(BaseHTTPMiddleware):
    """按用户 + 端点类别的令牌桶限流。"""

    async def dispatch(self, request, call_next):
        bucket = self._get_bucket(request)  # (user_id or IP, category)
        if not bucket.allow():
            return JSONResponse(
                status_code=429,
                content={"error": {"code": "RATE_LIMITED", "message": "请求过于频繁，请稍后再试"}},
                headers={"Retry-After": str(bucket.retry_after())}
            )
        return await call_next(request)
```

- 未认证请求按 IP 限流（防匿名 DoS）。
- 认证请求按 `user_id` 限流。
- 令牌桶容量 = 配额，补充速率 = 配额 / 窗口。
- 429 响应包含 `Retry-After` 头。
- 限流命中时记录安全日志（§4.9）。

**验收**：超过配额的请求返回 429 + `Retry-After`；窗口恢复后请求正常通过。

### 4.3 CSRF 防护（修复 S3）

**当前问题**：仅依赖 `SameSite=Lax`，不阻止顶级导航 GET 请求携带 Cookie，状态变更端点可被 CSRF 攻击。

**修复方案**：采用双重提交 Cookie 模式：

1. 登录成功时，服务端额外下发 `csrf_token` Cookie（非 HttpOnly，前端可读取），值为 `secrets.token_urlsafe(32)`。
2. 前端读取 `csrf_token` Cookie，在所有非 GET 请求中添加 `X-CSRF-Token` 请求头。
3. `CSRFMiddleware` 对所有非 GET 请求校验：`Cookie[csrf_token] == Header[X-CSRF-Token]`，不匹配返回 403。
4. SSE 请求（GET 方法）不受 CSRF 中间件约束，但 SSE 端点额外校验 `Accept: text/event-stream` 头，防止跨站 SSE 劫持。

```python
# middleware/csrf.py
class CSRFMiddleware(BaseHTTPMiddleware):
    EXEMPT_METHODS = {"GET", "HEAD", "OPTIONS"}

    async def dispatch(self, request, call_next):
        if request.method in self.EXEMPT_METHODS:
            return await call_next(request)
        cookie_token = request.cookies.get("csrf_token")
        header_token = request.headers.get("X-CSRF-Token")
        if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
            return JSONResponse(status_code=403, content={"error": {"code": "CSRF_INVALID", "message": "CSRF 校验失败"}})
        return await call_next(request)
```

**验收**：无 `X-CSRF-Token` 头的 POST 请求返回 403；Token 不匹配返回 403；正常请求通过。

### 4.4 请求体大小限制（修复 S4）

**当前问题**：无请求体大小限制，可发送超大 JSON payload 导致内存耗尽。Pydantic `max_length` 在解析阶段才校验，大 payload 在校验前已读入内存。

**修复方案**：引入请求体大小限制中间件，在读取 body 之前拦截：

```python
# middleware/body_size_limit.py
class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    MAX_BODY_SIZE = 1024 * 1024  # 1MB，与 V3 spec §10.3 一致

    async def dispatch(self, request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > self.MAX_BODY_SIZE:
            return JSONResponse(status_code=413, content={"error": {"code": "PAYLOAD_TOO_LARGE", "message": "请求体过大"}})
        return await call_next(request)
```

- 默认上限 1MB（与 V3 spec §10.3 上下文请求体上限一致）。
- `Content-Length` 头缺失时，流式读取 body 并在超过上限时中断。
- 413 响应使用统一错误格式。

**验收**：`Content-Length > 1MB` 的请求返回 413；正常大小请求通过。

### 4.5 会话令牌哈希加固（修复 S5）

**当前问题**：会话令牌使用 `hashlib.sha256(token.encode()).hexdigest()` 无盐哈希，彩虹表可逆。密码使用 Argon2 正确，但令牌哈希方案不对称。

**修复方案**：改用 HMAC-SHA256 + 服务端密钥：

```python
# core/auth_utils.py
import hmac, hashlib

def hash_session_token(token: str, secret: str) -> str:
    """HMAC-SHA256 哈希会话令牌，使用服务端密钥作为 HMAC 密钥。"""
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()

def verify_session_token(token: str, stored_hash: str, secret: str) -> bool:
    """恒定时间比较，防时序攻击。"""
    computed = hash_session_token(token, secret)
    return hmac.compare_digest(computed, stored_hash)
```

- HMAC 密钥复用 `APP_ENCRYPTION_KEY`（已通过启动校验确保非默认值）。
- 使用 `hmac.compare_digest` 做恒定时间比较，防时序攻击。
- 数据库迁移：现有 `SessionRecord.token_hash` 列保持兼容，新会话使用 HMAC 哈希；旧会话在下次请求时自然过期后替换。

**验收**：相同令牌 + 不同密钥产生不同哈希；`verify_session_token` 使用恒定时间比较。

### 4.6 登录错误模糊化 + 防时序攻击（修复 S6）

**当前问题**：登录失败时区分"用户不存在"和"密码错误"，攻击者可枚举有效邮箱。

**修复方案**：

1. 统一错误消息：无论用户不存在还是密码错误，均返回 `{"error": {"code": "AUTH_INVALID_CREDENTIALS", "message": "邮箱或密码错误"}}`。
2. 防时序攻击：用户不存在时执行一次 dummy Argon2 verify（使用预生成的 dummy hash），确保响应时间与正常登录失败一致。

```python
# api/auth.py
DUMMY_PASSWORD_HASH = argon2.hash("dummy_password_for_timing_equalization")

async def login(request, credentials, db):
    user = db.query(User).filter(User.email == credentials.email).first()
    if user:
        valid = argon2.verify(credentials.password, user.password_hash)
    else:
        argon2.verify(credentials.password, DUMMY_PASSWORD_HASH)  # dummy verify
        valid = False
    if not valid:
        log_security_event("login_failed", email=credentials.email, ip=request.client.host)
        raise HTTPException(status_code=401, detail={"code": "AUTH_INVALID_CREDENTIALS", "message": "邮箱或密码错误"})
```

**验收**：不存在的邮箱与错误密码返回相同错误码与消息；响应时间差异 < 50ms。

### 4.7 加密密钥启动校验（修复 S7）

**当前问题**：`config.py` 中硬编码 `DEFAULT_ENCRYPTION_KEY`，`.env` 未设置时回退到默认值，攻击者知道默认密钥可解密所有 API Key。

**修复方案**：

```python
# config.py
DEFAULT_ENCRYPTION_KEY = "DO_NOT_USE_IN_PRODUCTION"  # 占位符，非有效密钥

class Settings(BaseSettings):
    app_encryption_key: str = Field(default="")

    def validate_encryption_key(self):
        if not self.app_encryption_key:
            raise ValueError("APP_ENCRYPTION_KEY 未设置，拒绝启动")
        if self.app_encryption_key == DEFAULT_ENCRYPTION_KEY:
            raise ValueError("APP_ENCRYPTION_KEY 使用了默认值，拒绝启动")
        if len(self.app_encryption_key) < 32:
            raise ValueError("APP_ENCRYPTION_KEY 长度不足 32 字符")
```

- 启动时调用 `settings.validate_encryption_key()`，校验失败则 `sys.exit(1)`。
- 开发环境也强制要求设置密钥（`.env` 文件已有有效密钥）。
- 移除源码中的有效默认密钥常量。

**验收**：未设置 `APP_ENCRYPTION_KEY` 时启动失败并打印明确错误；设置有效密钥后正常启动。

### 4.8 安全响应头（修复 S8）

**当前问题**：`main.py` 未设置任何安全响应头，浏览器缺少防护指令。

**修复方案**：引入安全头中间件，对所有响应注入标准安全头：

```python
# middleware/security_headers.py
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    HEADERS = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",  # 仅 HTTPS
        "Content-Security-Policy": (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "font-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'"
        ),
    }
```

- `Strict-Transport-Security` 仅在 HTTPS 请求中注入（HTTP 注入无意义且可能有害）。
- CSP 策略允许 `'unsafe-inline'` 样式（React 内联样式需要），但脚本严格限制为 `'self'`。
- 前端 `index.html` 添加对应的 CSP `<meta>` 标签作为额外防线。

**验收**：响应头包含全部安全头；CSP 策略阻止外部脚本加载。

### 4.9 安全审计日志（修复 S9）

**当前问题**：无安全事件日志，安全 incident 不可追溯。

**修复方案**：引入结构化安全审计日志，独立于业务日志：

```python
# core/security_log.py
import logging, json, time

security_logger = logging.getLogger("security")
security_logger.setLevel(logging.INFO)
handler = logging.FileHandler("logs/security.log")
handler.setFormatter(logging.Formatter("%(message)s"))
security_logger.addHandler(handler)

def log_security_event(event_type: str, **fields):
    """记录安全事件，自动脱敏敏感字段。"""
    record = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "event": event_type,
        **fields,
    }
    # 脱敏：邮箱只保留前 2 字符 + 域名
    if "email" in record:
        email = record["email"]
        local, _, domain = email.partition("@")
        record["email"] = f"{local[:2]}***@{domain}"
    security_logger.info(json.dumps(record, ensure_ascii=False))
```

**记录的事件类型**：

| 事件 | 触发条件 | 记录字段 |
| --- | --- | --- |
| `login_success` | 登录成功 | user_id, ip, user_agent |
| `login_failed` | 登录失败 | email(脱敏), ip, reason |
| `register_success` | 注册成功 | user_id, ip |
| `register_failed` | 注册失败 | email(脱敏), ip, reason |
| `logout` | 登出 | user_id, ip |
| `rate_limited` | 限流命中 | identifier, category, ip |
| `csrf_invalid` | CSRF 校验失败 | ip, path |
| `auth_required` | 未认证访问受保护端点 | ip, path |
| `ownership_violation` | 越权访问 | user_id, resource_id, resource_type |
| `session_expired` | 会话过期 | user_id |
| `session_refreshed` | 滑动续期 | user_id |

- 日志文件权限 `0600`，仅运行用户可读写。
- 日志不记录任何明文密码、令牌、API Key。
- 邮箱字段自动脱敏（前 2 字符 + `***` + 域名）。

**验收**：安全事件触发时 `logs/security.log` 中有对应 JSON 记录；日志中无明文敏感数据。

### 4.10 其他后端加固

#### 4.10.1 健康检查端点（修复 S10-LOW）

- `GET /healthz` 保持无认证（K8s/负载均衡器需要），但限流为 60 次/分钟（按 IP），防止被刷。
- 健康检查响应不包含任何系统敏感信息（仅 `{"status": "ok"}`）。

#### 4.10.2 环境变量校验（修复 S11-LOW）

- 启动时校验所有必需环境变量：`APP_ENCRYPTION_KEY`、`DATABASE_URL`。
- 可选变量提供合理默认值并记录 INFO 日志：`APP_ENV`（默认 `development`）、`CORS_ORIGINS`（默认 `http://localhost:5173`）。
- 校验失败时打印明确错误信息并 `sys.exit(1)`。

#### 4.10.3 数据库文件权限（修复 S12-LOW）

- SQLite 数据库文件创建后立即 `os.chmod(path, 0o600)`。
- 启动时检查现有数据库文件权限，若权限过宽则自动收紧并记录 WARNING。

---

## 5. 前端安全加固方案

### 5.1 请求超时与 SSE 空闲超时（修复 S10）

**当前问题**：`client.ts` 中所有 `fetch` 调用无超时，请求可无限挂起；SSE 读取无空闲超时，上游静默断开后前端不感知。

**修复方案**：封装统一 `apiFetch`，内置超时：

```typescript
// api/client.ts
const DEFAULT_TIMEOUT = 30_000;      // 常规请求 30s
const SSE_IDLE_TIMEOUT = 60_000;     // SSE 空闲 60s 无事件则断开
const SSE_FIRST_EVENT_TIMEOUT = 20_000; // SSE 首事件 20s 超时（V3 spec §4.5）

async function apiFetch(url: string, options: RequestInit = {}, timeout = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}
```

- 常规 JSON 请求：30s 超时，超时后 abort 并抛出 `RequestTimeoutError`。
- SSE 流：首事件 20s 超时（与 V3 spec §4.5 一致），后续空闲 60s 超时。
- 超时后自动 abort SSE 连接，触发后端取消上游请求。
- 超时错误在 UI 中展示为"请求超时，请重试"。

**验收**：请求超过 30s 自动中断并显示超时提示；SSE 60s 无事件自动断开。

### 5.2 组件卸载时中止活跃流（修复 S11）

**当前问题**：`MessageFlow.tsx`、`InputArea.tsx` 的 `useEffect` cleanup 未调用 `abort()`，组件卸载后 SSE 流继续运行，产生孤儿连接与内存泄漏。

**修复方案**：

```typescript
// stores/conversationStore.ts
// 维护一个 AbortController 池，按 conversationId 索引
const activeStreams = new Map<string, AbortController>();

function startStream(conversationId: string): AbortController {
  // 如果已有活跃流，先中止
  const existing = activeStreams.get(conversationId);
  if (existing) existing.abort();
  // 创建新控制器
  const controller = new AbortController();
  activeStreams.set(conversationId, controller);
  return controller;
}

function stopStream(conversationId: string) {
  const controller = activeStreams.get(conversationId);
  if (controller) {
    controller.abort();
    activeStreams.delete(conversationId);
  }
}

function stopAllStreams() {
  activeStreams.forEach(c => c.abort());
  activeStreams.clear();
}
```

- `MessageFlow.tsx` 的 `useEffect` cleanup 调用 `stopStream(conversationId)`。
- `App.tsx` 的登出逻辑调用 `stopAllStreams()`。
- `conversationStore` 的 `sendMessage` 在发起新流前中止同会话的旧流（修复 S7-MEDIUM 竞态）。

**验收**：组件卸载后 Network 面板无活跃 SSE 连接；登出后无孤儿连接。

### 5.3 输入长度限制与粘贴处理（修复 S12）

**当前问题**：`InputArea.tsx` textarea 无 `maxLength`，无粘贴事件处理，可粘贴超大文本导致浏览器卡顿或后端 OOM。

**修复方案**：

```typescript
// components/InputArea.tsx
const MAX_INPUT_LENGTH = 50_000; // 50K 字符，低于后端 100K 上限，留余量

function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
  const pasted = e.clipboardData.getData("text");
  const current = e.currentTarget.value;
  const selectionLength = current.slice(
    e.currentTarget.selectionStart,
    e.currentTarget.selectionEnd
  ).length;
  const remaining = MAX_INPUT_LENGTH - current.length + selectionLength;
  if (pasted.length > remaining) {
    e.preventDefault();
    const truncated = pasted.slice(0, remaining);
    document.execCommand("insertText", false, truncated);
    // 显示提示
    setPasteWarning(`已截断粘贴内容（超出 ${pasted.length - remaining} 字符）`);
    setTimeout(() => setPasteWarning(null), 3000);
  }
}
```

- textarea 添加 `maxLength={50000}`。
- 粘贴事件处理：超长内容截断并提示用户。
- 输入区底部显示字符计数 `当前长度 / 50000`，超过 80% 时变色提示。
- `Sidebar.tsx` 重命名输入限制 200 字符（与后端 `title` max_length 一致）。
- `SettingsPanel.tsx` 系统提示词限制 20,000 字符（与后端 `system` max_length 一致）。

**验收**：粘贴 100K 字符时截断为 50K 并显示提示；字符计数实时更新。

### 5.4 401 处理与登出清理（修复 S4-MEDIUM, S5-MEDIUM）

**当前问题**：401 响应未优雅处理，直接抛错；登出不清理 conversation/provider/preference store，导致数据残留。

**修复方案**：

```typescript
// api/client.ts
async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, options);
  if (response.status === 401) {
    // 触发全局登出
    useAuthStore.getState().handleSessionExpired();
    throw new SessionExpiredError("会话已过期，请重新登录");
  }
  return response;
}

// stores/authStore.ts
function handleSessionExpired() {
  // 中止所有活跃流
  stopAllStreams();
  // 清理全部 store
  useConversationStore.getState().reset();
  useProviderStore.getState().reset();
  usePreferenceStore.getState().reset();
  // 清理认证状态
  set({ user: null, isAuthenticated: false });
  // 清理 debounce timer
  if (preferenceDebounceTimer) clearTimeout(preferenceDebounceTimer);
}

function logout() {
  // 调用后端登出
  apiFetch("/api/v3/auth/logout", { method: "POST" }).catch(() => {});
  // 本地清理（同 handleSessionExpired）
  handleSessionExpired();
}
```

- 401 响应统一触发 `handleSessionExpired`，清理全部状态并跳转登录页。
- 登出时清理全部 store（conversation、provider、preference），不留残留数据。
- `preferenceStore` 的 debounce timer 在登出时清除。

**验收**：会话过期后自动跳转登录页且无残留数据；登出后全部 store 重置为初始值。

### 5.5 竞态条件修复（修复 S7-MEDIUM, S8-MEDIUM）

**当前问题**：
- `conversationStore.sendMessage` 并发调用时，旧 AbortController 被孤立，产生多个并行 SSE 流。
- 快速 `selectConversation` 切换时，旧会话消息列表可能覆盖新会话。

**修复方案**：

```typescript
// stores/conversationStore.ts
async function sendMessage(conversationId: string, content: string) {
  // 中止同会话的旧流
  stopStream(conversationId);
  // 生成请求序列号，防止旧响应覆盖新状态
  const requestId = ++requestSequence;
  // ... 发送请求 ...
  // SSE 事件处理中校验 requestId
  if (requestId !== currentRequestId) return; // 旧请求，丢弃
}

async function selectConversation(conversationId: string) {
  const selectId = ++selectSequence;
  set({ loadingMessages: true });
  const messages = await apiFetch(`/api/v3/conversations/${conversationId}/messages`);
  // 校验是否是最新的选择
  if (selectId !== selectSequence) return; // 用户已切换到其他会话
  set({ currentConversationId: conversationId, messages, loadingMessages: false });
}
```

- `sendMessage` 发起前中止同会话旧流（与 §5.2 的 `stopStream` 配合）。
- `selectConversation` 使用序列号防止旧响应覆盖新状态。

**验收**：快速连续发送消息不产生多个并行 SSE 流；快速切换会话不出现消息串台。

### 5.6 其他前端加固

#### 5.6.1 重试逻辑（修复 S6-MEDIUM）

- `apiFetch` 对 5xx 和网络错误自动重试 1 次，间隔 1s。
- `retryable` 字段在 SSE error 事件中消费：若 `retryable=true`，UI 显示"重试"按钮；若 `false`，显示错误详情不提供重试。
- 429 不重试（尊重 `Retry-After`）。
- 4xx（除 401、429）不重试。

#### 5.6.2 CSP Meta 标签（修复 S11-MEDIUM）

- `frontend/index.html` 添加 CSP `<meta>` 标签作为后端安全头中间件的补充防线：

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'">
```

#### 5.6.3 替换 window.confirm（修复 S13-LOW）

- 将 `window.confirm()` 替换为自定义确认弹窗组件，避免阻塞主线程。
- 确认弹窗使用 React Portal 渲染，支持 ESC 关闭与点击遮罩关闭。

#### 5.6.4 客户端防抖（修复 S14-LOW）

- 消息发送按钮在请求进行中禁用（已有），额外添加 500ms 防抖防止双击。
- 会话切换添加 100ms 防抖，防止快速连续点击产生竞态。

---

## 6. 测试策略

### 6.1 测试架构总览

```text
tests/
├── conftest.py                    # 全局 fixture（V4 大幅扩展）
├── unit/                          # 单元测试
│   ├── test_context_builder.py    # 上下文构建器
│   ├── test_session_utils.py      # 令牌哈希、会话管理
│   ├── test_secret_service.py     # AES-GCM 加密/解密
│   ├── test_rate_limiter.py       # 令牌桶限流逻辑
│   ├── test_csrf.py               # CSRF Token 生成/校验
│   └── test_security_log.py       # 安全日志脱敏
├── integration/                   # 集成测试
│   ├── test_auth_security.py      # 认证安全（登录模糊化、时序、限流）
│   ├── test_conversations.py      # 会话 CRUD + 所有权校验
│   ├── test_messages.py           # 消息发送 + SSE 流式
│   ├── test_message_ops.py        # 重新生成、编辑重发、删除
│   ├── test_providers.py          # 供应商验证、凭据删除
│   ├── test_preferences.py        # 偏好读写与合并
│   ├── test_invocations.py        # 调用记录查询
│   └── test_middleware.py         # 安全中间件（CSRF、限流、大小限制、安全头）
├── security/                      # 安全测试
│   ├── test_ownership.py          # 越权访问
│   ├── test_injection.py          # SQL 注入、XSS 输入
│   ├── test_csrf_protection.py    # CSRF 攻击模拟
│   ├── test_session_security.py   # 会话固定、劫持、过期
│   └── test_info_disclosure.py    # 信息泄露（错误消息、响应头）
└── fixtures/
    ├── mock_provider.py           # Mock 模型供应商（返回固定 SSE 事件序列）
    ├── sse_helpers.py             # SSE 解析与断言工具
    └── db_helpers.py              # 数据库初始化与清理

frontend/src/__tests__/
├── stores/
│   ├── authStore.test.ts          # 认证状态、登出清理、401 处理
│   ├── conversationStore.test.ts  # 消息发送、竞态、会话切换
│   ├── providerStore.test.ts      # 供应商状态
│   └── preferenceStore.test.ts    # 偏好防抖、重置
├── components/
│   ├── InputArea.test.tsx         # 输入限制、粘贴截断、发送防抖
│   ├── MessageFlow.test.tsx       # 消息渲染、滚动、卸载清理
│   └── Sidebar.test.tsx           # 会话列表、重命名限制
└── api/
    └── client.test.ts             # 请求超时、401 处理、重试逻辑
```

### 6.2 后端测试计划

#### 6.2.1 单元测试

| 模块 | 测试项 | 数量 |
| --- | --- | --- |
| Context Builder | 交替消息构建、失败消息跳过、superseded 分支跳过、条数截断、字符预算截断、保留首条消息、空会话 | 7 |
| Session Utils | HMAC 令牌哈希、恒定时间比较、不同密钥不同哈希 | 3 |
| Secret Service | 加密-解密往返、错误密钥解密失败、fingerprint 一致性 | 3 |
| Rate Limiter | 令牌桶补充、超限拒绝、窗口恢复、按用户隔离、按 IP 隔离 | 5 |
| CSRF | Token 生成、Cookie-Header 匹配、不匹配拒绝、GET 豁免 | 4 |
| Security Log | 邮箱脱敏、事件记录格式、敏感字段不记录 | 3 |
| Config Validation | 缺失密钥拒绝启动、默认密钥拒绝启动、短密钥拒绝启动 | 3 |

#### 6.2.2 集成测试

| 端点 | 测试项 | 数量 |
| --- | --- | --- |
| `POST /auth/login` | 正常登录、错误密码（模糊消息）、不存在邮箱（模糊消息）、时序一致性 | 4 |
| `POST /auth/register` | 正常注册、重复注册 409、密码不合规 400 | 3 |
| `GET /auth/me` | 已认证、未认证 401、过期会话 401 | 3 |
| `POST /auth/logout` | 正常登出、登出后 Cookie 清除、登出后会话失效 | 3 |
| `GET /conversations` | 列表分页、cursor 游标、空列表 | 3 |
| `POST /conversations` | 创建空会话、带初始配置创建 | 2 |
| `GET /conversations/{id}` | 存在、不存在 404、他人会话 404 | 3 |
| `PATCH /conversations/{id}` | 改名、更新模型、他人会话 404 | 3 |
| `DELETE /conversations/{id}` | 软删除、已删除再删 404、他人会话 404 | 3 |
| `GET /conversations/{id}/messages` | 消息列表、before 游标分页、空会话 | 3 |
| `POST /conversations/{id}/messages` | 发送消息 + SSE 事件序列、非流式 JSON、他人会话 404、空内容 400 | 4 |
| `POST .../regenerate` | 重新生成、旧消息 superseded、他人消息 404 | 3 |
| `PUT .../messages/{mid}` | 编辑重发、非 user 消息 409、他人消息 404 | 3 |
| `DELETE .../messages/{mid}` | 删除消息、他人消息 404 | 2 |
| `POST /providers/{id}/validate` | 验证成功、验证失败、无凭据 400 | 3 |
| `DELETE /providers/{id}/credentials` | 删除凭据、凭据已删除、他人供应商 404 | 3 |
| `GET /invocations` | 列表分页、按会话过滤 | 2 |
| 中间件 | CSRF 拦截、限流 429、请求体过大 413、安全头存在 | 4 |

#### 6.2.3 安全测试

| 场景 | 测试项 | 数量 |
| --- | --- | --- |
| 越权访问 | 他人会话 404、他人消息 404、他人供应商 404、未认证全部 401 | 4 |
| SQL 注入 | 会话标题注入、消息内容注入、搜索查询注入 | 3 |
| XSS 输入 | 消息内容含 `<script>` 标签、会话标题含 HTML、SSE 事件中 HTML 注入 | 3 |
| CSRF 攻击 | 无 Token POST 403、错误 Token 403、GET 豁免 | 3 |
| 会话安全 | 会话固定攻击（登录后 Cookie 变化）、过期会话 401、撤销会话 401 | 3 |
| 信息泄露 | 登录错误不区分用户存在性、错误响应不含堆栈、响应头不含版本信息 | 3 |

#### 6.2.4 SSE 流式测试

| 场景 | 测试项 | 数量 |
| --- | --- | --- |
| 正常流式 | start → reasoning_delta → answer_delta → usage → done 事件序列完整 | 1 |
| 无思考流式 | start → answer_delta → done（无 reasoning_delta） | 1 |
| 错误流式 | start → error 事件，消息状态 failed | 1 |
| 客户端断开 | SSE 连接中断 → 上游取消 → 消息状态 cancelled | 1 |
| 节流落库 | 流式期间每 1s 落库，done 后最终内容完整 | 1 |
| 上下文携带 | 第二轮请求的出站 payload 包含第一轮问答 | 1 |
| 上下文截断 | 超过 40 条消息时截断早期消息但保留首条 | 1 |

#### 6.2.5 测试 Fixture

```python
# tests/conftest.py（V4 扩展）

@pytest.fixture
def app():
    """创建测试用 FastAPI app，使用内存数据库。"""
    # 覆盖配置：cookie_secure=False, encryption_key=测试密钥
    # ...

@pytest.fixture
def client(app):
    """TestClient，自动管理 Cookie。"""
    return TestClient(app)

@pytest.fixture
def authed_client(client):
    """已注册+登录的 TestClient，携带会话 Cookie + CSRF Cookie。"""
    client.post("/api/v3/auth/register", json={...})
    client.post("/api/v3/auth/login", json={...})
    return client

@pytest.fixture
def mock_provider():
    """Mock 模型供应商，返回固定 SSE 事件序列，不发起真实网络请求。"""
    # 替换 Provider Adapter，返回预设事件流
    # ...

@pytest.fixture
def conversation_with_messages(authed_client, mock_provider):
    """创建会话并发送多条消息，返回会话 ID 与消息列表。"""
    # ...
```

```python
# tests/fixtures/sse_helpers.py
def parse_sse_events(response) -> list[dict]:
    """解析 SSE 响应体为事件列表。"""
    events = []
    for line in response.iter_lines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events

def assert_event_sequence(events, expected_types: list[str]):
    """断言事件类型序列匹配。"""
    actual_types = [e["type"] for e in events]
    assert actual_types == expected_types, f"事件序列不匹配: {actual_types} != {expected_types}"
```

### 6.3 前端测试计划

#### 6.3.1 测试框架引入

```json
// frontend/package.json (devDependencies 新增)
{
  "vitest": "^1.6.0",
  "@testing-library/react": "^15.0.0",
  "@testing-library/jest-dom": "^6.4.0",
  "@testing-library/user-event": "^14.5.0",
  "jsdom": "^24.0.0",
  "msw": "^2.3.0"
}
```

- **Vitest**：Vite 原生测试框架，零配置集成。
- **Testing Library**：以用户视角测试组件，不测试实现细节。
- **MSW (Mock Service Worker)**：拦截网络请求，返回 mock 响应。

#### 6.3.2 Store 测试

| Store | 测试项 | 数量 |
| --- | --- | --- |
| authStore | 登录成功设置 user、登出清理全部 store、handleSessionExpired 清理、401 触发 session expired | 4 |
| conversationStore | sendMessage 正常流程、sendMessage 中止旧流、selectConversation 竞态防护、消息列表加载 | 4 |
| providerStore | 加载供应商列表、验证供应商、删除凭据 | 3 |
| preferenceStore | 偏好更新防抖、reset 清理状态、debounce timer 清除 | 3 |

#### 6.3.3 组件测试

| 组件 | 测试项 | 数量 |
| --- | --- | --- |
| InputArea | 输入限制 50K、粘贴截断、Enter 发送、Shift+Enter 换行、发送中禁用 | 5 |
| MessageFlow | 消息渲染、流式光标、卸载时中止 SSE、滚动跟随 | 4 |
| Sidebar | 会话列表渲染、重命名 200 字符限制、删除确认弹窗 | 3 |

#### 6.3.4 API Client 测试

| 测试项 | 数量 |
| --- | --- |
| 请求超时 abort | 1 |
| 401 触发 handleSessionExpired | 1 |
| 5xx 自动重试 1 次 | 1 |
| 429 不重试 | 1 |
| CSRF Token 注入请求头 | 1 |

### 6.4 测试覆盖率目标

| 层级 | 目标 | 工具 |
| --- | --- | --- |
| 后端行覆盖 | ≥ 85% | `pytest --cov=backend/app --cov-report=term-missing` |
| 后端端点覆盖 | 100% | 手动核对端点清单 |
| 前端 store 覆盖 | ≥ 70% | `vitest --coverage` |
| 前端组件覆盖 | ≥ 60% | `vitest --coverage` |
| 安全测试场景 | OWASP Top 10 相关项全覆盖 | 手动核对 |

### 6.5 CI 集成

```yaml
# .github/workflows/test.yml（或 Makefile test 目标）
test-backend:
  - PYTHONPATH=backend backend/.venv/bin/pytest tests/ -v --cov=backend/app --cov-report=term-missing --cov-fail-under=85

test-frontend:
  - cd frontend && npx vitest run --coverage --coverage.thresholds.lines=70
```

- 后端测试 + 覆盖率检查 < 60s。
- 前端测试 + 覆盖率检查 < 30s。
- 覆盖率低于阈值时 CI 失败。

---

## 7. V3 Spec 遗留项补全

V4 在安全与测试之外，补全 V3 spec 中未实现但影响安全与质量的遗留项：

### 7.1 限流（V3 spec §10.6）

- V3 spec 要求消息发送接口按用户限流 30 次/分钟。
- V4 §4.2 的限流中间件已覆盖此要求，且扩展到全部端点类别。

### 7.2 会话清理后台任务（V3 spec §8.3）

- V3 spec 要求后台任务定期删除已过期/已撤销超过 30 天的 SessionRecord 行。
- V4 引入启动时清理 + 可选定时清理：

```python
# api/auth.py
@app.on_event("startup")
async def cleanup_expired_sessions():
    """启动时清理过期会话。"""
    threshold = datetime.utcnow() - timedelta(days=30)
    db.query(SessionRecord).filter(
        SessionRecord.expires_at < threshold
    ).delete()
    db.commit()
    log_security_event("session_cleanup", deleted_count=...)
```

### 7.3 错误码补全（V3 spec §7.5）

- `CONTENT_EMPTY` (400)：消息内容为空或仅空白字符。
- `CONTEXT_OVERFLOW` (413)：截断后仍超出预算（防御性，理论上截断策略应避免此情况）。

### 7.4 前端首事件超时（V3 spec §4.5）

- V4 §5.1 的 SSE 首事件 20s 超时已覆盖此要求。

---

## 8. HTTP API 变化（/api/v3）

V4 不新增端点，仅对现有端点增加安全中间件层。以下变化对前端透明（除 CSRF Token 外）：

### 8.1 新增响应头

| 头 | 值 | 说明 |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | 防 MIME 嗅探 |
| `X-Frame-Options` | `DENY` | 防点击劫持 |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | 强制 HTTPS（仅 HTTPS 响应） |
| `Content-Security-Policy` | 见 §4.8 | 内容安全策略 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 引用来源限制 |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | 权限策略 |

### 8.2 新增 Cookie

| Cookie | 属性 | 说明 |
| --- | --- | --- |
| `csrf_token` | `SameSite=Lax; Path=/; Max-Age=86400` | CSRF 双重提交 Token（非 HttpOnly，前端可读） |

### 8.3 新增错误码

| 错误码 | HTTP | 说明 |
| --- | ---: | --- |
| `RATE_LIMITED` | 429 | 限流命中，响应头含 `Retry-After` |
| `CSRF_INVALID` | 403 | CSRF Token 校验失败 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体超过 1MB 上限 |
| `CONTENT_EMPTY` | 400 | 消息内容为空（V3 spec 遗留） |
| `CONTEXT_OVERFLOW` | 413 | 截断后仍超出预算（V3 spec 遗留） |

### 8.4 错误响应变化

- `POST /auth/login` 失败响应统一为 `AUTH_INVALID_CREDENTIALS`，不再区分用户不存在与密码错误。
- 所有 429 响应包含 `Retry-After` 响应头（秒数）。

---

## 9. 交付阶段

### Phase 1：HIGH 级安全修复（最高优先，先做）

> 目标：消除全部 7 项 HIGH 级漏洞，阻断生产环境可利用攻击面。

1. Cookie Secure 环境感知（§4.1）
2. 限流中间件（§4.2）
3. CSRF 防护中间件（§4.3）
4. 请求体大小限制中间件（§4.4）
5. 前端请求超时 + SSE 空闲超时（§5.1）
6. 前端组件卸载中止 SSE（§5.2）
7. 前端输入长度限制 + 粘贴处理（§5.3）
8. 每项修复配套安全测试

### Phase 2：MEDIUM 级安全修复

> 目标：消除全部 13 项 MEDIUM 级漏洞，安全扫描零告警。

1. 会话令牌 HMAC 哈希（§4.5）
2. 登录错误模糊化 + 防时序（§4.6）
3. 加密密钥启动校验（§4.7）
4. 安全响应头中间件（§4.8）
5. 安全审计日志（§4.9）
6. 前端 401 处理 + 登出清理（§5.4）
7. 前端竞态条件修复（§5.5）
8. 前端重试逻辑（§5.6.1）
9. CSP Meta 标签（§5.6.2）
10. V3 spec 遗留项补全（§7）

### Phase 3：测试体系建立

> 目标：后端覆盖率 ≥ 85%，前端覆盖率 ≥ 70%，安全测试全覆盖。

1. 测试 fixture 基础设施（conftest 扩展、mock provider、SSE helpers）
2. 后端单元测试（§6.2.1）
3. 后端集成测试（§6.2.2）
4. 后端安全测试（§6.2.3）
5. 后端 SSE 流式测试（§6.2.4）
6. 前端测试框架引入（Vitest + Testing Library + MSW）
7. 前端 store 测试（§6.3.2）
8. 前端组件测试（§6.3.3）
9. 前端 API client 测试（§6.3.4）
10. CI 集成 + 覆盖率门禁（§6.5）

### Phase 4：LOW 级修复与收尾

> 目标：消除全部 6 项 LOW 级漏洞，文档更新，最终验收。

1. 健康检查限流（§4.10.1）
2. 环境变量校验（§4.10.2）
3. 数据库文件权限（§4.10.3）
4. 替换 window.confirm（§5.6.3）
5. 客户端防抖（§5.6.4）
6. 更新 README 中的安全配置说明
7. 全量回归测试

---

## 10. V4 验收标准

### 10.1 安全验收（Phase 1 + Phase 2）

- [ ] **S1**：生产环境 Cookie 包含 `Secure` 标志，HTTP 不携带会话 Cookie。
- [ ] **S2**：超过限流配额的请求返回 429 + `Retry-After`；按用户隔离生效。
- [ ] **S3**：无 `X-CSRF-Token` 头的 POST 请求返回 403；Token 不匹配返回 403。
- [ ] **S4**：`Content-Length > 1MB` 的请求返回 413。
- [ ] **S5**：会话令牌使用 HMAC-SHA256 哈希；恒定时间比较通过测试。
- [ ] **S6**：登录失败不区分用户存在性；响应时间差异 < 50ms。
- [ ] **S7**：未设置 `APP_ENCRYPTION_KEY` 时启动失败；默认密钥拒绝启动。
- [ ] **S8**：响应头包含全部安全头；CSP 策略阻止外部脚本。
- [ ] **S9**：安全事件在 `logs/security.log` 中有 JSON 记录；日志无明文敏感数据。
- [ ] **S10**：前端请求 30s 超时生效；SSE 60s 空闲超时生效。
- [ ] **S11**：组件卸载后无活跃 SSE 连接；登出后无孤儿连接。
- [ ] **S12**：输入超过 50K 字符被截断并提示；字符计数实时更新。
- [ ] **S13**：401 响应触发自动登出并跳转登录页；登出后全部 store 重置。
- [ ] **S14**：快速连续发送消息不产生多个并行 SSE 流；快速切换会话不串台。
- [ ] **S15**：5xx 错误自动重试 1 次；429 不重试；`retryable` 字段在 UI 中正确消费。
- [ ] **S16**：`window.confirm` 全部替换为自定义弹窗。
- [ ] **S17**：数据库文件权限 `0600`。
- [ ] **S18**：环境变量缺失时启动失败并打印明确错误。

### 10.2 测试验收（Phase 3）

- [ ] 后端测试数量 ≥ 80 个（当前 9 个）。
- [ ] 后端行覆盖率 ≥ 85%。
- [ ] 后端端点覆盖率 100%（全部 API 端点至少 1 个测试）。
- [ ] 前端测试框架引入并运行（Vitest + Testing Library + MSW）。
- [ ] 前端测试数量 ≥ 25 个。
- [ ] 前端 store 覆盖率 ≥ 70%。
- [ ] 安全测试覆盖越权、注入、CSRF、会话安全、信息泄露 5 类场景。
- [ ] SSE 流式测试覆盖正常、无思考、错误、断开、节流落库、上下文携带、截断 7 个场景。
- [ ] CI 中测试全部通过，后端 < 60s，前端 < 30s。
- [ ] 覆盖率低于阈值时 CI 失败。

### 10.3 回归验收

- [ ] V3 全部功能不受影响：登录、对话、流式、供应商配置、偏好持久化。
- [ ] V3 性能优化不受影响：React.memo、rAF 滚动、动画。
- [ ] 现有 9 个测试全部继续通过。

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| CSRF 中间件误拦截合法请求 | 前端功能不可用 | 前端统一在 `apiFetch` 中注入 `X-CSRF-Token`；GET 请求豁免；测试覆盖全部 POST/PUT/PATCH/DELETE 端点 |
| 限流误伤正常用户 | 用户体验受损 | 配额设置留有余量（消息 30/min 远高于正常使用）；429 响应包含 `Retry-After`；测试验证正常使用不触发限流 |
| 安全头 CSP 过严导致前端功能异常 | 样式/脚本不加载 | CSP 允许 `'unsafe-inline'` 样式（React 需要）；脚本严格 `'self'`；测试验证前端正常渲染 |
| 令牌哈希方案变更导致旧会话失效 | 用户被强制重新登录 | 旧会话自然过期后替换（TTL 24h）；不做数据库迁移，避免停机 |
| 测试 fixture 复杂度高导致维护成本 | 测试难以维护 | fixture 按职责拆分（mock_provider、sse_helpers、db_helpers）；复用 conftest 层级 fixture |

---

## 12. 待确认决策

1. 限流存储方案：V4 使用内存令牌桶（单进程够用），若未来多进程部署需切换为 Redis。是否在 V4 预留接口？
2. 安全日志轮转：`logs/security.log` 是否引入 `logging.handlers.RotatingFileHandler`（如 10MB × 5 份）？
3. 前端测试是否引入 MSW 拦截 SSE，还是使用 Vitest 的 mock？SSE mock 复杂度较高。
4. 是否在 V4 引入 Alembic migration（V3 spec 要求但未实现），还是继续使用 `create_all()` + 启动清理？

---

## 13. 设计结论

V4 的判断是：**一个功能可用但安全未加固、测试未覆盖的产品，不具备上线条件。** V3 把产品从"实验工作台"重构为"标准对话客户端"，解决了用户体验问题；V4 把产品从"功能可用"推进到"安全可信、质量可证"，解决的是信任问题。

26 项安全漏洞中 7 项 HIGH 级别意味着生产环境存在可利用的攻击面——会话劫持、暴力破解、CSRF、DoS、信息泄露——任何一项都可能导致用户数据暴露。9 个测试覆盖不到 15% 的端点意味着每次迭代都在"盲飞"——没有回归保障，没有质量底线。

因此 V4 以"安全优先、测试驱动"为核心原则：Phase 1 先堵住全部 HIGH 级漏洞，Phase 2 消除 MEDIUM 级隐患，Phase 3 建立系统化测试体系，Phase 4 收尾 LOW 级修复。安全修复必有测试证明其有效性，测试覆盖必含安全场景验证。先让产品"攻不破、测得过"，再谈后续功能迭代。
