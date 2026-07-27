# T51 demo/99_everything artifact sizes

Compiled with
`npm start -- demo/99_everything/main.maple -o <output> --emit-wat <output.wat>`
and repeated with `--strip`; `wat2wasm` assembled the same emitted WAT.

| Pipeline | wasm bytes |
| --- | ---: |
| wat2wasm on `--emit-wat` output | 1,309 |
| encodeWasm (default) | 2,405 |
| encodeWasm `--strip` | 1,309 |

The `--emit-wat` WAT artifact was 13,376 bytes. The default encoder output is
larger because it includes the name section; stripping removes that debug
metadata and, for this build, matches wat2wasm's output size.
