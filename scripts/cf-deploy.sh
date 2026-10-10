#!/usr/bin/env bash
# 一键部署：由 Cloudflare Workers Builds 在每次 push 后执行（部署命令：pnpm run cf:deploy）
#
# 幂等：每次都完整检查一遍，缺什么补什么，已存在的资源和密钥不会被改动。
#   1. 由 Worker 名推导资源名，缺失的 D1 / R2 / Queue 自动创建
#   2. 构建前端
#   3. 执行 D1 迁移（先迁移）
#   4. 部署 Worker（后部署，前端静态资源随 Worker 一起上传）
#   5. JWT_SECRET / PORTAL_JWT_SECRET 不存在时随机生成
#
# Worker 名来源（按优先级）：
#   WRANGLER_CI_OVERRIDE_NAME  Workers Builds 自动注入，即控制台里该 Worker 的名字
#   APP_NAME                   本地手动部署时指定，例如 APP_NAME=crm-dev pnpm run cf:deploy
#
# 资源命名：<Worker名>-db / -store / -leads / -notify
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKERS_DIR="$ROOT/apps/workers"
DEPLOY_CONFIG="wrangler.deploy.toml"   # 生成在 apps/workers 下（保证相对路径有效），已 gitignore

NAME="${WRANGLER_CI_OVERRIDE_NAME:-${APP_NAME:-}}"
if [ -z "$NAME" ]; then
  echo "❌ 无法确定 Worker 名称。"
  echo "   在 Workers Builds 中会自动提供；本地部署请设置 APP_NAME，例如：APP_NAME=crm-dev pnpm run cf:deploy"
  exit 1
fi

DB_NAME="${NAME}-db"
BUCKET_NAME="${NAME}-store"
LEAD_QUEUE="${NAME}-leads"
NOTIFY_QUEUE="${NAME}-notify"

echo "▶ Worker: $NAME"
echo "  D1: $DB_NAME | R2: $BUCKET_NAME | Queues: $LEAD_QUEUE, $NOTIFY_QUEUE"

cd "$ROOT"
if [ ! -d node_modules ]; then
  echo "▶ 安装依赖"
  pnpm install --frozen-lockfile
fi

cd "$WORKERS_DIR"
wr() { npx wrangler "$@"; }

# ── 1. 资源：不存在则创建 ─────────────────────────────────────────────
d1_id() {
  wr d1 list --json | DB_NAME="$DB_NAME" node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const db = JSON.parse(s.slice(s.indexOf("["))).find((d) => d.name === process.env.DB_NAME);
      process.stdout.write(db ? db.uuid : "");
    });'
}
DB_ID="$(d1_id)"
if [ -z "$DB_ID" ]; then
  echo "▶ 创建 D1 数据库 $DB_NAME"
  wr d1 create "$DB_NAME"
  DB_ID="$(d1_id)"
fi
if [ -z "$DB_ID" ]; then
  echo "❌ 无法获取 D1 数据库 ID：$DB_NAME"
  exit 1
fi
echo "✔ D1 $DB_NAME ($DB_ID)"

if ! wr r2 bucket info "$BUCKET_NAME" > /dev/null 2>&1; then
  echo "▶ 创建 R2 存储桶 $BUCKET_NAME"
  if ! R2_OUT="$(wr r2 bucket create "$BUCKET_NAME" 2>&1)"; then
    echo "$R2_OUT"
    if echo "$R2_OUT" | grep -q "10042"; then
      echo "❌ 该 Cloudflare 账号尚未启用 R2。"
      echo "   请在控制台左侧菜单 → R2 对象存储 → 启用（每个账号一次），然后在 Worker → Deployments 中重试构建。"
    fi
    exit 1
  fi
fi
echo "✔ R2 $BUCKET_NAME"

for Q in "$LEAD_QUEUE" "$NOTIFY_QUEUE"; do
  if ! wr queues info "$Q" > /dev/null 2>&1; then
    echo "▶ 创建队列 $Q"
    wr queues create "$Q"
  fi
  echo "✔ Queue $Q"
done

# ── 生成部署用配置（不修改仓库中的 wrangler.toml）────────────────────
sed -e "s/placeholder-worker/$NAME/" \
    -e "s/00000000-0000-0000-0000-000000000000/$DB_ID/" \
    -e "s/placeholder-db/$DB_NAME/" \
    -e "s/placeholder-store/$BUCKET_NAME/" \
    -e "s/placeholder-leads/$LEAD_QUEUE/g" \
    -e "s/placeholder-notify/$NOTIFY_QUEUE/g" \
    wrangler.toml > "$DEPLOY_CONFIG"
trap 'rm -f "$WORKERS_DIR/$DEPLOY_CONFIG"' EXIT

# ── 2. 构建前端（VITE_API_BASE_URL 可选，默认同源 /api）──────────────
echo "▶ 构建前端"
(cd "$ROOT" && pnpm --filter web build)

# ── 3. 迁移（先于部署，迁移需保持向后兼容）───────────────────────────
echo "▶ 执行数据库迁移"
wr d1 migrations apply "$DB_NAME" --remote -c "$DEPLOY_CONFIG"

# ── 4. 部署 ─────────────────────────────────────────────────────────
echo "▶ 部署 Worker"
# --keep-vars：保留在控制台设置的普通变量（如 EMAIL_FROM），否则每次部署会被清除
wr deploy -c "$DEPLOY_CONFIG" --keep-vars

# ── 5. 密钥：不存在则生成 ────────────────────────────────────────────
# 查询失败时绝不重新生成：否则会轮换已有密钥，导致所有用户被登出
if ! EXISTING_SECRETS="$(wr secret list --format json -c "$DEPLOY_CONFIG")"; then
  echo "⚠️  无法读取 Secret 列表，跳过密钥检查（已有密钥不受影响）"
  EXISTING_SECRETS=""
fi
if [ -n "$EXISTING_SECRETS" ]; then
  for S in JWT_SECRET PORTAL_JWT_SECRET; do
    if echo "$EXISTING_SECRETS" | grep -q "\"$S\""; then
      echo "✔ Secret $S"
    else
      echo "▶ 生成 Secret $S"
      node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))' \
        | wr secret put "$S" -c "$DEPLOY_CONFIG"
    fi
  done
fi

echo "✅ 部署完成：$NAME"
