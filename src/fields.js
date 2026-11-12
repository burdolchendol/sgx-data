// The website's INDEX_FIELDS (react_final_project src/final_project/data/snapshotFormat.js).
// Order matters: index.json rows are positional.
export const INDEX_FIELDS = Object.freeze([
  'revenue', 'netIncome', 'epsDiluted', 'dilutedShares', 'totalAssets', 'totalLiabilities',
  'currentAssets', 'currentLiabilities', 'equity', 'longTermDebt', 'operatingCashFlow',
  'capex', 'dividendsPerShare', 'dividendsPaid',
  'debtCurrent', 'longTermDebtCurrent', 'shortTermBorrowings', 'cash', 'goodwill', 'intangibles',
  'intangiblesInclGoodwill',
]);

// Same rule as the website's companyFile().
export function companyFile(ticker) {
  return `${String(ticker).replace(/[^A-Za-z0-9.-]/g, '_')}.json`;
}
