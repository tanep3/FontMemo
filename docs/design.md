# FontMemo システム設計書 v0.1（レビュー用ドラフト）

**作成日：** 2026年11月19日
**対応要件：** docs/requirements.md v0.3.1（FR 番号は同書を参照）

---

## 1. 全体像

FontMemo は1画面の Web アプリ。要件の処理は1本のパイプラインに集約する。

```
文章入力＋設定
  → レイアウト（折り返し・寸法確定・上限チェック）
  → 描画（白背景・黒文字、AA あり）
  → 二値化（大津法）
  → プレビュー表示（欠字マーカー重畳）／ PNG 保存・共有
```

端から端までの流れ（通常モード）：

1. ユーザーが文章を入力し、フォント・文字サイズ・幅プリセットを選ぶ
2. 入力のたびにレイアウトが再計算され、プレビューが更新される（デバウンス 150ms）
3. 欠字があれば、プレビューの該当文字にマーカーが付き、警告バーに文字が列挙される
4. 「保存」または「共有」で、二値化済み PNG がファイル名規則（FR-09）で出力される

技術スタックは他アプリと揃える：TypeScript ＋ Vite、静的ホスティング、PWA（manifest ＋ Service Worker）。Rust コアは持たない（画像処理は Canvas と画素処理で足りる）。

## 2. モジュール一覧

| モジュール | 役割 |
|---|---|
| `app/main.ts` | 画面の結線、プレビューパイプラインの駆動、警告表示 |
| `app/settings.ts` | 設定の読み書き（localStorage、FR-12） |
| `app/i18n.ts` | 日英の文言辞書と切替 |
| `fonts/fontStore.ts` | 取り込みフォントの永続化（IndexedDB、FR-04） |
| `fonts/fontMeta.ts` | フォント形式判定と name テーブルからの名前抽出 |
| `fonts/cmap.ts` | cmap 解析・収録判定・欠字抽出（FR-02） |
| `fonts/loader.ts` | FontFace 登録とフォールバックチェーン構築 |
| `fonts/localFonts.ts` | Local Font Access API による端末フォント列挙（段階的強化、Chromium のみ） |
| `fonts/unzip.ts` | ZIP からのフォント抽出（採用は未決事項 §8-1） |
| `core/layout.ts` | 折り返し・寸法計算・上限チェック（FR-06/07/09/14） |
| `core/render.ts` | Canvas 描画と横モード回転（FR-14） |
| `core/binarize.ts` | 大津法による二値化（FR-15） |
| `core/caps.ts` | プラットフォーム別 Canvas 上限テーブル |
| `core/saveName.ts` | 保存ファイル名規則（4アプリ共通） |
| `core/share.ts` | 共有シート／ダウンロードの振り分け（FR-09） |

### 主要な関数表面

**fonts/cmap.ts**

- `parseCmap(buf: ArrayBuffer): Coverage | null` — sfnt の cmap テーブルから収録範囲（開始・終了コードポイントのソート済み範囲列）を返す。サブテーブルは format 12（platform 3, encoding 10）を優先し、format 4（3,1）、format 6 の順に探す。TTC は先頭フォントの cmap を使う。WOFF/WOFF2 では null（v1 では収録判定の対象外、§8-2）
- `covers(cov: Coverage, cp: number): boolean` — 二分探索で判定
- `missingChars(cov: Coverage, text: string): string[]` — 文章中の未収録文字を重複なしで返す

**fonts/fontStore.ts**

- `addFont(file: File): Promise<FontRecord>` — 形式判定 → 名前抽出 → cmap 解析 → Blob ごと保存
- `listFonts(): Promise<FontRecord[]>` ／ `deleteFont(id: string): Promise<void>`
- `FontRecord = { id, name, family, format: 'ttf'|'otf'|'ttc'|'woff'|'woff2', blob, coverage: Coverage | null, createdAt }`

**fonts/loader.ts**

- `ensureLoaded(rec: FontRecord): Promise<void>` — 内部ファミリー名 `fm-<id>` で FontFace を登録（端末フォントとの名前衝突を避けるため、表示名と内部名を分ける）
- `fontStack(rec: FontRecord | null): string` — Canvas 用 font-family 文字列。選択フォント → OS 標準の日本語フォント候補 → sans-serif の順（FR-02 のフォールバックチェーン）

**core/layout.ts**

- `layoutText(text: string, opts: LayoutOptions): LayoutResult`
- `LayoutOptions = { fontStack, fontSize, lineHeightFactor, wrapWidth: number | null, margins, align, mode: 'normal' | 'sideways' }`（wrapWidth が null のとき改行のみで分割＝横モードの行）
- `LayoutResult = { ok: true, lines: Line[], width, height, missing: MissingMark[] } | { ok: false, reason: 'too-long' | 'block-too-tall' }`
- `Line = { text, width, x }`、`MissingMark = { lineIndex, x, width }`（プレビューのマーカー描画用）
- 文字幅の測定は共有のオフスクリーン Canvas の `measureText` で行う。レイアウトは純粋計算に寄せ、単体テスト可能にする

**core/binarize.ts**

- `otsuThreshold(luminance: Uint8ClampedArray): number` — 256 階調ヒストグラムから大津の閾値を返す
- `binarize(src: HTMLCanvasElement): HTMLCanvasElement` — 閾値で黒白に変換した新しい Canvas を返す

**core/caps.ts**

- `platformCaps(): { maxSide: number, maxArea: number }` — 初期値：iOS は maxSide 4,096・maxArea 4,096×4,096、その他は maxSide 8,192・maxArea 8,192×8,192（要件 §11 の実機検証で確定させる）
- `withinCaps(width: number, height: number): boolean` — 長辺と面積の両方を確認する（FR-09）

**core/saveName.ts**

- `nextSaveName(): string` — `fontmemo-YYYYMMDD-HHMMSS.png`、同一セッションで同名が再生成されたら `-2`、`-3` を付ける（4アプリ共通規則）

**core/share.ts**

- `saveOrShare(canvas: HTMLCanvasElement, name: string): Promise<'shared' | 'downloaded'>` — `navigator.canShare` でファイル共有が可能なら共有シート、否ならダウンロード

## 3. フォント供給の構造

フォントの出所は3層。機能保証の範囲が層ごとに違うことを設計の前提にする。

| 層 | 出所 | 欠字検出 | 備考 |
|---|---|---|---|
| 1（主） | ユーザーが取り込んだフォントファイル（IndexedDB 保存） | cmap 解析で保証（FR-02） | このアプリの中心 |
| 2 | OS 標準フォント（名前指定の候補リスト） | 対象外 | 端末により有無が違うため、フォールバック先としてのみ使う |
| 3（段階的強化） | Local Font Access API で列挙した端末フォント（Chromium のみ、許可制） | 対象外 | デスクトップ中心。対応環境でのみピッカーに現れる |

### AnyFont 等でインストールしたフォントについて（調査結果）

iOS の AnyFont は、構成プロファイル経由でフォントを端末に入れるネイティブアプリ。入れたフォントは、OS のフォントピッカーを使うネイティブアプリ（Pages、ピータッチ系アプリ等）でのみ使える。**Safari 上の Web アプリからは、プロファイルで入れたフォントを列挙することも、名前指定で使うこともできない**（Web 開発者による実地確認でも、公開サイトでは使えず、ローカル HTML の表示でのみ使えたと報告されている）。

したがって FontMemo が Web アプリである限り、AnyFont 的な「端末へのインストール」も「インストール済みフォントの利用」も対象外になる。FontMemo の取り込み方式は、同じフォントファイルを FontMemo の中にも保持する形で、実質的に同じ目的（好きなフォントで書く）をプロファイル承認なしに達成する。層3は、デスクトップ Chrome で「PC にインストール済みのフォント」を一覧化できる唯一の Web 側の道として用意する。

## 4. フォント導線（FR-05 の具体化）

fontfree.me には利用可能な API がなく（WordPress の REST API はホスティング側 WAF で遮断され、CORS も返らない）、フォントファイル自体も保持していない（ダウンロードは各作者の配布サイトへのリンク）。よって連携は「導線」として設計する。

フォントピッカーの構成：

1. **取り込み済みフォント** — 各フォント自身の書体で描いた見本（フォント名＋サンプル文字列）で一覧表示する（FR-03）。選ぶ前に字形が分かる
2. **「フォントを探す」ボタン** — FONT FREE を新規タブで開く。案内文で「見本を見て選ぶ → ダウンロード → ここに戻って取り込む」の3手順を示す
3. **「フォントを取り込む」ボタン** — ファイル選択（TTF/OTF/TTC。ZIP は §8-1）。取り込み直後、そのフォントが選択状態になり、自分の文章のプレビューで即確認できる
4. 空状態（取り込みゼロ）では、2と3を大きく見せて最初の1フォントへ誘導する

## 5. 主要アルゴリズム

### 5.1 レイアウトと折り返し

- 通常モード：幅はプリセット（250px／384px（200dpi相当）／576px（300dpi相当）／カスタム、FR-07）で固定し、文章を折り返して高さが伸びる
- 折り返しは文字単位の測定で行い、簡易な禁則処理を入れる。行頭禁則文字（、。・：；！？）」』】等、小書き仮名）は前の行に追い込む（追い込み方式）。行末禁則（「『【等）は次行へ送る。英単語は空白で優先的に割り、行幅より長い単語は途中で割る。明示改行は保持し、空行は1行分の高さを持つ
- 横モード（FR-14）：行は改行でのみ作り、折り返しはしない。読み向きで「幅＝最も長い行の幅、高さ＝行数×行間＋余白」のブロックを組み、ブロック高さが出力幅を超えたら生成を止める（`block-too-tall`）。描画後に90度右回転し、プレビューは回転後の縦長画像を表示する
- 上限チェック：最終画像の寸法（横モードは回転後）で `withinCaps` を確認し、超えたら生成を止めて警告する（`too-long`）。黙って切り捨てる経路は作らない

### 5.2 欠字の検出と表示

- 選択フォントに coverage がある場合のみ、文章の全文字を照合する（サロゲートペア・結合文字はコードポイント単位で扱う）
- プレビュー：二値化済み画像の上に、欠字位置へアクセントカラーの下線マーカーを重畳する（layout が返す MissingMark を使用）。警告バーには欠けた文字そのものを列挙する
- 出力 PNG：マーカーは入れず、欠字はフォールバックチェーンの書体で通常描画する（FR-02）

### 5.3 二値化

- 描画は最終解像度で直接行う（拡大描画＋縮小はしない）。AA のグレーから輝度ヒストグラムを作り、大津法で閾値を決めて黒白化する
- 大津法と固定閾値128の優劣は要件 §11 の実印刷比較で確定する。実装は閾値決定を差し替え可能な形にしておく

### 5.4 描画と回転

- 描画 Canvas は白背景・黒文字。横モードの回転は画素コピーで90度右回転した Canvas を作る（transform 描画ではなく画素転置に寄せ、出力寸法を厳密にする）

## 6. データ

**IndexedDB**（DB 名 `fontmemo-db`、ストア `fonts`）：FontRecord を Blob ごと保存。coverage は範囲列（数値配列）として一緒に保存し、起動時の再解析を不要にする。

**localStorage**（キー `fontmemo-settings`）：選択フォント ID、文字サイズ、行間、余白、揃え、幅プリセット／カスタム幅、モード（通常／横）、UI 言語。文章そのものは保存しない（FR-01）。

**起動時**：保存フォントを全て FontFace 登録する。登録に失敗したフォント（破損等）はピッカーで無効表示にし、削除を促す。

## 7. 保存・共有・PWA・更新

- 保存と共有は `saveOrShare` に集約（FR-09）。iOS では共有シート経由の保存が主経路
- PWA：manifest と Service Worker（アプリシェルを cache-first）。ただし版ズレ対策として、起動時に version.json を照合し、不一致ならキャッシュを消して読み直す自己修復を入れる（他アプリで実証済みの方式）
- バージョン規則：`appVersion` は GitHub タグ（v を除いたもの）と一致させる。実機確認用は v0.1.0 番代、正式版は v1.0.0 番代
- GitHub Pages のデプロイはタグを契機とする Actions ワークフローで行う

## 8. 未決事項（判断が要るもの）

1. **ZIP 取り込みの採否** — 配布サイトの多くは ZIP で配るため、スマホ利用者に「解凍してから取り込む」を強いるのは導線上の大きな摩擦。小型の解凍ライブラリ（fflate 等）を採用し、ZIP 内の TTF/OTF/TTC を直接取り込めるようにする案を推す。複数フォント入り ZIP は全件取り込む
2. **WOFF/WOFF2 の欠字検出** — 描画への取り込みは FontFace で可能だが、cmap 抽出には WOFF の展開（zlib）／WOFF2 の展開（Brotli）が必要で、ブラウザ標準機能だけでは WOFF2 が扱えない。v1 では WOFF/WOFF2 の coverage を null（検出対象外）とし、検出保証は TTF/OTF/TTC に限る案
3. **UI 言語** — 他アプリに倣い日英切替を用意するか、日本語のみで始めるか。辞書方式なら追加コストは小さい
4. **層3（Local Font Access）の v1 採否** — Chromium のみ・許可ダイアログ付き。デスクトップ利用の利便性は上がるが、v1 の主対象（スマホ）には効かない。後回しでも設計は壊れない

## 9. 要件 §11 検証事項との対応

| 検証事項 | 設計での扱い |
|---|---|
| 初回起動時の体験・同梱フォントの可否 | 空状態の導線（§4-4）で吸収する設計。同梱はライセンス確認が取れた場合のみ別途判断 |
| cmap 取得のフォーマット別可否 | TTF/OTF/TTC は自前パーサで確定。WOFF/WOFF2 は §8-2 |
| Canvas 上限の実測 | caps.ts のテーブルに切り出し、実測値で差し替える |
| 二値化の実印刷比較 | 閾値決定を差し替え可能に分離（§5.3） |
| 横モードの実機確認 | 回転後の寸法で上限チェック（§5.1）。排出順は実機で確認 |
| プリンタアプリ側の長大画像読み込み制限 | アプリ側では制御不能。判明したら上限テーブルの初期値に反映する |
