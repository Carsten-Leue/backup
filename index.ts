import { green, grey, red } from 'chalk';
import { Command } from 'commander';
import { argv } from 'process';
import { concat, merge, of } from 'rxjs';
import { ignoreElements, map, takeUntil } from 'rxjs/operators';

import { version } from './package.json';
import { sync } from './src/sync';
import { join } from 'path';

const program = new Command();
program
  .version(version)
  .name("yab")
  .arguments("<source> <target>")
  .action((src: string, dst: string) => {
    // sync result
    const { file$, stdout$, stderr$ } = sync(src, dst);
    // attach
    const out$ = stdout$.pipe(map((line) => console.log(grey(...line))));
    const err$ = stderr$.pipe(map((line) => console.error(red(...line))));
    const line$ = file$.pipe(
      map((line) => console.log(green(join(...line)))),
      ignoreElements()
    );
    // start debugging
    const done$ = concat(line$, of(true));
    // merge everything
    return merge(out$, err$).pipe(takeUntil(done$)).toPromise();
  })
  .parse(argv);

/**
 const [driver, script, src, dst] = argv;
const sync$ = sync(src, dst)
  .pipe(map((rel) => join(...rel)))
  .subscribe(console.log, console.error);

  */
