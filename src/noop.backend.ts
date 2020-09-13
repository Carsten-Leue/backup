import { EMPTY } from "rxjs";

import { Backend } from "./backend";

export function noopBackend(): Backend {
  const copyFlat = () => EMPTY;

  const backup = () => EMPTY;

  return { copy: copyFlat, move: backup };
}
