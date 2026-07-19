import type {
  LineStyle,
  Matrix,
  ObjectStyle,
  ReflowSpec,
  TextRunEdit,
} from "./pdfium";

/** Serializable PDF mutations executed by the dedicated edit worker. */
export type PdfEditOperation =
  | {
      type: "editTextObject";
      pageIndex: number;
      objectIndex: number;
      newText: string;
    }
  | {
      type: "styleTextRuns";
      pageIndex: number;
      runs: TextRunEdit[];
      style: LineStyle;
    }
  | {
      type: "reflowTextLines";
      pageIndex: number;
      spec: ReflowSpec;
    }
  | {
      type: "transformObject";
      pageIndex: number;
      objectIndex: number;
      matrix: Matrix;
    }
  | {
      type: "removeObject";
      pageIndex: number;
      objectIndex: number;
    }
  | {
      type: "setObjectStyle";
      pageIndex: number;
      objectIndex: number;
      style: ObjectStyle;
    };
