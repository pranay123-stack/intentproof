import { describe, expect, it } from 'vitest';
import { bps, relativeDuration, shortHash, timestamp, titleCase, usd } from '../lib/format.js';

describe('shortHash', () => {
  it('truncates the middle of a long hash', () => {
    const hash = `0x${'a'.repeat(64)}`;
    expect(shortHash(hash)).toBe('0xaaaaaaaa…aaaaaa');
  });

  it('leaves a short value alone rather than padding it', () => {
    expect(shortHash('0x1234')).toBe('0x1234');
  });
});

describe('usd', () => {
  it('drops the decimals on whole amounts', () => {
    expect(usd(500)).toBe('$500');
    expect(usd(1000)).toBe('$1,000');
  });

  it('keeps cents when there are any', () => {
    expect(usd(500.25)).toBe('$500.25');
  });

  it('distinguishes "no limit set" from zero', () => {
    // A missing cap and a $0 cap mean very different things, so they must not
    // render the same way.
    expect(usd(undefined)).toBe('—');
    expect(usd(null)).toBe('—');
    expect(usd(0)).toBe('$0');
  });
});

describe('bps', () => {
  it('renders basis points as a percentage', () => {
    expect(bps(100)).toBe('1%');
    expect(bps(60)).toBe('0.6%');
    expect(bps(0)).toBe('0%');
    expect(bps(undefined)).toBe('—');
  });
});

describe('timestamp', () => {
  it('renders UTC without millisecond noise', () => {
    expect(timestamp('2026-09-01T12:00:00.000Z')).toBe('2026-09-01 12:00:00 UTC');
  });

  it('passes an unparseable value through untouched', () => {
    expect(timestamp('not a date')).toBe('not a date');
  });
});

describe('relativeDuration', () => {
  it('picks a sensible unit', () => {
    expect(relativeDuration('2026-09-01T12:00:00Z', '2026-09-01T12:30:00Z')).toBe('30 min');
    expect(relativeDuration('2026-09-01T12:00:00Z', '2026-09-02T12:00:00Z')).toBe('24 h');
    expect(relativeDuration('2026-09-01T12:00:00Z', '2026-09-08T12:00:00Z')).toBe('7 d');
  });
});

describe('titleCase', () => {
  it('turns snake_case identifiers into prose', () => {
    expect(titleCase('portfolio_management')).toBe('Portfolio Management');
    expect(titleCase('provide_liquidity')).toBe('Provide Liquidity');
  });
});
