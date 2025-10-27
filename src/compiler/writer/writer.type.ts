export interface IWriter {
  append: (s: string) => void;
  newLine: () => void;
  line: (s?: string) => void;
  open: (s?: string) => void;
  close: (s?: string) => void;
  tabIn: () => void;
  untab: () => void;
  raw: (s?: string) => void;
  toString: () => string;
}
