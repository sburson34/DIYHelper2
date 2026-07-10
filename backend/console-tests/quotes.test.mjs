// Quote-line read + tiered-quote serialization. readQuoteLinesFromDom runs
// against a jsdom fixture; serializeQuotePayload/optionTotal are pure.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readQuoteLinesFromDom,
  serializeQuotePayload,
  optionTotal,
} from '../DIYHelper2.Api/wwwroot/admin/js/quotes.js';

function lineRow(desc, amount, qty) {
  return `<div class="quote-line">
    <input class="q-desc" type="text" value="${desc}">
    <div class="price-edit-amt"><span class="price-dollar">$</span><input class="q-amount" type="number" value="${amount}"></div>
    <input class="q-qty" type="number" value="${qty}">
  </div>`;
}

describe('readQuoteLinesFromDom', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads description, amount, and quantity from each row', () => {
    document.body.innerHTML = `<div id="quote-lines">${lineRow('Snake drain', '120.50', '2')}${lineRow('Camera inspection', '89', '1')}</div>`;
    expect(readQuoteLinesFromDom()).toEqual([
      { description: 'Snake drain', amount: 120.5, quantity: 2 },
      { description: 'Camera inspection', amount: 89, quantity: 1 },
    ]);
  });

  it('defaults blank amount to 0 and blank quantity to 1', () => {
    document.body.innerHTML = `<div id="quote-lines">${lineRow('TBD', '', '')}</div>`;
    expect(readQuoteLinesFromDom()).toEqual([
      { description: 'TBD', amount: 0, quantity: 1 },
    ]);
  });

  it('returns [] when there is no quote-lines host', () => {
    expect(readQuoteLinesFromDom()).toEqual([]);
  });
});

describe('optionTotal', () => {
  it('sums amount × quantity with sensible defaults', () => {
    expect(optionTotal([
      { description: 'A', amount: 10, quantity: 2 },
      { description: 'B', amount: 5 },              // quantity defaults to 1
      { description: 'C' },                          // amount defaults to 0
    ])).toBe(25);
    expect(optionTotal([])).toBe(0);
    expect(optionTotal(null)).toBe(0);
  });
});

describe('serializeQuotePayload', () => {
  const lines = [
    { description: 'Snake drain', amount: 120, quantity: 1 },
    { description: '', amount: 0, quantity: 1 },      // empty → dropped
  ];

  it('single unnamed option → legacy {lines} payload (back-compat)', () => {
    const payload = serializeQuotePayload([{ name: '', lines }]);
    expect(payload).toEqual({ lines: [{ description: 'Snake drain', amount: 120, quantity: 1 }] });
    expect(payload.options).toBeUndefined();
  });

  it('single NAMED option still serializes legacy (one tab = one quote)', () => {
    const payload = serializeQuotePayload([{ name: 'Good', lines }]);
    expect(payload).toEqual({ lines: [{ description: 'Snake drain', amount: 120, quantity: 1 }] });
  });

  it('multiple options → {options:[{name, lines}]}', () => {
    const payload = serializeQuotePayload([
      { name: 'Good', lines: [{ description: 'Patch', amount: 100, quantity: 1 }] },
      { name: 'Better', lines: [{ description: 'Patch', amount: 100, quantity: 1 }, { description: 'Seal', amount: 50, quantity: 1 }] },
      { name: 'Best', lines: [{ description: 'Replace', amount: 400, quantity: 1 }] },
    ]);
    expect(payload.lines).toBeUndefined();
    expect(payload.options).toHaveLength(3);
    expect(payload.options.map((o) => o.name)).toEqual(['Good', 'Better', 'Best']);
    expect(optionTotal(payload.options[1].lines)).toBe(150);
  });

  it('drops empty lines per option and defaults blank names positionally', () => {
    const payload = serializeQuotePayload([
      { name: '  ', lines: [{ description: 'A', amount: 10, quantity: 1 }, { description: '', amount: 0 }] },
      { name: 'Better', lines: [{ description: 'B', amount: 20, quantity: 2 }] },
    ]);
    expect(payload.options[0].name).toBe('Option 1');
    expect(payload.options[0].lines).toHaveLength(1);
    expect(payload.options[1].lines).toEqual([{ description: 'B', amount: 20, quantity: 2 }]);
  });

  it('handles empty/absent input as an empty legacy payload', () => {
    expect(serializeQuotePayload([])).toEqual({ lines: [] });
    expect(serializeQuotePayload(null)).toEqual({ lines: [] });
  });
});
