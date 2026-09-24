/** 代码格式化的示例（故意写得比较乱，方便看出格式化效果） */
import type { CodeLang } from './code-formatter'

export const CODE_SAMPLES: Record<CodeLang, string> = {
  javascript: `// 购物车结算：计算小计、应用最优惠的优惠券并加税
import {fetchCoupons} from './api.js'
const TAX_RATE=0.06

export async function checkout(cart,{couponCode,memberLevel='普通'}={}){
  const subtotal=cart.items.reduce((sum,item)=>sum+item.price*item.qty,0)
  const coupons=await fetchCoupons(couponCode)
  const discount=coupons.filter(c=>c.minSpend<=subtotal).map(c=>c.type==='percent'?subtotal*c.value/100:c.value).reduce((a,b)=>Math.max(a,b),0)
  const total=(subtotal-discount)*(1+TAX_RATE)
  return {subtotal,discount,total:Math.round(total*100)/100,message:\`已为「\${memberLevel}」会员节省 ¥\${discount.toFixed(2)} 🎉\`}
}
`,

  jsx: `import {useState} from 'react'

export default function TodoList({initialTodos=[]}){
  const [todos,setTodos]=useState(initialTodos)
  const [text,setText]=useState('')
  const add=()=>{if(!text.trim())return;setTodos([...todos,{id:Date.now(),text,done:false}]);setText('')}
  return <div className="todo">
    <h2>待办事项（{todos.filter(t=>!t.done).length}）</h2>
    <input value={text} onChange={e=>setText(e.target.value)} placeholder="添加新任务…" onKeyDown={e=>e.key==='Enter'&&add()}/>
    <ul>{todos.map(t=><li key={t.id} className={t.done?'done':''} onClick={()=>setTodos(todos.map(x=>x.id===t.id?{...x,done:!x.done}:x))}>{t.text}</li>)}</ul>
  </div>
}
`,

  typescript: `// 带重试与超时的请求封装
export interface RequestOptions<T=unknown>{url:string;method?:'GET'|'POST'|'PUT'|'DELETE';body?:T;retries?:number;timeoutMs?:number}
type Result<R>={ok:true;data:R}|{ok:false;error:string}

export class HttpClient{
  private readonly baseUrl:string
  constructor(baseUrl:string,private token?:string){this.baseUrl=baseUrl.replace(/\\/$/,'')}
  async request<R,T=unknown>({url,method='GET',body,retries=2,timeoutMs=8000}:RequestOptions<T>):Promise<Result<R>>{
    for(let attempt=0;attempt<=retries;attempt++){
      const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeoutMs)
      try{
        const res=await fetch(\`\${this.baseUrl}\${url}\`,{method,body:body?JSON.stringify(body):undefined,headers:{'Content-Type':'application/json',...(this.token?{Authorization:\`Bearer \${this.token}\`}:{})},signal:ctrl.signal})
        if(!res.ok)throw new Error(\`HTTP \${res.status}\`)
        return {ok:true,data:await res.json() as R}
      }catch(e){if(attempt===retries)return {ok:false,error:e instanceof Error?e.message:'请求失败'}}
      finally{clearTimeout(timer)}
    }
    return {ok:false,error:'unreachable'}
  }
}
`,

  tsx: `import {useMemo,useState} from 'react'
type Product={id:number;name:string;price:number;tags:string[]}
interface Props{products:Product[];onSelect?:(p:Product)=>void}

export function ProductGrid({products,onSelect}:Props){
  const [keyword,setKeyword]=useState<string>('')
  const visible=useMemo(()=>products.filter(p=>p.name.includes(keyword)||p.tags.some(t=>t.includes(keyword))),[products,keyword])
  return (<section>
    <input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="搜索商品"/>
    <div className="grid">{visible.map(p=><button key={p.id} onClick={()=>onSelect?.(p)}><strong>{p.name}</strong><span>¥{p.price.toFixed(2)}</span></button>)}</div>
    {visible.length===0&&<p className="empty">没有找到「{keyword}」相关的商品 😢</p>}
  </section>)
}
`,

  json: `{"name":"showme","version":"1.0.0","private":true,"scripts":{"dev":"vite","build":"tsc -b && vite build","test":"vitest run"},"dependencies":{"react":"^19.0.0","react-dom":"^19.0.0"},"author":{"name":"张三","email":"zhangsan@example.com"},"keywords":["开发者工具","developer","json","🧰"]}
`,

  json5: `// 应用配置（JSON5：支持注释、不加引号的键、单引号与尾随逗号）
{appName:'showMe',port:5173,
/* 功能开关 */ features:{darkMode:true,beta:false,},
allowedHosts:['localhost','127.0.0.1',],themeColor:0x0071e3,ratio:.75,
greeting:"你好，世界"}
`,

  css: `/* 卡片组件 */
:root{--accent:#0071e3;--radius:18px}
.card{display:flex;flex-direction:column;gap:12px;padding:24px;border-radius:var(--radius);background:rgba(255,255,255,.8);backdrop-filter:blur(20px);box-shadow:0 2px 12px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.06);transition:transform .3s cubic-bezier(.28,.11,.32,1)}
.card:hover{transform:translateY(-4px) scale(1.01)}
.card .title::before{content:"✨ ";font:600 21px/1.2 -apple-system,"PingFang SC",sans-serif}
@media (prefers-color-scheme:dark){.card{background:rgba(28,28,30,.8)}.card .title{color:#f5f5f7}}
`,

  scss: `// 按钮组件
@use 'sass:math';
$accent:#0071e3;$radius:980px;
@mixin pill($h:44px){height:$h;padding:0 math.div($h,2);border-radius:$radius}
.btn{@include pill;display:inline-flex;align-items:center;background:$accent;color:#fff;
  &:hover{background:lighten($accent,6%)}
  &--small{@include pill(32px);font-size:13px}
  &.is-loading::after{content:"加载中…";margin-left:#{math.div(8px,2)}}
}
`,

  less: `// 主题变量与混入
@primary:#0071e3;@radius:12px;
.rounded(@r:@radius){border-radius:@r}
.theme(@mode) when (@mode = dark){background:#1c1c1e;color:#f5f5f7}
.panel{.rounded();padding:16px;border:1px solid fade(@primary,20%);
  .header{font-weight:600;color:darken(@primary,10%)}
  &:hover{box-shadow:0 4px 12px fade(#000,12%)}
  .theme(dark);
}
@media (max-width:768px){.panel{padding:12px;.rounded(8px)}}
`,

  html: `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>showMe 开发者工具</title>
<style>body{margin:0;font-family:-apple-system,sans-serif}.hero{padding:80px 20px;text-align:center}</style></head>
<body><header class="hero"><h1>更快地完成<em>日常开发</em>工作</h1><p>所有工具都在浏览器本地运行，数据不会上传。</p>
<a class="btn" href="/tools">开始使用 →</a></header>
<ul class="features"><li>JSON 格式化</li><li>正则测试</li><li>时间戳转换</li></ul>
<script>document.querySelector('.btn').addEventListener('click',()=>{localStorage.setItem('visited','1')})</script>
</body></html>
`,

  vue: `<template>
<div class="counter"><h2>{{title}}</h2>
<button @click="count--" :disabled="count<=0">-</button><span :class="{big:count>10}">{{count}}</span><button @click="count++">+</button>
<p v-if="count>=10">已经点了 {{count}} 次啦 🎉</p></div>
</template>

<script setup>
import {ref,computed} from 'vue'
const props=defineProps({title:{type:String,default:'计数器'}})
const count=ref(0)
const doubled=computed(()=>count.value*2)
</script>

<style scoped>
.counter{display:flex;gap:8px;align-items:center}.big{font-size:2em;color:#ff3b30}
</style>
`,

  angular: `<div class="user-list"><h2>用户列表（{{users.length}}）</h2>
<input [(ngModel)]="keyword" placeholder="搜索用户" (keyup.enter)="search()"/>
<ul><li *ngFor="let u of filtered;trackBy:trackById" [class.active]="u.id===selectedId" (click)="select(u)">{{u.name|titlecase}} · {{u.createdAt|date:'yyyy-MM-dd'}}</li></ul>
<p *ngIf="!filtered.length">没有匹配「{{keyword}}」的用户</p>
@if(loading){<app-spinner size="small"/>}
</div>
`,

  markdown: `# showMe 使用指南
showMe 是一组**完全本地运行**的开发者小工具，打开即用。
## 快速开始
1. 打开 [工具列表](/tools)
2. 选择需要的工具
3. 粘贴内容，结果*实时*显示

* 支持深色模式
* 支持键盘快捷键
* 支持拖入文件

| 工具 | 分类 | 快捷键 |
|---|:-:|--:|
| JSON 格式化 | 格式化 | ⌘J |
| 时间戳 | 转换 | ⌘T |

\`\`\`js
const  greeting={text:"你好，世界",emoji:'👋'}
\`\`\`
> 提示：所有数据都不会上传到服务器。
`,

  yaml: `# GitHub Actions：推送时自动测试并部署
name:   CI
on:
  push: {branches: [main]}
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [ 20,22 ]
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: {node-version: "\${{ matrix.node }}", cache: npm}
    - run: npm ci
    - run:   npm test -- --coverage
    - name: 部署到生产环境
      if: github.ref == 'refs/heads/main'
      run: |
        npm run build
        npx wrangler deploy
`,

  graphql: `# 查询用户订单（分页 + 片段）
query GetOrders($userId:ID!,$first:Int=10,$after:String){user(id:$userId){id name orders(first:$first,after:$after,filter:{status:[PAID,SHIPPED]}){edges{node{...OrderFields}}pageInfo{hasNextPage endCursor}}}}
fragment OrderFields on Order{id createdAt total{amount currency} items{product{name} quantity}}
`,
}
