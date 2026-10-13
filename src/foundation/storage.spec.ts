import { expect } from '@open-wc/testing';
import { stub } from 'sinon';

import { readStored, writeStored } from './storage.js';

describe('storage', () => {
  afterEach(() => localStorage.removeItem('storage-spec'));

  it('reads and writes values', () => {
    expect(readStored('storage-spec')).to.equal(null);
    writeStored('storage-spec', 'x');
    expect(readStored('storage-spec')).to.equal('x');
  });

  it('ignores unavailable storage', () => {
    const get = stub(Storage.prototype, 'getItem').throws(new Error('denied'));
    const set = stub(Storage.prototype, 'setItem').throws(new Error('full'));
    try {
      expect(readStored('storage-spec')).to.equal(null);
      expect(() => writeStored('storage-spec', 'x')).to.not.throw();
    } finally {
      get.restore();
      set.restore();
    }
  });
});
