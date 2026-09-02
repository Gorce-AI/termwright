/**
 * Derived from @xterm/addon-unicode-graphemes 0.4.0.
 * Copyright (c) 2023 The xterm.js authors. MIT licensed.
 */
const TINF_OK = 0;
const TINF_DATA_ERROR = -3;
const MAX_DEFLATE_LOOKAHEAD_BYTES = 3;

type NumericArray = Uint8Array | Uint16Array | Uint32Array;

function readAt(array: NumericArray, index: number): number {
  const value = array[index];
  if (value === undefined) {
    throw new Error(`Invalid compressed Unicode trie data at byte ${index}`);
  }
  return value;
}

class Tree {
  table = new Uint16Array(16); /* table of code length counts */
  trans = new Uint16Array(288); /* code -> symbol translation table */
}

class Data {
  tag: number = 0;
  bitcount: number = 0;
  destLen: number = 0;
  ltree: Tree;
  dtree: Tree;
  source: Uint8Array;
  dest: Uint8Array;
  sourceIndex: number = 0;
  paddingReads: number = 0;
  consumedBits: number = 0;

  constructor(source: Uint8Array, dest: Uint8Array) {
    this.source = source;
    this.dest = dest;
    this.ltree = new Tree(); /* dynamic length/symbol tree */
    this.dtree = new Tree(); /* dynamic distance tree */
  }
}

function consumeBits(data: Data, count: number): void {
  if (data.consumedBits + count > data.source.length * 8) {
    throw new Error('Truncated compressed Unicode trie data');
  }
  data.consumedBits += count;
}

function readBitstreamByte(data: Data): number {
  const value = data.source[data.sourceIndex++];
  if (value !== undefined) return value;
  data.paddingReads += 1;
  if (data.paddingReads > MAX_DEFLATE_LOOKAHEAD_BYTES) {
    throw new Error('Truncated compressed Unicode trie data');
  }
  return 0;
}

function writeByte(data: Data, value: number): void {
  if (data.destLen >= data.dest.length) {
    throw new Error('Compressed Unicode trie exceeds its declared output size');
  }
  data.dest[data.destLen++] = value;
}

/* --------------------------------------------------- *
 * -- uninitialized global data (static structures) -- *
 * --------------------------------------------------- */

const sltree = new Tree();
const sdtree = new Tree();

/* extra bits and base tables for length codes */
const length_bits = new Uint8Array(30);
const length_base = new Uint16Array(30);

/* extra bits and base tables for distance codes */
const dist_bits = new Uint8Array(30);
const dist_base = new Uint16Array(30);

/* special ordering of code length codes */
const clcidx = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

/* used by tinf_decode_trees, avoids allocations every call */
const code_tree = new Tree();
const lengths = new Uint8Array(288 + 32);

/* ----------------------- *
 * -- utility functions -- *
 * ----------------------- */

/* build extra bits and base tables */
function tinf_build_bits_base(
  bits: Uint8Array,
  base: Uint16Array,
  delta: number,
  first: number,
): void {
  let i, sum;

  /* build bits table */
  for (i = 0; i < delta; ++i) bits[i] = 0;
  for (i = 0; i < 30 - delta; ++i) bits[i + delta] = (i / delta) | 0;

  /* build base table */
  for (sum = first, i = 0; i < 30; ++i) {
    base[i] = sum;
    sum += 1 << readAt(bits, i);
  }
}

/* build the fixed huffman trees */
function tinf_build_fixed_trees(lt: Tree, dt: Tree): void {
  let i;

  /* build fixed length tree */
  for (i = 0; i < 7; ++i) lt.table[i] = 0;

  lt.table[7] = 24;
  lt.table[8] = 152;
  lt.table[9] = 112;

  for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;
  for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;
  for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i;
  for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i;

  /* build fixed distance tree */
  for (i = 0; i < 5; ++i) dt.table[i] = 0;

  dt.table[5] = 32;

  for (i = 0; i < 32; ++i) dt.trans[i] = i;
}

/* given an array of code lengths, build a tree */
const offs = new Uint16Array(16);

function tinf_build_tree(t: Tree, lengths: Uint8Array, off: number, num: number): void {
  let i, sum;

  /* clear code length count table */
  for (i = 0; i < 16; ++i) t.table[i] = 0;

  /* scan symbol lengths, and sum code length counts */
  for (i = 0; i < num; ++i) {
    const codeLength = readAt(lengths, off + i);
    t.table[codeLength] = readAt(t.table, codeLength) + 1;
  }

  t.table[0] = 0;

  /* compute offset table for distribution sort */
  for (sum = 0, i = 0; i < 16; ++i) {
    offs[i] = sum;
    sum += readAt(t.table, i);
  }

  /* create code->symbol translation table (symbols sorted by code) */
  for (i = 0; i < num; ++i) {
    const codeLength = readAt(lengths, off + i);
    if (codeLength) {
      const target = readAt(offs, codeLength);
      t.trans[target] = i;
      offs[codeLength] = target + 1;
    }
  }
}

/* ---------------------- *
 * -- decode functions -- *
 * ---------------------- */

/* get one bit from source stream */
function tinf_getbit(d: Data): number {
  /* check if tag is empty */
  if (!d.bitcount--) {
    /* load next tag */
    d.tag = readBitstreamByte(d);
    d.bitcount = 7;
  }

  /* shift bit out of tag */
  const bit = d.tag & 1;
  d.tag >>>= 1;
  consumeBits(d, 1);

  return bit;
}

/* read a num bit value from a stream and add base */
function tinf_read_bits(d: Data, num: number, base: number): number {
  if (!num) return base;

  while (d.bitcount < 24) {
    d.tag |= readBitstreamByte(d) << d.bitcount;
    d.bitcount += 8;
  }

  const val = d.tag & (0xffff >>> (16 - num));
  d.tag >>>= num;
  d.bitcount -= num;
  consumeBits(d, num);
  return val + base;
}

/* given a data stream and a tree, decode a symbol */
function tinf_decode_symbol(d: Data, t: Tree): number {
  while (d.bitcount < 24) {
    d.tag |= readBitstreamByte(d) << d.bitcount;
    d.bitcount += 8;
  }

  let sum = 0,
    cur = 0,
    len = 0;
  let tag = d.tag;

  /* get more bits while code value is above sum */
  do {
    cur = 2 * cur + (tag & 1);
    tag >>>= 1;
    ++len;

    const count = readAt(t.table, len);
    sum += count;
    cur -= count;
  } while (cur >= 0);

  d.tag = tag;
  d.bitcount -= len;
  consumeBits(d, len);

  return readAt(t.trans, sum + cur);
}

/* given a data stream, decode dynamic trees from it */
function tinf_decode_trees(d: Data, lt: Tree, dt: Tree): void {
  let i, length;
  let num = 0;

  /* get 5 bits HLIT (257-286) */
  const hlit = tinf_read_bits(d, 5, 257);

  /* get 5 bits HDIST (1-32) */
  const hdist = tinf_read_bits(d, 5, 1);

  /* get 4 bits HCLEN (4-19) */
  const hclen = tinf_read_bits(d, 4, 4);

  for (i = 0; i < 19; ++i) lengths[i] = 0;

  /* read code lengths for code length alphabet */
  for (i = 0; i < hclen; ++i) {
    /* get 3 bits code length (0-7) */
    const clen = tinf_read_bits(d, 3, 0);
    lengths[readAt(clcidx, i)] = clen;
  }

  /* build code length tree */
  tinf_build_tree(code_tree, lengths, 0, 19);

  /* decode code lengths for the dynamic trees */
  const total = hlit + hdist;
  const appendRepeated = (value: number, count: number): void => {
    if (num + count > total) throw new Error('Invalid dynamic Huffman code count');
    while (count-- > 0) lengths[num++] = value;
  };
  for (num = 0; num < total;) {
    const sym = tinf_decode_symbol(d, code_tree);

    switch (sym) {
      case 16:
        /* copy previous code length 3-6 times (read 2 bits) */
        if (num === 0) throw new Error('Invalid repeated Huffman code without a predecessor');
        const prev = readAt(lengths, num - 1);
        length = tinf_read_bits(d, 2, 3);
        appendRepeated(prev, length);
        break;
      case 17:
        /* repeat code length 0 for 3-10 times (read 3 bits) */
        length = tinf_read_bits(d, 3, 3);
        appendRepeated(0, length);
        break;
      case 18:
        /* repeat code length 0 for 11-138 times (read 7 bits) */
        length = tinf_read_bits(d, 7, 11);
        appendRepeated(0, length);
        break;
      default:
        /* values 0-15 represent the actual code lengths */
        lengths[num++] = sym;
        break;
    }
  }

  /* build dynamic trees */
  tinf_build_tree(lt, lengths, 0, hlit);
  tinf_build_tree(dt, lengths, hlit, hdist);
}

/* ----------------------------- *
 * -- block inflate functions -- *
 * ----------------------------- */

/* given a stream and two trees, inflate a block of data */
function tinf_inflate_block_data(d: Data, lt: Tree, dt: Tree): number {
  for (;;) {
    let sym = tinf_decode_symbol(d, lt);

    /* check for end of block */
    if (sym === 256) {
      return TINF_OK;
    }

    if (sym < 256) {
      writeByte(d, sym);
    } else {
      let i;

      sym -= 257;
      if (sym < 0 || sym >= length_bits.length) throw new Error('Invalid DEFLATE length code');

      /* possibly get more bits from length code */
      const length = tinf_read_bits(d, readAt(length_bits, sym), readAt(length_base, sym));

      const dist = tinf_decode_symbol(d, dt);
      if (dist < 0 || dist >= dist_bits.length) throw new Error('Invalid DEFLATE distance code');

      /* possibly get more bits from distance code */
      const offs = d.destLen - tinf_read_bits(d, readAt(dist_bits, dist), readAt(dist_base, dist));
      if (offs < 0 || offs >= d.destLen || d.destLen + length > d.dest.length) {
        throw new Error('Invalid DEFLATE back-reference');
      }

      /* copy match */
      for (i = offs; i < offs + length; ++i) {
        writeByte(d, readAt(d.dest, i));
      }
    }
  }
}

/* inflate an uncompressed block of data */
function tinf_inflate_uncompressed_block(d: Data) {
  let i;

  /* unread from bitbuffer */
  while (d.bitcount > 8) {
    d.sourceIndex--;
    d.bitcount -= 8;
  }
  d.consumedBits = d.sourceIndex * 8;

  /* get length */
  const length = 256 * readAt(d.source, d.sourceIndex + 1) + readAt(d.source, d.sourceIndex);

  /* get one's complement of length */
  const invlength = 256 * readAt(d.source, d.sourceIndex + 3) + readAt(d.source, d.sourceIndex + 2);

  /* check length */
  if (length !== (~invlength & 0x0000ffff)) return TINF_DATA_ERROR;

  d.sourceIndex += 4;

  /* copy block */
  for (i = length; i; --i) writeByte(d, readAt(d.source, d.sourceIndex++));
  d.consumedBits = d.sourceIndex * 8;

  /* make sure we start next block on a byte boundary */
  d.bitcount = 0;

  return TINF_OK;
}

/* inflate stream from source to dest */
function tinf_uncompress(source: Uint8Array, dest: Uint8Array) {
  const d = new Data(source, dest);
  let bfinal, btype, res;

  do {
    /* read final block flag */
    bfinal = tinf_getbit(d);

    /* read block type (2 bits) */
    btype = tinf_read_bits(d, 2, 0);

    /* decompress block */
    switch (btype) {
      case 0:
        /* decompress uncompressed block */
        res = tinf_inflate_uncompressed_block(d);
        break;
      case 1:
        /* decompress block with fixed huffman trees */
        res = tinf_inflate_block_data(d, sltree, sdtree);
        break;
      case 2:
        /* decompress block with dynamic huffman trees */
        tinf_decode_trees(d, d.ltree, d.dtree);
        res = tinf_inflate_block_data(d, d.ltree, d.dtree);
        break;
      default:
        res = TINF_DATA_ERROR;
    }

    if (res !== TINF_OK) throw new Error('Data error');
  } while (!bfinal);

  if (Math.ceil(d.consumedBits / 8) !== source.length) {
    throw new Error('Trailing data after compressed Unicode trie stream');
  }

  if (d.destLen < d.dest.length) {
    if (typeof d.dest.slice === 'function') return d.dest.slice(0, d.destLen);
    else return d.dest.subarray(0, d.destLen);
  }

  return d.dest;
}

/* -------------------- *
 * -- initialization -- *
 * -------------------- */

/* build fixed huffman trees */
tinf_build_fixed_trees(sltree, sdtree);

/* build extra bits and base tables */
tinf_build_bits_base(length_bits, length_base, 4, 3);
tinf_build_bits_base(dist_bits, dist_base, 2, 1);

/* fix a special case */
length_bits[28] = 0;
length_base[28] = 258;

export default tinf_uncompress;
