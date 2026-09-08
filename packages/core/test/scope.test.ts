import { describe, expect, it } from 'vitest';
import { READ_PATH, TEMPLATE, WHOLE_TEMPLATE, joinPath, splitPath } from '../src/scope.js';

describe('read paths', () => {
  it('splits identifiers and quoted keys into segments', () => {
    expect(splitPath('in')).toEqual(['in']);
    expect(splitPath('asked.body.id')).toEqual(['asked', 'body', 'id']);
    expect(splitPath("request.headers['user-agent']")).toEqual(['request', 'headers', 'user-agent']);
    expect(splitPath('request.headers["x-request-id"].0')).toEqual(['request', 'headers', 'x-request-id', '0']);
  });
  it('writes segments back, quoting what is not an identifier', () => {
    expect(joinPath(['request', 'headers', 'user-agent'])).toBe("request.headers['user-agent']");
    expect(joinPath(['asked', 'body', 'id'])).toBe('asked.body.id');
  });
  it('a template may carry a quoted key; a bare hyphen is not a path', () => {
    expect(WHOLE_TEMPLATE.exec("{{request.headers['user-agent']}}")?.[1]).toBe("request.headers['user-agent']");
    expect(WHOLE_TEMPLATE.test('{{request.headers.user-agent}}')).toBe(false);
    expect([...'a {{x.y}} b {{z["k k"]}}'.matchAll(TEMPLATE)].map(m => m[1])).toEqual(['x.y', 'z["k k"]']);
    expect(READ_PATH.test("request.headers['user-agent']")).toBe(true);
    expect(READ_PATH.test('request.')).toBe(false);
  });
});
