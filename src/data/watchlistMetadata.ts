export type WatchlistCategory =
  | "ETF / Index"
  | "Thematic ETF"
  | "Mega-cap Tech / AI"
  | "Semiconductors"
  | "Enterprise Software / Cloud"
  | "EV / Growth"
  | "Fintech / Crypto"
  | "Energy / Nuclear"
  | "Space / Aerospace"
  | "Conglomerate / Defensive"
  | "Telecom / Turnaround";

export interface WatchlistNewsItem {
  date: string;
  headline: string;
  impact: string;
  tag: string;
  publishedAt?: string | null;
  source?: string;
  summary?: string;
  url?: string;
}

export interface WatchlistMetadata {
  ticker: string;
  companyName: string;
  category: WatchlistCategory;
  strategyTags: Array<"LEAPS" | "Weekly CSP" | "Core monitor" | "Event risk" | "High beta">;
  monitorReason: string;
  news: WatchlistNewsItem[];
}

export const watchlistMetadata: WatchlistMetadata[] = [
  {
    ticker: "AAPL",
    companyName: "Apple",
    category: "Mega-cap Tech / AI",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "iPhone cycle, services margin, on-device AI adoption, and buyback support.",
    news: [
      {
        date: "2026-06-10",
        headline: "WWDC and Apple Intelligence roadmap remain the main near-term sentiment drivers.",
        impact: "Watch whether AI features can restart upgrade-cycle expectations.",
        tag: "AI / product",
      },
    ],
  },
  {
    ticker: "MSFT",
    companyName: "Microsoft",
    category: "Mega-cap Tech / AI",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "Azure AI demand, Copilot monetization, and enterprise software durability.",
    news: [
      {
        date: "2026-06-12",
        headline: "AI infrastructure spending and cloud growth remain the key debate.",
        impact: "Higher capex can pressure FCF narrative, but demand visibility supports LEAPS setups.",
        tag: "AI / cloud",
      },
    ],
  },
  {
    ticker: "NVDA",
    companyName: "NVIDIA",
    category: "Semiconductors",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor", "High beta"],
    monitorReason: "AI accelerator demand, data-center margins, networking attach, and export risk.",
    news: [
      {
        date: "2026-06-13",
        headline: "Data-center GPU demand and next-generation platform ramp stay central to the thesis.",
        impact: "Large moves can create rich CSP premium, but position sizing needs valuation discipline.",
        tag: "AI chips",
      },
    ],
  },
  {
    ticker: "AMD",
    companyName: "AMD",
    category: "Semiconductors",
    strategyTags: ["LEAPS", "Weekly CSP", "High beta"],
    monitorReason: "AI GPU share gains, server CPU execution, and margin expansion potential.",
    news: [
      {
        date: "2026-06-11",
        headline: "Investor focus remains on MI-series AI accelerator traction versus NVIDIA.",
        impact: "Positive customer proof can re-rate LEAPS; disappointment can widen put premium.",
        tag: "AI chips",
      },
    ],
  },
  {
    ticker: "SMH",
    companyName: "VanEck Semiconductor ETF",
    category: "ETF / Index",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "Cleaner semiconductor basket exposure when single-name event risk is too high.",
    news: [
      {
        date: "2026-06-14",
        headline: "Semiconductor leadership is still tied to AI capex and memory-cycle expectations.",
        impact: "Useful benchmark for whether single-name moves are stock-specific or sector-wide.",
        tag: "sector ETF",
      },
    ],
  },
  {
    ticker: "QQQ",
    companyName: "Invesco QQQ Trust",
    category: "ETF / Index",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "Mega-cap technology beta and broad Nasdaq-100 trend proxy.",
    news: [
      {
        date: "2026-06-14",
        headline: "Nasdaq leadership continues to depend on mega-cap AI and rate expectations.",
        impact: "Good macro filter before taking high-beta single-name option exposure.",
        tag: "index ETF",
      },
    ],
  },
  {
    ticker: "GOOGL",
    companyName: "Alphabet",
    category: "Mega-cap Tech / AI",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "Search AI transition, cloud profitability, YouTube growth, and regulatory risk.",
    news: [
      {
        date: "2026-06-12",
        headline: "AI search competition and antitrust headlines remain the main overhangs.",
        impact: "Event-risk discount can create attractive LEAPS entry if core ad trends hold.",
        tag: "AI / regulation",
      },
    ],
  },
  {
    ticker: "AMZN",
    companyName: "Amazon",
    category: "Mega-cap Tech / AI",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "AWS AI demand, retail margin leverage, ads growth, and fulfillment efficiency.",
    news: [
      {
        date: "2026-06-12",
        headline: "AWS growth and AI infrastructure investments remain the key valuation inputs.",
        impact: "Monitor whether capex converts into revenue acceleration.",
        tag: "cloud / retail",
      },
    ],
  },
  {
    ticker: "AVGO",
    companyName: "Broadcom",
    category: "Semiconductors",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "Custom AI silicon, networking, VMware integration, and cash-flow quality.",
    news: [
      {
        date: "2026-06-13",
        headline: "Custom AI accelerator demand remains the premium multiple driver.",
        impact: "Strong backlog supports LEAPS watch, but high expectations can punish misses.",
        tag: "AI silicon",
      },
    ],
  },
  {
    ticker: "ORCL",
    companyName: "Oracle",
    category: "Enterprise Software / Cloud",
    strategyTags: ["LEAPS", "Weekly CSP", "Event risk"],
    monitorReason: "OCI AI infrastructure backlog, database durability, and leverage after capex ramp.",
    news: [
      {
        date: "2026-06-11",
        headline: "Cloud infrastructure backlog and AI customer wins are driving the debate.",
        impact: "Watch capex intensity versus contracted demand.",
        tag: "cloud",
      },
    ],
  },
  {
    ticker: "META",
    companyName: "Meta Platforms",
    category: "Mega-cap Tech / AI",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "Ads resilience, AI ranking gains, capex discipline, and Reality Labs drag.",
    news: [
      {
        date: "2026-06-12",
        headline: "AI-driven ad performance and infrastructure spending remain the main swing factors.",
        impact: "Useful for both LEAPS trend trades and CSP premium after capex-driven selloffs.",
        tag: "AI / ads",
      },
    ],
  },
  {
    ticker: "TSLA",
    companyName: "Tesla",
    category: "EV / Growth",
    strategyTags: ["Weekly CSP", "Event risk", "High beta"],
    monitorReason: "Delivery trend, autonomy narrative, margin pressure, and headline volatility.",
    news: [
      {
        date: "2026-06-13",
        headline: "Autonomy, robotaxi expectations, and EV demand remain high-volatility catalysts.",
        impact: "Premium is attractive, but event gaps can overwhelm shallow CSP buffers.",
        tag: "EV / autonomy",
      },
    ],
  },
  {
    ticker: "BRK.B",
    companyName: "Berkshire Hathaway",
    category: "Conglomerate / Defensive",
    strategyTags: ["LEAPS", "Core monitor"],
    monitorReason: "Defensive compounder, cash optionality, insurance earnings, and lower beta ballast.",
    news: [
      {
        date: "2026-06-10",
        headline: "Succession, cash deployment, and insurance performance remain central topics.",
        impact: "Better suited for LEAPS-style exposure than rich weekly premium hunting.",
        tag: "defensive",
      },
    ],
  },
  {
    ticker: "MRVL",
    companyName: "Marvell Technology",
    category: "Semiconductors",
    strategyTags: ["LEAPS", "Weekly CSP", "High beta"],
    monitorReason: "AI networking, custom silicon exposure, and cyclical storage/networking recovery.",
    news: [
      {
        date: "2026-06-11",
        headline: "AI networking and custom compute demand are the main growth levers.",
        impact: "Watch for order visibility and gross-margin recovery.",
        tag: "AI networking",
      },
    ],
  },
  {
    ticker: "NOK",
    companyName: "Nokia",
    category: "Telecom / Turnaround",
    strategyTags: ["LEAPS", "Event risk"],
    monitorReason: "Telecom equipment cycle, cost actions, patent income, and turnaround optionality.",
    news: [
      {
        date: "2026-06-10",
        headline: "Carrier spending recovery and restructuring progress remain the thesis drivers.",
        impact: "Low-priced options need extra liquidity checks before sizing.",
        tag: "turnaround",
      },
    ],
  },
  {
    ticker: "MU",
    companyName: "Micron",
    category: "Semiconductors",
    strategyTags: ["LEAPS", "Weekly CSP", "High beta"],
    monitorReason: "HBM demand, DRAM/NAND pricing cycle, and AI memory shortage dynamics.",
    news: [
      {
        date: "2026-06-13",
        headline: "HBM supply and memory pricing are still the main earnings-sensitivity variables.",
        impact: "Good candidate for event-aware CSP only when earnings timing is controlled.",
        tag: "memory",
      },
    ],
  },
  {
    ticker: "INTC",
    companyName: "Intel",
    category: "Semiconductors",
    strategyTags: ["LEAPS", "Weekly CSP", "Event risk"],
    monitorReason: "Foundry execution, PC/server recovery, balance-sheet pressure, and turnaround risk.",
    news: [
      {
        date: "2026-06-12",
        headline: "Foundry roadmap execution and strategic restructuring remain the key issues.",
        impact: "LEAPS upside is turnaround-driven, but liquidity and headline risk need care.",
        tag: "turnaround",
      },
    ],
  },
  {
    ticker: "QCOM",
    companyName: "Qualcomm",
    category: "Semiconductors",
    strategyTags: ["LEAPS", "Weekly CSP"],
    monitorReason: "Handset recovery, automotive/IoT growth, AI PC exposure, and licensing durability.",
    news: [
      {
        date: "2026-06-11",
        headline: "AI PC and handset upgrade-cycle expectations remain important catalysts.",
        impact: "Monitor Apple modem risk and diversification progress.",
        tag: "mobile chips",
      },
    ],
  },
  {
    ticker: "ASX",
    companyName: "ASE Technology",
    category: "Semiconductors",
    strategyTags: ["LEAPS"],
    monitorReason: "Advanced packaging demand and semiconductor cycle recovery.",
    news: [
      {
        date: "2026-06-10",
        headline: "Advanced packaging capacity remains strategically important for AI chips.",
        impact: "Options liquidity may be thinner than U.S. mega-cap semis.",
        tag: "packaging",
      },
    ],
  },
  {
    ticker: "HOOD",
    companyName: "Robinhood",
    category: "Fintech / Crypto",
    strategyTags: ["Weekly CSP", "High beta", "Event risk"],
    monitorReason: "Trading activity, crypto volumes, product expansion, and retail risk appetite.",
    news: [
      {
        date: "2026-06-13",
        headline: "Crypto activity and product launches remain major sentiment drivers.",
        impact: "High IV can help CSP premium, but risk-on reversals can be sharp.",
        tag: "fintech",
      },
    ],
  },
  {
    ticker: "CRCL",
    companyName: "Circle Internet Group",
    category: "Fintech / Crypto",
    strategyTags: ["Weekly CSP", "High beta", "Event risk"],
    monitorReason: "Stablecoin adoption, rate sensitivity, crypto regulation, and post-listing volatility.",
    news: [
      {
        date: "2026-06-14",
        headline: "Stablecoin regulation and post-IPO trading dynamics dominate near-term risk.",
        impact: "Treat as event-risk premium, not a normal low-volatility CSP name.",
        tag: "crypto",
      },
    ],
  },
  {
    ticker: "SMR",
    companyName: "NuScale Power",
    category: "Energy / Nuclear",
    strategyTags: ["LEAPS", "Weekly CSP", "High beta", "Event risk"],
    monitorReason: "Small modular reactor commercialization, policy support, and project financing risk.",
    news: [
      {
        date: "2026-06-12",
        headline: "Nuclear power demand from AI data centers keeps the story active.",
        impact: "High narrative beta; prefer explicit event tags before CSP trades.",
        tag: "nuclear",
      },
    ],
  },
  {
    ticker: "NOW",
    companyName: "ServiceNow",
    category: "Enterprise Software / Cloud",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "Enterprise workflow durability, AI monetization, and large-account expansion.",
    news: [
      {
        date: "2026-06-11",
        headline: "AI workflow products and enterprise spending trends remain key catalysts.",
        impact: "Quality compounder profile suits LEAPS when IV is not stretched.",
        tag: "software",
      },
    ],
  },
  {
    ticker: "SPY",
    companyName: "SPDR S&P 500 ETF",
    category: "ETF / Index",
    strategyTags: ["LEAPS", "Weekly CSP", "Core monitor"],
    monitorReason: "Broad U.S. equity benchmark and macro risk gauge.",
    news: [
      {
        date: "2026-06-14",
        headline: "Rate expectations, earnings breadth, and AI concentration drive index risk.",
        impact: "Useful baseline before taking single-name beta.",
        tag: "index ETF",
      },
    ],
  },
  {
    ticker: "EWY",
    companyName: "iShares MSCI South Korea ETF",
    category: "ETF / Index",
    strategyTags: ["LEAPS", "Weekly CSP"],
    monitorReason: "Korea market exposure with memory, electronics, and export-cycle sensitivity.",
    news: [
      {
        date: "2026-06-10",
        headline: "Memory-cycle recovery and Korea export data remain the main macro links.",
        impact: "Works as a country/semiconductor-cycle proxy.",
        tag: "country ETF",
      },
    ],
  },
  {
    ticker: "PLTR",
    companyName: "Palantir",
    category: "Enterprise Software / Cloud",
    strategyTags: ["LEAPS", "Weekly CSP", "High beta"],
    monitorReason: "AIP adoption, government/commercial growth, margin durability, and valuation risk.",
    news: [
      {
        date: "2026-06-13",
        headline: "AI platform adoption and valuation remain the center of the bull/bear debate.",
        impact: "High momentum name; require wider risk buffers for CSP.",
        tag: "AI software",
      },
    ],
  },
  {
    ticker: "SPCX",
    companyName: "Space Exploration Technologies",
    category: "Space / Aerospace",
    strategyTags: ["LEAPS", "Weekly CSP", "Event risk", "High beta"],
    monitorReason: "SpaceX public equity exposure with Starlink, launch, defense, and post-IPO volatility drivers.",
    news: [
      {
        date: "2026-06-16",
        headline: "SpaceX recently began trading under SPCX, with post-IPO volatility and index-inclusion flows in focus.",
        impact: "Treat as a high-beta single stock; verify option liquidity and event gaps before CSP sizing.",
        tag: "IPO / space",
      },
    ],
  },
  {
    ticker: "SOXL",
    companyName: "Direxion Daily Semiconductor Bull 3X Shares",
    category: "Thematic ETF",
    strategyTags: ["Weekly CSP", "High beta", "Event risk"],
    monitorReason: "Leveraged semiconductor beta for tactical premium only, not core exposure.",
    news: [
      {
        date: "2026-06-14",
        headline: "Leveraged semiconductor exposure magnifies AI-chip sector moves.",
        impact: "Use strict sizing; decay and gap risk make it different from SMH.",
        tag: "leveraged ETF",
      },
    ],
  },
  {
    ticker: "SNDK",
    companyName: "SanDisk",
    category: "Semiconductors",
    strategyTags: ["Weekly CSP", "High beta", "Event risk"],
    monitorReason: "Storage and memory-cycle exposure with elevated event risk.",
    news: [
      {
        date: "2026-06-10",
        headline: "NAND pricing and storage demand are the primary monitor points.",
        impact: "Check liquidity and corporate-action context before relying on options signals.",
        tag: "storage",
      },
    ],
  },
];
