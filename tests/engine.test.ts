import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parseFile } from '../src/engine/parser'
import { parseLooseDate, formatDate } from '../src/engine/utils'
import { applyActions } from '../src/engine/cleaning'
import { buildPythonScript } from '../src/engine/exporters'
import type { CleaningAction, DataRow } from '../src/types'

function action(type: CleaningAction['type'], extra: Partial<CleaningAction> = {}): CleaningAction {
  return { id: type, issueId: 'test', type, label: 'Reviewed operation', description: '', risk: 'low', autoSelected: false, ...extra }
}

test('CSV import preserves identifiers, numeric text and literal missing tokens', async () => {
  const parsed = await parseFile(new File(['order_id,amount,status\n00123,12.50,true\n00007,0,N/A'], 'orders.csv'))
  assert.deepEqual(parsed.rows, [
    { order_id: '00123', amount: '12.50', status: 'true' },
    { order_id: '00007', amount: '0', status: 'N/A' },
  ])
})

test('malformed CSV is rejected instead of silently dropping or inventing fields', async () => {
  await assert.rejects(parseFile(new File(['id,amount\n001,12,extra'], 'broken.csv')), /CSV|列|字段/)
})

test('a header-only CSV gives an actionable empty-data error', async () => {
  await assert.rejects(parseFile(new File(['id,amount\n'], 'empty.csv')), /数据|空/)
})

test('date normalization rejects impossible calendar dates and times', () => {
  for (const value of ['2026-02-30', '31/04/2026', '2026-13-01', '2026-01-01 25:01:00', '2026/02/30 10:00:00.000', '2026-2-30 10:00:00.000']) {
    assert.equal(parseLooseDate(value), null, value)
  }
  assert.equal(formatDate(parseLooseDate('2024-02-29')!), '2024-02-29')
  assert.equal(formatDate(parseLooseDate('29/02/2024')!), '2024-02-29')
})

test('datetime cleaning retains time for Chinese time column names', () => {
  const rows = [{ 完成时间: '2026/01/02 13:14:15' }]
  assert.deepEqual(applyActions(rows, [action('normalize_date', { column: '完成时间' })]).rows,
    [{ 完成时间: '2026-01-02 13:14:15' }])
})

test('Excel serial dates represent local calendar time without timezone shifts', () => {
  assert.equal(formatDate(parseLooseDate(46024.5)!, true), '2026-01-02 12:00:00')
})

test('CSV Excel serial text uses the numeric date path and invalid ISO dates are retained', () => {
  assert.equal(formatDate(parseLooseDate('46024')!), '2026-01-02')
  assert.equal(parseLooseDate('2026-02-30T10:00:00Z'), null)
})

const python = process.env.DATAREADY_PYTHON
const replay = `
import json, os, sys, tempfile
import pandas as pd
payload = json.load(sys.stdin)
with tempfile.TemporaryDirectory() as tmp:
    original = os.getcwd()
    try:
        os.chdir(tmp)
        if payload.get('csv') is not None:
            with open('input.csv', 'w', encoding='utf-8', newline='') as handle:
                handle.write(payload['csv'])
        else:
            pd.DataFrame(payload['rows'], dtype=object).to_excel('input.xlsx', index=False)
        exec(compile(payload['script'], 'cleaning_script.py', 'exec'), {})
        result = pd.read_excel('dataset_cleaned.xlsx', dtype=object, keep_default_na=False)
        print(result.to_json(orient='records', force_ascii=False))
    finally:
        os.chdir(original)
`

function replayScript(rows: DataRow[], actions: CleaningAction[], csv?: string): DataRow[] {
  const script = csv === undefined ? buildPythonScript(actions) : buildPythonScript(actions).replace('Path("input.xlsx")', 'Path("input.csv")')
  const run = spawnSync(python!, ['-X', 'utf8', '-c', replay], {
    input: JSON.stringify({ rows, script, csv }), encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

test('Python export preserves field names containing true, false and null', { skip: !python }, () => {
  const rows = [{ true_sales: 'shanghai', false_note: 'null' }]
  const actions = [action('normalize_category', { column: 'true_sales', mapping: { shanghai: '上海' } })]
  assert.deepEqual(replayScript(rows, actions), applyActions(rows, actions).rows)
})

test('Python numeric cleaning matches the reviewed UI without erasing invalid values', { skip: !python }, () => {
  const rows = [{ amount: '￥1,200.50' }, { amount: 'bad' }, { amount: 'N/A' }, { amount: '50%' }, { amount: '0x10' }, { amount: '١٢' }]
  const actions = [action('coerce_numeric', { column: 'amount' })]
  assert.deepEqual(replayScript(rows, actions), applyActions(rows, actions).rows)
})

test('Python CSV replay detects supported delimiters and drops all-empty records like the UI', { skip: !python }, async () => {
  for (const csv of ['id;amount\n001;12.50\n002;N/A', 'id;amount\n001;12.50\n   \n002;N/A', 'id,amount\n001,10\n,\n002,20']) {
    const { rows } = await parseFile(new File([csv], 'input.csv'))
    const actions = [action('coerce_numeric', { column: 'amount' })]
    assert.deepEqual(replayScript(rows, actions, csv), applyActions(rows, actions).rows)
  }
})

test('Python dates with explicit timezone match the local UI calendar time', { skip: !python }, () => {
  const rows = [{ created_time: '2026-01-02T01:00:00Z' }, { created_time: '2026-02-30T10:00:00Z' }]
  const actions = [action('normalize_date', { column: 'created_time' })]
  assert.deepEqual(replayScript(rows, actions), applyActions(rows, actions).rows)
})

test('Python trim and missing-token cleaning only change the reviewed cells', { skip: !python }, () => {
  const rows = [{ note: ' hello ', amount: 12 }, { note: ' N/A ', amount: 5 }]
  const actions = [action('replace_missing_tokens', { column: 'note', tokens: ['N/A'] }), action('trim_strings')]
  const expected = applyActions(rows, actions).rows.map(row => ({ ...row, note: row.note ?? '' }))
  assert.deepEqual(replayScript(rows, actions), expected)
})

test('Python date cleaning retains invalid entries and matches date-only and datetime UI output', { skip: !python }, () => {
  const rows = [
    { order_date: '31/01/2026', 完成时间: '2026/01/02 13:14:15' },
    { order_date: '2026-02-30', 完成时间: 'bad' },
    { order_date: 46024, 完成时间: null },
  ]
  const actions = [action('normalize_date', { column: 'order_date' }), action('normalize_date', { column: '完成时间' })]
  const expected = applyActions(rows, actions).rows.map(row => ({ ...row, 完成时间: row.完成时间 ?? '' }))
  assert.deepEqual(replayScript(rows, actions), expected)
})
