/** テキストエリアの入力を 1 行ずつに分ける（空行は捨てる） */
export const splitLines = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

/** 「、」「,」改行で区切った入力を分ける（別名など） */
export const splitList = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(/[、,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
