/** JSON ⇄ XML 的示例数据 */

export const JSON_SAMPLE = `{
  "bookstore": {
    "@_name": "城市书房",
    "@_updated": "2026-09-01",
    "book": [
      {
        "@_id": "bk101",
        "@_lang": "zh",
        "title": "三体",
        "author": "刘慈欣",
        "price": 23.5,
        "inStock": true,
        "tags": { "tag": ["科幻", "雨果奖"] }
      },
      {
        "@_id": "bk102",
        "@_lang": "en",
        "title": "The Pragmatic Programmer",
        "author": ["David Thomas", "Andrew Hunt"],
        "price": 45,
        "inStock": false,
        "note": { "@_type": "tip", "#text": "20th Anniversary Edition & more" }
      }
    ],
    "address": null
  }
}
`

export const XML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<order id="SO-20260924-001" currency="CNY">
  <customer vip="true">
    <name>李雷</name>
    <email>lilei@example.com</email>
    <phone>013800138000</phone>
  </customer>
  <items>
    <item sku="A-1001">
      <title>机械键盘</title>
      <qty>1</qty>
      <price>399.00</price>
    </item>
    <item sku="B-2002">
      <title>USB-C 数据线</title>
      <qty>2</qty>
      <price>29.9</price>
    </item>
  </items>
  <remark><![CDATA[请在 <工作日> 送货 & 电话联系]]></remark>
  <paid>false</paid>
</order>
`
