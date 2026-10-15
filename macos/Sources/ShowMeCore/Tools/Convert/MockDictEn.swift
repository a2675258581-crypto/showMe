import Foundation

// 英文风格假数据用到的词库（虚构的品牌、555-01xx 虚构电话号段）。
extension MockDict {
    struct USCity {
        let name: String
        let state: String
        let stateName: String
        /// 邮编前三位
        let zip: String
        /// 电话区号
        let area: String
    }

    static let usCities: [USCity] = [
        USCity(name: "New York", state: "NY", stateName: "New York", zip: "100", area: "212"),
        USCity(name: "Los Angeles", state: "CA", stateName: "California", zip: "900", area: "213"),
        USCity(name: "Chicago", state: "IL", stateName: "Illinois", zip: "606", area: "312"),
        USCity(name: "Houston", state: "TX", stateName: "Texas", zip: "770", area: "713"),
        USCity(name: "Phoenix", state: "AZ", stateName: "Arizona", zip: "850", area: "602"),
        USCity(name: "Philadelphia", state: "PA", stateName: "Pennsylvania", zip: "191", area: "215"),
        USCity(name: "San Antonio", state: "TX", stateName: "Texas", zip: "782", area: "210"),
        USCity(name: "San Diego", state: "CA", stateName: "California", zip: "921", area: "619"),
        USCity(name: "Dallas", state: "TX", stateName: "Texas", zip: "752", area: "214"),
        USCity(name: "Austin", state: "TX", stateName: "Texas", zip: "787", area: "512"),
        USCity(name: "Seattle", state: "WA", stateName: "Washington", zip: "981", area: "206"),
        USCity(name: "Denver", state: "CO", stateName: "Colorado", zip: "802", area: "303"),
        USCity(name: "Boston", state: "MA", stateName: "Massachusetts", zip: "021", area: "617"),
        USCity(name: "Portland", state: "OR", stateName: "Oregon", zip: "972", area: "503"),
        USCity(name: "Miami", state: "FL", stateName: "Florida", zip: "331", area: "305"),
        USCity(name: "Atlanta", state: "GA", stateName: "Georgia", zip: "303", area: "404"),
        USCity(name: "San Francisco", state: "CA", stateName: "California", zip: "941", area: "415"),
        USCity(name: "Nashville", state: "TN", stateName: "Tennessee", zip: "372", area: "615"),
        USCity(name: "Minneapolis", state: "MN", stateName: "Minnesota", zip: "554", area: "612"),
        USCity(name: "Salt Lake City", state: "UT", stateName: "Utah", zip: "841", area: "801"),
    ]

    static let enStreets = [
        "Maple", "Oak", "Pine", "Cedar", "Elm", "Washington", "Lake", "Hill", "Park", "Main", "Sunset", "Lincoln",
        "Jefferson", "Madison", "River", "Highland", "Spring", "Church", "Willow", "Chestnut", "Meadow", "Forest",
    ]
    static let enStreetSuffixes = ["St", "Ave", "Rd", "Blvd", "Ln", "Dr", "Ct", "Way", "Pl"]

    static let enCompanyBrands = [
        "Bluepeak", "Northwind", "Silverline", "Brightpath", "Cedarwood", "Redstone", "Clearwater", "Ironbridge", "Summitview",
        "Evergreen", "Pinnacle", "Lakeside", "Horizon", "Starlight", "Oakridge", "Riverstone", "Goldleaf", "Skyhaven",
    ]
    static let enCompanyIndustries = [
        "Technologies", "Software", "Analytics", "Logistics", "Media", "Labs", "Consulting", "Health", "Energy", "Foods",
        "Systems", "Networks", "Studios", "Partners", "Robotics", "Design",
    ]
    static let enCompanySuffixes: [(String, Double)] = [("Inc.", 40), ("LLC", 30), ("Ltd.", 10), ("Corp.", 12), ("Group", 8)]

    static let enEmailDomains = ["gmail.com", "outlook.com", "yahoo.com", "icloud.com", "hotmail.com", "proton.me", "aol.com", "mail.com"]
    static let enUrlWords = [
        "bluepeak", "northwind", "silverline", "brightpath", "cedarwood", "redstone", "clearwater", "ironbridge",
        "evergreen", "pinnacle", "lakeside", "starlight", "oakridge", "riverstone",
    ]
    static let enUrlTlds = ["com", "io", "dev", "net", "org", "co", "app"]

    static let enSubjects = [
        "The product team", "Our designers", "The support center", "Engineering", "The project manager", "A new intern",
        "Our partners", "The marketing team", "The tech lead", "The QA team", "Everyone", "The operations team",
    ]
    /// [过去式, 原形]
    static let enVerbs: [(String, String)] = [
        ("finished", "finish"), ("reviewed", "review"), ("optimized", "optimize"), ("discussed", "discuss"),
        ("submitted", "submit"), ("collected", "collect"), ("fixed", "fix"), ("updated", "update"), ("designed", "design"),
        ("planned", "plan"), ("evaluated", "evaluate"), ("published", "publish"), ("tested", "test"),
        ("refactored", "refactor"), ("prepared", "prepare"), ("improved", "improve"),
    ]
    static let enObjects = [
        "the new release", "the monthly sales report", "the overall performance", "the next quarter's roadmap",
        "a detailed test report", "real user feedback", "the login page bug", "the product documentation",
        "a fresh brand identity", "the annual tech talk", "the existing workflow", "the new proposal",
        "the home page layout", "the mobile app features", "the data migration", "the customer onboarding flow",
    ]
    static let enTimes = [
        "This morning", "Last night", "Last week", "Recently", "This quarter", "Over the weekend", "Before the deadline",
        "After the meeting", "Earlier today", "So far this year",
    ]
    static let enAdverbsDone = ["already", "finally", "carefully", "quickly", "successfully"]
    static let enModals = ["will", "should", "will soon", "can now", "must"]
    static let enConnectors = ["Meanwhile, ", "In addition, ", "As a result, ", "However, ", "Overall, ", "On top of that, "]
}
