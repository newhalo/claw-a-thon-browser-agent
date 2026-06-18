# Deploy Agent Service lên AgentBase

## Thông tin cố định

| Field | Value |
|-------|-------|
| Runtime ID | `runtime-8b6ff06c-9c1b-43e4-be39-ddc0ca5b6f8c` |
| Runtime name | `claw-a-thon-agent-service` |
| Endpoint ID | `endpoint-a24a9556-762d-4969-9253-a4aa8019faf8` |
| Endpoint URL | `https://endpoint-a24a9556-762d-4969-9253-a4aa8019faf8.agentbase-runtime.aiplatform.vngcloud.vn` |
| Registry | `vcr.vngcloud.vn/111480-abp111789/claw-agent-service` |
| Flavor | `runtime-s2-general-4x8` |
| Env file | `packages/agent-service/.env` |

## Quy trình deploy

### 1. Build image

**QUAN TRỌNG:** Luôn dùng `--platform linux/amd64 --no-cache`.

- `--platform linux/amd64`: AgentBase chạy Linux x86_64. Không có flag này, Docker trên Apple Silicon sẽ build ARM image → lỗi `exec format error` khi container start.
- `--no-cache`: Tránh tình huống cache giữ lại layers từ lần build ARM trước. Nếu bỏ `--no-cache`, metadata có thể báo amd64 nhưng binary thực tế vẫn là ARM.

```bash
TAG="v$(date +%Y%m%d%H%M%S)"
docker build --platform linux/amd64 --no-cache \
  -t vcr.vngcloud.vn/111480-abp111789/claw-agent-service:$TAG \
  packages/agent-service
```

### 2. Push lên registry

```bash
docker push vcr.vngcloud.vn/111480-abp111789/claw-agent-service:$TAG
```

### 3. Deploy lên AgentBase

**QUAN TRỌNG:** Luôn dùng `--from-cr` để cung cấp registry credentials. Không có flag này API trả về HTTP 400.

```bash
bash .claude/skills/agentbase/scripts/runtime.sh update \
  runtime-8b6ff06c-9c1b-43e4-be39-ddc0ca5b6f8c \
  --image vcr.vngcloud.vn/111480-abp111789/claw-agent-service:$TAG \
  --flavor runtime-s2-general-4x8 \
  --env-file packages/agent-service/.env \
  --from-cr
```

### 4. Theo dõi trạng thái endpoint

```bash
until bash .claude/skills/agentbase/scripts/runtime.sh endpoints list \
  runtime-8b6ff06c-9c1b-43e4-be39-ddc0ca5b6f8c 2>&1 | \
  python3 -c "
import sys,json; d=json.load(sys.stdin); ep=d.get('listData',[])[0]
s=ep.get('status'); print(s)
exit(0 if s in ('ACTIVE','ERROR') else 1)
" 2>/dev/null; do sleep 5; done
```

### 5. Verify

```bash
curl -s https://endpoint-a24a9556-762d-4969-9253-a4aa8019faf8.agentbase-runtime.aiplatform.vngcloud.vn/health
```

Kết quả mong đợi: `{"status":"ok","provider":{"configured":true,...}}`

---

## Lỗi thường gặp

### `exec format error`
Container không start, log: `exec /usr/local/bin/docker-entrypoint.sh: exec format error`

**Nguyên nhân:** Image build cho ARM (Apple Silicon), AgentBase cần amd64.

**Fix:** Build lại với `--platform linux/amd64 --no-cache`.

### `Health check failed`
Endpoint chuyển sang ERROR ngay sau khi UPDATING, không có application logs.

**Nguyên nhân thường gặp:**
1. Image build sai platform (xem lỗi trên)
2. Container crash khi startup — kiểm tra logs: `bash .claude/skills/agentbase/scripts/runtime.sh endpoints logs <runtime-id> <endpoint-id>`

### `HTTP 400` khi update

**Nguyên nhân:** Thiếu `--from-cr` (registry credentials).

**Fix:** Thêm `--from-cr` vào lệnh update.

### Env vars bị mất sau khi đổi flavor

Khi đổi flavor qua UI AgentBase console, platform tạo version mới **không kế thừa** env vars từ version cũ.

**Fix:** Luôn dùng `--env-file packages/agent-service/.env` khi update qua script.

---

## Script one-liner (full deploy)

```bash
TAG="v$(date +%Y%m%d%H%M%S)" && \
docker build --platform linux/amd64 --no-cache \
  -t vcr.vngcloud.vn/111480-abp111789/claw-agent-service:$TAG \
  packages/agent-service && \
docker push vcr.vngcloud.vn/111480-abp111789/claw-agent-service:$TAG && \
bash .claude/skills/agentbase/scripts/runtime.sh update \
  runtime-8b6ff06c-9c1b-43e4-be39-ddc0ca5b6f8c \
  --image vcr.vngcloud.vn/111480-abp111789/claw-agent-service:$TAG \
  --flavor runtime-s2-general-4x8 \
  --env-file packages/agent-service/.env \
  --from-cr && \
echo "Deployed: $TAG"
```
