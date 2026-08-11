/** csv.js - 零依赖 CSV 解析器（node 原生，无第三方）。
 *
 * 处理真实导出里的脏情况（两份飞书/Excel 导出 CSV 实测）：
 *   - UTF-8 BOM（﻿）开头 -> 剥掉，否则首列名带 BOM 永远匹配不上。
 *   - CRLF / LF / CR 混用 -> 统一按 LF 切。
 *   - 引号字段内嵌换行、逗号、转义双引号（"" -> "）-> 状态机正确还原。
 *   - 末尾空行 -> 丢弃（不产出空行数组）。
 *
 * 不做「按表头名取列」--调用方自己用 rows[0] 定位列下标（两份 CSV 表头列数/分段不同，
 * 硬编码列名反而脆弱）。本模块只保证把字节流忠实切成「行×单元格」二维数组。
 */
import { readFileSync } from 'node:fs';

/** 把一段 CSV 文本解析成行数组，每行是单元格字符串数组。空行丢弃。 */
export function parseCsv(text) {
  // 去 BOM（﻿ 可能因拼接出现在任意行首，统一剥）。
  let s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // 转义双引号
        else inQuotes = false;                       // 引号结束
      } else {
        field += c;                                  // 引号内：换行/逗号原样保留
      }
      continue;
    }

    // 非引号态
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') {
      // CRLF / CR：统一当一行结束（紧跟的 LF 在下一轮被当普通字符跳过会出错，
      // 故显式吞掉配对的 LF）。
      row.push(field); field = '';
      rows.push(row); row = [];
      if (s[i + 1] === '\n') i++;
      continue;
    }
    if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      continue;
    }
    field += c;
  }
  // 末尾残留（文件不以换行结尾时）
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // 丢弃完全空白的行（全单元格为空字符串）。真实 CSV 有大量尾随空行/分隔空行。
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** 读文件并解析。path 为绝对路径。 */
export function parseCsvFile(path) {
  return parseCsv(readFileSync(path, 'utf8'));
}
