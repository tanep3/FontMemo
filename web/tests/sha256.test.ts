import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256HexPure } from "../src/fonts/sha256";

function hex(text: string): string {
  return sha256HexPure(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

test("sha256 pure fallback matches known vectors", () => {
  assert.equal(
    hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  // 56-byte message: crosses into a second block during padding.
  assert.equal(
    hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});
