import { cutListTable, toCsv, type CompleteLine } from '@/scan/cutlist';

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(lines: CompleteLine[]): void {
  download('cut-list.csv', new Blob([toCsv(cutListTable(lines))], { type: 'text/csv;charset=utf-8' }));
}

export async function exportXlsx(lines: CompleteLine[]): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('רשימת חיתוך', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  const [header, ...rows] = cutListTable(lines);
  sheet.addRow(header).font = { bold: true };
  // lengths and quantities go in as numbers so the sheet can be summed
  for (const [type, label, length, width, qty] of rows) sheet.addRow([type, label, Number(length), width === '' ? null : Number(width), Number(qty)]);
  sheet.columns.forEach((column, i) => {
    column.width = i < 2 ? 34 : 12;
  });
  const data = await workbook.xlsx.writeBuffer();
  download('cut-list.xlsx', new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
