/** XML 格式化的示例数据（故意写得比较乱，方便看出格式化效果） */

export const XML_SAMPLES = {
  rss: {
    label: 'RSS 订阅',
    text: `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="/rss.xsl"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>开发者周刊</title><link>https://example.com/</link><atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/><description>每周精选：前端、后端与工具链</description><language>zh-CN</language>
<!-- 最新一期 --><item><title>用 &lt;XML&gt; 写配置的 5 个技巧</title><link>https://example.com/posts/xml-tips</link><dc:creator>小明</dc:creator><pubDate>Tue, 24 Sep 2024 08:00:00 +0800</pubDate><category>效率</category><category>开发</category><description><![CDATA[<p>这是一段 <b>HTML</b> 摘要 & 说明，原样保留。</p>]]></description>
<enclosure url="https://example.com/audio/ep42.mp3" length="23456789" type="audio/mpeg"></enclosure><guid isPermaLink="false">post-2024-0924</guid></item><item><title>Tailwind 4 升级笔记</title><link>https://example.com/posts/tailwind-4</link><dc:creator>李雷</dc:creator><pubDate>Mon, 16 Sep 2024 20:30:00 +0800</pubDate><description>记录一次平滑升级：配置迁移、 <em>主题变量</em> 与构建提速。</description></item></channel></rss>`,
  },
  pom: {
    label: 'Maven POM',
    text: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
<modelVersion>4.0.0</modelVersion><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.3.4</version><relativePath/></parent>
<groupId>com.example</groupId><artifactId>order-service</artifactId><version>1.0.0-SNAPSHOT</version><name>订单服务</name><description>负责下单、支付回调与履约通知</description>
<properties><java.version>21</java.version><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
<dependencies><!-- Web 与数据访问 --><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
<dependency><groupId>com.mysql</groupId><artifactId>mysql-connector-j</artifactId><scope>runtime</scope></dependency><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency></dependencies>
<build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>`,
  },
  soap: {
    label: 'SOAP 请求',
    text: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:ord="http://example.com/order/v1"><soap:Header><wsse:Security soap:mustUnderstand="1"><wsse:UsernameToken><wsse:Username>api-user</wsse:Username><wsse:Password Type="PasswordText">******</wsse:Password></wsse:UsernameToken></wsse:Security></soap:Header>
<soap:Body><ord:CreateOrderRequest><ord:CustomerId>10086</ord:CustomerId><ord:Items><ord:Item sku="SKU-8848" qty="1" price="199.90"/><ord:Item sku="SKU-1024" qty="2" price="50.00"/></ord:Items>
<ord:Remark><![CDATA[请在工作日送达，谢谢 <急>]]></ord:Remark><ord:Address province="浙江省" city="杭州市" district="西湖区" street="文三路 138 号" zip="310000" contact="张三" phone="138-0000-0000"/></ord:CreateOrderRequest></soap:Body></soap:Envelope>`,
  },
} as const

export type XmlSampleId = keyof typeof XML_SAMPLES
