// UI strings (design §8-3). Initial language comes from the browser; a
// manual switch is stored in settings and wins.

import type { Lang } from "./settings";

export interface Strings {
  tagline: string;
  textLabel: string;
  textPlaceholder: string;
  fontLabel: string;
  bundledBadge: string;
  noCheckBadge: string;
  specimenSample: string;
  importButton: string;
  importNote: string;
  findFonts: string;
  findGuide: string;
  deleteFont: string;
  confirmDelete: (name: string) => string;
  loadingFont: string;
  settingsLabel: string;
  fontSize: string;
  lineHeight: string;
  marginX: string;
  marginY: string;
  align: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  width: string;
  widthCustom: string;
  mode: string;
  modeNormal: string;
  modeSideways: string;
  previewLabel: string;
  previewEmpty: string;
  shareUnsupported: string;
  save: string;
  share: string;
  generating: string;
  warnMissing: (chars: string) => string;
  warnTooLong: string;
  warnBlockTall: string;
  warnGenFailed: string;
  importAdded: (names: string) => string;
  importSkipped: (detail: string) => string;
  reasonNotFont: string;
  reasonDuplicate: string;
  reasonUnreadable: string;
  fatalNoFonts: string;
  fatalTooManyEntries: string;
  fatalTooManyCandidates: string;
  fatalFileTooLarge: string;
  fatalTotalTooLarge: string;
  fatalZipUnreadable: string;
  styleLabel: string;
  styleHint: string;
  styleFont: string;
  styleSize: string;
  styleClear: string;
  useFont: string;
  deviceBadge: string;
  deviceBrowser: string;
  deviceSerif: string;
  deviceSans: string;
  boldBadge: string;
  italicBadge: string;
  credits: string;
  creditsTitle: string;
  creditsIntro: string;
  licenseLink: string;
  sourceLink: string;
  byAuthor: (author: string) => string;
  aboutText: string;
  close: string;
  langButton: string;
}

const ja: Strings = {
  tagline: "好きなフォントで、好きな言葉を。",
  textLabel: "文章",
  textPlaceholder: "ここに文章を入力してね",
  fontLabel: "フォント管理",
  bundledBadge: "同梱",
  noCheckBadge: "欠字チェック対象外",
  specimenSample: "あいうえお アイウエオ ABC abc 123",
  importButton: "フォントを取り込む",
  importNote: "TTF / OTF / TTC / WOFF / WOFF2、ZIP のまま取り込めます",
  findFonts: "フォントを探す（FONT FREE）",
  findGuide:
    "FONT FREE でフォントを選んでダウンロードしたら、「フォントを取り込む」から ZIP のまま取り込めます。",
  deleteFont: "このフォントを削除",
  confirmDelete: (name) => `「${name}」を削除しますか？`,
  loadingFont: "フォントを読み込み中…",
  settingsLabel: "設定",
  fontSize: "文字サイズ",
  lineHeight: "行間",
  marginX: "左右の余白",
  marginY: "上下の余白",
  align: "そろえ",
  alignLeft: "左",
  alignCenter: "中央",
  alignRight: "右",
  width: "画像の幅",
  widthCustom: "カスタム",
  mode: "印刷の向き",
  modeNormal: "通常",
  modeSideways: "横印刷",
  previewLabel: "プレビュー",
  previewEmpty: "文章を入力するとプレビューが出ます",
  shareUnsupported: "このブラウザでは共有できないので、PNG保存を使ってください",
  save: "保存",
  share: "共有",
  generating: "生成中…",
  warnMissing: (chars) => `このフォントに無い文字があります：${chars}`,
  warnTooLong:
    "文章が長すぎます（画像サイズの上限を超えました）。文字サイズを小さくするか、文章を短くしてください。",
  warnBlockTall:
    "横印刷では、この設定だと行ブロックが画像の幅を超えます。文字サイズを小さくするか、行数を減らしてください。",
  warnGenFailed: "画像を作れませんでした。設定を変えてお試しください。",
  importAdded: (names) => `取り込みました：${names}`,
  importSkipped: (detail) => `取り込めなかったもの：${detail}`,
  reasonNotFont: "フォントではありません",
  reasonDuplicate: "すでに取り込み済みです",
  reasonUnreadable: "読み取れませんでした",
  fatalNoFonts: "ZIP の中にフォントが見つかりませんでした",
  fatalTooManyEntries: "ZIP の中のファイルが多すぎます",
  fatalTooManyCandidates: "ZIP の中のフォントが多すぎます",
  fatalFileTooLarge: "大きすぎるフォントファイルがあります",
  fatalTotalTooLarge: "ZIP のフォント合計が大きすぎます",
  fatalZipUnreadable: "ZIP を読み取れませんでした",
  styleLabel: "スタイル",
  styleHint: "文章の中で変えたい部分を選んでから、ここで変えます",
  styleFont: "フォント",
  styleSize: "大きさ",
  styleClear: "クリア",
  useFont: "このフォントで書く",
  deviceBadge: "端末",
  deviceBrowser: "ブラウザ標準",
  deviceSerif: "端末の明朝",
  deviceSans: "端末のゴシック",
  boldBadge: "太字あり",
  italicBadge: "斜体あり",
  credits: "クレジット",
  creditsTitle: "フォントのクレジット",
  creditsIntro: "FontMemo には次のフォントが同梱されています。各フォントの権利は作者にあります。",
  licenseLink: "ライセンス",
  sourceLink: "配布元",
  byAuthor: (author) => `作者：${author}`,
  aboutText:
    "FontMemo は、好きなフォントで文章を画像にしてサーマルプリンタで印刷するためのアプリです。入力した文章は保存されません。",
  close: "閉じる",
  langButton: "EN",
};

const en: Strings = {
  tagline: "Your favorite fonts, your favorite words.",
  textLabel: "Text",
  textPlaceholder: "Type your text here",
  fontLabel: "Font library",
  bundledBadge: "Built-in",
  noCheckBadge: "Glyph check n/a",
  specimenSample: "あいうえお アイウエオ ABC abc 123",
  importButton: "Import a font",
  importNote: "TTF / OTF / TTC / WOFF / WOFF2, or a ZIP as-is",
  findFonts: "Find fonts (FONT FREE)",
  findGuide: "Pick a font on FONT FREE and download it, then import the ZIP here as-is.",
  deleteFont: "Delete this font",
  confirmDelete: (name) => `Delete "${name}"?`,
  loadingFont: "Loading font…",
  settingsLabel: "Settings",
  fontSize: "Font size",
  lineHeight: "Line height",
  marginX: "Side margins",
  marginY: "Top/bottom margins",
  align: "Align",
  alignLeft: "Left",
  alignCenter: "Center",
  alignRight: "Right",
  width: "Image width",
  widthCustom: "Custom",
  mode: "Orientation",
  modeNormal: "Normal",
  modeSideways: "Sideways",
  previewLabel: "Preview",
  previewEmpty: "Your preview appears here",
  shareUnsupported: "This browser cannot share; please use Save PNG instead",
  save: "Save",
  share: "Share",
  generating: "Working…",
  warnMissing: (chars) => `Not in this font: ${chars}`,
  warnTooLong:
    "Too long: the image would exceed the size limit. Reduce the font size or shorten the text.",
  warnBlockTall:
    "Sideways: the text block is taller than the image width. Reduce the font size or the number of lines.",
  warnGenFailed: "Could not create the image. Try different settings.",
  importAdded: (names) => `Imported: ${names}`,
  importSkipped: (detail) => `Skipped: ${detail}`,
  reasonNotFont: "not a font",
  reasonDuplicate: "already imported",
  reasonUnreadable: "unreadable",
  fatalNoFonts: "No fonts found in the ZIP",
  fatalTooManyEntries: "Too many files in the ZIP",
  fatalTooManyCandidates: "Too many fonts in the ZIP",
  fatalFileTooLarge: "A font file is too large",
  fatalTotalTooLarge: "The fonts in the ZIP are too large in total",
  fatalZipUnreadable: "Could not read the ZIP",
  styleLabel: "Style",
  styleHint: "Select part of the text, then change it here",
  styleFont: "Font",
  styleSize: "Size",
  styleClear: "Clear",
  useFont: "Use this font",
  deviceBadge: "Device",
  deviceBrowser: "Browser default",
  deviceSerif: "Device serif",
  deviceSans: "Device sans",
  boldBadge: "Has bold",
  italicBadge: "Has italic",
  credits: "Credits",
  creditsTitle: "Font credits",
  creditsIntro: "FontMemo bundles the following fonts. All rights belong to their authors.",
  licenseLink: "License",
  sourceLink: "Source",
  byAuthor: (author) => `by ${author}`,
  aboutText:
    "FontMemo turns text in your favorite fonts into images for thermal printers. Your text is never stored.",
  close: "Close",
  langButton: "日本語",
};

export function strings(lang: Lang): Strings {
  return lang === "ja" ? ja : en;
}
