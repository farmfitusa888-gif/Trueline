#!/usr/bin/env bash
# Runs four PUBLISHED price bases through the importer and prints what comes out.
#
# The data is not in this repository and cannot be: priceAPI is LGPL-2.1 and the
# DDC CWICR dataset is CC BY-NC 4.0, which forbids commercial redistribution.
# So this fetches them instead, which also means the numbers below can be
# checked by anybody rather than taken on trust.
#
#   bash core/tools/verify-price-lists.sh
#
# Measured 25 August 2026, against the importer at that commit:
#
#   SINAPI 2017.01 (CAIXA/IBGE, Brazil)   5,692 rows -> 3,917 rates, 1,775 refused
#   PMSP 2017.01 (São Paulo city)         2,594 rows -> 2,345 rates,   249 refused
#   SEINFRA 2016.03 (Ceará state)         7,360 rows -> 6,322 rates, 1,038 refused
#   DDC CWICR USA_USD catalogue           5,605 rows -> 2,429 rates, 3,176 refused
#
# Before the headless, UN and metric fixes: the first three imported ZERO rows
# and the fourth imported 612.
#
# Everything refused is refused for a reason that is printed: an hour, a
# kilogram, a cubic metre or a month is not an area or a length, and 231 rows of
# the DDC catalogue are priced at 0.00.

set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="${TMPDIR:-/tmp}/trueline-price-check"
mkdir -p "$work"

if [ ! -d "$work/priceapi" ]; then
  echo "fetching priceAPI (LGPL-2.1, Brazilian public price bases)..."
  git clone --depth 1 -q https://github.com/yorikvanhavre/priceAPI.git "$work/priceapi"
fi
if [ ! -d "$work/occ" ]; then
  echo "fetching DDC CWICR (CC BY-NC 4.0 — testing only, never redistributed)..."
  git clone --depth 1 --filter=blob:none --sparse -q \
    https://github.com/datadrivenconstruction/OpenConstructionEstimate-DDC-CWICR.git "$work/occ"
  (cd "$work/occ" && git sparse-checkout set "SouthAmerica-Brazil-SINAPI/markets" -q)
fi

cat > "$work/run.mjs" <<'JS'
import { existsSync, readFileSync } from 'node:fs';

// Imported by path at run time: this script is written into a scratch folder
// and the module it needs is in the repository, so a static import cannot
// spell the way there.
const { importList, parseList } = await import(`${process.env.CORE}/pricelist.ts`);

const work = process.argv[2];
const files = [
  ['SINAPI 2017.01 (CAIXA/IBGE, Brazil)', `${work}/priceapi/data/sinapi-2017.01.csv`],
  ['PMSP 2017.01 (Sao Paulo city)', `${work}/priceapi/data/pmsp-2017.01.csv`],
  ['SEINFRA 2016.03 (Ceara state)', `${work}/priceapi/data/seinfra-2016.03.csv`],
  [
    'DDC CWICR USA_USD catalogue',
    `${work}/occ/SouthAmerica-Brazil-SINAPI/markets/DDC_CWICR_USA_USD_en_Catalog.csv`,
  ],
];

let bad = 0;
for (const [label, path] of files) {
  if (!existsSync(path)) {
    console.log(`SKIP ${label} — not fetched`);
    continue;
  }
  const list = parseList(readFileSync(path, 'utf8'));
  const missing = ['item', 'unit', 'price'].filter((k) => list.guess[k] === undefined);
  if (missing.length > 0) {
    console.log(`FAIL ${label}: could not work out ${missing.join(', ')}`);
    bad += 1;
    continue;
  }
  const r = importList(list, list.guess, 'check', '2026-08-26T09:00:00Z', label);
  const share = Math.round((100 * r.rates.length) / list.rows.length);
  console.log(
    `${r.rates.length > 0 ? 'OK  ' : 'FAIL'} ${label.padEnd(38)} ` +
      `${String(list.rows.length).padStart(6)} rows -> ${String(r.rates.length).padStart(6)} rates ` +
      `(${String(share).padStart(3)}%), ${String(r.refused.length).padStart(5)} refused, ` +
      `${String(r.converted.length).padStart(5)} converted`
  );
  if (r.rates.length === 0) bad += 1;
  // Every refusal has to say enough to act on, whatever the file looks like.
  for (const x of r.refused) {
    if (x.why.trim().length < 20) {
      console.log(`     a refusal on line ${x.line} says barely anything: ${x.why}`);
      bad += 1;
      break;
    }
  }
}
process.exit(bad === 0 ? 0 : 1);
JS

CORE="$root/core/src" node --experimental-strip-types "$work/run.mjs" "$work"
