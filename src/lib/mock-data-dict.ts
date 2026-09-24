/**
 * 假数据生成用到的词库（纯数据，无依赖）。
 * 行政区划代码取自 GB/T 2260 的真实县级代码，身份证号与统一社会信用代码都会用到。
 */

export interface District {
  code: string
  name: string
}

export interface City {
  name: string
  /** 城市邮编前缀（6 位，末两位生成时随机） */
  zip: string
  districts: District[]
}

export interface Province {
  name: string
  /** 车牌简称 */
  short: string
  /** 直辖市：地址里不重复写城市名 */
  municipality?: boolean
  cities: City[]
}

const d = (list: string): District[] =>
  list.split(' ').map((s) => ({ code: s.slice(0, 6), name: s.slice(6) }))

export const REGIONS: Province[] = [
  {
    name: '北京市',
    short: '京',
    municipality: true,
    cities: [
      {
        name: '北京市',
        zip: '100000',
        districts: d(
          '110101东城区 110102西城区 110105朝阳区 110106丰台区 110107石景山区 110108海淀区 110112通州区 110114昌平区',
        ),
      },
    ],
  },
  {
    name: '天津市',
    short: '津',
    municipality: true,
    cities: [
      {
        name: '天津市',
        zip: '300000',
        districts: d('120101和平区 120102河东区 120103河西区 120104南开区 120116滨海新区'),
      },
    ],
  },
  {
    name: '河北省',
    short: '冀',
    cities: [
      {
        name: '石家庄市',
        zip: '050000',
        districts: d('130102长安区 130104桥西区 130105新华区 130108裕华区'),
      },
      { name: '唐山市', zip: '063000', districts: d('130202路南区 130203路北区') },
      { name: '保定市', zip: '071000', districts: d('130602竞秀区 130606莲池区') },
    ],
  },
  {
    name: '山西省',
    short: '晋',
    cities: [
      { name: '太原市', zip: '030000', districts: d('140105小店区 140106迎泽区 140107杏花岭区') },
    ],
  },
  {
    name: '内蒙古自治区',
    short: '蒙',
    cities: [
      {
        name: '呼和浩特市',
        zip: '010000',
        districts: d('150102新城区 150103回民区 150104玉泉区 150105赛罕区'),
      },
    ],
  },
  {
    name: '辽宁省',
    short: '辽',
    cities: [
      {
        name: '沈阳市',
        zip: '110000',
        districts: d('210102和平区 210103沈河区 210104大东区 210105皇姑区'),
      },
      {
        name: '大连市',
        zip: '116000',
        districts: d('210202中山区 210203西岗区 210204沙河口区 210211甘井子区'),
      },
    ],
  },
  {
    name: '吉林省',
    short: '吉',
    cities: [
      { name: '长春市', zip: '130000', districts: d('220102南关区 220103宽城区 220104朝阳区') },
    ],
  },
  {
    name: '黑龙江省',
    short: '黑',
    cities: [
      { name: '哈尔滨市', zip: '150000', districts: d('230102道里区 230103南岗区 230104道外区') },
    ],
  },
  {
    name: '上海市',
    short: '沪',
    municipality: true,
    cities: [
      {
        name: '上海市',
        zip: '200000',
        districts: d(
          '310101黄浦区 310104徐汇区 310105长宁区 310106静安区 310107普陀区 310109虹口区 310110杨浦区 310112闵行区 310115浦东新区',
        ),
      },
    ],
  },
  {
    name: '江苏省',
    short: '苏',
    cities: [
      {
        name: '南京市',
        zip: '210000',
        districts: d('320102玄武区 320104秦淮区 320105建邺区 320106鼓楼区'),
      },
      { name: '无锡市', zip: '214000', districts: d('320211滨湖区 320213梁溪区') },
      {
        name: '苏州市',
        zip: '215000',
        districts: d('320505虎丘区 320506吴中区 320507相城区 320508姑苏区'),
      },
    ],
  },
  {
    name: '浙江省',
    short: '浙',
    cities: [
      {
        name: '杭州市',
        zip: '310000',
        districts: d(
          '330102上城区 330105拱墅区 330106西湖区 330108滨江区 330109萧山区 330110余杭区',
        ),
      },
      {
        name: '宁波市',
        zip: '315000',
        districts: d('330203海曙区 330205江北区 330206北仑区 330212鄞州区'),
      },
      { name: '温州市', zip: '325000', districts: d('330302鹿城区') },
    ],
  },
  {
    name: '安徽省',
    short: '皖',
    cities: [
      {
        name: '合肥市',
        zip: '230000',
        districts: d('340102瑶海区 340103庐阳区 340104蜀山区 340111包河区'),
      },
    ],
  },
  {
    name: '福建省',
    short: '闽',
    cities: [
      { name: '福州市', zip: '350000', districts: d('350102鼓楼区 350103台江区 350104仓山区') },
      {
        name: '厦门市',
        zip: '361000',
        districts: d('350203思明区 350205海沧区 350206湖里区 350211集美区'),
      },
    ],
  },
  {
    name: '江西省',
    short: '赣',
    cities: [
      { name: '南昌市', zip: '330000', districts: d('360102东湖区 360103西湖区 360111青山湖区') },
    ],
  },
  {
    name: '山东省',
    short: '鲁',
    cities: [
      {
        name: '济南市',
        zip: '250000',
        districts: d('370102历下区 370103市中区 370104槐荫区 370105天桥区'),
      },
      {
        name: '青岛市',
        zip: '266000',
        districts: d('370202市南区 370203市北区 370211黄岛区 370212崂山区'),
      },
    ],
  },
  {
    name: '河南省',
    short: '豫',
    cities: [
      { name: '郑州市', zip: '450000', districts: d('410102中原区 410103二七区 410105金水区') },
      { name: '洛阳市', zip: '471000', districts: d('410303西工区 410311洛龙区') },
    ],
  },
  {
    name: '湖北省',
    short: '鄂',
    cities: [
      {
        name: '武汉市',
        zip: '430000',
        districts: d('420102江岸区 420103江汉区 420104硚口区 420106武昌区 420111洪山区'),
      },
    ],
  },
  {
    name: '湖南省',
    short: '湘',
    cities: [
      {
        name: '长沙市',
        zip: '410000',
        districts: d('430102芙蓉区 430103天心区 430104岳麓区 430105开福区 430111雨花区'),
      },
    ],
  },
  {
    name: '广东省',
    short: '粤',
    cities: [
      {
        name: '广州市',
        zip: '510000',
        districts: d(
          '440103荔湾区 440104越秀区 440105海珠区 440106天河区 440111白云区 440113番禺区',
        ),
      },
      {
        name: '深圳市',
        zip: '518000',
        districts: d('440303罗湖区 440304福田区 440305南山区 440306宝安区 440307龙岗区'),
      },
      { name: '佛山市', zip: '528000', districts: d('440604禅城区 440605南海区 440606顺德区') },
    ],
  },
  {
    name: '广西壮族自治区',
    short: '桂',
    cities: [
      { name: '南宁市', zip: '530000', districts: d('450102兴宁区 450103青秀区 450107西乡塘区') },
    ],
  },
  {
    name: '海南省',
    short: '琼',
    cities: [
      {
        name: '海口市',
        zip: '570000',
        districts: d('460105秀英区 460106龙华区 460107琼山区 460108美兰区'),
      },
    ],
  },
  {
    name: '重庆市',
    short: '渝',
    municipality: true,
    cities: [
      {
        name: '重庆市',
        zip: '400000',
        districts: d(
          '500103渝中区 500105江北区 500106沙坪坝区 500107九龙坡区 500108南岸区 500112渝北区',
        ),
      },
    ],
  },
  {
    name: '四川省',
    short: '川',
    cities: [
      {
        name: '成都市',
        zip: '610000',
        districts: d('510104锦江区 510105青羊区 510106金牛区 510107武侯区 510108成华区'),
      },
    ],
  },
  {
    name: '贵州省',
    short: '贵',
    cities: [
      { name: '贵阳市', zip: '550000', districts: d('520102南明区 520103云岩区 520115观山湖区') },
    ],
  },
  {
    name: '云南省',
    short: '云',
    cities: [
      {
        name: '昆明市',
        zip: '650000',
        districts: d('530102五华区 530103盘龙区 530111官渡区 530112西山区'),
      },
    ],
  },
  {
    name: '西藏自治区',
    short: '藏',
    cities: [{ name: '拉萨市', zip: '850000', districts: d('540102城关区') }],
  },
  {
    name: '陕西省',
    short: '陕',
    cities: [
      {
        name: '西安市',
        zip: '710000',
        districts: d('610102新城区 610103碑林区 610104莲湖区 610112未央区 610113雁塔区'),
      },
    ],
  },
  {
    name: '甘肃省',
    short: '甘',
    cities: [{ name: '兰州市', zip: '730000', districts: d('620102城关区 620103七里河区') }],
  },
  {
    name: '青海省',
    short: '青',
    cities: [
      { name: '西宁市', zip: '810000', districts: d('630102城东区 630103城中区 630104城西区') },
    ],
  },
  {
    name: '宁夏回族自治区',
    short: '宁',
    cities: [
      { name: '银川市', zip: '750000', districts: d('640104兴庆区 640105西夏区 640106金凤区') },
    ],
  },
  {
    name: '新疆维吾尔自治区',
    short: '新',
    cities: [
      {
        name: '乌鲁木齐市',
        zip: '830000',
        districts: d('650102天山区 650103沙依巴克区 650104新市区'),
      },
    ],
  },
]

/** 常见姓氏及大致人口占比（‰），越常见权重越大；末尾几个复姓较少见 */
export const SURNAMES: [string, number][] = (
  '王72 李72 张68 刘54 陈45 杨31 黄22 赵22 吴20 周19 徐17 孙15 马15 朱14 胡13 郭13 何12 高12 林12 罗11 ' +
  '郑11 梁10 谢9 宋8 唐8 许8 韩7 冯7 邓7 曹7 彭7 曾6 肖6 田6 董6 袁6 潘5 于5 蒋5 蔡5 ' +
  '余5 杜5 叶5 程5 苏5 魏5 吕5 丁4 任4 沈4 姚4 卢4 姜4 崔4 钟4 谭4 陆4 汪4 范4 金3 ' +
  '石3 廖3 贾3 夏3 韦3 付3 方3 白3 邹3 孟3 熊3 秦3 邱3 江3 尹3 薛3 闫3 段3 雷3 侯3 ' +
  '龙2 史2 陶2 黎2 贺2 顾2 毛2 郝2 龚2 邵2 万2 钱2 严2 覃2 武2 戴2 莫2 孔2 向2 汤2 ' +
  '欧阳0.3 司马0.1 上官0.1 诸葛0.1'
)
  .split(' ')
  .map((s) => {
    const m = /^(\D+)([\d.]+)$/.exec(s)!
    return [m[1], Number(m[2])]
  })

export const GIVEN_MALE = Array.from(
  '伟强磊军洋勇杰涛明超刚平辉鹏华飞鑫波斌宇浩凯健俊帆帅旭宁龙林阳建峰晨博文志远成然睿轩泽宏毅航哲瑞彬亮东海鸿昊天翔子豪嘉铭',
)

export const GIVEN_FEMALE = Array.from(
  '芳娜敏静丽艳娟霞秀燕玲丹萍红玉兰琳婷雪慧莉倩颖洁佳欣怡琪晶璐梦瑶萱诗雨涵悦思可馨月彤晓蕾薇菲妍岚珊媛',
)

export const EN_FIRST_MALE = [
  'James',
  'John',
  'Robert',
  'Michael',
  'William',
  'David',
  'Richard',
  'Joseph',
  'Thomas',
  'Daniel',
  'Matthew',
  'Andrew',
  'Joshua',
  'Kevin',
  'Brian',
  'Ryan',
  'Jacob',
  'Ethan',
  'Noah',
  'Lucas',
]

export const EN_FIRST_FEMALE = [
  'Mary',
  'Patricia',
  'Jennifer',
  'Linda',
  'Elizabeth',
  'Barbara',
  'Susan',
  'Jessica',
  'Sarah',
  'Karen',
  'Emily',
  'Emma',
  'Olivia',
  'Sophia',
  'Ava',
  'Mia',
  'Grace',
  'Chloe',
  'Lily',
  'Hannah',
]

export const EN_LAST = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor',
  'Moore',
  'Jackson',
  'Martin',
  'Lee',
  'Thompson',
  'White',
  'Harris',
  'Clark',
  'Lewis',
  'Walker',
  'Young',
  'Allen',
  'King',
  'Wright',
]

/** 手机号段（前三位）及权重：13x / 15x / 18x 最常见 */
export const PHONE_PREFIXES: [string, number][] = [
  ...'130 131 132 133 134 135 136 137 138 139'.split(' ').map((p) => [p, 10] as [string, number]),
  ...'150 151 152 153 155 156 157 158 159'.split(' ').map((p) => [p, 8] as [string, number]),
  ...'180 181 182 183 184 185 186 187 188 189'.split(' ').map((p) => [p, 8] as [string, number]),
  ...'170 171 172 173 175 176 177 178'.split(' ').map((p) => [p, 3] as [string, number]),
  ...'145 147 162 165 166 167'.split(' ').map((p) => [p, 2] as [string, number]),
  ...'190 191 192 193 195 196 197 198 199'.split(' ').map((p) => [p, 3] as [string, number]),
]

export const EMAIL_DOMAINS = [
  'qq.com',
  '163.com',
  '126.com',
  'gmail.com',
  'outlook.com',
  'foxmail.com',
  'sina.com',
  'hotmail.com',
  'yahoo.com',
  'icloud.com',
]

export const SAFE_EMAIL_DOMAINS = ['example.com', 'example.net', 'example.org']

export const PINYIN_NAMES = [
  'xiaoming',
  'xiaohong',
  'zhangwei',
  'liuyang',
  'chenjie',
  'wangfang',
  'lina',
  'zhaolei',
  'sunyue',
  'zhoujie',
  'huangxin',
  'linfeng',
  'wujing',
  'gaoyuan',
  'heyu',
  'mayun',
  'songtao',
  'tangli',
]

export const USER_ADJ = [
  'happy',
  'lucky',
  'brave',
  'quiet',
  'sunny',
  'cool',
  'swift',
  'clever',
  'gentle',
  'silent',
  'crazy',
  'lazy',
  'tiny',
  'golden',
  'silver',
  'blue',
  'wild',
  'cosmic',
  'pixel',
  'misty',
]

export const USER_NOUN = [
  'panda',
  'tiger',
  'fox',
  'cat',
  'dog',
  'bear',
  'wolf',
  'eagle',
  'whale',
  'rabbit',
  'coder',
  'ninja',
  'pilot',
  'rider',
  'dream',
  'cloud',
  'star',
  'moon',
  'river',
  'leaf',
]

export const COMPANY_BRANDS =
  '星辰 云帆 华创 智联 腾跃 恒信 鼎盛 远航 天启 蓝海 众合 瑞丰 博远 明德 新元 嘉禾 锐思 卓越 汇通 启明 长青 铭泰 睿达 盛世 宏图 清源 未来 凌云 金石 万象'.split(
    ' ',
  )

export const COMPANY_INDUSTRIES = [
  '科技',
  '网络科技',
  '信息技术',
  '电子商务',
  '文化传媒',
  '贸易',
  '实业',
  '生物科技',
  '教育科技',
  '物流',
  '餐饮管理',
  '建筑工程',
  '医疗器械',
  '新能源',
  '软件',
  '咨询',
]

export const URL_WORDS = [
  'yunfan',
  'xingchen',
  'lanhai',
  'zhilian',
  'qiming',
  'huachuang',
  'boyuan',
  'ruifeng',
  'tengyue',
  'hengxin',
  'mingde',
  'jiahe',
  'ruisi',
  'huitong',
  'lingyun',
]

export const URL_TLDS = ['com', 'cn', 'com.cn', 'net', 'io', 'dev', 'org']

export const URL_PATHS = [
  'products',
  'docs',
  'blog',
  'news',
  'about',
  'help',
  'article',
  'item',
  'api/v1/users',
  'download',
  'events',
  'user/profile',
]

export const STREETS = [
  '人民路',
  '解放路',
  '中山路',
  '建设路',
  '和平路',
  '新华路',
  '文化路',
  '胜利路',
  '长江路',
  '黄河路',
  '科技路',
  '学府路',
  '滨江大道',
  '世纪大道',
  '迎宾大道',
  '朝阳路',
  '东风路',
  '青年路',
  '花园路',
  '幸福路',
  '光明街',
  '民主街',
  '振兴路',
  '体育路',
]

export const COMMUNITIES = [
  '阳光花园',
  '翠苑小区',
  '锦绣华庭',
  '金色家园',
  '书香苑',
  '和谐家园',
  '滨江花园',
  '丽景湾',
  '紫荆苑',
  '春风里',
  '明珠广场',
  '国际公寓',
]

/** 中文句子生成：[动词, 宾语] */
export const SENTENCE_ACTIONS: [string, string][] = [
  ['完成', '新版本的上线'],
  ['整理', '本月的销售数据'],
  ['优化', '系统的整体性能'],
  ['讨论', '下一阶段的工作计划'],
  ['提交', '详细的测试报告'],
  ['收集', '大量真实的用户反馈'],
  ['修复', '登录页面的显示问题'],
  ['更新', '产品的使用文档'],
  ['设计', '全新的品牌视觉'],
  ['筹备', '年度技术分享会'],
  ['梳理', '现有的业务流程'],
  ['评估', '新方案的可行性'],
  ['调整', '首页的推荐策略'],
  ['发布', '移动端的新功能'],
  ['验证', '数据迁移的结果'],
  ['制定', '详细的推广方案'],
  ['重构', '订单模块的核心代码'],
  ['联系', '几位重要的客户'],
  ['准备', '季度复盘的材料'],
  ['改进', '客服响应的效率'],
]

export const SENTENCE_SUBJECTS = [
  '产品团队',
  '我们',
  '研发部门',
  '这位同事',
  '运营小组',
  '客服中心',
  '设计师',
  '项目经理',
  '新来的实习生',
  '合作伙伴',
  '市场部',
  '技术负责人',
  '测试同学',
  '大家',
]

export const SENTENCE_TIMES = [
  '今天上午',
  '昨天晚上',
  '上周',
  '最近',
  '这个季度',
  '周末',
  '月底之前',
  '在过去的一年里',
  '下个月',
  '目前',
  '会议结束后',
  '上线之前',
]

/** 已完成时态可用的副词（后接「动词了」） */
export const ADV_DONE = ['已经', '顺利', '终于', '认真地', '提前', '很快就']
/** 未完成时态可用的副词（后接动词原形） */
export const ADV_TODO = ['正在', '计划', '需要', '尽快', '将会', '准备', '打算', '继续']

export const SENTENCE_CONNECTORS = ['同时，', '此外，', '因此，', '不过，', '另外，', '总的来说，']

/** 以 62 开头的银联卡 BIN */
export const BANK_BINS = [
  '622202',
  '622848',
  '621700',
  '622588',
  '622262',
  '621226',
  '622700',
  '621483',
  '622609',
  '622155',
  '621661',
  '623058',
]
