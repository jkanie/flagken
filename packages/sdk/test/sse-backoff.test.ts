import { describe, expect, it } from 'vitest';
import { SseParser, backoffDelay } from '../src/index.js';

describe('SseParser', () => {
  it('parses events split across chunks at any point', () => {
    const text = 'event: put\ndata: {"a":1}\n\nevent: patch\ndata: {"b":2}\n\n';
    for (let cut = 0; cut <= text.length; cut++) {
      const parser = new SseParser();
      const messages = [...parser.push(text.slice(0, cut)), ...parser.push(text.slice(cut))];
      expect(messages).toEqual([
        { event: 'put', data: '{"a":1}' },
        { event: 'patch', data: '{"b":2}' },
      ]);
    }
  });

  it('joins multi-line data, reads ids, skips comments, accepts CRLF, accepts CR', () => {
    const parser = new SseParser();
    expect(parser.push(': heartbeat\r\nid: 7\r\ndata: line 1\r\ndata: line 2\r\n\r\n')).toEqual([
      { event: 'message', data: 'line 1\nline 2', id: '7' },
    ]);
    expect(parser.push('data:x\r\r\n')).toEqual([{ event: 'message', data: 'x', id: '7' }]);
  });

  it('waits when a chunk ends with a lone CR', () => {
    const parser = new SseParser();
    expect(parser.push('data: a\r')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ event: 'message', data: 'a' }]);
  });

  it('drops an event with no data', () => {
    expect(new SseParser().push('event: ping\n\n')).toEqual([]);
  });
});

describe('backoffDelay', () => {
  it('doubles from the first wait up to the cap, with half of each wait random', () => {
    const low = (n: number) => backoffDelay(n, { initialMs: 1000, maxMs: 30_000 }, () => 0);
    const high = (n: number) => backoffDelay(n, { initialMs: 1000, maxMs: 30_000 }, () => 1);
    expect([0, 1, 2, 3, 4, 5, 6].map(low)).toEqual([500, 1000, 2000, 4000, 8000, 15_000, 15_000]);
    expect([0, 1, 2, 3, 4, 5, 6].map(high)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });

  it('stays finite for very large attempt numbers', () => {
    expect(backoffDelay(10_000, { initialMs: 1000, maxMs: 30_000 }, () => 0.5)).toBe(22_500);
  });
});
