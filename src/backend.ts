import { Observable, UnaryFunction } from "rxjs";

export type Path = string[];

export interface Backend {
  copy: UnaryFunction<Path, Observable<Path>>;
  move: UnaryFunction<Path, Observable<Path>>;
}
