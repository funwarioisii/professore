import { promises as fs } from "node:fs";
import { Project } from "../src/core/schema.ts";
const event = (target: string, action: string, at = "start", fade = 0) => ({
  target,
  action,
  at,
  fade,
});
const beat = (id: string, narration: string, events: any[]) => ({
  id,
  narration,
  before: 0.25,
  after: 0.6,
  events,
});
const sample = {
  schemaVersion: 1,
  id: "oauth",
  title: "OAuthの認可コードフロー",
  language: "ja-JP",
  audience: "Webアプリを作るソフトウェアエンジニア",
  prerequisites: ["HTTPリクエストとブラウザのリダイレクト"],
  learningGoals: [
    "認可コードとアクセストークンの役割を区別する",
    "認可要求からAPI呼び出しまでの順序を説明する",
  ],
  outOfScope: [
    "OpenID Connectによるログイン",
    "リフレッシュトークン",
    "全ての脅威と対策",
  ],
  targetDuration: 100,
  sources: [
    {
      title: "RFC 6749 §4.1 Authorization Code Grant",
      url: "https://www.rfc-editor.org/rfc/rfc6749.html#section-4.1",
      note: "基本の登場人物と交換順序",
    },
    {
      title: "RFC 9700 §2.1.1 Security Best Current Practice",
      url: "https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1",
      note: "PKCEを含む現在のセキュリティ指針",
    },
  ],
  settings: {
    width: 1920,
    height: 1080,
    fps: 30,
    theme: "midnight",
    font: "Hiragino Sans",
    subtitles: true,
    tts: { provider: "macos-say", voice: "Kyoko", rate: 185 },
    pronunciations: {
      OAuth: "オーオース",
      API: "エーピーアイ",
      PKCE: "ピクシー",
      HTTP: "エイチティーティーピー",
    },
  },
  assets: {
    token: {
      type: "svg",
      data: await fs.readFile("examples/assets/token.svg", "utf8"),
    },
  },
  scenes: [
    {
      id: "delegation",
      title: "パスワードを渡さず、権限を委譲する",
      purpose: "最初に「何を解決するのか」をそろえる",
      layout: "compare",
      body: "",
      elements: [
        {
          id: "authorization",
          kind: "markdown",
          content:
            "## OAuth = 認可\n- アプリに必要なアクセスを許可\n- パスワードをアプリに共有しない\n- 許可する範囲は scope で指定",
          visible: true,
        },
        {
          id: "roles",
          kind: "markdown",
          content:
            "## 登場人物\n1. ユーザー\n2. アプリ（クライアント）\n3. 認可サーバー\n4. API（リソースサーバー）",
          visible: false,
        },
      ],
      beats: [
        beat(
          "why",
          "OAuthは、ユーザーがアプリにアクセス権限を渡すための仕組みです。たとえば写真を整理するアプリに、写真の読み取りだけを許可します。パスワードをアプリに渡す必要はありません。",
          [event("authorization", "highlight")],
        ),
        beat(
          "who",
          "登場人物は、ユーザー、アプリ、認可サーバー、そしてデータを持つAPIです。この動画では認可の流れに集中します。ユーザーのログインをアプリに伝える仕組みは、別の話です。",
          [
            event("authorization", "unhighlight"),
            event("roles", "show", "start", 0.2),
            event("roles", "highlight"),
          ],
        ),
      ],
    },
    {
      id: "redirect",
      title: "ブラウザで許可を求め、コードを受け取る",
      purpose: "ブラウザを通るやり取りを把握する",
      layout: "diagram",
      body: "## 認可リクエスト\n- アプリから認可サーバーへ\n- ユーザーが確認・許可\n- 戻り先で code を受け取る",
      elements: [
        {
          id: "flow",
          kind: "mermaid",
          content:
            "flowchart TD\n U[ユーザーのブラウザ] -->|1. 連携を開始| A[アプリ]\n A -->|2. 認可要求| S[認可サーバー]\n S -->|3. 認証と許可| U\n S -->|4. ブラウザ経由でコード| A",
          visible: true,
        },
      ],
      beats: [
        beat(
          "request",
          "ユーザーが連携を始めると、アプリはブラウザを認可サーバーへ移動させます。要求にはアプリの識別子、戻り先、必要な権限などを含めます。ユーザーは認可サーバー側で認証し、アクセスを許可します。",
          [event("flow", "highlight")],
        ),
        beat(
          "callback",
          "許可されると、ブラウザは登録されたアプリの戻り先へ進み、認可コードを届けます。このコードは短命で、一度だけ使います。コードそのものを使って、写真のAPIを呼ぶわけではありません。",
          [event("flow", "unhighlight")],
        ),
      ],
    },
    {
      id: "exchangeScene",
      title: "コードを交換して、APIにアクセスする",
      purpose: "コードとトークンの用途を区別する",
      layout: "full",
      body: "",
      elements: [
        { id: "exchangeDiagram", kind: "asset", asset: "token", visible: true },
        {
          id: "apiExample",
          kind: "markdown",
          content:
            "## APIへのリクエスト例\n```http\nAuthorization: Bearer <access_token>\n```\nアクセストークンの権限範囲でデータにアクセス",
          visible: false,
        },
      ],
      beats: [
        beat(
          "exchangeBeat",
          "次にアプリは、認可コードを認可サーバーのトークンエンドポイントへ送ります。検証に成功すると、アクセストークンが返ります。秘密情報を安全に保持できるアプリでは、ここでクライアント認証も行います。",
          [
            event("exchangeDiagram#code", "highlight"),
            event("exchangeDiagram#token", "highlight", "end"),
          ],
        ),
        beat(
          "access",
          "アプリはアクセストークンを付けてAPIを呼び出します。APIはトークンと権限を検証し、許可されたデータを返します。認可コードは交換用、アクセストークンはAPIへのアクセス用と覚えましょう。",
          [
            event("exchangeDiagram#code", "unhighlight"),
            event("apiExample", "show", "start", 0.2),
            event("apiExample", "highlight"),
          ],
        ),
      ],
    },
    {
      id: "security",
      title: "PKCEで、要求とコード交換を結び付ける",
      purpose: "実装時に省略できない安全性の入口を示す",
      layout: "compare",
      body: "",
      elements: [
        {
          id: "pkce",
          kind: "markdown",
          content:
            "## PKCE\n1. verifier をアプリで生成・保持\n2. 認可要求に challenge を付ける\n3. 交換時に verifier を提示\n\n認可要求とコード交換を結び付ける",
          visible: true,
        },
        {
          id: "checks",
          kind: "markdown",
          content:
            "## 実装前の確認\n- リダイレクトURIを厳密に検証\n- CSRF対策を行う\n- HTTPSを使う\n- トークンをログに残さない\n\n参照：RFC 6749 §4.1 / RFC 9700 §2.1.1",
          visible: false,
        },
      ],
      beats: [
        beat(
          "pkceBeat",
          "コードが途中で盗まれる場合に備え、PKCEで認可要求と交換を結び付けます。アプリは秘密の値を保持し、その変換結果を最初の要求に付けます。交換時に元の値を示せることを確認します。",
          [event("pkce", "highlight")],
        ),
        beat(
          "recap",
          "現在の指針では、公開クライアントにPKCEが必須で、機密クライアントにも推奨されます。戻り先の検証や、リクエストのすり替え対策も必要です。流れは、許可を求める、コードを交換する、トークンでAPIを呼ぶ、の三段階です。",
          [
            event("pkce", "unhighlight"),
            event("checks", "show", "start", 0.2),
            event("checks", "highlight"),
          ],
        ),
      ],
    },
  ],
};
await fs.writeFile(
  "examples/oauth.json",
  JSON.stringify(Project.parse(sample), null, 2),
);
