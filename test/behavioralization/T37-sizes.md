# T37 demo/99_everything artifact sizes

Compiled with `npm start -- demo/99_everything/main.maple`.

| Pipeline | WAT bytes | wasm bytes |
| --- | ---: | ---: |
| Before (string emitter) | 11,977 | 1,300 |
| After (IR printer) | 13,325 | 1,309 |

The WAT increase is informational and primarily reflects the IR printer's
explicit type uses and generated identifier suffixes.
