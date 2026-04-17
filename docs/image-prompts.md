# OGP キャラクター画像プロンプト集

# Kagura Search & lucifer-research

> スタイル参考: HOKAGE v4.0 スタイル
> 「ペイント調キャラクターイラスト（左）＋ 大きなタイポグラフィ（右）」
>
> **推奨ワークフロー**:
>
> 1. Midjourney / DALL-E / Bing Image Creator でキャラ部分を生成
> 2. Canva（無料）でテキストを追加 → PNG 書き出し
>
> テキストを一緒に生成したい場合は「Midjourney v6 + 引用符テキスト」が最も安定。

---

## ── KAGURA ──

### コンセプト

- **キャラクター**: 真実を照らす巫女・神楽の少女
- **シンボル**: 八芒星（八つの尖った星）
- **配色**: 白磁・インディゴ（群青）・黄金
- **テキスト**: `Kagura Search` ／ `v0.1.1 — Truth-illuminating search oracle`

---

### Kagura Prompt A — キャラクター単体（Canva でテキスト追加用）

```
A mystical shrine maiden oracle girl in dramatic painterly illustration style.
She wears an elegant indigo-blue and white kimono with golden eight-pointed star
(octagram) motifs. Long flowing dark hair with golden ornaments. She holds a
glowing golden octagram in her raised hand, light radiating outward. Dynamic
flowing sleeves with ink splatter accents. Expression: serene, all-knowing,
truth-illuminating. Painterly detailed digital art, loose ink brushwork,
subtle cream and indigo tones. Left-side composition leaving space on right
for typography. Cinematic lighting, high detail
```

---

### Kagura Prompt B — テキスト込み（Midjourney v6 推奨）

```
Cinematic OGP banner 5:2 ratio, cream off-white background.
Left side: painterly illustration of a shrine maiden oracle girl,
indigo kimono, golden octagram symbol glowing in hand, flowing hair,
ink splatter effects, ethereal light, detailed digital painting.
Right side: large bold black sans-serif typography "KAGURA" dominating,
below it smaller text "Search" in indigo, and subtitle
"v0.1.1 — Truth-illuminating search oracle" in small clean font.
Clean professional layout, high contrast, Japanese aesthetic --ar 5:2 --style raw
```

---

### Kagura Prompt C — Adobe Firefly / DALL-E 3（テキスト生成対応）

```
OGP banner image with illustrated shrine maiden character on left half
and large typography on right half. The shrine maiden wears indigo kimono,
holds a glowing eight-pointed star. Background is clean off-white cream.
Right side displays the word "KAGURA" in bold large black letters,
with subtitle "Truth-illuminating search oracle" below.
Painterly illustration mixed with clean typography. 5:2 wide format
```

---

## ── LUCIFER ──

### コンセプト

- **キャラクター**: 光と闇を等しく宿す堕天使の少女（明けの明星）
- **シンボル**: 4芒の明けの明星（✦ 細長い4方向の星）
- **配色**: 漆黒・深紫 × 黄金・白光（左闇／右光の二分）
- **テキスト**: `lucifer-research` ／ `v0.1.0 — Morning star of web extraction`

---

### Lucifer Prompt A — キャラクター単体（Canva でテキスト追加用）

```
A breathtaking fallen angel girl embodying the morning star Lucifer.
Her entire design is split in half: left side is consumed by absolute
darkness — obsidian black feathered fallen angel wing, shadowed dark
void-purple eye, black flowing hair dissolving into shadow.
Right side radiates golden divine light — luminous white-gold angel wing,
glowing golden star eye, golden hair flowing like dawn light.
She wears a dark violet-black robe with golden trim that mirrors the split.
Behind her, a large elongated 4-pointed morning star (✦) blazes with
golden fire — part golden flame right, part purple void left.
Fire and shadow splatter around her. Expression: serene, powerful,
knowing — she is the light born from the deepest darkness.
Painterly dramatic digital art, chiaroscuro, ink and fire effects,
dark background. Left-side composition, leaving space on right for text
```

---

### Lucifer Prompt B — テキスト込み（Midjourney v6 推奨）

```
Cinematic OGP banner 5:2 ratio, deep dark void background.
Left side: painterly illustration of a fallen angel girl with split design —
left dark obsidian wing and right golden luminous wing, heterochromia eyes
(left void-purple, right golden), split dark-and-golden hair,
4-pointed morning star blazing behind her, chiaroscuro dramatic lighting,
fire and shadow paint splatter, detailed painterly art.
Right side: large bold white sans-serif typography "lucifer" with
"-research" in golden color beside it, below it subtitle
"v0.1.0 — Morning star of web extraction" in small clean gold font.
Professional cinematic layout, dramatic contrast --ar 5:2 --style raw
```

---

### Lucifer Prompt C — Adobe Firefly / DALL-E 3（テキスト生成対応）

```
Dark cinematic OGP banner. Left half: dramatic fallen angel girl character,
split between darkness and golden light, one dark wing one golden wing,
fire and shadow effects, painterly illustration style.
Right half: large bold white text "lucifer" with golden "-research",
subtitle text "Morning star of web extraction" below.
Deep dark void background, chiaroscuro lighting, fire splatter accents.
5:2 wide banner format
```

---

### Lucifer Prompt D — 短縮版（文字制限あるツール用）

```
Fallen angel girl morning star Lucifer, split darkness and golden light,
one obsidian wing one radiant golden wing, 4-pointed star halo blazing,
painterly dramatic art, dark background, fire and shadow effects,
left-side composition for banner, chiaroscuro lighting
```

---

## テキスト追加ガイド（Canva 推奨）

AI で生成した画像を Canva に読み込んで、以下のテキストを手動追加:

### Kagura Search 用テキスト設定

| 要素           | 内容                                        | スタイル                              |
| -------------- | ------------------------------------------- | ------------------------------------- |
| メインタイトル | `Kagura`                                    | 極太ゴシック、黒、大（80-100pt 相当） |
| サブタイトル1  | `Search`                                    | 太め、インディゴ、中（40-50pt）       |
| サブタイトル2  | `v0.1.1 — Truth-illuminating search oracle` | 細め、グレー、小（16-18pt）           |

### lucifer-research 用テキスト設定

| 要素               | 内容                                      | スタイル                              |
| ------------------ | ----------------------------------------- | ------------------------------------- |
| メインタイトル前半 | `lucifer`                                 | 極太ゴシック、白、大（80-100pt 相当） |
| メインタイトル後半 | `-research`                               | 同サイズ、金色（#c9a84c）             |
| サブタイトル       | `v0.1.0 — Morning star of web extraction` | 細め、金色薄め、小（16-18pt）         |

---

## Canva テンプレート検索ワード

```
"product launch banner"
"software release announcement"
"tech OGP banner"
"app hero image"
```
