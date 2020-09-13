import { MakeDirectoryOptions, mkdir, PathLike, readdir, stat, Stats } from 'graceful-fs';
import ignore, { Ignore } from 'ignore';
import { join } from 'path';
import { bindNodeCallback, combineLatest, EMPTY, from, merge, Observable, Observer, of, Subject } from 'rxjs';
import { catchError, mergeMap, mergeMapTo } from 'rxjs/operators';

import { Backend, Path } from './backend';
import { fsBackend } from './fs.backend';
import { newRootDir } from './root';

const rxReadDir = bindNodeCallback<string, string[]>(readdir);
const rxStats = bindNodeCallback<string, Stats>(stat);
const rxMkdir = bindNodeCallback<PathLike, MakeDirectoryOptions, string>(mkdir);

const CURRENT = "current";

const cmpStrings = (left: string, right: string): number =>
  left.localeCompare(right);

const isCurrent = (left: Stats, right: Stats): boolean =>
  left.size === right.size && left.mtime <= right.mtime;

const rxSafeReadDir = (name: string): Observable<string[]> =>
  rxReadDir(name).pipe(catchError((err) => of([])));

export interface Sync {
  file$: Observable<Path>;
  stdout$: Observable<string[]>;
  stderr$: Observable<string>;
}

const RECURSIVE: MakeDirectoryOptions = { recursive: true };
const FLAT: MakeDirectoryOptions = { recursive: false };

function doSync(
  src: string,
  dst: string,
  backend: Backend,
  stdout$: Observer<string[]>,
  stderr$: Observer<string>,
  ign: Ignore
): Observable<Path> {
  const { copy, move } = backend;

  // make a filter
  const ignFilter = ign.createFilter();

  // helper function to test
  const accept = (rel: Path): boolean => {
    const bOk = rel.length === 0 || ignFilter(join(...rel));
    stdout$.next([bOk ? "accept" : "reject", ...rel]);
    return bOk;
  };

  const copyDeep = (rel: Path): Observable<Path> =>
    rxSafeReadDir(join(src, ...rel)).pipe(
      mergeMap((children) => from(children)),
      mergeMap((child) =>
        rxStats(join(src, ...rel, child)).pipe(
          mergeMap((childStats) =>
            childStats.isDirectory()
              ? rxMkdir(join(dst, ...rel, child), FLAT).pipe(
                  mergeMapTo(copyDeep([...rel, child]))
                )
              : childStats.isFile()
              ? copy([...rel, child])
              : EMPTY
          ),
          catchError((error) => {
            stderr$.next(`Error: ${error}`);
            return EMPTY;
          })
        )
      )
    );

  const copyFileOrDir = (bFile: boolean, rel: Path): Observable<Path> =>
    bFile
      ? copy(rel)
      : rxMkdir(join(dst, ...rel), FLAT).pipe(mergeMap(() => copyDeep(rel)));

  const syncNew = (rel: Path): Observable<Path> => {
    // log this
    stdout$.next(["New", ...rel]);
    // dispatch
    return accept(rel)
      ? rxStats(join(src, ...rel)).pipe(
          mergeMap((stat) => copyFileOrDir(stat.isFile(), rel)),
          catchError((error) => {
            stderr$.next(`Error: ${error}`);
            return EMPTY;
          })
        )
      : EMPTY;
  };

  function syncSingle(rel: Path): Observable<Path> {
    // log this
    stdout$.next(["Sync", ...rel]);
    // check if we need to recurse
    const statL$ = rxStats(join(src, ...rel));
    const statR$ = rxStats(join(dst, ...rel));
    // execute
    return accept(rel)
      ? combineLatest([statL$, statR$]).pipe(
          mergeMap(([statL, statR]) => {
            // we need to iterate into directories
            if (statL.isDirectory() && statR.isDirectory()) {
              // recurse
              return syncRecurse(rel);
            }
            // we need to check if files are identical
            if (statL.isFile() && statR.isFile() && isCurrent(statL, statR)) {
              return EMPTY;
            }
            // copy source to target location
            return move(rel).pipe(
              mergeMap(() => copyFileOrDir(statL.isFile(), rel))
            );
          })
        )
      : EMPTY;
  }

  function syncChildren(
    rel: Path,
    left: string[],
    right: string[]
  ): Observable<Path> {
    // sort the list
    const l = [...left].sort(cmpStrings);
    const r = [...right].sort(cmpStrings);
    // target observables
    const result: Array<Observable<Path>> = [];
    // indexes
    let idxL = 0;
    let idxR = 0;
    const lenL = l.length;
    const lenR = r.length;
    // walk in parallel
    while (idxL < lenL && idxR < lenR) {
      // names
      const nameL = l[idxL];
      const nameR = r[idxR];
      // handle
      const c = cmpStrings(nameL, nameR);
      if (c === 0) {
        // register
        result.push(syncSingle([...rel, nameL]));
        // advance both indexes
        idxL++;
        idxR++;
      } else if (c < 0) {
        // src is new, just copy
        result.push(syncNew([...rel, nameL]));
        idxL++;
      } else {
        // dst is extra, move it
        result.push(move([...rel, nameR]));
        idxR++;
      }
    }
    // handle extra source
    while (idxL < lenL) {
      result.push(syncNew([...rel, l[idxL++]]));
    }
    // handle extra target
    while (idxR < lenR) {
      result.push(move([...rel, r[idxR++]]));
    }
    // combine all
    return result.length == 0 ? EMPTY : merge(...result);
  }

  const syncRecurse = (rel: Path): Observable<Path> => {
    // log this
    stdout$.next(["Recurse", ...rel]);
    // execute
    return accept(rel)
      ? combineLatest([
          rxSafeReadDir(join(src, ...rel)),
          rxSafeReadDir(join(dst, ...rel)),
        ]).pipe(mergeMap(([left, right]) => syncChildren(rel, left, right)))
      : EMPTY;
  };

  // start with the root folder
  return syncRecurse([]);
}

const internalSync = (src: string, dst: string, backend: Backend): Sync => {
  // the ignore files
  const ign: Ignore = ignore();
  ign.add("node_modules");
  ign.add(".git");
  // the subjects
  const stdout$ = new Subject<string[]>();
  const stderr$ = new Subject<string>();
  // the files
  const file$ = rxMkdir(dst, RECURSIVE).pipe(
    mergeMap(() => doSync(src, dst, backend, stdout$, stderr$, ign))
  );
  // ok
  return { file$, stdout$, stderr$ };
};

export function sync(src: string, root: string, backend?: Backend): Sync {
  // make sure to create the directories
  const dst = join(root, CURRENT);
  // fallback
  const bkg = backend || fsBackend(src, dst, join(root, ...newRootDir()));
  // fallback
  return internalSync(src, dst, bkg);
}
