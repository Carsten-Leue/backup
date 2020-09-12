import { copy, move } from 'fs-extra';
import { mkdir, readdir, stat, Stats } from 'graceful-fs';
import { join } from 'path';
import {
  bindNodeCallback,
  combineLatest,
  EMPTY,
  from,
  merge,
  Observable,
  Observer,
  of,
  queueScheduler,
  SchedulerLike,
  Subject,
  UnaryFunction,
} from 'rxjs';
import { catchError, mapTo, mergeMap, mergeMapTo, filter } from 'rxjs/operators';
import ignore, { Ignore } from 'ignore'

import { createMkdirp } from './mkdir';
import { newRootDir } from './root';

const rxReadDir = bindNodeCallback<string, string[]>(readdir);
const rxStats = bindNodeCallback<string, Stats>(stat);
const rxCopy = bindNodeCallback(copy);
const rxMkdir = bindNodeCallback(mkdir);
const rxMove = bindNodeCallback(move);

export type Path = string[];

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

function doSync(
  src: string,
  dst: string,
  bkg: string,
  mkdirp: UnaryFunction<string, Observable<string>>,
  stdout$: Observer<string[]>,
  stderr$: Observer<string>,
  ign: Ignore,
  scheduler: SchedulerLike  
): Observable<Path> {
  // make a filter
  const ignFilter = ign.createFilter();

  const copyDeep = (rel: Path): Observable<Path> =>
    rxSafeReadDir(join(src, ...rel)).pipe(
      mergeMap((children) => from(children)),
      mergeMap((child) =>
        rxStats(join(src, ...rel, child)).pipe(
          mergeMap((childStats) =>
            childStats.isDirectory()
              ? rxMkdir(join(dst, ...rel, child)).pipe(
                  mergeMapTo(copyDeep([...rel, child]))
                )
              : childStats.isFile()
              ? copyFlat([...rel, child])
              : EMPTY
          ),
          catchError((error) => {
            stderr$.next(`Error: ${error}`);
            return EMPTY;
          })
        )
      )
    );

  const copyFlat = (rel: Path): Observable<Path> =>
    rxCopy(join(src, ...rel), join(dst, ...rel)).pipe(mapTo(rel));

  const copyFileOrDir = (bFile: boolean, rel: Path): Observable<Path> =>
    bFile
      ? copyFlat(rel)
      : rxMkdir(join(dst, ...rel)).pipe(mergeMap(() => copyDeep(rel)));

  const backup = (rel: Path): Observable<Path> => {
    // log this
    stdout$.next(["Backup", ...rel]);
    // dispatch
    return mkdirp(join(bkg, ...rel.slice(0, -1))).pipe(
      mergeMap(() => rxMove(join(dst, ...rel), join(bkg, ...rel))),
      mapTo(rel)
    );
  };

  const syncNew = (rel: Path): Observable<Path> => {
    // log this
    stdout$.next(["New", ...rel]);
    // dispatch
    return rxStats(join(src, ...rel)).pipe(
      mergeMap((stat) => copyFileOrDir(stat.isFile(), rel)),
      catchError((error) => {
        stderr$.next(`Error: ${error}`);
        return EMPTY;
      })
    );
  };

  function syncSingle(rel: Path): Observable<Path> {
    // log this
    stdout$.next(["Sync", ...rel]);
    // check if we need to recurse
    const statL$ = rxStats(join(src, ...rel));
    const statR$ = rxStats(join(dst, ...rel));
    // execute
    return combineLatest([statL$, statR$], scheduler).pipe(
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
        return backup(rel).pipe(
          mergeMap(() => copyFileOrDir(statL.isFile(), rel))
        );
      })
    );
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
        result.push(backup([...rel, nameR]));
        idxR++;
      }
    }
    // handle extra source
    while (idxL < lenL) {
      result.push(syncNew([...rel, l[idxL++]]));
    }
    // handle extra target
    while (idxR < lenR) {
      result.push(backup([...rel, r[idxR++]]));
    }
    // combine all
    return result.length == 0 ? EMPTY : merge(...result, scheduler);
  }

  const syncRecurse = (rel: Path): Observable<Path> => {
    // log this
    stdout$.next(["Recurse", ...rel]);
    // source path
    const bOk = rel.length === 0 || ignFilter(join(...rel));
    // execute
    return bOk ? combineLatest(
      [rxSafeReadDir(join(src, ...rel)), rxSafeReadDir(join(dst, ...rel))],
      scheduler
    ).pipe(mergeMap(([left, right]) => syncChildren(rel, left, right))) : EMPTY;
  };

  // start with the root folder
  return syncRecurse([]);
}

const internalSync = (
  src: string,
  dst: string,
  bkg: string,
  mkdirp: UnaryFunction<string, Observable<string>>,
  scheduler: SchedulerLike
): Sync => {
  // the ignore files
  const ign: Ignore = ignore();
  ign.add('node_modules');
  ign.add('.git');
  // the subjects
  const stdout$ = new Subject<string[]>();
  const stderr$ = new Subject<string>();
  // the files
  const file$ = combineLatest(
    [mkdirp(src), mkdirp(dst), mkdirp(bkg)],
    scheduler
  ).pipe(
    mergeMap(([s, d, b]) =>
      doSync(s, d, b, mkdirp, stdout$, stderr$, ign, scheduler)
    )
  );
  // ok
  return { file$, stdout$, stderr$ };
};

export function sync(src: string, root: string): Sync {
  // make sure to create the directories
  const mkdirp = createMkdirp();
  const dst = join(root, CURRENT);
  const bkg = join(root, newRootDir());
  // fallback
  return internalSync(src, dst, bkg, mkdirp, queueScheduler);
}
