/** JSON ⇄ YAML 的示例数据：Kubernetes 多文档清单（含锚点）与 docker-compose 配置 */

export const YAML_SAMPLE = `# shop-api 的 Kubernetes 部署清单（三个文档，用 --- 分隔）
apiVersion: v1
kind: ConfigMap
metadata:
  name: shop-api-config
  namespace: prod
data:
  TZ: Asia/Shanghai
  LOG_LEVEL: info
  FEATURE_NEW_CHECKOUT: "on"   # 加引号：否则部分解析器会当成布尔值
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: prod
  labels: &labels          # 定义锚点，下面用 *labels 复用
    app: shop-api
    tier: backend
spec:
  replicas: 3
  selector:
    matchLabels: *labels
  template:
    metadata:
      labels: *labels
    spec:
      containers:
        - name: api
          image: registry.example.com/shop/api:1.8.2
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: shop-api-config
          resources: &res
            requests: { cpu: 250m, memory: 256Mi }
            limits: { cpu: "1", memory: 512Mi }
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 5
        - name: log-agent
          image: fluent/fluent-bit:3.1
          resources: *res
---
apiVersion: v1
kind: Service
metadata:
  name: shop-api
  namespace: prod
spec:
  type: ClusterIP
  selector:
    app: shop-api
  ports:
    - name: http
      port: 80
      targetPort: 8080
`

export const JSON_SAMPLE = `{
  "name": "shop-dev",
  "services": {
    "web": {
      "image": "nginx:1.27-alpine",
      "restart": "unless-stopped",
      "ports": ["80:80", "443:443"],
      "volumes": ["./nginx.conf:/etc/nginx/nginx.conf:ro"],
      "depends_on": ["api"]
    },
    "api": {
      "build": { "context": "./api", "args": { "NODE_ENV": "production" } },
      "environment": {
        "TZ": "Asia/Shanghai",
        "DATABASE_URL": "postgres://app:secret@db:5432/shop",
        "FEATURE_FLAGS": "on",
        "WELCOME_TEXT": "欢迎光临 🛍️"
      },
      "healthcheck": {
        "test": ["CMD", "curl", "-f", "http://localhost:3000/health"],
        "interval": "30s",
        "retries": 3
      },
      "deploy": { "replicas": 2, "resources": { "limits": { "cpus": "0.5", "memory": "512M" } } }
    },
    "db": {
      "image": "postgres:16",
      "environment": { "POSTGRES_USER": "app", "POSTGRES_PASSWORD": "secret" },
      "volumes": ["pgdata:/var/lib/postgresql/data"]
    }
  },
  "volumes": { "pgdata": {} }
}
`
