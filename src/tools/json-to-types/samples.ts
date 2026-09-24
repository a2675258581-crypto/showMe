/** 「JSON 生成类型」的示例：一个典型的接口响应 */
export const SAMPLE = `{
  "code": 0,
  "message": "ok",
  "requestId": "c0a8-4f1e-9b2d",
  "data": {
    "user": {
      "id": 10086,
      "username": "zhang_san",
      "displayName": "张三",
      "email": "zhangsan@example.com",
      "avatar_url": "https://cdn.example.com/avatar/10086.png",
      "isVerified": true,
      "balance": 1024.5,
      "createdAt": "2024-03-15T09:30:00Z",
      "profile": { "bio": null, "location": "杭州", "website": null }
    },
    "orders": [
      {
        "orderId": "SO-1001",
        "status": "paid",
        "total": 399,
        "items": [{ "sku": "KB-01", "name": "机械键盘", "qty": 1, "price": 399.0 }],
        "shippingAddress": { "city": "杭州", "street": "文三路 90 号", "zip": "310012" },
        "coupon": "NEW10"
      },
      {
        "orderId": "SO-1002",
        "status": "shipped",
        "total": 59.8,
        "items": [
          { "sku": "CB-02", "name": "USB-C 数据线", "qty": 2, "price": 29.9, "gift": true }
        ],
        "shippingAddress": { "city": "上海", "street": "世纪大道 100 号", "zip": "200120" },
        "billingAddress": { "city": "上海", "street": "世纪大道 100 号", "zip": "200120" }
      }
    ],
    "tags": ["early-adopter", "vip"],
    "preferences": {
      "theme": "dark",
      "language": "zh-CN",
      "notifications": { "email": true, "sms": false }
    },
    "2fa-enabled": false,
    "extra": {}
  }
}
`
