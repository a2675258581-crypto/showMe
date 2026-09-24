/** 示例数据：一个真实感的接口响应（嵌套、中文、数组、null、大数 ID） */
export const SAMPLE_JSON = String.raw`{"code":0,"message":"success","requestId":"c7f3a9e2-51b4-4f0e-9d3a-7b6e2f1c8a90","timestamp":1727164800000,"data":{"user":{"id":1234567890123456789,"nickname":"小明同学 🍀","email":"xiaoming@example.com","verified":true,"avatar":null,"tags":["前端","摄影","咖啡爱好者"],"profile":{"city":"上海","bio":"热爱开源，喜欢把复杂的事情变简单。\n周末常去徒步。","joinedAt":"2019-03-14T08:30:00+08:00","themeColor":"#0071e3","stats":{"followers":12893,"following":311,"likes":1.2e5}}},"orders":[{"orderId":"202409240001","status":"shipped","amount":299.9,"currency":"CNY","items":[{"sku":"SKU-8848","name":"无线降噪耳机","qty":1,"price":199.9},{"sku":"SKU-1024","name":"Type-C 快充线（2 米）","qty":2,"price":50.0}],"coupon":null,"address":{"province":"浙江省","city":"杭州市","detail":"西湖区文三路 138 号"}},{"orderId":"202409240002","status":"pending","amount":0,"items":[],"coupon":{"code":"WELCOME10","discount":0.1}}],"pagination":{"page":1,"pageSize":20,"total":2,"hasMore":false}},"traceId":98765432109876543210}`

/** 宽松模式示例：JSON5 风格的配置文件 */
export const SAMPLE_JSON5 = String.raw`// 应用配置（JSON5 风格，开启「宽松模式」即可解析）
{
  name: 'showMe',
  version: "1.2.0",
  port: 0x1F90, // 8080
  debug: true,
  ratio: .75,
  features: ['格式化', '树形视图', '大数保真',], // 尾随逗号
  /* 雪花 ID 超过 2^53，也不会丢精度 */
  snowflakeId: 1834567890123456789,
  retry: { times: 3, backoff: 'exponential', },
}`

/** 转义示例：一段带引号、反斜杠、换行的 JSON */
export const SAMPLE_ESCAPE = String.raw`{
  "title": "他说：\"你好，世界\"",
  "path": "C:\\Users\\xiaoming\\文档",
  "lines": "第一行\n第二行",
  "emoji": "🍀"
}`

/** 去转义示例：日志里常见的被转义过的 JSON 字符串 */
export const SAMPLE_UNESCAPE = String.raw`"{\"code\":0,\"msg\":\"操作成功\",\"data\":{\"id\":1234567890123456789,\"tags\":[\"新品\",\"热卖\"],\"note\":\"第一行\\n第二行\"}}"`

export const ALL_SAMPLES = [SAMPLE_JSON, SAMPLE_JSON5, SAMPLE_ESCAPE, SAMPLE_UNESCAPE]
