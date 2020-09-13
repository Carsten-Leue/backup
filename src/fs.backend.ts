import { copy, move } from 'fs-extra';
import { join } from 'path';
import { bindNodeCallback, Observable } from 'rxjs';
import { mapTo, mergeMap } from 'rxjs/operators';

import { Backend, Path } from './backend';
import { createMkdirp } from './mkdir';

const rxCopy = bindNodeCallback(copy);
const rxMove = bindNodeCallback(move);

export function fsBackend(src: string, dst: string, bkg: string): Backend {
  // handles the creation of directories
  const mkdirp = createMkdirp();

  const copyFlat = (rel: Path): Observable<Path> =>
    rxCopy(join(src, ...rel), join(dst, ...rel)).pipe(mapTo(rel));

  const backup = (rel: Path): Observable<Path> => {
    // dispatch
    return mkdirp(join(bkg, ...rel.slice(0, -1))).pipe(
      mergeMap(() => rxMove(join(dst, ...rel), join(bkg, ...rel))),
      mapTo(rel)
    );
  };

  return { copy: copyFlat, move: backup };
}
