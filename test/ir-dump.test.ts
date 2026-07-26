import assert from "node:assert/strict";
import { test } from "node:test";
import { dumpIr } from "../src/ir/dump-ir";
import type { IrModule } from "../src/ir/ir";

test("serializes every IR-specific value with stable Map ordering", () => {
  const module: IrModule = {
    types: [{ params: [], results: ["i64"] }],
    funcImports: [],
    globalImports: [],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "return",
            values: [{ k: "const", type: "i64", value: 42n }],
          },
        ],
        export: "run",
      },
    ],
    globals: [],
    memory: { initialPages: 1, mode: "owned" },
    data: [{ addr: 16, bytes: new Uint8Array([0x00, 0x0a, 0xab, 0xff]) }],
    dataEnd: 20,
    structLayouts: new Map([
      ["zeta", { size: 8, align: 8, members: [] }],
      ["alpha", { size: 4, align: 4, members: [] }],
    ]),
    names: {
      funcs: new Map([
        [10, "ten"],
        [2, "two"],
      ]),
      globals: new Map([
        [12, "twelve"],
        [3, "three"],
      ]),
      locals: new Map([
        [
          9,
          new Map([
            [11, "eleven"],
            [1, "one"],
          ]),
        ],
        [
          4,
          new Map([
            [8, "eight"],
            [2, "two"],
          ]),
        ],
      ]),
    },
  };

  assert.equal(
    dumpIr(module),
    `{
  "types": [
    {
      "params": [],
      "results": [
        "i64"
      ]
    }
  ],
  "funcImports": [],
  "globalImports": [],
  "funcs": [
    {
      "sig": 0,
      "locals": [],
      "body": [
        {
          "k": "return",
          "values": [
            {
              "k": "const",
              "type": "i64",
              "value": {
                "$bigint": "42"
              }
            }
          ]
        }
      ],
      "export": "run"
    }
  ],
  "globals": [],
  "memory": {
    "initialPages": 1,
    "mode": "owned"
  },
  "data": [
    {
      "addr": 16,
      "bytes": {
        "$bytes": "000aabff"
      }
    }
  ],
  "dataEnd": 20,
  "structLayouts": {
    "alpha": {
      "size": 4,
      "align": 4,
      "members": []
    },
    "zeta": {
      "size": 8,
      "align": 8,
      "members": []
    }
  },
  "names": {
    "funcs": {
      "2": "two",
      "10": "ten"
    },
    "globals": {
      "3": "three",
      "12": "twelve"
    },
    "locals": {
      "4": {
        "2": "two",
        "8": "eight"
      },
      "9": {
        "1": "one",
        "11": "eleven"
      }
    }
  }
}
`,
  );
});

function moduleWithMapOrder(reverse: boolean): IrModule {
  const order = <Key, Value>(entries: Array<[Key, Value]>): Array<[Key, Value]> =>
    reverse ? entries.reverse() : entries;

  return {
    types: [],
    funcImports: [],
    globalImports: [],
    funcs: [],
    globals: [],
    memory: { initialPages: 1, mode: "owned" },
    data: [],
    dataEnd: 0,
    structLayouts: new Map(
      order([
        ["alpha", { size: 4, align: 4, members: [] }],
        ["zeta", { size: 8, align: 8, members: [] }],
      ]),
    ),
    names: {
      funcs: new Map(
        order([
          [2, "two"],
          [10, "ten"],
        ]),
      ),
      globals: new Map(
        order([
          [3, "three"],
          [12, "twelve"],
        ]),
      ),
      locals: new Map(
        order([
          [
            4,
            new Map(
              order([
                [2, "two"],
                [8, "eight"],
              ]),
            ),
          ],
          [
            9,
            new Map(
              order([
                [1, "one"],
                [11, "eleven"],
              ]),
            ),
          ],
        ]),
      ),
    },
  };
}

test("serializes structurally equal modules identically regardless of Map insertion order", () => {
  assert.equal(dumpIr(moduleWithMapOrder(false)), dumpIr(moduleWithMapOrder(true)));
});

function moduleWithDataEnd(dataEnd: number): IrModule {
  return {
    types: [],
    funcImports: [],
    globalImports: [],
    funcs: [],
    globals: [],
    memory: { initialPages: 1, mode: "owned" },
    data: [],
    dataEnd,
    structLayouts: new Map(),
    names: {
      funcs: new Map(),
      globals: new Map(),
      locals: new Map(),
    },
  };
}

test("preserves the pinned JSON defaults for non-finite numbers and negative zero", () => {
  const nullDump = `{
  "types": [],
  "funcImports": [],
  "globalImports": [],
  "funcs": [],
  "globals": [],
  "memory": {
    "initialPages": 1,
    "mode": "owned"
  },
  "data": [],
  "dataEnd": null,
  "structLayouts": {},
  "names": {
    "funcs": {},
    "globals": {},
    "locals": {}
  }
}
`;
  const zeroDump = `{
  "types": [],
  "funcImports": [],
  "globalImports": [],
  "funcs": [],
  "globals": [],
  "memory": {
    "initialPages": 1,
    "mode": "owned"
  },
  "data": [],
  "dataEnd": 0,
  "structLayouts": {},
  "names": {
    "funcs": {},
    "globals": {},
    "locals": {}
  }
}
`;

  assert.equal(dumpIr(moduleWithDataEnd(Number.NaN)), nullDump);
  assert.equal(dumpIr(moduleWithDataEnd(Number.POSITIVE_INFINITY)), nullDump);
  assert.equal(dumpIr(moduleWithDataEnd(Number.NEGATIVE_INFINITY)), nullDump);
  assert.equal(dumpIr(moduleWithDataEnd(-0)), zeroDump);
});
