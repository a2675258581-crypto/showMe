/** JSON ⇄ CSV 的示例数据 */

export const JSON_SAMPLE = `[
  {
    "id": 1001,
    "name": "张伟",
    "email": "zhangwei@example.com",
    "age": 28,
    "vip": true,
    "address": { "city": "北京", "district": "海淀区", "zip": "100080" },
    "tags": ["前端", "React"],
    "lastLogin": "2026-09-20T08:30:00Z"
  },
  {
    "id": 1002,
    "name": "Emily Chen",
    "email": "emily@example.com",
    "age": 31,
    "vip": false,
    "address": { "city": "上海", "district": "浦东新区", "zip": "200120" },
    "tags": [],
    "note": "备注里有逗号, 也有 \\"引号\\""
  },
  {
    "id": 1003,
    "name": "王芳",
    "email": null,
    "age": 25,
    "vip": true,
    "address": { "city": "深圳", "district": "南山区", "zip": "518000" },
    "tags": ["设计"]
  }
]
`

export const CSV_SAMPLE = `订单号,商品,数量,单价,已付款,收货地址.城市,收货地址.详细,备注
SO-1001,机械键盘,1,399.00,true,杭州,西湖区文三路 90 号,
SO-1002,"USB-C 数据线, 2 米",3,29.9,false,成都,"高新区天府大道 ""软件园"" C 区",请工作日送达
SO-1003,显示器支架,2,159,TRUE,广州,天河区体育西路 1 号,"两行备注：
到了先打电话"
`
